import { App, TFile, TFolder, normalizePath } from 'obsidian';

import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
import {
  FolderPasswordKind,
  MASTER_KDF_ITERATIONS,
  MASTER_VERIFIER_PHRASE,
  MasterPasswordRecord,
  sanitizePasswordLabel,
  validateCustomPasswordLabel,
} from '../models/PasswordManagement';
import { AutoLockManager, AutoLockSettings, IdleLockCountdown } from './AutoLockManager';
import { BatchProcessor, FolderProcessingOptions } from './BatchProcessor';
import { EncryptionService, KeyDerivationCache } from './EncryptionService';
import { FileService } from './FileService';
import { MetadataManager } from './MetadataManager';
import { bucketCount, type TelemetrySink } from './TelemetryService';

export type { AutoLockSettings, IdleLockCountdown } from './AutoLockManager';
export type {
  FolderProcessingOperation,
  FolderProcessingOptions,
  FolderProcessingProgress,
  FolderProcessingStatus,
} from './BatchProcessor';

export interface MasterPasswordStore {
  load(): MasterPasswordRecord | null | undefined;
  save(record: MasterPasswordRecord | null): Promise<void>;
}

export interface FolderServiceDeps {
  metadataManager?: MetadataManager;
  autoLockManager?: AutoLockManager;
  batchProcessor?: BatchProcessor;
  telemetry?: TelemetrySink;
  masterPasswordStore?: MasterPasswordStore;
}

export interface CreateEncryptedFolderPasswordOptions {
  kind?: FolderPasswordKind;
  label?: string;
  /**
   * Shared master recovery key plaintext. Required when kind is 'master'
   * so the folder key is also wrapped for master-recovery unlock.
   */
  masterRecoveryKey?: string;
}

export interface FolderPasswordSummary {
  path: string;
  kind: FolderPasswordKind;
  label?: string;
}

export interface MasterPasswordChangeResult {
  rotated: number;
  total: number;
  /** Folders whose previous password wrap could not be deleted yet. */
  previousWrapsRemaining: number;
}

export type FolderLockVia = 'manual' | 'background' | 'idle' | 'unload';

export class FolderService {
  /**
   * In-memory master keys for unlocked folders. Keys are non-extractable
   * (see EncryptionService.importKey with extractable:false), so dropping
   * the Map entry purges the only reachable handle — there is intentionally
   * no accessor exposing raw key material outside this service. Entries are
   * removed on lock, removeEncryption, updatePath/removePath, and lockAll.
   */
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private encryptedFolders: Set<string> = new Set();
  private syncDebounceTimer: number | null = null;
  private fullScanRequested = false;
  private lastFullScanAt = 0;
  private readonly FULL_SCAN_STALE_MS = 60_000;
  private encryptedParentCache: Map<string, TFolder | null> = new Map();
  private autoLockInProgress = false;
  private debugLogging = false;

  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly LOCKED_EXTENSION = '.locked';
  private readonly README_FILE_NAME = 'README_ENCRYPTED.md';
  /**
   * Per-file processing cap. Encrypt/decrypt transiently holds ~3-4x the
   * file size in memory (plaintext + ciphertext + staged buffers), so
   * fail fast with a clear message instead of risking OOM on huge files.
   */
  private readonly MAX_PROCESSABLE_BYTES = 64 * 1024 * 1024;

  private metadataManager: MetadataManager;
  private autoLockManager: AutoLockManager;
  private batchProcessor: BatchProcessor;
  private telemetry: TelemetrySink | undefined;
  private masterPasswordStore: MasterPasswordStore | undefined;

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
    private app: App,
    deps: FolderServiceDeps = {},
  ) {
    this.metadataManager =
      deps.metadataManager ??
      new MetadataManager(this.encryptionService, this.fileService, (msg, data) => this.debug(msg, data));
    this.autoLockManager = deps.autoLockManager ?? new AutoLockManager();
    this.batchProcessor = deps.batchProcessor ?? new BatchProcessor([this.META_FILE_NAME, this.README_FILE_NAME]);
    this.telemetry = deps.telemetry;
    this.masterPasswordStore = deps.masterPasswordStore;
  }

  setMasterPasswordStore(store: MasterPasswordStore | undefined): void {
    this.masterPasswordStore = store;
  }

  setDebugLogging(enabled: boolean): void {
    this.debugLogging = enabled;
  }

  setAutoLockSettings(settings: AutoLockSettings): void {
    this.autoLockManager.setAutoLockSettings(settings);
  }

  /**
   * Creates a session-scoped derivation cache for password-retry flows.
   * The caller owns its lifetime and must clear() it when the prompt
   * session ends (e.g. modal close) to drop derived key material promptly.
   */
  createDerivationCache(): KeyDerivationCache {
    return new KeyDerivationCache((password, salt) => this.encryptionService.deriveSecretKeys(password, salt));
  }

  recordActivityForPath(path: string, timestamp = Date.now()): void {
    const folderKey = this.toFolderKey(path);
    if (!this.unlockedFolders.has(folderKey)) {
      return;
    }

    this.autoLockManager.recordActivityForPath(path, timestamp);
  }

  recordActivityForItem(item: TFile | TFolder | null, timestamp = Date.now()): void {
    if (!item) {
      return;
    }

    const folderKey = this.getTrackedFolderKey(item);
    if (!folderKey) {
      return;
    }

    this.autoLockManager.recordActivityForPath(folderKey, timestamp);
  }

  getUnlockedFolderPaths(): string[] {
    return Array.from(this.unlockedFolders.keys());
  }

  requestSyncFolders(reason = 'event', forceFullScan = false): void {
    if (this.syncDebounceTimer) {
      window.clearTimeout(this.syncDebounceTimer);
    }
    if (forceFullScan) {
      this.fullScanRequested = true;
    }

    this.syncDebounceTimer = window.setTimeout(() => {
      this.syncDebounceTimer = null;
      const forceFull = this.fullScanRequested;
      this.fullScanRequested = false;
      void this.syncFolders(4, 300, forceFull).catch((error: unknown) => {
        this.debug('syncFolders failed after request', { reason, error });
      });
    }, 1000);
  }

  debug(message: string, data?: unknown): void {
    if (!this.debugLogging) {
      return;
    }

    if (data === undefined) {
      console.debug(`[EncryptedFolders] ${message}`);
      return;
    }

    console.debug(`[EncryptedFolders] ${message}`, data);
  }

  private toFolderKey(path: string): string {
    return normalizePath(path);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private getReadmePath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.README_FILE_NAME}`);
  }

  private getFolderDisplayName(folder: TFolder): string {
    if (folder.name && folder.name.trim().length > 0) {
      return folder.name;
    }

    const segments = normalizePath(folder.path)
      .split('/')
      .filter((segment) => segment.length > 0);
    return segments.length > 0 ? segments[segments.length - 1] : folder.path;
  }

  private buildReadmeContent(folder: TFolder): string {
    const folderName = this.getFolderDisplayName(folder);
    return `
# 🔒 ${folderName} is encrypted

This folder is currently encrypted and locked by the **Obsidian Encrypted Folders** plugin.

### 🔑 How to unlock

1. Desktop: Right-click this folder in the file explorer, then select **Unlock folder**.
2. Mobile: Long-press this folder in the file explorer, then select **Unlock folder**.
3. Enter your password to restore your files.

*Note: The ".locked" files are your encrypted data. Do not delete or modify them while the folder is locked.*
`.trim();
  }

  private getTrackedFolderKey(item: TFile | TFolder): string | null {
    if (item instanceof TFolder) {
      const folderKey = this.toFolderKey(item.path);
      if (this.unlockedFolders.has(folderKey)) {
        return folderKey;
      }
    }

    const encryptedParent = this.getEncryptedParent(item);
    if (!encryptedParent) {
      return null;
    }

    const parentKey = this.toFolderKey(encryptedParent.path);
    return this.unlockedFolders.has(parentKey) ? parentKey : null;
  }

  getIdleLockCountdowns(timestamp = Date.now()): IdleLockCountdown[] {
    return this.autoLockManager.getIdleLockCountdowns(this.getUnlockedFolderPaths(), timestamp);
  }

  getNextIdleLockCountdown(timestamp = Date.now()): IdleLockCountdown | null {
    return this.autoLockManager.getNextIdleLockCountdown(this.getUnlockedFolderPaths(), timestamp);
  }

  private async lockTrackedFolders(
    folderPaths?: string[],
    options?: FolderProcessingOptions,
    via: FolderLockVia = 'manual',
  ): Promise<boolean> {
    let lockedAny = false;
    const paths = folderPaths ?? Array.from(this.unlockedFolders.keys());

    for (const path of paths) {
      const folder = this.fileService.getAbstractFileByPath(path);
      if (folder instanceof TFolder) {
        await this.lockFolder(folder, options, via);
        lockedAny = true;
        continue;
      }

      this.unlockedFolders.delete(path);
      this.autoLockManager.removePath(path);
    }

    return lockedAny;
  }

  private async runAutoLock(reason: 'background' | 'idle', folderPaths?: string[]): Promise<boolean> {
    const paths = folderPaths ?? Array.from(this.unlockedFolders.keys());
    if (this.autoLockInProgress || paths.length === 0) {
      return false;
    }

    this.autoLockInProgress = true;

    try {
      const locked = await this.lockTrackedFolders(paths, undefined, reason);
      if (locked) {
        this.debug('folders auto-locked', { reason });
        this.telemetry?.trackEvent('auto_lock_triggered', {
          via: reason,
          folder_count_bucket: bucketCount(paths.length),
        });
      }
      return locked;
    } finally {
      this.autoLockInProgress = false;
    }
  }

  async runBackgroundAutoLock(): Promise<boolean> {
    if (!this.autoLockManager.getAutoLockSettings().lockOnBackground) {
      return false;
    }

    return this.runAutoLock('background');
  }

  async runIdleAutoLock(timestamp = Date.now()): Promise<boolean> {
    const expiredPaths = this.autoLockManager.getExpiredUnlockedFolderPaths(this.getUnlockedFolderPaths(), timestamp);
    if (expiredPaths.length === 0) {
      return false;
    }

    return this.runAutoLock('idle', expiredPaths);
  }

  private async readMetadata(folder: TFolder): Promise<FolderMetadata | null> {
    return this.metadataManager.readMetadata(folder);
  }

  private async writeMetadata(folderPath: string, metadata: FolderMetadata): Promise<void> {
    await this.metadataManager.writeMetadata(folderPath, metadata);
  }

  private async transitionMetadataState(
    folder: TFolder,
    metadata: FolderMetadata,
    state: FolderLifecycleState,
    lastError?: string,
  ): Promise<FolderMetadata> {
    return this.metadataManager.transitionMetadataState(folder, metadata, state, lastError);
  }

  private countLockedFiles(folder: TFolder): number {
    return this.batchProcessor.countLockedFiles(folder);
  }

  getPlaintextFilesInLockedFolder(folder: TFolder): TFile[] {
    if (!this.isEncryptedFolder(folder) || this.isUnlocked(folder)) {
      return [];
    }

    return this.batchProcessor.collectPlaintextFiles(folder);
  }

  findLockedEncryptedParentWithPlaintext(item: TFile | TFolder): TFolder | null {
    const folder = item instanceof TFolder && this.isEncryptedFolder(item) ? item : this.getEncryptedParent(item);
    if (!folder || this.isUnlocked(folder)) {
      return null;
    }

    return this.getPlaintextFilesInLockedFolder(folder).length > 0 ? folder : null;
  }

  async reconcileFolderState(folder: TFolder): Promise<void> {
    let metadata;
    try {
      metadata = await this.readMetadata(folder);
    } catch (error: unknown) {
      // Event-path caller; corrupt metadata cannot be reconciled. Log and
      // leave the folder locked rather than throwing into an unhandled
      // rejection or treating it as unencrypted.
      this.debug('reconcile skipped: unreadable metadata', { folder: folder.path, error: String(error) });
      return;
    }
    if (!metadata) {
      return;
    }

    if (metadata.state === 'locking') {
      const readmePath = this.getReadmePath(folder.path);
      if (!this.fileService.exists(readmePath)) {
        await this.fileService.writeBinary(
          readmePath,
          new TextEncoder().encode(this.buildReadmeContent(folder)).buffer,
        );
      }
      await this.transitionMetadataState(folder, metadata, 'locked');
      return;
    }

    if (metadata.state === 'unlocking') {
      const lockedFiles = this.countLockedFiles(folder);
      const nextState: FolderLifecycleState = lockedFiles === 0 ? 'unlocked' : 'locked';
      await this.transitionMetadataState(folder, metadata, nextState);
    }
  }

  async createEncryptedFolder(
    folder: TFolder,
    password: string,
    lockImmediately = false,
    options?: FolderProcessingOptions,
    passwordOptions?: CreateEncryptedFolderPasswordOptions,
  ): Promise<string> {
    if (this.isInsideEncryptedFolder(folder)) {
      throw new Error('Nested encryption is not allowed. A parent folder is already encrypted.');
    }

    const kind: FolderPasswordKind = passwordOptions?.kind ?? 'custom';
    const label = kind === 'custom' ? sanitizePasswordLabel(passwordOptions?.label) : undefined;
    let masterRecoveryKey: string | undefined;
    if (kind === 'master') {
      const record = this.masterPasswordStore?.load();
      if (!record) {
        throw new Error('Master password is not set up. Set it up in settings first.');
      }
      if (!passwordOptions?.masterRecoveryKey) {
        throw new Error('Master recovery key material is required to encrypt with the master password.');
      }
      masterRecoveryKey = passwordOptions.masterRecoveryKey;
    }

    const recoveryKey = kind === 'master' ? masterRecoveryKey! : this.generateRecoveryKey();
    const tempExportableKey = await this.encryptionService.generateMasterKey(true);
    const masterKeyRaw = await this.encryptionService.exportKey(tempExportableKey);
    const masterKey = await this.encryptionService.importKey(masterKeyRaw, false);

    const salt = this.encryptionService.generateSalt();
    // Single PBKDF2 execution split into wrapping + MAC keys (previously two).
    const { encryptionKey: derivedKey, hmacKey } = await this.encryptionService.deriveSecretKeys(password, salt);
    const wrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, derivedKey);

    const recoverySalt = this.encryptionService.generateSalt();
    const { encryptionKey: recoveryDerivedKey, hmacKey: recoveryHmacKey } =
      await this.encryptionService.deriveSecretKeys(recoveryKey, recoverySalt);
    const recoveryWrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, recoveryDerivedKey);

    const testPhrase = 'OBSIDIAN_ENCRYPTED_VERIFICATION';
    const encoder = new TextEncoder();
    const testResult = await this.encryptionService.encryptWithKey(encoder.encode(testPhrase).buffer, masterKey);
    const combinedToken = this.combineBuffers(testResult.iv, testResult.ciphertext);

    let metadata: FolderMetadata = {
      version: 2,
      schemaVersion: 3,
      id: window.crypto.randomUUID(),
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: this.metadataManager.arrayBufferToBase64(salt),
      iterations: 600000,
      lockFile: this.META_FILE_NAME,
      testToken: this.metadataManager.arrayBufferToBase64(combinedToken),
      wrappedMasterKey: this.metadataManager.arrayBufferToBase64(wrappedResult.ciphertext),
      masterKeyIV: this.metadataManager.arrayBufferToBase64(wrappedResult.iv),
      recoverySalt: this.metadataManager.arrayBufferToBase64(recoverySalt),
      wrappedMasterKeyRecovery: this.metadataManager.arrayBufferToBase64(recoveryWrappedResult.ciphertext),
      recoveryIV: this.metadataManager.arrayBufferToBase64(recoveryWrappedResult.iv),
      passwordKind: kind,
      passwordLabel: label,
      state: lockImmediately ? 'locking' : 'unlocked',
      lastTransitionAt: Date.now(),
    };

    // Master folders additionally wrap the folder key with the shared master
    // recovery key so one recovery key opens every master folder.
    if (kind === 'master') {
      const record = this.masterPasswordStore?.load();
      if (!record) {
        throw new Error('Master password is not set up. Set it up in settings first.');
      }
      const masterRecoverySalt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoverySalt));
      const { encryptionKey: sharedKey, hmacKey: sharedHmac } = await this.encryptionService.deriveSecretKeys(
        masterRecoveryKey!,
        masterRecoverySalt,
      );
      const sharedWrapped = await this.encryptionService.encryptWithKey(masterKeyRaw, sharedKey);
      metadata.wrappedMasterKeyMasterRecovery = this.metadataManager.arrayBufferToBase64(sharedWrapped.ciphertext);
      metadata.masterRecoveryIV = this.metadataManager.arrayBufferToBase64(sharedWrapped.iv);
      metadata.masterRecoveryMac = await this.metadataManager.computeMetadataMacWithKey(metadata, sharedHmac);
    }

    metadata.mac = await this.metadataManager.computeMetadataMacWithKey(metadata, hmacKey);
    metadata.recoveryMac = await this.metadataManager.computeMetadataMacWithKey(metadata, recoveryHmacKey);

    await this.writeMetadata(folder.path, metadata);

    if (lockImmediately) {
      try {
        const encryptedCount = await this.encryptFolderContents(folder, masterKey, options);
        metadata = {
          ...metadata,
          expectedLockedFiles: encryptedCount,
        };
        await this.fileService.writeBinary(
          this.getReadmePath(folder.path),
          new TextEncoder().encode(this.buildReadmeContent(folder)).buffer,
        );
        metadata = await this.transitionMetadataState(folder, metadata, 'locked');
      } catch (error: unknown) {
        await this.transitionMetadataState(folder, metadata, 'error', String(error));
        throw error instanceof Error ? error : new Error(String(error));
      }
    } else {
      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      this.recordActivityForPath(folder.path);
      metadata = await this.transitionMetadataState(folder, metadata, 'unlocked');
    }

    this.encryptedFolders.add(this.toFolderKey(folder.path));
    this.encryptedParentCache.clear();
    this.debug('encrypted folder created', { folder: folder.path, state: metadata.state });
    this.telemetry?.trackEvent('folder_encrypted', {
      lock_immediately: lockImmediately,
      password_kind: kind,
      file_count_bucket:
        lockImmediately && typeof metadata.expectedLockedFiles === 'number'
          ? bucketCount(metadata.expectedLockedFiles)
          : 'pending',
    });
    return recoveryKey;
  }

  generateRecoveryKey(): string {
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let ret = '';
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < 32; i++) {
      ret += charset.charAt(bytes[i] % charset.length);
      if ((i + 1) % 8 === 0 && i < 31) {
        ret += '-';
      }
    }
    return ret;
  }

  // ---------------------------------------------------------------------------
  // Master password lifecycle
  // ---------------------------------------------------------------------------

  hasMasterPassword(): boolean {
    return this.masterPasswordStore?.load() != null;
  }

  getMasterRecord(): MasterPasswordRecord | null {
    return this.masterPasswordStore?.load() ?? null;
  }

  private requireMasterStore(): MasterPasswordStore {
    const store = this.masterPasswordStore;
    if (!store) {
      throw new Error('Master password storage is not configured.');
    }
    return store;
  }

  private async buildMasterVerifier(
    secret: string,
    salt: Uint8Array,
  ): Promise<{ verifier: string; verifierIV: string }> {
    const { encryptionKey } = await this.encryptionService.deriveSecretKeys(secret, salt);
    const result = await this.encryptionService.encryptWithKey(
      new TextEncoder().encode(MASTER_VERIFIER_PHRASE).buffer,
      encryptionKey,
    );
    return {
      verifier: this.metadataManager.arrayBufferToBase64(result.ciphertext),
      verifierIV: this.metadataManager.arrayBufferToBase64(result.iv),
    };
  }

  private async verifyMasterRecord(record: MasterPasswordRecord, password: string): Promise<boolean> {
    try {
      const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.salt));
      const { encryptionKey } = await this.encryptionService.deriveSecretKeys(password, salt);
      const ciphertext = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.verifier));
      const iv = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.verifierIV));
      const plaintext = await this.encryptionService.decryptWithKey(ciphertext, encryptionKey, iv);
      return new TextDecoder().decode(plaintext) === MASTER_VERIFIER_PHRASE;
    } catch {
      return false;
    }
  }

  async verifyMasterPassword(password: string): Promise<boolean> {
    const record = this.masterPasswordStore?.load();
    if (!record) {
      return false;
    }
    return this.verifyMasterRecord(record, password);
  }

  async verifyMasterRecoveryKey(recoveryKey: string): Promise<boolean> {
    const record = this.masterPasswordStore?.load();
    if (!record || !record.recoverySalt || !record.recoveryVerifier) {
      return false;
    }
    try {
      const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoverySalt));
      const { encryptionKey } = await this.encryptionService.deriveSecretKeys(recoveryKey, salt);
      const ciphertext = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryVerifier));
      const iv = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryVerifierIV));
      const plaintext = await this.encryptionService.decryptWithKey(ciphertext, encryptionKey, iv);
      return new TextDecoder().decode(plaintext) === MASTER_VERIFIER_PHRASE;
    } catch {
      return false;
    }
  }

  /**
   * Unwraps the stored master recovery key envelope with the master password.
   * The envelope lets folder creation/convert flows wrap new master folders
   * with the shared recovery key without ever persisting it in plaintext.
   */
  async unwrapMasterRecoveryKey(masterPassword: string): Promise<string> {
    const record = this.masterPasswordStore?.load();
    if (!record) {
      throw new Error('Master password is not set up.');
    }
    const valid = await this.verifyMasterRecord(record, masterPassword);
    if (!valid) {
      throw new Error('Incorrect master password.');
    }
    const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.salt));
    const { encryptionKey } = await this.encryptionService.deriveSecretKeys(masterPassword, salt);
    const ciphertext = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryKeyEnvelope));
    const iv = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryKeyEnvelopeIV));
    const plaintext = await this.encryptionService.decryptWithKey(ciphertext, encryptionKey, iv);
    return new TextDecoder().decode(plaintext);
  }

  private assertMasterPasswordStrength(password: string): void {
    if (!password || password.length < 8) {
      throw new Error('Master password must be at least 8 characters.');
    }
  }

  private async masterVerifierMatches(record: MasterPasswordRecord, encryptionKey: CryptoKey): Promise<boolean> {
    try {
      const ciphertext = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.verifier));
      const iv = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.verifierIV));
      const plaintext = await this.encryptionService.decryptWithKey(ciphertext, encryptionKey, iv);
      return new TextDecoder().decode(plaintext) === MASTER_VERIFIER_PHRASE;
    } catch {
      return false;
    }
  }

  private async encryptKnownPhrase(
    encryptionKey: CryptoKey,
    phrase: string,
  ): Promise<{ verifier: string; verifierIV: string }> {
    const result = await this.encryptionService.encryptWithKey(new TextEncoder().encode(phrase).buffer, encryptionKey);
    return {
      verifier: this.metadataManager.arrayBufferToBase64(result.ciphertext),
      verifierIV: this.metadataManager.arrayBufferToBase64(result.iv),
    };
  }

  private async decryptRecoveryEnvelope(record: MasterPasswordRecord, encryptionKey: CryptoKey): Promise<string> {
    const ciphertext = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryKeyEnvelope));
    const iv = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoveryKeyEnvelopeIV));
    const plaintext = await this.encryptionService.decryptWithKey(ciphertext, encryptionKey, iv);
    return new TextDecoder().decode(plaintext);
  }

  private hasPreviousPasswordWrap(metadata: FolderMetadata): boolean {
    return (
      typeof metadata.previousSalt === 'string' &&
      metadata.previousSalt.length > 0 &&
      typeof metadata.previousWrappedMasterKey === 'string' &&
      metadata.previousWrappedMasterKey.length > 0 &&
      typeof metadata.previousMasterKeyIV === 'string' &&
      metadata.previousMasterKeyIV.length > 0
    );
  }

  /** View the stored previous wrap as the current slot, with no further fallback. */
  private metadataWithPreviousWrap(metadata: FolderMetadata): FolderMetadata {
    return {
      ...metadata,
      salt: metadata.previousSalt ?? metadata.salt,
      iterations: metadata.previousIterations ?? metadata.iterations,
      wrappedMasterKey: metadata.previousWrappedMasterKey ?? metadata.wrappedMasterKey,
      masterKeyIV: metadata.previousMasterKeyIV ?? metadata.masterKeyIV,
      mac: metadata.previousMac,
      previousSalt: undefined,
      previousIterations: undefined,
      previousWrappedMasterKey: undefined,
      previousMasterKeyIV: undefined,
      previousMac: undefined,
    };
  }

  private stripPreviousPasswordWrap(metadata: FolderMetadata): FolderMetadata {
    return {
      ...metadata,
      previousSalt: undefined,
      previousIterations: undefined,
      previousWrappedMasterKey: undefined,
      previousMasterKeyIV: undefined,
      previousMac: undefined,
    };
  }

  /**
   * Drops previous password wraps once the saved master record uses the
   * same salt as the folder's current wrap. Safe to retry: a crash between
   * the settings save and this delete leaves both passwords working.
   */
  private async clearCommittedPreviousWraps(): Promise<{ remaining: number }> {
    const record = this.masterPasswordStore?.load();
    if (!record?.salt) {
      return { remaining: 0 };
    }

    let remaining = 0;
    const summaries = await this.listFolderPasswordKinds();
    for (const summary of summaries) {
      if (summary.kind !== 'master') {
        continue;
      }
      const folder = this.fileService.getAbstractFileByPath(summary.path);
      if (!(folder instanceof TFolder)) {
        continue;
      }
      let metadata: FolderMetadata | null;
      try {
        metadata = await this.readMetadata(folder);
      } catch {
        remaining += 1;
        continue;
      }
      if (!metadata || !this.hasPreviousPasswordWrap(metadata)) {
        continue;
      }
      if (metadata.salt !== record.salt) {
        remaining += 1;
        continue;
      }
      try {
        await this.writeMetadata(folder.path, this.stripPreviousPasswordWrap(metadata));
      } catch {
        remaining += 1;
      }
    }
    return { remaining };
  }

  private async restoreMetadataSnapshots(
    snapshots: { folder: TFolder; metadata: FolderMetadata }[],
  ): Promise<string[]> {
    const failed: string[] = [];
    for (const snapshot of snapshots) {
      try {
        await this.writeMetadata(snapshot.folder.path, snapshot.metadata);
      } catch {
        failed.push(snapshot.folder.path);
      }
    }
    return failed;
  }

  async setupMasterPassword(password: string, recoveryKey?: string): Promise<string> {
    const store = this.requireMasterStore();
    if (store.load()) {
      throw new Error('Master password is already set. Use change instead.');
    }
    this.assertMasterPasswordStrength(password);
    const key = recoveryKey?.trim() ? recoveryKey.trim() : this.generateRecoveryKey();

    const salt = this.encryptionService.generateSalt();
    const { verifier, verifierIV } = await this.buildMasterVerifier(password, salt);
    const recoverySalt = this.encryptionService.generateSalt();
    const recoveryBuilt = await this.buildMasterVerifier(key, recoverySalt);

    const { encryptionKey } = await this.encryptionService.deriveSecretKeys(password, salt);
    const envelope = await this.encryptionService.encryptWithKey(new TextEncoder().encode(key).buffer, encryptionKey);

    const now = Date.now();
    const record: MasterPasswordRecord = {
      salt: this.metadataManager.arrayBufferToBase64(salt),
      verifier,
      verifierIV,
      iterations: MASTER_KDF_ITERATIONS,
      recoverySalt: this.metadataManager.arrayBufferToBase64(recoverySalt),
      recoveryVerifier: recoveryBuilt.verifier,
      recoveryVerifierIV: recoveryBuilt.verifierIV,
      recoveryKeyEnvelope: this.metadataManager.arrayBufferToBase64(envelope.ciphertext),
      recoveryKeyEnvelopeIV: this.metadataManager.arrayBufferToBase64(envelope.iv),
      createdAt: now,
      updatedAt: now,
    };
    await store.save(record);
    this.telemetry?.trackEvent('master_password_setup', {});
    return key;
  }

  /**
   * Rotates the master password and bulk re-wraps every master-kind folder.
   * Only the small wrapped-key blobs are re-encrypted; file contents are
   * untouched and folders may stay locked throughout.
   */
  async changeMasterPassword(oldPassword: string, newPassword: string): Promise<MasterPasswordChangeResult> {
    const store = this.requireMasterStore();
    const record = store.load();
    if (!record) {
      throw new Error('Master password is not set up.');
    }
    this.assertMasterPasswordStrength(newPassword);

    const oldSalt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.salt));
    const { encryptionKey: oldKey } = await this.encryptionService.deriveSecretKeys(oldPassword, oldSalt);
    if (!(await this.masterVerifierMatches(record, oldKey))) {
      throw new Error('Incorrect current master password.');
    }
    const recoveryKey = await this.decryptRecoveryEnvelope(record, oldKey);

    const summaries = await this.listFolderPasswordKinds();
    const masterPaths = summaries.filter((s) => s.kind === 'master').map((s) => s.path);

    // One salt for this rotation. Each wrap still uses a fresh IV.
    // Per-folder salts return on the next convert or custom-password change.
    const newSaltBytes = this.encryptionService.generateSalt();
    const newSalt = this.metadataManager.arrayBufferToBase64(newSaltBytes);
    const { encryptionKey: newKey, hmacKey: newHmac } = await this.encryptionService.deriveSecretKeys(
      newPassword,
      newSaltBytes,
    );

    const snapshots: { folder: TFolder; metadata: FolderMetadata }[] = [];
    const errors: { path: string; error: unknown }[] = [];
    const unrestoredWrites: string[] = [];
    for (const path of masterPaths) {
      const folder = this.fileService.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder)) {
        continue;
      }
      let metadata: FolderMetadata | null = null;
      try {
        metadata = await this.readMetadata(folder);
        if (!metadata) {
          throw new Error('Missing metadata.');
        }
        const snapshot = metadata;
        const { masterKeyRaw } = await this.getMasterKeyFromSecret(metadata, oldPassword, false);
        const rewrapped = await this.encryptionService.encryptWithKey(masterKeyRaw, newKey);
        const next: FolderMetadata = {
          ...metadata,
          salt: newSalt,
          iterations: MASTER_KDF_ITERATIONS,
          wrappedMasterKey: this.metadataManager.arrayBufferToBase64(rewrapped.ciphertext),
          masterKeyIV: this.metadataManager.arrayBufferToBase64(rewrapped.iv),
          previousSalt: metadata.salt,
          previousIterations: metadata.iterations,
          previousWrappedMasterKey: metadata.wrappedMasterKey,
          previousMasterKeyIV: metadata.masterKeyIV,
          previousMac: metadata.mac,
        };
        next.mac = await this.metadataManager.computeMetadataMacWithKey(next, newHmac);
        try {
          await this.writeMetadata(folder.path, next);
          snapshots.push({ folder, metadata: snapshot });
        } catch (writeError: unknown) {
          try {
            await this.writeMetadata(folder.path, snapshot);
          } catch (restoreError: unknown) {
            unrestoredWrites.push(path);
            this.debug('master rotation restore after failed write failed', { path, error: String(restoreError) });
          }
          throw writeError;
        }
      } catch (error: unknown) {
        errors.push({ path, error });
        this.debug('master rotation failed for folder', { path, error: String(error) });
      }
    }

    if (errors.length > 0) {
      const unrestored = [...unrestoredWrites, ...(await this.restoreMetadataSnapshots(snapshots))];
      const failedPaths = errors.map((entry) => entry.path).join(', ');
      const restoreNote =
        unrestored.length > 0
          ? ` Could not restore: ${unrestored.join(', ')}. The recovery key still opens those folders.`
          : ' Rewritten folders were restored.';
      throw new Error(`Master password was not changed. Failed: ${failedPaths}.${restoreNote}`);
    }

    const { verifier, verifierIV } = await this.encryptKnownPhrase(newKey, MASTER_VERIFIER_PHRASE);
    const envelope = await this.encryptionService.encryptWithKey(new TextEncoder().encode(recoveryKey).buffer, newKey);
    try {
      await store.save({
        ...record,
        salt: newSalt,
        verifier,
        verifierIV,
        iterations: MASTER_KDF_ITERATIONS,
        recoveryKeyEnvelope: this.metadataManager.arrayBufferToBase64(envelope.ciphertext),
        recoveryKeyEnvelopeIV: this.metadataManager.arrayBufferToBase64(envelope.iv),
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      const unrestored = await this.restoreMetadataSnapshots(snapshots);
      const reason = error instanceof Error ? error.message : String(error);
      const restoreNote =
        unrestored.length > 0
          ? ` Could not restore: ${unrestored.join(', ')}. The recovery key still opens those folders.`
          : ' Folder wraps were restored.';
      throw new Error(`Master password was not changed.${restoreNote} Settings save failed: ${reason}`);
    }

    const cleanup = await this.clearCommittedPreviousWraps();
    this.telemetry?.trackEvent('master_password_changed', { folder_count_bucket: bucketCount(masterPaths.length) });
    return {
      rotated: snapshots.length,
      total: masterPaths.length,
      previousWrapsRemaining: cleanup.remaining,
    };
  }

  async removeMasterPassword(password: string): Promise<void> {
    const store = this.requireMasterStore();
    const record = store.load();
    if (!record) {
      return;
    }
    if (!(await this.verifyMasterRecord(record, password))) {
      throw new Error('Incorrect master password.');
    }
    const summaries = await this.listFolderPasswordKinds();
    const remaining = summaries.filter((s) => s.kind === 'master');
    if (remaining.length > 0) {
      throw new Error(
        `Cannot remove the master password while ${remaining.length} folder(s) use it: ${remaining.map((s) => s.path).join(', ')}. Convert them to custom passwords first.`,
      );
    }
    await store.save(null);
    this.telemetry?.trackEvent('master_password_removed', {});
  }

  getFolderPasswordKind(metadata: FolderMetadata | null | undefined): FolderPasswordKind {
    return metadata?.passwordKind === 'master' ? 'master' : 'custom';
  }

  /** Public metadata read for UI flows (badges, kind checks). Fails closed. */
  async readFolderMetadata(folder: TFolder): Promise<FolderMetadata | null> {
    try {
      return await this.readMetadata(folder);
    } catch (error: unknown) {
      this.debug('readFolderMetadata failed', { folder: folder.path, error: String(error) });
      return null;
    }
  }

  /**
   * Verifies a secret against a folder without changing lock state.
   * Tries the password slot, then (for master folders) the shared
   * master-recovery slot, then the per-folder recovery slot.
   */
  async verifyFolderSecret(folder: TFolder, secret: string): Promise<boolean> {
    const metadata = await this.readFolderMetadata(folder);
    if (!metadata) {
      return false;
    }
    try {
      await this.getMasterKeyFromSecret(metadata, secret, false);
      return true;
    } catch {
      // Fall through to recovery slots.
    }
    if (this.getFolderPasswordKind(metadata) === 'master' && metadata.wrappedMasterKeyMasterRecovery) {
      try {
        await this.unwrapWithMasterRecovery(metadata, secret);
        return true;
      } catch {
        // Fall through to the per-folder recovery slot.
      }
    }
    try {
      await this.getMasterKeyFromSecret(metadata, secret, true);
      return true;
    } catch {
      return false;
    }
  }

  async listFolderPasswordKinds(): Promise<FolderPasswordSummary[]> {
    const summaries: FolderPasswordSummary[] = [];
    for (const path of Array.from(this.encryptedFolders)) {
      const folder = this.fileService.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder)) {
        continue;
      }
      let metadata: FolderMetadata | null = null;
      try {
        metadata = await this.readMetadata(folder);
      } catch {
        continue;
      }
      if (!metadata) {
        continue;
      }
      summaries.push({
        path,
        kind: this.getFolderPasswordKind(metadata),
        label: sanitizePasswordLabel(metadata.passwordLabel),
      });
    }
    summaries.sort((a, b) => a.path.localeCompare(b.path));
    return summaries;
  }

  // ---------------------------------------------------------------------------
  // Phase 2: convert / change / relabel
  // ---------------------------------------------------------------------------

  /**
   * Re-wraps an already-unwrapped folder key under a fresh password +
   * recovery pair and stamps kind/label. Shared master-recovery slots are
   * attached separately by the caller when needed.
   */
  private async rewrapFolderKeyWithPassword(
    metadata: FolderMetadata,
    masterKeyRaw: ArrayBuffer,
    password: string,
    recoveryKey: string,
    kind: FolderPasswordKind,
    label: string | undefined,
  ): Promise<FolderMetadata> {
    const salt = this.encryptionService.generateSalt();
    const { encryptionKey, hmacKey } = await this.encryptionService.deriveSecretKeys(password, salt);
    const wrapped = await this.encryptionService.encryptWithKey(masterKeyRaw, encryptionKey);

    const recoverySalt = this.encryptionService.generateSalt();
    const { encryptionKey: recoveryDerivedKey, hmacKey: recoveryHmac } = await this.encryptionService.deriveSecretKeys(
      recoveryKey,
      recoverySalt,
    );
    const recoveryWrapped = await this.encryptionService.encryptWithKey(masterKeyRaw, recoveryDerivedKey);

    const next: FolderMetadata = {
      ...metadata,
      salt: this.metadataManager.arrayBufferToBase64(salt),
      iterations: MASTER_KDF_ITERATIONS,
      wrappedMasterKey: this.metadataManager.arrayBufferToBase64(wrapped.ciphertext),
      masterKeyIV: this.metadataManager.arrayBufferToBase64(wrapped.iv),
      recoverySalt: this.metadataManager.arrayBufferToBase64(recoverySalt),
      wrappedMasterKeyRecovery: this.metadataManager.arrayBufferToBase64(recoveryWrapped.ciphertext),
      recoveryIV: this.metadataManager.arrayBufferToBase64(recoveryWrapped.iv),
      passwordKind: kind,
      passwordLabel: label,
    };
    next.mac = await this.metadataManager.computeMetadataMacWithKey(next, hmacKey);
    next.recoveryMac = await this.metadataManager.computeMetadataMacWithKey(next, recoveryHmac);
    return next;
  }

  private async attachSharedMasterRecovery(
    metadata: FolderMetadata,
    masterKeyRaw: ArrayBuffer,
    masterRecoveryKey: string,
  ): Promise<FolderMetadata> {
    const record = this.masterPasswordStore?.load();
    if (!record) {
      throw new Error('Master password is not set up.');
    }
    const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoverySalt));
    const { encryptionKey, hmacKey } = await this.encryptionService.deriveSecretKeys(masterRecoveryKey, salt);
    const wrapped = await this.encryptionService.encryptWithKey(masterKeyRaw, encryptionKey);
    const next: FolderMetadata = {
      ...metadata,
      wrappedMasterKeyMasterRecovery: this.metadataManager.arrayBufferToBase64(wrapped.ciphertext),
      masterRecoveryIV: this.metadataManager.arrayBufferToBase64(wrapped.iv),
    };
    next.masterRecoveryMac = await this.metadataManager.computeMetadataMacWithKey(next, hmacKey);
    return next;
  }

  /**
   * Unlock attempt that also accepts the shared master recovery key in the
   * main password box for master-kind folders. Dedicated recovery menus
   * should still use unlockFolder with isRecovery=true for explicitness.
   */
  async unlockFolderWithAutoDetect(
    folder: TFolder,
    secret: string,
    options?: FolderProcessingOptions,
    derivationCache?: KeyDerivationCache,
  ): Promise<boolean> {
    if (await this.unlockFolder(folder, secret, false, options, derivationCache)) {
      return true;
    }
    let metadata: FolderMetadata | null = null;
    try {
      metadata = await this.readMetadata(folder);
    } catch {
      return false;
    }
    if (!metadata || this.getFolderPasswordKind(metadata) !== 'master') {
      return false;
    }
    if (!metadata.wrappedMasterKeyMasterRecovery || !metadata.masterRecoveryIV) {
      return false;
    }
    const record = this.masterPasswordStore?.load();
    if (!record) {
      return false;
    }
    try {
      const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoverySalt));
      const { encryptionKey } = derivationCache
        ? await derivationCache.deriveSecretKeys(secret, salt)
        : await this.encryptionService.deriveSecretKeys(secret, salt);
      const wrappedMK = new Uint8Array(
        this.metadataManager.base64ToArrayBuffer(metadata.wrappedMasterKeyMasterRecovery),
      );
      const mkIV = new Uint8Array(this.metadataManager.base64ToArrayBuffer(metadata.masterRecoveryIV));
      const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, encryptionKey, mkIV);
      const masterKey = await this.encryptionService.importKey(masterKeyRaw, false);
      // Reuse the standard path for file decryption + state transitions by
      // re-entering unlock via a synthetic success: decrypt contents here.
      const lockedFiles = this.countLockedFiles(folder);
      const expectedLockedFiles = metadata.expectedLockedFiles;
      if (typeof expectedLockedFiles === 'number' && expectedLockedFiles > 0 && lockedFiles < expectedLockedFiles) {
        throw new Error(
          `Encrypted files are still syncing (${lockedFiles}/${expectedLockedFiles}). Please wait and try again.`,
        );
      }
      metadata = await this.transitionMetadataState(folder, metadata, 'unlocking');
      const decryptErrors = await this.decryptFolderContents(folder, masterKey, options);
      const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
      if (readmeFile) {
        await this.fileService.deleteFile(readmeFile);
      }
      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      this.recordActivityForPath(folder.path);
      const partialError =
        decryptErrors.length > 0
          ? `Partial decrypt: ${decryptErrors.length} file(s) could not be restored and remain locked: ${decryptErrors.map((e) => e.path).join(', ')}`
          : undefined;
      await this.transitionMetadataState(folder, metadata, 'unlocked', partialError);
      this.telemetry?.trackEvent('folder_unlocked', { via: 'master_recovery_auto', success: true });
      return true;
    } catch (error: unknown) {
      this.debug('master recovery auto-detect failed', { folder: folder.path, error: String(error) });
      return false;
    }
  }

  /**
   * Unwraps a folder key trying each slot in order: password, shared
   * master-recovery (master folders), per-folder recovery. Lets convert
   * and change flows accept whichever secret the user has.
   */
  private async unwrapFolderKeyAuto(metadata: FolderMetadata, secret: string): Promise<{ masterKeyRaw: ArrayBuffer }> {
    try {
      const { masterKeyRaw } = await this.getMasterKeyFromSecret(metadata, secret, false);
      return { masterKeyRaw };
    } catch {
      // Fall through to recovery slots.
    }
    if (this.getFolderPasswordKind(metadata) === 'master' && metadata.wrappedMasterKeyMasterRecovery) {
      try {
        return await this.unwrapWithMasterRecovery(metadata, secret);
      } catch {
        // Fall through to the per-folder recovery slot.
      }
    }
    const { masterKeyRaw } = await this.getMasterKeyFromSecret(metadata, secret, true);
    return { masterKeyRaw };
  }

  async convertToCustom(folder: TFolder, currentSecret: string, newPassword: string, label: string): Promise<string> {
    const metadata = await this.readMetadata(folder);
    if (!metadata) {
      throw new Error('Cannot convert folder without metadata.');
    }
    if (this.getFolderPasswordKind(metadata) !== 'master') {
      throw new Error('Folder does not use the master password.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    const cleanLabel = validateCustomPasswordLabel(label);

    const { masterKeyRaw } = await this.unwrapFolderKeyAuto(metadata, currentSecret);

    const newRecoveryKey = this.generateRecoveryKey();
    let next = await this.rewrapFolderKeyWithPassword(
      metadata,
      masterKeyRaw,
      newPassword,
      newRecoveryKey,
      'custom',
      cleanLabel,
    );
    next = {
      ...next,
      wrappedMasterKeyMasterRecovery: undefined,
      masterRecoveryIV: undefined,
      masterRecoveryMac: undefined,
    };
    await this.writeMetadata(folder.path, next);
    this.telemetry?.trackEvent('password_converted', { direction: 'to_custom' });
    return newRecoveryKey;
  }

  async convertToMaster(folder: TFolder, currentSecret: string, masterPassword: string): Promise<void> {
    const record = this.masterPasswordStore?.load();
    if (!record) {
      throw new Error('Master password is not set up.');
    }
    if (!(await this.verifyMasterRecord(record, masterPassword))) {
      throw new Error('Incorrect master password.');
    }
    const metadata = await this.readMetadata(folder);
    if (!metadata) {
      throw new Error('Cannot convert folder without metadata.');
    }
    if (this.getFolderPasswordKind(metadata) === 'master') {
      throw new Error('Folder already uses the master password.');
    }

    const { masterKeyRaw } = await this.unwrapFolderKeyAuto(metadata, currentSecret);

    const masterRecoveryKey = await this.unwrapMasterRecoveryKey(masterPassword);
    let next = await this.rewrapFolderKeyWithPassword(
      metadata,
      masterKeyRaw,
      masterPassword,
      // Per-folder recovery slot still exists as a fallback; the shared
      // master recovery slot is attached right after.
      this.generateRecoveryKey(),
      'master',
      undefined,
    );
    next = await this.attachSharedMasterRecovery(next, masterKeyRaw, masterRecoveryKey);
    await this.writeMetadata(folder.path, next);
    this.telemetry?.trackEvent('password_converted', { direction: 'to_master' });
  }

  async changeCustomPassword(folder: TFolder, currentSecret: string, newPassword: string): Promise<string> {
    const metadata = await this.readMetadata(folder);
    if (!metadata) {
      throw new Error('Cannot change password without metadata.');
    }
    if (this.getFolderPasswordKind(metadata) !== 'custom') {
      throw new Error('Folder uses the master password. Convert it to a custom password first.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    const { masterKeyRaw } = await this.unwrapFolderKeyAuto(metadata, currentSecret);
    const newRecoveryKey = this.generateRecoveryKey();
    const next = await this.rewrapFolderKeyWithPassword(
      metadata,
      masterKeyRaw,
      newPassword,
      newRecoveryKey,
      'custom',
      sanitizePasswordLabel(metadata.passwordLabel),
    );
    await this.writeMetadata(folder.path, next);
    this.telemetry?.trackEvent('custom_password_changed', {});
    return newRecoveryKey;
  }

  /**
   * Renames a custom password's title. No crypto involved. Requires the
   * current secret when the folder is locked so labels cannot be rewritten
   * without proving access.
   */
  async relabelFolder(folder: TFolder, label: string, currentSecret?: string): Promise<void> {
    const metadata = await this.readMetadata(folder);
    if (!metadata) {
      throw new Error('Cannot relabel folder without metadata.');
    }
    if (this.getFolderPasswordKind(metadata) !== 'custom') {
      throw new Error('Only custom passwords have titles. Master password folders need no label.');
    }
    const cleanLabel = validateCustomPasswordLabel(label);
    if (!this.isUnlocked(folder)) {
      if (!currentSecret) {
        throw new Error('Password is required to relabel a locked folder.');
      }
      const verified = await this.verifyFolderSecret(folder, currentSecret);
      if (!verified) {
        throw new Error('Authentication failed: Invalid password');
      }
    }
    await this.writeMetadata(folder.path, { ...metadata, passwordLabel: cleanLabel });
    this.telemetry?.trackEvent('password_relabelled', {});
  }

  private async unwrapWithMasterRecovery(
    metadata: FolderMetadata,
    recoveryKey: string,
  ): Promise<{ masterKeyRaw: ArrayBuffer }> {
    const record = this.masterPasswordStore?.load();
    if (!record || !metadata.wrappedMasterKeyMasterRecovery || !metadata.masterRecoveryIV) {
      throw new Error('Master recovery is not available for this folder.');
    }
    const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(record.recoverySalt));
    const { encryptionKey } = await this.encryptionService.deriveSecretKeys(recoveryKey, salt);
    const wrappedMK = new Uint8Array(this.metadataManager.base64ToArrayBuffer(metadata.wrappedMasterKeyMasterRecovery));
    const mkIV = new Uint8Array(this.metadataManager.base64ToArrayBuffer(metadata.masterRecoveryIV));
    const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, encryptionKey, mkIV).catch(() => {
      throw new Error('Authentication failed: Invalid recovery key');
    });
    return { masterKeyRaw };
  }

  async encryptFolderContents(folder: TFolder, key: CryptoKey, options?: FolderProcessingOptions): Promise<number> {
    const files = this.batchProcessor.collectProcessableFiles(folder, 'encrypt');
    const processedFiles: { originalPath: string; lockedPath: string }[] = [];

    try {
      const results = await this.batchProcessor.processFilesWithLimits(
        folder,
        'encrypt',
        files,
        options,
        async (file) => {
          const lockedPath = normalizePath(file.path + this.LOCKED_EXTENSION);
          const encrypted = await this.encryptFile(file, key);
          if (encrypted) {
            processedFiles.push({ originalPath: file.path, lockedPath });
          }
          return encrypted;
        },
      );
      return results.filter(Boolean).length;
    } catch (error: unknown) {
      this.debug('Encryption failed mid-process, attempting rollback', { error, processedFiles });
      await this.rollbackEncryption(processedFiles, key);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async rollbackEncryption(
    processedFiles: { originalPath: string; lockedPath: string }[],
    key: CryptoKey,
  ): Promise<void> {
    for (const file of processedFiles) {
      try {
        const lockedFile = this.fileService.getFile(file.lockedPath);
        if (lockedFile) {
          const data = await this.fileService.readBinary(lockedFile);
          const { iv, ciphertext } = this.splitMagicBuffer(data);
          const plaintext = await this.encryptionService.decryptWithKey(
            this.toBufferView(ciphertext),
            key,
            this.toBufferView(iv),
          );
          await this.fileService.writeBinary(file.originalPath, plaintext);
          await this.fileService.deleteFile(lockedFile);
        }

        const tmpPath = normalizePath(`${file.originalPath}${this.LOCKED_EXTENSION}.tmp`);
        const tmpFile = this.fileService.getFile(tmpPath);
        if (tmpFile) {
          await this.fileService.deleteFile(tmpFile);
        }
      } catch (rollbackError: unknown) {
        this.debug('Rollback failed for file', { path: file.originalPath, rollbackError });
      }
    }
  }

  async decryptFolderContents(
    folder: TFolder,
    key: CryptoKey,
    options?: FolderProcessingOptions,
  ): Promise<{ path: string; error: unknown }[]> {
    const files = this.batchProcessor.collectProcessableFiles(folder, 'decrypt');
    const errors: { path: string; error: unknown }[] = [];

    await this.batchProcessor.processFilesWithLimits(folder, 'decrypt', files, options, async (file) => {
      try {
        await this.decryptFile(file, key);
      } catch (error: unknown) {
        this.debug('File decryption error', { path: file.path, error });
        errors.push({ path: file.path, error });
      }
    });

    if (errors.length > 0) {
      this.debug('Folder decryption finished with individual file errors', {
        count: errors.length,
        total: files.length,
      });
      if (errors.length === files.length) {
        const firstErr = errors[0].error;
        throw firstErr instanceof Error
          ? firstErr
          : new Error(`Failed to decrypt all ${files.length} files in folder.`);
      }
    }
    return errors;
  }

  async encryptFile(file: TFile, key: CryptoKey): Promise<boolean> {
    this.assertProcessableSize(file);
    const data = await this.fileService.readBinary(file);
    if (this.hasMagic(data)) {
      return false;
    }

    const result = await this.encryptionService.encryptWithKey(data, key);
    const combined = this.combineBuffersWithMagic(result.iv, result.ciphertext);
    const tmpPath = normalizePath(`${file.path}${this.LOCKED_EXTENSION}.tmp`);
    const finalPath = normalizePath(`${file.path}${this.LOCKED_EXTENSION}`);

    const tmpFile = await this.fileService.writeBinary(tmpPath, combined);
    // Size check instead of a full read-back: catches truncation without
    // spending a second read per file.
    if (tmpFile.stat.size !== combined.byteLength) {
      await this.deleteFileIfExists(tmpPath);
      throw new Error(`Staging write integrity check failed for file ${file.path}`);
    }

    try {
      // Promote by rename: avoids rewriting the same ciphertext bytes and
      // keeps staging atomicity (tmp exists until the rename completes).
      await this.fileService.renameFile(tmpFile, finalPath);
    } finally {
      // Staging file must never leak, including when the rename throws.
      await this.deleteFileIfExists(tmpPath);
    }

    await this.fileService.shredFile(file);
    return true;
  }

  private async deleteFileIfExists(path: string): Promise<void> {
    const existing = this.fileService.getFile(path);
    if (existing) {
      await this.fileService.deleteFile(existing);
    }
  }

  async decryptFile(file: TFile, key: CryptoKey): Promise<void> {
    this.assertProcessableSize(file);
    const data = await this.fileService.readBinary(file);
    if (!this.hasMagic(data)) {
      return;
    }

    let iv: Uint8Array | undefined;
    let ciphertext: Uint8Array | undefined;
    try {
      ({ iv, ciphertext } = this.splitMagicBuffer(data));
      const plaintext = await this.encryptionService.decryptWithKey(
        this.toBufferView(ciphertext),
        key,
        this.toBufferView(iv),
      );

      let newPath = file.path;
      if (newPath.endsWith(this.LOCKED_EXTENSION)) {
        newPath = newPath.slice(0, -this.LOCKED_EXTENSION.length);
      } else {
        newPath = `${newPath}.decrypted`;
      }

      await this.fileService.writeBinary(newPath, plaintext);
      await this.fileService.deleteFile(file);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errorMsg =
        `Failed to decrypt file: ${file.path}\n` +
        `  Error: ${err.name} - ${err.message}\n` +
        `  File Size: ${data.byteLength}\n` +
        `  IV Length: ${iv?.byteLength ?? 0}\n` +
        `  Ciphertext Length: ${ciphertext?.byteLength ?? 0}`;
      this.debug(errorMsg);
      throw new Error(errorMsg);
    }
  }

  private assertProcessableSize(file: TFile): void {
    const size = Math.max(0, file.stat?.size ?? 0);
    if (size > this.MAX_PROCESSABLE_BYTES) {
      const sizeMb = (size / (1024 * 1024)).toFixed(1);
      const limitMb = this.MAX_PROCESSABLE_BYTES / (1024 * 1024);
      throw new Error(
        `File ${file.path} is ${sizeMb} MB, above the ${limitMb} MB per-file limit. ` +
          'Split the file into smaller notes to encrypt it.',
      );
    }
  }

  private readonly MAGIC = 'ENC!';
  private readonly MAGIC_BYTES = new TextEncoder().encode(this.MAGIC);

  private hasMagic(data: ArrayBuffer): boolean {
    if (data.byteLength < 4) {
      return false;
    }
    const view = new Uint8Array(data, 0, 4);
    return (
      view[0] === this.MAGIC_BYTES[0] &&
      view[1] === this.MAGIC_BYTES[1] &&
      view[2] === this.MAGIC_BYTES[2] &&
      view[3] === this.MAGIC_BYTES[3]
    );
  }

  private combineBuffersWithMagic(iv: Uint8Array, ciphertext: ArrayBuffer): ArrayBuffer {
    const tmp = new Uint8Array(this.MAGIC_BYTES.length + iv.byteLength + ciphertext.byteLength);
    tmp.set(this.MAGIC_BYTES, 0);
    tmp.set(iv, this.MAGIC_BYTES.length);
    tmp.set(new Uint8Array(ciphertext), this.MAGIC_BYTES.length + iv.byteLength);
    return tmp.buffer;
  }

  private splitMagicBuffer(data: ArrayBuffer): { iv: Uint8Array; ciphertext: Uint8Array } {
    const headerOffset = this.MAGIC_BYTES.length;
    const ivOffset = headerOffset + 12;

    if (data.byteLength < ivOffset) {
      throw new Error(
        `Encrypted file is truncated or corrupt: expected at least ${ivOffset} bytes, found ${data.byteLength}.`,
      );
    }

    const fullView = new Uint8Array(data);
    const iv = fullView.slice(headerOffset, ivOffset);
    const ciphertext = fullView.slice(ivOffset);

    return { iv, ciphertext };
  }

  private combineBuffers(iv: Uint8Array, ciphertext: ArrayBuffer): ArrayBuffer {
    const tmp = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    tmp.set(iv, 0);
    tmp.set(new Uint8Array(ciphertext), iv.byteLength);
    return tmp.buffer;
  }

  private toBufferView(view: Uint8Array): Uint8Array<ArrayBuffer> {
    return new Uint8Array(view);
  }

  private async scanAdapterTree(basePath: string, discovered: Set<string>): Promise<void> {
    const result = await this.fileService.list(basePath);

    for (const filePath of result.files) {
      if (filePath.endsWith(`/${this.META_FILE_NAME}`)) {
        const folderPath = normalizePath(filePath.slice(0, -`/${this.META_FILE_NAME}`.length));
        discovered.add(this.toFolderKey(folderPath));
      }
    }

    for (const folderPath of result.folders) {
      await this.scanAdapterTree(folderPath, discovered);
    }
  }

  async syncFolders(retries = 3, retryDelayMs = 300, forceFullScan = false): Promise<void> {
    const discovered = new Set<string>();

    const indexedFiles = this.fileService.getFiles();
    for (const file of indexedFiles) {
      if (file.name === this.META_FILE_NAME) {
        discovered.add(this.toFolderKey(file.parent?.path ?? ''));
      }
    }

    // The adapter tree walk catches meta files the index hasn't picked up
    // yet (slow sync/index lag), but costs a request per folder. Run it on
    // structural events, when the index found nothing, or when the last
    // full scan is stale — not on every debounced event.
    const fullScanStale = Date.now() - this.lastFullScanAt > this.FULL_SCAN_STALE_MS;
    if (forceFullScan || fullScanStale || discovered.size === 0) {
      try {
        await this.scanAdapterTree('', discovered);
      } catch (error: unknown) {
        this.debug('adapter scan failed', error);
      }
      this.lastFullScanAt = Date.now();
    }

    this.encryptedFolders = new Set(Array.from(discovered).filter((value) => value.length > 0));
    this.encryptedParentCache.clear();

    if (this.encryptedFolders.size === 0 && retries > 1) {
      await this.sleep(retryDelayMs);
      await this.syncFolders(retries - 1, retryDelayMs, forceFullScan);
      return;
    }

    await this.clearCommittedPreviousWraps();

    this.debug('syncFolders complete', { discovered: this.encryptedFolders.size });
  }

  isEncryptedFolder(folder: TFolder): boolean {
    const folderKey = this.toFolderKey(folder.path);
    if (this.encryptedFolders.has(folderKey)) {
      return true;
    }

    const metaPath = this.metadataManager.getMetaPath(folder.path);
    const exists = this.fileService.exists(metaPath);

    if (exists) {
      this.encryptedFolders.add(folderKey);
      return true;
    }

    return false;
  }

  getEncryptedParent(file: TFile | TFolder): TFolder | null {
    const cacheKey = this.toFolderKey(file.path);
    const cached = this.encryptedParentCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let parent = file.parent;
    while (parent) {
      const metaPath = this.metadataManager.getMetaPath(parent.path);
      if (this.fileService.getFile(metaPath)) {
        this.encryptedParentCache.set(cacheKey, parent);
        return parent;
      }
      parent = parent.parent;
    }
    this.encryptedParentCache.set(cacheKey, null);
    return null;
  }

  /**
   * Drops memoized encrypted-parent lookups. Called on any structural
   * vault change (create/delete/rename) and after internal mutations;
   * lookups between structural events are pure reads.
   */
  invalidateEncryptedParentCache(): void {
    this.encryptedParentCache.clear();
  }

  isInsideEncryptedFolder(file: TFile | TFolder): boolean {
    return this.getEncryptedParent(file) !== null;
  }

  private async getMasterKeyFromSecret(
    metadata: FolderMetadata,
    secret: string,
    isRecovery: boolean,
    cache?: KeyDerivationCache,
  ): Promise<{ masterKey: CryptoKey; hmacKey: CryptoKey; masterKeyRaw: ArrayBuffer }> {
    try {
      return await this.unwrapMasterKeySlot(metadata, secret, isRecovery, cache);
    } catch (error: unknown) {
      if (isRecovery || !this.hasPreviousPasswordWrap(metadata)) {
        throw error;
      }
      // The current wrap was rewritten during a master-password rotation
      // whose settings save or cleanup has not finished. The previous wrap
      // still opens the folder with the old password.
      return await this.unwrapMasterKeySlot(this.metadataWithPreviousWrap(metadata), secret, false, cache);
    }
  }

  private async unwrapMasterKeySlot(
    metadata: FolderMetadata,
    secret: string,
    isRecovery: boolean,
    cache?: KeyDerivationCache,
  ): Promise<{ masterKey: CryptoKey; hmacKey: CryptoKey; masterKeyRaw: ArrayBuffer }> {
    const encodedSalt = isRecovery ? metadata.recoverySalt : metadata.salt;
    const wrappedMaster = isRecovery ? metadata.wrappedMasterKeyRecovery : metadata.wrappedMasterKey;
    const wrappedIV = isRecovery ? metadata.recoveryIV : metadata.masterKeyIV;

    if (!encodedSalt || !wrappedMaster || !wrappedIV) {
      throw new Error('Metadata is missing required key material.');
    }

    const salt = new Uint8Array(this.metadataManager.base64ToArrayBuffer(encodedSalt));
    // Single PBKDF2 execution split into wrapping + MAC keys (previously two).
    const { encryptionKey, hmacKey } = cache
      ? await cache.deriveSecretKeys(secret, salt)
      : await this.encryptionService.deriveSecretKeys(secret, salt);

    const isValidMac = await this.metadataManager.verifyMetadataMacWithKey(metadata, hmacKey, isRecovery);
    if (!isValidMac) {
      throw new Error('Authentication failed: Metadata tampering detected');
    }

    const wrappedMK = new Uint8Array(this.metadataManager.base64ToArrayBuffer(wrappedMaster));
    const mkIV = new Uint8Array(this.metadataManager.base64ToArrayBuffer(wrappedIV));

    const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, encryptionKey, mkIV).catch(() => {
      throw new Error('Authentication failed: Invalid key');
    });
    const masterKey = await this.encryptionService.importKey(masterKeyRaw, false);

    const tokenData = new Uint8Array(this.metadataManager.base64ToArrayBuffer(metadata.testToken));
    const iv = tokenData.slice(0, 12);
    const ciphertext = tokenData.slice(12);

    const resultBuffer = await this.encryptionService.decryptWithKey(ciphertext, masterKey, iv).catch(() => {
      throw new Error('Authentication failed: Verification failed');
    });
    const resultStr = new TextDecoder().decode(resultBuffer);

    if (resultStr !== 'OBSIDIAN_ENCRYPTED_VERIFICATION') {
      throw new Error('Authentication failed: Token mismatch');
    }

    return { masterKey, hmacKey, masterKeyRaw };
  }

  /**
   * Computes and attaches a missing metadata MAC after the secret has been
   * proven valid (wrapped-key + testToken decrypt succeeded). Migrates
   * legacy MAC-less metadata forward without locking out existing users.
   */
  private async migrateMissingMac(
    metadata: FolderMetadata,
    hmacKey: CryptoKey,
    isRecovery: boolean,
  ): Promise<FolderMetadata> {
    const needsPasswordMac = !isRecovery && !metadata.mac;
    const needsRecoveryMac = isRecovery && !metadata.recoveryMac;
    if (!needsPasswordMac && !needsRecoveryMac) {
      return metadata;
    }
    try {
      const mac = await this.metadataManager.computeMetadataMacWithKey(metadata, hmacKey);
      const migrated = isRecovery ? { ...metadata, recoveryMac: mac } : { ...metadata, mac };
      this.debug('migrated missing metadata MAC', { isRecovery });
      return migrated;
    } catch (error: unknown) {
      this.debug('MAC migration skipped', { error: String(error) });
      return metadata;
    }
  }

  async unlockFolder(
    folder: TFolder,
    secret: string,
    isRecovery = false,
    options?: FolderProcessingOptions,
    derivationCache?: KeyDerivationCache,
  ): Promise<boolean> {
    const refused = (reason: string): false => {
      this.debug(reason, { folder: folder.path });
      this.telemetry?.trackEvent('folder_unlocked', {
        via: isRecovery ? 'recovery' : 'password',
        success: false,
      });
      return false;
    };

    let metadata;
    try {
      metadata = await this.readMetadata(folder);
    } catch (error: unknown) {
      // Corrupt/unsupported metadata fails closed: refuse to unlock.
      this.debug('unlock refused: unreadable metadata', { folder: folder.path, error: String(error) });
      this.telemetry?.trackEvent('error', { area: 'metadata' });
      return false;
    }
    if (!metadata) {
      return refused('unlock refused: missing metadata');
    }

    await this.reconcileFolderState(folder);
    try {
      metadata = await this.readMetadata(folder);
    } catch (error: unknown) {
      this.debug('unlock refused: unreadable metadata', { folder: folder.path, error: String(error) });
      this.telemetry?.trackEvent('error', { area: 'metadata' });
      return false;
    }
    if (!metadata) {
      return refused('unlock refused: missing metadata');
    }

    try {
      const lockedFiles = this.countLockedFiles(folder);
      const expectedLockedFiles = metadata.expectedLockedFiles;
      if (typeof expectedLockedFiles === 'number' && expectedLockedFiles > 0 && lockedFiles < expectedLockedFiles) {
        throw new Error(
          `Encrypted files are still syncing (${lockedFiles}/${expectedLockedFiles}). Please wait and try again.`,
        );
      }

      metadata = await this.transitionMetadataState(folder, metadata, 'unlocking');

      const { masterKey, hmacKey } = await this.getMasterKeyFromSecret(metadata, secret, isRecovery, derivationCache);

      const decryptErrors = await this.decryptFolderContents(folder, masterKey, options);

      const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
      if (readmeFile) {
        await this.fileService.deleteFile(readmeFile);
      }

      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      this.recordActivityForPath(folder.path);
      metadata = await this.migrateMissingMac(metadata, hmacKey, isRecovery);
      // Partial failures leave restorable files behind as .locked; record
      // them on the unlocked state instead of silently reporting success.
      const partialError =
        decryptErrors.length > 0
          ? `Partial decrypt: ${decryptErrors.length} file(s) could not be restored and remain locked: ${decryptErrors
              .map((e) => e.path)
              .join(', ')}`
          : undefined;
      await this.transitionMetadataState(folder, metadata, 'unlocked', partialError);
      this.debug('folder unlocked', { folder: folder.path, isRecovery });
      this.telemetry?.trackEvent('folder_unlocked', {
        via: isRecovery ? 'recovery' : 'password',
        success: true,
      });
      return true;
    } catch (error: unknown) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      this.debug('unlock error', { folder: folder.path, error });
      this.telemetry?.trackEvent('folder_unlocked', {
        via: isRecovery ? 'recovery' : 'password',
        success: false,
      });
      return false;
    }
  }

  async reprocessLockedFolder(
    folder: TFolder,
    secret: string,
    isRecovery = false,
    options?: FolderProcessingOptions,
    derivationCache?: KeyDerivationCache,
  ): Promise<boolean> {
    if (!this.isEncryptedFolder(folder) || this.isUnlocked(folder)) {
      return false;
    }

    let metadata;
    try {
      metadata = await this.readMetadata(folder);
    } catch (error: unknown) {
      this.debug('reprocess refused: unreadable metadata', { folder: folder.path, error: String(error) });
      return false;
    }
    if (!metadata) {
      return false;
    }

    await this.reconcileFolderState(folder);
    try {
      metadata = await this.readMetadata(folder);
    } catch (error: unknown) {
      this.debug('reprocess refused: unreadable metadata', { folder: folder.path, error: String(error) });
      return false;
    }
    if (!metadata) {
      return false;
    }

    const plaintextFiles = this.getPlaintextFilesInLockedFolder(folder);
    if (plaintextFiles.length === 0) {
      return true;
    }

    try {
      const { masterKey } = await this.getMasterKeyFromSecret(metadata, secret, isRecovery, derivationCache);
      const results = await this.batchProcessor.processFilesWithLimits(
        folder,
        'encrypt',
        plaintextFiles,
        options,
        async (file) => {
          const currentFile = this.fileService.getFile(file.path);
          if (!currentFile) {
            return false;
          }

          return await this.encryptFile(currentFile, masterKey);
        },
      );

      if (!this.fileService.exists(this.getReadmePath(folder.path))) {
        await this.fileService.writeBinary(
          this.getReadmePath(folder.path),
          new TextEncoder().encode(this.buildReadmeContent(folder)).buffer,
        );
      }

      await this.writeMetadata(folder.path, {
        ...metadata,
        expectedLockedFiles: this.countLockedFiles(folder),
        state: 'locked',
        lastTransitionAt: Date.now(),
        lastError: undefined,
      });

      this.debug('locked folder reprocessed', { folder: folder.path, encryptedAny: results.some(Boolean) });
      return true;
    } catch (error: unknown) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      this.debug('locked folder reprocess error', { folder: folder.path, error });
      return false;
    }
  }

  async lockFolder(folder: TFolder, options?: FolderProcessingOptions, via: FolderLockVia = 'manual'): Promise<void> {
    const folderKey = this.toFolderKey(folder.path);
    const key = this.unlockedFolders.get(folderKey);
    if (!key) {
      return;
    }

    let metadata = await this.readMetadata(folder);
    if (!metadata) {
      throw new Error('Cannot lock folder without metadata.');
    }

    metadata = await this.transitionMetadataState(folder, metadata, 'locking');

    try {
      const encryptedCount = await this.encryptFolderContents(folder, key, options);
      metadata = {
        ...metadata,
        expectedLockedFiles: encryptedCount,
      };
      await this.fileService.writeBinary(
        this.getReadmePath(folder.path),
        new TextEncoder().encode(this.buildReadmeContent(folder)).buffer,
      );
      this.unlockedFolders.delete(folderKey);
      this.autoLockManager.removePath(folderKey);
      await this.transitionMetadataState(folder, metadata, 'locked');
      this.debug('folder locked', { folder: folder.path });
      this.telemetry?.trackEvent('folder_locked', {
        via,
        file_count_bucket: bucketCount(encryptedCount),
      });
    } catch (error: unknown) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async lockAllFolders(options?: FolderProcessingOptions, via: FolderLockVia = 'manual'): Promise<void> {
    await this.lockTrackedFolders(undefined, options, via);
    this.unlockedFolders.clear();
  }

  isUnlocked(folder: TFolder): boolean {
    return this.unlockedFolders.has(this.toFolderKey(folder.path));
  }

  updatePath(oldPath: string, newPath: string): void {
    const oldKey = this.toFolderKey(oldPath);
    const newKey = this.toFolderKey(newPath);

    const key = this.unlockedFolders.get(oldKey);
    if (key) {
      this.unlockedFolders.set(newKey, key);
      this.unlockedFolders.delete(oldKey);
    }

    this.autoLockManager.updatePath(oldKey, newKey);

    if (this.encryptedFolders.has(oldKey)) {
      this.encryptedFolders.delete(oldKey);
      this.encryptedFolders.add(newKey);
    }
    this.encryptedParentCache.clear();
  }

  removePath(path: string): void {
    const key = this.toFolderKey(path);
    this.unlockedFolders.delete(key);
    this.autoLockManager.removePath(key);
    this.encryptedFolders.delete(key);
    this.encryptedParentCache.clear();
  }

  async removeEncryption(folder: TFolder, password?: string, isRecovery = false): Promise<boolean> {
    if (!this.isUnlocked(folder)) {
      if (!password) {
        throw new Error('Password is required to decrypt and remove encryption.');
      }
      const unlocked = await this.unlockFolder(folder, password, isRecovery);
      if (!unlocked) {
        return false;
      }
    }

    const remainingLocked = this.countLockedFiles(folder);
    if (remainingLocked > 0) {
      throw new Error(
        `Cannot remove encryption while ${remainingLocked} encrypted file(s) remain. Restore or repair them, then try again.`,
      );
    }

    const metaFile = this.fileService.getFile(this.metadataManager.getMetaPath(folder.path));
    if (metaFile) {
      await this.fileService.deleteFile(metaFile);
    }

    const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
    if (readmeFile) {
      await this.fileService.deleteFile(readmeFile);
    }

    this.unlockedFolders.delete(this.toFolderKey(folder.path));
    this.autoLockManager.removePath(this.toFolderKey(folder.path));
    this.encryptedFolders.delete(this.toFolderKey(folder.path));
    this.encryptedParentCache.clear();
    this.telemetry?.trackEvent('encryption_removed', {});

    return true;
  }
}

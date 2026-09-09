import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
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

export interface FolderServiceDeps {
  metadataManager?: MetadataManager;
  autoLockManager?: AutoLockManager;
  batchProcessor?: BatchProcessor;
  telemetry?: TelemetrySink;
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
  ): Promise<string> {
    if (this.isInsideEncryptedFolder(folder)) {
      throw new Error('Nested encryption is not allowed. A parent folder is already encrypted.');
    }

    const recoveryKey = this.generateRecoveryKey();
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
      schemaVersion: 2,
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
      state: lockImmediately ? 'locking' : 'unlocked',
      lastTransitionAt: Date.now(),
    };

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
      file_count_bucket:
        lockImmediately && typeof metadata.expectedLockedFiles === 'number'
          ? bucketCount(metadata.expectedLockedFiles)
          : 'pending',
    });
    return recoveryKey;
  }

  private generateRecoveryKey(): string {
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
  ): Promise<{ masterKey: CryptoKey; hmacKey: CryptoKey }> {
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

    return { masterKey, hmacKey };
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

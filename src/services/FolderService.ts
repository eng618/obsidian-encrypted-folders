import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export interface AutoLockSettings {
  idleMinutes: number;
  lockOnBackground: boolean;
}

export interface IdleLockCountdown {
  folderPath: string;
  lastActivityAt: number;
  locksAt: number;
  remainingMs: number;
  isExpired: boolean;
}

export type FolderProcessingOperation = 'encrypt' | 'decrypt';
export type FolderProcessingStatus = 'preparing' | 'processing' | 'complete' | 'error';

export interface FolderProcessingProgress {
  operation: FolderProcessingOperation;
  status: FolderProcessingStatus;
  folderPath: string;
  totalFiles: number;
  processedFiles: number;
  currentFilePath?: string;
}

export interface FolderProcessingOptions {
  onProgress?: (progress: FolderProcessingProgress) => void;
  maxConcurrentFiles?: number;
  maxConcurrentBytes?: number;
  signal?: AbortSignal;
}

export class FolderService {
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private encryptedFolders: Set<string> = new Set();
  private syncDebounceTimer: number | null = null;
  private unlockedFolderActivityAt: Map<string, number> = new Map();
  private autoLockInProgress = false;
  private autoLockSettings: AutoLockSettings = {
    idleMinutes: 5,
    lockOnBackground: true,
  };
  private debugLogging = false;

  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly LOCKED_EXTENSION = '.locked';
  private readonly META_SCHEMA_VERSION = 2;
  private readonly README_FILE_NAME = 'README_ENCRYPTED.md';
  private readonly DEFAULT_MAX_CONCURRENT_FILES = 3;
  private readonly DEFAULT_MAX_CONCURRENT_BYTES = 64 * 1024 * 1024;

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
    private app: App,
  ) {}

  setDebugLogging(enabled: boolean): void {
    this.debugLogging = enabled;
  }

  setAutoLockSettings(settings: AutoLockSettings): void {
    this.autoLockSettings = {
      idleMinutes: Number.isFinite(settings.idleMinutes) ? Math.max(0, Math.floor(settings.idleMinutes)) : 0,
      lockOnBackground: Boolean(settings.lockOnBackground),
    };
  }

  recordActivityForPath(path: string, timestamp = Date.now()): void {
    const folderKey = this.toFolderKey(path);
    if (!this.unlockedFolders.has(folderKey)) {
      return;
    }

    this.unlockedFolderActivityAt.set(folderKey, timestamp);
  }

  recordActivityForItem(item: TFile | TFolder | null, timestamp = Date.now()): void {
    if (!item) {
      return;
    }

    const folderKey = this.getTrackedFolderKey(item);
    if (!folderKey) {
      return;
    }

    this.unlockedFolderActivityAt.set(folderKey, timestamp);
  }

  getUnlockedFolderPaths(): string[] {
    return Array.from(this.unlockedFolders.keys());
  }

  requestSyncFolders(reason = 'event'): void {
    if (this.syncDebounceTimer) {
      window.clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = window.setTimeout(() => {
      this.syncDebounceTimer = null;
      void this.syncFolders(4, 300).catch((error: unknown) => {
        this.debug('syncFolders failed after request', { reason, error });
      });
    }, 250);
  }

  private debug(message: string, data?: unknown): void {
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getMetaPath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.META_FILE_NAME}`);
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

  private getIdleTimeoutMs(): number | null {
    if (this.autoLockSettings.idleMinutes <= 0) {
      return null;
    }

    return this.autoLockSettings.idleMinutes * 60 * 1000;
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

  private getExpiredUnlockedFolderPaths(timestamp: number): string[] {
    const idleTimeoutMs = this.getIdleTimeoutMs();
    if (idleTimeoutMs === null) {
      return [];
    }

    return Array.from(this.unlockedFolders.keys()).filter((folderKey) => {
      const lastActivityAt = this.unlockedFolderActivityAt.get(folderKey);
      if (lastActivityAt === undefined) {
        return false;
      }

      return timestamp - lastActivityAt >= idleTimeoutMs;
    });
  }

  getIdleLockCountdowns(timestamp = Date.now()): IdleLockCountdown[] {
    const idleTimeoutMs = this.getIdleTimeoutMs();
    if (idleTimeoutMs === null) {
      return [];
    }

    return Array.from(this.unlockedFolders.keys())
      .map((folderPath) => {
        const lastActivityAt = this.unlockedFolderActivityAt.get(folderPath);
        if (lastActivityAt === undefined) {
          return null;
        }

        const locksAt = lastActivityAt + idleTimeoutMs;
        return {
          folderPath,
          lastActivityAt,
          locksAt,
          remainingMs: Math.max(0, locksAt - timestamp),
          isExpired: timestamp >= locksAt,
        };
      })
      .filter((countdown): countdown is IdleLockCountdown => countdown !== null)
      .sort((a, b) => a.locksAt - b.locksAt);
  }

  getNextIdleLockCountdown(timestamp = Date.now()): IdleLockCountdown | null {
    return this.getIdleLockCountdowns(timestamp)[0] ?? null;
  }

  private async lockTrackedFolders(folderPaths?: string[], options?: FolderProcessingOptions): Promise<boolean> {
    let lockedAny = false;
    const paths = folderPaths ?? Array.from(this.unlockedFolders.keys());

    for (const path of paths) {
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) {
        await this.lockFolder(folder, options);
        lockedAny = true;
        continue;
      }

      this.unlockedFolders.delete(path);
      this.unlockedFolderActivityAt.delete(path);
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
      const locked = await this.lockTrackedFolders(paths);
      if (locked) {
        this.debug('folders auto-locked', { reason });
      }
      return locked;
    } finally {
      this.autoLockInProgress = false;
    }
  }

  async runBackgroundAutoLock(): Promise<boolean> {
    if (!this.autoLockSettings.lockOnBackground) {
      return false;
    }

    return this.runAutoLock('background');
  }

  async runIdleAutoLock(timestamp = Date.now()): Promise<boolean> {
    const expiredPaths = this.getExpiredUnlockedFolderPaths(timestamp);
    if (expiredPaths.length === 0) {
      return false;
    }

    return this.runAutoLock('idle', expiredPaths);
  }

  private ensureCurrentSchema(metadata: FolderMetadata): FolderMetadata {
    if (metadata.schemaVersion && metadata.schemaVersion >= this.META_SCHEMA_VERSION) {
      return metadata;
    }

    return {
      ...metadata,
      schemaVersion: this.META_SCHEMA_VERSION,
      state: metadata.state ?? 'locked',
      lastTransitionAt: Date.now(),
      lastError: undefined,
    };
  }

  private async readMetadata(folder: TFolder): Promise<FolderMetadata | null> {
    const metaFile = this.fileService.getFile(this.getMetaPath(folder.path));
    if (!metaFile) {
      return null;
    }

    const contentBuffer = await this.fileService.readBinary(metaFile);
    const contentStr = new TextDecoder().decode(contentBuffer);
    const metadata = JSON.parse(contentStr) as FolderMetadata;
    return this.ensureCurrentSchema(metadata);
  }

  private async writeMetadata(folderPath: string, metadata: FolderMetadata): Promise<void> {
    const metaPath = this.getMetaPath(folderPath);
    const content = JSON.stringify(metadata, null, 2);
    await this.fileService.writeBinary(metaPath, new TextEncoder().encode(content).buffer);
  }

  private async transitionMetadataState(
    folder: TFolder,
    metadata: FolderMetadata,
    state: FolderLifecycleState,
    lastError?: string,
  ): Promise<FolderMetadata> {
    const nextMetadata: FolderMetadata = {
      ...metadata,
      schemaVersion: this.META_SCHEMA_VERSION,
      state,
      lastTransitionAt: Date.now(),
      lastError,
    };

    await this.writeMetadata(folder.path, nextMetadata);
    this.debug('metadata state transition', { folder: folder.path, state, hasError: Boolean(lastError) });
    return nextMetadata;
  }

  private isProtectedFile(file: TFile): boolean {
    return file.name === this.META_FILE_NAME || file.name === this.README_FILE_NAME;
  }

  private countLockedFiles(folder: TFolder): number {
    const stack: TFolder[] = [folder];
    let count = 0;

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (child.path.endsWith(this.LOCKED_EXTENSION)) {
          count += 1;
        }
      }
    }

    return count;
  }

  private collectProcessableFiles(folder: TFolder, mode: FolderProcessingOperation): TFile[] {
    const stack: TFolder[] = [folder];
    const files: TFile[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (!(child instanceof TFile) || this.isProtectedFile(child)) {
          continue;
        }

        if (mode === 'encrypt') {
          if (child.path.endsWith(this.LOCKED_EXTENSION)) {
            continue;
          }
          files.push(child);
          continue;
        }

        if (child.path.endsWith(this.LOCKED_EXTENSION)) {
          files.push(child);
        }
      }
    }

    return files;
  }

  private reportProgress(
    operation: FolderProcessingOperation,
    status: FolderProcessingStatus,
    folderPath: string,
    totalFiles: number,
    processedFiles: number,
    options?: FolderProcessingOptions,
    currentFilePath?: string,
  ): void {
    options?.onProgress?.({
      operation,
      status,
      folderPath,
      totalFiles,
      processedFiles,
      currentFilePath,
    });
  }

  private getFileProcessingSize(file: TFile): number {
    return Math.max(1, file.stat?.size ?? 1);
  }

  private createAbortError(): Error {
    const error = new Error('Operation cancelled.');
    error.name = 'AbortError';
    return error;
  }

  private getAbortReason(signal?: AbortSignal): unknown {
    if (!signal?.aborted) {
      return null;
    }

    return signal.reason ?? this.createAbortError();
  }

  private throwIfAborted(options?: FolderProcessingOptions): void {
    const abortReason = this.getAbortReason(options?.signal);
    if (abortReason) {
      throw abortReason;
    }
  }

  private async processFilesWithLimits<T>(
    folder: TFolder,
    operation: FolderProcessingOperation,
    files: TFile[],
    options: FolderProcessingOptions | undefined,
    processFile: (file: TFile) => Promise<T>,
  ): Promise<T[]> {
    const maxConcurrentFiles = Math.max(
      1,
      Math.floor(options?.maxConcurrentFiles ?? this.DEFAULT_MAX_CONCURRENT_FILES),
    );
    const maxConcurrentBytes = Math.max(
      1,
      Math.floor(options?.maxConcurrentBytes ?? this.DEFAULT_MAX_CONCURRENT_BYTES),
    );
    const results: T[] = [];
    let activeFiles = 0;
    let activeBytes = 0;
    let nextIndex = 0;
    let processedFiles = 0;
    let firstError: unknown;

    this.reportProgress(operation, 'preparing', folder.path, files.length, 0, options);
    this.throwIfAborted(options);

    if (files.length === 0) {
      this.reportProgress(operation, 'complete', folder.path, 0, 0, options);
      return results;
    }

    return await new Promise<T[]>((resolve, reject) => {
      const markAborted = (): void => {
        firstError = firstError ?? this.getAbortReason(options?.signal) ?? this.createAbortError();
        maybeFinish();
      };

      options?.signal?.addEventListener('abort', markAborted, { once: true });

      const maybeFinish = (): void => {
        if (activeFiles > 0) {
          return;
        }

        if (firstError) {
          options?.signal?.removeEventListener('abort', markAborted);
          this.reportProgress(operation, 'error', folder.path, files.length, processedFiles, options);
          reject(firstError);
          return;
        }

        if (nextIndex >= files.length) {
          options?.signal?.removeEventListener('abort', markAborted);
          this.reportProgress(operation, 'complete', folder.path, files.length, processedFiles, options);
          resolve(results);
        }
      };

      const launchNext = (): void => {
        const abortReason = this.getAbortReason(options?.signal);
        if (abortReason) {
          firstError = firstError ?? abortReason;
          maybeFinish();
          return;
        }

        while (!firstError && nextIndex < files.length && activeFiles < maxConcurrentFiles) {
          const file = files[nextIndex];
          const fileSize = this.getFileProcessingSize(file);
          const canRunWithActiveBytes = activeBytes + fileSize <= maxConcurrentBytes;
          if (activeFiles > 0 && !canRunWithActiveBytes) {
            break;
          }

          nextIndex += 1;
          activeFiles += 1;
          activeBytes += fileSize;
          this.reportProgress(operation, 'processing', folder.path, files.length, processedFiles, options, file.path);

          void processFile(file)
            .then((result) => {
              results.push(result);
            })
            .catch((error: unknown) => {
              firstError = firstError ?? error;
            })
            .finally(() => {
              activeFiles -= 1;
              activeBytes -= fileSize;
              processedFiles += 1;
              this.reportProgress(
                operation,
                firstError ? 'error' : 'processing',
                folder.path,
                files.length,
                processedFiles,
                options,
                file.path,
              );
              launchNext();
              maybeFinish();
            });
        }

        maybeFinish();
      };

      launchNext();
    });
  }

  private collectPlaintextFiles(folder: TFolder): TFile[] {
    const stack: TFolder[] = [folder];
    const files: TFile[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (!(child instanceof TFile)) {
          continue;
        }

        if (this.isProtectedFile(child) || child.path.endsWith(this.LOCKED_EXTENSION)) {
          continue;
        }

        files.push(child);
      }
    }

    return files;
  }

  getPlaintextFilesInLockedFolder(folder: TFolder): TFile[] {
    if (!this.isEncryptedFolder(folder) || this.isUnlocked(folder)) {
      return [];
    }

    return this.collectPlaintextFiles(folder);
  }

  findLockedEncryptedParentWithPlaintext(item: TFile | TFolder): TFolder | null {
    const folder = item instanceof TFolder && this.isEncryptedFolder(item) ? item : this.getEncryptedParent(item);
    if (!folder || this.isUnlocked(folder)) {
      return null;
    }

    return this.getPlaintextFilesInLockedFolder(folder).length > 0 ? folder : null;
  }

  async reconcileFolderState(folder: TFolder): Promise<void> {
    const metadata = await this.readMetadata(folder);
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
    const derivedKey = await this.encryptionService.deriveKey(password, salt);
    const wrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, derivedKey);

    const recoverySalt = this.encryptionService.generateSalt();
    const recoveryDerivedKey = await this.encryptionService.deriveKey(recoveryKey, recoverySalt);
    const recoveryWrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, recoveryDerivedKey);

    const testPhrase = 'OBSIDIAN_ENCRYPTED_VERIFICATION';
    const encoder = new TextEncoder();
    const testResult = await this.encryptionService.encryptWithKey(encoder.encode(testPhrase).buffer, masterKey);
    const combinedToken = this.combineBuffers(testResult.iv, testResult.ciphertext);

    let metadata: FolderMetadata = {
      version: 2,
      schemaVersion: this.META_SCHEMA_VERSION,
      id: window.crypto.randomUUID(),
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: this.arrayBufferToBase64(salt),
      iterations: 600000,
      lockFile: this.META_FILE_NAME,
      testToken: this.arrayBufferToBase64(combinedToken),
      wrappedMasterKey: this.arrayBufferToBase64(wrappedResult.ciphertext),
      masterKeyIV: this.arrayBufferToBase64(wrappedResult.iv),
      recoverySalt: this.arrayBufferToBase64(recoverySalt),
      wrappedMasterKeyRecovery: this.arrayBufferToBase64(recoveryWrappedResult.ciphertext),
      recoveryIV: this.arrayBufferToBase64(recoveryWrappedResult.iv),
      state: lockImmediately ? 'locking' : 'unlocked',
      lastTransitionAt: Date.now(),
    };

    metadata.mac = await this.computeMetadataMac(metadata, password, false);
    metadata.recoveryMac = await this.computeMetadataMac(metadata, recoveryKey, true);

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
      } catch (error) {
        await this.transitionMetadataState(folder, metadata, 'error', String(error));
        throw error;
      }
    } else {
      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      this.recordActivityForPath(folder.path);
      metadata = await this.transitionMetadataState(folder, metadata, 'unlocked');
    }

    this.encryptedFolders.add(this.toFolderKey(folder.path));
    this.debug('encrypted folder created', { folder: folder.path, state: metadata.state });
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
    const files = this.collectProcessableFiles(folder, 'encrypt');
    const processedFiles: { originalPath: string; lockedPath: string }[] = [];

    try {
      const results = await this.processFilesWithLimits(folder, 'encrypt', files, options, async (file) => {
        const lockedPath = normalizePath(file.path + this.LOCKED_EXTENSION);
        const encrypted = await this.encryptFile(file, key);
        if (encrypted) {
          processedFiles.push({ originalPath: file.path, lockedPath });
        }
        return encrypted;
      });
      return results.filter(Boolean).length;
    } catch (error) {
      this.debug('Encryption failed mid-process, attempting rollback', { error, processedFiles });
      await this.rollbackEncryption(processedFiles, key);
      throw error;
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
          await this.app.fileManager.trashFile(lockedFile);
        }

        const tmpPath = normalizePath(`${file.originalPath}${this.LOCKED_EXTENSION}.tmp`);
        const tmpFile = this.fileService.getFile(tmpPath);
        if (tmpFile) {
          await this.app.fileManager.trashFile(tmpFile);
        }
      } catch (rollbackError) {
        this.debug('Rollback failed for file', { path: file.originalPath, rollbackError });
      }
    }
  }

  async decryptFolderContents(folder: TFolder, key: CryptoKey, options?: FolderProcessingOptions): Promise<void> {
    const files = this.collectProcessableFiles(folder, 'decrypt');
    const errors: { path: string; error: unknown }[] = [];

    await this.processFilesWithLimits(folder, 'decrypt', files, options, async (file) => {
      try {
        await this.decryptFile(file, key);
      } catch (error) {
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
  }

  async encryptFile(file: TFile, key: CryptoKey): Promise<boolean> {
    const data = await this.fileService.readBinary(file);
    if (this.hasMagic(data)) {
      return false;
    }

    const result = await this.encryptionService.encryptWithKey(data, key);
    const combined = this.combineBuffersWithMagic(result.iv, result.ciphertext);
    const tmpPath = normalizePath(`${file.path}${this.LOCKED_EXTENSION}.tmp`);
    const finalPath = normalizePath(`${file.path}${this.LOCKED_EXTENSION}`);

    // Step 1: Write staging buffer to .locked.tmp
    const tmpFile = await this.fileService.writeBinary(tmpPath, combined);

    // Step 2: Verify staged ciphertext integrity before touching original plaintext
    const stagedData = await this.fileService.readBinary(tmpFile);
    if (!this.hasMagic(stagedData) || stagedData.byteLength !== combined.byteLength) {
      const currentTmp = this.fileService.getFile(tmpPath);
      if (currentTmp) {
        await this.fileService.deleteFile(currentTmp);
      }
      throw new Error(`Staging write integrity check failed for file ${file.path}`);
    }

    // Step 3: Promote staged file to final .locked file
    await this.fileService.writeBinary(finalPath, combined);
    const createdTmp = this.fileService.getFile(tmpPath);
    if (createdTmp) {
      await this.fileService.deleteFile(createdTmp);
    }

    // Step 4: Shred and delete original plaintext file ONLY after final ciphertext is verified
    await this.fileService.shredFile(file);
    return true;
  }

  async decryptFile(file: TFile, key: CryptoKey): Promise<void> {
    const data = await this.fileService.readBinary(file);
    if (!this.hasMagic(data)) {
      return;
    }

    const { iv, ciphertext } = this.splitMagicBuffer(data);
    try {
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
      await this.app.fileManager.trashFile(file);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      const errorMsg =
        `Failed to decrypt file: ${file.path}\n` +
        `  Error: ${err.name ?? 'UnknownError'} - ${err.message ?? 'Unknown message'}\n` +
        `  File Size: ${data.byteLength}\n` +
        `  IV Length: ${iv.byteLength}\n` +
        `  Ciphertext Length: ${ciphertext.byteLength}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
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

    const fullView = new Uint8Array(data);
    const iv = fullView.slice(headerOffset, ivOffset);
    const ciphertext = fullView.slice(ivOffset);

    return { iv, ciphertext };
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
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
    const result = await this.app.vault.adapter.list(basePath);

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

  async syncFolders(retries = 3, retryDelayMs = 300): Promise<void> {
    const discovered = new Set<string>();

    const indexedFiles = this.app.vault.getFiles();
    for (const file of indexedFiles) {
      if (file.name === this.META_FILE_NAME) {
        discovered.add(this.toFolderKey(file.parent?.path ?? ''));
      }
    }

    try {
      await this.scanAdapterTree('', discovered);
    } catch (error) {
      this.debug('adapter scan failed', error);
    }

    this.encryptedFolders = new Set(Array.from(discovered).filter((value) => value.length > 0));

    if (this.encryptedFolders.size === 0 && retries > 1) {
      await this.sleep(retryDelayMs);
      await this.syncFolders(retries - 1, retryDelayMs);
      return;
    }

    this.debug('syncFolders complete', { discovered: this.encryptedFolders.size });
  }

  isEncryptedFolder(folder: TFolder): boolean {
    const folderKey = this.toFolderKey(folder.path);
    if (this.encryptedFolders.has(folderKey)) {
      return true;
    }

    const metaPath = this.getMetaPath(folder.path);
    const exists = this.fileService.exists(metaPath);

    if (exists) {
      this.encryptedFolders.add(folderKey);
      return true;
    }

    return false;
  }

  getEncryptedParent(file: TFile | TFolder): TFolder | null {
    let parent = file.parent;
    while (parent) {
      const metaPath = this.getMetaPath(parent.path);
      if (this.fileService.getFile(metaPath)) {
        return parent;
      }
      parent = parent.parent;
    }
    return null;
  }

  isInsideEncryptedFolder(file: TFile | TFolder): boolean {
    return this.getEncryptedParent(file) !== null;
  }

  private async computeMetadataMac(metadata: FolderMetadata, secret: string, isRecovery = false): Promise<string> {
    const saltStr = isRecovery ? metadata.recoverySalt : metadata.salt;
    if (!saltStr) {
      throw new Error('Metadata is missing salt for MAC computation');
    }
    const salt = new Uint8Array(this.base64ToArrayBuffer(saltStr));
    const hmacKey = await this.encryptionService.deriveHmacKey(secret, salt);
    const payload = `${metadata.id}:${metadata.version}:${metadata.salt}:${metadata.iterations}:${metadata.wrappedMasterKey}:${metadata.testToken}`;
    const hmacBuffer = await this.encryptionService.computeHmac(hmacKey, new TextEncoder().encode(payload).buffer);
    return this.arrayBufferToBase64(hmacBuffer);
  }

  private async getMasterKeyFromSecret(
    metadata: FolderMetadata,
    secret: string,
    isRecovery: boolean,
  ): Promise<CryptoKey> {
    const encodedSalt = isRecovery ? metadata.recoverySalt : metadata.salt;
    const wrappedMaster = isRecovery ? metadata.wrappedMasterKeyRecovery : metadata.wrappedMasterKey;
    const wrappedIV = isRecovery ? metadata.recoveryIV : metadata.masterKeyIV;

    if (!encodedSalt || !wrappedMaster || !wrappedIV) {
      throw new Error('Metadata is missing required key material.');
    }

    const macToCheck = isRecovery ? metadata.recoveryMac : metadata.mac;
    if (macToCheck) {
      const expectedMac = await this.computeMetadataMac(metadata, secret, isRecovery);
      if (macToCheck !== expectedMac) {
        throw new Error('Authentication failed: Metadata tampering detected');
      }
    }

    const salt = new Uint8Array(this.base64ToArrayBuffer(encodedSalt));
    const derivedKey = await this.encryptionService.deriveKey(secret, salt);

    const wrappedMK = new Uint8Array(this.base64ToArrayBuffer(wrappedMaster));
    const mkIV = new Uint8Array(this.base64ToArrayBuffer(wrappedIV));

    const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, derivedKey, mkIV).catch(() => {
      throw new Error('Authentication failed: Invalid key');
    });
    const masterKey = await this.encryptionService.importKey(masterKeyRaw, false);

    const tokenData = new Uint8Array(this.base64ToArrayBuffer(metadata.testToken));
    const iv = tokenData.slice(0, 12);
    const ciphertext = tokenData.slice(12);

    const resultBuffer = await this.encryptionService.decryptWithKey(ciphertext, masterKey, iv).catch(() => {
      throw new Error('Authentication failed: Verification failed');
    });
    const resultStr = new TextDecoder().decode(resultBuffer);

    if (resultStr !== 'OBSIDIAN_ENCRYPTED_VERIFICATION') {
      throw new Error('Authentication failed: Token mismatch');
    }

    return masterKey;
  }

  async unlockFolder(
    folder: TFolder,
    secret: string,
    isRecovery = false,
    options?: FolderProcessingOptions,
  ): Promise<boolean> {
    let metadata = await this.readMetadata(folder);
    if (!metadata) {
      return false;
    }

    await this.reconcileFolderState(folder);
    metadata = await this.readMetadata(folder);
    if (!metadata) {
      return false;
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

      const masterKey = await this.getMasterKeyFromSecret(metadata, secret, isRecovery);

      await this.decryptFolderContents(folder, masterKey, options);

      const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
      if (readmeFile) {
        await this.app.fileManager.trashFile(readmeFile);
      }

      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      this.recordActivityForPath(folder.path);
      await this.transitionMetadataState(folder, metadata, 'unlocked');
      this.debug('folder unlocked', { folder: folder.path, isRecovery });
      return true;
    } catch (error) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      this.debug('unlock error', { folder: folder.path, error });
      return false;
    }
  }

  async reprocessLockedFolder(
    folder: TFolder,
    secret: string,
    isRecovery = false,
    options?: FolderProcessingOptions,
  ): Promise<boolean> {
    if (!this.isEncryptedFolder(folder) || this.isUnlocked(folder)) {
      return false;
    }

    let metadata = await this.readMetadata(folder);
    if (!metadata) {
      return false;
    }

    await this.reconcileFolderState(folder);
    metadata = await this.readMetadata(folder);
    if (!metadata) {
      return false;
    }

    const plaintextFiles = this.getPlaintextFilesInLockedFolder(folder);
    if (plaintextFiles.length === 0) {
      return true;
    }

    try {
      const masterKey = await this.getMasterKeyFromSecret(metadata, secret, isRecovery);
      const results = await this.processFilesWithLimits(folder, 'encrypt', plaintextFiles, options, async (file) => {
        const currentFile = this.fileService.getFile(file.path);
        if (!currentFile) {
          return false;
        }

        return await this.encryptFile(currentFile, masterKey);
      });

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
    } catch (error) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      this.debug('locked folder reprocess error', { folder: folder.path, error });
      return false;
    }
  }

  async lockFolder(folder: TFolder, options?: FolderProcessingOptions): Promise<void> {
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
      this.unlockedFolderActivityAt.delete(folderKey);
      await this.transitionMetadataState(folder, metadata, 'locked');
      this.debug('folder locked', { folder: folder.path });
    } catch (error) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      throw error;
    }
  }

  async lockAllFolders(options?: FolderProcessingOptions): Promise<void> {
    await this.lockTrackedFolders(undefined, options);
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

    const activityAt = this.unlockedFolderActivityAt.get(oldKey);
    if (activityAt !== undefined) {
      this.unlockedFolderActivityAt.set(newKey, activityAt);
      this.unlockedFolderActivityAt.delete(oldKey);
    }

    if (this.encryptedFolders.has(oldKey)) {
      this.encryptedFolders.delete(oldKey);
      this.encryptedFolders.add(newKey);
    }
  }

  removePath(path: string): void {
    const key = this.toFolderKey(path);
    this.unlockedFolders.delete(key);
    this.unlockedFolderActivityAt.delete(key);
    this.encryptedFolders.delete(key);
  }

  getUnlockedKey(folder: TFolder): CryptoKey | undefined {
    return this.unlockedFolders.get(this.toFolderKey(folder.path));
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

    const metaFile = this.fileService.getFile(this.getMetaPath(folder.path));
    if (metaFile) {
      await this.app.fileManager.trashFile(metaFile);
    }

    const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
    if (readmeFile) {
      await this.app.fileManager.trashFile(readmeFile);
    }

    this.unlockedFolders.delete(this.toFolderKey(folder.path));
    this.unlockedFolderActivityAt.delete(this.toFolderKey(folder.path));
    this.encryptedFolders.delete(this.toFolderKey(folder.path));

    return true;
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class FolderService {
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private encryptedFolders: Set<string> = new Set();
  private syncDebounceTimer: number | null = null;
  private debugLogging = false;

  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly OLD_META_FILE_NAME = '.obsidian-folder-meta';
  private readonly LOCKED_EXTENSION = '.locked';
  private readonly META_SCHEMA_VERSION = 2;
  private readonly README_FILE_NAME = 'README_ENCRYPTED.md';
  private readonly README_CONTENT = `
# 🔒 Folder Encrypted

This folder is currently encrypted and locked by the **Obsidian Encrypted Folders** plugin.

### 🔑 How to Unlock
1. **Right-click** on this folder in the file explorer.
2. Select **"Unlock Folder"**.
3. Enter your password to restore your files.

*Note: The ".locked" files are your encrypted data. Do not delete or modify them while the folder is locked.*
`.trim();

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
    private app: App,
  ) {}

  setDebugLogging(enabled: boolean): void {
    this.debugLogging = enabled;
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
      console.info(`[EncryptedFolders] ${message}`);
      return;
    }

    console.info(`[EncryptedFolders] ${message}`, data);
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

  private getOldMetaPath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.OLD_META_FILE_NAME}`);
  }

  private getReadmePath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.README_FILE_NAME}`);
  }

  private hasLegacyMetadata(folder: TFolder): boolean {
    return this.fileService.exists(this.getOldMetaPath(folder.path));
  }

  needsMetadataMigration(folder: TFolder): boolean {
    return this.hasLegacyMetadata(folder) && !this.fileService.exists(this.getMetaPath(folder.path));
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

  private async countLockedFiles(folder: TFolder): Promise<number> {
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

  async reconcileFolderState(folder: TFolder): Promise<void> {
    const metadata = await this.readMetadata(folder);
    if (!metadata) {
      return;
    }

    if (metadata.state === 'locking') {
      const readmePath = this.getReadmePath(folder.path);
      if (!this.fileService.exists(readmePath)) {
        await this.fileService.writeBinary(readmePath, new TextEncoder().encode(this.README_CONTENT).buffer);
      }
      await this.transitionMetadataState(folder, metadata, 'locked');
      return;
    }

    if (metadata.state === 'unlocking') {
      const lockedFiles = await this.countLockedFiles(folder);
      const nextState: FolderLifecycleState = lockedFiles === 0 ? 'unlocked' : 'locked';
      await this.transitionMetadataState(folder, metadata, nextState);
    }
  }

  async migrateFolderMetadata(folder: TFolder): Promise<boolean> {
    const oldMetaPath = this.getOldMetaPath(folder.path);
    const oldMetaFile = this.fileService.getFile(oldMetaPath);
    if (!oldMetaFile) {
      return false;
    }

    const contentBuffer = await this.fileService.readBinary(oldMetaFile);
    const contentStr = new TextDecoder().decode(contentBuffer);
    const rawMetadata = JSON.parse(contentStr) as FolderMetadata;
    const migratedMetadata = this.ensureCurrentSchema(rawMetadata);

    await this.writeMetadata(folder.path, migratedMetadata);
    await this.app.vault.delete(oldMetaFile);

    this.encryptedFolders.add(this.toFolderKey(folder.path));
    this.debug('legacy metadata migrated', { folder: folder.path });
    return true;
  }

  async createEncryptedFolder(folder: TFolder, password: string, lockImmediately = false): Promise<string> {
    if (this.isInsideEncryptedFolder(folder)) {
      throw new Error('Nested encryption is not allowed. A parent folder is already encrypted.');
    }

    const recoveryKey = this.generateRecoveryKey();
    const masterKey = await this.encryptionService.generateMasterKey();
    const masterKeyRaw = await this.encryptionService.exportKey(masterKey);

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

    await this.writeMetadata(folder.path, metadata);

    if (lockImmediately) {
      try {
        const encryptedCount = await this.encryptFolderContents(folder, masterKey);
        metadata = {
          ...metadata,
          expectedLockedFiles: encryptedCount,
        };
        await this.fileService.writeBinary(
          this.getReadmePath(folder.path),
          new TextEncoder().encode(this.README_CONTENT).buffer,
        );
        metadata = await this.transitionMetadataState(folder, metadata, 'locked');
      } catch (error) {
        await this.transitionMetadataState(folder, metadata, 'error', String(error));
        throw error;
      }
    } else {
      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
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

  async encryptFolderContents(folder: TFolder, key: CryptoKey): Promise<number> {
    const children = [...folder.children];
    let encryptedCount = 0;
    for (const child of children) {
      if (child instanceof TFile) {
        if (
          child.name === this.META_FILE_NAME ||
          child.name === this.OLD_META_FILE_NAME ||
          child.name === this.README_FILE_NAME
        ) {
          continue;
        }
        const encrypted = await this.encryptFile(child, key);
        if (encrypted) {
          encryptedCount += 1;
        }
      } else if (child instanceof TFolder) {
        encryptedCount += await this.encryptFolderContents(child, key);
      }
    }

    return encryptedCount;
  }

  async decryptFolderContents(folder: TFolder, key: CryptoKey): Promise<void> {
    const children = [...folder.children];
    for (const child of children) {
      if (child instanceof TFile) {
        if (
          child.name === this.META_FILE_NAME ||
          child.name === this.OLD_META_FILE_NAME ||
          child.name === this.README_FILE_NAME
        ) {
          continue;
        }
        await this.decryptFile(child, key);
      } else if (child instanceof TFolder) {
        await this.decryptFolderContents(child, key);
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
    const newPath = normalizePath(file.path + this.LOCKED_EXTENSION);

    await this.fileService.writeBinary(newPath, combined);
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
        ciphertext as BufferSource,
        key,
        iv as BufferSource,
      );

      let newPath = file.path;
      if (newPath.endsWith(this.LOCKED_EXTENSION)) {
        newPath = newPath.slice(0, -this.LOCKED_EXTENSION.length);
      } else {
        newPath = `${newPath}.decrypted`;
      }

      await this.fileService.writeBinary(newPath, plaintext);
      await this.app.vault.delete(file);
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

  async unlockFolder(folder: TFolder, secret: string, isRecovery = false): Promise<boolean> {
    if (this.hasLegacyMetadata(folder) && !this.fileService.exists(this.getMetaPath(folder.path))) {
      throw new Error('Legacy metadata detected. Please migrate this folder metadata first.');
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

    try {
      const lockedFiles = await this.countLockedFiles(folder);
      const expectedLockedFiles = metadata.expectedLockedFiles;
      if (typeof expectedLockedFiles === 'number' && expectedLockedFiles > 0 && lockedFiles < expectedLockedFiles) {
        throw new Error(
          `Encrypted files are still syncing (${lockedFiles}/${expectedLockedFiles}). Please wait and try again.`,
        );
      }

      metadata = await this.transitionMetadataState(folder, metadata, 'unlocking');

      const encodedSalt = isRecovery ? metadata.recoverySalt : metadata.salt;
      const wrappedMaster = isRecovery ? metadata.wrappedMasterKeyRecovery : metadata.wrappedMasterKey;
      const wrappedIV = isRecovery ? metadata.recoveryIV : metadata.masterKeyIV;

      if (!encodedSalt || !wrappedMaster || !wrappedIV) {
        throw new Error('Metadata is missing required key material.');
      }

      const salt = new Uint8Array(this.base64ToArrayBuffer(encodedSalt));
      const derivedKey = await this.encryptionService.deriveKey(secret, salt);

      const wrappedMK = new Uint8Array(this.base64ToArrayBuffer(wrappedMaster));
      const mkIV = new Uint8Array(this.base64ToArrayBuffer(wrappedIV));

      const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, derivedKey, mkIV).catch(() => {
        throw new Error('Authentication failed: Invalid key');
      });
      const masterKey = await this.encryptionService.importKey(masterKeyRaw);

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

      await this.decryptFolderContents(folder, masterKey);

      const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
      if (readmeFile) {
        await this.app.vault.delete(readmeFile);
      }

      this.unlockedFolders.set(this.toFolderKey(folder.path), masterKey);
      await this.transitionMetadataState(folder, metadata, 'unlocked');
      this.debug('folder unlocked', { folder: folder.path, isRecovery });
      return true;
    } catch (error) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      this.debug('unlock error', { folder: folder.path, error });
      return false;
    }
  }

  async lockFolder(folder: TFolder): Promise<void> {
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
      const encryptedCount = await this.encryptFolderContents(folder, key);
      metadata = {
        ...metadata,
        expectedLockedFiles: encryptedCount,
      };
      await this.fileService.writeBinary(
        this.getReadmePath(folder.path),
        new TextEncoder().encode(this.README_CONTENT).buffer,
      );
      this.unlockedFolders.delete(folderKey);
      await this.transitionMetadataState(folder, metadata, 'locked');
      this.debug('folder locked', { folder: folder.path });
    } catch (error) {
      await this.transitionMetadataState(folder, metadata, 'error', String(error));
      throw error;
    }
  }

  async lockAllFolders(): Promise<void> {
    for (const path of Array.from(this.unlockedFolders.keys())) {
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) {
        await this.lockFolder(folder);
      }
    }
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

    if (this.encryptedFolders.has(oldKey)) {
      this.encryptedFolders.delete(oldKey);
      this.encryptedFolders.add(newKey);
    }
  }

  removePath(path: string): void {
    const key = this.toFolderKey(path);
    this.unlockedFolders.delete(key);
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
      await this.app.vault.delete(metaFile);
    }

    const readmeFile = this.fileService.getFile(this.getReadmePath(folder.path));
    if (readmeFile) {
      await this.app.vault.delete(readmeFile);
    }

    this.unlockedFolders.delete(this.toFolderKey(folder.path));
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

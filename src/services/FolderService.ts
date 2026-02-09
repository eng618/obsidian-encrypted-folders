import { App, TFile, TFolder } from 'obsidian';
import { FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class FolderService {
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private encryptedFolders: Set<string> = new Set();
  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly OLD_META_FILE_NAME = '.obsidian-folder-meta';
  private readonly LOCKED_EXTENSION = '.locked';
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

  /**
   * Creates a new encrypted folder.
   *
   * @param folder The folder to encrypt.
   * @param password The password for the folder.
   */
  async createEncryptedFolder(folder: TFolder, password: string, lockImmediately = false): Promise<string> {
    const recoveryKey = this.generateRecoveryKey();
    const masterKey = await this.encryptionService.generateMasterKey();
    const masterKeyRaw = await this.encryptionService.exportKey(masterKey);

    // 1. Password wrapping
    const salt = this.encryptionService.generateSalt();
    const derivedKey = await this.encryptionService.deriveKey(password, salt);
    const wrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, derivedKey);

    // 2. Recovery wrapping
    const recoverySalt = this.encryptionService.generateSalt();
    const recoveryDerivedKey = await this.encryptionService.deriveKey(recoveryKey, recoverySalt);
    const recoveryWrappedResult = await this.encryptionService.encryptWithKey(masterKeyRaw, recoveryDerivedKey);

    // 3. Test token (using the master key to verify we can decrypt later)
    const testPhrase = 'OBSIDIAN_ENCRYPTED_VERIFICATION';
    const encoder = new TextEncoder();
    const testResult = await this.encryptionService.encryptWithKey(encoder.encode(testPhrase).buffer, masterKey);
    const combinedToken = this.combineBuffers(testResult.iv, testResult.ciphertext);

    const metadata: FolderMetadata = {
      version: 1,
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
    };

    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const jsonString = JSON.stringify(metadata, null, 2);
    const encoder2 = new TextEncoder();
    await this.fileService.writeBinary(metaPath, encoder2.encode(jsonString).buffer);

    // Only encrypt contents if the user wants to lock immediately
    if (lockImmediately) {
      await this.encryptFolderContents(folder, masterKey);
    } else {
      // Otherwise, keep it "Unlocked" in memory for continued editing
      this.unlockedFolders.set(folder.path, masterKey);
    }

    this.encryptedFolders.add(folder.path);
    return recoveryKey;
  }

  private generateRecoveryKey(): string {
    const charset = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Base57 (no 0, O, I, l)
    let ret = '';
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    for (let i = 0; i < 32; i++) {
      ret += charset.charAt(bytes[i] % charset.length);
      if ((i + 1) % 8 === 0 && i < 31) ret += '-';
    }
    return ret;
  }

  async encryptFolderContents(folder: TFolder, key: CryptoKey): Promise<void> {
    // Collect children first to avoid iteration issues when files are deleted/created
    const children = [...folder.children];
    for (const child of children) {
      if (child instanceof TFile) {
        if (
          child.name === this.META_FILE_NAME ||
          child.name === this.OLD_META_FILE_NAME ||
          child.name === this.README_FILE_NAME
        )
          continue;
        await this.encryptFile(child, key);
      } else if (child instanceof TFolder) {
        await this.encryptFolderContents(child, key);
      }
    }
  }

  async decryptFolderContents(folder: TFolder, key: CryptoKey): Promise<void> {
    const children = [...folder.children];
    for (const child of children) {
      if (child instanceof TFile) {
        if (
          child.name === this.META_FILE_NAME ||
          child.name === this.OLD_META_FILE_NAME ||
          child.name === this.README_FILE_NAME
        )
          continue;
        await this.decryptFile(child, key);
      } else if (child instanceof TFolder) {
        await this.decryptFolderContents(child, key);
      }
    }
  }

  async encryptFile(file: TFile, key: CryptoKey): Promise<void> {
    const data = await this.fileService.readBinary(file);
    if (this.hasMagic(data)) return;

    const result = await this.encryptionService.encryptWithKey(data, key);
    const combined = this.combineBuffersWithMagic(result.iv, result.ciphertext);

    const newPath = file.path + this.LOCKED_EXTENSION;

    // 1. Write the encrypted version
    await this.fileService.writeBinary(newPath, combined);

    // 2. Shred and delete the original plaintext version
    await this.fileService.shredFile(file);
  }

  async decryptFile(file: TFile, key: CryptoKey): Promise<void> {
    const data = await this.fileService.readBinary(file);
    if (!this.hasMagic(data)) return;

    const { iv, ciphertext } = this.splitMagicBuffer(data);
    try {
      // Ensure we pass the exact buffer views to SubtleCrypto
      const plaintext = await this.encryptionService.decryptWithKey(
        ciphertext as BufferSource,
        key,
        iv as BufferSource,
      );

      let newPath = file.path;
      if (newPath.endsWith(this.LOCKED_EXTENSION)) {
        newPath = newPath.slice(0, -this.LOCKED_EXTENSION.length);
      } else {
        newPath = newPath + '.decrypted'; // Fallback
      }

      await this.fileService.writeBinary(newPath, plaintext);
      await this.app.vault.delete(file);
    } catch (e) {
      const errorMsg =
        `Failed to decrypt file: ${file.path}\n` +
        `  Error: ${e.name} - ${e.message}\n` +
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
    if (data.byteLength < 4) return false;
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

    // Use subarray for efficient view slicing
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

  /** Scans the vault for encrypted folders to populate the synchronous cache. */
  async syncFolders(): Promise<void> {
    // Wait a brief moment for the vault to be ready
    await new Promise((r) => setTimeout(r, 500));

    const files = this.app.vault.getFiles();
    for (const file of files) {
      if (file.name === this.META_FILE_NAME || file.name === this.OLD_META_FILE_NAME) {
        if (file.parent) {
          this.encryptedFolders.add(file.parent.path);
        }
      }
    }

    // Also check the adapter for files that might not be indexed yet
    try {
      // We check recursively for common locations if needed,
      // but for now let's use the adapter to check the root children at least
      const rootRes = await this.app.vault.adapter.list('');
      for (const folderPath of rootRes.folders) {
        if (
          (await this.app.vault.adapter.exists(`${folderPath}/${this.META_FILE_NAME}`)) ||
          (await this.app.vault.adapter.exists(`${folderPath}/${this.OLD_META_FILE_NAME}`))
        ) {
          this.encryptedFolders.add(folderPath);
        }
      }
    } catch (e) {
      console.warn('Failed to deep sync folders with adapter:', e);
    }
  }

  isEncryptedFolder(folder: TFolder): boolean {
    // 1. Check synchronous cache
    if (this.encryptedFolders.has(folder.path)) return true;

    // 2. Check vault index (if synced)
    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const oldMetaPath = `${folder.path}/${this.OLD_META_FILE_NAME}`;

    const exists = this.fileService.exists(metaPath);
    const oldExists = this.fileService.exists(oldMetaPath);

    if (exists || oldExists) {
      this.encryptedFolders.add(folder.path);
      return true;
    }

    return false;
  }

  getEncryptedParent(file: TFile | TFolder): TFolder | null {
    let parent = file.parent;
    while (parent) {
      // Check if this parent folder has the metadata file
      const metaPath = `${parent.path}/${this.META_FILE_NAME}`;
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
    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const metaFile = this.fileService.getFile(metaPath);
    if (!metaFile) return false;

    const contentBuffer = await this.fileService.readBinary(metaFile);
    const contentStr = new TextDecoder().decode(contentBuffer);
    const metadata: FolderMetadata = JSON.parse(contentStr);

    try {
      // 1. Derive key from password/recovery key
      const salt = new Uint8Array(this.base64ToArrayBuffer(isRecovery ? metadata.recoverySalt! : metadata.salt));
      const derivedKey = await this.encryptionService.deriveKey(secret, salt);

      // 2. Unwrap master key
      const wrappedMK = new Uint8Array(
        this.base64ToArrayBuffer(isRecovery ? metadata.wrappedMasterKeyRecovery! : metadata.wrappedMasterKey),
      );
      const mkIV = new Uint8Array(this.base64ToArrayBuffer(isRecovery ? metadata.recoveryIV! : metadata.masterKeyIV));

      const masterKeyRaw = await this.encryptionService.decryptWithKey(wrappedMK, derivedKey, mkIV).catch(() => {
        throw new Error('Authentication failed: Invalid key');
      });
      const masterKey = await this.encryptionService.importKey(masterKeyRaw);

      // 3. Verify master key with testToken
      const tokenData = new Uint8Array(this.base64ToArrayBuffer(metadata.testToken));
      const iv = tokenData.slice(0, 12);
      const ciphertext = tokenData.slice(12);

      const resultBuffer = await this.encryptionService.decryptWithKey(ciphertext, masterKey, iv).catch(() => {
        throw new Error('Authentication failed: Verification failed');
      });
      const resultStr = new TextDecoder().decode(resultBuffer);

      if (resultStr === 'OBSIDIAN_ENCRYPTED_VERIFICATION') {
        // CONTENT DECRYPTION MUST HAPPEN BEFORE MARKING AS UNLOCKED
        // To ensure a transactional state.
        await this.decryptFolderContents(folder, masterKey);

        // Delete readme if it exists
        const readmePath = `${folder.path}/${this.README_FILE_NAME}`;
        const readmeFile = this.fileService.getFile(readmePath);
        if (readmeFile) {
          await this.app.vault.delete(readmeFile);
        }

        this.unlockedFolders.set(folder.path, masterKey);
        return true;
      } else {
        throw new Error('Authentication failed: Token mismatch');
      }
    } catch (e) {
      console.warn('Unlock error for folder:', folder.path, e);
    }

    return false;
  }

  async lockFolder(folder: TFolder): Promise<void> {
    const key = this.unlockedFolders.get(folder.path);
    if (key) {
      await this.encryptFolderContents(folder, key);

      // Create informational readme
      const readmePath = `${folder.path}/${this.README_FILE_NAME}`;
      await this.fileService.writeBinary(readmePath, new TextEncoder().encode(this.README_CONTENT).buffer);

      this.unlockedFolders.delete(folder.path);
    }
  }

  async lockAllFolders(): Promise<void> {
    for (const [path, key] of this.unlockedFolders.entries()) {
      const folder = this.app.vault.getAbstractFileByPath(path);
      if (folder instanceof TFolder) {
        await this.encryptFolderContents(folder, key);
      }
    }
    this.unlockedFolders.clear();
  }

  isUnlocked(folder: TFolder): boolean {
    return this.unlockedFolders.has(folder.path);
  }

  updatePath(oldPath: string, newPath: string): void {
    const key = this.unlockedFolders.get(oldPath);
    if (key) {
      this.unlockedFolders.set(newPath, key);
      this.unlockedFolders.delete(oldPath);
    }
  }

  removePath(path: string): void {
    this.unlockedFolders.delete(path);
  }

  getUnlockedKey(folder: TFolder): CryptoKey | undefined {
    return this.unlockedFolders.get(folder.path);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

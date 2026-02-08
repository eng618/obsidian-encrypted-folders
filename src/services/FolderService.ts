import { App, TFile, TFolder } from 'obsidian';
import { FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class FolderService {
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private readonly META_FILE_NAME = '.obsidian-folder-meta';

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
  async createEncryptedFolder(folder: TFolder, password: string): Promise<void> {
    const testPhrase = 'OBSIDIAN_ENCRYPTED_VERIFICATION';
    const encoder = new TextEncoder();
    const data = encoder.encode(testPhrase);

    const encryptionResult = await this.encryptionService.encrypt(data.buffer, password);

    const combinedToken = this.combineBuffers(encryptionResult.iv, encryptionResult.ciphertext);

    const metadata: FolderMetadata = {
      version: 1,
      id: window.crypto.randomUUID(),
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: this.arrayBufferToBase64(encryptionResult.salt),
      iterations: 600000,
      lockFile: this.META_FILE_NAME,
      testToken: this.arrayBufferToBase64(combinedToken),
    };

    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const jsonString = JSON.stringify(metadata, null, 2);
    const encoder2 = new TextEncoder();
    await this.fileService.writeBinary(metaPath, encoder2.encode(jsonString).buffer);

    // Initial encryption of contents
    const salt = encryptionResult.salt;
    const key = await this.encryptionService.deriveKey(password, salt);
    await this.encryptFolderContents(folder, key);

    // Mark as unlocked in session
    this.unlockedFolders.set(folder.path, key);
  }

  async encryptFolderContents(folder: TFolder, key: CryptoKey): Promise<void> {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.name === this.META_FILE_NAME) continue;
        await this.encryptFile(child, key);
      } else if (child instanceof TFolder) {
        await this.encryptFolderContents(child, key);
      }
    }
  }

  async decryptFolderContents(folder: TFolder, key: CryptoKey): Promise<void> {
    for (const child of folder.children) {
      if (child instanceof TFile) {
        if (child.name === this.META_FILE_NAME) continue;
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

    // Securely replace plaintext with ciphertext
    await this.fileService.secureWrite(file.path, combined);
  }

  async decryptFile(file: TFile, key: CryptoKey): Promise<void> {
    const data = await this.fileService.readBinary(file);
    if (!this.hasMagic(data)) return;

    const { iv, ciphertext } = this.splitMagicBuffer(data);
    try {
      const plaintext = await this.encryptionService.decryptWithKey(ciphertext, key, iv);
      await this.fileService.writeBinary(file.path, plaintext);
    } catch (e) {
      console.error(`Failed to decrypt file: ${file.path}`, e);
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

  private splitMagicBuffer(data: ArrayBuffer): { iv: Uint8Array; ciphertext: ArrayBuffer } {
    const iv = new Uint8Array(data, this.MAGIC_BYTES.length, 12);
    const ciphertext = data.slice(this.MAGIC_BYTES.length + 12);
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

  async isEncryptedFolder(folder: TFolder): Promise<boolean> {
    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    return await this.fileService.exists(metaPath);
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

  async unlockFolder(folder: TFolder, password: string): Promise<boolean> {
    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const metaFile = this.fileService.getFile(metaPath);
    if (!metaFile) return false;

    const contentBuffer = await this.fileService.readBinary(metaFile);
    const contentStr = new TextDecoder().decode(contentBuffer);
    const metadata: FolderMetadata = JSON.parse(contentStr);

    // 1. Derive key using salt from metadata
    const salt = new Uint8Array(this.base64ToArrayBuffer(metadata.salt));
    const key = await this.encryptionService.deriveKey(password, salt);

    // 2. Decrypt testToken
    const tokenData = new Uint8Array(this.base64ToArrayBuffer(metadata.testToken));

    // Token format: IV (12 bytes) + Ciphertext
    const iv = tokenData.slice(0, 12);
    const ciphertext = tokenData.slice(12);

    try {
      // We use the derived key to try to decrypt the known token
      const resultBuffer = await this.encryptionService.decryptWithKey(ciphertext.buffer, key, iv);
      const resultStr = new TextDecoder().decode(resultBuffer);

      if (resultStr === 'OBSIDIAN_ENCRYPTED_VERIFICATION') {
        this.unlockedFolders.set(folder.path, key);

        // Decrypt all contents on disk for session
        await this.decryptFolderContents(folder, key);

        return true;
      }
    } catch (e) {
      console.warn('Decryption failed for folder:', folder.path);
    }

    return false;
  }

  async lockFolder(folder: TFolder): Promise<void> {
    const key = this.unlockedFolders.get(folder.path);
    if (key) {
      await this.encryptFolderContents(folder, key);
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

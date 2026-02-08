import { TFolder } from 'obsidian';
import { FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class FolderService {
  private unlockedFolders: Map<string, CryptoKey> = new Map();
  private readonly META_FILE_NAME = '.obsidian-folder-meta';

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
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
      salt: this.arrayBufferToBase64(encryptionResult.salt), // The salt used for the master key derivation
      iterations: 600000,
      lockFile: this.META_FILE_NAME,
      testToken: this.arrayBufferToBase64(combinedToken),
    };

    const metaPath = `${folder.path}/${this.META_FILE_NAME}`;
    const jsonString = JSON.stringify(metadata, null, 2);
    const encoder2 = new TextEncoder();
    await this.fileService.writeBinary(metaPath, encoder2.encode(jsonString).buffer);
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
        return true;
      }
    } catch (e) {
      console.warn('Decryption failed for folder:', folder.path);
    }

    return false;
  }

  lockFolder(folder: TFolder): void {
    this.unlockedFolders.delete(folder.path);
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

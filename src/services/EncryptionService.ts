export interface EncryptionResult {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  salt: Uint8Array;
}

export interface DecryptionResult {
  plaintext: ArrayBuffer;
}

export interface IEncryptionService {
  encrypt(data: ArrayBuffer, password: string): Promise<EncryptionResult>;
  decrypt(ciphertext: ArrayBuffer, password: string, iv: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer>;
  generateSalt(length?: number): Uint8Array;
  generateIV(length?: number): Uint8Array;
  deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
  encryptWithKey(data: ArrayBuffer, key: CryptoKey): Promise<EncryptionResult>;
  decryptWithKey(ciphertext: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer>;
  generateMasterKey(): Promise<CryptoKey>;
  exportKey(key: CryptoKey): Promise<ArrayBuffer>;
  importKey(data: ArrayBuffer): Promise<CryptoKey>;
}

export class EncryptionService implements IEncryptionService {
  private readonly ITERATIONS = 600000;
  private readonly KEY_LENGTH = 256;
  private readonly DIGEST = 'SHA-256';

  generateSalt(length = 16): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(length) as any);
  }

  generateIV(length = 12): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(length) as any);
  }

  private async importPassword(password: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    return window.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  }

  async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const passwordKey = await this.importPassword(password);
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as any,
        iterations: this.ITERATIONS,
        hash: this.DIGEST,
      },
      passwordKey,
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async encryptWithKey(data: ArrayBuffer, key: CryptoKey): Promise<EncryptionResult> {
    const iv = this.generateIV();
    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as any,
      },
      key,
      data as any,
    );
    return {
      ciphertext,
      iv,
      salt: new Uint8Array(0),
    };
  }

  async decryptWithKey(ciphertext: ArrayBuffer, key: CryptoKey, iv: Uint8Array): Promise<ArrayBuffer> {
    return window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as any,
      },
      key,
      ciphertext as any,
    );
  }

  async encrypt(data: ArrayBuffer, password: string): Promise<EncryptionResult> {
    const salt = this.generateSalt();
    const derivedKey = await this.deriveKey(password, salt);
    const result = await this.encryptWithKey(data, derivedKey);
    result.salt = salt;
    return result;
  }

  async decrypt(ciphertext: ArrayBuffer, password: string, iv: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer> {
    const derivedKey = await this.deriveKey(password, salt);
    return this.decryptWithKey(ciphertext, derivedKey, iv);
  }

  async generateMasterKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      true, // extractable
      ['encrypt', 'decrypt'],
    );
  }

  async exportKey(key: CryptoKey): Promise<ArrayBuffer> {
    return window.crypto.subtle.exportKey('raw', key);
  }

  async importKey(data: ArrayBuffer): Promise<CryptoKey> {
    return window.crypto.subtle.importKey('raw', data as any, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }
}

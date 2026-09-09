export interface EncryptionResult {
  ciphertext: ArrayBuffer;
  iv: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
}

export interface DecryptionResult {
  plaintext: ArrayBuffer;
}

export interface IEncryptionService {
  encrypt(data: ArrayBuffer, password: string): Promise<EncryptionResult>;
  decrypt(ciphertext: ArrayBuffer, password: string, iv: Uint8Array, salt: Uint8Array): Promise<ArrayBuffer>;
  generateSalt(length?: number): Uint8Array<ArrayBuffer>;
  generateIV(length?: number): Uint8Array<ArrayBuffer>;
  deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
  encryptWithKey(data: BufferSource, key: CryptoKey): Promise<EncryptionResult>;
  decryptWithKey(ciphertext: BufferSource, key: CryptoKey, iv: BufferSource): Promise<ArrayBuffer>;
  generateMasterKey(extractable?: boolean): Promise<CryptoKey>;
  exportKey(key: CryptoKey): Promise<ArrayBuffer>;
  importKey(data: ArrayBuffer, extractable?: boolean): Promise<CryptoKey>;
  deriveHmacKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
  computeHmac(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer>;
  verifyHmac(key: CryptoKey, signature: ArrayBuffer, data: ArrayBuffer): Promise<boolean>;
}

export interface DerivedSecretKeys {
  encryptionKey: CryptoKey;
  hmacKey: CryptoKey;
}

export class EncryptionService implements IEncryptionService {
  private readonly ITERATIONS = 600000;
  private readonly KEY_LENGTH = 256;
  private readonly DIGEST = 'SHA-256';

  private toBufferView(view: Uint8Array): Uint8Array<ArrayBuffer> {
    return new Uint8Array(view);
  }

  generateSalt(length = 16): Uint8Array<ArrayBuffer> {
    return new Uint8Array(window.crypto.getRandomValues(new Uint8Array(length)).buffer);
  }

  generateIV(length = 12): Uint8Array<ArrayBuffer> {
    return new Uint8Array(window.crypto.getRandomValues(new Uint8Array(length)).buffer);
  }

  private async importPassword(password: string): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    return window.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveKey',
      'deriveBits',
    ]);
  }

  async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const passwordKey = await this.importPassword(password);
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',

        salt: this.toBufferView(salt),
        iterations: this.ITERATIONS,
        hash: this.DIGEST,
      },
      passwordKey,
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async deriveHmacKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const passwordKey = await this.importPassword(password);
    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.toBufferView(salt),
        iterations: this.ITERATIONS,
        hash: this.DIGEST,
      },
      passwordKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
  }

  /**
   * Derives both the AES-GCM wrapping key and the HMAC metadata key from a
   * single PBKDF2 execution (512-bit output split in two). Prefer this over
   * calling deriveKey + deriveHmacKey separately, which pays the full KDF
   * cost twice per secret.
   */
  async deriveSecretKeys(password: string, salt: Uint8Array): Promise<DerivedSecretKeys> {
    const passwordKey = await this.importPassword(password);
    const bits = await window.crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: this.toBufferView(salt),
        iterations: this.ITERATIONS,
        hash: this.DIGEST,
      },
      passwordKey,
      512,
    );
    const raw = new Uint8Array(bits);
    const encryptionKey = await window.crypto.subtle.importKey(
      'raw',
      raw.slice(0, 32),
      { name: 'AES-GCM', length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt'],
    );
    const hmacKey = await window.crypto.subtle.importKey(
      'raw',
      raw.slice(32, 64),
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign', 'verify'],
    );
    return { encryptionKey, hmacKey };
  }

  async computeHmac(key: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
    return window.crypto.subtle.sign('HMAC', key, data);
  }

  async verifyHmac(key: CryptoKey, signature: ArrayBuffer, data: ArrayBuffer): Promise<boolean> {
    return window.crypto.subtle.verify('HMAC', key, signature, data);
  }

  async encryptWithKey(data: BufferSource, key: CryptoKey): Promise<EncryptionResult> {
    const iv = this.generateIV();
    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: this.toBufferView(iv),
        tagLength: 128,
      },
      key,
      data,
    );
    return {
      ciphertext,
      iv,
      salt: new Uint8Array(0),
    };
  }

  async decryptWithKey(ciphertext: BufferSource, key: CryptoKey, iv: BufferSource): Promise<ArrayBuffer> {
    return window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128,
      },
      key,
      ciphertext,
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
    return this.decryptWithKey(ciphertext, derivedKey, this.toBufferView(iv));
  }

  async generateMasterKey(extractable = false): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey({ name: 'AES-GCM', length: this.KEY_LENGTH }, extractable, [
      'encrypt',
      'decrypt',
    ]);
  }

  async exportKey(key: CryptoKey): Promise<ArrayBuffer> {
    return window.crypto.subtle.exportKey('raw', key);
  }

  async importKey(data: ArrayBuffer, extractable = false): Promise<CryptoKey> {
    return window.crypto.subtle.importKey('raw', data, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
  }
}

/**
 * Single-entry memoizer for secret derivations, scoped to one password
 * prompt session (e.g. a PasswordModal instance). Repeated submissions of
 * the same secret reuse the derived keys instead of re-paying PBKDF2;
 * call clear() when the session ends to drop key material promptly.
 */
export class KeyDerivationCache {
  private entry: { password: string; salt: Uint8Array; keys: DerivedSecretKeys } | null = null;

  constructor(private derive: (password: string, salt: Uint8Array) => Promise<DerivedSecretKeys>) {}

  async deriveSecretKeys(password: string, salt: Uint8Array): Promise<DerivedSecretKeys> {
    const cached = this.entry;
    if (cached && cached.password === password && bytesEqual(cached.salt, salt)) {
      return cached.keys;
    }
    this.clear();
    const keys = await this.derive(password, salt);
    this.entry = { password, salt: salt.slice(), keys };
    return keys;
  }

  clear(): void {
    this.entry = null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

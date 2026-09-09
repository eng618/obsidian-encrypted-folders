import { TFolder, normalizePath } from 'obsidian';
import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class MetadataManager {
  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly META_SCHEMA_VERSION = 2;
  private readonly MIN_KDF_ITERATIONS = 600000;
  private readonly MAX_LAST_ERROR_LENGTH = 500;

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
    private debugLogger?: (message: string, data?: unknown) => void,
  ) {}

  getMetaPath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.META_FILE_NAME}`);
  }

  /**
   * Validates untrusted metadata content and returns a typed object.
   * Throws on malformed, unsupported, or tampered-looking metadata so
   * callers fail closed instead of operating on attacker-influenced data.
   */
  parseMetadata(contentStr: string): FolderMetadata {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contentStr);
    } catch {
      throw new Error('Encrypted folder metadata is not valid JSON.');
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Encrypted folder metadata has an unexpected shape.');
    }

    const metadata = parsed as Record<string, unknown>;
    const fail = (reason: string): never => {
      throw new Error(`Encrypted folder metadata is invalid: ${reason}`);
    };

    if (typeof metadata.version !== 'number' || !Number.isFinite(metadata.version)) {
      fail('version must be a number');
    }
    if (typeof metadata.schemaVersion !== 'number' || !Number.isFinite(metadata.schemaVersion)) {
      fail('schemaVersion must be a number');
    }
    if ((metadata.schemaVersion as number) > this.META_SCHEMA_VERSION) {
      fail(`unsupported schemaVersion ${metadata.schemaVersion as number}`);
    }
    if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
      fail('id must be a non-empty string');
    }
    if (metadata.encryptionMethod !== 'AES-256-GCM') {
      fail('unsupported encryptionMethod');
    }
    if (metadata.kdfMethod !== 'PBKDF2-SHA256') {
      fail('unsupported kdfMethod');
    }
    if (typeof metadata.salt !== 'string' || metadata.salt.length === 0) {
      fail('salt must be a non-empty string');
    }
    if (typeof metadata.iterations !== 'number' || metadata.iterations < this.MIN_KDF_ITERATIONS) {
      fail(`iterations must be >= ${this.MIN_KDF_ITERATIONS}`);
    }
    if (typeof metadata.lockFile !== 'string' || metadata.lockFile.length === 0) {
      fail('lockFile must be a non-empty string');
    }
    for (const field of ['testToken', 'wrappedMasterKey', 'masterKeyIV'] as const) {
      if (typeof metadata[field] !== 'string' || metadata[field].length === 0) {
        fail(`${field} must be a non-empty string`);
      }
    }
    if (metadata.state !== undefined && !isLifecycleState(metadata.state)) {
      fail('state has an unexpected value');
    }
    if (metadata.lastTransitionAt !== undefined && typeof metadata.lastTransitionAt !== 'number') {
      fail('lastTransitionAt must be a number');
    }
    if (metadata.lastError !== undefined && typeof metadata.lastError !== 'string') {
      fail('lastError must be a string');
    }
    if (
      metadata.expectedLockedFiles !== undefined &&
      (typeof metadata.expectedLockedFiles !== 'number' ||
        !Number.isFinite(metadata.expectedLockedFiles) ||
        metadata.expectedLockedFiles < 0)
    ) {
      fail('expectedLockedFiles must be a non-negative number');
    }

    return parsed as FolderMetadata;
  }

  ensureCurrentSchema(metadata: FolderMetadata): FolderMetadata {
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

  async readMetadata(folder: TFolder): Promise<FolderMetadata | null> {
    const metaFile = this.fileService.getFile(this.getMetaPath(folder.path));
    if (!metaFile) {
      return null;
    }

    const contentBuffer = await this.fileService.readBinary(metaFile);
    const contentStr = new TextDecoder().decode(contentBuffer);
    // Throws on corrupt/unsupported metadata so callers fail closed.
    const metadata = this.parseMetadata(contentStr);
    return this.ensureCurrentSchema(metadata);
  }

  async writeMetadata(folderPath: string, metadata: FolderMetadata): Promise<void> {
    const metaPath = this.getMetaPath(folderPath);
    const content = JSON.stringify(metadata, null, 2);
    await this.fileService.writeBinary(metaPath, new TextEncoder().encode(content).buffer);
  }

  async transitionMetadataState(
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
      lastError: lastError?.slice(0, this.MAX_LAST_ERROR_LENGTH),
    };

    await this.writeMetadata(folder.path, nextMetadata);
    this.debugLogger?.('metadata state transition', { folder: folder.path, state, hasError: Boolean(lastError) });
    return nextMetadata;
  }

  async computeMetadataMac(metadata: FolderMetadata, secret: string, isRecovery = false): Promise<string> {
    const saltStr = isRecovery ? metadata.recoverySalt : metadata.salt;
    if (!saltStr) {
      throw new Error('Metadata is missing salt for MAC computation');
    }
    const salt = new Uint8Array(this.base64ToArrayBuffer(saltStr));
    const hmacKey = await this.encryptionService.deriveHmacKey(secret, salt);
    return this.computeMetadataMacWithKey(metadata, hmacKey);
  }

  /**
   * MAC computation from an already-derived HMAC key (see
   * EncryptionService.deriveSecretKeys). Avoids re-paying PBKDF2 when the
   * caller already derived keys for unwrapping.
   */
  async computeMetadataMacWithKey(metadata: FolderMetadata, hmacKey: CryptoKey): Promise<string> {
    const payload = `${metadata.id}:${metadata.version}:${metadata.salt}:${metadata.iterations}:${metadata.wrappedMasterKey}:${metadata.testToken}`;
    const hmacBuffer = await this.encryptionService.computeHmac(hmacKey, new TextEncoder().encode(payload).buffer);
    return this.arrayBufferToBase64(hmacBuffer);
  }

  async verifyMetadataMac(metadata: FolderMetadata, secret: string, isRecovery = false): Promise<boolean> {
    const macToCheck = isRecovery ? metadata.recoveryMac : metadata.mac;
    if (!macToCheck) {
      // Legacy metadata written before MACs existed. The password is still
      // verified by the wrapped-key + testToken decrypt in
      // getMasterKeyFromSecret; callers should migrate by writing a MAC after
      // a successful unlock. Never treat a present-but-wrong MAC as valid.
      this.debugLogger?.('metadata missing MAC, falling back to legacy verification', {
        folderId: metadata.id,
        isRecovery,
      });
      return true;
    }
    const expectedMac = await this.computeMetadataMac(metadata, secret, isRecovery);
    return macsEqual(macToCheck, expectedMac);
  }

  /**
   * MAC verification from an already-derived HMAC key. Same legacy
   * fallback semantics as verifyMetadataMac.
   */
  async verifyMetadataMacWithKey(metadata: FolderMetadata, hmacKey: CryptoKey, isRecovery = false): Promise<boolean> {
    const macToCheck = isRecovery ? metadata.recoveryMac : metadata.mac;
    if (!macToCheck) {
      this.debugLogger?.('metadata missing MAC, falling back to legacy verification', {
        folderId: metadata.id,
        isRecovery,
      });
      return true;
    }
    const expectedMac = await this.computeMetadataMacWithKey(metadata, hmacKey);
    return macsEqual(macToCheck, expectedMac);
  }

  arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

const LIFECYCLE_STATES: ReadonlySet<unknown> = new Set(['locked', 'unlocked', 'locking', 'unlocking', 'error']);

function isLifecycleState(value: unknown): value is FolderLifecycleState {
  return LIFECYCLE_STATES.has(value);
}

/**
 * Constant-time MAC comparison over decoded bytes. Returns false on any
 * length mismatch or decode failure instead of throwing, so verification
 * stays fail-closed without leaking prefix information via early exit.
 */
export function macsEqual(a: string, b: string): boolean {
  let aBytes: Uint8Array;
  let bBytes: Uint8Array;
  try {
    aBytes = decodeBase64ToBytes(a);
    bBytes = decodeBase64ToBytes(b);
  } catch {
    return false;
  }
  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

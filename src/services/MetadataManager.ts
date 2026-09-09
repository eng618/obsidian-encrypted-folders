import { TFolder, normalizePath } from 'obsidian';
import { FolderLifecycleState, FolderMetadata } from '../models/FolderState';
import { EncryptionService } from './EncryptionService';
import { FileService } from './FileService';

export class MetadataManager {
  private readonly META_FILE_NAME = 'obsidian-folder-meta.json';
  private readonly META_SCHEMA_VERSION = 2;

  constructor(
    private encryptionService: EncryptionService,
    private fileService: FileService,
    private debugLogger?: (message: string, data?: unknown) => void,
  ) {}

  getMetaPath(folderPath: string): string {
    return normalizePath(`${folderPath}/${this.META_FILE_NAME}`);
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
    const metadata = JSON.parse(contentStr) as FolderMetadata;
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
      lastError,
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
    const payload = `${metadata.id}:${metadata.version}:${metadata.salt}:${metadata.iterations}:${metadata.wrappedMasterKey}:${metadata.testToken}`;
    const hmacBuffer = await this.encryptionService.computeHmac(hmacKey, new TextEncoder().encode(payload).buffer);
    return this.arrayBufferToBase64(hmacBuffer);
  }

  async verifyMetadataMac(metadata: FolderMetadata, secret: string, isRecovery = false): Promise<boolean> {
    const macToCheck = isRecovery ? metadata.recoveryMac : metadata.mac;
    if (!macToCheck) {
      return true; // Legacy metadata without MAC
    }
    const expectedMac = await this.computeMetadataMac(metadata, secret, isRecovery);
    return macToCheck === expectedMac;
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

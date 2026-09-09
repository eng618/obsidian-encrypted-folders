import { FolderMetadata } from '../models/FolderState';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { MetadataManager, macsEqual } from '../services/MetadataManager';
import { TFile, TFolder } from './mocks/obsidian';

describe('MetadataManager', () => {
  let encryptionService: EncryptionService;
  let fileService: FileService;
  let metadataManager: MetadataManager;
  let mockVault: any;

  beforeEach(() => {
    encryptionService = new EncryptionService();
    mockVault = {
      files: new Map(),
      readBinary: async (file: TFile) => file.data || new ArrayBuffer(0),
      createBinary: async (path: string, data: ArrayBuffer) => {
        const file = new TFile();
        file.path = path;
        file.data = data;
        mockVault.files.set(path, file);
        return file;
      },
      getAbstractFileByPath: (path: string) => mockVault.files.get(path) || null,
    };
    fileService = new FileService(mockVault as any, async () => {});
    metadataManager = new MetadataManager(encryptionService, fileService);
  });

  test('should return metadata path for a folder', () => {
    expect(metadataManager.getMetaPath('notes')).toBe('notes/obsidian-folder-meta.json');
  });

  test('should write and read metadata correctly', async () => {
    const folder = new TFolder();
    folder.path = 'my-folder';

    const sampleMeta: FolderMetadata = {
      version: 2,
      schemaVersion: 2,
      id: 'test-id-123',
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: 'c2FsdA==',
      iterations: 600000,
      lockFile: 'obsidian-folder-meta.json',
      testToken: 'dG9rZW4=',
      wrappedMasterKey: 'd3JhcHBlZA==',
      masterKeyIV: 'aXY=',
    };

    await metadataManager.writeMetadata(folder.path, sampleMeta);
    const readMeta = await metadataManager.readMetadata(folder as any);

    expect(readMeta).not.toBeNull();
    expect(readMeta?.id).toBe('test-id-123');
    expect(readMeta?.schemaVersion).toBe(2);
  });

  test('should compute and verify metadata MAC signature', async () => {
    const password = 'secure-password';
    const sampleMeta: FolderMetadata = {
      version: 2,
      schemaVersion: 2,
      id: 'test-id-mac',
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: metadataManager.arrayBufferToBase64(encryptionService.generateSalt()),
      iterations: 600000,
      lockFile: 'obsidian-folder-meta.json',
      testToken: 'token-data',
      wrappedMasterKey: 'wrapped-key-data',
      masterKeyIV: 'iv-data',
    };

    const mac = await metadataManager.computeMetadataMac(sampleMeta, password, false);
    sampleMeta.mac = mac;

    const isValid = await metadataManager.verifyMetadataMac(sampleMeta, password, false);
    expect(isValid).toBe(true);

    const isWrongPasswordValid = await metadataManager.verifyMetadataMac(sampleMeta, 'wrong-password', false);
    expect(isWrongPasswordValid).toBe(false);
  });

  test('should treat missing MAC as legacy and still verify password via MAC when present', async () => {
    const sampleMeta: FolderMetadata = {
      version: 2,
      schemaVersion: 1,
      id: 'legacy-no-mac',
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: metadataManager.arrayBufferToBase64(encryptionService.generateSalt()),
      iterations: 600000,
      lockFile: 'obsidian-folder-meta.json',
      testToken: 'token-data',
      wrappedMasterKey: 'wrapped-key-data',
      masterKeyIV: 'iv-data',
    };

    // Legacy path: no MAC stored yet — verification defers to wrapped-key/testToken.
    expect(await metadataManager.verifyMetadataMac(sampleMeta, 'any-password', false)).toBe(true);
  });

  test('should reject malformed, unsupported, and tampered-looking metadata', () => {
    const valid: FolderMetadata = {
      version: 2,
      schemaVersion: 2,
      id: 'valid-id',
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: 'c2FsdA==',
      iterations: 600000,
      lockFile: 'obsidian-folder-meta.json',
      testToken: 'dG9rZW4=',
      wrappedMasterKey: 'd3JhcHBlZA==',
      masterKeyIV: 'aXY=',
    };

    expect(() => metadataManager.parseMetadata(JSON.stringify(valid))).not.toThrow();
    expect(() => metadataManager.parseMetadata('not json{{{')).toThrow(/not valid JSON/);
    expect(() => metadataManager.parseMetadata('42')).toThrow(/unexpected shape/);
    expect(() => metadataManager.parseMetadata(JSON.stringify({ ...valid, encryptionMethod: 'AES-128-CBC' }))).toThrow(
      /encryptionMethod/,
    );
    expect(() => metadataManager.parseMetadata(JSON.stringify({ ...valid, iterations: 1000 }))).toThrow(/iterations/);
    expect(() => metadataManager.parseMetadata(JSON.stringify({ ...valid, schemaVersion: 99 }))).toThrow(
      /unsupported schemaVersion/,
    );
    expect(() => metadataManager.parseMetadata(JSON.stringify({ ...valid, state: 'melting' }))).toThrow(/state/);
    expect(() => metadataManager.parseMetadata(JSON.stringify({ ...valid, expectedLockedFiles: -1 }))).toThrow(
      /expectedLockedFiles/,
    );
  });

  test('should cap lastError length on state transitions', async () => {
    const folder = new TFolder();
    folder.path = 'err-folder';
    const meta: FolderMetadata = {
      version: 2,
      schemaVersion: 2,
      id: 'err-id',
      encryptionMethod: 'AES-256-GCM',
      kdfMethod: 'PBKDF2-SHA256',
      salt: 'c2FsdA==',
      iterations: 600000,
      lockFile: 'obsidian-folder-meta.json',
      testToken: 'dG9rZW4=',
      wrappedMasterKey: 'd3JhcHBlZA==',
      masterKeyIV: 'aXY=',
    };
    const next = await metadataManager.transitionMetadataState(folder as any, meta, 'error', 'x'.repeat(2000));
    expect(next.lastError?.length).toBeLessThanOrEqual(500);
  });

  test('macsEqual compares in constant time and fails closed', () => {
    const a = metadataManager.arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer);
    const b = metadataManager.arrayBufferToBase64(new Uint8Array([1, 2, 3]).buffer);
    const c = metadataManager.arrayBufferToBase64(new Uint8Array([1, 2, 4]).buffer);
    expect(macsEqual(a, b)).toBe(true);
    expect(macsEqual(a, c)).toBe(false);
    expect(macsEqual(a, '!!!not-base64!!!')).toBe(false);
    expect(macsEqual(a, metadataManager.arrayBufferToBase64(new Uint8Array([1, 2]).buffer))).toBe(false);
  });
});

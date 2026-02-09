import { App, TFile, TFolder } from 'obsidian';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { FolderService } from '../services/FolderService';
/* eslint-disable @typescript-eslint/no-explicit-any */

describe('FolderService Integration', () => {
  let app: App;
  let encryptionService: EncryptionService;
  let fileService: FileService;
  let folderService: FolderService;

  beforeEach(() => {
    app = new App();
    encryptionService = new EncryptionService();
    fileService = new FileService(app.vault);
    folderService = new FolderService(encryptionService, fileService, app);
  });

  test('should encrypt and unlock a folder with contents', async () => {
    // Setup mock folder and file
    const folder = new TFolder();
    folder.path = 'secret';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const file = new TFile();
    file.name = 'note.md';
    file.path = 'secret/note.md';
    file.stat = { size: 10, mtime: 0, ctime: 0 };
    (file as any).data = new TextEncoder().encode('my secret').buffer;
    file.parent = folder;
    folder.children.push(file);
    (app.vault as any).files.set(file.path, file);

    // Encrypt and lock immediately for testing
    const password = 'password123';
    const recoveryKey = await folderService.createEncryptedFolder(folder, password, true);
    expect(recoveryKey).toBeDefined();

    // Check file is encrypted and renamed (has MAGIC)
    const lockedFile = app.vault.getAbstractFileByPath('secret/note.md.locked') as TFile;
    expect(lockedFile).toBeDefined();
    const encryptedData = await app.vault.readBinary(lockedFile);
    const view = new Uint8Array(encryptedData);
    expect(new TextDecoder().decode(view.slice(0, 4))).toBe('ENC!');

    // Plaintext file should be gone
    expect(app.vault.getAbstractFileByPath('secret/note.md')).toBeNull();

    // Lock
    await folderService.lockFolder(folder);
    expect(folderService.isUnlocked(folder)).toBe(false);

    // Check README exists
    const readmeFile = app.vault.getAbstractFileByPath('secret/README_ENCRYPTED.md');
    expect(readmeFile).toBeDefined();

    // Unlock
    const success = await folderService.unlockFolder(folder, password);
    expect(success).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(true);

    // Check README is gone
    const readmeFileGone = app.vault.getAbstractFileByPath('secret/README_ENCRYPTED.md');
    expect(readmeFileGone).toBeNull();

    // Check file is decrypted and renamed back
    const decryptedFile = app.vault.getAbstractFileByPath('secret/note.md') as TFile;
    expect(decryptedFile).not.toBeNull();
    if (decryptedFile) {
      const decryptedData = await app.vault.readBinary(decryptedFile);
      expect(new TextDecoder().decode(decryptedData)).toBe('my secret');
    }
  });

  test('should unlock using recovery key', async () => {
    const folder = new TFolder();
    folder.path = 'secret2';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const password = 'password123';
    const recoveryKey = await folderService.createEncryptedFolder(folder, password);

    // Lock
    await folderService.lockFolder(folder);

    // Unlock with recovery key
    const success = await folderService.unlockFolder(folder, recoveryKey, true);
    expect(success).toBe(true);
  });

  test('should securely lock all folders', async () => {
    const folder1 = new TFolder();
    folder1.path = 'f1';
    folder1.children = [];
    (app.vault as any).files.set(folder1.path, folder1);

    const folder2 = new TFolder();
    folder2.path = 'f2';
    folder2.children = [];
    (app.vault as any).files.set(folder2.path, folder2);

    await folderService.createEncryptedFolder(folder1, 'p1');
    await folderService.createEncryptedFolder(folder2, 'p2');

    expect(folderService.isUnlocked(folder1)).toBe(true);
    expect(folderService.isUnlocked(folder2)).toBe(true);

    await folderService.lockAllFolders();

    expect(folderService.isUnlocked(folder1)).toBe(false);
    expect(folderService.isUnlocked(folder2)).toBe(false);
  });

  it('should permanently remove encryption', async () => {
    const folder = new TFolder();
    folder.path = 'to-be-decrypted';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const password = 'password123';
    await folderService.createEncryptedFolder(folder, password, true);

    // Verify it is encrypted and locked
    expect(folderService.isEncryptedFolder(folder)).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(false);
    expect((app.vault as any).files.has(`${folder.path}/obsidian-folder-meta.json`)).toBe(true);

    // Remove encryption
    const success = await folderService.removeEncryption(folder, password);

    expect(success).toBe(true);
    expect(folderService.isEncryptedFolder(folder)).toBe(false);
    expect(folderService.isUnlocked(folder)).toBe(false);

    // Metadata should be gone
    expect((app.vault as any).files.has(`${folder.path}/obsidian-folder-meta.json`)).toBe(false);
    expect((app.vault as any).files.has(`${folder.path}/README_ENCRYPTED.md`)).toBe(false);
  });

  it('should prevent nested encryption', async () => {
    const parent = new TFolder();
    parent.path = 'parent';
    parent.children = [];
    (app.vault as any).files.set(parent.path, parent);

    const sub = new TFolder();
    sub.path = 'parent/sub';
    sub.name = 'sub';
    sub.parent = parent;
    sub.children = [];
    parent.children.push(sub);
    (app.vault as any).files.set(sub.path, sub);

    // Encrypt parent
    await folderService.createEncryptedFolder(parent, 'password');

    // Attempt to encrypt subfolder
    await expect(folderService.createEncryptedFolder(sub, 'password')).rejects.toThrow(
      'Nested encryption is not allowed',
    );
  });

  it('should fail to unlock with incorrect password', async () => {
    const folder = new TFolder();
    folder.path = 'wrongpass';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    await folderService.createEncryptedFolder(folder, 'correctpass');
    await folderService.lockFolder(folder);

    const success = await folderService.unlockFolder(folder, 'wrongpass');
    expect(success).toBe(false);
    expect(folderService.isUnlocked(folder)).toBe(false);
  });

  it('should handle isEncryptedFolder for non-encrypted folder', () => {
    const folder = new TFolder();
    folder.path = 'regular';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    expect(folderService.isEncryptedFolder(folder)).toBe(false);
  });

  it('should handle encrypt and decrypt of subfolders', async () => {
    const parent = new TFolder();
    parent.path = 'parentfolder';
    parent.children = [];
    (app.vault as any).files.set(parent.path, parent);

    const subfolder = new TFolder();
    subfolder.path = 'parentfolder/subfolder';
    subfolder.name = 'subfolder';
    subfolder.parent = parent;
    subfolder.children = [];
    parent.children.push(subfolder);
    (app.vault as any).files.set(subfolder.path, subfolder);

    const subfile = new TFile();
    subfile.name = 'subfile.md';
    subfile.path = 'parentfolder/subfolder/subfile.md';
    subfile.stat = { size: 5, mtime: 0, ctime: 0 };
    (subfile as any).data = new TextEncoder().encode('hello').buffer;
    subfile.parent = subfolder;
    subfolder.children.push(subfile);
    (app.vault as any).files.set(subfile.path, subfile);

    // Encrypt parent (should recursively encrypt subfolder contents)
    const password = 'testpass';
    await folderService.createEncryptedFolder(parent, password, true);

    // Subfolder file should be encrypted
    const lockedSubfile = app.vault.getAbstractFileByPath('parentfolder/subfolder/subfile.md.locked');
    expect(lockedSubfile).toBeDefined();

    // Unlock and verify
    await folderService.unlockFolder(parent, password);
    const decryptedSubfile = app.vault.getAbstractFileByPath('parentfolder/subfolder/subfile.md') as TFile;
    expect(decryptedSubfile).toBeDefined();
  });

  it('should handle getEncryptedParent correctly', async () => {
    const parent = new TFolder();
    parent.path = 'encparent';
    parent.children = [];
    (app.vault as any).files.set(parent.path, parent);

    const child = new TFolder();
    child.path = 'encparent/child';
    child.name = 'child';
    child.parent = parent;
    child.children = [];
    parent.children.push(child);
    (app.vault as any).files.set(child.path, child);

    // Before encryption
    expect(folderService.getEncryptedParent(child)).toBeNull();

    // After encryption
    await folderService.createEncryptedFolder(parent, 'pass');
    expect(folderService.getEncryptedParent(child)).toBe(parent);
  });

  it('should correctly check isInsideEncryptedFolder', async () => {
    const outer = new TFolder();
    outer.path = 'outer';
    outer.children = [];
    (app.vault as any).files.set(outer.path, outer);

    const inner = new TFolder();
    inner.path = 'outer/inner';
    inner.name = 'inner';
    inner.parent = outer;
    inner.children = [];
    outer.children.push(inner);
    (app.vault as any).files.set(inner.path, inner);

    expect(folderService.isInsideEncryptedFolder(inner)).toBe(false);

    await folderService.createEncryptedFolder(outer, 'securepass');

    expect(folderService.isInsideEncryptedFolder(inner)).toBe(true);
  });

  it('should handle unlockFolder when folder is not encrypted', async () => {
    const folder = new TFolder();
    folder.path = 'notencrypted';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    // Try to unlock a non-encrypted folder
    const success = await folderService.unlockFolder(folder, 'anypass');
    expect(success).toBe(false);
  });
});

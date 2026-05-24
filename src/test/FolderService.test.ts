import { App, TFile, TFolder } from 'obsidian';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { FolderService } from '../services/FolderService';

describe('FolderService Integration', () => {
  let app: App;
  let encryptionService: EncryptionService;
  let fileService: FileService;
  let folderService: FolderService;

  beforeEach(() => {
    app = new App();
    encryptionService = new EncryptionService();
    fileService = new FileService(app.vault, (file) => app.fileManager.trashFile(file));
    folderService = new FolderService(encryptionService, fileService, app);
  });

  const requireTFile = (path: string): TFile => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`Expected TFile at path: ${path}`);
    }
    return file;
  };

  const getOptionalTFile = (path: string): TFile | null => {
    const file = app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  };

  const addFolder = (path: string, parent?: TFolder): TFolder => {
    const folder = new TFolder();
    folder.path = path;
    folder.children = [];
    if (parent) {
      folder.parent = parent;
      parent.children.push(folder);
    }
    (app.vault as any).files.set(folder.path, folder);
    return folder;
  };

  const addFile = (folder: TFolder, name: string, content: string): TFile => {
    const file = new TFile();
    file.name = name;
    file.path = `${folder.path}/${name}`;
    file.stat = { size: content.length, mtime: 0, ctime: 0 };
    (file as any).data = new TextEncoder().encode(content).buffer;
    file.parent = folder;
    folder.children.push(file);
    (app.vault as any).files.set(file.path, file);
    return file;
  };

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
    const lockedFile = requireTFile('secret/note.md.locked');
    expect(lockedFile).toBeDefined();
    const encryptedData = await app.vault.readBinary(lockedFile);
    const view = new Uint8Array(encryptedData);
    expect(new TextDecoder().decode(view.slice(0, 4))).toBe('ENC!');

    // Plaintext file should be gone
    expect(app.vault.getAbstractFileByPath('secret/note.md')).toBeNull();

    // Check README exists immediately after lock
    const readmeFile = requireTFile('secret/README_ENCRYPTED.md');
    expect(readmeFile).toBeDefined();
    const readmeContent = new TextDecoder().decode(await app.vault.readBinary(readmeFile));
    expect(readmeContent).toContain('# 🔒 secret is encrypted');
    expect(readmeContent).toContain('Mobile: Long-press this folder in the file explorer');

    // Folder should not be unlocked since we locked immediately
    expect(folderService.isUnlocked(folder)).toBe(false);

    // Unlock
    const success = await folderService.unlockFolder(folder, password);
    expect(success).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(true);

    // Check README is gone
    const readmeFileGone = app.vault.getAbstractFileByPath('secret/README_ENCRYPTED.md');
    expect(readmeFileGone).toBeNull();

    // Check file is decrypted and renamed back
    const decryptedFile = getOptionalTFile('secret/note.md');
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

  it('should auto-lock unlocked folders when the app enters the background', async () => {
    const folder = new TFolder();
    folder.path = 'background-lock';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    folderService.setAutoLockSettings({ idleMinutes: 5, lockOnBackground: true });

    await folderService.createEncryptedFolder(folder, 'password123');

    const locked = await folderService.runBackgroundAutoLock();
    expect(locked).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(false);
  });

  it('should not auto-lock on background when the safeguard is disabled', async () => {
    const folder = new TFolder();
    folder.path = 'background-disabled';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    folderService.setAutoLockSettings({ idleMinutes: 5, lockOnBackground: false });

    await folderService.createEncryptedFolder(folder, 'password123');

    const locked = await folderService.runBackgroundAutoLock();
    expect(locked).toBe(false);
    expect(folderService.isUnlocked(folder)).toBe(true);
  });

  it('should auto-lock only folders whose per-folder inactivity timeout has elapsed', async () => {
    const folderA = new TFolder();
    folderA.path = 'idle-lock-a';
    folderA.children = [];
    (app.vault as any).files.set(folderA.path, folderA);

    const folderB = new TFolder();
    folderB.path = 'idle-lock-b';
    folderB.children = [];
    (app.vault as any).files.set(folderB.path, folderB);

    folderService.setAutoLockSettings({ idleMinutes: 5, lockOnBackground: true });

    await folderService.createEncryptedFolder(folderA, 'password123');
    await folderService.createEncryptedFolder(folderB, 'password456');

    folderService.recordActivityForItem(folderA, 1_000);
    folderService.recordActivityForItem(folderB, 1_000);
    folderService.recordActivityForItem(folderB, 250_000);

    const locked = await folderService.runIdleAutoLock(301_000);
    expect(locked).toBe(true);
    expect(folderService.isUnlocked(folderA)).toBe(false);
    expect(folderService.isUnlocked(folderB)).toBe(true);
  }, 20000);

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
    const decryptedSubfile = requireTFile('parentfolder/subfolder/subfile.md');
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

  it('should recursively detect encrypted folders on sync', async () => {
    const parent = new TFolder();
    parent.path = 'nested';
    parent.children = [];
    (app.vault as any).files.set(parent.path, parent);

    const folder = new TFolder();
    folder.path = 'nested/secret';
    folder.children = [];
    folder.parent = parent;
    parent.children.push(folder);
    (app.vault as any).files.set(folder.path, folder);

    await folderService.createEncryptedFolder(folder, 'password123', true);

    const freshService = new FolderService(encryptionService, fileService, app);
    await freshService.syncFolders();

    expect(freshService.isEncryptedFolder(folder)).toBe(true);
  });

  it('should journal lock and unlock metadata state transitions', async () => {
    const folder = new TFolder();
    folder.path = 'journal';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const file = new TFile();
    file.name = 'note.md';
    file.path = 'journal/note.md';
    file.stat = { size: 10, mtime: 0, ctime: 0 };
    (file as any).data = new TextEncoder().encode('my secret').buffer;
    file.parent = folder;
    folder.children.push(file);
    (app.vault as any).files.set(file.path, file);

    await folderService.createEncryptedFolder(folder, 'password123');
    await folderService.lockFolder(folder);

    const metaLocked = requireTFile('journal/obsidian-folder-meta.json');
    const lockedData = await app.vault.readBinary(metaLocked);
    const lockedState = JSON.parse(new TextDecoder().decode(lockedData));
    expect(lockedState.state).toBe('locked');

    await folderService.unlockFolder(folder, 'password123');

    const metaUnlocked = requireTFile('journal/obsidian-folder-meta.json');
    const unlockedData = await app.vault.readBinary(metaUnlocked);
    const unlockedState = JSON.parse(new TextDecoder().decode(unlockedData));
    expect(unlockedState.state).toBe('unlocked');
  });

  it('should fail unlock when locked payload files are still syncing', async () => {
    const folder = new TFolder();
    folder.path = 'sync-gap';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const file = new TFile();
    file.name = 'note.md';
    file.path = 'sync-gap/note.md';
    file.stat = { size: 10, mtime: 0, ctime: 0 };
    (file as any).data = new TextEncoder().encode('my secret').buffer;
    file.parent = folder;
    folder.children.push(file);
    (app.vault as any).files.set(file.path, file);

    await folderService.createEncryptedFolder(folder, 'password123', true);

    const lockedFile = requireTFile('sync-gap/note.md.locked');
    expect(lockedFile).toBeDefined();

    await app.fileManager.trashFile(lockedFile);

    const success = await folderService.unlockFolder(folder, 'password123');
    expect(success).toBe(false);
    expect(folderService.isUnlocked(folder)).toBe(false);

    const metaFile = requireTFile('sync-gap/obsidian-folder-meta.json');
    const metaData = await app.vault.readBinary(metaFile);
    const metadata = JSON.parse(new TextDecoder().decode(metaData));
    expect(metadata.state).toBe('error');
    expect(metadata.lastError).toContain('Encrypted files are still syncing');
  });

  it('should lock and unlock an empty encrypted folder without getting stuck', async () => {
    const folder = new TFolder();
    folder.path = 'empty-folder';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    await folderService.createEncryptedFolder(folder, 'password123', true);

    const metaFile = requireTFile('empty-folder/obsidian-folder-meta.json');
    const lockedMetaData = await app.vault.readBinary(metaFile);
    const lockedMetadata = JSON.parse(new TextDecoder().decode(lockedMetaData));
    expect(lockedMetadata.state).toBe('locked');
    expect(lockedMetadata.expectedLockedFiles).toBe(0);

    const unlockSuccess = await folderService.unlockFolder(folder, 'password123');
    expect(unlockSuccess).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(true);

    const unlockedMetaData = await app.vault.readBinary(metaFile);
    const unlockedMetadata = JSON.parse(new TextDecoder().decode(unlockedMetaData));
    expect(unlockedMetadata.state).toBe('unlocked');
  });

  it('should rollback to plaintext if encryption is interrupted', async () => {
    const folder = new TFolder();
    folder.path = 'rollback-test';
    folder.children = [];
    (app.vault as any).files.set(folder.path, folder);

    const file1 = new TFile();
    file1.name = 'note1.md';
    file1.path = 'rollback-test/note1.md';
    file1.stat = { size: 10, mtime: 0, ctime: 0 };
    (file1 as any).data = new TextEncoder().encode('content 1').buffer;
    file1.parent = folder;
    folder.children.push(file1);
    (app.vault as any).files.set(file1.path, file1);

    const file2 = new TFile();
    file2.name = 'note2.md';
    file2.path = 'rollback-test/note2.md';
    file2.stat = { size: 10, mtime: 0, ctime: 0 };
    (file2 as any).data = new TextEncoder().encode('content 2').buffer;
    file2.parent = folder;
    folder.children.push(file2);
    (app.vault as any).files.set(file2.path, file2);

    const password = 'password123';

    // Mock a failure during the second file's processing
    const originalWriteBinary = fileService.writeBinary.bind(fileService);
    fileService.writeBinary = async (path: string, data: ArrayBuffer) => {
      if (path === 'rollback-test/note2.md.locked') {
        throw new Error('Disk full or crash');
      }
      return originalWriteBinary(path, data);
    };

    try {
      await folderService.createEncryptedFolder(folder, password, true);
      expect('should have failed').toBe('failed');
    } catch (e) {
      expect(e).toBeDefined();
    }

    // Restore original writeBinary for verification
    fileService.writeBinary = originalWriteBinary;

    // File 1 should have been rolled back to plaintext
    const restoredFile1 = getOptionalTFile('rollback-test/note1.md');
    expect(restoredFile1).not.toBeNull();
    if (restoredFile1) {
      const data = await app.vault.readBinary(restoredFile1);
      expect(new TextDecoder().decode(data)).toBe('content 1');
    }

    // File 2 should still be plaintext (never encrypted)
    const restoredFile2 = getOptionalTFile('rollback-test/note2.md');
    expect(restoredFile2).not.toBeNull();
    if (restoredFile2) {
      const data = await app.vault.readBinary(restoredFile2);
      expect(new TextDecoder().decode(data)).toBe('content 2');
    }

    // No .locked files should remain
    expect(app.vault.getAbstractFileByPath('rollback-test/note1.md.locked')).toBeNull();
    expect(app.vault.getAbstractFileByPath('rollback-test/note2.md.locked')).toBeNull();
  });

  it('should detect and reprocess plaintext files added to a locked folder', async () => {
    const folder = addFolder('locked-drop');
    addFile(folder, 'existing.md', 'existing secret');

    await folderService.createEncryptedFolder(folder, 'password123', true);

    const dropped = addFile(folder, 'dropped.md', 'new secret');
    expect(folderService.findLockedEncryptedParentWithPlaintext(dropped)).toBe(folder);
    expect(folderService.getPlaintextFilesInLockedFolder(folder).map((file) => file.path)).toEqual([
      'locked-drop/dropped.md',
    ]);

    const success = await folderService.reprocessLockedFolder(folder, 'password123');
    expect(success).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(false);
    expect(app.vault.getAbstractFileByPath('locked-drop/dropped.md')).toBeNull();

    const lockedDropped = requireTFile('locked-drop/dropped.md.locked');
    const encryptedData = await app.vault.readBinary(lockedDropped);
    expect(new TextDecoder().decode(new Uint8Array(encryptedData).slice(0, 4))).toBe('ENC!');

    const metaFile = requireTFile('locked-drop/obsidian-folder-meta.json');
    const metadata = JSON.parse(new TextDecoder().decode(await app.vault.readBinary(metaFile)));
    expect(metadata.state).toBe('locked');
    expect(metadata.expectedLockedFiles).toBe(2);
    expect(metadata.lastError).toBeUndefined();
  });

  it('should reprocess plaintext files added in nested folders', async () => {
    const folder = addFolder('locked-nested-drop');
    const child = addFolder('locked-nested-drop/child', folder);
    addFile(folder, 'existing.md', 'existing secret');

    await folderService.createEncryptedFolder(folder, 'password123', true);

    const dropped = addFile(child, 'nested.md', 'nested secret');
    expect(folderService.findLockedEncryptedParentWithPlaintext(dropped)).toBe(folder);

    const success = await folderService.reprocessLockedFolder(folder, 'password123');
    expect(success).toBe(true);
    expect(app.vault.getAbstractFileByPath('locked-nested-drop/child/nested.md')).toBeNull();
    expect(app.vault.getAbstractFileByPath('locked-nested-drop/child/nested.md.locked')).toBeDefined();
  });

  it('should leave plaintext untouched when locked folder reprocessing has the wrong password', async () => {
    const folder = addFolder('locked-drop-wrong-password');
    addFile(folder, 'existing.md', 'existing secret');

    await folderService.createEncryptedFolder(folder, 'password123', true);
    addFile(folder, 'dropped.md', 'new secret');

    const success = await folderService.reprocessLockedFolder(folder, 'wrongpass');
    expect(success).toBe(false);
    expect(app.vault.getAbstractFileByPath('locked-drop-wrong-password/dropped.md')).toBeDefined();
    expect(app.vault.getAbstractFileByPath('locked-drop-wrong-password/dropped.md.locked')).toBeNull();

    const metaFile = requireTFile('locked-drop-wrong-password/obsidian-folder-meta.json');
    const metadata = JSON.parse(new TextDecoder().decode(await app.vault.readBinary(metaFile)));
    expect(metadata.state).toBe('error');
    expect(metadata.lastError).toContain('Authentication failed');
  });

  it('should reprocess locked folder additions with a recovery key', async () => {
    const folder = addFolder('locked-drop-recovery');
    addFile(folder, 'existing.md', 'existing secret');

    const recoveryKey = await folderService.createEncryptedFolder(folder, 'password123', true);
    addFile(folder, 'dropped.md', 'new secret');

    const success = await folderService.reprocessLockedFolder(folder, recoveryKey, true);
    expect(success).toBe(true);
    expect(app.vault.getAbstractFileByPath('locked-drop-recovery/dropped.md')).toBeNull();
    expect(app.vault.getAbstractFileByPath('locked-drop-recovery/dropped.md.locked')).toBeDefined();
  });
});

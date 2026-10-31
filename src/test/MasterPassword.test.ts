import { App, TFile, TFolder } from 'obsidian';

import type { MasterPasswordRecord } from '../models/PasswordManagement';
import { describePasswordKind, sanitizePasswordLabel, validateCustomPasswordLabel } from '../models/PasswordManagement';
import { sanitizeSettings } from '../models/Settings';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { FolderService } from '../services/FolderService';

describe('PasswordManagement helpers', () => {
  test('sanitizePasswordLabel trims and caps length', () => {
    expect(sanitizePasswordLabel(undefined)).toBeUndefined();
    expect(sanitizePasswordLabel('   ')).toBeUndefined();
    expect(sanitizePasswordLabel('  Banking   docs ')).toBe('Banking docs');
    expect(sanitizePasswordLabel('x'.repeat(200))).toHaveLength(80);
  });

  test('validateCustomPasswordLabel requires a title', () => {
    expect(() => validateCustomPasswordLabel(undefined)).toThrow(/title/i);
    expect(() => validateCustomPasswordLabel('  ')).toThrow(/title/i);
    expect(validateCustomPasswordLabel('Banking')).toBe('Banking');
  });

  test('describePasswordKind is explicit', () => {
    expect(describePasswordKind('master', undefined)).toBe('Master password');
    expect(describePasswordKind('custom', 'Banking')).toBe('Custom password — "Banking"');
    expect(describePasswordKind(undefined, undefined)).toBe('Custom password');
  });

  test('sanitizeSettings drops corrupt master records', () => {
    expect(sanitizeSettings({ masterPassword: { bogus: true } as any }).masterPassword).toBeNull();
    expect(sanitizeSettings(null).masterPassword).toBeUndefined();
  });
});

describe('FolderService master password flows', () => {
  let app: App;
  let encryptionService: EncryptionService;
  let fileService: FileService;
  let folderService: FolderService;
  let masterRecord: MasterPasswordRecord | null;
  let failMasterSave = false;

  const addFolder = (path: string): TFolder => {
    const folder = new TFolder();
    folder.path = path;
    folder.name = path.split('/').pop() ?? path;
    folder.children = [];
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

  beforeEach(() => {
    app = new App();
    encryptionService = new EncryptionService();
    fileService = new FileService(app.vault, (file) => app.fileManager.trashFile(file));
    masterRecord = null;
    failMasterSave = false;
    folderService = new FolderService(encryptionService, fileService, app, {
      masterPasswordStore: {
        load: () => masterRecord,
        save: async (record) => {
          if (failMasterSave) {
            throw new Error('settings write failed');
          }
          masterRecord = record;
        },
      },
    });
  });

  test('setup, verify, and wrong-password rejection', async () => {
    expect(folderService.hasMasterPassword()).toBe(false);
    const recoveryKey = await folderService.setupMasterPassword('master-pass-123');
    expect(recoveryKey).toBeTruthy();
    expect(folderService.hasMasterPassword()).toBe(true);
    expect(await folderService.verifyMasterPassword('master-pass-123')).toBe(true);
    expect(await folderService.verifyMasterPassword('wrong')).toBe(false);
    expect(await folderService.verifyMasterRecoveryKey(recoveryKey)).toBe(true);
    expect(await folderService.verifyMasterRecoveryKey('nope')).toBe(false);
    await expect(folderService.setupMasterPassword('another-123')).rejects.toThrow(/already set/);
    await expect(folderService.setupMasterPassword('short')).rejects.toThrow(/already set/);
  });

  test('master folder round-trips with master password and auto-detect recovery', async () => {
    const recoveryKey = await folderService.setupMasterPassword('master-pass-123');
    const folder = addFolder('master-docs');
    addFile(folder, 'note.md', 'hello master');

    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('master-pass-123');
    expect(masterRecoveryKey).toBe(recoveryKey);
    const returned = await folderService.createEncryptedFolder(folder, 'master-pass-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    expect(returned).toBe(recoveryKey);

    const metadata = await folderService.readFolderMetadata(folder);
    expect(metadata?.passwordKind).toBe('master');

    // Main-box unlock with the master password.
    expect(await folderService.unlockFolderWithAutoDetect(folder, 'master-pass-123')).toBe(true);
    expect(folderService.isUnlocked(folder)).toBe(true);
    await folderService.lockFolder(folder);

    // Main-box unlock with the master recovery key (auto-detect fallback).
    expect(await folderService.unlockFolderWithAutoDetect(folder, recoveryKey)).toBe(true);
    await folderService.lockFolder(folder);

    // Wrong secret fails both slots.
    expect(await folderService.unlockFolderWithAutoDetect(folder, 'wrong-secret')).toBe(false);
  });

  test('custom folder keeps unique recovery and label', async () => {
    const folder = addFolder('custom-docs');
    addFile(folder, 'note.md', 'hello custom');
    const recoveryKey = await folderService.createEncryptedFolder(folder, 'custom-pass-123', true, undefined, {
      kind: 'custom',
      label: '  Banking   docs ',
    });
    const metadata = await folderService.readFolderMetadata(folder);
    expect(metadata?.passwordKind).toBe('custom');
    expect(metadata?.passwordLabel).toBe('Banking docs');
    expect(await folderService.unlockFolder(folder, 'custom-pass-123')).toBe(true);
    await folderService.lockFolder(folder);
    expect(await folderService.unlockFolder(folder, recoveryKey, true)).toBe(true);
  });

  test('changeMasterPassword re-wraps master folders only', async () => {
    await folderService.setupMasterPassword('old-master-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('old-master-123');

    const masterFolder = addFolder('m1');
    addFile(masterFolder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(masterFolder, 'old-master-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });

    const customFolder = addFolder('c1');
    addFile(customFolder, 'b.md', 'bbb');
    await folderService.createEncryptedFolder(customFolder, 'custom-pass-123', true, undefined, {
      kind: 'custom',
      label: 'Personal',
    });

    const { rotated, total, previousWrapsRemaining } = await folderService.changeMasterPassword(
      'old-master-123',
      'new-master-456',
    );
    expect(total).toBe(1);
    expect(rotated).toBe(1);
    expect(previousWrapsRemaining).toBe(0);
    expect((await folderService.readFolderMetadata(masterFolder))?.previousWrappedMasterKey).toBeUndefined();

    expect(await folderService.unlockFolderWithAutoDetect(masterFolder, 'new-master-456')).toBe(true);
    await folderService.lockFolder(masterFolder);
    expect(await folderService.unlockFolderWithAutoDetect(masterFolder, 'old-master-123')).toBe(false);
    // Recovery key survives the password change.
    const stillRecovery = await folderService.unwrapMasterRecoveryKey('new-master-456');
    expect(await folderService.unlockFolderWithAutoDetect(masterFolder, stillRecovery)).toBe(true);
    await folderService.lockFolder(masterFolder);
    // Custom folder untouched.
    expect(await folderService.unlockFolder(customFolder, 'custom-pass-123')).toBe(true);

    await expect(folderService.changeMasterPassword('wrong-old', 'another-new-1')).rejects.toThrow(/Incorrect/);
  });

  test('changeMasterPassword restores folders when a later write fails', async () => {
    await folderService.setupMasterPassword('old-master-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('old-master-123');
    const first = addFolder('rotate-a');
    addFile(first, 'a.md', 'aaa');
    const second = addFolder('rotate-b');
    addFile(second, 'b.md', 'bbb');
    await folderService.createEncryptedFolder(first, 'old-master-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    await folderService.createEncryptedFolder(second, 'old-master-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    const before = await folderService.readFolderMetadata(first);
    const deriveSpy = vi.spyOn(encryptionService, 'deriveSecretKeys');
    const originalWrite = fileService.writeBinary.bind(fileService);
    let failNextSecondWrite = true;
    fileService.writeBinary = async (path, data) => {
      if (failNextSecondWrite && path === 'rotate-b/obsidian-folder-meta.json') {
        failNextSecondWrite = false;
        throw new Error('disk full');
      }
      return originalWrite(path, data);
    };

    await expect(folderService.changeMasterPassword('old-master-123', 'new-master-456')).rejects.toThrow(
      /was not changed/,
    );

    // One derivation for the current master record, one for the new key,
    // and one per folder to unwrap its own salt. Not one per folder for the new key.
    expect(deriveSpy).toHaveBeenCalledTimes(4);
    deriveSpy.mockRestore();
    expect(await folderService.verifyMasterPassword('old-master-123')).toBe(true);
    expect(await folderService.verifyMasterPassword('new-master-456')).toBe(false);
    const after = await folderService.readFolderMetadata(first);
    expect(after?.salt).toBe(before?.salt);
    expect(after?.wrappedMasterKey).toBe(before?.wrappedMasterKey);
    expect(after?.previousWrappedMasterKey).toBeUndefined();
    expect(await folderService.verifyFolderSecret(first, 'old-master-123')).toBe(true);
    expect(await folderService.verifyFolderSecret(second, 'old-master-123')).toBe(true);
  }, 30000);

  test('changeMasterPassword restores folders when the settings save fails', async () => {
    await folderService.setupMasterPassword('old-master-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('old-master-123');
    const folder = addFolder('save-fail');
    addFile(folder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(folder, 'old-master-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    const before = await folderService.readFolderMetadata(folder);
    failMasterSave = true;

    await expect(folderService.changeMasterPassword('old-master-123', 'new-master-456')).rejects.toThrow(
      /Settings save failed/,
    );

    expect(await folderService.verifyMasterPassword('old-master-123')).toBe(true);
    const after = await folderService.readFolderMetadata(folder);
    expect(after?.salt).toBe(before?.salt);
    expect(after?.wrappedMasterKey).toBe(before?.wrappedMasterKey);
    expect(after?.previousWrappedMasterKey).toBeUndefined();
    expect(await folderService.verifyFolderSecret(folder, 'old-master-123')).toBe(true);
  }, 30000);

  test('previous password wrap keeps the old password working until sync clears it', async () => {
    await folderService.setupMasterPassword('old-master-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('old-master-123');
    const folder = addFolder('cleanup-later');
    addFile(folder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(folder, 'old-master-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });

    const originalWrite = fileService.writeBinary.bind(fileService);
    let rejectCleanup = true;
    fileService.writeBinary = async (path, data) => {
      if (rejectCleanup && path.endsWith('obsidian-folder-meta.json')) {
        const parsed = JSON.parse(new TextDecoder().decode(data)) as { previousWrappedMasterKey?: string };
        if (!parsed.previousWrappedMasterKey) {
          throw new Error('cleanup failed');
        }
      }
      return originalWrite(path, data);
    };

    const result = await folderService.changeMasterPassword('old-master-123', 'new-master-456');
    expect(result.previousWrapsRemaining).toBe(1);
    expect((await folderService.readFolderMetadata(folder))?.previousWrappedMasterKey).toBeTruthy();
    expect(await folderService.verifyFolderSecret(folder, 'new-master-456')).toBe(true);
    expect(await folderService.verifyFolderSecret(folder, 'old-master-123')).toBe(true);

    rejectCleanup = false;
    fileService.writeBinary = originalWrite;
    await folderService.syncFolders();
    expect((await folderService.readFolderMetadata(folder))?.previousWrappedMasterKey).toBeUndefined();
    expect(await folderService.verifyMasterPassword('new-master-456')).toBe(true);
    expect(await folderService.verifyFolderSecret(folder, 'old-master-123')).toBe(false);
    expect(await folderService.verifyFolderSecret(folder, 'new-master-456')).toBe(true);
  }, 30000);

  test('removeMasterPassword is blocked while master folders exist', async () => {
    await folderService.setupMasterPassword('master-pass-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('master-pass-123');
    const folder = addFolder('blocked');
    addFile(folder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(folder, 'master-pass-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    await expect(folderService.removeMasterPassword('master-pass-123')).rejects.toThrow(/Convert them/);
    await expect(folderService.removeMasterPassword('wrong')).rejects.toThrow(/Incorrect/);
  });

  test('convert master to custom and back', async () => {
    await folderService.setupMasterPassword('master-pass-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('master-pass-123');
    const folder = addFolder('convert-me');
    addFile(folder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(folder, 'master-pass-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });

    const customRecovery = await folderService.convertToCustom(folder, 'master-pass-123', 'custom-new-123', 'Work');
    let metadata = await folderService.readFolderMetadata(folder);
    expect(metadata?.passwordKind).toBe('custom');
    expect(metadata?.passwordLabel).toBe('Work');
    expect(metadata?.wrappedMasterKeyMasterRecovery).toBeUndefined();
    expect(await folderService.unlockFolder(folder, 'custom-new-123')).toBe(true);
    await folderService.lockFolder(folder);
    expect(await folderService.unlockFolder(folder, customRecovery, true)).toBe(true);
    await folderService.lockFolder(folder);

    await folderService.convertToMaster(folder, 'custom-new-123', 'master-pass-123');
    metadata = await folderService.readFolderMetadata(folder);
    expect(metadata?.passwordKind).toBe('master');
    expect(metadata?.passwordLabel).toBeUndefined();
    expect(metadata?.wrappedMasterKeyMasterRecovery).toBeTruthy();
    // Old custom secret no longer works.
    expect(await folderService.unlockFolderWithAutoDetect(folder, 'custom-new-123')).toBe(false);
    expect(await folderService.unlockFolderWithAutoDetect(folder, 'master-pass-123')).toBe(true);
    await folderService.lockFolder(folder);
  });

  test('changeCustomPassword rotates secret and recovery', async () => {
    const folder = addFolder('rotate-me');
    addFile(folder, 'a.md', 'aaa');
    const oldRecovery = await folderService.createEncryptedFolder(folder, 'custom-old-123', true, undefined, {
      kind: 'custom',
      label: 'Diary',
    });
    const newRecovery = await folderService.changeCustomPassword(folder, 'custom-old-123', 'custom-new-456');
    expect(newRecovery).not.toBe(oldRecovery);
    expect(await folderService.unlockFolder(folder, 'custom-new-456')).toBe(true);
    await folderService.lockFolder(folder);
    expect(await folderService.unlockFolder(folder, 'custom-old-123')).toBe(false);
    expect(await folderService.unlockFolder(folder, newRecovery, true)).toBe(true);
    const metadata = await folderService.readFolderMetadata(folder);
    expect(metadata?.passwordLabel).toBe('Diary');
    await expect(folderService.changeCustomPassword(folder, 'wrong', 'another-new-1')).rejects.toThrow(
      /Authentication failed/,
    );
  });

  test('relabelFolder requires secret while locked', async () => {
    const folder = addFolder('relabel-me');
    addFile(folder, 'a.md', 'aaa');
    await folderService.createEncryptedFolder(folder, 'custom-pass-123', true, undefined, {
      kind: 'custom',
      label: 'Old',
    });
    await expect(folderService.relabelFolder(folder, 'New')).rejects.toThrow(/required/);
    await expect(folderService.relabelFolder(folder, 'New', 'wrong')).rejects.toThrow(/Authentication failed/);
    await folderService.relabelFolder(folder, '  New Title ', 'custom-pass-123');
    expect((await folderService.readFolderMetadata(folder))?.passwordLabel).toBe('New Title');
    await expect(folderService.relabelFolder(folder, '   ')).rejects.toThrow(/title is required/);
  });

  test('listFolderPasswordKinds summarizes folders', async () => {
    await folderService.setupMasterPassword('master-pass-123');
    const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey('master-pass-123');
    const m = addFolder('m');
    addFile(m, 'a.md', 'a');
    await folderService.createEncryptedFolder(m, 'master-pass-123', true, undefined, {
      kind: 'master',
      masterRecoveryKey,
    });
    const c = addFolder('c');
    addFile(c, 'a.md', 'a');
    await folderService.createEncryptedFolder(c, 'custom-pass-123', true, undefined, {
      kind: 'custom',
      label: 'Stuff',
    });
    const summaries = await folderService.listFolderPasswordKinds();
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.path === 'm')?.kind).toBe('master');
    expect(summaries.find((s) => s.path === 'c')?.label).toBe('Stuff');
  });
});

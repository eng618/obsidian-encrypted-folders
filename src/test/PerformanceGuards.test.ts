import { App, TFile, TFolder } from 'obsidian';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { FolderService } from '../services/FolderService';
import { IdleLockController } from '../ui/IdleLockController';

describe('Performance guards', () => {
  let app: App;
  let folderService: FolderService;
  let fileService: FileService;

  beforeEach(() => {
    app = new App();
    const encryptionService = new EncryptionService();
    fileService = new FileService(app.vault, (file) => app.fileManager.trashFile(file));
    folderService = new FolderService(encryptionService, fileService, app);
  });

  function addFolder(path: string): TFolder {
    const folder = new TFolder();
    folder.path = path;
    folder.children = [];
    (app.vault as any).files.set(path, folder);
    return folder;
  }

  function addFile(folder: TFolder, name: string, content: string): TFile {
    const file = new TFile();
    file.name = name;
    file.path = `${folder.path}/${name}`;
    file.stat = { size: content.length, mtime: 0, ctime: 0 };
    (file as any).data = new TextEncoder().encode(content).buffer;
    file.parent = folder;
    folder.children.push(file);
    (app.vault as any).files.set(file.path, file);
    return file;
  }

  test('getEncryptedParent memoizes lookups between structural changes', async () => {
    const folder = addFolder('vault-notes');
    const file = addFile(folder, 'note.md', 'content');
    await folderService.createEncryptedFolder(folder, 'password123', true);

    const getFileSpy = vi.spyOn(fileService, 'getFile');
    expect(folderService.getEncryptedParent(file)).toBe(folder);
    const callsAfterFirst = getFileSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second lookup for the same path is served from cache.
    expect(folderService.getEncryptedParent(file)).toBe(folder);
    expect(getFileSpy.mock.calls.length).toBe(callsAfterFirst);

    // Structural invalidation drops the cache entry.
    folderService.invalidateEncryptedParentCache();
    expect(folderService.getEncryptedParent(file)).toBe(folder);
    expect(getFileSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    getFileSpy.mockRestore();
  });

  test('idle tick skips all countdown work when nothing is unlocked', async () => {
    const mockFolderService = {
      getUnlockedFolderPaths: vi.fn(() => [] as string[]),
      getNextIdleLockCountdown: vi.fn(() => null),
      runIdleAutoLock: vi.fn(async () => false),
      recordActivityForItem: vi.fn(),
    };
    const controller = new IdleLockController(app, mockFolderService as any, () => 60);

    await controller.handleIdleAutoLock();

    expect(mockFolderService.getNextIdleLockCountdown).not.toHaveBeenCalled();
    expect(mockFolderService.runIdleAutoLock).not.toHaveBeenCalled();
  });

  test('oversized files fail fast without allocating buffers', async () => {
    const folder = addFolder('big');
    const file = addFile(folder, 'huge.bin', 'x');
    file.stat.size = 65 * 1024 * 1024;
    const key = await new EncryptionService().generateMasterKey();

    const readSpy = vi.spyOn(fileService, 'readBinary');
    await expect(folderService.encryptFile(file, key)).rejects.toThrow(/64 MB per-file limit/);
    await expect(folderService.decryptFile(file, key)).rejects.toThrow(/64 MB per-file limit/);
    expect(readSpy).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });
});

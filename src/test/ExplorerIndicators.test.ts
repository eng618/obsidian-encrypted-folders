import { describe, expect, it, vi } from 'vitest';
import { EncryptionService } from '../services/EncryptionService';
import { FileService } from '../services/FileService';
import { FolderService } from '../services/FolderService';
import { App, TFolder } from './mocks/obsidian';

// Mock the Plugin class to avoid importing the rest of the app and its Obsidian dependencies
class MockPlugin {
  app!: App;
  settings: any = {
    autoLockOnBackground: true,
    autoLockIdleMinutes: 5,
    debugLogging: false,
    maxPasswordAttempts: 5,
  };
  encryptionService: any;
  fileService: any;
  folderService: any;

  updateExplorerIndicators() {
    const leaves = this.app?.workspace?.getLeavesOfType('file-explorer');
    const explorer = leaves ? leaves[0] : null;
    if (!explorer) {
      return;
    }

    const container = explorer.view.containerEl.querySelector('.nav-folder-container');
    if (!container) {
      return;
    }

    const folderElements = container.querySelectorAll('.nav-folder-title');
    folderElements.forEach((el: any) => {
      const folderPath = el.querySelector('.nav-folder-title-title')?.textContent;
      if (!folderPath) {
        return;
      }

      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!(folder instanceof TFolder)) {
        return;
      }

      const isEncrypted = this.folderService.isEncryptedFolder(folder);
      const isUnlocked = this.folderService.isUnlocked(folder);

      el.classList.remove('ef-folder-locked', 'ef-folder-unlocked');
      if (isEncrypted) {
        el.classList.add(isUnlocked ? 'ef-folder-unlocked' : 'ef-folder-locked');
      }
    });
  }
}

describe('Explorer Indicators', () => {
  it('should apply indicator classes to encrypted folders', async () => {
    const app = new App();
    app.workspace.getLeavesOfType = vi.fn().mockReturnValue([
      {
        view: {
          containerEl: document.createElement('div'),
        },
      },
    ]);

    const encryptionService = new EncryptionService();
    const fileService = new FileService(app.vault as any, (file: any) => app.fileManager.trashFile(file));
    const folderService = new FolderService(encryptionService, fileService, app as any);

    const plugin = new MockPlugin();
    plugin.app = app;
    plugin.encryptionService = encryptionService;
    plugin.fileService = fileService;
    plugin.folderService = folderService;

    const folderLocked = new TFolder();
    folderLocked.path = 'locked';
    folderLocked.children = [];
    app.vault.files.set(folderLocked.path, folderLocked);

    const folderUnlocked = new TFolder();
    folderUnlocked.path = 'unlocked';
    folderUnlocked.children = [];
    app.vault.files.set(folderUnlocked.path, folderUnlocked);

    await folderService.createEncryptedFolder(folderLocked as any, 'pass1', true);
    await folderService.createEncryptedFolder(folderUnlocked as any, 'pass2', false);

    const container = document.createElement('div');
    container.className = 'nav-folder-container';

    const titleLocked = document.createElement('div');
    titleLocked.className = 'nav-folder-title';
    const labelLocked = document.createElement('div');
    labelLocked.className = 'nav-folder-title-title';
    labelLocked.textContent = 'locked';
    titleLocked.appendChild(labelLocked);

    const titleUnlocked = document.createElement('div');
    titleUnlocked.className = 'nav-folder-title';
    const labelUnlocked = document.createElement('div');
    labelUnlocked.className = 'nav-folder-title-title';
    labelUnlocked.textContent = 'unlocked';
    titleUnlocked.appendChild(labelUnlocked);

    container.appendChild(titleLocked);
    container.appendChild(titleUnlocked);

    const leaves = (app.workspace.getLeavesOfType as any)('file-explorer');
    (leaves[0].view.containerEl as HTMLElement).appendChild(container);

    plugin.updateExplorerIndicators();

    expect(titleLocked.classList.contains('ef-folder-locked')).toBe(true);
    expect(titleUnlocked.classList.contains('ef-folder-unlocked')).toBe(true);
  });
});

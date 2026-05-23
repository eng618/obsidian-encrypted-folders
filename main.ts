import { Menu, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { EncryptionService } from './src/services/EncryptionService';
import { FileService } from './src/services/FileService';
import { FolderService } from './src/services/FolderService';
import { PasswordModal } from './src/ui/PasswordModal';
import { RecoveryKeyModal } from './src/ui/RecoveryKeyModal';
import { RemovalModal } from './src/ui/RemovalModal';
import { EncryptedFoldersSettingTab } from './src/ui/SettingsTab';

interface EncryptedFoldersSettings {
  autoLockOnBackground: boolean;
  autoLockIdleMinutes: number;
  debugLogging: boolean;
  maxPasswordAttempts: number;
}

const DEFAULT_SETTINGS: EncryptedFoldersSettings = {
  autoLockOnBackground: true,
  autoLockIdleMinutes: 5,
  debugLogging: false,
  maxPasswordAttempts: 5,
};

export default class EncryptedFoldersPlugin extends Plugin {
  settings: EncryptedFoldersSettings;
  encryptionService: EncryptionService;
  fileService: FileService;
  folderService: FolderService;

  private readonly autoLockCheckIntervalMs = 30 * 1000;

  async onload() {
    await this.loadSettings();

    // Initialize Services
    this.encryptionService = new EncryptionService();
    this.fileService = new FileService(this.app.vault, (file) => this.app.fileManager.trashFile(file));
    this.folderService = new FolderService(this.encryptionService, this.fileService, this.app);
    this.folderService.setDebugLogging(this.settings.debugLogging);
    this.folderService.setAutoLockSettings({
      idleMinutes: this.settings.autoLockIdleMinutes,
      lockOnBackground: this.settings.autoLockOnBackground,
    });
    await this.folderService.syncFolders();

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFolder) {
          this.handleFolderMenu(menu, file);
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        if (files.length !== 1) {
          return;
        }

        const [file] = files;
        if (file instanceof TFolder) {
          this.handleFolderMenu(menu, file);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFolder) {
          this.folderService.updatePath(oldPath, file.path);
        }
        if (file instanceof TFolder || file instanceof TFile) {
          this.folderService.recordActivityForItem(file);
        }
        this.folderService.requestSyncFolders('rename');
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.folderService.recordActivityForItem(file.parent);
        if (file instanceof TFolder) {
          this.folderService.removePath(file.path);
        }
        this.folderService.requestSyncFolders('delete');
      }),
    );

    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFolder || file instanceof TFile) {
          this.folderService.recordActivityForItem(file);
        }
        if (file instanceof TFolder) {
          void this.folderService.reconcileFolderState(file);
        }
        this.folderService.requestSyncFolders('create');
      }),
    );

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.updateExplorerIndicators();
      }),
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFolder || file.parent instanceof TFolder) {
          this.updateExplorerIndicators();
        }
        if (file instanceof TFolder || file instanceof TFile) {
          this.folderService.recordActivityForItem(file);
        }
        if (file.parent instanceof TFolder) {
          void this.folderService.reconcileFolderState(file.parent);
        }
        this.folderService.requestSyncFolders('modify');
      }),
    );

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        this.folderService.recordActivityForItem(file);
      }),
    );

    this.registerDomEvent(document, 'visibilitychange', () => {
      void this.handleVisibilityChange();
    });

    this.registerDomEvent(window, 'focus', () => {
      this.recordActiveFolderActivity();
    });

    this.registerDomEvent(document, 'keydown', () => {
      this.recordActiveFolderActivity();
    });

    this.registerDomEvent(document, 'pointerdown', () => {
      this.recordActiveFolderActivity();
    });

    this.registerDomEvent(document, 'touchstart', () => {
      this.recordActiveFolderActivity();
    });

    this.registerInterval(
      window.setInterval(() => {
        void this.handleIdleAutoLock();
      }, this.autoLockCheckIntervalMs),
    );

    this.addSettingTab(new EncryptedFoldersSettingTab(this.app, this));
  }

  private async handleVisibilityChange(): Promise<void> {
    if (!document.hidden) {
      this.recordActiveFolderActivity();
      return;
    }

    const locked = await this.folderService.runBackgroundAutoLock();
    if (locked) {
      new Notice('Unlocked folders were locked because Obsidian entered the background.');
    }
  }

  private async handleIdleAutoLock(): Promise<void> {
    const locked = await this.folderService.runIdleAutoLock();
    if (locked) {
      new Notice('Inactive unlocked folders were locked automatically.');
    }
  }

  private recordActiveFolderActivity(): void {
    this.folderService.recordActivityForItem(this.app.workspace.getActiveFile());
  }

  private handleLockFolderClick(folder: TFolder): void {
    void this.runLockFolder(folder);
  }

  private async runLockFolder(folder: TFolder): Promise<void> {
    await this.folderService.lockFolder(folder);
    new Notice('Folder locked.');
  }

  private handleFolderMenu(menu: Menu, folder: TFolder) {
    const isEncrypted = this.folderService.isEncryptedFolder(folder);

    if (isEncrypted) {
      if (this.folderService.isUnlocked(folder)) {
        menu.addItem((item) => {
          item
            .setTitle('Lock folder')
            .setIcon('lock')
            .onClick(() => {
              this.handleLockFolderClick(folder);
            });
        });
      } else {
        menu.addItem((item) => {
          item
            .setTitle('Unlock folder')
            .setIcon('unlock')
            .onClick(() => {
              new PasswordModal(
                this.app,
                'Unlock folder',
                async (password) => {
                  try {
                    return await this.folderService.unlockFolder(folder, password);
                  } catch (e) {
                    console.error(e);
                    throw e;
                  }
                },
                false,
                this.settings.maxPasswordAttempts,
              ).open();
            });
        });

        menu.addItem((item) => {
          item
            .setTitle('Unlock with recovery key')
            .setIcon('key')
            .onClick(() => {
              new PasswordModal(
                this.app,
                'Enter recovery key',
                async (recoveryKey) => {
                  try {
                    return await this.folderService.unlockFolder(folder, recoveryKey, true);
                  } catch (e) {
                    console.error(e);
                    throw e;
                  }
                },
                false,
                this.settings.maxPasswordAttempts,
              ).open();
            });
        });
      }

      menu.addSeparator();
      menu.addItem((item) => {
        item
          .setTitle('Permanently decrypt folder')
          .setIcon('trash-2')
          .onClick(() => {
            const isLocked = !this.folderService.isUnlocked(folder);
            new RemovalModal(this.app, isLocked, async (password) => {
              try {
                const success = await this.folderService.removeEncryption(folder, password);
                if (success) {
                  new Notice('Encryption removed. Folder is now plaintext.');
                } else if (isLocked) {
                  new Notice('Incorrect password.');
                }
              } catch (e) {
                new Notice(`Removal failed: ${e instanceof Error ? e.message : 'An unexpected error occurred'}`);
              }
            }).open();
          });
      });
    } else {
      // Don't allow encrypting nested folders if a parent is already encrypted
      if (this.folderService.isInsideEncryptedFolder(folder)) {
        return;
      }

      menu.addItem((item) => {
        item
          .setTitle('Encrypt folder')
          .setIcon('lock')
          .onClick(() => {
            new PasswordModal(
              this.app,
              'Encrypt folder',
              async (password, lockImmediately) => {
                const recoveryKey = await this.folderService.createEncryptedFolder(folder, password, lockImmediately);
                new RecoveryKeyModal(this.app, recoveryKey).open();

                if (lockImmediately) {
                  new Notice('Folder encrypted and locked.');
                } else {
                  new Notice('Folder initialized. Ready for encryption.');
                }
                return true;
              },
              true,
              this.settings.maxPasswordAttempts,
            ).open();
          });
      });
    }
  }

  private updateExplorerIndicators(): void {
    const explorer = this.app.workspace.getLeavesOfType('file-explorer').first();
    if (!explorer) {
      return;
    }

    const container = explorer.view.containerEl.querySelector('.nav-folder-container');
    if (!container) {
      return;
    }

    const folderElements = container.querySelectorAll('.nav-folder-title');
    folderElements.forEach((el) => {
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

  onunload() {
    void this.folderService.lockAllFolders();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.folderService.setDebugLogging(this.settings.debugLogging);
    this.folderService.setAutoLockSettings({
      idleMinutes: this.settings.autoLockIdleMinutes,
      lockOnBackground: this.settings.autoLockOnBackground,
    });
  }
}

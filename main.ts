import { Menu, Notice, Plugin, TFolder } from 'obsidian';
import { EncryptionService } from './src/services/EncryptionService';
import { FileService } from './src/services/FileService';
import { FolderService } from './src/services/FolderService';
import { PasswordModal } from './src/ui/PasswordModal';
import { RecoveryKeyModal } from './src/ui/RecoveryKeyModal';
import { EncryptedFoldersSettingTab } from './src/ui/SettingsTab';

interface EncryptedFoldersSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: EncryptedFoldersSettings = {
  mySetting: 'default',
};

export default class EncryptedFoldersPlugin extends Plugin {
  settings: EncryptedFoldersSettings;
  encryptionService: EncryptionService;
  fileService: FileService;
  folderService: FolderService;

  async onload() {
    await this.loadSettings();

    // Initialize Services
    this.encryptionService = new EncryptionService();
    this.fileService = new FileService(this.app.vault);
    this.folderService = new FolderService(this.encryptionService, this.fileService, this.app);

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
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
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFolder) {
          this.folderService.removePath(file.path);
        }
      }),
    );

    this.addSettingTab(new EncryptedFoldersSettingTab(this.app, this));
  }

  async handleFolderMenu(menu: Menu, folder: TFolder) {
    // We need to check async if it is encrypted.
    // Note: internal Obsidian menus might not await this, so the item might pop in late
    // or we need to be fast.
    const isEncrypted = await this.folderService.isEncryptedFolder(folder);

    if (isEncrypted) {
      if (this.folderService.isUnlocked(folder)) {
        menu.addItem((item) => {
          item
            .setTitle('Lock Folder')
            .setIcon('lock')
            .onClick(async () => {
              await this.folderService.lockFolder(folder);
              new Notice('Folder locked.');
            });
        });
      } else {
        menu.addItem((item) => {
          item
            .setTitle('Unlock Folder')
            .setIcon('unlock')
            .onClick(() => {
              new PasswordModal(this.app, 'Unlock Folder', async (password) => {
                const success = await this.folderService.unlockFolder(folder, password);
                if (success) {
                  // new Notice('Folder unlocked!');
                } else {
                  new Notice('Incorrect password.');
                }
              }).open();
            });
        });

        menu.addItem((item) => {
          item
            .setTitle('Unlock with Recovery Key')
            .setIcon('key')
            .onClick(() => {
              new PasswordModal(this.app, 'Enter Recovery Key', async (recoveryKey) => {
                const success = await this.folderService.unlockFolder(folder, recoveryKey, true);
                if (success) {
                  new Notice('Folder unlocked with recovery key!');
                } else {
                  new Notice('Invalid recovery key.');
                }
              }).open();
            });
        });
      }
    } else {
      menu.addItem((item) => {
        item
          .setTitle('Encrypt Folder')
          .setIcon('lock')
          .onClick(() => {
            new PasswordModal(this.app, 'Encrypt Folder', async (password) => {
              const recoveryKey = await this.folderService.createEncryptedFolder(folder, password);
              new RecoveryKeyModal(this.app, recoveryKey).open();
              new Notice('Folder encrypted!');
            }).open();
          });
      });
    }
  }

  onunload() {
    this.folderService.lockAllFolders();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

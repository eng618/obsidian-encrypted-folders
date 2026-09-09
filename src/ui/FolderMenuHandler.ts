import { App, Menu, Notice, TFolder } from 'obsidian';
import type { EncryptedFoldersSettings } from '../models/Settings';
import type { FolderService } from '../services/FolderService';
import { isAbortError } from '../utils/abort';
import { PasswordModal } from './PasswordModal';
import { runWithProcessingModal } from './ProcessingRunner';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { RemovalModal } from './RemovalModal';

export interface FolderMenuDeps {
  app: App;
  folderService: FolderService;
  getSettings: () => EncryptedFoldersSettings;
  lockFolderWithProgress: (folder: TFolder) => Promise<void>;
}

export function registerFolderMenu(menu: Menu, folder: TFolder, deps: FolderMenuDeps): void {
  const { folderService } = deps;
  const isEncrypted = folderService.isEncryptedFolder(folder);

  if (isEncrypted) {
    registerEncryptedMenu(menu, folder, deps);
    return;
  }

  if (folderService.isInsideEncryptedFolder(folder)) {
    return;
  }

  menu.addItem((item) => {
    item
      .setTitle('Encrypt folder')
      .setIcon('lock')
      .onClick(() => {
        new PasswordModal(
          deps.app,
          'Encrypt folder',
          async (password, lockImmediately) => {
            const recoveryKey = lockImmediately
              ? await runWithProcessingModal(deps.app, 'Encrypting folder', (options) =>
                  folderService.createEncryptedFolder(folder, password, lockImmediately, options),
                )
              : await folderService.createEncryptedFolder(folder, password, lockImmediately);
            new RecoveryKeyModal(deps.app, recoveryKey).open();

            if (lockImmediately) {
              new Notice('Folder encrypted and locked.');
            } else {
              new Notice('Folder initialized. Ready for encryption.');
            }
            return true;
          },
          true,
          deps.getSettings().maxPasswordAttempts,
        ).open();
      });
  });
}

function registerEncryptedMenu(menu: Menu, folder: TFolder, deps: FolderMenuDeps): void {
  const { app, folderService } = deps;

  if (folderService.isUnlocked(folder)) {
    menu.addItem((item) => {
      item
        .setTitle('Lock folder')
        .setIcon('lock')
        .onClick(() => {
          void deps.lockFolderWithProgress(folder).catch((error: unknown) => {
            if (isAbortError(error)) {
              return;
            }
            throw error;
          });
        });
    });
  } else {
    menu.addItem((item) => {
      item
        .setTitle('Unlock folder')
        .setIcon('unlock')
        .onClick(() => {
          const derivationCache = folderService.createDerivationCache();
          const modal = new PasswordModal(
            app,
            'Unlock folder',
            async (password) => {
              try {
                return await runWithProcessingModal(app, 'Unlocking folder', (options) =>
                  folderService.unlockFolder(folder, password, false, options, derivationCache),
                );
              } catch (e: unknown) {
                folderService.debug('Unlock folder failed', e);
                throw e instanceof Error ? e : new Error(String(e));
              }
            },
            false,
            deps.getSettings().maxPasswordAttempts,
          );
          const onClose = modal.onClose.bind(modal) as () => void;
          modal.onClose = () => {
            derivationCache.clear();
            onClose();
          };
          modal.open();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Unlock with recovery key')
        .setIcon('key')
        .onClick(() => {
          const derivationCache = folderService.createDerivationCache();
          const modal = new PasswordModal(
            app,
            'Enter recovery key',
            async (recoveryKey) => {
              try {
                return await runWithProcessingModal(app, 'Unlocking folder', (options) =>
                  folderService.unlockFolder(folder, recoveryKey, true, options, derivationCache),
                );
              } catch (e: unknown) {
                folderService.debug('Unlock with recovery key failed', e);
                throw e instanceof Error ? e : new Error(String(e));
              }
            },
            false,
            deps.getSettings().maxPasswordAttempts,
          );
          const onClose = modal.onClose.bind(modal) as () => void;
          modal.onClose = () => {
            derivationCache.clear();
            onClose();
          };
          modal.open();
        });
    });
  }

  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Permanently decrypt folder')
      .setIcon('trash-2')
      .onClick(() => {
        const isLocked = !folderService.isUnlocked(folder);
        new RemovalModal(app, isLocked, folder.path, async (password) => {
          try {
            const success = await folderService.removeEncryption(folder, password);
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
}

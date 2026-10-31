import type { App, Menu, TFolder } from 'obsidian';

import type { FolderPasswordKind } from '../models/PasswordManagement';
import { describePasswordKind } from '../models/PasswordManagement';
import type { EncryptedFoldersSettings } from '../models/Settings';
import type { FolderService } from '../services/FolderService';
import { isAbortError } from '../utils/abort';
import { PasswordModal } from './PasswordModal';
import { runWithProcessingModal } from './ProcessingRunner';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { RemovalModal } from './RemovalModal';
import { showNotice } from './UIUtils';

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
        const masterAvailable = folderService.hasMasterPassword();
        new PasswordModal(
          deps.app,
          'Encrypt folder',
          async (password, lockImmediately, label, kind) => {
            const selectedKind: FolderPasswordKind = kind ?? 'custom';
            if (selectedKind === 'master') {
              const valid = await folderService.verifyMasterPassword(password);
              if (!valid) {
                return false;
              }
              const masterRecoveryKey = await folderService.unwrapMasterRecoveryKey(password);
              await (lockImmediately
                ? runWithProcessingModal(deps.app, 'Encrypting folder', (options) =>
                    folderService.createEncryptedFolder(folder, password, lockImmediately, options, {
                      kind: 'master',
                      masterRecoveryKey,
                    }),
                  )
                : folderService.createEncryptedFolder(folder, password, lockImmediately, undefined, {
                    kind: 'master',
                    masterRecoveryKey,
                  }));
              showNotice('Folder encrypted with your master password. Your master recovery key covers it.');
              return true;
            }
            const recoveryKey = lockImmediately
              ? await runWithProcessingModal(deps.app, 'Encrypting folder', (options) =>
                  folderService.createEncryptedFolder(folder, password, lockImmediately, options, {
                    kind: 'custom',
                    label,
                  }),
                )
              : await folderService.createEncryptedFolder(folder, password, lockImmediately, undefined, {
                  kind: 'custom',
                  label,
                });
            new RecoveryKeyModal(deps.app, recoveryKey).open();

            if (lockImmediately) {
              showNotice('Folder encrypted and locked.');
            } else {
              showNotice('Folder initialized. Ready for encryption.');
            }
            return true;
          },
          true,
          deps.getSettings().maxPasswordAttempts,
          {
            kindToggle: { masterAvailable, defaultKind: masterAvailable ? 'master' : 'custom' },
            labelField: 'required',
          },
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
          void (async () => {
            const metadata = await folderService.readFolderMetadata(folder);
            const kind = folderService.getFolderPasswordKind(metadata ?? undefined);
            const badge = metadata ? describePasswordKind(kind, metadata.passwordLabel) : undefined;
            const helper = metadata
              ? kind === 'master'
                ? `"${folder.name}" uses your master password. Enter it to unlock. Your master recovery key also works here.`
                : metadata.passwordLabel
                  ? `"${folder.name}" uses the custom password "${metadata.passwordLabel}". It does not use the master password.`
                  : `"${folder.name}" uses a custom password. It does not use the master password.`
              : undefined;
            const derivationCache = folderService.createDerivationCache();
            const modal = new PasswordModal(
              app,
              'Unlock folder',
              async (password) => {
                try {
                  return await runWithProcessingModal(app, 'Unlocking folder', (options) =>
                    folderService.unlockFolderWithAutoDetect(folder, password, options, derivationCache),
                  );
                } catch (e: unknown) {
                  folderService.debug('Unlock folder failed', e);
                  throw e instanceof Error ? e : new Error(String(e));
                }
              },
              false,
              deps.getSettings().maxPasswordAttempts,
              { badge, helperText: helper },
            );
            const onClose = modal.onClose.bind(modal) as () => void;
            modal.onClose = () => {
              derivationCache.clear();
              onClose();
            };
            modal.open();
          })();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle('Unlock with recovery key')
        .setIcon('key')
        .onClick(() => {
          void (async () => {
            const metadata = await folderService.readFolderMetadata(folder);
            const kind = folderService.getFolderPasswordKind(metadata ?? undefined);
            const badge = kind === 'master' ? 'Master recovery key' : 'Folder recovery key';
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
              { badge },
            );
            const onClose = modal.onClose.bind(modal) as () => void;
            modal.onClose = () => {
              derivationCache.clear();
              onClose();
            };
            modal.open();
          })();
        });
    });
  }

  registerPasswordManagementItems(menu, folder, deps);

  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Permanently decrypt folder')
      .setIcon('trash-2')
      .onClick(() => {
        void (async () => {
          const metadata = await folderService.readFolderMetadata(folder);
          const badge = metadata
            ? describePasswordKind(folderService.getFolderPasswordKind(metadata), metadata.passwordLabel)
            : undefined;
          const isLocked = !folderService.isUnlocked(folder);
          new RemovalModal(
            app,
            isLocked,
            folder.path,
            async (password) => {
              try {
                const success = await folderService.removeEncryption(folder, password);
                if (success) {
                  showNotice('Encryption removed. Folder is now plaintext.');
                } else if (isLocked) {
                  showNotice('Incorrect password.');
                }
              } catch (e) {
                showNotice(`Removal failed: ${e instanceof Error ? e.message : 'An unexpected error occurred'}`);
              }
            },
            badge,
          ).open();
        })();
      });
  });
}

function registerPasswordManagementItems(menu: Menu, folder: TFolder, deps: FolderMenuDeps): void {
  const { app, folderService } = deps;

  menu.addSeparator();
  menu.addItem((item) => {
    item
      .setTitle('Password: switch to master…')
      .setIcon('key-round')
      .onClick(() => {
        void (async () => {
          const metadata = await folderService.readFolderMetadata(folder);
          if (folderService.getFolderPasswordKind(metadata) === 'master') {
            showNotice('This folder already uses the master password.');
            return;
          }
          if (!folderService.hasMasterPassword()) {
            showNotice('Set up a master password in settings first.');
            return;
          }
          // Step 1: prove ownership with whichever secret the user has.
          new PasswordModal(
            app,
            'Verify current password',
            async (currentSecret) => {
              const ok = await folderService.verifyFolderSecret(folder, currentSecret);
              if (!ok) {
                return false;
              }
              openMasterEntry(folder, deps, currentSecret);
              return true;
            },
            false,
            deps.getSettings().maxPasswordAttempts,
            {
              badge: describePasswordKind('custom', metadata?.passwordLabel),
              helperText: 'Enter the current custom password (or its recovery key) for this folder.',
            },
          ).open();
        })();
      });
  });

  menu.addItem((item) => {
    item
      .setTitle('Password: switch to custom…')
      .setIcon('pencil')
      .onClick(() => {
        void (async () => {
          const metadata = await folderService.readFolderMetadata(folder);
          if (folderService.getFolderPasswordKind(metadata) !== 'master') {
            showNotice('This folder already uses a custom password.');
            return;
          }
          // Step 1: prove knowledge of the master password.
          new PasswordModal(
            app,
            'Verify master password',
            async (masterPassword) => {
              const valid = await folderService.verifyMasterPassword(masterPassword);
              if (!valid) {
                return false;
              }
              openCustomEntry(folder, deps, masterPassword);
              return true;
            },
            false,
            deps.getSettings().maxPasswordAttempts,
            { badge: 'Master password' },
          ).open();
        })();
      });
  });

  menu.addItem((item) => {
    item
      .setTitle('Password: change custom password…')
      .setIcon('refresh-cw')
      .onClick(() => {
        void (async () => {
          const metadata = await folderService.readFolderMetadata(folder);
          if (folderService.getFolderPasswordKind(metadata) !== 'custom') {
            showNotice('This folder uses the master password. Switch to custom first to set a unique password.');
            return;
          }
          new PasswordModal(
            app,
            'Verify current password',
            async (currentSecret) => {
              const ok = await folderService.verifyFolderSecret(folder, currentSecret);
              if (!ok) {
                return false;
              }
              openNewCustomPassword(folder, deps, currentSecret);
              return true;
            },
            false,
            deps.getSettings().maxPasswordAttempts,
            { badge: describePasswordKind('custom', metadata?.passwordLabel) },
          ).open();
        })();
      });
  });

  menu.addItem((item) => {
    item
      .setTitle('Password: rename title…')
      .setIcon('tag')
      .onClick(() => {
        void (async () => {
          const metadata = await folderService.readFolderMetadata(folder);
          if (folderService.getFolderPasswordKind(metadata) !== 'custom') {
            showNotice('Only custom passwords have titles.');
            return;
          }
          const openLabelModal = (verifiedSecret?: string) => {
            new PasswordModal(
              app,
              'Rename password title',
              async (_password, _lock, label) => {
                try {
                  await folderService.relabelFolder(folder, label ?? '', verifiedSecret);
                  showNotice('Password title updated.');
                  return true;
                } catch (e) {
                  throw e instanceof Error ? e : new Error(String(e));
                }
              },
              false,
              deps.getSettings().maxPasswordAttempts,
              {
                badge: metadata?.passwordLabel ? `Custom password — "${metadata.passwordLabel}"` : 'Custom password',
                labelField: 'required',
                initialLabel: metadata?.passwordLabel ?? '',
                hidePasswordField: true,
              },
            ).open();
          };
          if (folderService.isUnlocked(folder)) {
            openLabelModal();
            return;
          }
          new PasswordModal(
            app,
            'Verify to rename title',
            async (password) => {
              const ok = await folderService.verifyFolderSecret(folder, password);
              if (!ok) {
                return false;
              }
              openLabelModal(password);
              return true;
            },
            false,
            deps.getSettings().maxPasswordAttempts,
            { badge: describePasswordKind('custom', metadata?.passwordLabel) },
          ).open();
        })();
      });
  });
}

function openMasterEntry(folder: TFolder, deps: FolderMenuDeps, currentSecret: string): void {
  const { app, folderService } = deps;
  new PasswordModal(
    app,
    'Switch to master password',
    async (masterPassword) => {
      try {
        await folderService.convertToMaster(folder, currentSecret, masterPassword);
        showNotice('Folder now uses the master password. The old custom password and its recovery key no longer work.');
        return true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/Incorrect master password|Authentication failed/i.test(message)) {
          return false;
        }
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    false,
    deps.getSettings().maxPasswordAttempts,
    {
      badge: 'Master password',
      helperText: 'Enter your master password to protect this folder going forward.',
    },
  ).open();
}

function openCustomEntry(folder: TFolder, deps: FolderMenuDeps, masterPassword: string): void {
  const { app, folderService } = deps;
  new PasswordModal(
    app,
    'New custom password',
    async (newPassword, _lock, label) => {
      try {
        const recoveryKey = await folderService.convertToCustom(folder, masterPassword, newPassword, label ?? '');
        new RecoveryKeyModal(app, recoveryKey).open();
        showNotice('Folder now uses a custom password. Save the new recovery key.');
        return true;
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    false,
    deps.getSettings().maxPasswordAttempts,
    {
      badge: 'Custom password',
      helperText: 'This folder will stop using the master password. Give it a title you will recognize.',
      labelField: 'required',
    },
  ).open();
}

function openNewCustomPassword(folder: TFolder, deps: FolderMenuDeps, currentSecret: string): void {
  const { app, folderService } = deps;
  new PasswordModal(
    app,
    'New custom password',
    async (newPassword) => {
      try {
        const recoveryKey = await folderService.changeCustomPassword(folder, currentSecret, newPassword);
        new RecoveryKeyModal(app, recoveryKey).open();
        showNotice('Custom password changed. Save the new recovery key — the old one no longer works.');
        return true;
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    false,
    deps.getSettings().maxPasswordAttempts,
    { badge: 'Custom password' },
  ).open();
}

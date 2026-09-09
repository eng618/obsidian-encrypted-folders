import { Menu, TFile, TFolder } from 'obsidian';
import type EncryptedFoldersPlugin from '../../main';
import { scheduleExplorerIndicators } from '../ui/ExplorerIndicators';
import { registerFolderMenu } from '../ui/FolderMenuHandler';

export interface EventSubscriptionContext {
  plugin: EncryptedFoldersPlugin;
  recordActiveFolderActivity: () => void;
  handleVisibilityChange: (isHidden: boolean) => void | Promise<void>;
  handleIdleAutoLock: () => void | Promise<void>;
}

export function registerEventSubscriptions(ctx: EventSubscriptionContext): void {
  const { plugin } = ctx;
  const { app, folderService } = plugin;

  plugin.registerEvent(
    app.workspace.on('file-menu', (menu: Menu, file: unknown) => {
      if (file instanceof TFolder) {
        registerFolderMenu(menu, file, {
          app,
          folderService,
          getSettings: () => plugin.settings,
          lockFolderWithProgress: (folder) => plugin.lockFolderWithProgress(folder),
        });
      }
    }),
  );

  plugin.registerEvent(
    app.workspace.on('files-menu', (menu: Menu, files: unknown[]) => {
      if (files.length !== 1) {
        return;
      }

      const [file] = files;
      if (file instanceof TFolder) {
        registerFolderMenu(menu, file, {
          app,
          folderService,
          getSettings: () => plugin.settings,
          lockFolderWithProgress: (folder) => plugin.lockFolderWithProgress(folder),
        });
      }
    }),
  );

  plugin.registerEvent(
    app.vault.on('rename', (file: unknown, oldPath: string) => {
      folderService.invalidateEncryptedParentCache();
      if (file instanceof TFolder) {
        folderService.updatePath(oldPath, file.path);
      }
      if (file instanceof TFolder || file instanceof TFile) {
        folderService.recordActivityForItem(file);
        plugin.reprocessCoordinator.queueForItem(file);
      }
      folderService.requestSyncFolders('rename', true);
    }),
  );

  plugin.registerEvent(
    app.vault.on('delete', (file: unknown) => {
      folderService.invalidateEncryptedParentCache();
      if (file instanceof TFile || file instanceof TFolder) {
        folderService.recordActivityForItem(file.parent);
      }
      if (file instanceof TFolder) {
        folderService.removePath(file.path);
      }
      folderService.requestSyncFolders('delete', true);
    }),
  );

  plugin.registerEvent(
    app.vault.on('create', (file: unknown) => {
      folderService.invalidateEncryptedParentCache();
      if (file instanceof TFolder || file instanceof TFile) {
        folderService.recordActivityForItem(file);
        plugin.reprocessCoordinator.queueForItem(file);
      }
      if (file instanceof TFolder) {
        void folderService.reconcileFolderState(file);
      }
      folderService.requestSyncFolders('create');
    }),
  );

  plugin.registerEvent(
    app.workspace.on('layout-change', () => {
      scheduleExplorerIndicators(app, folderService);
    }),
  );

  plugin.registerEvent(
    app.vault.on('modify', (file: unknown) => {
      // Note: no requestSyncFolders here — content edits cannot change the
      // encrypted-folder set, and batch encrypt/decrypt fires a modify per
      // file. Structural changes are covered by create/delete/rename.
      if (file instanceof TFile) {
        if (file.parent instanceof TFolder) {
          scheduleExplorerIndicators(app, folderService);
        }
        folderService.recordActivityForItem(file);
        plugin.reprocessCoordinator.queueForItem(file);
        if (file.parent instanceof TFolder) {
          void folderService.reconcileFolderState(file.parent);
        }
      } else if (file instanceof TFolder) {
        scheduleExplorerIndicators(app, folderService);
        folderService.recordActivityForItem(file);
        plugin.reprocessCoordinator.queueForItem(file);
      }
    }),
  );

  plugin.registerEvent(
    app.workspace.on('file-open', (file: unknown) => {
      if (file instanceof TFile || file === null || file === undefined) {
        folderService.recordActivityForItem(file as TFile | null);
      }
    }),
  );

  plugin.registerDomEvent(document, 'visibilitychange', () => {
    void ctx.handleVisibilityChange(document.hidden);
  });

  plugin.registerDomEvent(window, 'focus', () => {
    ctx.recordActiveFolderActivity();
  });

  plugin.registerDomEvent(document, 'keydown', () => {
    ctx.recordActiveFolderActivity();
  });

  plugin.registerDomEvent(document, 'pointerdown', () => {
    ctx.recordActiveFolderActivity();
  });

  plugin.registerDomEvent(document, 'touchstart', () => {
    ctx.recordActiveFolderActivity();
  });
}

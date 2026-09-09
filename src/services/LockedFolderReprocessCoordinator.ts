import { App, Notice, TFile, TFolder } from 'obsidian';
import type { FolderService } from '../services/FolderService';
import { PasswordModal } from '../ui/PasswordModal';
import { runWithProcessingModal } from '../ui/ProcessingRunner';

export class LockedFolderReprocessCoordinator {
  private readonly delayMs = 500;
  private timers: Map<string, number> = new Map();
  private prompts: Set<string> = new Set();

  constructor(
    private app: App,
    private folderService: FolderService,
    private getMaxPasswordAttempts: () => number,
  ) {}

  queueForItem(item: TFile | TFolder): void {
    const folder = this.folderService.findLockedEncryptedParentWithPlaintext(item);
    if (!folder) {
      return;
    }

    const folderPath = folder.path;
    const existingTimer = this.timers.get(folderPath);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.timers.delete(folderPath);
      void this.prompt(folder);
    }, this.delayMs);

    this.timers.set(folderPath, timer);
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
    }
    this.timers.clear();
    this.prompts.clear();
  }

  private async prompt(folder: TFolder): Promise<void> {
    const currentFolder = this.app.vault.getAbstractFileByPath(folder.path);
    if (!(currentFolder instanceof TFolder)) {
      return;
    }

    const folderToReprocess = this.folderService.findLockedEncryptedParentWithPlaintext(currentFolder);
    if (!folderToReprocess || this.prompts.has(folderToReprocess.path)) {
      return;
    }

    this.prompts.add(folderToReprocess.path);
    new Notice(`New unencrypted files were added to locked folder "${folderToReprocess.path}".`);

    const derivationCache = this.folderService.createDerivationCache();
    const modal = new PasswordModal(
      this.app,
      'Encrypt new files',
      async (password) => {
        const success = await runWithProcessingModal(this.app, 'Encrypting new files', (options) =>
          this.folderService.reprocessLockedFolder(folderToReprocess, password, false, options, derivationCache),
        );
        if (success) {
          new Notice('New files encrypted. Folder remains locked.');
        } else {
          new Notice('Could not encrypt new files. Check the password and try again.');
        }
        return success;
      },
      false,
      this.getMaxPasswordAttempts(),
    );
    const onClose = modal.onClose.bind(modal) as () => void;
    modal.onClose = () => {
      this.prompts.delete(folderToReprocess.path);
      derivationCache.clear();
      onClose();
    };
    modal.open();
  }
}

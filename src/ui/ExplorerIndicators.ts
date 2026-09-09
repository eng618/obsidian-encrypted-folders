import { App, TFolder } from 'obsidian';
import type { FolderService } from '../services/FolderService';

export function getIndicatorClass(isEncrypted: boolean, isUnlocked: boolean): string | null {
  if (!isEncrypted) {
    return null;
  }
  return isUnlocked ? 'ef-folder-unlocked' : 'ef-folder-locked';
}

export function updateExplorerIndicators(app: App, folderService: FolderService): void {
  const explorer = app.workspace.getLeavesOfType('file-explorer').first();
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

    const folder = app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    const indicatorClass = getIndicatorClass(folderService.isEncryptedFolder(folder), folderService.isUnlocked(folder));

    el.classList.remove('ef-folder-locked', 'ef-folder-unlocked');
    if (indicatorClass) {
      el.classList.add(indicatorClass);
    }
  });
}

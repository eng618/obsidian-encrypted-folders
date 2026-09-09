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

    // Avoid touching the DOM when the indicator is already correct —
    // classList writes during batch operations invalidate layout.
    if (indicatorClass) {
      if (!el.classList.contains(indicatorClass)) {
        el.classList.remove('ef-folder-locked', 'ef-folder-unlocked');
        el.classList.add(indicatorClass);
      }
    } else if (el.classList.contains('ef-folder-locked') || el.classList.contains('ef-folder-unlocked')) {
      el.classList.remove('ef-folder-locked', 'ef-folder-unlocked');
    }
  });
}

let updateScheduled = false;

/**
 * Coalesces rapid indicator refreshes (e.g. one per file during batch
 * encrypt/decrypt) into a single DOM pass on the next animation frame.
 */
export function scheduleExplorerIndicators(app: App, folderService: FolderService): void {
  if (updateScheduled) {
    return;
  }
  updateScheduled = true;
  const run = () => {
    updateScheduled = false;
    updateExplorerIndicators(app, folderService);
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run);
  } else {
    window.setTimeout(run, 0);
  }
}

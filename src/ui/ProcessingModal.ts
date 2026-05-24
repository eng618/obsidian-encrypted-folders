import { App, Modal, Setting } from 'obsidian';
import { FolderProcessingProgress } from '../services/FolderService';

export class ProcessingModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private progressEl: HTMLProgressElement | null = null;

  constructor(
    app: App,
    private title: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.classList.add('ef-processing-modal');

    new Setting(contentEl).setName(this.title).setHeading();

    const bodyEl = contentEl.createEl('div', { cls: 'ef-processing-body' });
    bodyEl.createEl('div', { cls: 'ef-processing-spinner' });

    const textEl = bodyEl.createEl('div', { cls: 'ef-processing-text' });
    this.statusEl = textEl.createEl('div', {
      cls: 'ef-processing-status',
      text: 'Preparing files...',
    });
    this.detailEl = textEl.createEl('div', {
      cls: 'ef-processing-detail',
      text: 'Do not quit Obsidian until this finishes.',
    });

    this.progressEl = document.createElement('progress');
    this.progressEl.className = 'ef-processing-progress';
    this.progressEl.value = 0;
    this.progressEl.max = 1;
    contentEl.appendChild(this.progressEl);

    contentEl.createEl('p', {
      cls: 'ef-processing-warning',
      text: 'Keep Obsidian open. Interrupting this operation may leave the folder in a recovery state.',
    });
  }

  updateProgress(progress: FolderProcessingProgress): void {
    if (!this.statusEl || !this.detailEl || !this.progressEl) {
      return;
    }

    const verb = progress.operation === 'encrypt' ? 'Encrypting' : 'Decrypting';
    const total = Math.max(0, progress.totalFiles);
    const processed = Math.min(progress.processedFiles, total);

    if (progress.status === 'preparing') {
      this.statusEl.textContent = 'Preparing files...';
    } else if (progress.status === 'complete') {
      this.statusEl.textContent = `${verb} complete.`;
    } else if (progress.status === 'error') {
      this.statusEl.textContent = `${verb} stopped because an error occurred.`;
    } else {
      this.statusEl.textContent = `${verb} ${processed} of ${total} files.`;
    }

    this.detailEl.textContent = progress.currentFilePath ?? progress.folderPath;
    this.progressEl.max = Math.max(1, total);
    this.progressEl.value = processed;
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.classList.remove('ef-processing-modal');
    contentEl.empty();
  }
}

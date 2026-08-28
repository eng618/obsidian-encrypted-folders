import { App, Modal, Setting } from 'obsidian';
import { FolderProcessingProgress } from '../services/FolderService';

export class ProcessingModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private progressEl: HTMLProgressElement | null = null;
  private cancelButtonEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    private title: string,
    private onCancel?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.classList.add('ef-processing-modal');

    new Setting(contentEl).setName(this.title).setHeading();

    const bodyEl = contentEl.createDiv({ cls: 'ef-processing-body' });
    bodyEl.createDiv({ cls: 'ef-processing-spinner' });

    const textEl = bodyEl.createDiv({ cls: 'ef-processing-text' });
    this.statusEl = textEl.createDiv({
      cls: 'ef-processing-status',
      text: 'Preparing files...',
    });
    this.detailEl = textEl.createDiv({
      cls: 'ef-processing-detail',
      text: 'Do not quit Obsidian until this finishes.',
    });

    this.progressEl = contentEl.createEl('progress', {
      cls: 'ef-processing-progress',
      value: '0',
    });
    this.progressEl.max = 1;

    contentEl.createEl('p', {
      cls: 'ef-processing-warning',
      text: 'Keep Obsidian open. Interrupting this operation may leave the folder in a recovery state.',
    });

    if (this.onCancel) {
      this.cancelButtonEl = contentEl.createEl('button', {
        cls: 'mod-warning ef-processing-cancel',
        text: 'Cancel operation',
      });
      this.cancelButtonEl.addEventListener('click', () => {
        this.cancelButtonEl?.setAttribute('disabled', 'true');
        this.cancelButtonEl!.textContent = 'Cancelling...';
        this.onCancel?.();
      });
    }
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
    this.cancelButtonEl = null;
    contentEl.classList.remove('ef-processing-modal');
    contentEl.empty();
  }
}

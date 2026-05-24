import { App } from 'obsidian';
import { vi } from 'vitest';
import { ProcessingModal } from '../ui/ProcessingModal';

describe('ProcessingModal', () => {
  it('should render progress and warning text', () => {
    const app = new App();
    const modal = new ProcessingModal(app, 'Locking folder');

    modal.onOpen();
    modal.updateProgress({
      operation: 'encrypt',
      status: 'processing',
      folderPath: 'secret',
      totalFiles: 10,
      processedFiles: 4,
      currentFilePath: 'secret/note.md',
    });

    expect(modal.contentEl.textContent).toContain('Encrypting 4 of 10 files');
    expect(modal.contentEl.textContent).toContain('Keep Obsidian open');
    const progressEl = modal.contentEl.querySelector('progress') as HTMLProgressElement;
    expect(progressEl.max).toBe(10);
    expect(progressEl.value).toBe(4);
  });

  it('should request cancellation from the cancel button', () => {
    const app = new App();
    const onCancel = vi.fn();
    const modal = new ProcessingModal(app, 'Locking folder', onCancel);

    modal.onOpen();
    const cancelButton = modal.contentEl.querySelector('.ef-processing-cancel') as HTMLButtonElement;
    cancelButton.click();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(cancelButton.disabled).toBe(true);
    expect(cancelButton.textContent).toBe('Cancelling...');
  });
});

import { App } from 'obsidian';
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
});

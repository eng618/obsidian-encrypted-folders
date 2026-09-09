import { App, Notice } from 'obsidian';
import type { FolderProcessingOptions } from '../services/FolderService';
import { createAbortError, isAbortError } from '../utils/abort';
import { ProcessingModal } from './ProcessingModal';

export async function runWithProcessingModal<T>(
  app: App,
  title: string,
  operation: (options: FolderProcessingOptions) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController();
  const modal = new ProcessingModal(app, title, () => {
    abortController.abort(createAbortError());
  });
  modal.open();

  try {
    return await operation({
      onProgress: (progress) => {
        modal.updateProgress(progress);
      },
      signal: abortController.signal,
    });
  } catch (error: unknown) {
    if (isAbortError(error)) {
      new Notice('Operation cancelled.');
    }
    throw error;
  } finally {
    modal.close();
  }
}

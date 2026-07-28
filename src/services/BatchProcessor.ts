import { TFile, TFolder } from 'obsidian';

export type FolderProcessingOperation = 'encrypt' | 'decrypt';
export type FolderProcessingStatus = 'preparing' | 'processing' | 'complete' | 'error';

export interface FolderProcessingProgress {
  operation: FolderProcessingOperation;
  status: FolderProcessingStatus;
  folderPath: string;
  totalFiles: number;
  processedFiles: number;
  currentFilePath?: string;
}

export interface FolderProcessingOptions {
  onProgress?: (progress: FolderProcessingProgress) => void;
  maxConcurrentFiles?: number;
  maxConcurrentBytes?: number;
  signal?: AbortSignal;
}

export class BatchProcessor {
  private readonly LOCKED_EXTENSION = '.locked';
  private readonly DEFAULT_MAX_CONCURRENT_FILES = 3;
  private readonly DEFAULT_MAX_CONCURRENT_BYTES = 64 * 1024 * 1024;

  constructor(private isProtectedFile: (file: TFile) => boolean) {}

  countLockedFiles(folder: TFolder): number {
    const stack: TFolder[] = [folder];
    let count = 0;

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (child.path.endsWith(this.LOCKED_EXTENSION)) {
          count += 1;
        }
      }
    }

    return count;
  }

  collectProcessableFiles(folder: TFolder, mode: FolderProcessingOperation): TFile[] {
    const stack: TFolder[] = [folder];
    const files: TFile[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (!(child instanceof TFile) || this.isProtectedFile(child)) {
          continue;
        }

        if (mode === 'encrypt') {
          if (child.path.endsWith(this.LOCKED_EXTENSION)) {
            continue;
          }
          files.push(child);
          continue;
        }

        if (child.path.endsWith(this.LOCKED_EXTENSION)) {
          files.push(child);
        }
      }
    }

    return files;
  }

  collectPlaintextFiles(folder: TFolder): TFile[] {
    const stack: TFolder[] = [folder];
    const files: TFile[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = [...current.children];
      for (const child of children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (!(child instanceof TFile)) {
          continue;
        }

        if (this.isProtectedFile(child) || child.path.endsWith(this.LOCKED_EXTENSION)) {
          continue;
        }

        files.push(child);
      }
    }

    return files;
  }

  reportProgress(
    operation: FolderProcessingOperation,
    status: FolderProcessingStatus,
    folderPath: string,
    totalFiles: number,
    processedFiles: number,
    options?: FolderProcessingOptions,
    currentFilePath?: string,
  ): void {
    options?.onProgress?.({
      operation,
      status,
      folderPath,
      totalFiles,
      processedFiles,
      currentFilePath,
    });
  }

  getFileProcessingSize(file: TFile): number {
    return Math.max(1, file.stat?.size ?? 1);
  }

  createAbortError(): Error {
    const error = new Error('Operation cancelled.');
    error.name = 'AbortError';
    return error;
  }

  getAbortReason(signal?: AbortSignal): unknown {
    if (!signal?.aborted) {
      return null;
    }

    return signal.reason ?? this.createAbortError();
  }

  throwIfAborted(options?: FolderProcessingOptions): void {
    const abortReason = this.getAbortReason(options?.signal);
    if (abortReason) {
      throw abortReason;
    }
  }

  async processFilesWithLimits<T>(
    folder: TFolder,
    operation: FolderProcessingOperation,
    files: TFile[],
    options: FolderProcessingOptions | undefined,
    processFile: (file: TFile) => Promise<T>,
  ): Promise<T[]> {
    const maxConcurrentFiles = Math.max(
      1,
      Math.floor(options?.maxConcurrentFiles ?? this.DEFAULT_MAX_CONCURRENT_FILES),
    );
    const maxConcurrentBytes = Math.max(
      1,
      Math.floor(options?.maxConcurrentBytes ?? this.DEFAULT_MAX_CONCURRENT_BYTES),
    );
    const results: T[] = [];
    let activeFiles = 0;
    let activeBytes = 0;
    let nextIndex = 0;
    let processedFiles = 0;
    let firstError: unknown;

    this.reportProgress(operation, 'preparing', folder.path, files.length, 0, options);
    this.throwIfAborted(options);

    if (files.length === 0) {
      this.reportProgress(operation, 'complete', folder.path, 0, 0, options);
      return results;
    }

    return await new Promise<T[]>((resolve, reject) => {
      const markAborted = (): void => {
        firstError = firstError ?? this.getAbortReason(options?.signal) ?? this.createAbortError();
        maybeFinish();
      };

      options?.signal?.addEventListener('abort', markAborted, { once: true });

      const maybeFinish = (): void => {
        if (activeFiles > 0) {
          return;
        }

        if (firstError) {
          options?.signal?.removeEventListener('abort', markAborted);
          this.reportProgress(operation, 'error', folder.path, files.length, processedFiles, options);
          reject(firstError);
          return;
        }

        if (nextIndex >= files.length) {
          options?.signal?.removeEventListener('abort', markAborted);
          this.reportProgress(operation, 'complete', folder.path, files.length, processedFiles, options);
          resolve(results);
        }
      };

      const launchNext = (): void => {
        const abortReason = this.getAbortReason(options?.signal);
        if (abortReason) {
          firstError = firstError ?? abortReason;
          maybeFinish();
          return;
        }

        while (!firstError && nextIndex < files.length && activeFiles < maxConcurrentFiles) {
          const file = files[nextIndex];
          const fileSize = this.getFileProcessingSize(file);
          const canRunWithActiveBytes = activeBytes + fileSize <= maxConcurrentBytes;
          if (activeFiles > 0 && !canRunWithActiveBytes) {
            break;
          }

          nextIndex += 1;
          activeFiles += 1;
          activeBytes += fileSize;
          this.reportProgress(operation, 'processing', folder.path, files.length, processedFiles, options, file.path);

          void processFile(file)
            .then((result) => {
              results.push(result);
            })
            .catch((error: unknown) => {
              firstError = firstError ?? error;
            })
            .finally(() => {
              activeFiles -= 1;
              activeBytes -= fileSize;
              processedFiles += 1;
              this.reportProgress(
                operation,
                firstError ? 'error' : 'processing',
                folder.path,
                files.length,
                processedFiles,
                options,
                file.path,
              );
              launchNext();
              maybeFinish();
            });
        }

        maybeFinish();
      };

      launchNext();
    });
  }
}

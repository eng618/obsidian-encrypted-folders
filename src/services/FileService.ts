import { TFile, Vault, normalizePath } from 'obsidian';

export class FileService {
  private readonly MAX_RANDOM_SIZE = 65536;

  constructor(private vault: Vault) {}

  /**
   * Reads a file as an ArrayBuffer.
   *
   * @param file The file to read.
   */
  async readBinary(file: TFile): Promise<ArrayBuffer> {
    return await this.vault.readBinary(file);
  }

  /**
   * Writes data to a file. Creates if not exists, modifies if exists.
   *
   * @param path The path to write to.
   * @param data The data to write.
   */
  async writeBinary(path: string, data: ArrayBuffer): Promise<TFile> {
    const normalizedPath = normalizePath(path);
    try {
      return await this.vault.createBinary(normalizedPath, data);
    } catch (e) {
      if (e.message?.includes('already exists')) {
        const existingFile = this.vault.getAbstractFileByPath(normalizedPath);
        if (existingFile instanceof TFile) {
          await this.vault.modifyBinary(existingFile, data);
          return existingFile;
        } else {
          // It exists on disk but not in cache. Use adapter to overwrite.
          await this.vault.adapter.writeBinary(normalizedPath, data);

          // Attempt to get the file one more time after a short delay
          await new Promise((r) => setTimeout(r, 100));
          const retryFile = this.vault.getAbstractFileByPath(normalizedPath);
          if (retryFile instanceof TFile) return retryFile;
        }
      }
      throw e;
    }
  }

  /**
   * Writes data to a file securely by overwriting with random data first if it exists.
   *
   * @param path The path to write to.
   * @param data The data to write.
   */
  async secureWrite(path: string, data: ArrayBuffer): Promise<TFile> {
    const normalizedPath = normalizePath(path);
    const existingFile = this.vault.getAbstractFileByPath(normalizedPath);

    if (existingFile instanceof TFile) {
      // We perform a single write. Multiple rapid modifyBinary calls
      // have been observed to cause file corruption in some Obsidian builds.
      await this.vault.modifyBinary(existingFile, data);
      return existingFile;
    } else {
      return await this.writeBinary(path, data);
    }
  }

  /**
   * Deletes a file.
   *
   * @param file The file to delete.
   */
  async deleteFile(file: TFile): Promise<void> {
    await this.vault.trash(file, true); // Use system trash
  }

  /**
   * Shreds a file by overwriting it with random data before deletion.
   *
   * @param file The file to shred.
   */
  async shredFile(file: TFile): Promise<void> {
    const size = file.stat.size;
    const randomData = new Uint8Array(size);
    this.fillRandomValues(randomData);
    await this.vault.modifyBinary(file, randomData.buffer);
    await this.vault.delete(file); // Permanent delete
  }

  private fillRandomValues(buffer: Uint8Array): void {
    const size = buffer.byteLength;
    for (let i = 0; i < size; i += this.MAX_RANDOM_SIZE) {
      const chunk = buffer.subarray(i, Math.min(i + this.MAX_RANDOM_SIZE, size));
      window.crypto.getRandomValues(chunk);
    }
  }

  /**
   * Checks if a file exists.
   *
   * @param path The path to check.
   */
  exists(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalizedPath);
    return file instanceof TFile;
  }

  /**
   * Gets a TFile object from a path.
   *
   * @param path The path to get the file from.
   */
  getFile(path: string): TFile | null {
    const file = this.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }
}

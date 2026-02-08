import { TFile, Vault, normalizePath } from 'obsidian';

export class FileService {
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
    const existingFile = this.vault.getAbstractFileByPath(normalizedPath);

    if (existingFile instanceof TFile) {
      await this.vault.modifyBinary(existingFile, data);
      return existingFile;
    } else if (existingFile) {
      throw new Error(`Path ${normalizedPath} exists but is not a file.`);
    } else {
      return await this.vault.createBinary(normalizedPath, data);
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
    window.crypto.getRandomValues(randomData as any);
    await this.vault.modifyBinary(file, randomData.buffer);
    await this.vault.delete(file); // Permanent delete
  }

  /**
   * Checks if a file exists.
   *
   * @param path The path to check.
   */
  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
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

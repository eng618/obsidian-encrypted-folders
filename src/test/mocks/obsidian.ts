import { vi } from 'vitest';

export class TFile {
  path: string;
  name: string;
  parent: TFolder;
  stat: { size: number; mtime: number; ctime: number };
  data?: ArrayBuffer;
}

export class TFolder {
  path: string;
  parent: TFolder;
  children: (TFile | TFolder)[];
}

export class Vault {
  files: Map<string, TFile | TFolder> = new Map();
  adapter = {
    list: vi.fn(async (path: string) => {
      const normalizedBase = normalizePath(path || '');
      const folderPrefix = normalizedBase.length > 0 ? `${normalizedBase}/` : '';
      const files: string[] = [];
      const folders = new Set<string>();

      for (const filePath of this.files.keys()) {
        if (normalizedBase.length > 0 && filePath !== normalizedBase && !filePath.startsWith(folderPrefix)) {
          continue;
        }

        const relative = normalizedBase.length > 0 ? filePath.slice(folderPrefix.length) : filePath;
        if (relative.length === 0) {
          continue;
        }

        const firstSlash = relative.indexOf('/');
        if (firstSlash === -1) {
          if (this.files.get(filePath) instanceof TFile) {
            files.push(filePath);
          }
          continue;
        }

        const childFolder = relative.slice(0, firstSlash);
        const fullFolder = normalizePath(normalizedBase.length > 0 ? `${normalizedBase}/${childFolder}` : childFolder);
        if (this.files.get(fullFolder) instanceof TFolder) {
          folders.add(fullFolder);
        }
      }

      return { files, folders: Array.from(folders) };
    }),
    exists: vi.fn(async (path: string) => this.files.has(normalizePath(path))),
    writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
      await this.createBinary(path, data);
    }),
  };

  on = vi.fn();

  readBinary = vi.fn(async (file: TFile) => {
    return file.data || new ArrayBuffer(0);
  });

  modifyBinary = vi.fn(async (file: TFile, data: ArrayBuffer) => {
    file.data = data;
    file.stat.size = data.byteLength;
  });

  createBinary = vi.fn(async (path: string, data: ArrayBuffer) => {
    const existing = this.files.get(path);
    if (existing instanceof TFile) {
      existing.data = data;
      existing.stat.size = data.byteLength;
      return existing;
    }
    const file = new TFile();
    file.path = path;
    const parts = path.split('/');
    file.name = parts.pop() || '';
    file.data = data;
    file.stat = { size: data.byteLength, mtime: Date.now(), ctime: Date.now() };

    // Link to parent
    const parentPath = parts.join('/');
    if (parentPath) {
      const parent = this.files.get(parentPath);
      if (parent instanceof TFolder) {
        file.parent = parent;
        if (!parent.children.includes(file)) {
          parent.children.push(file);
        }
      }
    }

    this.files.set(path, file);
    return file;
  });

  delete = vi.fn(async (file: TFile | TFolder) => {
    this.files.delete(file.path);
    if (file.parent) {
      file.parent.children = file.parent.children.filter((c) => c !== file);
    }
  });

  trash = vi.fn();

  getAbstractFileByPath = vi.fn((path: string) => {
    return this.files.get(normalizePath(path)) || null;
  });

  getFiles = vi.fn(() => {
    return Array.from(this.files.values()).filter((file): file is TFile => file instanceof TFile);
  });
}

export class Notice {
  constructor(message: string) {
    console.log('Notice:', message);
  }
}

export class App {
  vault: Vault;
  workspace = {
    on: vi.fn(),
  };
  constructor() {
    this.vault = new Vault();
  }
}

export function normalizePath(path: string): string {
  return path.replace(/[\\\/]+/g, '/');
}

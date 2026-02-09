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

  readBinary = jest.fn(async (file: TFile) => {
    return file.data || new ArrayBuffer(0);
  });

  modifyBinary = jest.fn(async (file: TFile, data: ArrayBuffer) => {
    file.data = data;
    file.stat.size = data.byteLength;
  });

  createBinary = jest.fn(async (path: string, data: ArrayBuffer) => {
    const existing = this.files.get(path);
    if (existing instanceof TFile) {
      existing.data = data;
      existing.stat.size = data.byteLength;
      return existing;
    }
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').pop() || '';
    file.data = data;
    file.stat = { size: data.byteLength, mtime: Date.now(), ctime: Date.now() };
    this.files.set(path, file);
    return file;
  });

  delete = jest.fn(async (file: TFile) => {
    this.files.delete(file.path);
  });

  trash = jest.fn();

  getAbstractFileByPath = jest.fn((path: string) => {
    return this.files.get(path) || null;
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
    on: jest.fn(),
  };
  constructor() {
    this.vault = new Vault();
  }
}

export function normalizePath(path: string): string {
  return path.replace(/[\\\/]+/g, '/');
}

import { vi } from 'vitest';

export class TFile {
  path!: string;
  name!: string;
  parent!: TFolder;
  stat!: { size: number; mtime: number; ctime: number };
  data?: ArrayBuffer;
}

export class TFolder {
  path!: string;
  name!: string;
  parent!: TFolder;
  children!: (TFile | TFolder)[];
}

export class Vault {
  files: Map<string, TFile | TFolder> = new Map();
  adapter = {
    list: vi.fn<(path: string) => Promise<{ files: string[]; folders: string[] }>>(async (path: string) => {
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
    exists: vi.fn<(path: string) => Promise<boolean>>(async (path: string) => this.files.has(normalizePath(path))),
    writeBinary: vi.fn<(path: string, data: ArrayBuffer) => Promise<void>>(async (path: string, data: ArrayBuffer) => {
      await this.createBinary(path, data);
    }),
  };

  on = vi.fn<(...args: unknown[]) => unknown>();

  readBinary = vi.fn<(file: TFile) => Promise<ArrayBuffer>>(async (file: TFile) => {
    return file.data || new ArrayBuffer(0);
  });

  modifyBinary = vi.fn<(file: TFile, data: ArrayBuffer) => Promise<void>>(async (file: TFile, data: ArrayBuffer) => {
    file.data = data;
    file.stat.size = data.byteLength;
  });

  createBinary = vi.fn<(path: string, data: ArrayBuffer) => Promise<TFile>>(async (path: string, data: ArrayBuffer) => {
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

  delete = vi.fn<(file: TFile | TFolder) => Promise<void>>(async (file: TFile | TFolder) => {
    this.files.delete(file.path);
    if (file.parent) {
      file.parent.children = file.parent.children.filter((c) => c !== file);
    }
  });

  trash = vi.fn<(...args: unknown[]) => unknown>();

  getAbstractFileByPath = vi.fn<(path: string) => TFile | TFolder | null>((path: string) => {
    return this.files.get(normalizePath(path)) || null;
  });

  rename = vi.fn<(file: TFile, newPath: string) => Promise<void>>(async (file: TFile, newPath: string) => {
    const normalized = normalizePath(newPath);
    this.files.delete(file.path);
    if (file.parent) {
      file.parent.children = file.parent.children.filter((c) => c !== file);
    }
    file.path = normalized;
    const parts = normalized.split('/');
    file.name = parts.pop() || '';
    const parentPath = parts.join('/');
    const parent = parentPath ? this.files.get(parentPath) : undefined;
    if (parent instanceof TFolder) {
      file.parent = parent;
      if (!parent.children.includes(file)) {
        parent.children.push(file);
      }
    }
    this.files.set(normalized, file);
  });

  getFiles = vi.fn<() => TFile[]>(() => {
    return Array.from(this.files.values()).filter((file): file is TFile => file instanceof TFile);
  });
}

export class Modal {
  contentEl = document.createElement('div');
  onOpen() {}
  onClose() {}
  open() {
    this.onOpen();
  }
  close() {
    this.onClose();
  }
}

(HTMLElement.prototype as any).empty = function () {
  this.innerHTML = '';
};

(HTMLElement.prototype as any).hide = function () {
  this.style.display = 'none';
};

(HTMLElement.prototype as any).show = function () {
  this.style.display = '';
};

(HTMLElement.prototype as any).toggle = function (show: boolean) {
  if (show) {
    this.show();
  } else {
    this.hide();
  }
};

(HTMLElement.prototype as any).createEl = function (tag: string, options: Record<string, unknown> = {}) {
  const el = document.createElement(tag);
  if (options.text) {
    el.textContent = String(options.text);
  }
  if (options.cls) {
    el.className = String(options.cls);
  }
  this.appendChild(el);
  return el;
};

(HTMLElement.prototype as any).createDiv = function (options: Record<string, unknown> = {}) {
  return (this as HTMLElement).createEl('div', options);
};

(HTMLElement.prototype as any).createSpan = function (options: Record<string, unknown> = {}) {
  return (this as HTMLElement).createEl('span', options);
};

type SettingButtonMock = {
  setButtonText: (text: string) => SettingButtonMock;
  setCta: () => SettingButtonMock;
  setWarning: () => SettingButtonMock;
  setDestructive: () => SettingButtonMock;
  setTooltip: () => SettingButtonMock;
  setDisabled: () => SettingButtonMock;
  onClick: (handler: () => void) => SettingButtonMock;
};

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName(_name: string) {
    return this;
  }
  setHeading() {
    return this;
  }
  setDesc(_desc: string) {
    return this;
  }
  addButton(cb: (btn: SettingButtonMock) => void) {
    const btnEl = (this.containerEl as any).createEl
      ? (this.containerEl as any).createEl('button')
      : document.createElement('button');
    const mockBtn: SettingButtonMock = {
      setButtonText: vi.fn<(text: string) => SettingButtonMock>((text: string) => {
        btnEl.textContent = text;
        return mockBtn;
      }),
      setCta: vi.fn<() => SettingButtonMock>(() => mockBtn),
      setWarning: vi.fn<() => SettingButtonMock>(() => mockBtn),
      setDestructive: vi.fn<() => SettingButtonMock>(() => mockBtn),
      setTooltip: vi.fn<() => SettingButtonMock>(() => mockBtn),
      setDisabled: vi.fn<() => SettingButtonMock>(() => mockBtn),
      onClick: vi.fn<(handler: () => void) => SettingButtonMock>((handler: () => void) => {
        btnEl.addEventListener('click', handler);
        return mockBtn;
      }),
    };
    cb(mockBtn);
    return this;
  }
  addToggle(cb: (t: Record<string, unknown>) => void) {
    cb({
      setValue: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      onChange: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
    });
    return this;
  }
  addText(cb: (t: Record<string, unknown>) => void) {
    cb({
      setPlaceholder: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      onChange: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      inputEl: { type: '', focus: vi.fn<() => void>() },
    });
    return this;
  }
  addExtraButton(cb: (btn: Record<string, unknown>) => void) {
    cb({
      setIcon: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      setTooltip: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      onClick: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
    });
    return this;
  }
}

export class Notice {
  constructor(public message: string) {
    console.log('Notice:', message);
  }
}

export class Plugin {
  app = new App();
  addStatusBarItem = vi.fn<() => HTMLDivElement>(() => document.createElement('div'));
  addSettingTab = vi.fn<(...args: unknown[]) => unknown>();
  loadData = vi.fn<() => Promise<Record<string, never>>>(async () => ({}));
  saveData = vi.fn<() => Promise<void>>(async () => {});
  registerDomEvent = vi.fn<(...args: unknown[]) => unknown>();
  registerEvent = vi.fn<(...args: unknown[]) => unknown>();
  registerInterval = vi.fn<(...args: unknown[]) => unknown>();
}

export class PluginSettingTab {
  containerEl = document.createElement('div');

  constructor(
    public app: App,
    public plugin: Plugin,
  ) {}
}

export class App {
  vault: Vault;
  fileManager: {
    trashFile: (file: TFile | TFolder) => Promise<void>;
    renameFile: (file: TFile | TFolder, newPath: string) => Promise<void>;
  };
  workspace: {
    on: (...args: any[]) => any;
    getLeavesOfType: (...args: any[]) => any;
    getActiveFile: (...args: any[]) => any;
  };
  constructor() {
    this.vault = new Vault();
    this.fileManager = {
      trashFile: vi.fn<(file: TFile | TFolder) => Promise<void>>(async (file: TFile | TFolder) => {
        this.vault.files.delete(file.path);
        if (file.parent) {
          file.parent.children = file.parent.children.filter((c) => c !== file);
        }
      }),
      renameFile: vi.fn<(file: TFile | TFolder, newPath: string) => Promise<void>>(
        async (file: TFile | TFolder, newPath: string) => {
          const normalized = normalizePath(newPath);
          this.vault.files.delete(file.path);
          if (file.parent) {
            file.parent.children = file.parent.children.filter((c) => c !== file);
          }
          file.path = normalized;
          const parts = normalized.split('/');
          file.name = parts.pop() || '';
          this.vault.files.set(normalized, file);
        },
      ),
    };
    this.workspace = {
      on: vi.fn<(...args: unknown[]) => unknown>(),
      getLeavesOfType: vi.fn<(...args: unknown[]) => unknown[]>().mockReturnValue([]),
      getActiveFile: vi.fn<() => null>().mockReturnValue(null),
    };
  }
}

export function normalizePath(path: string): string {
  return path.replace(/[\\/]+/g, '/');
}

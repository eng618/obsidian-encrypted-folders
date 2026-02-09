import { FileService } from '../services/FileService';
import { TFile, TFolder, Vault } from './mocks/obsidian';

describe('FileService', () => {
  let vault: Vault;
  let fileService: FileService;

  beforeEach(() => {
    vault = new Vault();
    fileService = new FileService(vault as unknown as import('obsidian').Vault);
    vi.clearAllMocks();
  });

  describe('readBinary', () => {
    it('should read binary data from a file', async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]).buffer;
      const file = new TFile();
      file.path = 'test.txt';
      file.name = 'test.txt';
      file.data = testData;
      file.stat = { size: testData.byteLength, mtime: Date.now(), ctime: Date.now() };

      const result = await fileService.readBinary(file as unknown as import('obsidian').TFile);

      expect(vault.readBinary).toHaveBeenCalledWith(file);
      expect(result).toBe(testData);
    });
  });

  describe('writeBinary', () => {
    it('should create a new file when it does not exist', async () => {
      const testData = new Uint8Array([1, 2, 3]).buffer;

      const result = await fileService.writeBinary('newfile.txt', testData);

      expect(vault.createBinary).toHaveBeenCalledWith('newfile.txt', testData);
      expect(result.path).toBe('newfile.txt');
    });

    it('should modify existing file when it exists', async () => {
      const existingFile = new TFile();
      existingFile.path = 'existing.txt';
      existingFile.name = 'existing.txt';
      existingFile.stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
      vault.files.set('existing.txt', existingFile);

      // Mock createBinary to throw "already exists" error
      vault.createBinary.mockRejectedValueOnce(new Error('File already exists'));

      const testData = new Uint8Array([4, 5, 6]).buffer;
      const result = await fileService.writeBinary('existing.txt', testData);

      expect(vault.modifyBinary).toHaveBeenCalledWith(existingFile, testData);
      expect(result).toBe(existingFile);
    });

    it('should throw error for non-file existing path', async () => {
      const folder = new TFolder();
      folder.path = 'somefolder';
      folder.children = [];
      vault.files.set('somefolder', folder);

      vault.createBinary.mockRejectedValueOnce(new Error('File already exists'));
      // Add adapter mock for this edge case
      (vault as unknown as { adapter: { writeBinary: ReturnType<typeof vi.fn> } }).adapter = {
        writeBinary: vi.fn(),
      };

      const testData = new Uint8Array([1, 2, 3]).buffer;

      // This should attempt adapter write and then fail to find file
      await expect(fileService.writeBinary('somefolder', testData)).rejects.toThrow();
    });
  });

  describe('secureWrite', () => {
    it('should modify existing file directly', async () => {
      const existingFile = new TFile();
      existingFile.path = 'secure.txt';
      existingFile.name = 'secure.txt';
      existingFile.stat = { size: 10, mtime: Date.now(), ctime: Date.now() };
      vault.files.set('secure.txt', existingFile);

      const testData = new Uint8Array([7, 8, 9]).buffer;
      const result = await fileService.secureWrite('secure.txt', testData);

      expect(vault.modifyBinary).toHaveBeenCalledWith(existingFile, testData);
      expect(result).toBe(existingFile);
    });

    it('should create new file if not exists', async () => {
      const testData = new Uint8Array([10, 11, 12]).buffer;

      const result = await fileService.secureWrite('newsecure.txt', testData);

      expect(vault.createBinary).toHaveBeenCalled();
      expect(result.path).toBe('newsecure.txt');
    });
  });

  describe('deleteFile', () => {
    it('should trash a file', async () => {
      const file = new TFile();
      file.path = 'todelete.txt';
      file.name = 'todelete.txt';
      file.stat = { size: 0, mtime: Date.now(), ctime: Date.now() };

      await fileService.deleteFile(file as unknown as import('obsidian').TFile);

      expect(vault.trash).toHaveBeenCalledWith(file, true);
    });
  });

  describe('shredFile', () => {
    it('should overwrite file with random data before deletion', async () => {
      const file = new TFile();
      file.path = 'toshred.txt';
      file.name = 'toshred.txt';
      file.stat = { size: 100, mtime: Date.now(), ctime: Date.now() };

      await fileService.shredFile(file as unknown as import('obsidian').TFile);

      expect(vault.modifyBinary).toHaveBeenCalled();
      expect(vault.delete).toHaveBeenCalledWith(file);
    });

    it('should handle large files by chunking random values', async () => {
      const file = new TFile();
      file.path = 'largefile.bin';
      file.name = 'largefile.bin';
      file.stat = { size: 100000, mtime: Date.now(), ctime: Date.now() }; // Large file

      await fileService.shredFile(file as unknown as import('obsidian').TFile);

      expect(vault.modifyBinary).toHaveBeenCalled();
      // Verify the data passed has the correct size
      const modifyCall = vault.modifyBinary.mock.calls[0];
      expect(modifyCall[1].byteLength).toBe(100000);
    });
  });

  describe('exists', () => {
    it('should return true when file exists', () => {
      const file = new TFile();
      file.path = 'exists.txt';
      file.name = 'exists.txt';
      file.stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
      vault.files.set('exists.txt', file);

      expect(fileService.exists('exists.txt')).toBe(true);
    });

    it('should return false when file does not exist', () => {
      expect(fileService.exists('nonexistent.txt')).toBe(false);
    });

    it('should return false when path is a folder', () => {
      const folder = new TFolder();
      folder.path = 'afolder';
      folder.children = [];
      vault.files.set('afolder', folder);

      expect(fileService.exists('afolder')).toBe(false);
    });
  });

  describe('getFile', () => {
    it('should return TFile when file exists', () => {
      const file = new TFile();
      file.path = 'getme.txt';
      file.name = 'getme.txt';
      file.stat = { size: 0, mtime: Date.now(), ctime: Date.now() };
      vault.files.set('getme.txt', file);

      const result = fileService.getFile('getme.txt');

      expect(result).toBe(file);
    });

    it('should return null when file does not exist', () => {
      const result = fileService.getFile('nofile.txt');

      expect(result).toBeNull();
    });

    it('should return null when path is a folder', () => {
      const folder = new TFolder();
      folder.path = 'justafolder';
      folder.children = [];
      vault.files.set('justafolder', folder);

      const result = fileService.getFile('justafolder');

      expect(result).toBeNull();
    });
  });
});

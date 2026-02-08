import { EncryptionService } from '../services/EncryptionService';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    service = new EncryptionService();
  });

  test('should derive a key from password and salt', async () => {
    const password = 'test-password';
    const salt = service.generateSalt();
    const key = await service.deriveKey(password, salt);
    expect(key).toBeDefined();
    expect(key.type).toBe('secret');
  });

  test('should encrypt and decrypt data correctly', async () => {
    const password = 'test-password';
    const data = new TextEncoder().encode('Hello world').buffer;

    const result = await service.encrypt(data, password);
    expect(result.ciphertext).toBeDefined();
    expect(result.iv).toHaveLength(12);
    expect(result.salt).toHaveLength(16);

    const decrypted = await service.decrypt(result.ciphertext, password, result.iv, result.salt);
    const decryptedText = new TextDecoder().decode(decrypted);
    expect(decryptedText).toBe('Hello world');
  });

  test('should encrypt and decrypt with a pre-derived key', async () => {
    const password = 'test-password';
    const salt = service.generateSalt();
    const key = await service.deriveKey(password, salt);

    const data = new TextEncoder().encode('Secret message').buffer;
    const result = await service.encryptWithKey(data, key);

    const decrypted = await service.decryptWithKey(result.ciphertext, key, result.iv);
    const decryptedText = new TextDecoder().decode(decrypted);
    expect(decryptedText).toBe('Secret message');
  });

  test('should fail decryption with incorrect password', async () => {
    const password = 'correct-password';
    const wrongPassword = 'wrong-password';
    const data = new TextEncoder().encode('Private data').buffer;

    const result = await service.encrypt(data, password);

    await expect(service.decrypt(result.ciphertext, wrongPassword, result.iv, result.salt)).rejects.toThrow();
  });

  test('should generate master key and export/import it', async () => {
    const masterKey = await service.generateMasterKey();
    const exported = await service.exportKey(masterKey);
    const imported = await service.importKey(exported);

    const data = new TextEncoder().encode('Master secret').buffer;
    const subResult = await service.encryptWithKey(data, masterKey);
    const decrypted = await service.decryptWithKey(subResult.ciphertext, imported, subResult.iv);

    expect(new TextDecoder().decode(decrypted)).toBe('Master secret');
  });
});

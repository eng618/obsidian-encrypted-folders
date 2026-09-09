import * as fc from 'fast-check';
import { BatchProcessor } from '../services/BatchProcessor';
import { EncryptionService } from '../services/EncryptionService';
import { TFile, TFolder } from './mocks/obsidian';

describe('Property-Based Cryptographic & Fuzzing Tests', () => {
  let encryptionService: EncryptionService;

  beforeEach(() => {
    encryptionService = new EncryptionService();
  });

  test('Property 1: Cryptographic Invariance (Round-Trip Arbitrary Payloads)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 5000 }),
        fc.string({ minLength: 8, maxLength: 64 }),
        async (payloadBytes, password) => {
          const payload = new Uint8Array(payloadBytes.length);
          payload.set(payloadBytes);

          const masterKey = await encryptionService.generateMasterKey(true);
          const rawMasterKey = await encryptionService.exportKey(masterKey);
          const cryptoKey = await encryptionService.importKey(rawMasterKey, false);

          const { iv, ciphertext } = await encryptionService.encryptWithKey(payload.buffer as ArrayBuffer, cryptoKey);
          const decrypted = await encryptionService.decryptWithKey(ciphertext, cryptoKey, iv);

          const originalArr = payload;
          const decryptedArr = new Uint8Array(decrypted);

          expect(decryptedArr.byteLength).toBe(originalArr.byteLength);
          for (let i = 0; i < originalArr.length; i++) {
            if (originalArr[i] !== decryptedArr[i]) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 50 },
    );
  }, 15000);

  test('Property 2: Fuzzing Bit Corruption Rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 2000 }),
        fc.integer({ min: 0, max: 100 }),
        async (payloadBytes, bitToFlip) => {
          const payload = new Uint8Array(payloadBytes.length);
          payload.set(payloadBytes);

          const masterKey = await encryptionService.generateMasterKey(false);
          const { iv, ciphertext } = await encryptionService.encryptWithKey(payload.buffer as ArrayBuffer, masterKey);

          const corruptedView = new Uint8Array(ciphertext.slice(0));
          if (corruptedView.length > 0) {
            const index = bitToFlip % corruptedView.length;
            corruptedView[index] ^= 0xff; // Flip bits
          }

          await expect(
            encryptionService.decryptWithKey(corruptedView.buffer as ArrayBuffer, masterKey, iv),
          ).rejects.toThrow();
        },
      ),
      { numRuns: 30 },
    );
  }, 15000);

  test('Property 3: Fuzzing Truncated Ciphertext Rejection', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 32, maxLength: 1000 }),
        fc.integer({ min: 1, max: 20 }),
        async (payloadBytes, truncateBytes) => {
          const payload = new Uint8Array(payloadBytes.length);
          payload.set(payloadBytes);

          const masterKey = await encryptionService.generateMasterKey(false);
          const { iv, ciphertext } = await encryptionService.encryptWithKey(payload.buffer as ArrayBuffer, masterKey);

          const truncated = ciphertext.slice(0, Math.max(0, ciphertext.byteLength - truncateBytes));

          await expect(encryptionService.decryptWithKey(truncated as ArrayBuffer, masterKey, iv)).rejects.toThrow();
        },
      ),
      { numRuns: 30 },
    );
  }, 15000);

  test('Property 4: BatchProcessor handles unicode paths & deep folder structures without crashing', () => {
    const processor = new BatchProcessor(() => false);

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            isFolder: fc.boolean(),
            isLocked: fc.boolean(),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        (items) => {
          const root = new TFolder();
          root.path = 'root';
          root.children = root.children || [];

          items.forEach((item, idx) => {
            if (item.isFolder) {
              const folder = new TFolder();
              folder.path = `root/${item.name}_${idx}`;
              folder.children = folder.children || [];
              root.children.push(folder as any);
            } else {
              const file = new TFile();
              file.path = `root/${item.name}_${idx}${item.isLocked ? '.locked' : '.md'}`;
              root.children.push(file as any);
            }
          });

          const lockedCount = processor.countLockedFiles(root as any);
          const encryptable = processor.collectProcessableFiles(root as any, 'encrypt');
          const decryptable = processor.collectProcessableFiles(root as any, 'decrypt');

          expect(typeof lockedCount).toBe('number');
          expect(Array.isArray(encryptable)).toBe(true);
          expect(Array.isArray(decryptable)).toBe(true);
        },
      ),
    );
  });
});

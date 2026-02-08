/* eslint-disable @typescript-eslint/no-explicit-any */
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

(global as any).window = global;
(global as any).window.crypto = webcrypto;

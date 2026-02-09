/* eslint-disable @typescript-eslint/no-explicit-any */
import { webcrypto } from 'node:crypto';

// Polyfill crypto for both Node and jsdom environments
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = webcrypto;
}

// In jsdom environment, window is already defined but might need crypto
if (typeof window !== 'undefined' && typeof window.crypto === 'undefined') {
  (window as any).crypto = webcrypto;
}

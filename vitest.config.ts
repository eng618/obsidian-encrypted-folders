import * as path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // 600k-iteration PBKDF2 exceeds Vitest's 5s default under CI coverage.
    testTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    alias: {
      obsidian: path.resolve(import.meta.dirname, './src/test/mocks/obsidian.ts'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'clover'],
      include: ['src/**/*.ts'],
      exclude: ['src/test/**', 'src/**/*.d.ts', 'src/ui/**', 'src/models/**', 'main.ts'],
    },
  },
});

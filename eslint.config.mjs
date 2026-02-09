import { recommended } from '@gv-tech/eslint-config';

/**
 * ESLint configuration for TypeScript projects. Uses @gv-tech/eslint-config for sensible defaults. For more information
 * on configuration options, see: https://github.com/Garcia-Ventures/eslint-config
 */
export default [
  {
    ignores: [
      'main.js',
      'esbuild.config.mjs',
      'eslint.config.mjs',
      '**/test-vault/**',
      'TestVault/**',
      'node_modules/**',
      'dist/**',
    ],
  },
  ...recommended,
];

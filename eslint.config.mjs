import { recommended } from '@gv-tech/eslint-config';
import obsidianmd from 'eslint-plugin-obsidianmd';

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
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  ...recommended,
  {
    files: ['src/test/**/*.ts', 'src/test/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/ui/sentence-case': 'off',
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
];

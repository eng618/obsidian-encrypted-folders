import { recommended } from '@gv-tech/eslint-config';
import obsidianmd from 'eslint-plugin-obsidianmd';

/**
 * ESLint configuration for TypeScript projects. Uses @gv-tech/eslint-config for sensible defaults. For more information
 * on configuration options, see: https://github.com/Garcia-Ventures/eslint-config
 *
 * obsidianmd.configs.recommended is an array of flat configs (not a rules
 * object), so it must be spread directly. Filtering Object.entries for
 * 'obsidianmd/' yields nothing and silently disables all Obsidian rules.
 */
export default [
  {
    ignores: ['esbuild.config.mjs', '**/test-vault/**', 'TestVault/**', 'node_modules/**', 'dist/**'],
  },
  ...recommended,
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/test/**/*.ts', 'src/test/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      'no-undef': 'off',
      'no-useless-escape': 'off',
      'no-console': 'off',
      'obsidianmd/ui/sentence-case': 'off',
      'obsidianmd/no-static-styles-assignment': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
];

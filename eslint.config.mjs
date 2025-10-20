import globals from 'globals';
import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist', 'node_modules', 'coverage', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: true,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': ts,
    },
    rules: {
      ...ts.configs.base.rules,
      ...ts.configs['eslint-recommended'].rules,
      ...ts.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  {
    plugins: {
      prettier: prettier,
    },
    rules: {
      ...prettierConfig.rules,
      'prettier/prettier': 'error',
    },
  },
];

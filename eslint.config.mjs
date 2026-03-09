import { recommended } from '@gv-tech/eslint-config';
import obsidianmd from 'eslint-plugin-obsidianmd';

const obsidianRecommendedRules = Object.fromEntries(
  Object.entries(obsidianmd.configs.recommended).filter(([ruleName]) => ruleName.startsWith('obsidianmd/')),
);

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
    plugins: {
      obsidianmd,
    },
    rules: {
      ...obsidianRecommendedRules,
    },
  },
];

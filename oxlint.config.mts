import { vite } from '@gv-tech/oxc-config/vite';
import { defineConfig } from 'oxlint';

/**
 * Oxlint configuration for Vite + React + TypeScript projects.
 * Uses @gv-tech/oxc-config for sensible defaults.
 * For more information on configuration options, see:
 * https://github.com/Garcia-Ventures/oxc-config
 */
export default defineConfig({ extends: [vite] });

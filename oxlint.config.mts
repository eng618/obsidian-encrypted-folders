import { vite } from '@gv-tech/oxc-config/vite';
import { defineConfig } from 'oxlint';

/**
 * Oxlint configuration for this Obsidian plugin.
 * Extends the shared Vite preset from @gv-tech/oxc-config.
 * https://github.com/Garcia-Ventures/oxc-config
 */
export default defineConfig({ extends: [vite] });

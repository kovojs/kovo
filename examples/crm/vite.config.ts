import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

import { kovoExampleServeTask } from '../vite-plus-tasks.js';

export const crmViteConfig = defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        styles: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  // The multi-tenant demo server installs its own per-session request dispatch.
  plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app-shell.ts' })],
  // PGlite (WASM) makes the build/dev paths slow; give the tests room.
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  run: {
    tasks: {
      serve: kovoExampleServeTask(),
    },
  },
});

export default crmViteConfig;

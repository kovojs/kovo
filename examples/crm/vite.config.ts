import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';
import { fileURLToPath } from 'node:url';

import { kovoExampleServeTask } from '../vite-plus-tasks.js';

const exampleGeneratedGraphsGlobalSetup = fileURLToPath(
  new URL('../../tests/example-generated-graphs.global-setup.ts', import.meta.url),
);
const exampleGeneratedGraphsSetup = fileURLToPath(
  new URL('../../tests/example-generated-graphs.setup.ts', import.meta.url),
);

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
    globalSetup: [exampleGeneratedGraphsGlobalSetup],
    hookTimeout: 60_000,
    setupFiles: [exampleGeneratedGraphsSetup],
    testTimeout: 60_000,
  },
  run: {
    tasks: {
      serve: kovoExampleServeTask(),
    },
  },
});

export default crmViteConfig;

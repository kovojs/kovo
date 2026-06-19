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

export const soViteConfig = defineConfig({
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
  // KOVO_DEMO_MULTITENANT (scripts/demo-serve.mjs) mounts its own per-session
  // request dispatch, so drop the singleton app-shell dev plugin that would
  // otherwise claim app routes against one shared PGlite (SPEC.md §9.5).
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

export default soViteConfig;

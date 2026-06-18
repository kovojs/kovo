import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

import { kovoExampleServeTask } from '../vite-plus-tasks.js';

export const commerceViteConfig = defineConfig({
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
  // request dispatch, so drop the singleton app dev plugin that would
  // otherwise also claim app routes against one shared PGlite (SPEC.md §9.5).
  plugins: process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app.tsx' })],
  // The Drizzle/PGlite (WASM) data layer makes the build/dev tests (which spawn
  // real vite builds and a dev server) run well past Vitest's 5s default,
  // especially under the suite's parallelism. Give them room.
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

export default commerceViteConfig;

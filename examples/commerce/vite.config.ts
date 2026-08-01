import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';
import { fileURLToPath } from 'node:url';

import { commerceRegistryFacts, exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';
import { kovoExampleServeTask } from '../vite-plus-tasks.js';

const exampleGeneratedGraphsGlobalSetup = fileURLToPath(
  new URL('../../tests/example-generated-graphs.global-setup.ts', import.meta.url),
);
const exampleGeneratedGraphsSetup = fileURLToPath(
  new URL('../../tests/example-generated-graphs.setup.ts', import.meta.url),
);
const isMultitenantDemo = process.env.KOVO_DEMO_MULTITENANT === '1';

export const commerceViteConfig = defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        // Keep dependency scanning independent of the process that launches
        // the configured app; hosted tests start this server from the repo root.
        styles: fileURLToPath(new URL('./src/styles.css', import.meta.url)),
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  // KOVO_DEMO_MULTITENANT (scripts/demo-serve.mjs) mounts its own per-session
  // request dispatch, so drop the singleton app dev plugin that would
  // otherwise also claim app routes against one shared PGlite (SPEC.md §9.5).
  // The ordinary app uses `kovo({ app })` as the sole compiler owner so server-derived
  // project facts cannot be split from the compiler that consumes them (SPEC.md §5.2).
  plugins: isMultitenantDemo
    ? [
        exampleKovoCompilerPlugin({
          include: ['src'],
          registryFacts: commerceRegistryFacts,
        }),
      ]
    : [kovo({ app: '/src/app.tsx' })],
  // The Drizzle/PGlite (WASM) data layer makes the build/dev tests (which spawn
  // real vite builds and a dev server) run well past Vitest's 5s default,
  // especially under the suite's parallelism. Give them room.
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

export default commerceViteConfig;

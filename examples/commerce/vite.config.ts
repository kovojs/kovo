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
const isVitest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

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
  plugins: isVitest
    ? [kovo({ app: '/src/app.tsx' })]
    : [
        exampleKovoCompilerPlugin({
          include: ['src/components', 'src/domain.ts', 'src/queries.ts'],
          registryFacts: commerceRegistryFacts,
        }),
        ...(process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app.tsx' })]),
      ],
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

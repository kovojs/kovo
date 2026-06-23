import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';
import { fileURLToPath } from 'node:url';

import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';
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
  // KOVO_DEMO_MULTITENANT (scripts/demo-serve.mjs) mounts its own per-session request dispatch,
  // so drop the singleton app-shell dev plugin and enable the compiler pre-plugin for SPEC
  // §4.8/§5.2 output escaping. Source-mode dev/tests keep their existing app-shell plugin path.
  plugins: [
    ...(process.env.KOVO_DEMO_MULTITENANT
      ? [
          exampleKovoCompilerPlugin({
            include: [
              'src/components/question-card.tsx',
              'src/components/question-detail.tsx',
              'src/components/question-list.tsx',
            ],
          }),
        ]
      : []),
    ...(process.env.KOVO_DEMO_MULTITENANT ? [] : [kovo({ app: '/src/app-shell.ts' })]),
  ],
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

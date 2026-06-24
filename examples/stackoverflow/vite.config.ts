import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';
import { fileURLToPath } from 'node:url';

import { exampleDrizzleRegistryPlugin, exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';
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
  // SPEC §5.2 / §9.1: query-backed regions run through the real component
  // compiler so their live-target renderers are compiler-emitted artifacts, not
  // hand-authored app code. KOVO_DEMO_MULTITENANT still only controls the
  // singleton app-shell plugin because scripts/demo-serve.mjs mounts its own
  // per-session request dispatch.
  plugins: [
    exampleDrizzleRegistryPlugin({
      appEntries: ['src/app-shell.ts', 'src/interactive-app.tsx'],
      mutationTouchGraphKeys: {
        postAnswer: 'postAnswer',
        postQuestion: 'postQuestion',
        voteUp: 'voteUp',
      },
      sourceRoot: 'src',
    }),
    exampleKovoCompilerPlugin({
      include: [
        'src/components/question-card.tsx',
        'src/components/question-detail.tsx',
        'src/components/question-list.tsx',
      ],
    }),
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

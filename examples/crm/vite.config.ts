import { kovo } from '@kovojs/server/vite';
import { defineConfig } from 'vite-plus';

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
      serve: {
        command: 'node scripts/serve.mjs',
        input: [
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'scripts/serve.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
      },
    },
  },
});

export default crmViteConfig;

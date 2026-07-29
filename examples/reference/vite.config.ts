import { defineConfig } from 'vite-plus';
import { kovo } from '@kovojs/server/vite';

export default defineConfig({
  plugins: [kovo({ app: '/src/app-shell.ts' })],
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs --public',
        input: [
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*.ts', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
    },
  },
  test: {
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});

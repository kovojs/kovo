import { defineConfig } from 'vite-plus';

import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

export default defineConfig({
  plugins: [exampleKovoCompilerPlugin({ include: ['src/interactive'] })],
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*.js', base: 'workspace' },
          { pattern: 'src/**/*.ts', base: 'workspace' },
          { pattern: 'src/**/*.tsx', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
    },
  },
  test: {
    exclude: ['**/*.browser.test.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});

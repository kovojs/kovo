import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  build: {
    outDir: 'dist-css',
    rollupOptions: {
      input: {
        site: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [tailwindcss()],
  run: {
    tasks: {
      'build-site': {
        command: 'vp build && node scripts/build.mjs',
        input: [
          { pattern: 'content/**/*', base: 'workspace' },
          { pattern: 'public/**/*', base: 'workspace' },
          { pattern: 'scripts/**/*', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      'check-links': {
        command: 'node scripts/check-links.mjs',
        input: [{ pattern: 'dist/**', base: 'workspace' }],
      },
      export: {
        command:
          'pnpm --dir .. exec vp run build && vp build && node scripts/build.mjs && node ../dist/cli/src/index.mjs export ./scripts/app-shell.mjs --out dist',
        input: [
          { pattern: 'content/**/*', base: 'workspace' },
          { pattern: 'public/**/*', base: 'workspace' },
          { pattern: 'scripts/**/*', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      smoke: {
        command: 'node scripts/smoke.mjs',
        input: [
          { pattern: 'dist/**', base: 'workspace' },
          { pattern: 'scripts/smoke.mjs', base: 'workspace' },
        ],
      },
      'tutorial-steps': {
        command: 'node tutorial/run-steps.mjs',
        input: [
          { pattern: 'content/tutorial/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
        ],
      },
    },
  },
});

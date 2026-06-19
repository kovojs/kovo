import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

export default defineConfig({
  plugins: [exampleKovoCompilerPlugin({ include: ['src/interactive'] })],
  resolve: {
    alias: {
      '@kovojs/server/jsx-dev-runtime': fileURLToPath(
        new URL('./src/interactive-gallery.browser-jsx-runtime.ts', import.meta.url),
      ),
      '@kovojs/server/jsx-runtime': fileURLToPath(
        new URL('./src/interactive-gallery.browser-jsx-runtime.ts', import.meta.url),
      ),
    },
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: 'chromium' }],
      provider: playwright(),
    },
    include: ['src/**/*.browser.test.ts'],
  },
});

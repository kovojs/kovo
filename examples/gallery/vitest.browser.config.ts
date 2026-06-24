import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

const headed = process.env.KOVO_GALLERY_BROWSER_HEADED === '1';

export default defineConfig({
  optimizeDeps: {
    include: ['@material/material-color-utilities', 'axe-core'],
  },
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
      headless: !headed,
      instances: [{ browser: 'chromium' }],
      provider: playwright({ launchOptions: { channel: 'chromium', headless: !headed } }),
    },
    include: ['src/**/*.browser.test.ts'],
  },
});

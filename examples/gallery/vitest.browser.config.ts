import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

const headed = process.env.KOVO_GALLERY_BROWSER_HEADED === '1';
const browserCoreRuntime = fileURLToPath(
  new URL('./src/interactive-gallery.browser-core.ts', import.meta.url),
);
const browserServerRuntime = fileURLToPath(
  new URL('./src/interactive-gallery.browser-server.ts', import.meta.url),
);
const browserJsxRuntime = fileURLToPath(
  new URL('./src/interactive-gallery.browser-jsx-runtime.ts', import.meta.url),
);

export default defineConfig({
  optimizeDeps: {
    include: ['@material/material-color-utilities', 'axe-core'],
  },
  plugins: [
    galleryBrowserRuntimeBoundaryPlugin(),
    exampleKovoCompilerPlugin({ include: ['src/interactive'] }),
  ],
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

function galleryBrowserRuntimeBoundaryPlugin() {
  return {
    name: 'kovo-gallery-browser-runtime-boundary',
    enforce: 'pre' as const,
    resolveId(id: string): string | undefined {
      if (id === '@kovojs/core') return browserCoreRuntime;
      if (id === '@kovojs/server') return browserServerRuntime;
      if (id === '@kovojs/server/internal/escape') return browserJsxRuntime;
      if (id === '@kovojs/server/jsx-dev-runtime') return browserJsxRuntime;
      if (id === '@kovojs/server/jsx-runtime') return browserJsxRuntime;
      return undefined;
    },
  };
}

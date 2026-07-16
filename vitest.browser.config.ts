import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { browserSuiteAcceptance } from './tests/browser-acceptance.mjs';

export default defineConfig({
  plugins: [
    {
      name: 'kovo-browser-frame-fixture',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (!request.url?.startsWith('/__kovo_inline_security_fixture')) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end('<!doctype html><html><head></head><body></body></html>');
        });
      },
    },
  ],
  test: {
    browser: {
      enabled: true,
      headless: browserSuiteAcceptance.headless,
      instances: browserSuiteAcceptance.browsers.map((browser) => ({
        browser: browser as 'chromium' | 'firefox' | 'webkit',
      })),
      provider: playwright(),
    },
    include: browserSuiteAcceptance.include,
  },
});

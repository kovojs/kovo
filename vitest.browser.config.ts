import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { browserSuiteAcceptance } from './tests/browser-acceptance.mjs';

export default defineConfig({
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

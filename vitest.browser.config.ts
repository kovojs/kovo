import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { browserSuiteAcceptance } from './tests/browser-acceptance.mjs';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: browserSuiteAcceptance.headless,
      instances: [{ browser: browserSuiteAcceptance.browser as 'chromium' }],
      provider: playwright(),
    },
    include: browserSuiteAcceptance.include,
  },
});

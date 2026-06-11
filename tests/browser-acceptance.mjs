export const browserSuiteAcceptance = {
  browser: 'chromium',
  headless: true,
  include: ['packages/runtime/src/**/*.browser.test.ts'],
  providerPackage: '@vitest/browser-playwright',
};

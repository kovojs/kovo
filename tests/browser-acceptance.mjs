export const browserSuiteAcceptance = {
  browsers: ['chromium', 'firefox', 'webkit'],
  headless: true,
  include: ['packages/browser/src/**/*.browser.test.ts'],
  providerPackage: '@vitest/browser-playwright',
};

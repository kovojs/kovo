// Playwright config for the Kovo framework-owned integration suite.
//
// No global `webServer`: each spec declares the fixture app it drives with
// `test.use({ kovoFixture: '<folder>' })`, and the harness boots that app per
// worker on an ephemeral port (see @kovojs/test/integration). Chromium is the
// required baseline; a Firefox/WebKit matrix is added in I4 for engine-bound
// behavior (mirrors plans/compiler-quality.md browser-matrix rule).
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: fileURLToPath(new URL('./specs', import.meta.url)),
  outputDir: fileURLToPath(new URL('./test-results', import.meta.url)),
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'list',
  // Booting a fixture cold-compiles its app through Vite; give workers headroom.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

// Playwright config for the Kovo framework-owned integration suite.
//
// No global `webServer`: each spec declares the fixture app it drives with
// `test.use({ kovoFixture: '<folder>' })`, and the harness boots that app per
// worker on an ephemeral port (see @kovojs/test/internal/integration). Chromium is the
// required baseline; a Firefox/WebKit matrix is added in I4 for engine-bound
// behavior (mirrors plans/compiler-quality.md browser-matrix rule).
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

// Specs promoted to the Firefox/WebKit engine matrix. Keep this curated to
// engine-portable, engine-bound behavior; verify any addition passes on all three
// engines before promoting (a flaky cross-engine spec breaks CI on the slow path).
const CROSS_ENGINE = [
  /browser-engine-degradation-matrix\.spec\.ts/,
  /counter\.spec\.ts/,
  /binding-text-attr\.spec\.ts/,
];

export default defineConfig({
  testDir: fileURLToPath(new URL('./specs', import.meta.url)),
  // Keep run artifacts OUT of tests/integration so the `vp run integration` cache
  // (which globs tests/integration/**) isn't invalidated by each run's output.
  outputDir: fileURLToPath(new URL('../../.playwright', import.meta.url)),
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    // Human-readable per-run output (dot in CI, list locally).
    [process.env.CI ? 'dot' : 'list'],
    // Flake gate: prints a clear annotation per test that passed only on retry
    // and optionally exits non-zero when KOVO_FAIL_ON_FLAKY=1 (plans/bugs-and-testing.md D2).
    [fileURLToPath(new URL('./flaky-reporter.ts', import.meta.url))],
    // CI timing history for generated shard balancing (plans/better-testing.md).
    [fileURLToPath(new URL('./timing-reporter.ts', import.meta.url))],
  ],
  // Booting a fixture cold-compiles its app through Vite; give workers headroom.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Curated @cross-engine tier (plans/bugs-and-testing.md P3; testing-audit §5.7):
    // engine-bound behavior — degradation, the click→mutation→morph round-trip, and
    // server text/attribute bindings — runs on Firefox/WebKit too, not Chromium alone.
    {
      name: 'firefox-engine-matrix',
      testMatch: CROSS_ENGINE,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-engine-matrix',
      testMatch: CROSS_ENGINE,
      use: { ...devices['Desktop Safari'] },
    },
  ],
});

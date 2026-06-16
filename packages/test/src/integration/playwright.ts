// Playwright test fixtures for the Kovo integration suite.
//
// A spec declares which fixture app it drives with `test.use({ kovoFixture: 'name' })`.
// The harness boots that app once per worker (amortizing Vite startup), resets the
// database before each test for isolation, points `baseURL` at the live origin so
// `page.goto('/')` just works, and hands the test `db`, `login`, and `semantic`.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base, expect, type Locator, type Page } from '@playwright/test';

import { bootFixture, type BootedFixture } from './boot-fixture.js';
import { login as performLogin, type LoginOptions } from './login.js';
import { semanticSnapshot, type SemanticSnapshotOptions } from './semantic-snapshot.js';
import type { PgliteTestDb } from '../pglite.js';

const DEFAULT_FIXTURES_ROOT = fileURLToPath(
  new URL('../../../../tests/integration/fixtures/', import.meta.url),
);

/** Per-test helpers handed to a spec via the `kovoApp` fixture. */
export interface KovoApp {
  /** The current per-test database — assert directly against server truth. */
  readonly db: PgliteTestDb;
  /** The live origin (also set as Playwright `baseURL`). */
  readonly origin: string;
  /** Log in through the rendered form (handles CSRF/session). */
  login(options: LoginOptions): Promise<void>;
  /** Canonical semantic-structure snapshot of the first match of `selector`. */
  semantic(selector: string, options?: SemanticSnapshotOptions): Promise<string>;
}

/** Options a spec sets with `test.use(...)`. */
export interface KovoTestOptions {
  /** Directory holding fixture folders. Defaults to `tests/integration/fixtures`. */
  fixturesRoot: string;
  /** Fixture folder name to boot (required; set per spec). */
  kovoFixture: string;
}

interface KovoWorkerFixtures {
  kovoServer: BootedFixture;
}

interface KovoTestFixtures {
  kovoApp: KovoApp;
}

export const test = base.extend<KovoTestOptions & KovoTestFixtures, KovoWorkerFixtures>({
  fixturesRoot: [DEFAULT_FIXTURES_ROOT, { option: true, scope: 'worker' }],
  kovoFixture: ['', { option: true, scope: 'worker' }],

  kovoServer: [
    async ({ fixturesRoot, kovoFixture }, use) => {
      if (!kovoFixture) {
        throw new Error(
          "Set the fixture to drive: `test.use({ kovoFixture: '<folder>' })` at the top of the spec.",
        );
      }
      const booted = await bootFixture(path.join(fixturesRoot, kovoFixture));
      await use(booted);
      await booted.close();
    },
    { scope: 'worker' },
  ],

  // Point Playwright's baseURL at the live fixture origin so `page.goto('/x')` resolves.
  baseURL: async ({ kovoServer }, use) => {
    await use(kovoServer.origin);
  },

  kovoApp: async ({ kovoServer, page }, use) => {
    await kovoServer.reset();
    const app: KovoApp = {
      get db() {
        return kovoServer.db;
      },
      origin: kovoServer.origin,
      login: (options) => performLogin(page, kovoServer.origin, options),
      semantic: (selector, options) => snapshotLocator(page.locator(selector).first(), options),
    };
    await use(app);
  },
});

export { expect };

/** Snapshot a single locator's live `outerHTML` as a canonical semantic tree. */
export async function snapshotLocator(
  locator: Locator,
  options?: SemanticSnapshotOptions,
): Promise<string> {
  const outerHtml = await locator.evaluate((element) => (element as Element).outerHTML);
  return semanticSnapshot(outerHtml, options);
}

export type { Page };

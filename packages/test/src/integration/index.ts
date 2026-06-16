// @kovojs/test/integration — framework-owned integration suite harness.
//
// Boots a single-file Kovo fixture app on a real server and drives it in a real
// browser via @playwright/test, with non-brittle semantic-structure assertions.
// See plans/integration-test-suite.md. This subpath is dev-only (it pulls in vite +
// @playwright/test + the compiler) and is not part of the published @kovojs/test API.
export { defineFixture, isFixtureDescriptor } from './define-fixture.js';
export type {
  FixtureAppFactory,
  FixtureDefinition,
  KovoFixtureDescriptor,
  KovoFixtureRequest,
} from './define-fixture.js';

export { bootFixture } from './boot-fixture.js';
export type { BootedFixture, BootFixtureOptions } from './boot-fixture.js';

export {
  ACCESSIBLE_ATTRS,
  KOVO_SEMANTIC_ATTRS,
  semanticSnapshot,
} from './semantic-snapshot.js';
export type { SemanticSnapshotOptions } from './semantic-snapshot.js';

export { login } from './login.js';
export type { LoginOptions } from './login.js';

export { expect, snapshotLocator, test } from './playwright.js';
export type { KovoApp, KovoTestOptions, Page } from './playwright.js';

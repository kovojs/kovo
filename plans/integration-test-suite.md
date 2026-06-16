# Plan: Framework Integration Test Suite (real server + browser)

## Goal & framing

A **framework-owned** integration suite where each fixture is a *small Kovo app* exercising one
public-API / core-functionality slice, served by a **real production-built server** and driven in a
**real browser** via `@playwright/test`. Assertions are **non-brittle**: they target Kovo's emitted
semantic skeleton and use *semantic-structure snapshots*, not raw HTML or pixel diffs.

This is consistent with `SPEC.md` §11: app wiring is proof-carrying, so *apps* need few/no browser
tests — but the *framework's own* browser/integration suite is first-class. These fixtures test the
**framework**, not an app.

### Decisions (locked with maintainer)
- Runner: **`@playwright/test`** (node-driven, web-first assertions, trace viewer).
- Server target: **production build** (`vp build`-style) — closest to shipped; catches build/lowering/SSR/asset bugs.
- Fixture format: **single-file minimal app** — one `app.tsx` calling `createApp(...)`; harness supplies PGlite, Vite config, server boot, seeding.
- Assertions: **semantic-structure snapshots** over Kovo's stable attributes + ARIA, plus Playwright web-first locator assertions.

### Defaults (overridable)
- DB: **PGlite in-memory**, fresh per test; fixture exports an optional `seed(db)`.
- Auth/CSRF: harness `login()` helper hides the CSRF/session dance (the friction the commerce scratch script hit).
- Location: specs + fixtures under `tests/integration/`; reusable harness lives in `@kovojs/test` (`packages/test`).
- Build caching: prod-build artifacts keyed by fixture content hash so unchanged fixtures skip rebuild.

## What exists today (no overlap to rebuild)
- `@kovojs/test` — in-process harness (PGlite + mutations/queries + pages-as-strings + touch-domain verify). **No server, no browser.** → extend it.
- `*.browser.test.ts` (runtime/gallery) via `@vitest/browser-playwright` — mount components into Chromium DOM. **No server.**
- `examples/commerce/scratch/commerce-serve-drive.mjs` — boots real `createCommerceServeServer` + raw Playwright. **One-off, per-example, brittle.** → generalize into the harness.
- Server public API to build on: `createApp` → `createRequestHandler(app)` → `toNodeHandler(...)`; prod build via `createKovoAppShellViteBuild` (`packages/server/src/vite-build.ts`).

## Architecture

```
tests/integration/
  playwright.config.ts            # projects: chromium (+ firefox/webkit in CI); no global webServer
  fixtures/
    add-to-cart/app.tsx           # one minimal Kovo app per feature slice
    query-refetch/app.tsx
    optimistic-failure/app.tsx
    ...
  specs/
    add-to-cart.spec.ts
    ...
packages/test/src/integration/    # the reusable harness (new), exported from @kovojs/test
  boot-fixture.ts                 # generic prod-build + serve (generalizes commerce serve.mjs)
  playwright-fixtures.ts          # `test` extended with a `kovoApp` worker/test fixture
  semantic-snapshot.ts            # canonical semantic DOM serializer
  login.ts                        # CSRF/session helper
```

### Fixture contract (single-file, minimal)
```tsx
// tests/integration/fixtures/add-to-cart/app.tsx
import { createApp } from '@kovojs/core';
export default createApp({ /* routes, queries, mutations, components */ });
export async function seed(db) { /* optional */ }
```
Harness owns: PGlite creation, Vite config, prod build (cached), `toNodeHandler` SSR + `dist/assets/*`
serving on `port: 0`, teardown. Author writes only the app + assertions.

### Playwright fixture
```ts
import { test, expect } from '@kovojs/test/integration';
test('add to cart increments badge', async ({ kovoApp }) => {
  const { page, db, login, semantic } = await kovoApp('add-to-cart', { seed: true });
  await login(page, { email: 'ada@example.com', password: 'correct' });
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.locator('[data-bind="cart.count"]')).toHaveText('1'); // web-first, auto-wait
  expect(await semantic('[kovo-c="cart-badge"]')).toMatchSnapshot('cart-badge.semantic.txt');
});
```

### Semantic-structure snapshot (the non-brittle core)
`semantic(selector)` serializes a live subtree to a canonical text tree:
- **Keep:** tag name; Kovo semantic attrs (`data-bind`, `data-bind-list`, `kovo-c`, `kovo-key`,
  `kovo-query`, `kovo-deps`, `data-derive`, `data-state`/`kovo-state`, `data-error-code`,
  `data-error-path`, `kovo-fragment-target`, `data-row`, `data-route`); ARIA role + accessible name;
  normalized visible text for bound nodes.
- **Drop/normalize:** CSRF tokens, session ids, hashed/asset filenames, content-hash ids, inline
  `style`, class soup, framework-internal `kovo-param-types`/debug attrs, whitespace.
- **Result:** snapshot diffs only when *semantics* change. Self-documenting; survives markup churn.
- Reuses ideas already in `packages/test/src/html-fragment.ts` (HTML normalization) and the gallery
  aria-contract serializers — consolidate rather than reinvent.

## Phased rollout

- [ ] **I0 — Harness skeleton.** `boot-fixture.ts` (generic prod build + serve, generalizing
  `examples/commerce/scripts/serve.mjs`), `playwright-fixtures.ts` (`kovoApp` fixture: PGlite + seed +
  boot + page + teardown), `tests/integration/playwright.config.ts`, root `test:integration` script.
  Evidence: one trivial fixture (static page) boots, serves, a `page.goto('/')` passes in CI headless.
- [ ] **I1 — Semantic snapshot serializer.** `semantic-snapshot.ts` + unit tests over fixed HTML
  inputs (deterministic, browser-free) proving keep/drop/normalize rules and stability under volatile-
  attr churn. Consolidate with `html-fragment.ts`. Evidence: serializer unit suite + golden `.semantic.txt`.
- [ ] **I2 — Auth/login helper.** `login()` encapsulating CSRF token read + session cookie (kills the
  scratch-script friction). Evidence: an `auth` fixture logs in and reaches a guarded route/mutation.
- [ ] **I3 — Core-feature fixtures (first wave).** add-to-cart (mutation + fragment morph), query
  refetch/visible-return, optimistic success + failure/rollback, inline-loader form enhance, loader
  lifecycle, error-union rendering (`data-error-code/path`). One fixture + spec each; semantic
  snapshots + web-first assertions. Evidence: `test:integration` green; snapshots reviewed.
- [ ] **I4 — Build caching + CI wiring.** Content-hash fixture builds; add `test:integration` to the
  `acceptance` script and CI; Chromium required, Firefox/WebKit matrix where behavior is engine-bound
  (mirror `compiler-quality.md` browser-matrix rule). Evidence: CI run; cache hit on unchanged fixture.
- [ ] **I5 — Authoring docs.** Short "write an integration fixture in 10 lines" guide + a template
  fixture. Evidence: doc page; a new contributor fixture added against the template.

## Risks / open questions
- Prod build per fixture is the main cost → mitigated by content-hash caching + `port: 0` parallelism; revisit a shared multi-route app if fixture count explodes.
- Some L0/morph-survival behavior already covered by runtime `*.browser.test.ts`; keep this suite to *cross-layer, server-round-trip* behavior to avoid duplication.
- Semantic serializer must stay in lockstep with new emitted attributes → single source-of-truth list, asserted against compiler/runtime output.

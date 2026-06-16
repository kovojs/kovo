# Plan: Framework Integration Test Suite (real server + browser)

## Goal & framing

A **framework-owned** integration suite where each fixture is a _small Kovo app_ exercising one
public-API / core-functionality slice, served by a **real production-built server** and driven in a
**real browser** via `@playwright/test`. Assertions are **non-brittle**: they target Kovo's emitted
semantic skeleton and use _semantic-structure snapshots_, not raw HTML or pixel diffs.

This is consistent with `SPEC.md` §11: app wiring is proof-carrying, so _apps_ need few/no browser
tests — but the _framework's own_ browser/integration suite is first-class. These fixtures test the
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
export default createApp({
  /* routes, queries, mutations, components */
});
export async function seed(db) {
  /* optional */
}
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
- **Result:** snapshot diffs only when _semantics_ change. Self-documenting; survives markup churn.
- Reuses ideas already in `packages/test/src/html-fragment.ts` (HTML normalization) and the gallery
  aria-contract serializers — consolidate rather than reinvent.

## Implementation note (serve path)

The framework has no fully-bundled SSR server: even the example "production serve"
SSR-loads the app shell through a Vite middleware server while serving built
`dist/assets/*`. The harness generalizes exactly that — a Vite middleware server SSRs
the fixture (compiling `component()` TSX live) and the node http layer routes
app-matched requests to the handler with a per-request `db`, everything else to Vite.
Two compiler findings drove the design: (1) the live `kovoVitePlugin` emits the
`renderSource()` form (drops `export const Foo = component(...)`), so the harness uses
its own `kovoFixtureCompilerPlugin` returning `compileComponentModule().loweredSource`
— the fixpoint form real apps import, preserving `Foo.definition.render(data)`; (2) the
plugin claims any module whose source contains the component-call token, so fixture
entries keep components in their own files.

## Phased rollout

- [x] **I0 — Harness skeleton.** `bootFixture` (Vite-SSR + per-request `db` + routing),
      `defineFixture`/`fixture-instance`, Playwright `kovoServer`/`kovoApp` fixtures,
      `tests/integration/playwright.config.ts`, `@kovojs/test/integration` (+ light `/define`).
  - Evidence: `tests/integration/fixtures/static-home` boots and serves; `specs/static-home.spec.ts`
    passes (`pnpm run test:integration`). `tests/integration` is a workspace package so fixtures
    resolve `@kovojs/*`; Vite `ssr.noExternal: [/^@kovojs\//]` compiles TS source.
- [x] **I1 — Semantic snapshot serializer.** `semantic-snapshot.ts` (keep Kovo semantic +
      behavioral + a11y attrs; drop volatile presentation/CSRF/hash; opaque script/style/kovo-query).
  - Evidence: `packages/test/src/integration/semantic-snapshot.test.ts` — 11 browser-free unit tests
    incl. stability under volatile-only churn (`vitest --run`). Reuses `html-fragment.ts` conventions.
- [x] **I2 — Auth/login helper.** `login()` submits the rendered form + establishes the session cookie.
  - Evidence: `fixtures/auth` (sessionProvider + `guards.authed()` + `context.setCookie`); `specs/auth.spec.ts`
    — `login()` reaches the guarded route as the signed-in user, and signed-out access does not leak it.
- [x] **I3 — Core-feature fixtures (first wave).** Mutation + fragment morph, and typed error union.
  - Evidence: `fixtures/counter` (`specs/counter.spec.ts`) — click → `/_m/counter/increment` → morph
    `data-bind="count.count"` 0→1, no nav, db verified, semantic snapshot. `fixtures/stock`
    (`specs/stock.spec.ts`) — typed `OUT_OF_STOCK` failure morphs a `data-error-code` fragment.
  - [ ] Remaining first-wave fixtures: query refetch/visible-return, optimistic success +
        failure/rollback, inline-loader enhanced submit nuances, loader lifecycle. (Pattern proven;
        author against the `counter`/`stock` template.)
- [x] **I4 — CI / acceptance wiring.** `vp run integration` task + root `test:integration` →
      added to `acceptance`; CI step after the browser gate (Chromium already installed);
      `tests/integration/**` excluded from the root vitest run; Playwright `outputDir` outside the tree.
  - Evidence: `vite.config.ts` `run.tasks.integration` + vitest `exclude`; `package.json` `acceptance`;
    `.github/workflows/ci.yml` `- run: vp run integration`. Suite: 6/6 green via `pnpm run test:integration`.
  - [ ] Refinements: perfect `vp run` cache hit (currently re-runs; `{auto:true}` input churn) and the
        Firefox/WebKit matrix for engine-bound behavior (mirror `compiler-quality.md` browser-matrix).
- [x] **I5 — Authoring docs.** `docs/integration-testing.md` — "write a fixture in ~10 lines",
      the db/seed/interactive/auth contracts, the compiler-token gotcha, and the assertion ladder.

## Risks / open questions

- Per-fixture Vite startup is the main cost → amortized by per-worker boot + `port: 0` parallelism
  (6 fixtures ≈ 6s). Revisit a shared multi-route app if fixture count grows large.
- Some L0/morph-survival behavior is already covered by runtime `*.browser.test.ts`; this suite stays
  on _cross-layer, server-round-trip_ behavior to avoid duplication.
- Semantic serializer must stay in lockstep with newly emitted attributes → `KOVO_SEMANTIC_ATTRS`
  is the single keep-list; align with the compiler's `isGeneratedOnlyRenderAttribute` allowlist, and
  expect committed `.semantic.txt` goldens to need refresh when the CSP/nonce attribute work lands.

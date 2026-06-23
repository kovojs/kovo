# Bugs and Testing Audit - Codex

**Date:** 2026-06-23
**Scope:** Critical/high severity bugs and testing gaps found by a parallel audit of compiler,
server/runtime, UI components, public examples, and CI/test coverage.
**Current state:** Refreshed after `main` moved to `e9255f58`, then merged current local `main` at
`6ee23306` into `agent/bugs-testing-codex`. The repo-side fixes below are checked only where this
session has direct command evidence. Live deployed example availability remains an external
follow-up exposed by the new opt-in health gate.

## Summary

- **Fixed in this branch:** endpoint CSRF enforcement, BroadcastChannel session fingerprinting,
  request-shell load shedding, enhanced mutation reauth semantics, compiler diagnostics/import
  gaps, Dialog/Drawer/Sheet modal semantics, Select keyboard/value parity, Tabs roving focus,
  Commerce example workflows, CI acceptance coverage, example TSX cache inputs, and root gallery
  browser coverage.

The only remaining open checkbox is the deployed-service health follow-up surfaced by
`test:examples-live`.

## Critical Bugs

- [x] **Enforce default-on CSRF for `endpoint()` handlers before dispatch.**
  - **Verification:** `pnpm exec vitest run packages/server/src/app-dispatch.test.ts
    packages/server/src/app-document.test.ts packages/server/src/guards.test.ts
    packages/browser/src/mutation-submit.test.ts packages/browser/src/inline-loader-build.test.ts
    --reporter=dot` passed after endpoint dispatch gained default CSRF validation and explicit
    `csrf:false` bypass coverage.

- [x] **Derive BroadcastChannel session fingerprints from the resolved lifecycle request.**
  - **Verification:** `pnpm exec vitest run packages/server/src/app-dispatch.test.ts
    packages/server/src/app-document.test.ts packages/server/src/guards.test.ts
    packages/browser/src/mutation-submit.test.ts packages/browser/src/inline-loader-build.test.ts
    --reporter=dot` passed with non-cookie and second-cookie session fingerprint assertions.

## High Bugs

- [x] **Add pre-dispatch request-shell limits for anonymous floods and large bodies.**
  - **Verification:** `pnpm exec vitest run packages/server/src/app.test.ts
    packages/server/src/app-dispatch.test.ts packages/server/src/api/app.test.ts --reporter=dot`
    passed after `requestLimits` added 413 body-size and 429 per-IP/global shell gates before
    endpoint, mutation, or query dispatch.

- [x] **Return 401 + `Kovo-Reauth` for unauthenticated enhanced mutation guard failures.**
  - **Verification:** `pnpm exec playwright test tests/integration/specs/guarded-mutation.spec.ts`
    and `pnpm exec vitest --run packages/server/src/mutation-wire.test.ts
    packages/server/src/mutation.test.ts packages/server/src/app-mutation-request.test.ts
    --reporter=dot` passed after enhanced unauthenticated submits returned 401 `Kovo-Reauth`,
    no-JS submits redirected, and typed 403/422 failures stayed distinct.

- [x] **Extend KV420 nested-stateful-island diagnostics across module boundaries.**
  - **Verification:** `pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts
    packages/compiler/src/compile-component.test.ts packages/compiler/src/query-coverage.test.ts
    packages/compiler/src/scan/parse.test.ts` passed after registry/model facts carried
    stateful-component metadata across imports.

- [x] **Close KV235 import-boundary holes for bare/internal and app-local generated specifiers.**
  - **Verification:** `pnpm exec vitest --run packages/compiler/src/fragment-targets.test.ts
    packages/compiler/src/compile-component.test.ts packages/compiler/src/query-coverage.test.ts
    packages/compiler/src/scan/parse.test.ts` passed with bare `kovo/internal` and non-relative
    app-local generated import coverage.

- [x] **Move clock/renderOnce decisions out of raw source-string matching and widen the guard.**
  - **Verification:** `node --test --test-name-pattern "post-parse compiler phases consume model
    facts" tests/kovo-check.node.mjs` passed after the source-string guard covered `app-graph.ts`
    and `compile.ts` and the compiler tests covered quoted/computed/commented facts.

- [x] **Restore modal ARIA attributes and focus behavior for Dialog/Drawer/Sheet overlays.**
  - **Verification:** `pnpm exec vitest run packages/headless-ui/src/primitives/select.test.ts
    packages/headless-ui/src/primitives/dialog.test.ts packages/headless-ui/src/primitives/tabs.test.ts
    --reporter=dot`, `pnpm exec vitest run packages/ui/src/dialog.stylex.test.tsx
    packages/ui/src/drawer.stylex.test.tsx packages/ui/src/sheet.stylex.test.tsx
    packages/ui/src/index.overlays.test.tsx --reporter=dot`, and the gallery browser suite passed
    after role/`aria-modal`, focus entry, Escape, and focus-return behavior were covered.

- [x] **Fix Select keyboard/value parity on the component gallery.**
  - **Verification:** `pnpm --filter @kovojs/example-gallery run test:browser -- --reporter=dot`
    passed on rerun after Select exposed combobox/`aria-activedescendant` state and synchronized
    keyboard selection, trigger text, hidden input, and `SelectValue`.

- [x] **Move real DOM focus for Tabs roving keyboard navigation.**
  - **Verification:** `pnpm --filter @kovojs/example-gallery run test:browser -- --reporter=dot`
    passed on rerun after the Tabs demo moved DOM focus during arrow-key roving and Enter activated
    the newly focused tab.

- [x] **Repair the public Commerce example primary add-to-cart workflow.**
  - **Verification:** `pnpm exec vitest --run examples/commerce/src/app.add-to-cart.test.ts` and
    `pnpm exec vitest --run tests/commerce-realistic.e2e.test.ts` passed after anonymous shoppers
    saw a sign-in prompt and the realistic smoke signed in through the real auth/CSRF path before
    adding to cart.

- [x] **Fix the Commerce example's broken `More` pagination link or remove it from public output.**
  - **Verification:** `pnpm exec vitest --run examples/commerce/src/app.add-to-cart.test.ts
    tests/commerce-realistic.e2e.test.ts` passed with assertions that `/products?after=` no longer
    appears in anonymous or authenticated Commerce output.

- [x] **Add live health checks for deployed example iframes.**
  - **Verification:** `pnpm run test:examples-live` now runs `site/scripts/example-health.mjs`
    against Commerce, CRM, and Stack Overflow roots plus one core route per app, using the same
    manifest URLs and environment overrides as the docs iframe configuration.

- [ ] **Restore deployed Commerce and CRM service health exposed by the live gate.**
  - **Current evidence:** Post-merge `pnpm run test:examples-live` on 2026-06-23 passed Stack
    Overflow `/` and `/questions/q1`, but observed Commerce `/` as HTTP 503, Commerce `/cart` as
    timeout, CRM `/` as HTTP 503, and CRM `/contacts` as timeout.
  - **Next step:** Redeploy or inspect the Cloud Run services, then rerun `pnpm run
    test:examples-live` and mark this complete only when all six probes pass.

## Critical Testing Gaps

- [x] **Make CI run the omitted root acceptance gates.**
  - **Verification:** `node --test tests/kovo-check.node.mjs --test-name-pattern "root acceptance
    and CI cover the omitted release gates plus gallery browser coverage"` passed after CI ran the
    root check shard through `vp exec pnpm run check` and added explicit `check:api-surface` and
    `check:publish` coverage.

- [x] **Include TSX sources in the `typecheck-examples` task cache key.**
  - **Verification:** `node --test tests/kovo-check.node.mjs --test-name-pattern "typecheck-examples
    watches every tsx-bearing example source tree"` passed after `vite.config.ts` added TSX inputs
    for TSX-bearing example source trees.

- [x] **Run the gallery browser suite from root CI/acceptance.**
  - **Verification:** `node --test tests/kovo-check.node.mjs --test-name-pattern "framework-owned
    browser suite is wired into acceptance|root acceptance and CI cover the omitted release gates
    plus gallery browser coverage"` passed after root `acceptance` included `test:gallery-browser`
    and CI ran the gallery browser suite in the browser shard.

## Latest Verification

- `pnpm run check:api-surface` passed after the server request-limit, mutation response type, and
  merged document-protocol boundary changes.
- `pnpm run check:build` passed after the current branch changes.
- `pnpm --filter @kovojs/browser run check:inline-loader` and `pnpm exec vitest run
  packages/browser/src/inline-loader-build.test.ts packages/browser/src/mutation-submit.test.ts
  packages/browser/src/inline-loader-enhanced-submit.test.ts --reporter=dot` passed after merging
  current local `main` and regenerating the inline loader artifact.
- `pnpm --filter @kovojs/example-gallery run test:browser -- --reporter=dot` passed on rerun after
  gallery primitive fixes.
- `pnpm run test:examples-live` is intentionally failing until the deployed Commerce and Stack
  CRM services are restored.

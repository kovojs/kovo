# Example Readability Simplification

Created 2026-06-18. `SPEC.md` remains the framework behavior source of truth.
This plan changes how examples teach Kovo: examples should be readable demo apps,
not production-hardening showcases or exhaustive conformance ledgers.

## Direction

Example source should prioritize the app-author mental model:

- [x] Keep examples focused on ordinary app authoring: routes, layouts, components,
      queries, mutations, forms, guards, and generated refresh.
  - Evidence: Commerce/CRM/StackOverflow no longer carry static export scripts,
    broad source-truth matrices, or production-hardening demo routes; focused
    example tests passed for all three examples in this session.
- [x] Remove production-hardening demonstrations from example apps when they make
      the app harder to read: signed webhooks, CSV/spreadsheet hardening, attachment
      storage/download ownership checks, static-export variants, replay/security
      edge cases, and broad source-truth acceptance matrices.
  - Evidence: Commerce removed upload/webhook/CSV/admin surfaces; CRM and
    StackOverflow removed proof-style matrix tests and unused conformance-fixture
    dependencies.
- [ ] Preserve framework coverage by moving removed behavior into package-level
      conformance fixtures or focused server/core tests before deleting example tests.
- [x] Prefer a handful of cohesive files over many tiny files, but cap mega-files.
      Target authored source files around 100-400 lines where practical; tests can be
      larger but should be scenario-focused.
  - Evidence: Workers simplified example-local tests without splitting app code
    into extra tiny modules; Commerce `app.ts` is 698 lines after removing
    non-demo surfaces, while CRM/SO keep cohesive component/query/mutation files.
  - Evidence: 2026-06-17 readability pass removed Commerce `src/domains.ts` /
    `page-meta.ts`, merged CRM `src/{domains,forms}.ts` into `src/model.ts`
    (18 lines), and merged StackOverflow `src/{domains,runtime,types}.ts` into
    `src/model.ts` (78 lines); `wc -l` over authored TS/TSX now reports 7,297
    total lines across Commerce/CRM/StackOverflow.
- [x] Keep generated artifacts inspectable, but do not optimize example readability
      around generated files.
  - Evidence: generated artifacts were regenerated/checked for Commerce, CRM,
    and StackOverflow with each example's `emit-components -- --check` and
    `emit-graph -- --check`.

## Phase 1: Commerce

- [x] Reduce `examples/commerce/src/app.ts` from a kitchen-sink app into a readable
      cart demo.
  - Keep: product grid, cart badge, order history, add-to-cart mutation, simple
    session/auth shape if needed for guarded form behavior.
  - Remove or move to framework fixtures: receipt uploads, attachment downloads,
    signed payment webhook, CSV export, spreadsheet formula hardening, static
    export read-only variants, admin route/security edge cases.
  - Evidence: `wc -l examples/commerce/src/app.ts` reports 698 lines after
    removing receipt uploads, attachment downloads, signed payment webhook, CSV
    export, admin route, and login production-hardening guards.
  - Evidence: `rg -n "attachments|attachment|uploadReceipt|paymentWebhook|commercePayment|orderCsv|Receipt|Webhook|csv|runWebhook|StoredFileUpload|createMemoryStorage|stripeSignature|renderReceiptUploadForm|commerceAdminRoute|renderCommerceAdminRoute|/admin|role:admin|order/receipt|payment\\.webhook|orders\\.csv|commerceStaticExport|exportCommerceStatic|readOnly|static export|static-export|export-static" examples/commerce --glob '!**/node_modules/**'` returned no matches.
- [x] Collapse Commerce tests into readable scenario groups.
  - Keep app-level smoke/interaction tests for browsing, add-to-cart, validation,
    and auth/session if still present.
  - Move source-truth graph/verifier/security-hardening assertions out of the
    example test suite or delete them after equivalent package coverage exists.
  - Evidence: deleted `examples/commerce/src/app.uploads-webhooks.test.ts`;
    `examples/commerce/src/app.auth.test.ts` is 137 lines and covers normal
    session/login/logout behavior only.
  - Evidence: `examples/commerce/src/source-truth.test.ts` is now 122 lines and
    checks graph/query behavior directly instead of importing conformance graph
    matrix helpers.
  - Evidence: `pnpm --filter @kovojs/example-commerce test -- app-shell.test.ts app.auth.test.ts app.queries.test.ts app.rendering.test.ts app.add-to-cart.test.ts source-truth.test.ts` passed 6 files / 37 tests.
  - Evidence: after simplifying `source-truth.test.ts`,
    `pnpm --filter @kovojs/example-commerce test -- source-truth.test.ts queries-delta.test.ts app.queries.test.ts` passed 3 files / 15 tests.
- [x] Update Commerce graph and emit scripts to match the simplified feature set.
  - Evidence: `examples/commerce/src/generated/graph.json` now has
    `endpoints: []`, one page (`/cart`), mutations `cart/add` and
    `auth/sign-out`, and touch graph key `cart.addItem`.
  - Evidence: `pnpm --filter @kovojs/example-commerce run emit-components -- --check`
    and `pnpm --filter @kovojs/example-commerce run emit-graph -- --check` passed.
- [x] Verification: Commerce generated artifacts check, focused Commerce tests,
      root typecheck, API surface gate, and no-match checks for removed hardening
      surfaces in authored Commerce source.
  - Evidence: `pnpm exec vitest --run packages/conformance-fixtures/src/commerce-fixtures.test.ts packages/conformance-fixtures/src/package-exports.test.ts packages/conformance-fixtures/src/graph-fixtures.test.ts` passed 3 files / 17 tests.
  - Evidence: `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`, `node scripts/api-surface-gate.mjs`, `pnpm run check:build`, and `git diff --check` passed.
  - Evidence: `pnpm exec vp run kovo-check` is blocked before assertions by missing publish-layout artifact `dist/compiler/src/internal.mjs`; `pnpm run check:build` reproduced the root `dist/` layout but still only emitted `dist/compiler/src/index.mjs`.

## Phase 2: CRM

- [x] Keep CRM as the focused derived-vs-custom optimism example, but reduce
      commentary and test breadth that reads like conformance documentation.
  - Evidence: `examples/crm/src/graph.test.ts` is now a focused graph smoke and
    `examples/crm/src/optimistic.test.ts` replaces the deleted
    `custom-optimism.test.ts` and `derivation-commuting.test.ts`.
  - Evidence: `pnpm --filter @kovojs/example-crm test` passed 3 files / 10 tests.
- [x] Decide whether `activityList`/deal detail is necessary for the teaching goal;
      remove it if it only exists to exercise graph edge cases.
  - Evidence: no `activityList` surface remains in `examples/crm`; deal detail
    stays as part of the live CRM navigation demo.
- [x] Keep files cohesive rather than splitting into many tiny modules.
  - Evidence: CRM simplification changed existing app/query/mutation/component
    files and added one scenario-focused `optimistic.test.ts`; it did not create
    a new fragmentation layer.
  - Evidence: `pnpm --filter @kovojs/example-crm run emit-components -- --check`
    and `pnpm --filter @kovojs/example-crm run emit-graph -- --check` passed.

## Phase 3: StackOverflow

- [x] Keep StackOverflow as the focused question/answer interaction example.
  - Evidence: StackOverflow now keeps focused app and graph smoke tests after
    deleting proof-style `derivation-pglite.test.ts` and `registry-facts.test.ts`.
- [x] Reduce graph/registry tests to scenario evidence and move exhaustive optimism
      matrix assertions to conformance fixtures when possible.
  - Evidence: `examples/stackoverflow/src/kovo-graph.test.ts` now checks demo
    mutation/query connectivity plus `kovoCheck`, not every explain matrix row.
  - Evidence: `pnpm --filter @kovojs/example-stackoverflow test` passed 2 files /
    5 tests.
- [x] Keep CSRF/session boilerplate minimal and example-labeled.
  - Evidence: StackOverflow retained the ordinary interaction path without adding
    auth/session/security boilerplate.
  - Evidence: `pnpm --filter @kovojs/example-stackoverflow run emit-components -- --check`
    and `pnpm --filter @kovojs/example-stackoverflow run emit-graph -- --check`
    passed.

## Open Risks

- [ ] Static export, file upload, webhook, attachment download, CSV, replay, and
      security-hardening behavior currently get meaningful coverage from Commerce.
      Removing them from the example must not create framework coverage gaps.
  - Evidence: static export coverage now lives in `docs/static-export.md` and
    passed via `pnpm exec vitest --run packages/conformance-fixtures/src/kovo-export-fixtures.test.ts packages/server/src/static-export-route-guards.test.ts packages/server/src/static-export-endpoints.test.ts`
    plus `pnpm exec vitest --run examples/reference/src/app-shell.test.ts examples/gallery/src/interactive-gallery.static-export.test.ts`.
  - Evidence: upload/storage behavior remains covered by package-level server
    fixtures (`packages/conformance-fixtures/src/server-fixtures.ts`) and
    webhook verification remains covered by core/server tests; this session did
    not run the full webhook/storage suites, so this risk stays open.
- [x] `plans/app-authoring-ergonomics.md` item 7 already tracks retiring static
      export from interactive examples; do not double-implement that work without
      updating both ledgers.
  - Evidence: item 7 is updated with the static-export/read-only removal and
    verification evidence.

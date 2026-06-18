# Example Readability Simplification

Created 2026-06-18. `SPEC.md` remains the framework behavior source of truth.
This plan changes how examples teach Kovo: examples should be readable demo apps,
not production-hardening showcases or exhaustive conformance ledgers.

## Direction

Example source should prioritize the app-author mental model:

- [ ] Keep examples focused on ordinary app authoring: routes, layouts, components,
  queries, mutations, forms, guards, and generated refresh.
- [ ] Remove production-hardening demonstrations from example apps when they make
  the app harder to read: signed webhooks, CSV/spreadsheet hardening, attachment
  storage/download ownership checks, static-export variants, replay/security
  edge cases, and broad source-truth acceptance matrices.
- [ ] Preserve framework coverage by moving removed behavior into package-level
  conformance fixtures or focused server/core tests before deleting example tests.
- [ ] Prefer a handful of cohesive files over many tiny files, but cap mega-files.
  Target authored source files around 100-400 lines where practical; tests can be
  larger but should be scenario-focused.
- [ ] Keep generated artifacts inspectable, but do not optimize example readability
  around generated files.

## Phase 1: Commerce

- [ ] Reduce `examples/commerce/src/app.ts` from a kitchen-sink app into a readable
  cart demo.
  - Keep: product grid, cart badge, order history, add-to-cart mutation, simple
    session/auth shape if needed for guarded form behavior.
  - Remove or move to framework fixtures: receipt uploads, attachment downloads,
    signed payment webhook, CSV export, spreadsheet formula hardening, static
    export read-only variants, admin route/security edge cases.
  - Evidence: static-export/read-only variants were removed from Commerce along
    with the static scripts/tasks/tests; the broader production-hardening surfaces
    remain open.
- [ ] Collapse Commerce tests into readable scenario groups.
  - Keep app-level smoke/interaction tests for browsing, add-to-cart, validation,
    and auth/session if still present.
  - Move source-truth graph/verifier/security-hardening assertions out of the
    example test suite or delete them after equivalent package coverage exists.
  - Evidence: `examples/commerce/src/app-shell.test.ts` no longer includes the
    static-export output/command matrix assertions; broader test simplification
    remains open.
- [ ] Update Commerce graph and emit scripts to match the simplified feature set.
- [ ] Verification: Commerce generated artifacts check, focused Commerce tests,
  root typecheck, API surface gate, and no-match checks for removed hardening
  surfaces in authored Commerce source.

## Phase 2: CRM

- [ ] Keep CRM as the focused derived-vs-custom optimism example, but reduce
  commentary and test breadth that reads like conformance documentation.
- [ ] Decide whether `activityList`/deal detail is necessary for the teaching goal;
  remove it if it only exists to exercise graph edge cases.
- [ ] Keep files cohesive rather than splitting into many tiny modules.

## Phase 3: StackOverflow

- [ ] Keep StackOverflow as the focused question/answer interaction example.
- [ ] Reduce graph/registry tests to scenario evidence and move exhaustive optimism
  matrix assertions to conformance fixtures when possible.
- [ ] Keep CSRF/session boilerplate minimal and example-labeled.

## Open Risks

- [ ] Static export, file upload, webhook, attachment download, CSV, replay, and
  security-hardening behavior currently get meaningful coverage from Commerce.
  Removing them from the example must not create framework coverage gaps.
  - Evidence: static export coverage now lives in `docs/static-export.md` and
    passed via `pnpm exec vitest --run packages/conformance-fixtures/src/kovo-export-fixtures.test.ts packages/server/src/static-export-route-guards.test.ts packages/server/src/static-export-endpoints.test.ts`
    plus `pnpm exec vitest --run examples/reference/src/app-shell.test.ts examples/gallery/src/interactive-gallery.static-export.test.ts`.
- [x] `plans/app-authoring-ergonomics.md` item 7 already tracks retiring static
  export from interactive examples; do not double-implement that work without
  updating both ledgers.
  - Evidence: item 7 is updated with the static-export/read-only removal and
    verification evidence.

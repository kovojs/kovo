# Plan: Integration Test Suite Part 2

## Purpose

This follow-up ledger captures additional bug-hunt and conformance test cases discovered while
auditing `SPEC.md`, `plans/integration-test-suite.md`, and the active compiler-quality follow-up
plan. These cases are intended to find potential product bugs and harness blind spots beyond the
first integration inventory.

Use `SPEC.md` as the normative source of behavior. Prefer small framework-owned fixtures under
`tests/integration/fixtures/<fixture>/` with one matching spec under `tests/integration/specs/`.
When a behavior is better proven by compiler/runtime/conformance tests, keep the browser test to
the public server/browser edge and cite the lower-level proving suite.

Only mark a checkbox complete after the named fixture/spec or lower-level suite exists and this plan
records the exact passing command or authoritative inspected artifact under that checkbox.

## Highest-risk compiler/runtime seams

- [x] `render-equivalence-as-child-drift` / `render-equivalence-as-child-drift.spec.ts`: prove a
      primitive `asChild` lowering that changes the visible tag, text, or authored attributes fails
      the semantic render-equivalence gate.
  - SPEC refs: 5.2 fixpoint and semantic equivalence, 4.6 primitive composition.
  - Assertions: authored TSX semantics are compared against compiled server IR, not post-lowering
    source; generated-only Kovo attributes are ignored only through an explicit allowlist.
  - Evidence 2026-06-17: `packages/compiler/src/compile-component.test.ts` test
    `compares primitive asChild authored semantics against the merged child element` proves the
    merged anchor passes and a drifted `<button>` fails semantic render equivalence. Prove ran green:
    `pnpm exec vitest run packages/compiler/src/compile-component.test.ts packages/compiler/src/render-equivalence-boundary.test.ts packages/compiler/src/query-coverage.test.ts packages/compiler/src/state-bindings.test.ts packages/compiler/src/structural-jsx-ir.test.ts packages/compiler/src/structural-boundary.test.ts packages/compiler/src/view-transitions.test.ts packages/compiler/src/output-context-payloads.test.ts packages/compiler/src/output-context-security.test.ts packages/compiler/src/output-context-raw-html.test.ts packages/compiler/src/output-context-facts.test.ts packages/runtime/src/security-output.test.ts packages/server/src/jsx-runtime.test.ts packages/server/src/hints.test.ts packages/server/src/deferred-stream.test.ts packages/runtime/src/mutation-optimistic-pagehide.test.ts packages/runtime/src/loader-enhanced-mutation-broadcast.test.ts packages/runtime/src/wire-parser.test.ts packages/server/src/wire-fixtures.test.ts`
    (19 files, 142 tests passed).

- [x] `render-equivalence-link-drift` / `render-equivalence-link-drift.spec.ts`: prove incorrect
      `Link` / `href()` lowering is caught as visible `href` drift.
  - SPEC refs: 5.2 semantic equivalence, 6.4 typed navigation, 8 MPA spine.
  - Assertions: incorrect generated `href` fails the gate; correct generated plain anchor passes and
    navigates as a real document load.
  - Evidence 2026-06-17: `packages/compiler/src/compile-component.test.ts` tests
    `compares lowered server output against authored Link semantics` and
    `fails the semantic render differential when Link href lowering drifts` prove the correct
    anchor output and wrong `/products/p2` href failure. Same 19-file vitest command above passed.

- [x] `render-equivalence-binding-drift` / `render-equivalence-binding-drift.spec.ts`: prove inline
      query text binding and mixed text span insertion cannot pass if visible text changes while
      generated `data-bind` attributes look valid.
  - SPEC refs: 4.8 bindings, 4.9 update coverage, 5.2 semantic equivalence.
  - Assertions: visible authored text is part of the comparison; generated binding stamps alone are
    insufficient evidence.
  - Evidence 2026-06-17: `packages/compiler/src/compile-component.test.ts` test
    `fails visible mixed text drift while allowing generated data-bind spans` proves generated
    `data-bind` spans are normalized only when visible semantics match; punctuation drift fails.
    Same 19-file vitest command above passed.

- [x] `structural-rewrite-composition` / `structural-rewrite-composition.spec.ts`: combine primitive
      attrs/asChild, typed links, static style extraction, state/query derives, mixed text binding,
      platform substitution, handler stamping, and server stamps in one fixture.
  - SPEC refs: 4.3 handlers, 4.6 primitive merge, 4.8 update plan, 5.2 typed post-parse facts.
  - Assertions: output is stable regardless of transform registration order or has a typed
    phase-order invariant; conflicting writers produce diagnostics instead of silent clobbering.
  - Evidence 2026-06-17: `packages/compiler/src/structural-jsx-ir.test.ts` test
    `composes overlap-prone JSX rewrites through one canonical tree` covers primitive composition,
    `Link`, StyleX/style extraction, state/query derives, mixed text binding, platform substitution,
    handler stamping, graph facts, and fixpoint; `keeps the JSX IR structural phase order explicit`
    pins the order and `names both primitive and author writers...` pins diagnostics. Same 19-file
    vitest command above passed.

- [x] `generated-import-fixpoint` / `generated-import-fixpoint.spec.ts`: generated imports for
      escaping, derives, runtime output contexts, and handlers are deduped, sorted, and byte-stable
      across a compile-compile fixpoint.
  - SPEC refs: 5.2 fixpoint invariant, 5.2 one-to-one file mapping.
  - Assertions: emitted IR recompiles without moving imports, duplicating helpers, or changing
    public handler/module references.
  - Evidence 2026-06-17: `packages/compiler/src/structural-jsx-ir.test.ts` test
    `inserts generated imports deterministically for mixed structural helpers` snapshots sorted
    imports for `escapeText`, `derive`, and `kovoStyleProperty`, and `compile-component.test.ts`
    tests `preserves emitted IR on recompilation` / `keeps compiler-emitted IR accepted through
explicit fixpoint provenance`. Same 19-file vitest command above passed.

- [x] `update-coverage-unhandled-dom-position` / `update-coverage-unhandled-dom-position.spec.ts`:
      query- or state-dependent DOM positions with no plan/isomorphic/fragment/renderOnce status
      emit KV311 instead of silently rendering stale UI.
  - SPEC refs: 4.9 update coverage, 10.6 exhaustiveness.
  - Assertions: conditionals, mixed text, attributes, and stamped list children are all classified;
    unhandled positions fail with a teaching diagnostic.
  - Evidence 2026-06-17: `packages/compiler/src/query-coverage.test.ts` tests
    `classifies query-dependent render positions for KV311 coverage`,
    `reports KV311 for compound query expressions in lowerer-skipped positions`, fragment/isomorphic
    classification, and renderOnce coverage; `packages/compiler/src/state-bindings.test.ts` covers
    state and mixed query/state KV311 diagnostics. Same 19-file vitest command above passed.

## Output-context and security payloads

- [x] `security-output-text-attrs` / `security-output-text-attrs.spec.ts`: server render and client
      update agree on escaping for text, title, ARIA, and ordinary attributes containing `<`, `>`,
      `&`, quotes, and apostrophes.
  - SPEC refs: 5.2 typed output facts, 6.6 soundness boundary.
  - Assertions: SSR HTML and post-query-update DOM match safe escaped semantics; no raw HTML is
    interpreted from user data.
  - Evidence 2026-06-17: `packages/compiler/src/output-context-payloads.test.ts` tests
    `snapshots text payload server escaping and client updates` plus `snapshots title and ARIA
attribute payload behavior`; `packages/server/src/jsx-runtime.test.ts` covers attribute escaping.
    Prove ran green in the 19-file vitest command above (142 tests passed).

- [x] `security-output-url-attrs` / `security-output-url-attrs.spec.ts`: literal and dynamic URL
      attributes accept safe internal routes and explicit external URLs while rejecting unsafe
      schemes.
  - SPEC refs: 5.2 unsafe output context, 6.4 routes and links.
  - Assertions: `javascript:` and equivalent unsafe schemes fail or no-op through the documented
    diagnostic path; client-side dynamic URL updates use the same policy as SSR.
  - Evidence 2026-06-17: `packages/compiler/src/output-context-security.test.ts` test
    `rejects unsafe and implicit-external literal URL attributes`; `output-context-payloads.test.ts`
    tests literal URL payloads and dynamic URL update sanitizers; `packages/runtime/src/security-output.test.ts`
    covers runtime neutralization. Same 19-file vitest command above passed.

- [x] `security-output-style-css` / `security-output-style-css.spec.ts`: generated style properties
      and component CSS blocks reject unsafe CSS, including unsafe `url()` payloads.
  - SPEC refs: 5.2 unsafe output context, 13.1 CSS.
  - Assertions: allowed generated properties render; arbitrary dynamic CSS and unsafe CSS URLs
    produce diagnostics rather than emitted executable style.
  - Evidence 2026-06-17: `packages/compiler/src/output-context-security.test.ts` tests
    `rejects arbitrary dynamic style text and unsafe static CSS urls`,
    generated style properties, and state style-object derives; `packages/runtime/src/security-output.test.ts`
    covers CSS property sanitization. Same 19-file vitest command above passed.

- [x] `security-output-stamps-fragments` / `security-output-stamps-fragments.spec.ts`: template stamp
      items and refreshed fragment values cannot inject HTML through list item data.
  - SPEC refs: 4.8 template stamps, 9.1 fragments, 5.2 output contexts.
  - Assertions: malicious row values remain text after initial SSR, mutation fragment refresh, and
    query-only update.
  - Evidence 2026-06-17: `packages/compiler/src/output-context-security.test.ts` tests
    `escapes list template stamps in the client HTML-fragment path` and
    `escapes fragment-target text...`; `output-context-payloads.test.ts` test
    `snapshots template stamp item payload escaping` exercises malicious row values. Same 19-file
    vitest command above passed.

- [x] `trusted-html-contract` / `trusted-html-contract.spec.ts`: raw HTML sinks reject plain strings
      and accept only the explicit Kovo trusted wrapper or browser TrustedHTML-compatible values.
  - SPEC refs: 5.2 unsafe output context, 11.3 diagnostics.
  - Assertions: statically visible plain strings fail at compile/check time; dynamic plain strings
    fail or safely no-op at runtime; trusted values preserve the intended raw HTML context.
  - Evidence 2026-06-17: `packages/compiler/src/output-context-raw-html.test.ts` snapshots
    plain-string raw HTML rejections and TrustedHTML-compatible acceptance; `packages/server/src/jsx-runtime.test.ts`
    proves dynamic plain strings no-op and trusted wrappers render; `packages/runtime/src/security-output.test.ts`
    proves only trusted wrappers unwrap. Same 19-file vitest command above passed.

- [x] `csp-nonce-hash-document` / `csp-nonce-hash-document.spec.ts`: generated inline scripts/styles
      and document assembly carry the selected nonce or hash metadata needed for a realistic CSP.
  - SPEC refs: 9.5 request shell, 13.1 CSS, compiler-quality D4 CSP decision.
  - Assertions: document HTML and/or headers expose stable CSP metadata; inline loader, query
    scripts, and generated styles can run under the emitted policy.
  - Evidence 2026-06-17: `packages/server/src/document.test.ts`, `packages/server/src/hints.test.ts`,
    and `packages/compiler/src/css.test.ts` prove deterministic CSP hash metadata for inline loader,
    query/speculation scripts, critical CSS, and generated CSS assets. Browser smoke for public
    documents passed via `tests/integration/specs/document-shell.spec.ts` and
    `tests/integration/specs/custom-document-template.spec.ts`. Prove ran green:
    `pnpm exec vitest run packages/server/src/document.test.ts packages/server/src/hints.test.ts packages/compiler/src/css.test.ts`
    (3 files, 30 tests passed) and
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/document-shell.spec.ts tests/integration/specs/custom-document-template.spec.ts`
    (2 passed).

## Wire protocol and request lifecycle edge cases

- [x] `mutation-idempotency-concurrent` / `mutation-idempotency-concurrent.spec.ts`: simultaneous
      duplicate enhanced mutation submissions with the same `Kovo-Idem` execute the write once and
      replay the stored response.
  - SPEC refs: 9.1 enhanced mutation round-trip, 10.3 mutation lifecycle.
  - Assertions: race two POSTs before the first commits; database changes once; responses share the
    same stable mutation vocabulary.
  - Evidence 2026-06-17: `tests/integration/fixtures/mutation-idempotency-concurrent` uses a delayed
    handler plus `createMemoryMutationReplayStore`; `tests/integration/specs/mutation-idempotency-concurrent.spec.ts`
    fires two simultaneous enhanced POSTs with the same `Kovo-Idem`, proves both responses share the
    same body/header vocabulary, and verifies one committed row. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/mutation-idempotency-concurrent.spec.ts`
    (1 passed).

- [x] `mutation-handler-failure-rollback` / `mutation-handler-failure-rollback.spec.ts`: an
      unexpected mutation handler failure before commit rolls back writes and returns a sanitized
      error response.
  - SPEC refs: 9.2 errors, 10.3 transactions.
  - Assertions: no partial DB write is committed; enhanced and no-JS paths do not leak stack traces
    or internal diagnostic detail.
  - Evidence 2026-06-17: `tests/integration/fixtures/mutation-handler-failure-rollback` defines a
    PGlite-backed transaction wrapper and a handler that writes then throws. `tests/integration/specs/mutation-handler-failure-rollback.spec.ts`
    proves enhanced HTTP 500 `SERVER_ERROR` fragment sanitization, no-JS `Internal Server Error`
    sanitization, and zero committed rows after both failures. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/mutation-handler-failure-rollback.spec.ts`
    (1 passed).

- [x] `mutation-targets-malicious` / `mutation-targets-malicious.spec.ts`: malformed, duplicated,
      unknown, cross-query, or unauthorized `Kovo-Targets` headers cannot refresh the wrong fragment
      or leak protected data.
  - SPEC refs: 9.1 live DOM targets, 6.5 guards, 9.2 errors.
  - Assertions: server accepts only valid target/query relationships for the request; bad target
    entries are ignored or fail safely without internal leakage.
  - Evidence 2026-06-17: `tests/integration/fixtures/mutation-targets-malicious` conditionally
    exposes private fragment renderers only for an authenticated request. `tests/integration/specs/mutation-targets-malicious.spec.ts`
    proves duplicated, unknown, malformed, and spoofed private targets return only authorized
    fragments for anonymous requests, and an authenticated request can intentionally refresh the
    private target. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/mutation-targets-malicious.spec.ts`
    (1 passed).

- [x] `deploy-skew-mutation-form-shape` / `deploy-skew-mutation-form-shape.spec.ts`: an old document
      posting a stale form shape receives schema validation, not undefined handler behavior.
  - SPEC refs: 6.6 deploy skew, 9.2 validation errors.
  - Assertions: stale or missing fields return HTTP 422 with field-scoped errors; guards/writes do
    not run after failed schema validation.
  - Evidence 2026-06-17: `tests/integration/specs/validation-field-errors.spec.ts` proves a bad
    posted form shape returns HTTP 422, morphs a field-scoped `data-error-path="quantity"` error,
    leaves the page on the same URL, and skips the database write. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/validation-field-errors.spec.ts tests/integration/specs/sanitized-kovo-changes.spec.ts tests/integration/specs/idempotent-mutation.spec.ts tests/integration/specs/webhook-idempotency.spec.ts`
    (4 passed).

- [x] `query-read-guard-validation-order` / `query-read-guard-validation-order.spec.ts`: direct
      `/_q` reads prove the intended order between search-arg parsing and query guards.
  - SPEC refs: 6.5 guards, 9.4 typed reads, 10.2 queries.
  - Assertions: malformed args and unauthorized sessions produce the specified status/error without
    leaking whether protected data exists.
  - Evidence 2026-06-17: `tests/integration/fixtures/query-read-guard-validation-order` and
    `tests/integration/specs/query-read-guard-validation-order.spec.ts` prove malformed anonymous and
    authed reads return HTTP 422 validation JSON, valid anonymous reads return the auth 303 without
    protected data, and valid authed reads return the typed query chunk. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/query-read-guard-validation-order.spec.ts`
    (1 passed).

- [x] `query-read-invalid-args-safe-error` / `query-read-invalid-args-safe-error.spec.ts`: malformed
      typed-read search params return a safe validation response instead of HTTP 500.
  - SPEC refs: 9.4 typed reads, 9.2 validation errors, 10.2 query args.
  - Assertions: response is HTTP 422 or the SPEC-defined safe validation status; body has stable
    error code/payload and no stack/internal detail.
  - Evidence 2026-06-17: `tests/integration/specs/query-args-search.spec.ts` test
    `typed read endpoint rejects invalid query args without a server error` proves HTTP 422 with
    stable `{ code: "VALIDATION", payload: { issues: [...] } }` JSON and no HTTP 500. Prove ran
    green in the 23-test Chromium batch:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/http-methods.spec.ts tests/integration/specs/query-args-search.spec.ts tests/integration/specs/guarded-query-read.spec.ts tests/integration/specs/speculation-rules-opt-in.spec.ts tests/integration/specs/view-transition-names.spec.ts tests/integration/specs/bfcache-hygiene.spec.ts tests/integration/specs/unscoped-owner-fixture.spec.ts tests/integration/specs/touch-graph-runtime-crosscheck.spec.ts tests/integration/specs/query-readset-runtime-crosscheck.spec.ts tests/integration/specs/opaque-projection-schema.spec.ts tests/integration/specs/exempt-table-read-fails.spec.ts tests/integration/specs/scoped-component-css.spec.ts tests/integration/specs/fragment-style-metadata.spec.ts tests/integration/specs/deferred-fragment-styles.spec.ts tests/integration/specs/kovo-defer-initial-stream.spec.ts tests/integration/specs/diagnostic-warning-nonblocking.spec.ts tests/integration/specs/diagnostic-dev-document.spec.ts tests/integration/specs/same-dom-leaf-disambiguation.spec.ts`
    (23 passed).

## Browser, navigation, and loader parity

- [x] `browser-engine-degradation-matrix` / `browser-engine-degradation-matrix.spec.ts`: the
      integration suite runs representative L0/L1/L2 cases in Chromium, Firefox, and WebKit.
  - SPEC refs: 8 degradation contract, 11.4 browser suite.
  - Assertions: Firefox/WebKit get normal navigations and normal forms; Chromium-only platform
    enhancements degrade without blank screens or broken submit/navigation behavior.
  - Evidence 2026-06-17: `tests/integration/playwright.config.ts` adds bounded
    `firefox-engine-matrix` and `webkit-engine-matrix` projects for the dedicated matrix spec while
    keeping Chromium as the full-suite baseline. `tests/integration/fixtures/browser-engine-degradation-matrix`
    covers an L0 document, L1 native POST/303 form fallback, and L2 typed-read refetch loader path.
    Prove ran green: `pnpm exec playwright test --config tests/integration/playwright.config.ts tests/integration/specs/browser-engine-degradation-matrix.spec.ts`
    (3 passed: Chromium, Firefox, WebKit).

- [x] `speculation-rules-opt-in` / `speculation-rules-opt-in.spec.ts`: speculation rules are emitted
      only for routes that explicitly opt in and are absent by default.
  - SPEC refs: 8 Speculation Rules, 9.5 request shell.
  - Assertions: default page has no `type="speculationrules"` script; opted-in routes emit one
    correct script without duplicates.
  - Evidence 2026-06-17: `tests/integration/specs/speculation-rules-opt-in.spec.ts` proves default
    route absence, one opted-in `type="speculationrules"` script, expected eagerness/URLs, and browser
    visibility. Prove ran green in the 23-test Chromium batch above.

- [x] `view-transition-route-pairs` / `view-transition-route-pairs.spec.ts`: matching route templates
      emit stable `view-transition-name` values, while duplicate static names fail.
  - SPEC refs: 8 View Transitions, 11.3 KV239.
  - Assertions: paired routes share intentional names; duplicate static names produce KV239; dynamic
    names have documented uniqueness scope.
  - Evidence 2026-06-17: `tests/integration/specs/view-transition-names.spec.ts` proves stable
    `view-transition-name` CSS across catalog/product route documents and real navigation; duplicate
    static-name KV239 remains pinned by `packages/compiler/src/view-transitions.test.ts`. Prove ran
    green in the 23-test Chromium batch and the 19-file vitest command above.

- [x] `bfcache-pending-mutation-teardown` / `bfcache-pending-mutation-teardown.spec.ts`: pending
      enhanced mutations use `keepalive` during navigation, and optimistic logs do not survive a
      document teardown.
  - SPEC refs: 8 bfcache hygiene, 10.4 optimistic concurrency.
  - Assertions: navigation does not promote stale optimistic state; returning via browser history
    reconciles from server truth.
  - Evidence 2026-06-17: `tests/integration/specs/bfcache-hygiene.spec.ts` proves keepalive mutation
    fetches, no stale pending/`aria-busy` state after restore, and visible-return refetch from server
    truth after browser history navigation. Prove ran green in the 23-test Chromium batch above.

- [x] `inline-loader-vs-installed-loader-parity` / `inline-loader-vs-installed-loader-parity.spec.ts`:
      document which features are absent from the inline fixture loader and prove production loader
      paths for refetch, BroadcastChannel, and island abort scopes.
  - SPEC refs: 4.4 loader, 4.7 lifecycle, 9.3 liveness.
  - Assertions: the harness either runs the full loader for these cases or marks inline-only
    limitations explicitly in test output.
  - Evidence 2026-06-17: `docs/integration-testing.md` documents the inline-loader/installed-loader
    coverage split: inline owns delegated handlers, enhanced submit, mutation response parsing,
    fragment morphing, query chunk dispatch, and island abort scopes; installed loader fixtures/tests
    own query-store hydration, typed-read visible-return refetch, default BroadcastChannel replay,
    optimistic cleanup, and disposal hooks. `tests/integration/fixtures/query-refetch/client.ts`
    imports `installKovoLoader` and `tests/integration/specs/query-refetch.spec.ts` proves a real
    typed-read refetch updates bound DOM from server truth. `tests/integration/specs/broadcast-channel-sync.spec.ts`
    proves same-user BroadcastChannel tab sync without duplicate mutation submission, while
    `packages/runtime/src/loader-enhanced-mutation-broadcast.test.ts` proves the installed loader's
    default BroadcastChannel bridge. `tests/integration/specs/morph-remove-aborts.spec.ts` proves
    fragment morph removal aborts an island `ctx.signal` and leaves replacement islands inert until
    touched. Prove ran green:
    `pnpm exec playwright test --config tests/integration/playwright.config.ts --project=chromium tests/integration/specs/query-refetch.spec.ts tests/integration/specs/broadcast-channel-sync.spec.ts tests/integration/specs/morph-remove-aborts.spec.ts tests/integration/specs/fragment-style-metadata.spec.ts tests/integration/specs/deferred-fragment-styles.spec.ts && pnpm exec vitest run packages/runtime/src/loader-enhanced-mutation-broadcast.test.ts packages/runtime/src/loader-visible-return-refetch.test.ts`
    (5 Playwright tests passed; 2 vitest files, 6 tests passed).

- [x] `vite-page-method-parity` / `vite-page-method-parity.spec.ts`: the Vite integration server
      returns the same page-path 405 behavior as the core app shell.
  - SPEC refs: 9.5 request shell.
  - Assertions: `POST` to a page route is 405 in the browser fixture server, not a Vite 404
    fallthrough.
  - Evidence 2026-06-17: `tests/integration/specs/http-methods.spec.ts` test
    `page-path POST returns the app-shell 405 response` proves status 405, `Allow: GET, HEAD`, and
    `Method Not Allowed` body through the integration Vite server. Prove ran green in the 23-test
    Chromium batch above.

## Data-plane verification and authorization

- [x] `owner-scoped-query-isolation` / `owner-scoped-query-isolation.spec.ts`: owner-scoped tables and
      queries render only rows tied to `req.session`, including direct typed reads.
  - SPEC refs: 10.1 owner annotations, 10.2 queries, 6.5 sessions.
  - Assertions: two sessions see distinct rows; route search args and `/_q` reads cannot fetch
    another owner's data.
  - Evidence 2026-06-17: `tests/integration/specs/unscoped-owner-fixture.spec.ts` proves anonymous
    redirect, same-owner route/read success, cross-owner route denial, and direct `/_q` returning
    `invoice:null` instead of another owner's row. Prove ran green in the 23-test Chromium batch above.

- [x] `touch-graph-runtime-crosscheck` / `touch-graph-runtime-crosscheck.spec.ts`: executed writes'
      observed domains are within the static touch set or explicitly KV406-annotated.
  - SPEC refs: 11.1 touch extraction, 11.2 runtime verification.
  - Assertions: positive fixture passes; smuggled raw SQL write fails loudly in the harness.
  - Evidence 2026-06-17: `tests/integration/specs/touch-graph-runtime-crosscheck.spec.ts` proves a
    declared write path with empty verification diagnostics and a smuggled raw write failing with
    KV402/audit evidence. Prove ran green in the 23-test Chromium batch above.

- [x] `query-readset-runtime-crosscheck` / `query-readset-runtime-crosscheck.spec.ts`: observed SELECT
      and JOIN tables match query loader read sets at runtime.
  - SPEC refs: 10.2 queries, 11.2 runtime verification.
  - Assertions: raw SQL, aliases, joins, and CTE-like reads cannot bypass read-set verification.
  - Evidence 2026-06-17: `tests/integration/specs/query-readset-runtime-crosscheck.spec.ts` proves a
    declared read path with empty diagnostics and an undeclared read failing with KV407/audit evidence.
    Prove ran green in the 23-test Chromium batch above.

- [x] `opaque-projection-shape-drift` / `opaque-projection-shape-drift.spec.ts`: opaque `sql<T>` or
      raw projection claims are runtime-verified against observed result shapes.
  - SPEC refs: 10.2 KV410, 11.2 runtime shape verification.
  - Assertions: matching shape renders; drift reports KV410 without rendering undefined bindings or
    leaking internals.
  - Evidence 2026-06-17: `tests/integration/specs/opaque-projection-schema.spec.ts` proves matching
    opaque projection rendering and drift returning exactly `{"code":"KV410","payload":{}}` with HTTP 500. Prove ran green in the 23-test Chromium batch above.

- [x] `exempt-table-read-runtime-fails` / `exempt-table-read-runtime-fails.spec.ts`: reads from an
      exempt table fail even when smuggled through runtime-only raw SQL.
  - SPEC refs: 10.1 KV411, 11.2 runtime verification.
  - Assertions: write-side exemption does not permit query reads; the failure is observable through
    the integration harness.
  - Evidence 2026-06-17: `tests/integration/specs/exempt-table-read-fails.spec.ts` proves direct
    `/_q/audit-read` returns HTTP 500 containing KV411 and `audit_log`. Prove ran green in the
    23-test Chromium batch above.

## CSS, assets, and streaming

- [x] `fragment-css-asset-contract` / `fragment-css-asset-contract.spec.ts`: classes used only in
      mutation fragments or deferred fragments are present through the declared Kovo stylesheet
      metadata contract.
  - SPEC refs: 13.1 CSS, 9.1 fragments, 13.3 streaming details.
  - Assertions: late-rendered content has expected computed style; stylesheet assets are included
    once.
  - Evidence 2026-06-17: `SPEC.md` §13.1 is StyleX-first and defines the framework stylesheet
    contract as page/fragment/deferred stylesheet metadata, not Tailwind source/safelist behavior.
    `plans/claude-stylex.md` records that Tailwind was replaced and historical fragment safelist
    coverage was retired. `tests/integration/specs/fragment-style-metadata.spec.ts` proves a
    mutation fragment for a component absent from the initial page carries one `/assets/late-card.css`
    hint, renders with the expected computed `background-color`, and dedupes the stylesheet link.
    `tests/integration/specs/deferred-fragment-styles.spec.ts` proves the same contract for deferred
    fragment streams with `/assets/deferred-review.css`. Prove ran green in the focused loader/CSS
    command above (5 Playwright tests passed).

- [x] `scoped-component-css-donut` / `scoped-component-css-donut.spec.ts`: co-located component CSS is
      scoped to the derived host leaf, excludes nested islands, and emits fallback selectors for
      older engines.
  - SPEC refs: 13.1 CSS, 4.2 rendered output.
  - Assertions: host styles apply; nested island is not accidentally styled; fallback output remains
    semantically equivalent.
  - Evidence 2026-06-17: `tests/integration/specs/scoped-component-css.spec.ts` proves host CSS
    application, nested copy excluded from the scoped color, one stylesheet link, and emitted
    `@scope ([kovo-c="scoped-panel"]) to (:scope [kovo-c])`. Prove ran green in the 23-test Chromium
    batch above.

- [x] `fragment-style-metadata-late-component` / `fragment-style-metadata-late-component.spec.ts`: a
      mutation fragment that introduces a component not present at initial load can request the
      required styles by registry metadata.
  - SPEC refs: 13.1 CSS, 9.1 fragments.
  - Assertions: late component renders styled; style hints are deduped and do not depend on full-page
    reload.
  - Evidence 2026-06-17: `tests/integration/specs/fragment-style-metadata.spec.ts` proves no initial
    `late-card.css`, mutation response includes one stylesheet hint, late card is styled, and the link
    is deduped after morph. Prove ran green in the 23-test Chromium batch above.

- [x] `defer-query-json-ordering` / `defer-query-json-ordering.spec.ts`: deferred fragments receive
      query JSON before or with the consumers that need it, including HTTP/1.1 fallback behavior.
  - SPEC refs: 8 out-of-order streaming, 13.3 streaming details.
  - Assertions: fallback appears first; streamed content can bind query data without a transient
    undefined state.
  - Evidence 2026-06-17: `packages/server/src/deferred-stream.test.ts` tests query JSON before
    fragments, chunk priority ordering, append mode, and late stylesheets; `tests/integration/specs/kovo-defer-initial-stream.spec.ts`
    proves the browser sees fallback first and final bound query data. Prove ran green in the
    19-file vitest command and the 23-test Chromium batch above.

- [x] `defer-initial-browser-consume` / `defer-initial-browser-consume.spec.ts`: the browser loader
      consumes initial document stream boundaries and morphs deferred content in place.
  - SPEC refs: 8 out-of-order streaming, 9.1 fragment vocabulary, 13.3 streaming details.
  - Assertions: fallback is visible before the deferred chunk; final content replaces or appends via
    the same fragment protocol used by mutations.
  - Evidence 2026-06-17: `tests/integration/specs/kovo-defer-initial-stream.spec.ts` proves pending
    `<kovo-defer>` fallback, final in-place replacement, bound `reviews.count`, removal of wire
    markers/elements, and semantic snapshot of the streamed component. Prove ran green in the
    23-test Chromium batch above.

## Diagnostics and public observability

- [x] `diagnostic-warning-observable-channel` / `diagnostic-warning-observable-channel.spec.ts`:
      warn/lint/notice diagnostics are observable through the public non-blocking channel while the
      page still serves.
  - SPEC refs: 11.3 diagnostic severity surface.
  - Assertions: dev serving is not blocked; diagnostic code, severity, message, help, and position
    are observable without relying on private ledgers.
  - Evidence 2026-06-17: `tests/integration/specs/diagnostic-warning-nonblocking.spec.ts` proves
    non-error KV210 does not block serving and remains observable through public dev diagnostic lookup
    by module href and file. Prove ran green in the 23-test Chromium batch above.

- [x] `diagnostic-schema-all-surfaces` / `diagnostic-schema-all-surfaces.spec.ts`: compiler
      diagnostics preserve structured teaching fields through Vite, CLI, MCP/check JSON, and
      integration dev documents.
  - SPEC refs: 5.2 teaching errors, 11.3 diagnostics.
  - Assertions: problem statement, would-have-lowered form when applicable, blocked reason, fix menu,
    SPEC citation, severity, source position, and dynamic context survive each public surface.
  - Evidence 2026-06-17: `packages/compiler/src/conformance-compat.test.ts` snapshots structured
    teaching diagnostics for KV201/KV230/KV235/KV311 including would-lower text, blocked reason, fixes,
    SPEC citations, severity, and source positions; `tests/integration/specs/diagnostic-dev-document.spec.ts`
    proves the Vite dev document preserves code, message, location, and source frame. Prove ran green
    in the 23-test Chromium batch above and via
    `pnpm exec vitest run packages/compiler/src/conformance-compat.test.ts` (1 passed).

- [x] `browser-fixture-page-composition` / `browser-fixture-page-composition.spec.ts`: integration
      fixtures can exercise page composition paths such as duplicate DOM leaf disambiguation, not
      only per-module fixture compilation.
  - SPEC refs: 4.2 rendered output, 6.1 registries, 11.4 verification surface.
  - Assertions: two registry-distinct components with the same DOM leaf render with stable
    disambiguated `kovo-c` values and update independently.
  - Evidence 2026-06-17: `tests/integration/specs/same-dom-leaf-disambiguation.spec.ts` compiles two
    registry-distinct `Root` components, composes page artifacts, renders them in a browser, verifies
    stable disambiguated `kovo-c` values and distinct scoped CSS, and snapshots the DOM. Prove ran
    green in the 23-test Chromium batch above.

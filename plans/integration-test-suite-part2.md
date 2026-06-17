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

- [ ] `render-equivalence-as-child-drift` / `render-equivalence-as-child-drift.spec.ts`: prove a
      primitive `asChild` lowering that changes the visible tag, text, or authored attributes fails
      the semantic render-equivalence gate.
  - SPEC refs: 5.2 fixpoint and semantic equivalence, 4.6 primitive composition.
  - Assertions: authored TSX semantics are compared against compiled server IR, not post-lowering
    source; generated-only Kovo attributes are ignored only through an explicit allowlist.

- [ ] `render-equivalence-link-drift` / `render-equivalence-link-drift.spec.ts`: prove incorrect
      `Link` / `href()` lowering is caught as visible `href` drift.
  - SPEC refs: 5.2 semantic equivalence, 6.4 typed navigation, 8 MPA spine.
  - Assertions: incorrect generated `href` fails the gate; correct generated plain anchor passes and
    navigates as a real document load.

- [ ] `render-equivalence-binding-drift` / `render-equivalence-binding-drift.spec.ts`: prove inline
      query text binding and mixed text span insertion cannot pass if visible text changes while
      generated `data-bind` attributes look valid.
  - SPEC refs: 4.8 bindings, 4.9 update coverage, 5.2 semantic equivalence.
  - Assertions: visible authored text is part of the comparison; generated binding stamps alone are
    insufficient evidence.

- [ ] `structural-rewrite-composition` / `structural-rewrite-composition.spec.ts`: combine primitive
      attrs/asChild, typed links, static style extraction, state/query derives, mixed text binding,
      platform substitution, handler stamping, and server stamps in one fixture.
  - SPEC refs: 4.3 handlers, 4.6 primitive merge, 4.8 update plan, 5.2 typed post-parse facts.
  - Assertions: output is stable regardless of transform registration order or has a typed
    phase-order invariant; conflicting writers produce diagnostics instead of silent clobbering.

- [ ] `generated-import-fixpoint` / `generated-import-fixpoint.spec.ts`: generated imports for
      escaping, derives, runtime output contexts, and handlers are deduped, sorted, and byte-stable
      across a compile-compile fixpoint.
  - SPEC refs: 5.2 fixpoint invariant, 5.2 one-to-one file mapping.
  - Assertions: emitted IR recompiles without moving imports, duplicating helpers, or changing
    public handler/module references.

- [ ] `update-coverage-unhandled-dom-position` / `update-coverage-unhandled-dom-position.spec.ts`:
      query- or state-dependent DOM positions with no plan/isomorphic/fragment/renderOnce status
      emit KV311 instead of silently rendering stale UI.
  - SPEC refs: 4.9 update coverage, 10.6 exhaustiveness.
  - Assertions: conditionals, mixed text, attributes, and stamped list children are all classified;
    unhandled positions fail with a teaching diagnostic.

## Output-context and security payloads

- [ ] `security-output-text-attrs` / `security-output-text-attrs.spec.ts`: server render and client
      update agree on escaping for text, title, ARIA, and ordinary attributes containing `<`, `>`,
      `&`, quotes, and apostrophes.
  - SPEC refs: 5.2 typed output facts, 6.6 soundness boundary.
  - Assertions: SSR HTML and post-query-update DOM match safe escaped semantics; no raw HTML is
    interpreted from user data.

- [ ] `security-output-url-attrs` / `security-output-url-attrs.spec.ts`: literal and dynamic URL
      attributes accept safe internal routes and explicit external URLs while rejecting unsafe
      schemes.
  - SPEC refs: 5.2 unsafe output context, 6.4 routes and links.
  - Assertions: `javascript:` and equivalent unsafe schemes fail or no-op through the documented
    diagnostic path; client-side dynamic URL updates use the same policy as SSR.

- [ ] `security-output-style-css` / `security-output-style-css.spec.ts`: generated style properties
      and component CSS blocks reject unsafe CSS, including unsafe `url()` payloads.
  - SPEC refs: 5.2 unsafe output context, 13.1 CSS.
  - Assertions: allowed generated properties render; arbitrary dynamic CSS and unsafe CSS URLs
    produce diagnostics rather than emitted executable style.

- [ ] `security-output-stamps-fragments` / `security-output-stamps-fragments.spec.ts`: template stamp
      items and refreshed fragment values cannot inject HTML through list item data.
  - SPEC refs: 4.8 template stamps, 9.1 fragments, 5.2 output contexts.
  - Assertions: malicious row values remain text after initial SSR, mutation fragment refresh, and
    query-only update.

- [ ] `trusted-html-contract` / `trusted-html-contract.spec.ts`: raw HTML sinks reject plain strings
      and accept only the explicit Kovo trusted wrapper or browser TrustedHTML-compatible values.
  - SPEC refs: 5.2 unsafe output context, 11.3 diagnostics.
  - Assertions: statically visible plain strings fail at compile/check time; dynamic plain strings
    fail or safely no-op at runtime; trusted values preserve the intended raw HTML context.

- [ ] `csp-nonce-hash-document` / `csp-nonce-hash-document.spec.ts`: generated inline scripts/styles
      and document assembly carry the selected nonce or hash metadata needed for a realistic CSP.
  - SPEC refs: 9.5 request shell, 13.1 CSS, compiler-quality D4 CSP decision.
  - Assertions: document HTML and/or headers expose stable CSP metadata; inline loader, query
    scripts, and generated styles can run under the emitted policy.

## Wire protocol and request lifecycle edge cases

- [ ] `mutation-idempotency-concurrent` / `mutation-idempotency-concurrent.spec.ts`: simultaneous
      duplicate enhanced mutation submissions with the same `Kovo-Idem` execute the write once and
      replay the stored response.
  - SPEC refs: 9.1 enhanced mutation round-trip, 10.3 mutation lifecycle.
  - Assertions: race two POSTs before the first commits; database changes once; responses share the
    same stable mutation vocabulary.

- [ ] `mutation-handler-failure-rollback` / `mutation-handler-failure-rollback.spec.ts`: an
      unexpected mutation handler failure before commit rolls back writes and returns a sanitized
      error response.
  - SPEC refs: 9.2 errors, 10.3 transactions.
  - Assertions: no partial DB write is committed; enhanced and no-JS paths do not leak stack traces
    or internal diagnostic detail.

- [ ] `mutation-targets-malicious` / `mutation-targets-malicious.spec.ts`: malformed, duplicated,
      unknown, cross-query, or unauthorized `Kovo-Targets` headers cannot refresh the wrong fragment
      or leak protected data.
  - SPEC refs: 9.1 live DOM targets, 6.5 guards, 9.2 errors.
  - Assertions: server accepts only valid target/query relationships for the request; bad target
    entries are ignored or fail safely without internal leakage.

- [ ] `deploy-skew-mutation-form-shape` / `deploy-skew-mutation-form-shape.spec.ts`: an old document
      posting a stale form shape receives schema validation, not undefined handler behavior.
  - SPEC refs: 6.6 deploy skew, 9.2 validation errors.
  - Assertions: stale or missing fields return HTTP 422 with field-scoped errors; guards/writes do
    not run after failed schema validation.

- [ ] `query-read-guard-validation-order` / `query-read-guard-validation-order.spec.ts`: direct
      `/_q` reads prove the intended order between search-arg parsing and query guards.
  - SPEC refs: 6.5 guards, 9.4 typed reads, 10.2 queries.
  - Assertions: malformed args and unauthorized sessions produce the specified status/error without
    leaking whether protected data exists.

- [ ] `query-read-invalid-args-safe-error` / `query-read-invalid-args-safe-error.spec.ts`: malformed
      typed-read search params return a safe validation response instead of HTTP 500.
  - SPEC refs: 9.4 typed reads, 9.2 validation errors, 10.2 query args.
  - Assertions: response is HTTP 422 or the SPEC-defined safe validation status; body has stable
    error code/payload and no stack/internal detail.

## Browser, navigation, and loader parity

- [ ] `browser-engine-degradation-matrix` / `browser-engine-degradation-matrix.spec.ts`: the
      integration suite runs representative L0/L1/L2 cases in Chromium, Firefox, and WebKit.
  - SPEC refs: 8 degradation contract, 11.4 browser suite.
  - Assertions: Firefox/WebKit get normal navigations and normal forms; Chromium-only platform
    enhancements degrade without blank screens or broken submit/navigation behavior.

- [ ] `speculation-rules-opt-in` / `speculation-rules-opt-in.spec.ts`: speculation rules are emitted
      only for routes that explicitly opt in and are absent by default.
  - SPEC refs: 8 Speculation Rules, 9.5 request shell.
  - Assertions: default page has no `type="speculationrules"` script; opted-in routes emit one
    correct script without duplicates.

- [ ] `view-transition-route-pairs` / `view-transition-route-pairs.spec.ts`: matching route templates
      emit stable `view-transition-name` values, while duplicate static names fail.
  - SPEC refs: 8 View Transitions, 11.3 KV239.
  - Assertions: paired routes share intentional names; duplicate static names produce KV239; dynamic
    names have documented uniqueness scope.

- [ ] `bfcache-pending-mutation-teardown` / `bfcache-pending-mutation-teardown.spec.ts`: pending
      enhanced mutations use `keepalive` during navigation, and optimistic logs do not survive a
      document teardown.
  - SPEC refs: 8 bfcache hygiene, 10.4 optimistic concurrency.
  - Assertions: navigation does not promote stale optimistic state; returning via browser history
    reconciles from server truth.

- [ ] `inline-loader-vs-installed-loader-parity` / `inline-loader-vs-installed-loader-parity.spec.ts`:
      document which features are absent from the inline fixture loader and prove production loader
      paths for refetch, BroadcastChannel, and island abort scopes.
  - SPEC refs: 4.4 loader, 4.7 lifecycle, 9.3 liveness.
  - Assertions: the harness either runs the full loader for these cases or marks inline-only
    limitations explicitly in test output.

- [ ] `vite-page-method-parity` / `vite-page-method-parity.spec.ts`: the Vite integration server
      returns the same page-path 405 behavior as the core app shell.
  - SPEC refs: 9.5 request shell.
  - Assertions: `POST` to a page route is 405 in the browser fixture server, not a Vite 404
    fallthrough.

## Data-plane verification and authorization

- [ ] `owner-scoped-query-isolation` / `owner-scoped-query-isolation.spec.ts`: owner-scoped tables and
      queries render only rows tied to `req.session`, including direct typed reads.
  - SPEC refs: 10.1 owner annotations, 10.2 queries, 6.5 sessions.
  - Assertions: two sessions see distinct rows; route search args and `/_q` reads cannot fetch
    another owner's data.

- [ ] `touch-graph-runtime-crosscheck` / `touch-graph-runtime-crosscheck.spec.ts`: executed writes'
      observed domains are within the static touch set or explicitly KV406-annotated.
  - SPEC refs: 11.1 touch extraction, 11.2 runtime verification.
  - Assertions: positive fixture passes; smuggled raw SQL write fails loudly in the harness.

- [ ] `query-readset-runtime-crosscheck` / `query-readset-runtime-crosscheck.spec.ts`: observed SELECT
      and JOIN tables match query loader read sets at runtime.
  - SPEC refs: 10.2 queries, 11.2 runtime verification.
  - Assertions: raw SQL, aliases, joins, and CTE-like reads cannot bypass read-set verification.

- [ ] `opaque-projection-shape-drift` / `opaque-projection-shape-drift.spec.ts`: opaque `sql<T>` or
      raw projection claims are runtime-verified against observed result shapes.
  - SPEC refs: 10.2 KV410, 11.2 runtime shape verification.
  - Assertions: matching shape renders; drift reports KV410 without rendering undefined bindings or
    leaking internals.

- [ ] `exempt-table-read-runtime-fails` / `exempt-table-read-runtime-fails.spec.ts`: reads from an
      exempt table fail even when smuggled through runtime-only raw SQL.
  - SPEC refs: 10.1 KV411, 11.2 runtime verification.
  - Assertions: write-side exemption does not permit query reads; the failure is observable through
    the integration harness.

## CSS, assets, and streaming

- [ ] `tailwind-fragment-css-safelist` / `tailwind-fragment-css-safelist.spec.ts`: classes used only
      in mutation fragments or deferred fragments are present in built CSS through the declared
      Tailwind source/safelist contract.
  - SPEC refs: 13.1 CSS, 9.1 fragments, 13.3 streaming details.
  - Assertions: late-rendered content has expected computed style; stylesheet assets are included
    once.

- [ ] `scoped-component-css-donut` / `scoped-component-css-donut.spec.ts`: co-located component CSS is
      scoped to the derived host leaf, excludes nested islands, and emits fallback selectors for
      older engines.
  - SPEC refs: 13.1 CSS, 4.2 rendered output.
  - Assertions: host styles apply; nested island is not accidentally styled; fallback output remains
    semantically equivalent.

- [ ] `fragment-style-metadata-late-component` / `fragment-style-metadata-late-component.spec.ts`: a
      mutation fragment that introduces a component not present at initial load can request the
      required styles by registry metadata.
  - SPEC refs: 13.1 CSS, 9.1 fragments.
  - Assertions: late component renders styled; style hints are deduped and do not depend on full-page
    reload.

- [ ] `defer-query-json-ordering` / `defer-query-json-ordering.spec.ts`: deferred fragments receive
      query JSON before or with the consumers that need it, including HTTP/1.1 fallback behavior.
  - SPEC refs: 8 out-of-order streaming, 13.3 streaming details.
  - Assertions: fallback appears first; streamed content can bind query data without a transient
    undefined state.

- [ ] `defer-initial-browser-consume` / `defer-initial-browser-consume.spec.ts`: the browser loader
      consumes initial document stream boundaries and morphs deferred content in place.
  - SPEC refs: 8 out-of-order streaming, 9.1 fragment vocabulary, 13.3 streaming details.
  - Assertions: fallback is visible before the deferred chunk; final content replaces or appends via
    the same fragment protocol used by mutations.

## Diagnostics and public observability

- [ ] `diagnostic-warning-observable-channel` / `diagnostic-warning-observable-channel.spec.ts`:
      warn/lint/notice diagnostics are observable through the public non-blocking channel while the
      page still serves.
  - SPEC refs: 11.3 diagnostic severity surface.
  - Assertions: dev serving is not blocked; diagnostic code, severity, message, help, and position
    are observable without relying on private ledgers.

- [ ] `diagnostic-schema-all-surfaces` / `diagnostic-schema-all-surfaces.spec.ts`: compiler
      diagnostics preserve structured teaching fields through Vite, CLI, MCP/check JSON, and
      integration dev documents.
  - SPEC refs: 5.2 teaching errors, 11.3 diagnostics.
  - Assertions: problem statement, would-have-lowered form when applicable, blocked reason, fix menu,
    SPEC citation, severity, source position, and dynamic context survive each public surface.

- [ ] `browser-fixture-page-composition` / `browser-fixture-page-composition.spec.ts`: integration
      fixtures can exercise page composition paths such as duplicate DOM leaf disambiguation, not
      only per-module fixture compilation.
  - SPEC refs: 4.2 rendered output, 6.1 registries, 11.4 verification surface.
  - Assertions: two registry-distinct components with the same DOM leaf render with stable
    disambiguated `kovo-c` values and update independently.

# Better JavaScript Loader

Created 2026-06-23. Behavioral source of truth is `SPEC.md`, especially the
loader contract in section 4.4: an 8KB gzip-capped always-loaded bootstrap owns
event delegation, ref resolution, enhanced forms, query hydration, update plans,
refetch, and morph application.

## Current Baseline

- [x] **Inline loader generation path identified.**
  - Evidence: [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:1)
    builds [packages/browser/src/inline-loader.ts](/Users/mini/kovo/packages/browser/src/inline-loader.ts:1)
    from a readable inline bootstrap template plus extracted helper closures.
    `pnpm --filter @kovojs/browser run check:inline-loader` is already wired by
    [packages/browser/package.json](/Users/mini/kovo/packages/browser/package.json:31).
- [x] **Modular loader composition path identified.**
  - Evidence: [packages/browser/src/loader.ts](/Users/mini/kovo/packages/browser/src/loader.ts:92)
    composes lifecycle, query runtime, mutation submit/apply, broadcast, optimism
    cleanup, and error policy through typed runtime modules.
- [x] **Existing shared source-of-truth slice identified.**
  - Evidence: [packages/browser/src/wire-response-scanner.ts](/Users/mini/kovo/packages/browser/src/wire-response-scanner.ts:41)
    is shared by the inline and modular response parsers; [packages/browser/src/inline-response-apply.ts](/Users/mini/kovo/packages/browser/src/inline-response-apply.ts:11)
    shares the fragment apply helper closure. Parity is pinned by
    [packages/browser/src/inline-loader-parser-parity.test.ts](/Users/mini/kovo/packages/browser/src/inline-loader-parser-parity.test.ts:1)
    and [packages/browser/src/inline-loader-artifact-minifier.test.ts](/Users/mini/kovo/packages/browser/src/inline-loader-artifact-minifier.test.ts:1).
- [x] **Document-shell resend cost measured on the deployed Stack Overflow demo.**
  - Evidence: `curl -sS -D /tmp/kovo-so-home.headers https://kovo-stackoverflow-sfqtuclaza-uc.a.run.app/ -o /tmp/kovo-so-home.html`
    returned a 146,891-byte HTML document with one loader script. Node measurement
    over that response found the inline loader body is 22,751 bytes raw and
    7,576 bytes gzip; the full HTML response is 20,622 bytes gzip. Follow-up
    route fetches on 2026-06-23 returned 503/403, so this is one successful
    document sample plus source-code confirmation, not a complete deployed route
    crawl.
- [x] **Server cause of repeated loader bytes identified.**
  - Evidence: [packages/server/src/document-core.ts](/Users/mini/kovo/packages/server/src/document-core.ts:403)
    always emits `<script data-kovo-csp-hash=...>${kovoLoaderSource}</script>` in
    document assembly, and inline enhanced navigation fetches full HTML documents
    with `Accept: text/html` in [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:368).
- [x] **First no-loader enhanced-navigation variant landed.**
  - Evidence: [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:427)
    sends `Accept: text/vnd.kovo.document+html, text/html`; [packages/server/src/app-document.ts](/Users/mini/kovo/packages/server/src/app-document.ts:116)
    detects that request and [packages/server/src/document-core.ts](/Users/mini/kovo/packages/server/src/document-core.ts:221)
    omits the inline loader while preserving a parseable HTML document. Verified
    by `pnpm --filter @kovojs/browser run check:inline-loader`,
    `pnpm exec vitest run packages/server/src/app.test.ts packages/server/src/document.test.ts packages/server/src/static-export-handler-doc.test.ts packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader-navigation.test.ts`,
    and `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts`.
- [x] **Delegated event list now has one modular source of truth.**
  - Evidence: [packages/browser/src/loader.ts](/Users/mini/kovo/packages/browser/src/loader.ts:73)
    exports `defaultDelegatedEvents`; [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:48)
    reads that literal declaration for inline generation and fails closed if it
    stops being a string-literal array. Verified by
    `pnpm --filter @kovojs/browser run check:inline-loader` and
    `pnpm exec vitest run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader.test.ts packages/browser/src/index.test.ts packages/browser/src/loader.test.ts`.
- [x] **Fragment-target CSS escaping now has one modular source of truth.**
  - Evidence: [packages/browser/src/fragment-targets.ts](/Users/mini/kovo/packages/browser/src/fragment-targets.ts:32)
    owns `escapeCssString`; [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:27)
    extracts that helper into the inline bootstrap and aliases it to the compact
    inline name. Verified by `pnpm --filter @kovojs/browser run check:inline-loader`
    and `pnpm exec vitest run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader-fragment-target.test.ts packages/browser/src/mutation-response-dom.test.ts packages/browser/src/fragment-targets.test.ts`.

## Problems

- [ ] **Inline orchestration is not generated from the modular runtime.**
  - The inline loader is generated, but its readable source is a monolithic
    template. Event dispatch, context creation, state binding, enhanced form
    submit headers, streaming response application, navigation diffing, and
    trigger scanning have compact inline equivalents beside the modular runtime.
  - Evidence needed: a drift matrix that maps every inline responsibility to
    either a shared runtime source file, a generated tiny-contract helper, or an
    explicitly inline-only reason tied to the gzip budget.
- [x] **Enhanced navigation no longer pays the inline loader cost on successful document fetches.**
  - The previous navigation path fetched canonical documents, parsed them,
    swapped head/body/segments, and therefore received the loader script again
    even though the existing page had already installed it.
  - Fixed first slice: enhanced navigation now negotiates a no-loader document
    variant. Evidence: `packages/server/src/app.test.ts` asserts ordinary route
    requests still contain `installInlineKovoLoader`, while
    `Accept: text/vnd.kovo.document+html, text/html` responses do not and carry
    `Vary: Accept`; browser navigation tests assert the inline loader sends that
    accept header and still applies the target document.
- [ ] **Loader transport has no reusable document-part protocol.**
  - Mutation responses have a Kovo-specific fragment/query wire. Navigation
    responses currently rely on full documents because there is no negotiated
    shell-part response that can preserve the MPA fallback while omitting stable
    head bytes such as the loader.
  - Evidence needed: server/browser tests proving native `Accept: text/html`
    still returns complete documents, while enhanced navigation can request and
    apply a partial document shell safely.

## Implementation Plan

- [x] **Phase 1: lock down the responsibility map before refactoring.**
  - Build a table covering inline and modular ownership for delegated events,
    handler context/state commit, `data-p-*` coercion, post-commit callbacks,
    `data-bind` and `data-bind-prop`, enhanced submit headers, target lookup,
    mutation response parsing/apply, stream text, execution triggers, navigation,
    bfcache/popstate, CSP, and error handling.
  - Evidence: the responsibility map below records current ownership, completed
    convergence, and remaining gaps. Focused tests named in later phases pin the
    completed shared helpers and intentionally compact inline-only paths.

## Responsibility Map

| Responsibility | Modular source | Inline source | Status |
| --- | --- | --- | --- |
| Delegated event list | `packages/browser/src/loader.ts` `defaultDelegatedEvents` | Generated by `inline-loader-build.ts` from `loader.ts` | Shared source of truth, verified by `inline-loader-build.test.ts` |
| Event listener install/dispose | `loader-lifecycle.ts` | Compact inline listener loop, no disposer | Inline-only until the bootstrap gains a teardown story |
| `pointerenter`/`pointerleave` synthesis | `loader-lifecycle.ts` | Compact inline `pointerover`/`pointerout` bridge | Duplicated, behavior pinned by loader and inline tests |
| Handler ref parsing/import | `handlers.ts` | Compact inline dispatch loop | Duplicated, candidate for extraction after event/context helpers |
| Handler context state host | `handler-context.ts` | Compact inline `rh`/`rs`/state commit | Duplicated, candidate for extraction |
| `data-p-*` coercion | `handler-context.ts` | Compact inline `rp` plus attribute scan | Duplicated, candidate for extraction |
| Post-commit callbacks | `handlers.ts` | Compact inline `__kovo_postCommitSchedule` handling | Duplicated, behavior pinned by delegated handler tests |
| `data-bind` / derives | `query-bindings.ts` | Compact inline state binding helpers | Duplicated, intentionally compact until update-plan helper extraction exists |
| `data-bind-prop` allowlist | `bind-prop.ts` / `query-bindings.ts` | Compact inline `pa` map | Duplicated, candidate for extraction |
| Fragment target CSS escaping | `fragment-targets.ts` `escapeCssString` | Generated by `inline-loader-build.ts` from `fragment-targets.ts` | Shared source of truth, verified by `inline-loader-build.test.ts` |
| Fragment target lookup precedence | `fragment-targets.ts` | Compact inline `ft` using shared escape helper | Partially shared; lookup body remains duplicated |
| `Kovo-Targets` collection | `mutation-targets.ts` | Compact inline `rt`/`rlt` | Duplicated, candidate for extraction after header-safe helpers are extractable |
| Enhanced submit headers | `mutation-fetch.ts` / `mutation-submit.ts` | Compact inline `sef` | Duplicated, intentionally compact for bootstrap size |
| Mutation response scanner | `wire-response-scanner.ts` | Generated helper closure | Shared source of truth, verified by parser parity tests |
| Fragment apply helper | `response-fragment-apply.ts` / `inline-response-apply.ts` | Generated helper closure | Shared source of truth, verified by response-apply parity tests |
| Stream text apply | `stream-text.ts` | Compact inline stream text buffer | Duplicated, candidate after response-apply extraction broadens |
| Execution triggers | `loader-lifecycle.ts` | Compact inline `tr`/`to` | Duplicated, candidate for extraction |
| Enhanced navigation | Inline-only today | Compact inline `an`/`inav` | Needs Phase 4 modular source helper |
| Navigation document negotiation | `app-document.ts` / `document-core.ts` | Inline `Accept: text/vnd.kovo.document+html, text/html` | Implemented first no-loader variant |
| bfcache/popstate scroll restore | Inline-only today | Compact inline `sc`/`popstate` | Needs Phase 4 modular source helper |
| CSP for loader bytes | `document-core.ts` | N/A | Normal documents include loader hash; enhanced no-loader variant omits loader bytes and varies by `Accept` |
| Error handling | `error-policy.ts` | Mostly native fallback / silent best-effort | Duplicated; richer inline errors would cost bytes and need explicit budget review |

- [ ] **Phase 2: make inline helper extraction generic enough for more modular code.**
  - Extend the existing closure extractor in
    [packages/browser/src/inline-loader-build.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.ts:735)
    so it can extract small browser-runtime helpers from modular files beyond
    `wire-response-scanner.ts` and `inline-response-apply.ts`.
  - Keep extraction fail-closed: no unsupported top-level state, import leakage,
    ambient side effects, template interpolation surprises, or public app-facing
    API exposure.
  - Evidence needed: unit tests showing extracted helpers preserve dependency
    order, reject unsupported constructs, and keep the generated loader under
    `inlineKovoLoaderGzipByteBudget`.
- [ ] **Phase 3: converge low-risk duplicated helpers first.**
  - Candidate helpers: delegated event list, element param parsing, state host
    read/write, fragment target lookup, target/dependency header collection,
    native indeterminate checkbox initialization, and execution trigger once
    marking.
  - Evidence: delegated event list and fragment-target CSS escaping converged first; the inline generator now
    reads [packages/browser/src/loader.ts](/Users/mini/kovo/packages/browser/src/loader.ts:73)
    plus [packages/browser/src/fragment-targets.ts](/Users/mini/kovo/packages/browser/src/fragment-targets.ts:32),
    and [packages/browser/src/inline-loader-build.test.ts](/Users/mini/kovo/packages/browser/src/inline-loader-build.test.ts:62)
    pins parity. Remaining evidence needed: converge additional helpers from the
    candidate list and prove each with inline artifact parity tests.
- [ ] **Phase 4: split enhanced navigation into a modular source helper with an inline build target.**
  - Move navigation eligibility, fetch options, build-token validation,
    segment-key comparison, scroll/focus restoration, and fallback rules into a
    modular source file whose tiny browser-closure can be embedded in the inline
    loader.
  - Evidence needed: existing inline navigation tests continue to pass against
    both `installInlineKovoLoader` and `createInlineKovoLoaderSource`; add tests
    for build-token skew, cross-origin, hash-only links, popstate, duplicate id
    fallback, and trigger rescan after partial morph.
- [ ] **Phase 5: add an enhanced-navigation document-part response.**
  - Let the inline loader send a Kovo-specific navigation accept header, for
    example `Accept: text/vnd.kovo.document+html, text/html`, while preserving
    full `text/html` for native navigation, crawlers, no-JS, and unsupported
    clients.
  - Server response should include only the dynamic shell parts required by the
    current navigation algorithm: build token, head delta or replacement head
    without the stable loader script, html/body attributes, and body/navigation
    segment markup.
  - Evidence needed: server route tests proving full document fallback remains
    byte-identical for ordinary HTML requests, and enhanced navigation tests
    proving the partial response updates title/meta/styles/speculation rules,
    html/body attributes, segment content, scroll/focus, and execution triggers.
- [ ] **Phase 6: avoid resending stable loader bytes.**
  - On enhanced navigation, the server must omit the already-installed loader
    script from the negotiated document-part response. The client must not
    re-execute loader code when applying a navigation response.
  - Decide whether to keep the first page inline script permanently or graduate
    to an external cacheable loader asset with a tiny inline bootstrap. The
    external option likely improves repeat visits and cross-route transfer, but
    it changes CSP and deployment semantics and must still satisfy SPEC.md
    section 4.4's always-loaded budget.
  - Evidence: the negotiated no-loader document variant is implemented and
    verified by focused server, inline-loader, and browser navigation tests named
    above. Remaining evidence needed: demo/network measurement against Stack
    Overflow, a stricter CSP assertion for the no-loader variant, and a recorded
    decision on whether to keep the first load inline or move to a cacheable
    external loader asset.
- [ ] **Phase 7: keep the modular runtime as the authoritative behavior.**
  - After helper convergence, add a CI gate that fails when an inline-owned
    behavior changes without either updating the modular source-of-truth helper
    or recording an explicit inline-only exception in the responsibility map.
  - Evidence needed: a drift test that mutates or fixtures a modular helper and
    proves `check:inline-loader` fails until the generated inline artifact is
    refreshed.

## Verification Gates

- [ ] **Focused browser package gate.**
  - Evidence needed: `pnpm exec vitest run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-parser-parity.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader-navigation.test.ts packages/browser/src/loader.test.ts packages/browser/src/loader-lifecycle.test.ts packages/browser/src/mutation-submit.test.ts`.
- [ ] **Browser DOM gate.**
  - Evidence needed: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts packages/browser/src/inline-loader-response-apply.browser.test.ts packages/browser/src/mutation-response-dom.browser.test.ts`.
- [ ] **Server document/static-export gate.**
  - Evidence needed: `pnpm exec vitest run packages/server/src/document.test.ts packages/server/src/static-export-handler-doc.test.ts packages/server/src/vite-static-export-options.test.ts`.
- [ ] **Inline loader build gate.**
  - Evidence needed: `pnpm --filter @kovojs/browser run check:inline-loader`.
- [ ] **Demo measurement gate.**
  - Evidence needed: a script or documented command against the Stack Overflow
    demo showing initial document loader bytes and route-to-route enhanced
    navigation bytes before and after the document-part response.

## Constraints

- [ ] **No client router.** Enhanced navigation remains real-anchor,
      server-document navigation per SPEC.md section 8; uncertainty falls back to
      the browser's full GET.
- [ ] **No public app-authored import of internal runtime helpers.** Any helper
      used for inline generation stays framework-owned and does not become an app
      authoring surface.
- [ ] **No weakening CSP.** Inline hashes or external script policy must remain
      deterministic and compatible with existing document CSP assembly.
- [ ] **No stale build apply.** Partial navigation responses must validate the
      same render-plan token as current full-document navigation and fall back to
      full navigation on skew.
- [ ] **No gzip budget regression.** The installed always-loaded bootstrap stays
      at or below `inlineKovoLoaderGzipByteBudget` unless SPEC.md section 4.4 is
      intentionally changed first.

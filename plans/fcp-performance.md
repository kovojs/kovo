# FCP Performance

Active ledger for reducing first contentful paint on the hosted Stack Overflow demo route
`/questions/q3`.

## Current Measurements

- [ ] Re-run a fresh local/deployed measurement before implementing changes.
  - Current baseline from 2026-06-22: Lighthouse mobile reported FCP/LCP about 1.6s, TBT 0ms.
  - Current baseline from `curl -H 'Accept-Encoding: br,gzip'`: HTML and CSS are served without
    `Content-Encoding`; raw HTML was about 75.5 KB and raw CSS about 39.3 KB.
  - Current baseline from local compression estimate: HTML would be about 14 KB Brotli; CSS would
    be about 7.3 KB Brotli.

## Ranked Work

- [ ] **1. Enable text compression by default, with explicit opt-out.**
  - Framework scope: `@kovojs/server` Node adapter should compress eligible text responses by
    default in `toNodeHandler()` / `writeWebResponseToNode()`, with an explicit opt-out option
    such as `compression: false`.
  - Demo scope: `scripts/demo-session/serve.mjs` should serve built `/assets/*` text assets with
    Brotli/gzip when the request advertises support. Prefer precompressed sidecars when available;
    otherwise use a bounded streaming fallback or add build-time sidecar generation for hosted demo
    assets.
  - Required semantics: respect `Accept-Encoding` quality values, prefer Brotli over gzip when
    acceptable, set `Content-Encoding`, append `Vary: Accept-Encoding`, remove stale
    `Content-Length`, skip `HEAD`, `204`, `304`, existing `Content-Encoding`,
    `Cache-Control: no-transform`, and non-text/binary content.
  - Verification target: adapter tests prove default compression, opt-out, no-transform,
    already-encoded, HEAD/no-body, and Brotli/gzip negotiation; demo verification proves HTML and
    `/assets/*.css` return `Content-Encoding: br` for `Accept-Encoding: br,gzip`.

- [ ] **2. Move the full stylesheet off the first-paint critical path.**
  - Current issue: the document inlines critical CSS and also emits a normal render-blocking
    `<link rel="stylesheet" href="/assets/styles...css">`; Lighthouse estimated about 260-300 ms
    render-blocking cost.
  - Direction: when a stylesheet has `criticalCss`, emit the inline critical block first, then emit
    the full stylesheet as a non-render-blocking preload/deferred stylesheet that the Kovo loader
    promotes after first paint. Keep a blocking stylesheet path for assets without critical CSS.
  - Reliability rule: Kovo should track render-critical CSS automatically from the matched route
    tree, emitted component class names, rule ownership, and referenced CSS variables; do not rely
    on viewport/above-the-fold heuristics as the correctness boundary.
  - Reliability rule: no-JS must remain correct via a `<noscript><link rel="stylesheet" ...>`
    fallback, and CSP should avoid inline `onload` handlers.
  - Reliability rule: deferred/preloaded/applied stylesheet identities must dedupe by `href` during
    fragments, mutations, and enhanced navigation so a later response does not insert duplicate
    stylesheet assets.
  - Opt-out: provide an explicit way to force blocking delivery for apps/routes that prefer zero
    FOUC risk over FCP improvement.
  - Verification target: rendered document keeps visible first viewport styled, Lighthouse no
    longer reports the full stylesheet as a render-blocking request, and CSS fallback behavior is
    covered by server/document tests.

- [ ] **3. Split the inline loader into a tiny early stub plus deferred runtime.**
  - Current issue: the inline loader is about 23 KB in the head, and Lighthouse reported about
    21 KB unused during first load.
  - Direction: keep only interaction capture and required first-load setup in the head; defer
    navigation morphing, mutation handling, streaming parsing, bindings, and idle/visible handlers.

- [ ] **4. Reduce route critical CSS and theme-variable payload.**
  - Current issue: the inline critical style block is about 11 KB, dominated by theme variables that
    the Stack Overflow example mostly does not need for the first viewport.
  - Direction: inline only route-visible variables/rules or avoid app-wide theme inlining on this
    example route.

- [ ] **5. Route-split Stack Overflow CSS.**
  - Current issue: `/questions/q3` receives CSS namespaces for unrelated pages such as users,
    profile, tags, tagged, list, and card.
  - Direction: emit route/component CSS chunks so the question detail route initially receives only
    chrome/detail and desktop rail CSS.

- [ ] **6. Defer below-the-fold document content.**
  - Current issue: initial HTML includes the right rail, duplicated hot-question lists, watched
    tags, full answers, and answer composer before first paint.
  - Direction: send header and question content first; stream or defer answers, composer, and rail.

- [ ] **7. Fix the favicon 403.**
  - Current issue: `/favicon.ico` returns 403 and creates an avoidable failed request after load.
  - Direction: add a valid favicon or explicit icon link.

## Latest Verification

- [ ] No implementation verification has been run for this plan yet.

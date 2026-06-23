# FCP Performance

Active ledger for reducing first contentful paint on the hosted Stack Overflow demo route
`/questions/q3`.

## Current Measurements

- [x] Re-run a fresh deployed measurement before continuing implementation.
  - Evidence: `pnpm perf:fcp -- --url https://kovo-stackoverflow-34444524520.us-central1.run.app/questions/q3 --output test-results/fcp-harness/stackoverflow-q3-smoke`
    passed against the hosted route. It recorded uncompressed HTML at 75,518 bytes, uncompressed CSS
    at 39,291 bytes, inline critical CSS at 11,041 bytes, inline loader/script bytes at 22,978,
    one render-blocking stylesheet, mobile FCP at 252 ms, desktop FCP at 212 ms, and no browser
    console/page errors.

## Ranked Work

- [x] **1. Enable text compression by default, with explicit opt-out.**
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
  - Evidence: `pnpm exec vitest --run packages/server/src/node.test.ts scripts/demo-session/serve.test.mjs`
    covers default Brotli/gzip negotiation, opt-out, conservative skip cases, and demo built asset
    Brotli/gzip responses.

- [x] **2. Move the full stylesheet off the first-paint critical path.**
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
  - Evidence: `pnpm exec vitest --run packages/server/src/hints.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/cli/src/index.kovo-build.test.ts examples/commerce/src/app.rendering.test.ts packages/conformance-fixtures/src/server-fixtures.test.ts packages/server/src/node.test.ts`
    passed, covering page hint rendering, document assembly, dev/build parity, commerce fixtures,
    and the dev-only HMR compression opt-out needed by default Node compression.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts`
    passed, covering enhanced-navigation promotion from deferred stylesheet preload to applied
    stylesheet.
  - Evidence: `pnpm exec vitest --run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts`
    and `pnpm --filter @kovojs/browser run check:inline-loader` passed, covering inline loader
    artifact parity and gzip budget after adding stylesheet promotion.

- [x] **3. Split the inline loader into a tiny early stub plus deferred runtime.**
  - Current issue: the inline loader is about 23 KB in the head, and Lighthouse reported about
    21 KB unused during first load.
  - Direction: keep only interaction capture and required first-load setup in the head; defer
    navigation morphing, mutation handling, streaming parsing, bindings, and idle/visible handlers.
  - Loading policy: use a paint-first, interaction-priority schedule. By default, start importing
    the full runtime after first paint, e.g. a double `requestAnimationFrame`. If a Kovo-owned
    interaction occurs before the runtime loads, import the runtime immediately, queue the event,
    and replay it once the runtime is ready.
  - Reliability rule: the tiny bootstrap must never swallow an event it cannot replay. For native
    links/forms or uncertain ownership, let the browser default behavior proceed.
  - Reliability rule: queued events should carry stable target identity and minimal event data
    needed for replay, not arbitrary live `Event` objects whose state may expire.
  - Verification target: tests cover early enhanced link click, enhanced form submit, ordinary
    native link/form fallback, and no early interaction path where runtime import begins only after
    first paint.
  - Evidence: `pnpm exec vitest --run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader.test.ts packages/browser/src/inline-loader-fragment-target.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/app.test.ts packages/server/src/static-export-handler-doc.test.ts`
    passed, covering generated stub/runtime artifact parity, app document bootstrap output,
    versioned runtime module registration/serving, static export runtime emission, and low-level
    full-inline fallback.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-bootstrap.browser.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts`
    passed, covering post-paint runtime import, early enhanced link/form replay, native link
    pass-through, import-failure submit fallback, and existing enhanced navigation behavior.

- [x] **4. Reduce route critical CSS and theme-variable payload.**
  - Current issue: the inline critical style block is about 11 KB, dominated by theme variables that
    the Stack Overflow example mostly does not need for the first viewport.
  - Direction: inline only route-visible variables/rules or avoid app-wide theme inlining on this
    example route.
  - Direction: when critical CSS rules reference `var(--token)`, include only those token
    definitions and recursively referenced variables in the critical block. Keep the full theme in
    the deferred/full stylesheet asset.
  - Reliability rule: do not hardcode theme-variable removal. If Kovo cannot prove the variable
    dependency graph for a stylesheet, prefer broader critical CSS or blocking delivery.
  - Opt-out: expose a way for apps to force full theme critical inlining when raw CSS/runtime-added
    classes need variables before the full stylesheet loads.
  - Verification target: tests prove used variables remain in critical CSS, unused theme variables
    are omitted for analyzable component CSS, nested `var()` references are retained, and fallback
    behavior stays conservative for unanalyzable CSS.
  - Evidence: `pnpm exec vitest --run packages/server/src/hints.test.ts examples/stackoverflow/src/interactive-app.test.ts`
    passed, covering used/nested CSS variable retention, unused theme variable pruning,
    full-theme opt-out, unsafe CSS fallback, authored CSP-hash no-rewrite behavior, and the Stack
    Overflow `/questions/q3` critical CSS budget staying under 2 KB while retaining only the used
    theme variables.

- [ ] **5. Route-split Stack Overflow CSS.**
  - Current issue: `/questions/q3` receives CSS namespaces for unrelated pages such as users,
    profile, tags, tagged, list, and card.
  - Direction: emit route/component CSS chunks so the question detail route initially receives only
    chrome/detail and desktop rail CSS.
  - Direction: keep a small shared/base CSS chunk for reset, shell, and truly shared rules; emit
    route-specific CSS for matched-route component reachability and fragment CSS for markup that can
    arrive after the initial document.
  - Reliability rule: if route-to-style reachability is uncertain, include the rule in a broader
    shared chunk instead of risking unstyled rendered content.
  - Reliability rule: fragment and mutation responses must carry stylesheet hints for any newly
    introduced component CSS not already present in the document.
  - Verification target: `/questions/:id` route CSS excludes users/profile/tags/list-only
    namespaces, includes chrome/detail/rail when rendered, and mutation/fragment responses remain
    styled when they introduce component markup.

- [ ] **6. Defer below-the-fold document content.**
  - Current issue: initial HTML includes the right rail, duplicated hot-question lists, watched
    tags, full answers, and answer composer before first paint.
  - Direction: send header and question content first; stream or defer answers, composer, and rail.
  - Framework direction: add priority-aware region rendering rather than a Stack Overflow-specific
    page split. The minimal priority set is `critical` (default, initial document),
    `after-paint` (stream after shell or fetch after first paint), and `visible` (fetch when near
    viewport).
  - Priority semantics: `critical` regions block the initial shell and contribute render-critical
    CSS/query data; `after-paint` regions get stable placeholders and should arrive soon after the
    first paint; `visible` regions load via viewport observation with an explicit no-JS fallback
    decision.
  - Reliability rule: deferred regions must carry query dependencies, stylesheet hints, live-target
    identity, mutation refresh behavior, and stable placeholder sizing so deferral does not break
    fragment updates or create avoidable layout shifts.
  - Testing target: route/document tests cover all three priorities; streaming tests prove
    `after-paint` fragments arrive after the critical shell and no-JS streaming remains complete;
    browser tests prove `visible` loads when near viewport and does not load eagerly; mutation tests
    prove deferred live targets refresh correctly after submits; CSS tests prove deferred-region
    styles arrive before/with inserted markup.

- [ ] **7. Fix the favicon 403.**
  - Current issue: `/favicon.ico` returns 403 and creates an avoidable failed request after load.
  - Direction: add a valid favicon or explicit icon link.

## Latest Verification

- [x] 2026-06-22 compression slice: `pnpm exec vitest --run packages/server/src/node.test.ts scripts/demo-session/serve.test.mjs`
      passed.
- [x] 2026-06-22 deferred stylesheet slice: `pnpm exec vitest --run packages/server/src/hints.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/cli/src/index.kovo-build.test.ts examples/commerce/src/app.rendering.test.ts packages/conformance-fixtures/src/server-fixtures.test.ts packages/server/src/node.test.ts`
      passed.
- [x] 2026-06-22 deferred stylesheet browser slice: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-navigation.browser.test.ts`
      passed.
- [x] 2026-06-22 inline loader artifact slice: `pnpm exec vitest --run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts`
      and `pnpm --filter @kovojs/browser run check:inline-loader` passed.
- [x] 2026-06-22 FCP harness slice: `pnpm exec vitest --run scripts/fcp-harness.test.mjs`
      and `pnpm perf:fcp -- --url https://kovo-stackoverflow-34444524520.us-central1.run.app/questions/q3 --output test-results/fcp-harness/stackoverflow-q3-smoke`
      passed.
- [x] 2026-06-22 inline runtime split slice: `pnpm exec vitest --run packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader.test.ts packages/browser/src/inline-loader-fragment-target.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/app.test.ts packages/server/src/static-export-handler-doc.test.ts`
      and `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-bootstrap.browser.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts`
      passed.
- [x] 2026-06-23 inline runtime affected-suite: `pnpm --filter @kovojs/browser run check:inline-loader && pnpm exec vitest --run packages/server/src/static-export-client-module-refs.test.ts packages/server/src/static-export-endpoints.test.ts packages/server/src/static-export-manifest.test.ts packages/server/src/static-export-output.test.ts packages/server/src/static-export-output-targets.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/static-export-result.test.ts packages/server/src/static-export-route-guards.test.ts packages/server/src/vite-build.test.ts packages/server/src/vite-build-wiring.test.ts packages/server/src/vite-dev.test.ts packages/server/src/node.test.ts packages/cli/src/index.kovo-export.test.ts packages/cli/src/index.kovo-build.test.ts`
      passed.
- [x] 2026-06-23 lint/type without formatting: `vp check --no-fmt` passed with existing warnings
      for `packages/icons/src/infinity.tsx` and generated `packages/browser/src/inline-loader.ts`
      length.
- [x] 2026-06-23 critical theme pruning slice: `pnpm exec vitest --run packages/server/src/hints.test.ts packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/build.test.ts packages/server/src/vite-dev.test.ts packages/cli/src/index.kovo-build.test.ts examples/stackoverflow/src/interactive-app.test.ts examples/stackoverflow/src/kovo-graph.test.ts site/src/route-kit.test.ts`
      passed.
- [x] 2026-06-23 diff hygiene: `git diff --check` passed.

## Repeatable Perf Harness

- [x] **HTTP byte/header probe.**
  - Command shape:
    `pnpm perf:fcp -- --url "$URL" --no-browser`
  - Capture for: the route document and each critical CSS/JS asset discovered from the document.
  - Pass criteria after compression work: text responses advertise `Content-Encoding: br` when
    Brotli is accepted, include `Vary: Accept-Encoding`, keep correct `Content-Type`, and transfer
    materially fewer bytes than the raw response.
  - Evidence: `pnpm exec vitest --run scripts/fcp-harness.test.mjs` covers parser inventory, and
    `pnpm perf:fcp -- --no-browser --url https://kovo-stackoverflow-34444524520.us-central1.run.app/questions/q3`
    captured route/CSS status, headers, encoded bytes, decoded bytes, TTFB, content type, and
    compression headers.

- [x] **HTML asset inventory.**
  - Command shape: `pnpm perf:fcp -- --url "$URL"` parses the fetched HTML and reports inline
    style/script byte counts, stylesheet links/preloads, modulepreloads, `noscript` fallbacks, body
    byte count, and duplicate asset identities.
  - Pass criteria: inline critical CSS/runtime bytes trend down; full stylesheet is not emitted as
    a render-blocking link when critical CSS is present; deferred/preloaded/applied stylesheet
    identities dedupe by `href`.
  - Evidence: `pnpm exec vitest --run scripts/fcp-harness.test.mjs` covers deferred stylesheet,
    `noscript`, modulepreload, inline byte, render-blocking, and duplicate asset classification.

- [ ] **Lighthouse mobile performance run.**
  - Command shape:
    `pnpm perf:fcp -- --url "$URL" --lighthouse`
  - Record: FCP, LCP, Speed Index, TBT, render-blocking requests, unused JavaScript, document
    latency, network requests, and main-thread parse/evaluate time.
  - Pass criteria: FCP does not regress; render-blocking stylesheet finding is removed after item 2;
    unused first-load JS drops after item 3; document-latency compression warning is removed after
    item 1.

- [x] **Playwright timing/behavior smoke.**
  - Command shape: `pnpm perf:fcp -- --url "$URL" --output test-results/fcp-harness/<name>`
    records `performance.getEntriesByType('resource')`, checks first viewport text visibility,
    takes mobile/desktop screenshots, and validates console/page errors.
  - Pass criteria: question title/body are visible before deferred regions complete; deferred
    stylesheet/runtime loads occur after the first paint scheduling point; no visible overlap or
    layout break is introduced on mobile/desktop.
  - Evidence: `pnpm perf:fcp -- --url https://kovo-stackoverflow-34444524520.us-central1.run.app/questions/q3 --output test-results/fcp-harness/stackoverflow-q3-smoke`
    captured mobile/desktop FCP/resource timing, first-viewport visibility, screenshots, and zero
    console/page errors.

- [x] **Interaction deferral smoke.**
  - Command shape: Playwright tests that click an enhanced link and submit an enhanced form before
    the deferred runtime is fully ready, then assert the queued interaction replays or native
    fallback proceeds correctly.
  - Pass criteria: no captured event is dropped; enhanced interactions still update/navigate after
    runtime load; ordinary native links/forms are not intercepted by the bootstrap.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/inline-loader-bootstrap.browser.test.ts packages/browser/src/inline-loader-navigation.browser.test.ts`
    covers early enhanced click/form replay, native link pass-through, failed runtime submit
    fallback, and enhanced navigation after runtime install.

- [ ] **Region priority smoke.**
  - Command shape: route/document tests plus browser tests for `critical`, `after-paint`, and
    `visible` regions.
  - Pass criteria: critical region HTML is in the initial shell; `after-paint` content arrives by
    stream or post-paint fetch; `visible` content does not load eagerly and loads when near viewport;
    deferred-region CSS is present before/with inserted markup.

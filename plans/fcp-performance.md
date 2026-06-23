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

- [ ] **4. Reduce route critical CSS and theme-variable payload.**
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
- [x] 2026-06-22 diff hygiene: `git diff --check` passed.

## Repeatable Perf Harness

- [ ] **HTTP byte/header probe.**
  - Command shape:
    `curl -sS -H 'Accept-Encoding: br,gzip' -D /tmp/kovo-so.headers -o /tmp/kovo-so.html -w 'status=%{http_code}\nttfb=%{time_starttransfer}\ntotal=%{time_total}\nsize=%{size_download}\ntype=%{content_type}\n' "$URL"`
  - Capture for: the route document and each critical CSS/JS asset discovered from the document.
  - Pass criteria after compression work: text responses advertise `Content-Encoding: br` when
    Brotli is accepted, include `Vary: Accept-Encoding`, keep correct `Content-Type`, and transfer
    materially fewer bytes than the raw response.

- [ ] **HTML asset inventory.**
  - Command shape: parse the fetched HTML and report inline style/script byte counts,
    stylesheet links/preloads, modulepreloads, `noscript` fallbacks, body byte count, and failed or
    duplicate asset identities.
  - Pass criteria: inline critical CSS/runtime bytes trend down; full stylesheet is not emitted as
    a render-blocking link when critical CSS is present; deferred/preloaded/applied stylesheet
    identities dedupe by `href`.

- [ ] **Lighthouse mobile performance run.**
  - Command shape:
    `npx --yes lighthouse "$URL" --output=json --output-path=/tmp/kovo-so-lh.json --only-categories=performance --chrome-flags='--headless=new --no-sandbox' --quiet`
  - Record: FCP, LCP, Speed Index, TBT, render-blocking requests, unused JavaScript, document
    latency, network requests, and main-thread parse/evaluate time.
  - Pass criteria: FCP does not regress; render-blocking stylesheet finding is removed after item 2;
    unused first-load JS drops after item 3; document-latency compression warning is removed after
    item 1.

- [ ] **Playwright timing/behavior smoke.**
  - Command shape: a small Playwright script against desktop and mobile viewports that records
    `performance.getEntriesByType('resource')`, checks first viewport text visibility, takes a
    screenshot, and validates no console/page errors.
  - Pass criteria: question title/body are visible before deferred regions complete; deferred
    stylesheet/runtime loads occur after the first paint scheduling point; no visible overlap or
    layout break is introduced on mobile/desktop.

- [ ] **Interaction deferral smoke.**
  - Command shape: Playwright tests that click an enhanced link and submit an enhanced form before
    the deferred runtime is fully ready, then assert the queued interaction replays or native
    fallback proceeds correctly.
  - Pass criteria: no captured event is dropped; enhanced interactions still update/navigate after
    runtime load; ordinary native links/forms are not intercepted by the bootstrap.

- [ ] **Region priority smoke.**
  - Command shape: route/document tests plus browser tests for `critical`, `after-paint`, and
    `visible` regions.
  - Pass criteria: critical region HTML is in the initial shell; `after-paint` content arrives by
    stream or post-paint fetch; `visible` content does not load eagerly and loads when near viewport;
    deferred-region CSS is present before/with inserted markup.

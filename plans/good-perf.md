# Performance: Is Kovo Competitive With Next.js?

Created 2026-08-07. Owner: perf. Behavioral source of truth remains `SPEC.md`.

Scope: development speed (`kovo dev` edit loop, `kovo check`, `kovo build`) and production speed
(wire bytes, FCP/LCP, TTFB, SSR throughput, navigation, repeat visit, cold start) measured
head-to-head against Next.js 16.2.9 + React 19.2.7 (Turbopack default) on the identical
`benchmarks/` commerce app.

**This is the single active performance ledger and it defers to nothing.** It absorbs the open
items of `plans/better-js-loader.md` (loader byte/protocol work) and `plans/fast-ci.md` (CI wall
clock); those two are superseded and should not be worked independently. `plans/fast-check.md` is
closed and remains the historical record of the four prior build-speed rounds.

Scope decision (2026-08-07): **everything below is in scope.** The ordering in "Ranked
opportunities" is a dependency and value-delivery order, not a scope boundary.

## Verdict

Kovo is **not** currently competitive on either axis, and it loses worst on the axis its
architecture was designed to win.

- **Production bytes**: four concrete defects, two of them near-trivial to fix, account for the
  entire loss. Kovo's *raw* HTML is 6.2% leaner than Next.js's and its navigation protocol is 2.7x
  more compact — then it ships everything uncompressed and loses anyway.
- **Navigation and repeat visit**: Kovo's headline architectural feature, server-owned enhanced
  navigation, is **100% dead in the production build** — Kovo's own CSP blocks Kovo's own client
  runtime. Every in-app navigation falls back to a full page reload. Measured to actual paint, Kovo
  is **23–35x slower** and moves **438x more bytes** than Next.js.
- **Development**: one architectural mistake — uncached whole-project TypeScript `Program`
  construction on the edit path — makes the edit loop **67x slower** than Turbopack, and at
  realistic app size it stops being a performance problem and becomes a correctness problem: an edit
  **never reaches the browser**, and an in-flight request during the resulting stall **crashes the
  dev server**.

Kovo does hold genuine wins: **0 ms TBT** on both profiles, and mobile time-to-interactive-dialog
**3.0x better** than Next.js (405.9 ms vs 1225.5 ms). Those are real and currently buried.

### Production — first load

| Metric | Kovo | Next.js 16.2.9 | Ratio |
| --- | ---: | ---: | ---: |
| Document on the wire, `/` | 41,014 B | 6,036 B (gzip) | **6.8x worse** |
| Document on the wire, `/product/...` | 25,195 B | 3,066 B (gzip) | **8.2x worse** |
| Document identity bytes (uncompressed) | 41,014 B | 43,725 B | 1.06x **better** |
| Critical-path bytes shipped | 430,847 B | 8,064 B render-blocking | — |
| Mobile FCP/LCP (4x CPU, ~1.6 Mbps, 150 ms RTT) | 980 ms (MAD 4) | 408 ms (MAD 12) | **2.40x worse** |
| Desktop FCP/LCP | 40 ms (MAD 0) | 40 ms (MAD 0) | tie |
| Desktop TTFB | 3.9 ms (MAD 0.1) | 1.3 ms (MAD 0.1) | 3.0x worse |
| Mobile TTI proxy (cart dialog) | 405.9 ms | 1225.5 ms | **3.02x better** |
| Total Blocking Time (both profiles) | 0 ms | 0 / 11 ms | **better** |
| Lighthouse desktop `/` | 88 | 89 | ~tie |
| Lighthouse desktop `/product/...` | 70 | 90 | **worse** |
| Boot to first 200 | 266.4 ms (MAD 30.5) | 228.7 ms (MAD 11.0) | ~tie |
| Steady-state RSS @ c=32 | 339.5 MiB | 289.1 MiB | ~tie |

### Production — navigation and repeat visit (mobile-throttled session, 7 medians)

| Metric | Kovo | Next.js | Ratio |
| --- | ---: | ---: | ---: |
| Nav to product A (click → heading laid out) | 2,125 ms (MAD 6) | 61 ms (MAD 2) | **34.8x worse** |
| Nav to product A, wire bytes | 152,537 B | 0 B | — |
| Nav to product B | 1,162 ms (MAD 5) | 51 ms (MAD 1) | **22.8x worse** |
| Nav to product B, wire bytes | 152,839 B | 349 B | **438x worse** |
| Back to listing (to actual paint) | 784 ms (MAD 3) | 24 ms (MAD 2) | **32.7x worse** |
| Repeat visit `/` FCP (warm HTTP cache) | 960 ms (MAD 0) | 192 ms (MAD 4) | **5.0x worse** |
| Repeat visit `/` wire bytes | 166,899 B | 7,255 B | cold→repeat saving 61.6% vs 95.9% |
| Enhanced-nav document, raw | 2,286 B | 6,249 B (RSC) | **2.7x better** |
| Enhanced-nav document, on the wire | 2,286 B (never compressed) | 1,776 B (gzip) | 1.29x worse |

Note on prior numbers: the committed harness measures navigation as *DOM presence*, which reports
Kovo at 36.9 ms desktop / 88.5 ms mobile. Measured to **actual paint** in a real session the same
navigation costs 2,125 ms. DOM-presence timing understates Kovo's navigation cost by ~39x because
Kovo replaces the whole document. Do not quote the DOM-presence figure.

### Production — SSR throughput

| Metric | Kovo | Next.js | Ratio |
| --- | ---: | ---: | ---: |
| req/s, `/` @ c=32 (vs force-dynamic Next) | 399.6 | 766.4 | **1.92x worse** |
| req/s, `/product` @ c=32 (vs force-dynamic Next) | 772.3 | 1759.4 | **2.28x worse** |
| req/s, `/` @ c=32 (vs Next **as it actually ships**: prerendered) | 399.6 | 5330.2 | **13.3x worse** |

Two comparisons matter and the repo's benchmark conflates them. Against a *force-dynamic* Next
rebuild that genuinely renders per request, Kovo is ~2x slower. Against what `next build` produces
for this app **by default** — prerendered routes served as `x-nextjs-cache: HIT` — Kovo is 13x
slower, because Kovo has no prerender/ISR/route-cache tier at all. Both belong in any honest
comparison.

### Development

| Metric | Kovo | Next.js (Turbopack) | Ratio |
| --- | ---: | ---: | ---: |
| `dev` cold start, benchmark app (1 file, 541 LOC) | 19,657 ms (MAD 366) | 1,000 ms (MAD 4.2) | **19.7x worse** |
| `dev` cold start, `examples/stackoverflow` (24 files, 5,007 LOC) | 59,049 ms (MAD 80) | — | **59x** vs Next on the small app |
| `dev` warm start, benchmark app | 18,618 ms (MAD 557) | 986 ms (MAD 10.6) | warm saves only 5.3% |
| **Edit → served HTML updated**, benchmark app | **7,225 ms** (MAD 33.6) | **107 ms** (MAD 3.1) | **67x worse** |
| **Edit → served HTML updated**, `examples/stackoverflow` | **never lands** (4/4 runs) | — | broken |
| HMR preserves client state | **no** — full reload every save, 3/3 | **yes**, 4/4 | — |
| Dev server RSS, idle after cold start | 3,013 MB | 630 MB | **4.8x worse** |
| Dev server RSS, `examples/stackoverflow` peak | 4,026 MB | — | on a 16 GiB box |
| `build` cold / warm / one-line edit | 50,730 / 52,743 / 46,647 ms | 2,456 / 2,561 / 2,531 ms | **20.7x / 20.6x / 18.4x worse** |
| Build peak process-tree RSS | 1,831–2,198 MiB | 1,127–1,140 MiB | 1.6–1.9x worse |
| `check` cold / warm / one-file (benchmark app) | 19,324 / 17,668 / 13,707 ms | — | warm ≈ cold |
| `check` cold / warm / one-file (`stackoverflow`) | 38,486 / 38,684 / 32,394 ms | — | warm ≈ cold |

## Current state after batch 3 (merged to main, 2026-08-08)

| Metric | Baseline | Batch 3 merged | Change |
| --- | ---: | ---: | ---: |
| `kovo check` growth in module count | **quadratic** (fit RMSE 26x better than linear) | **linear** (quadratic fit no longer beats linear) | — |
| `kovo check` wall, N=400 | 143.1 s | 64.2 s | -55.1% |
| `ts.createSourceFile` calls, N=50 | 23,894 | 995 | -95.8% |
| peak check RSS, N=400 | 3,110 MiB (over the 3,072 budget) | 3,022 MiB | under budget |
| apply-shaped SSR CPU @ c=32 | 38.63% | 1.31% | — |
| per-dispatch cost | 15.13 ns | 3.18 ns | 4.8x |
| SSR throughput (simultaneous A/B) | — | +5.4% to +8.6% | — |
| watch reuse on a docs-only edit | 25,233 ms, `reused 0/8` | 1,049 ms, `reused 7/8` | -95.8% |

**Read the O8 attribution correction before quoting the old 38.5% figure.** The V8 profiler
attributes callee builtin ticks to the calling JS frame, so that bucket mostly contained the invoked
natives' real work. Removing the indirection was worth doing — 4.8x per dispatch, 5-9% throughput —
but the recoverable overhead was ~7% of per-request CPU, never 38.5%. The remainder re-attributes to
per-prop own-data snapshotting, which is the real next target.

Still open after batch 3: an in-closure source edit still executes all 8 check phases (~15 s via
watch, 9.9x over the 2 s budget); closing it needs a producer seam in `build-export.ts`.

## Current state after batch 2 (merged to main, 2026-08-08)

**Enhanced navigation works.** `tests/integration/specs/enhanced-navigation-no-reload.spec.ts` — the
acceptance criterion for O2, which failed by construction on 2026-08-07 — now passes 2/2: an eligible
in-app navigation does not replace the document, and a pre-navigation `window.__sentinel` survives.

Verified on merged main against the rebuilt production artifact:

| Metric | Baseline | Batch 2 merged | Change |
| --- | ---: | ---: | ---: |
| per-navigation wire bytes | 152,537 B (full reload) | **920 B** (br) | **-99.4%** |
| navigation payload vs Next.js | 1.29x worse | **1.9x better** (920 B vs 1,776 B) | — |
| `examples/stackoverflow` edit→served | never landed (4/4) | 3/4 land, median 35,861 ms | — |
| `benchmarks/kovo` edit→served | 2,478 ms | 1,224 ms | -50.6% |
| parse-error feedback | none for 90 s | 580 ms + browser overlay | — |
| client state on a non-entry save | destroyed 3/3 | preserved | — |
| KV448 import wall | unbuildable at N≥130 | flat-200 passes end to end | — |

The navigation response negotiates `application/vnd.kovo.document-parts+json` and carries
`Kovo-Build` plus `Vary: Accept, Accept-Encoding`; the client validates build identity before
constructing any DOM and never parses an HTML string, so `require-trusted-types-for 'script'` holds
with no policy shim.

Wall-clock figures throughout are from a box shared with concurrent agents (loads 8-23 recorded per
cell) and are INDICATIVE. Clean-box re-measurement is owned by O17.

## Current state after batch 1 (merged to main, 2026-08-08)

The tables above are the **2026-08-07 baseline** and are kept as the reference point. Verified on
merged main by rebuilding `benchmarks/kovo` and probing the running production artifact:

| Asset | Baseline (wire) | Batch 1 merged (wire) | Change |
| --- | ---: | ---: | ---: |
| document `/` | 41,014 B | **2,588 B** (br, 18,105 B identity) | **-93.7%** |
| document `/product/...` | 25,195 B | **787 B** (br, 2,286 B identity) | **-96.9%** |
| `/assets/styles.css` | 122,222 B | **1,050 B** (br, 3,907 B identity) | **-99.1%** |
| client runtime | 267,611 B | **0 B** (not referenced by an inert document) | **-100%** |
| **critical path** | **430,847 B** | **3,638 B** | **-99.2%** |
| first `<link rel=stylesheet>` offset | byte 23,174 (56.5% in) | **byte 130** (0.72% in) | — |
| stylesheet revalidation | 122,222 B re-download | **304, 0 body bytes** | — |

**Next.js ships 8,064 B render-blocking on the same app. Kovo now ships 3,638 B — 2.2x fewer.**
The mobile FCP loss the baseline recorded (980 ms vs 408 ms) was ~83% transfer time on a
209,715 B/s link; that transfer is now ~3.6 KB instead of ~163 KB. A clean-box FCP re-measurement
is owned by O17 and is the acceptance criterion for closing the headline claim.

Behaviour confirmed on merged main: cookie-bearing documents compress (`content-encoding: br` plus a
per-response `kovo-pad` length mask) where they previously refused outright; `/assets/*` carry
strong ETags and return real 304s; document GETs are exempt from the framework-default per-IP limit;
an inert document ships no `<script>` and a `script-src 'self'` CSP with no inline hash; an
interactive document still receives the bootstrap and runtime (pinned by the create-kovo production
build test); the listing still renders all 24 product cards.

Also merged: `kovo dev` edit→served 25,704 ms → 3,590 ms on `benchmarks/kovo` (n=10 each, same
loaded box back to back — INDICATIVE, not a clean-box number; clean re-measurement owned by O17).

## The single cross-cutting root cause (development)

Three of the four worst development findings are the same mechanism: **Kovo builds full TypeScript
`Program`s + `getTypeChecker`s, uncached, repeatedly, on paths that should be incremental.**

CPU attribution of one `kovo dev` edit on the benchmark app (V8 sampler over an exact
edit→served window, 4 merged profiles; the main thread is **99% saturated for the whole 7.2 s**):

| Bucket | ms/edit | % |
| --- | ---: | ---: |
| `handleHotUpdate` → `collectCompilerQueryShapeFacts` → `collectDataPlaneAnalysis` | 2,869 | 37.3 |
| `handleHotUpdate` → `collectCompilerProjectMutationFacts` → `createProgram` | 724 | 9.4 |
| `transform` → `lowerViteSourceDerivedRegistryDeclarations` → `ts.createProgram` | 753 | 9.8 |
| second `lowerViteSourceDerivedRegistryDeclarations` (vite.ts:620) → another fresh `ts.createProgram` | 743 | 9.7 |
| `runDevDataPlaneGate` (debounced) → `collectDataPlaneAnalysis` again | 703 | 9.1 |
| garbage collector | 563 | 7.3 |
| `extractPackageComponentCss` (stylesheet manifest re-extraction) | 451 | 5.9 |
| module-runner re-executing the SSR graph | 177 | 2.3 |

**Whole-project TypeScript analysis is 5,792 ms = 75.3% of every edit** (≈87% including the GC it
causes). Self time by file: `typescript@6.0.3/lib/typescript.js` 3,552 ms (46.2%) **plus a second,
separate TypeScript bundled inside `@ts-morph/common/dist/typescript.js` at 1,727 ms (22.5%)** —
two TypeScript compilers and four-plus `createProgram` calls per keystroke-save. Kovo's own
`packages/compiler` self time is 190 ms (2.5%), and **actual JSX lowering is invisible in the
profile**. App source costs ~1 ms.

The same shape appears in `check`/`build` as a quadratic in closure size (O6) and in the dev
server's 3 GB idle RSS. Speeding up the compiler's lowering would achieve nothing; reducing how many
times a `Program` is constructed is the whole game.

## Decisions taken (2026-08-07)

All decided. These are binding for the work below; do not re-open them without recording why.

| # | Decision | Ruling | Gates |
| --- | --- | --- | --- |
| D1 | Compress cookie-bearing / `no-store` responses? | **Compress everywhere.** Mitigate BREACH by token masking / padding, never by refusing to compress | O1 |
| D2 | How to unblock enhanced navigation past Trusted Types | **Structured document-part protocol, directly.** No interim Trusted Types stopgap; the CSP directive stays | O2 |
| D3 | Document caching policy | **Content-hash `/assets/*` immutable now**; document validators are decided as part of D9 | O3, O14 |
| D4 | CSS pruning strategy | **Import-graph pruning**; per-route splitting evaluated afterwards on measurement | O4 |
| D5 | Prove security posture per keystroke or per commit? | **Per commit.** Do all four: shared `Program`/`DocumentRegistry`, content-hash memo, incremental analysis, **and** move analysis off the HMR blocking path. `check`/`build` stay fail-closed | O5, O6 |
| D6 | Speculation Rules default | **Default on** for routes the compiler proves are side-effect-free GETs; opt-out per route | O9 |
| D7 | Deferred client runtime registration | **Register only for apps with ≥1 L1 interaction** | O10 |
| D8 | `Reflect.apply` wrapper vs boot-captured direct call | **Boot-capture then direct-call.** Threat model is written as a prerequisite deliverable, not as a gate on the decision. No fast/hardened build flag | O8 |
| D9 | Prerender / route-cache tier | **Build the compiler-proved cache-influence cache**, not a Next-style annotation cache | O14, O3 |
| D10 | Multi-core story | **Document N-process-behind-proxy; make the rate limiter process-aware.** Built-in cluster only after D9 | O14 |
| D11 | Streaming / early `<head>` flush | **Stay buffered.** Revisit only after O1–O4, and only for routes proven to make no post-render header decisions | O14 |
| D12 | Default per-IP rate limit on document GETs | **Exempt document GETs**; keep shedding on mutations/queries | O13 |
| D13 | Budget workload | **Two tiers**: keep the toy for cheap CI signal, add a realistic tier allowed to fail loudly | O17 |
| D14 | Committed benchmark report | **Regenerate or delete it**; it currently errs in Kovo's favour | O15 |
| D15 | Scope | **Everything.** No deferral to other ledgers | all |

### Accepted consequence of D2

Choosing the document-part protocol over a Trusted Types stopgap means **enhanced navigation stays
broken in production until the protocol lands** — every in-app navigation remains a full page reload,
at a measured 2,125 ms / 152,537 B versus Next.js's 61 ms / 0 B. This was chosen deliberately over a
short-lived `DOMParser` policy shim. Two mitigations are required in the meantime, both listed under
O2: land the navigation regression test immediately so the state cannot silently change again, and
land O1/O3/O4 first so the reload that does happen is as cheap as possible.

## Ranked opportunities

Ranked by measured win ÷ (implementation cost × security risk).

### O1 — Ship response compression in the generated production adapter — **critical, small, low risk**

- [x] Emit `Content-Encoding` from the `--preset node` (and Vercel) build artifact.
  - Done 2026-08-08 on `perf/transport-bytes`. The emitted adapter (`build.ts`
    `nodeAdapterRuntimeSource`) now negotiates br/gzip with q-values; the generated server and
    Vercel function pass `acceptEncoding` through `preparedNodeRequestTransportMetadata`; static
    files are compressed from a per-content cache (brotli-11/gzip-9, ≥1024 B, keyed by the strong
    sha256 ETag) and dynamic responses use brotli q5 (measured 1.41 ms vs 163 ms at q11 per doc).
    Cloudflare worker emission unchanged — its edge applies compression; not re-verified here.
  - D1 executed: the `isSensitiveResponse` refusal is deleted. Cookie-bearing/`no-store`/`private`
    responses compress; BREACH posture = per-mint XOR-masked CSRF tokens (already in
    `csrf.ts createCsrfToken`) plus a per-response random `Kovo-Pad` (1..64 hex chars) on every
    compressed response; `Cache-Control: no-transform` is the sole authored opt-out. Normative in
    SPEC §9.5 ("Transport compression and BREACH posture"); pinned by
    `node.test.ts` ("compresses private no-store and cookie-bearing responses…") and
    `build.test.ts` ("emits a standalone node server…" compressed-cookie probes).
  - Measured (rebuilt `benchmarks/kovo`, curl with `Accept-Encoding: br, gzip`): document `/`
    41,014 → **7,390 B**; `/assets/styles.css` 122,222 → **16,528 B**; runtime client module
    267,611 → **47,680 B**; three critical-path assets 430,847 → **71,598 B (-83.4%)**.
    Enhanced-nav document 2,286 → **786 B** (vs Next 1,776 B gzip); `/product/...` 25,195 →
    **5,543 B**. With a `Cookie` header the document still compresses (7,408 B, `no-store` kept).

### O2 — Enhanced navigation is dead in production: Kovo's CSP blocks Kovo's own runtime — **critical, small, low risk**

This is a bug, not a tuning opportunity, and it invalidates Kovo's headline architectural claim.

Per D2, the fix is the structured document-part protocol, not a Trusted Types shim. This item
absorbs `plans/better-js-loader.md` Phases 4–5, which are superseded.

- [x] Land a navigation regression test **first**, before any protocol work.
  - `tests/integration/specs/enhanced-navigation-no-reload.spec.ts` landed with the plan; on
    `perf/nav-document-parts` the `test.fail()` marker is deleted (per its own contract) and both
    tests pass green: the pre-click `window.__sentinel` survives and the navigation timing entry
    still names the `/` document after navigating to `/products/sku-1`.
- [x] Diagnose and record why the client half is unreachable, as the protocol's acceptance criterion.
  - Diagnosis recorded below stands (CSP `require-trusted-types-for 'script'` rejects the deferred
    runtime's `DOMParser.parseFromString`); acceptance criterion is now met — the spec above passes
    with the parts protocol and there is no `DOMParser`/`parseFromString` reference left in the
    generated installer (`inline-loader-artifact-minifier.test.ts` pins the absence).
  - Historical measurement kept for the baseline: nav to product A **2,125 ms / 152,537 B** vs
    Next **61 ms / 0 B**; nav to product B **1,162 ms / 152,839 B** vs **51 ms / 349 B**.
- [x] Split enhanced navigation into a modular source helper with an inline build target.
  - `enhanced-navigation.ts` + `navigation-security-intrinsics.ts` are the single source embedded
    by `inline-loader-build.ts` (`inlineHelperSpecs.enhancedNavigation`) into both the inline
    bootstrap artifact and the deferred runtime module; the D2 protocol change flowed through that
    one source into both artifacts, with parity pinned by the minified-parity asserts.
- [x] Add the enhanced-navigation **document-part response** (`perf/nav-document-parts`).
  - Wire shape normative in `spec/07-navigation.md` §8 "The document-part representation":
    `application/vnd.kovo.document-parts+json` carrying `kovo-document-parts/v1` — a JSON part
    tree of the exact canonical document. Server encoder `packages/server/src/document-parts.ts`
    (fail-closed tokenizer; refusal serves canonical `text/html` and the client does the normal
    full GET); client applier builds the detached document via boot-captured
    createElement/createElementNS/createTextNode/setAttribute in
    `navigation-security-intrinsics.ts` — `DOMParser` is deleted from the runtime entirely.
  - Build identity: the envelope-level `build` token is validated against the immutable page-load
    proof BEFORE any DOM is constructed (enhanced-navigation.ts + the lifecycle wiring), then the
    built document's `kovo-build` meta is re-validated. Pinned by `app-document.test.ts`
    ("answers the enhanced Accept with a structured parts envelope"), `document-parts.test.ts`
    (28 encoder cases), `inline-loader-navigation.test.ts`/`.browser.test.ts` (108 apply/fallback
    cases per suite), and the acceptance spec above.
  - Carried constraints held: no client router (real-anchor interception unchanged); no
    app-authored internal-runtime imports; CSP untouched (`require-trusted-types-for 'script'`
    stays, no parser policy); inline bootstrap SHRANK 22,819 → 22,699 B identity (gzip 4,731 B vs
    the 10,500 `inlineKovoLoaderGzipByteBudget`) because script replay was removed. The deferred
    runtime artifact budgets were raised 520,000→530,000 raw / 150,000→153,000 gzip
    (`scripts/browser-deferred-app-runtime-policy.mjs`) for the parts builder, which lands twice
    in that versioned/cacheable artifact.
  - Inert-by-construction floor: only `application/json` and `speculationrules` (D6/O9) script
    data blocks encode; executable scripts, `on*` attributes, `srcdoc`, `is`, `base` refuse
    server-side AND abort client construction. Deferred/streaming documents answer canonical
    `text/html` (client hard-navigates) — script replay no longer exists on the navigation path.
  - A target document with no segment stamps now applies via wholesale in-realm body replacement
    (spec §8 "Segment persistence is derived" updated): stamps only ever ADD preservation.
  - Measured per-navigation wire (rebuilt `benchmarks/kovo` production artifact, node client with
    `Accept-Encoding: br, gzip`): enhanced parts document `/product/linen-field-jacket` =
    **920 B wire (br) / 2,800 B identity**; `/` = 2,793 B wire / 21,197 B identity; envelope
    build token === `Kovo-Build` header on both. Baseline was **152,537 B per navigation**
    (-99.4%); the plan's own ~963 B projection and Next's 1,776 B are both beaten. The benchmark
    app itself is INERT under the O10/D7 gate (ships zero scripts), so it navigates natively at
    788 B br/document; the interactive direction is proven end-to-end by the acceptance spec
    (typed-link-navigation fixture in real Chromium under the real Trusted Types CSP: parts
    response 500 B identity / 263 B br, realm survives).
  - Residual (pre-existing, orthogonal to D2): the live page's CSP `style-src` hash list is
    computed from the CURRENT document, so `style=""` attributes morphing in from the target
    document are not covered by an already-sent CSP header; unchanged from the old design.
- [x] Fix the `Vary` asymmetry on document responses.
  - Every 200 document representation (text/html AND parts) now carries `Vary: Accept`
    (`app-document.ts` `documentResponseIsAcceptNegotiated`); file/stream route outcomes are
    excluded. Pinned by `app.test.ts` + `app-ingress-intrinsics.test.ts` + the static-export
    manifest tests (exported documents carry the dimension too).

### O3 — Give static assets and documents real cache validators — **critical, small, low risk**

- [x] Stop re-downloading the 122 KB stylesheet on every navigation.
  - Done 2026-08-08 on `perf/transport-bytes` (per D3; document validators stay with D9/O14).
    Every statically served file from the generated node server carries a strong sha256 content
    ETag and answers `If-None-Match` (weak comparison per RFC 9110 §13.1.2) with **304**.
    Measured: `/assets/styles.css` → `etag: "9f766c01…"`, conditional refetch → `304`, 0 body
    bytes (was a full 122,222 B re-download). Normative in SPEC §9.5 ("Static validators and
    connection reuse"); pinned by `build.test.ts` 304/ETag probes. The remaining half of D3 —
    content-hashing the `styles.css` *filename* so `/assets/*` can go immutable — lives with the
    asset emitters (`build-export.ts`/`package-styles.ts`, the O4 slice); the immutable-pattern
    header path already engages for hashed names (e.g. `/assets/index-DEZ6Vmj6.css`).
- [x] Give document responses cache headers at all (documents half; decided and built as D9/O14).
  - Compiler-proved public documents now carry `Cache-Control: public, max-age=0, must-revalidate`,
    a strong sha256 `ETag`, and `Last-Modified`, and answer `If-None-Match` with a 0-byte 304
    (verified on the rebuilt `benchmarks/kovo` artifact: `/` 18,105 B identity -> 304 with 0 body
    bytes). Credential-influenced documents keep the credential floor by proof + runtime floors.
    See O14 for the full contract, measurements, and adversarial pins.
  - Still open under this item: content-hashing the `/assets/styles.css` FILENAME so `/assets/*`
    can go immutable (lives with the asset emitters, O4 ownership).

### O4 — Prune the emitted stylesheet to actually-used components — **critical, medium, low risk**

- [x] Make `/assets/styles.css` a function of imported components, not of the whole `@kovojs/ui` package.
  - Evidence (merged, verified on main): `/assets/styles.css` 122,222 B → **3,907 B identity /
    1,050 B brotli on the wire**; a 3-component app builds end to end at 8,685 B. When the import
    graph cannot prove the set the build falls back to the full catalog with an explanatory comment —
    it fails safe toward correct rendering, never toward smaller output.
    `packages/compiler/src/package-styles.test.ts` + `build-export-stylesheet-diagnostics.test.ts`.
  - Root cause: `packages/cli/src/commands/build-export.ts:8016-8067` calls
    `extractPackageComponentCss('@kovojs/ui', ...)` unconditionally, and
    `packages/compiler/src/package-styles.ts` `packageComponentSources()` walks the package's entire
    exports map (44 `.tsx` entries) regardless of imports.
  - Measured: the served sheet is 122,222 B raw. **119,095 B (97.44%)** is `@kovojs/ui` component CSS
    for an app that imports **zero** `@kovojs/ui` components. Tokens are 3,125 B (2.56%); app CSS
    contributes 0 B to this sheet. Cross-component sharing is negligible — 119,740 B summed vs
    119,095 B deduped (0.54%) — so pruning is nearly linear in components dropped.
  - Win (MODELED from measured segments): this app 122,222 → 3,125 B raw (-97.4%), 16,528 → 256 B
    brotli (-98.5%). A hypothetical 4-component app: 12,224 B raw (-90.0%).
  - Risk: `kovo add` copies components into the app's own `src/`, so an import-specifier filter must
    handle copy-in users; dynamic/conditional usage needs a conservative fallback.
- [x] Related defect: the benchmark page rendered with **no app CSS at all** — the authored stylesheet
      was compiled but never reached the served sheet, while the 122 KB library sheet was.
  - Evidence: app CSS actually applied 0 B → 3,907 B on merged main.
  - Residual, still open: an app that imports ≥1 `@kovojs/ui` component **and** declares
    `stylesheet('./styles.css')` still loses its authored CSS — `hints.ts` derives the href
    separately. Precise repro recorded by the implementing slice; carried into O10's file ownership.
- [x] Adopt `components: 'imported'` on the dev stylesheet manifest for dev/prod parity.
  - Done 2026-08-08 on `perf/dev-incremental`: `collectDevStylesheetManifest` in
    `packages/server/src/vite.ts` now passes `components: 'imported'` (same selection
    `build-export.ts:8040` uses; unprovable graphs still fall back to the full catalog).
    `kovo compile package-css` untouched per the note below.
    `packages/cli/src/commands/compile.ts:1906` (`kovo compile package-css`) deliberately keeps
    `exported` — it is a whole-package artifact command and must not be changed.
- [ ] Evaluate per-route stylesheet splitting on measurement (deferred from D4, not yet assessed).

### O5 — Stop rebuilding whole-project TypeScript state on every dev edit — **critical, large, medium risk**

Per D5, all four approaches are in scope, in this order. The governing ruling: **Kovo proves security
posture per commit, not per keystroke.** `check` and `build` stay fail-closed and unchanged; the dev
server stops blocking on proofs that will be re-established before anything ships.

- [x] D5-a: share one `ts.Program` / `DocumentRegistry` across the four construction sites.
  - Evidence (merged): `@ts-morph/common` bundled TypeScript self time inside one CDP-profiled
    edit→served window 1,727 ms → **0 ms**; `typescript.js` 3,552 ms → **561 ms**. Honest limit
    recorded by the slice: ts-morph@28 has no `documentRegistry` option, so apps that DO use the
    data plane still pay the drizzle ts-morph pass on every content change.
  - Cheapest win, no posture change. Sites: `handleHotUpdate`'s two calls
    (`packages/server/src/vite.ts:660-671`), the `transform` hook's
    `lowerViteSourceDerivedRegistryDeclarations`, and the second one at `vite.ts:620`. Together those
    are 2,220 ms of a 7,225 ms edit before counting the data-plane analyses.
- [x] D5-b: fix the data-plane cache key so a hit is actually cheap.
  - Evidence (merged): re-keyed on a per-file sha256 content hash, invalidated by the watcher; the
    memo is per-run, not process-global, per the documented ts-morph OOM history.
  - `data-plane-static-analysis.ts:281-293` computes its key by first building a full TS Program and
    canonical-JSON-serialising every app source byte, so a hit costs nearly as much as a miss. Key on
    a content hash of app sources, invalidated by the watcher. An mtime key is unsound under some
    editor write patterns and under git operations that preserve mtime; a content hash costs one read
    per app file per edit, still ~1000x cheaper than a `Program`.
- [x] D5-c: make the analysis incremental — re-analyse changed files plus dependents, not the closure.
  - Done 2026-08-08 on `perf/dev-incremental` (`app-contract-project.ts`): root files now share
    parsed ASTs across Program constructions under the same byte-exact revalidation dependencies
    always had (only the edited file re-parses), and `analyzeEntry` is memoized per immutable
    project so the mutation census and static census stop re-running identical checker sweeps.
    Measured on a copy of `examples/stackoverflow` (21 files, loaded box): mutation census cold
    2,451 → 735 ms; warm same-content 1,480 → 40 ms; static census on the memoized project
    4,983 → **1 ms**; census after a real 1-file change 458 ms. Verified by the three
    app-contract suites (32), compiler vite suites (119), drizzle static suites (22).
  - Honest residual: the drizzle/ts-morph + output-schema pass inside `collectDataPlaneAnalysis`
    is still whole-project per content change — measured 17.4 s cold / ~31 s after a 1-file edit
    on the same loaded box. It lives in `packages/drizzle` + `packages/core` (outside this
    slice's ownership) and is now fully off the HMR blocking path per D5-d.
- [x] D5-d: take whole-project analysis off the HMR blocking path entirely.
  - Done 2026-08-08 on `perf/dev-incremental` (`packages/server/src/vite.ts`): `handleHotUpdate`
    no longer derives whole-project facts before compiler staging. One debounced (1.5 s settle)
    single-flight pass re-derives facts + gate diagnostics asynchronously; a changed canonical
    fact digest invalidates derived modules and publishes a convergence full-reload; analyzer
    failures keep last-good facts and never crash HMR. Every dev response carries
    `Kovo-Dev-Posture: dev-unproven` (verified on a live `kovo dev` server). Normative wording:
    spec/09-wire-protocol.md §9.5.1 "per commit, not per keystroke" paragraph. `kovo check` /
    `kovo build` unchanged and fail-closed (vite-data-plane-gate suite 27/27; the split-ownership
    external-compiler embedding keeps the synchronous fail-closed revocation, vite.test.ts 21/21).
    Pinned by `vite-dev-unproven.test.ts` (header; non-blocking staging + convergence reload on a
    real fact change; no reload on a comment-only edit).
  - Measured `examples/stackoverflow` edit→served: baseline **never lands** (ledger 4/4; not
    re-reproducible here — a re-measurement found the prior probe's token anchor matched a code
    comment, so its "never" rows were vacuous) → with D5-c+D5-d **3/4 land, median 35,861 ms
    (MAD 1,858)** at load 8–23 on a box shared with concurrent agent runs (INDICATIVE). The 4th
    edit missed the 240 s window during a load-23.5 spike. The remaining ~35 s is generation
    restaging (compiler `hotUpdateGenerationStage` measured 36.4 s contended) plus analysis CPU
    contention — the dev-runner generation path, owned by the `perf/dev-correctness` slice (O6).
  - Measured `benchmarks/kovo` edit→served, same box back to back (INDICATIVE): pre-slice
    2,478 ms median (MAD 1,042, worst 22.0 s, load 13–20) → **1,224 ms median (MAD 173, worst
    1.3 s, load 9–15)**, n=6 each, landed 6/6 both.
- [x] Remove the extension-only data-plane test so non-data-plane files get a genuinely cheap path.
  - Evidence (merged): `kovo dev` edit→served on `benchmarks/kovo` 25,704 ms → **3,590 ms** (n=10
    each, same loaded box back to back, load avg 22-30 — INDICATIVE, not a clean-box number).
  - Mechanism: `packages/server/src/vite.ts:660-671` — `handleHotUpdate` awaits
    `collectCompilerProjectMutationFacts` then `collectCompilerQueryShapeFacts` **before** the
    compiler sees the change. Each builds a full `ts.createProgram` + `getTypeChecker` over every app
    root file (`packages/compiler/src/app-contract-project.ts:330-331`). Two more fresh Programs come
    from `lowerViteSourceDerivedRegistryDeclarations` (transform hook and vite.ts:620), and a
    debounced `runDevDataPlaneGate` runs the data-plane analysis a third time.
  - The existing cache is inert: `data-plane-static-analysis.ts:281-293` computes its cache **key** by
    first building a full TS Program and canonical-JSON-serialising every app source byte, so a hit
    still costs nearly as much as a miss.
  - **There is no cheap path for non-data-plane files.** `isDataPlaneSourceFile`
    (`internal/data-plane-static-analysis.ts:200`) delegates to `isDataPlaneAppSourcePath`, whose only
    content test is `staticAnalysisRegExpTest(/\.(?:[cm]?[jt]sx?)$/u, baseName)` — a **file-extension
    check**. The benchmark app contains zero `app.query`/`app.mutation` calls and still pays the full
    whole-project query-shape pass on every save.
  - Measured: edit → served is **7,225 ms (MAD 33.6, n=10)** on a 1-file app vs **107 ms (MAD 3.1)**
    for `next dev` — **67x**. On `examples/stackoverflow` a single save burns **≈27.5 s of CPU**
    (22.9 s in `handleHotUpdate` + 2.1 s in the gate) and then serves nothing.
  - The earlier "~13 s per save" recon estimate is wrong in both directions: it **overstates** by
    ~1.8x on a small app (real: 7.2 s) and **understates** by ~2x on a realistic one (real: ~25 s).
  - Win: removes 75.3% of edit latency directly, plus most of the GC and most of the 3 GB dev RSS.
  - Constraint: an mtime-keyed memo is unsound under some editor write patterns and git operations
    that preserve mtime; a content-hash key costs one read per app file per edit, still ~1000x cheaper
    than a `Program`.

### O6 — The dev loop is broken, not just slow, at realistic app size — **critical, correctness**

Not throughput items; defects that make `kovo dev` unusable on the repo's own flagship example.
Grouped here because they share O5's root cause. Four of five closed 2026-08-08 on
`perf/dev-correctness`; the remaining latency root cause stays with O5 D5-c/D5-d.

- [ ] Fix: an edit to `examples/stackoverflow` **never reaches the served HTML**.
  - Latency root cause (whole-project facts on the HMR path) is O5 D5-c/D5-d, landed on
    `perf/dev-incremental`: the edit now lands **3/4 with median 35,861 ms** (load 8-23,
    INDICATIVE; the miss was a load-23.5 spike), against **never, 4/4** at baseline. The residual
    ~35 s is the compiler `hotUpdateGenerationStage` whole-generation restaging (36.4 s measured
    contended). Note for that owner: `vite-dev.ts:1391` app-shell `handleHotUpdate` swaps/reloads
    **only when the edited file is the app entry** (`sourceFile !== moduleId -> return undefined`);
    component edits rely solely on the compiler-plugin staging path.
  - Before the watchdog below landed, three rapid edits still froze HTTP hard - 7 held requests got
    **0 bytes for 150 s** - and took ~6.5 min to converge because every obsolete backlog revision
    revalidated serially. Both are addressed by the two bullets that follow.
  - Landed here — the failure MODE can no longer be silent (loud-by-construction watchdog):
    the runner-generation broker takes an observer; `kovo dev` prints
    `change to <file> has not produced a new app generation after Ns…` every 10 s from the
    watcher, `edit #N is still being proven after Ns…` while a candidate validates, and
    `edit #N active after Nms` on every landing. Verified live on `examples/stackoverflow`
    (stall line at t+43 s, then `edit #1 active after 3447ms`). During a hard CPU pin the
    interval fires late-but-loud when the loop unblocks.
    `dev-runner-generation.ts` + `dev.ts` monitor; pinned by
    `dev-runner-generation.test.ts` observer suite.
  - Landed here — superseded-backlog skip: a staged revision that was out-requested before it
    began validating resolves without a full app validation (validation reads live bytes, so the
    newest revision proves the same source). Pinned by "skips validating a superseded backlog
    revision and swaps only the newest edit".
- [x] Fix: a request in flight when the 30 s request deadline fires **crashes the dev server**.
  - **Not reproducible at HEAD** (5 distinct attempts, 2026-08-08): (1) stackoverflow stall with
    an admitted in-flight request crossing t+30 s → 200 after 30.76 s, server alive; (2) 7 held
    requests through a 150 s outage → server alive; (3) real `kovo dev` app with
    `deadlineMs: 3000` and a never-resolving endpoint → **503 at 3.0 s**, server alive; (4) same
    with a mid-stream stalled body → connection torn at 3.0 s, server alive; (5) two
    real-Node-transport unit paths. Most plausibly fixed by O13's quiet-teardown/E1 changes,
    which landed after the recon. The contract "a deadline produces a failed response, never a
    dead server" is now pinned by
    `packages/server/src/request-deadline-node-transport.test.ts` (process-level
    uncaughtException/unhandledRejection capture over a real `node:http` transport, slow-handler
    and mid-stream cases, dev posture `compression: false`).
- [x] Fix: a hard parse error produces **zero developer feedback** for at least 90 s.
  - Done on `perf/dev-correctness`. The generation stage failure (previously swallowed entirely —
    the app-shell plugin rejected before sending any event) now reports through the broker
    observer: terminal `[kovo dev] edit #N failed after Nms: <full teaching diagnostic>` plus
    `the previous build remains active; fix the error and save again.`, and the Vite error
    overlay via a ws `{type:'error'}` payload; the next successful stage clears the overlay
    without a reload (`{type:'update',updates:[]}`).
  - Verified live on `benchmarks/kovo`: `</h9>` in `<h1>` → terminal PARSE_ERROR with
    `src/app.tsx:439:45` + source excerpt at **580 ms** (was: nothing for 90 s) and
    `vite-error-overlay` present in a Playwright browser; undefined identifier →
    `edit #5 failed after 470ms: definitelyNotDefinedIdentifier is not defined` (was: bare 500
    at 8,246 ms). Serving the previous build with 200 is deliberate (SPEC §6.2.1 keeps the
    last-good generation active) and is now announced instead of silent.
- [x] Fix: every app-source edit forces a full page reload; client state is destroyed on every save.
  - Ground truth established (2026-08-08, Playwright on `examples/stackoverflow`):
    `componentRefresh` **is** reachable for a non-entry live-target component edit — resolved the
    plan's open question. But only for byte-length-preserving edits: three offset-bearing fields
    leaked into the HMR fact hashes, so any insertion/deletion above a declaration downgraded a
    render-only save (observed live, in order: `routeRefresh['style']` from
    `styleRuleUsages[].generatedFrom`; `fullReload['live-target']` from
    `queryBindings[].queryKeySpan`; plus `generatedFromSpan`/`sourceSpan` in query-update plans).
    This — not the route-shell short-circuit, which is dead code (`sourceKind` is only ever
    `'component'`) — is why every real save reloaded.
  - Fixed in `createComponentHmrImpactMetadata` (`packages/compiler/src/hmr-impact.ts`): HMR
    hashes are computed over span-free projections (SPEC §5.2 rule 9). Verified live: the same
    offset-shifting edit now classifies `componentRefresh['render-output']`, patches via
    `kovo:component-render` with **no** full-reload, and `window.__sentinel` survives with
    `navigation.type === 'navigate'`. Pinned by `hmr-impact.test.ts` ("ignores pure byte-offset
    shifts…" + "classifies render-output-only edits…").
  - Residual, out of this slice: an **entry-file** edit still full-reloads by design
    (`vite-dev.ts` route-shell path) — the single-file benchmark app therefore still reloads
    every save. State-preserving route-shell refresh needs O2's document-part protocol plus
    route-shell facts; a failed entry stage no longer reloads (regression-tested).
- [x] Fix: `kovo check source --watch` leaks orphaned processes.
  - Done on `perf/dev-correctness`: `superviseKovoCliSessionParent`
    (`packages/cli/src/commands/process-supervision.ts`) polls the parent pid (unref'd); a
    changed ppid proves the invoker died, aborts the watch session (and closes `kovo dev`).
    Verified end to end: SIGKILL of the wrapper `kovo` process → the watch child printed
    `[kovo] the invoking parent process (pid …) is gone …` and exited **3 s** later. Unit-pinned
    by `process-supervision.test.ts`. Residual: killing only the *grandparent* (harness shell)
    leaves the pair alive because `bin.ts`'s spawnSync wrapper has no supervision — needs a
    `bin.ts` follow-up (out of this slice's ownership).

### O7 — Fix the quadratic `app-source-trust` phase in check/build — **critical, large, medium risk**

- [x] Remove the super-linear term from `kovo check` / `kovo build` closure analysis.
  - Done 2026-08-08 on `perf/check-quadratic`. Mechanism confirmed by call counts before
    optimising: `parseSourceFile` (`ts.createSourceFile`) executed **6,319 times at N=25 →
    23,894 at N=50** (3.78x for 2x modules, ~N²; 96% in the `app-source-trust` trust worker) —
    ~9 whole-closure re-parse sweeps per module: `compile.ts` identity registration at parse AND
    lower phases, the `scan/parse.ts` identity loop, `build-export.ts` `parsedModule`,
    render-equivalence, and browser-posture, all fed by the ledger's suspected
    `build-export.ts` `extraFiles` shape.
  - Fix: `parseSharedSnapshotEntry` (`scan/parse.ts`) — one AST per snapshot entry OBJECT per
    run, weakly keyed (never process-global content-keyed, honoring the drizzle OOM constraint);
    reuse only on byte-exact fileName+source match (SPEC §5.2: the reuse condition is the
    exactness proof). The §5.2.1 pinned options snapshot stays the sole decision carrier; its
    `extraFiles` clones (and structural-jsx's defensive clones) are aliased to their origin
    entries as identity hints only, so a mutated/hostile entry can only cause a fresh parse.
  - Post-fix call counts are linear: **495 / 995 / 2,049** at N=25/50/100 (2.0x per doubling).
    Residual slight super-linearity lives in the check-worker `sessionAuthorityFactsFromEntry`
    vite-closure walk (261→536→1,140; ~N·log₈N) — negligible at this size.
  - Ladder re-measured, same 8-ary-tree protocol, 3 samples/rung medians, shared box
    (load1 recorded 7–17, INDICATIVE): pristine-main baseline 27.6 / 30.8 / 50.4 / 73.7 /
    **143.1 s** (N=25→400) → fixed 21.4 / 22.2 / 31.5 / 39.3 / **64.2 s** (N=400 **-55%**).
    Quadratic coefficient 1.626e-4 → **2.428e-5** (-85%); linear-fit/quadratic-fit RMSE ratio
    1.4x → **1.0x** — the quadratic model no longer explains anything the linear model doesn't.
    Marginal cost per module stopped rising monotonically (base 129→392→233→347 ms;
    fixed 32→185→78→125 ms, noise-dominated, ~linear ≈115 ms/module contended).
  - RSS improved at every rung (max over samples): N=200 2,956 → **2,513 MiB**; N=400 3,110 →
    **3,022 MiB** — back under the 3,072 MiB budget (median 2,627).
  - Verified: `scan/shared-snapshot-entry-parse.test.ts` (identity reuse, byte-exact
    revalidation, no cross-run content sharing, clone aliasing, O(N)-vs-O(N²) parse-count bound
    with byte-identical compile output); full `packages/compiler` suite 2,595 passed with only
    the 3 pre-existing main failures; `kovo check source` exit 0 at every rung; `kovo build`
    exit 0 end-to-end on the N=25 ladder app (node preset); framework-export-posture gate
    exit 0 (compiler is digest-exempt: request-closed).
- [x] Fix the hard scaling wall: a legitimate app becomes unbuildable purely by growing.
  - Done 2026-08-08 on `perf/dev-incremental`. **Cause correction**: instrumentation shows the
    N=130 flat entry consumes only ~540 abstract work units — the 16,384-step
    `abstractWorkBudget` this item suspected was never the wall. The real wall was the fixed
    128-entry **effect-site history cap** in `scan/lexical-provenance.ts`: every module-scope JSX
    element is one opaque call recording an unmodeled-effect site, so the 129th component set
    `budgetExhausted` and `security/capability-closure.ts` widened every use into the KV448
    refusal. The cap now scales with the module's own syntax-node count, clamped [128, 4096];
    exhaustion semantics are unchanged and still fail closed on adversarial input.
  - End-to-end evidence (canonical flat shape: N components + one routed page, per-app UUID):
    main `feef77093` refuses flat-130 with the exact ledger message; `perf/dev-incremental`
    passes flat-130 and flat-200 (`kovo check source` exit 0; flat-200 87.6 s wall on a loaded
    box, peak process-tree RSS 3,281 MB). Memory control at N=125 (passes on both): main
    3,445.0 MB / 52.4 s vs branch 3,440.5 MB / 51.2 s — no regression. Unit ladder pinned by
    `scan/lexical-provenance-scaling.test.ts` (flat N∈{125,130,200,400,1000} in-budget; a
    >4,096-site module still refused).

### O8 — Remove the `Reflect.apply` indirection from the SSR hot path — **high, large, high risk**

Per D8, the ruling is **boot-capture then direct-call**: prove intrinsic identity once at module init,
before any app code runs, then call the captured function directly instead of routing every call
through `Reflect.apply`. No fast-vs-hardened build flag.

- [x] Write the threat model as a prerequisite deliverable (not a gate on the decision).
  - `security/boot-captured-direct-call.md` (landed on `perf/ssr-apply-indirection` before the
    implementation change). Conclusion: on a boot-captured `fn`, a boot-minted bound direct caller
    (`uncurryThis = bind.bind(call)` from the boot-captured `Function.prototype.call`/`bind`) has
    the same no-lookup/no-iterator invocation property as `Reflect.apply`, so the T1/T2/T3
    poisoned-`apply`/`call`, poisoned-receiver-method, and poisoned-iterator threats stay closed.
    Residuals enumerated and handled: pre-boot `call`/`bind` forgery (same trust class as the
    existing capture set; probe corpus now runs through the minted callers), receiver-sensitive
    statics (`Promise.resolve` keeps a boot-bound receiver; standing review rule for new
    captures), dynamic targets (R3 — keep `Reflect.apply`), spread ban (R4), explicit-`undefined`
    optional-argument review (R5). Normative anchor: spec/06-type-system.md §6.6 rule 6.
- [x] Replace the indirection with boot-captured direct calls on the render path.
  - Done 2026-08-08 on `perf/ssr-apply-indirection`. All four membranes converted:
    `packages/server/src/security-witness-intrinsics.ts` (= `apply$12`, 33.2% self),
    `packages/server/src/jsx-form-helper-intrinsics.ts` (largest single feeder — its
    `formHelperSnapshotRecord`/`ownDataValue` flow was 4.3 s of the 6.7 s apply-shaped total),
    `packages/server/src/response-security-intrinsics.ts` (= `apply$10`), and
    `packages/core/src/internal/security-witness-intrinsics.ts` (= `invoke$1`). Receiver-bearing
    methods dispatch through boot-minted `uncurryThis` callers; receiver-insensitive statics are
    called directly; `witnessReflectApply`/`securityApply`/`formHelperApply` keep the boot-captured
    `Reflect.apply` for caller-shaped targets and that dynamic path retains its own
    positive/negative probes (a pre-import `Reflect.apply` forgery still fails closed — pinned by
    the pre-existing core preimport-poison suite). New pins in
    `security-witness-intrinsics.test.ts`: post-boot poisoning of `call`/`apply`/`bind` +
    `Reflect.apply` is inert (0 poison hits), pre-import poisoning of `Function.prototype.call` or
    `.bind` fails closed. Suites: core 559/559, server membrane + dependent files
    (cookies/crypto/csrf/guards/html/jsx) 417/417; root `tsc` error set byte-identical to main.
- [x] Re-measure throughput and re-profile; the acceptance criterion is that no `apply`-shaped frame
      remains in the top 5 self-time frames under c=32 load.
  - **Acceptance met.** Rebuilt `benchmarks/kovo` production artifact, c=32 `--cpu-prof`: top 5
    self-time frames are `formHelperSnapshotRecord` 9.7%, `ownDataValue` 5.3%, GC 4.6%,
    `renderJsxAttributes` 3.3%, `formHelperDefineDataProperty` 3.1%. Apply-shaped residue is
    **1.31–1.33% total** (was 38.6% reproduced pre-change on this box: `apply$12` 33.18% +
    `invoke$1` 3.68% + `apply$10` 0.77%), and none of it is in the top 16. The remaining 0.59%
    `invoke` is `packages/browser/src/security-witness-intrinsics.ts` (outside this slice's
    ownership; same conversion applies if ever worth it).
  - Throughput and CPU (simultaneous A/B: baseline `4cc66bf28` artifact and branch artifact
    serving at the same instant on one box, equal contention, load 10–13 — INDICATIVE, shared
    box): per-request main-thread CPU 7.81 → **7.28 ms (-6.9%)** at c=16 with byte-identical
    documents; same-window req/s +7.4%; four unprofiled simultaneous cells: `/` c=1 **+7.5%**,
    `/product` c=1 **+6.4%**, `/` c=32 **+8.6%**, `/product` c=32 **+5.4%**. Dispatch
    microbenchmark on this box: megamorphic shared-`Reflect.apply` helper 15.13 ns/call →
    boot-minted caller **3.18 ns** (4.8x), within 4% of the 3.06 ns raw-call floor.
  - **Attribution correction for the ledger** (do not re-open expecting ~1.6x): the profiler
    attributes callee *builtin* ticks to the calling JS frame, so the 34–38% "apply-shaped self
    time" bucket mostly contained the invoked natives' real work. The recoverable indirection
    overhead was ≈0.5 ms of 7.8 ms/request (~7%), consistent across all measurements; the rest of
    that bucket now re-attributes to the witness wrappers (`formHelperSnapshotRecord` etc.), which
    is the true remaining cost of per-prop own-data snapshotting, not call indirection.

### O9 — Enable Speculation Rules by default, or justify the 3.3x cost — **high, small, design decision**

- [ ] Revisit `spec/07-navigation.md`'s "never auto-emitted, default off" for prefetch.
  - Confirmed: zero `speculationrules` occurrences in emitted documents. Next.js `<Link>` prefetches
    by default with no configuration.
  - Measured A/B on the same app: turning rules on via
    `route({ prefetch: 'moderate', prefetchJustification })` on both page routes cuts navigation
    latency from **1,151 ms (MAD 18) to 349 ms (MAD 1)** — a **3.3x** improvement Kovo currently
    leaves on the table by default.
  - Note this was measured with the settled-runtime protocol while enhanced navigation is broken
    (O2); re-measure after O2 lands, since the two interact.

### O10 — Stop shipping a 267 KB client runtime unconditionally — **high, medium, medium risk**

- [ ] Make the deferred runtime conditional on the app actually needing it, and compress it.
  - `ensureKovoLoaderRuntimeClientModule` (`packages/server/src/loader-runtime-client-module.ts:106-111`)
    mandatorily registers `/c/kovo-runtime.client.js` for **every** app. The benchmark app — an MPA
    with a native popover dialog and no client handlers — ships 267,611 B of it, uncompressed.
  - Disambiguated: this app ships `kovoDeferredRuntimeModuleSource` (267,611 B), **not** the 1.92x
    larger `kovoDeferredAppRuntimeModuleSource` (512,843 B), which `packages/compiler/src/vite.ts:999`
    emits only when query plans exist. Rollup tree-shakes neither.
  - Win: 56,448 B with gzip-9 (subsumed by O1); far more by not registering it for apps with no L1
    interactions. Likely cause of the Lighthouse `/product` desktop regression 88 → 70
    (FCP 1509 → 2258 ms, LCP 1659 → 3158 ms, bytes 147,646 → 417,120).
- [ ] Avoid resending stable loader bytes across documents.
  - Absorbed from `plans/better-js-loader.md` Phase 6. The 22,819-byte inline bootstrap is re-emitted
    in full on every document; only the enhanced-navigation variant omits it, and that path is dead
    until O2 lands.
- [ ] Keep the modular runtime authoritative and generate the inline orchestration from it.
  - Absorbed from `plans/better-js-loader.md` Phases 2, 3 and 7 plus its two open baseline gaps
    ("inline orchestration is not generated from the modular runtime", "loader transport has no
    reusable document-part protocol" — the latter is O2's protocol). Binding constraint carried over:
    the installed always-loaded bootstrap must not regress its gzip budget.

### O11 — Give `check`/`build` a working warm and incremental path — **high, large, medium risk**

- [ ] Make a second `kovo check` cheaper than the first, and a one-line edit cheaper than a full run.
  - Measured: `kovo check` on `benchmarks/kovo` — cold 19,324 ms (MAD 21), **warm 17,668 ms**,
    one-file 19,020 ms fresh / **13,707 ms via a persistent `--watch` session**. `kovo build` — cold
    50,730 / **warm 52,743** / incremental 46,647 ms. Warm is inside the noise of cold in both; the
    surviving `.kovo` cache is only 252 KiB. `kovo dev` warm start saves only 5.3–10.4%, same story.
  - Reuse never fires: every revision reports `reusedPhases=0 / executedPhases=8`, even though the
    phase census supports a `reused-authenticated` status for exactly this purpose.
  - Against `devex-budgets.json` provisional targets (cold 30 s / warm 10 s / one-file 2 s):
    `benchmarks/kovo` fails warm 1.77x and one-file **9.51x** (6.85x via watch);
    `examples/stackoverflow` fails cold 1.28x, warm 3.87x, one-file **19.57x** (16.2x via watch).
  - ~7 s of every run is fixed cost no app can amortise: config-trust ~1.85–2.19 s, stylesheet
    ~1.75–2.41 s, typescript ~2.77–2.86 s are flat from a 1-module app to a 400-module app, plus
    2.8–5.3 s the census does not attribute at all (CLI startup + on-the-fly TypeScript transform of
    the CLI's own source under `--experimental-transform-types`).
  - Asymmetry worth noting: a build that **fails** in the check phase exits in ~7 s, so "time to first
    error" looks fine while "time to a green build" is 53 s.
  - Hard constraint — **do not re-propose an on-disk compiler cache**. `plans/compiler-refactoring.md:128`
    (FN3) and commit `cab4b4b84` deliberately deleted `compile-cache.ts` /
    `persistent-compile-cache.ts` because "the disk store could not authenticate entries against
    same-UID authored config (SPEC §2/§6.6) and raced concurrent manifest writers".
    `plans/fast-ci.md:57` retired cross-run CI cache restores for the same reason. The win must come
    from authenticated in-session reuse or from removing work (O5/O7), not from a disk cache.

### O12 — Move the stylesheet link ahead of the inline bootstrap — **medium, small, low risk**

- [ ] Emit `<link rel=stylesheet>` before the 22.8 KB inline loader in the document head.
  - Measured: Kovo's `<script>` opens at byte offset 229 and carries a 22,819-byte inline body
    (55.64% of the whole document); the single `<link rel=stylesheet>` does not appear until byte
    offset **23,174** (56.50% in). Next.js puts its stylesheet link at byte **132**.
  - With a typical initcwnd of ~14.6 KB, CSS discovery from markup alone costs more than one extra
    round trip. Kovo does emit a `Link: rel=preload; as=style` response header, which mitigates this
    for clients that honour it — quantify the residual before spending effort here.

### O13 — Fix production transport defects found while load-testing — **medium, small, low risk**

- [x] Restore HTTP keep-alive for bodyless GETs.
  - Done 2026-08-08 on `perf/transport-bytes`: the generated server no longer arms
    `armIncompleteNodeRequestClose` before dispatch for GET/HEAD (the payload-free ingress gate
    already proved there is no body to guard; the post-dispatch arm and rejection writers stay).
    Verified on the rebuilt artifact: plain GET returns `Connection: keep-alive`; curl reuses one
    connection across 3 URLs; an 800-request keep-alive sweep left **18** TIME_WAIT sockets (was
    16,416 — the whole ephemeral range). Pinned by `build.test.ts` (keep-alive probe + emitted
    source regex).
- [x] Revisit the default per-IP rate limit for document GETs.
  - Done per D12: `rateLimitFailure` skips the `all:per-ip` check for surface `other` GET/HEAD
    when `limits.perIp` is identity-equal to the framework default. Authored `perIp`, the global
    budget, and mutation/query per-IP budgets are unchanged. Verified: 800 document GETs from one
    IP → **800×200, zero 429** on the rebuilt artifact; `app-load-shed.test.ts` pins all five
    postures. Normative sentence added to SPEC §9.5 pre-dispatch load shed.
- [x] Stop reporting a normal client disconnect as an unhandled server error.
  - Done: `writeWebResponseToNode` (node.ts and the emitted adapter) classifies
    `ERR_STREAM_PREMATURE_CLOSE`/`ERR_STREAM_UNABLE_TO_PIPE`/`ERR_STREAM_DESTROYED`/`EPIPE`/
    `ECONNRESET` (own `code` data property only) as peer teardown, destroys the response quietly,
    and rethrows everything else. Verified: 10 mid-body client aborts against the rebuilt
    artifact produced **zero** `[kovo] unhandled node server error` log lines.

### O14 — Decide the prerender / route-cache, multi-core, and streaming stories — **high, large, design decision**

- [x] D9 built: the compiler-proved cache-influence document cache tier (`perf/cache-tier`, 2026-08-08).
  - Compiler: every JSX-authored `route()` now emits a `document:<path>` entry into the
    `kovo-cache-influence/v1` manifest (`scan/route-page-cache-influence.ts` finite document cache
    language + `app-graph.ts documentCacheInfluenceEntries`; normative in SPEC §9.4 "Document
    cache-influence surface"). Fail-closed derivation: request-identity/signUrl/process reads,
    awaits, construction, imported or mutable module values, layouts, queries, file/stream
    outcomes, guards/missing access, dynamic meta, and an absent/unprovable same-module
    `defineKovo({ renderRoute })` all close the entry; same-module JSX/helper closures over
    build-constant literal data plus `trustedUrl`/`trustedHtml` as direct callees prove.
    `kovo build` on the UNMODIFIED `benchmarks/kovo` proves `document:/` and
    `document:/product/:slug` `public-proved` and closes `document:/images/:name` (stream outcome);
    entries register in the emitted server (`dist/.kovo/graph.json` + generated handler).
  - Runtime (SPEC §9.5 "Proved-document caching"): proved 200 html/parts documents carry
    `Cache-Control: public, max-age=0, must-revalidate` + strong sha256 ETag + Last-Modified,
    answer If-None-Match with a 0-byte 304 (measured 0 body / 1,217 header bytes), and repeats are
    served from a per-app LRU cache keyed by manifest axes (path, search, vary values, negotiated
    representation, build token). Adversarially pinned (`proved-document-cache.test.ts`, 9 tests):
    cookie/authorization requests bypass in both directions; guard chains, legacy guards, resolved
    session principals, and Set-Cookie all refuse EVEN AGAINST A FORGED public-proved manifest;
    closed/missing entries never stamp; authored public Cache-Control stays demoted
    (cache-generality intermediary suite still green). Compiler pins:
    `cache-influence-document.test.ts` (10 tests incl. the adversarial matrix).
  - Measured (branch artifact vs baseline `b848ca3ef` artifact, same box back-to-back, load1
    5.6–8.2 recorded per cell, `Accept-Encoding: identity`, requestLimits raised to 1e6 on both
    sides for measurement only — INDICATIVE): `/` c=32 **334.4 -> 5,082.6 req/s (15.2x)**, p50
    93.1 -> 5.25 ms; `/` c=8 337.6 -> 6,188.1; `/` c=1 254.7 -> 1,209.8; `/product` c=32
    873.6 -> 4,638.9 (5.3x); 304 revalidation path up to 7,100 req/s. Vs Next's as-shipped
    prerender tier (5,330.2 req/s @ c=32, the 13.3x row): **parity at c=32 (0.95x), above it at
    c=8** — and Kovo's tier is compiler-proved, not annotation-guessed. Cookie-bearing requests
    render per request (334.4 vs 331.9 req/s baseline-vs-branch — floors intact, no regression).
- [x] D10 recorded + rate limiter process-aware: N processes behind one proxy is the supported
      horizontal model (SPEC §9.5 "Multi-process deployment posture"). `KOVO_PROCESSES=N` divides
      every rate budget's `max` by N (ceil, floor 1) so authored budgets stay deployment-aggregate;
      `maxKeys`/`windowMs` stay per-process; unparseable values throw. Pinned by
      `app-load-shed.test.ts` (5 new tests). Built-in cluster stays out of scope until D9 is
      re-measured on a quiet box (O17).
- [x] D11 recorded: documents stay buffered (SPEC §9.5 "Buffered document assembly"): status and
      every header (cookies, CSP hashes, guard/notFound outcomes, cache floors) are decided after
      the complete render and measured TTFB is 3.9 ms; streaming is revisitable only for routes the
      compiler proves make no post-render header decisions. §8 deferred regions remain the
      progressive path.
- Residuals: split-module apps (routes without a same-module `defineKovo`) and layout-composed
  routes are closed in v1 by construction; `respond.file`/stream outcomes keep the pre-existing
  demote-authored-public posture; the node adapter still brotli-compresses each cached-document
  response per request (extending the adapter's ETag-keyed compressed cache to proved documents
  is a build.ts follow-up, not this slice's ownership).
- [x] D9 verified end-to-end on `perf/cache-tier` (2026-08-08, second agent; predecessor never
      reported). Attacked the safety property and confirmed the accidental-leak surface is
      **airtight**: `cache-influence-adversarial.test.ts` (9 real-compile-pipeline cases — passing
      the context object into a helper, `process.env` through a same-module call graph, computed
      context member, `Math.random`/`Date.now`, `globalThis`, non-allowlisted method calls,
      request-header via the destructured 2nd param — all close; a genuinely pure params/search
      page proves) plus the predecessor's 19 tier tests (forged-`public-proved` manifests still
      refuse guards/sessions/cookies). Built-artifact probes (raised limits, measurement-only):
      anonymous `/` → `public, max-age=0, must-revalidate` + strong ETag + 304 on If-None-Match;
      `Cookie:`-bearing `/` → `no-store` + `Vary: Cookie, Accept`; closed `document:/images/:name`
      → `private, no-store`. `kovo build` on the unmodified benchmark emits `document:/` and
      `document:/product/:slug` `public-proved`, `document:/images/:name` closed.
  - Re-measured (built node artifact, load 5–6 recorded, `KOVO_PROCESSES` unset, identity encoding,
    requestLimits 1e6 measurement-only, INDICATIVE): cached `/` **2,116 / 3,504 / 4,669 req/s** at
    c=1/8/32 vs cookie-uncached **351 / 370 / 334 req/s** — **6.0x / 9.5x / 14.0x**; 304 path
    5,957 req/s @ c=32; cached p50 0.28 ms (c=1) / 5.65 ms (c=32); 18,105 B identity/doc. Consistent
    with the predecessor's cell (lower absolute rps at higher box load).
  - **Soundness boundary (explicit, SPEC §9.4 amended):** the render-hook clause trusts the
    manifest (KV235) to attest that a route module's own visible `defineKovo` is the app that
    assembles its routes. Only single-module apps (routes + `defineKovo` together) ever prove, and
    there the attested hook is the serving hook. A deliberately-planted decoy `defineKovo` in a
    route module whose routes are served by a different app with a per-visitor `renderRoute` is a
    trusted-author manifest-integrity concern, not a runtime-observable one — out of the
    cache-safety threat model, which the §9.5 runtime floors (all manifest-independent) own.

### O15 — Restore benchmark and harness validity — **high, medium, low risk**

The evidence base is unsound in seven independent ways. Fix before publishing any perf claim.

- [ ] Land the `benchmarks/kovo` repair so the entrant builds at HEAD.
  - At HEAD `a4e1d55a9` the entrant fails `D1A007`, so every number in the committed
    `benchmarks/results/report.md` (2026-06-23) is unreproducible from the tree as committed. All Kovo
    numbers here come from an in-flight repair on branch `perf/benchmark-entrant-repair`.
- [ ] Stop measuring navigation by DOM presence.
  - The committed harness waits for DOM presence, which reports Kovo navigation at 36.9 ms desktop.
    Measured to actual paint the same navigation costs 2,125 ms — the harness **understates Kovo's
    navigation cost by ~39x** because Kovo replaces the whole document.
- [ ] Fix the harness's load-window byte accounting.
  - `benchmarks/harness/scenarios.mjs` collects at `load` + 150 ms; Kovo's bootstrap imports the
    runtime on double-rAF *after* load. Measured: mobile records `total 164,673 / js 0`, while a +5 s
    settle gives `total 434,847 / js 267,948` for the identical build — the harness understates Kovo's
    mobile bytes by **2.64x** and reports `js: 0` for an app shipping 267,948 B of JS. The Next.js
    control is unaffected. Every "Kovo ships 0 JS" claim read off the mobile row is an artifact.
- [ ] Make the harness refuse to benchmark a foreign process.
  - `run-all.mjs` `waitForHttp` only checks that something answers <500 on the port. One full run was
    silently attributed to a concurrent agent's `next-server` and produced a complete, plausible-looking
    report.
- [ ] Measure Kovo in production posture, or record why it cannot be posture-matched.
  - `dist/server/server.mjs` throws at module load under `NODE_ENV=production` without
    `KOVO_ATTESTATION_DEPLOYMENT_ID` and `KOVO_ATTESTATION_SECRET`. `run-all.mjs` never sets
    `NODE_ENV`, so Kovo has always been benchmarked in **development posture** against Next.js
    production standalone.
- [ ] Repeat Lighthouse cells; a single sample is not reportable.
  - `benchmarks/harness/lighthouse.mjs` runs each cell once. One recorded cell returned null for every
    metric; a 3-run probe of the same URL returned 0.69 / 0.88 / 0.87 — a **19-point spread**.
- [ ] Land the TTFB instrumentation and add a bfcache probe.
  - The harness captured no `responseStart` and could not measure TTFB at all; a patch adding
    `ttfbMs`/`requestStartMs`/`responseEndMs` exists (branch `perf/bench-refresh-ttfb`). Caveat: CDP
    mobile emulation does not apply RTT to first byte, so the mobile TTFB row is not
    network-realistic. Separately, **bfcache participation could not be measured for either
    framework** — Playwright's `chrome-headless-shell` launches with `--disable-back-forward-cache`.
- [ ] Repair or retire the TanStack entrant.
  - `benchmarks/tanstack` fails to build: `readFile is not exported by __vite-browser-external,
    imported by src/routes/images/$name.ts` (TanStack Start server-route API drift). Excluded this round.

### O16 — Fix the production artifact's ability to boot and serve files — **high, small, low risk**

- [x] Stage `rootedFiles` roots into the build output.
  - Done 2026-08-08 on `perf/transport-bytes`. `rootedFiles()` records constructed roots;
    `writeKovoNeutralBuild` captures them as `KovoNeutralBuild.rootedFileRoots` (the app and the
    neutral build share one build-time SSR module graph; the emitting preset engine may not);
    the node preset stages each **relative** root under `rooted/root-<encodeURIComponent(spec)>/`
    and the generated server publishes `KOVO_ROOTED_FILES_DIR` before importing the handler, so
    the same relative spec resolves to its staged snapshot from any launch cwd (absolute roots
    stay live host paths; a missing staged root fails closed). Contract in SPEC §14
    ("Self-contained artifact filesystem roots"). Verified: `benchmarks/kovo` build emits
    `dist/server/rooted/root-..%2Fshared%2Fimages/product-*.webp`; the artifact **boots from a
    foreign cwd** and serves `/images/product-01.webp` 200. Pinned by
    `file.rooted-staging.test.ts` and the `build.test.ts` O16 staging test.

### O17 — Instrumentation, budgets, and CI wall clock — **high, medium, low risk**

Absorbs the open items of `plans/fast-ci.md`, which is superseded.

- [ ] Update root Vitest timing history after every successful CI run and verify shard balance.
  - Absorbed from `plans/fast-ci.md`.
- [ ] Make CI cache hits visible and keyed safely.
  - Absorbed from `plans/fast-ci.md`. Note the standing constraint recorded there: cross-run
    compiler/security-fact cache restores were retired deliberately and must not return (see
    "Do not re-propose").
- [ ] Make the check phase census obtainable on failing apps.
  - `appendSourceCheckPhaseCensus` is only reached on the success path (`build-export.ts:1099`); any
    throwing phase routes to `sourceCheckErrorResult` at `:1104` and the census is dropped. The
    instrument that exists to diagnose check cost is unavailable on exactly the slowest apps.
- [ ] Fix the fact that only 1 of 7 apps in the repo passes `kovo check`.
  - `benchmarks/kovo` passes only after a same-day hand repair; `examples/stackoverflow` fails with
    558 diagnostics (422 KV424 + 134 KV448 + 2 KV449); `examples/commerce` fails KV424;
    `examples/crm` fails KV422; `examples/{reference,gallery,devtool,verifier}` have no build script.
    This is a perf problem: there is no corpus to measure against.
- [ ] Re-baseline `devex-budgets.json` against a realistic workload.
  - Every metric is `"ratification": null` and calibrated on
    `scripts/devex-workloads/kovo-packed-check/package` — 4 files / 56 LOC / 1 route / no Drizzle. The
    dominant real cost (project-mode ts-morph/Drizzle analysis) is not in the benchmark at all, so
    none of the O(app size) behaviour in O5/O7 is detectable by CI today.
- [ ] Add an SSR throughput/TTFB gate, a navigation-to-paint gate, and a dev edit-to-served gate.
  - None of the three exists anywhere in the repo.
- [ ] Add CPU/heap profiling wiring to the perf scripts.
  - No `--cpu-prof`/`--heap-prof` path exists in any perf script, and the dominant `app-source-trust`
    work happens in a spawned worker the parent profiler cannot see. Note `--cpu-prof` via
    `NODE_OPTIONS` produces **zero** `.cpuprofile` files for `kovo dev` because SIGINT terminates it
    without flushing; CDP `Profiler.start/stop` works and gives exact windows.
- [ ] Narrow the compiler-perf budget back toward measured reality, or document why not.
  - `test:compiler-perf` total cold median is **2,179.3 ms (MAD 26.5)** against an 8,250 ms budget —
    73.6% headroom. The budget was 2,750 ms on 2026-06-16, 3,500 on 2026-07-13 and 8,250 on
    2026-07-24; the current median would pass the original. JSX lowering is **not** a bottleneck (it is
    invisible in the dev-edit profile and ~3% of check cost); this gate protects nothing.

## Pre-existing defects surfaced by the batch-1 regression sweep

Batch 1 introduced **zero regressions**. Established by running the same three files in isolation at
`93412b7e4` (before any good-perf work) and on merged main: both report exactly
`runtime-bootstrap.test.ts` 1 failing, `vite-packed-provenance.test.ts` 1 failing,
`vite.test.ts` passing. Full server sweep on merged main: **3,914 of 3,919 passing**.

Two classes of noise had to be eliminated first, and both are worth knowing about:
- `vite.test.ts` fails only under parallel load (90 s timeouts in a 258-file sweep with other work on
  the box) and passes in isolation both before and after. Not a defect in the code under test.
- Dangling workspace symlinks left by dependency bumps produce failures that look like code
  regressions. `packages/server/node_modules/vitest` still named the removed `vitest@4.1.8`, and
  `packages/better-auth/node_modules/better-auth` named a build keyed to `drizzle-orm@0.45.2`. Both
  read as `lstat: true, stat: false`. `pnpm install --frozen-lockfile` repairs them. Any perf
  measurement or regression claim taken without repairing these first is unreliable.

The remaining two failures are real and currently un-owned:

- [ ] `packages/server/src/vite-packed-provenance.test.ts` cannot pass on main.
  - The fixture symlinks the repo's `@kovojs` sources into a temp app, and `kovo dev` then loads them
    under Node's strip-only TypeScript loader, which rejects `export namespace derive` at
    `packages/browser/src/derive.ts:160` with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `kovo dev` exits 1
    in ~610 ms before any ready report.
  - Either the fixture must resolve `@kovojs` to built output rather than source, or `derive.ts` must
    stop using a TypeScript `namespace`. The same strip-only constraint is already recorded in this
    plan's "Do not re-propose" section for `packages/cli/dist/bin.mjs`.
  - A second, separate defect in the same file was fixed in passing: `statSync` was used for
    link-existence checks, so a workspace link left dangling by a dependency bump read as absent and
    the fixture re-created it, failing with `EEXIST`. Now `lstatSync`.
- [ ] `packages/server/src/runtime-bootstrap.test.ts` — "keeps packed mutation identity bound while
      private minting stays unexported" fails on main.
  - `runPackedMutationAuthorityChild` exits 1. Reproduces identically at `93412b7e4`.

## DevEx defects found while measuring

Not perf bugs, but they cost hours of measurement time. Candidates for a papercuts ledger.

- [ ] `D1A007` emits no file, no line, no source excerpt, no receiver expression, and no remediation —
      the entire output is one sentence, and the emitter already holds the node.
  - Actual cause: `defineKovo({...})` had no `appId`. `packages/compiler/src/app-contract-project.ts:1300`
    `if (!appId) return undefined;` makes `proveDirectDefineKovo` bail, and control falls to the
    catch-all refusal at :1270-1278. Localisation took ~4 minutes **and only because the compiler
    source was available**; an app author has no path at all — the message names no file to open and
    no option to add.
  - What it should say: `D1A007 src/app.tsx:15 receiver 'app' cannot be proved: defineKovo({...}) is
    missing the required 'appId'.`
- [ ] Build refusals surface strictly one gate at a time: repairing the benchmark entrant took **six
      independent hard stops across eight full build attempts** (D1A007 → import-escapes-app-root →
      22 KV424 + 16 KV448 rows → KV236 → KV417 → KV448 filesystem/process authority), each costing a
      ~50 s build to discover the next.
- [ ] `KV417` instructs the author to configure `node({ retention })`, but the `--preset node` CLI flag
      silently overrides the config file that would fix it, so the message loops forever.
- [ ] The build boundary root is `dirname(entry)`, so `../shared/catalog.json` escapes it and symlinks
      are refused outright (`Kovo client source tree contains an unstable entry`). Shared benchmark
      assets must be byte-copied, creating a drift hazard between entrants.
- [ ] `KV424` refusals are internally surprising: `array.map` is allowed but `array.find` is refused;
      a `for...of` over the same array is allowed; parameter destructuring is allowed but reading the
      same property off a non-destructured binding is refused.

## Do not re-propose

- **On-disk compiler / static-analysis caches.** Deleted deliberately in `cab4b4b84`; reason recorded
  under O11 (`plans/compiler-refactoring.md:128` FN3).
- **Concurrent execution of check analyzer phases.** `build-export.ts:939-942` serialises them:
  "Retaining both heaps made valid 44-component apps exceed 2 GiB even when the processes did not
  overlap."
- **Process-global ts-morph memos.** `packages/drizzle/src/static/project-setup.ts:60-69` — a prior
  process-global memo leaked Projects and OOM'd.
- **Optimising JSX lowering / the compiler's own transform.** Invisible in the dev-edit profile
  (`packages/compiler` self time 2.5%; app source ~1 ms) and 3.79x under its CI budget.
- **Optimising HKDF-per-HMAC, the request Proxy, prop snapshotting, per-request head re-serialisation,
  or the CSP rescan** as SSR hot spots. All measured and refuted (O8).
- **Running `packages/cli/dist/bin.mjs` inside the monorepo** to time anything: it yields 0 diagnostics
  and therefore meaningless timings. Use `./node_modules/.bin/kovo` (the source path).
- **`autocannon` against the Kovo server.** Its latency histogram is wrong by ~400x against
  `Connection: close` — it reported p50 1003 ms while simultaneously reporting 366 req/s at c=1.
  Invalidate any past Kovo latency number taken with it.
- **Measuring Next.js dev HMR over `127.0.0.1`.** The Turbopack HMR websocket handshake fails
  (`ERR_INVALID_HTTP_RESPONSE`), the client retry-loops and full-reloads at 35–77 s. Use `localhost`.
- **Quoting DOM-presence navigation timings.** They understate Kovo's real navigation cost by ~39x.

## Latest verification (2026-08-07, HEAD `a4e1d55a9` + uncommitted `perf/benchmark-entrant-repair`)

Machine: Apple Silicon macOS 26.2, 10 cores, 16 GiB, node v24.19.0, pnpm 10.12.1. All wall-clock
figures are medians over ≥5 samples with MAD, first sample discarded, on a box shared with other
agents (load average recorded per cell, 1.8–4.7).

- Browser head-to-head: `node benchmarks/run-all.mjs --iterations 10` (Kovo + Next.js; TanStack
  excluded), plus a 5x Lighthouse matrix.
- Navigation / repeat visit: mobile-throttled Playwright sessions (390x844, 4x CPU, ~1.6 Mbps /
  750 Kbps / 150 ms RTT via CDP) over cold `/` → product A → back → product B, 7 iterations, measured
  to actual paint; plus a speculation-rules A/B against a rebuilt scratchpad copy.
- Throughput: a Node `undici`/`node:http` keep-alive load generator (validated at 45,698 req/s against
  a null server — 53x the fastest server measured, so no cell was client-bound), c ∈ {1,8,32,64}, `/`
  and `/product/linen-field-jacket`, with and without a `Cookie` header. Kovo's default rate limits had
  to be raised from 600/min to 1e6 for any measurement to complete.
- SSR CPU profile: single 20 s `--cpu-prof` capture at c=32, ~24% profiler overhead (304.5 req/s
  profiled vs 399.6 unprofiled).
- Dev loop: `spawn → first 200` (6 samples, first discarded) and `source write → served HTML contains
  the new token` (11 edits, first discarded, 15 ms poll). Per-edit attribution via CDP
  `Profiler.start/stop` bracketing the exact edit→served window, 4 merged profiles at 500 µs. HMR
  classification via headless Chromium (Playwright 1.60.0) with a pre-edit `window.__sentinel`.
- Check/build: `KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE=<entry> ./node_modules/.bin/kovo check source <entry>`
  wrapped in `node scripts/lib/process-tree-rss.mjs`, over `benchmarks/kovo`,
  `examples/stackoverflow`, and a synthetic 8-ary tree ladder at N ∈ {25,50,100,200,400} plus an
  unimported-module ballast control at M ∈ {0..400} (flat — confirming the `plans/claude-papercuts-22.md`
  A1 OOM cause is fixed).
- Byte accounting: `curl` with `Accept-Encoding: br, gzip` against both production servers, plus
  offline gzip-9/brotli-11 of the identical served bytes.

Not verified: `scripts/devex-benchmark.mjs` (hard-requires `KOVO_DEVEX_OS_IMAGE` +
`KOVO_DEVEX_RUNNER_NAME`, a clean tree, and pins ubuntu-24.04/x64 — this box is darwin/arm64);
Cloudflare and Vercel presets (every transport finding is Node-preset only); HTTP/2, TLS, and
multi-process configurations; bfcache participation for either framework; speculation-rules
`prerender` eagerness; the query/loader execution layer, excluded from the SSR profile and possibly
dominant on data-heavy routes; a measured data-plane-vs-component edit split (established by code
reading only — `isDataPlaneSourceFile` is extension-only, so no cheap path exists to compare against).
Resolved since: `componentRefresh` IS reachable for a non-entry component edit and preserves client
state (O6, browser-verified 2026-08-08 on `perf/dev-correctness`).

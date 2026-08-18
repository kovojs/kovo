# Competitive performance: Kovo vs Next.js

Updated 2026-08-18. Owner: performance. This is the single active performance ledger. Framework
behaviour remains governed by `SPEC.md`; especially §1.1 goal 3, §4.4, §5.2, §8, §9.5, and §11.4.
The full 2026-08-07/08 investigation remains in git history through `f6e2256af` and its calibrated
Kovo-only baseline remains in `reports/perf-baseline-2026-08-08.json`.

## Outcome

Move Kovo toward the competitive targets below with an authoritative pinned-Next.js comparison and
verified developer and production improvements, without weakening Kovo's proof model. This plan's
completion floor is the explicitly named **first milestone** in each open item; the stronger
competitive targets remain follow-on targets and must be reported separately rather than implied by
a publishable first-milestone result. Every claimed improvement must come from a committed
throwaway-worktree spike, an alternating serialized A/B measurement, and a correctness gate. A
smaller or faster result that omits required behaviour is a failure, not a win.

## Current measured snapshot

Exploratory run on Apple Silicon, Node 24.19.0, Kovo 0.3.0 versus Next.js 16.2.9 / React 19.2.7.
Browser cells used three iterations and three Lighthouse repeats; build is one back-to-back sample.
Source, dirty paths, versions, and lock digests were recorded. Treat timing as indicative until the
clean serialized matrix below is complete. Detailed evidence: `reports/perf-comparison-spike-2026-08-13.md`.

| Default/as-shipped metric  |         Kovo |      Next.js | Current reading                               |
| -------------------------- | -----------: | -----------: | --------------------------------------------- |
| Mobile cold-session bytes  |      8,190 B |    175,266 B | Kovo 21.4x smaller                            |
| JavaScript bytes           |          0 B |    152,515 B | Fixtures are unequal L0 versus L1             |
| Mobile FCP / LCP           | 388 / 388 ms | 400 / 400 ms | Approximately tied                            |
| Mobile navigation to paint |       535 ms |       100 ms | Kovo 5.34x slower; 3/3 document replacements  |
| Lighthouse mobile `/` LCP  |       770 ms |     2,154 ms | Kovo 2.80x faster on unequal default fixtures |
| Production build wall      |      30.87 s |       3.22 s | Kovo 9.59x slower                             |
| Production build peak RSS  |     1,754 MB |       617 MB | Kovo 2.84x higher                             |

The current commerce fixtures are not capability-matched: Kovo's cart is an inert native popover
whose confirmation text is already in the document; Next's cart owns mutable client state. The
current cart-readiness result is therefore not a framework comparison and must not be quoted.

Current Kovo-only deterministic gates remain green on the realistic interactive workload: 6,383 B
critical path, 5,747 B document, 1,101 B document-parts response, and 4,824 B gzip / 22,820 B
identity bootstrap.

## Measurement contract

Every comparison has two separately reported lanes:

1. **Default/as shipped:** idiomatic framework defaults, including Kovo's L0 path, Next prefetch,
   and each framework's proved/prerender cache. This answers what users receive by default.
2. **Capability matched:** the same observable cart state, routes, data, module count, approximate
   authored LOC, images, cache posture, prefetch posture, and edit class. This attributes framework
   cost rather than application scope.

Rules for every accepted baseline and spike:

- Use clean committed worktrees from the same base SHA and frozen lockfiles. Reports must record SHA,
  dirty paths, framework/browser/Node versions, lock digests, host facts, and pre/post load.
- Run one process tree at a time. Alternate `Kovo, Next, Next, Kovo` or `baseline, spike, spike,
baseline`; never benchmark concurrent worktrees.
- Use `localhost` for both dev-browser entrants so Turbopack HMR has a valid websocket.
- Report median, MAD, p95, sample count, zero/miss/error counts, process-tree peak RSS, and paired
  bootstrap 95% confidence intervals. Retain raw per-sample data outside the active plan.
- Reject wrong status/representation/encoding, missing CSS/bootstrap, null Lighthouse cells,
  transport failures, rate limiting, content mismatch, state loss, or edits that do not land.
- Use the repo's validated `node:http` keep-alive generator for Kovo latency/throughput. Do not use
  autocannon: its prior Kovo latency histogram disagreed with direct measurement by roughly 400x.
- Separate leaf-component, route-entry, data-plane, syntax-error, and recovery edits. Measure browser
  paint and state survival, not only served HTML or DOM presence.
- Compare both default cached traffic and forced-dynamic traffic. For cached traffic measure
  identity, Brotli, and conditional 304 independently.
- Accept a spike only with zero correctness misses and either: (a) at least 10% median improvement
  with paired 95% CI excluding zero; or (b) at least 5% throughput improvement with CI excluding
  zero and no p95 latency/RSS regression over 5%.

## Targets

| Area                         | First milestone               | Competitive target                          |
| ---------------------------- | ----------------------------- | ------------------------------------------- |
| Dev cold ready               | ≥30% better than current Kovo | ≤2x matched Next                            |
| Leaf edit to paint           | miss rate 0; ≥20% better      | ≤2x matched Next; state survives 100%       |
| Entry edit to paint          | miss rate 0; ≥20% better      | ≤3x matched Next; documented reload posture |
| Syntax error / recovery      | p95 ≤1 s / ≤2 s               | no silent or lost revision                  |
| `check --watch` closure edit | ≤5 s                          | ≤2 s, current authenticated target          |
| Production build             | ≤6x Next, RSS ≤2x             | ≤2x Next, RSS ≤1.5x                         |
| Default critical path        | keep ≤7 KB                    | no >5% FCP/LCP regression                   |
| Matched L1 session bytes     | establish baseline            | ≤50% of Next                                |
| Matched L1 mobile navigation | ≤2x Next                      | parity within paired noise                  |
| Cached identity HIT          | establish baseline            | within 10% of Next identity HIT             |
| Proved Brotli cache          | ≥10% over uncached Kovo       | no cross-framework claim without matched br |
| Forced-dynamic throughput    | ≥10% better than current Kovo | within 1.25x of Next dynamic                |

## Phase 0 — make the comparison authoritative

- [x] Bind every browser/perf-gate report to source and dependencies and fail closed on fake wins.
  - Evidence: `c661a9ff5`; `pnpm exec vitest --run benchmarks/harness/report.test.mjs
scripts/perf-gate.test.mjs --reporter=dot` passed 63/63, syntax checks passed, and malformed
    `--components` exits 1.
- [x] Rebuild and measure the current default Kovo/Next fixtures in production posture.
  - Evidence: `node benchmarks/run-all.mjs --apps kovo,nextjs --iterations 3
--lighthouse-runs 3 --bfcache-iterations 3 --port-base 49400`; summary and limits are in
    `reports/perf-comparison-spike-2026-08-13.md`.
- [x] Add a matched L0 fixture: identical server-rendered native controls, full-document navigation,
      no framework client state, and identical content/assets in Kovo and Next.
  - Evidence: `e396f9788`, `39bfcc8a4`; `node benchmarks/matched-fixture-gate.mjs` proved
    content parity and a zero-script/action Kovo L0 document.
- [x] Add a matched L1 fixture: real mutable cart/email/order state and confirmation in both
      frameworks, with Kovo query/state interaction and enhanced navigation actually installed.
  - Evidence: `node benchmarks/matched-fixture-gate.mjs` exercised Kovo's mutable
    cart/email/order state and document-parts navigation; the serialized comparison correctness
    smoke separately exercised both entrants with zero gate errors.
- [x] Add generated equal-shape developer corpora at 24 and 216 modules with the same route count,
      approximate LOC, import fan-out, and leaf/entry/data edits.
  - Evidence: `pnpm exec vitest --run benchmarks/corpora/generate.test.mjs
benchmarks/matched-fixtures.test.mjs --reporter=dot` passed 8/8 for both corpus sizes.
- [x] Implement `benchmarks/compare.mjs` as the single serialized orchestrator for browser, dev,
      build, and server cells; include alternating order, warmups, sample policy, per-cell provenance,
      and paired analysis.
  - Evidence: `5cd4df9cb`; `pnpm exec vitest --run benchmarks/compare.test.mjs
benchmarks/harness/{report,run,scenarios}.test.mjs --reporter=dot` passed 41/41.
- [x] Replace the mixed navigation clock with trace-based destination-paint evidence that uses the
      same observation boundary for document-replacing and same-document paths.
  - Evidence: `55299dcc8`; the same 41-test harness gate covers trace-window validation and refuses
    missing destination paint.
- [x] Record total session bytes through destination paint, separating initial, automatic prefetch,
      click, and post-click transfer so a zero-byte click cannot hide prefetch cost.
  - Evidence: `a6fba38df`; the harness gate covers phase totals and authenticated pre-click bytes.
- [ ] Produce the first clean publishable default and matched baselines with 30 browser samples,
      5 Lighthouse runs per cell, and 10 bfcache traversals.

## Phase 1 — developer loop

- [ ] Ratify current-head dev ready/edit/error/recovery/RSS baselines against matched Next at N=24
      and N=216; use 15 fresh starts and 30 measured edits after three warmups per edit class.
- [x] Run repaired fresh-generation candidate `7a20bf666` (the correctness-complete descendant of
      the exploratory `04a976394` idea) in alternating quiet-host cycles.
  - Evidence: [run `31794370562`, N=24 artifact
    `9218520651`](https://github.com/kovojs/kovo/actions/runs/31794370562/artifacts/9218520651)
    authenticated all four quiet-host B,S,S,B cells, 15 ready samples and 30 edits/class/lane with
    zero misses or state loss. No edit improved 10%; edit RSS regressed 6.80%, so the candidate was
    rejected. N=216 artifact `9218826640` became correctly `unproven` after an atomic-save watcher
    miss; it cannot reverse the complete N=24 rejection. Exact metrics and digests are in
    `docs/performance/dev-generation-spike.md`.
- [x] Profile exact edit-to-paint windows after the matched baseline and rank self time, allocation,
      module evaluation, Vite transform, SSR generation, and asynchronous proof convergence. Retire any
      hypothesis not present in the current top five.
  - Evidence: [run `31799441158`, artifacts `9218931767` and
    `9219104452`](https://github.com/kovojs/kovo/actions/runs/31799441158) authenticated clean
    `89b39c999`, 15 windows and all 30 raw CPU/heap files per corpus with zero misses. Exact stack-v3
    replay (`sha256:50a29441af7bcd9f151029ee0b4f45f039ceb28e716f9d4347ae3e41a9163c2f`)
    ranked async proof convergence first for ordinary edits (52% N=24 and 66% N=216 CPU) and query
    identity resolution first for recovery (75%/68%); Vite transform and SSR generation stayed
    below 1%. Custody and the complete ranking are in `docs/performance/dev-edit-profile.md`.
- [x] Decide the profile-driven dev critical-path candidate at the packed-product boundary for both
      N=24 and N=216, and integrate it only if both reports satisfy the preregistered causal,
      correctness, absolute-latency, and RSS rules.
  - Rejected; do not integrate `336925d40`. [Run
    `31821573222`](https://github.com/kovojs/kovo/actions/runs/31821573222) artifacts
    [`9228112748`](https://github.com/kovojs/kovo/actions/runs/31821573222/artifacts/9228112748)
    and
    [`9230349567`](https://github.com/kovojs/kovo/actions/runs/31821573222/artifacts/9230349567)
    authenticated both packed corpora with zero correctness misses. All causal wins and other
    guardrails passed, but N=216 fresh-ready p95 regressed 5.4069% (155,835.58 → 164,261.47 ms)
    against the 5% limit; full hashes and metrics are in
    `docs/performance/dev-critical-path-spike.md`.
- [x] Decide the sealed ready-neutral refinement that avoided eager initial-compile reuse-fact
      construction and charging on fresh-ready.
  - Rejected before measurement; do not push or integrate `2da4640f1`. Independent review proved
    that a same-file watcher token could reuse and publish a stale imported query identity when a
    dependency notification was delayed or absent. The candidate's own focused test reproduced the
    stale generated `queryNames` crossing the bound generation stage, contrary to SPEC §4.1's
    source-derived, fail-closed identity boundary. Commit/tree/patch custody and the repro are in
    `docs/performance/dev-critical-path-spike.md`.
- [x] Decide a fail-closed async-analysis-only refinement. Retain the profiled ordinary-edit win
      from moving whole-project teaching/proof convergence off the HMR blocking path, but do not
      cache or reuse dependency-sensitive query identities. Run the same full packed-product N=24
      and N=216 contract independently before integration.
  - Rejected; do not integrate `1aea7dd06` → `07d6e5b23` → `1c591eca2`.
    [Run `32191978426`](https://github.com/kovojs/kovo/actions/runs/32191978426) authenticated both
    exact `B,S,S,B` corpora with complete packed-product/correctness evidence. N=24 failed recovery
    causal/2 s p95 and syntax-regression gates; N=216 regressed ready median 49.44% and had 2.476 s
    recovery p95. Artifact custody and exact metrics are in
    `docs/performance/dev-critical-path-spike.md`.
- [x] Spike authenticated in-session closure reuse for `kovo check --watch` by exposing serializable
      producer seams for trust/static/style facts in `build-export.ts`.
  - SPEC §11.4 constraints: always freshly evaluate app modules and rebuild runtime/app objects;
    never retain diagnostics, partial graphs, `LoadedBuildAppModule`, or unauthenticated disk state;
    ambiguity executes the full producer.
  - Evidence: [run `31759466475`, artifact
    `9204437112`](https://github.com/kovojs/kovo/actions/runs/31759466475/artifacts/9204437112)
    completed 30 clean B,S,S,B edits/arm with zero misses; config/style facts reused only with exact
    digests while static trust, app evaluation, graph construction, and diagnostics stayed fresh.
- [x] Spike a TypeScript semantic `BuilderProgram` plus changed-file/reverse-dependent analysis for
      the watch session, with exact source/config/package/version digests in every reused fact.
  - Evidence: the same authenticated report measured 11,605.65 to 9,390.72 ms median (19.08%) with
    paired 95% CI `[19.05%, 20.83%]`; TypeScript was `reused-authenticated` in 30/30 candidate edits.
    The disclosed median RSS increase was 15.72%; details are in
    `docs/performance/check-watch-reuse-decision.md`.
- [x] Measure packed CLI versus source-checkout CLI startup. If packed users are already fast, treat
      source transformation/prebuilt CLI work as maintainer performance rather than product DevEx.
  - Evidence: [run `31753246698`, artifact
    `9201780300`](https://github.com/kovojs/kovo/actions/runs/31753246698/artifacts/9201780300):
    15 samples/lane plus three warmups, packed median/p95 46.57/58.40 ms versus source
    114.20/124.26 ms; packed p95 passed the preregistered 1,000 ms product ceiling.
- [ ] Add browser-visible dev budgets for leaf/entry edit-to-paint, diagnostic, recovery, miss rate,
      state preservation, ready time, and process-tree RSS at both workload sizes.

## Phase 2 — check and production build

- [ ] Establish 10-sample clean, unchanged, and one-line-edit build baselines on equal-shape N=24
      and N=216 corpora, with phase census, artifact bytes, and peak process-tree RSS.
- [x] Carry the complete source-check phase census into paired build reports and account for the
      currently unattributed CLI/startup tail before changing implementation.
  - Evidence: `f73738975`; `scripts/perf-build-benchmark.mjs` validates the exact source/worker
    phase sequence and derives the CLI residual from the authenticated wall-time envelope.
- [x] Remove duplicated one-shot work only when the source-proof and deploy-proof boundaries remain
      explicit (SPEC §5.2 rule 9); preserve sequential heap isolation between analyzer phases.
  - Evidence: `f73738975`; focused build/finalization, server build, packed-preset, and phase-census
    tests passed and retain separate source-proof/deploy-proof workers with sequential boundaries.
- [x] Decide the profile-driven lexical source-trust candidate from clean packed Kovo builds at
      N=24 and N=216, and integrate it only if both reports satisfy the preregistered wall, p95, RSS,
      artifact-identity, and correctness rules.
  - Evidence: [run `31821610014`](https://github.com/kovojs/kovo/actions/runs/31821610014) artifacts
    [`9228047402`](https://github.com/kovojs/kovo/actions/runs/31821610014/artifacts/9228047402)
    and
    [`9229624306`](https://github.com/kovojs/kovo/actions/runs/31821610014/artifacts/9229624306)
    authenticated 10 samples/arm with exact artifacts and accepted both corpora: N=216 wall median
    improved 23.797% with paired 95% CI `[61,552.30, 68,376.15]` ms; N=24 improved 0.963% and all
    p95/RSS guardrails passed. Integrated commit `135645d71` has sealed stable patch ID `c8be354…`;
    full custody and hashes are in `docs/performance/build-source-trust-spike.md`.
- [ ] Design a persistent foreground build/watch session if warm cross-invocation reuse is still
      required. Do not reintroduce the retired unauthenticated on-disk compiler cache.
- [ ] Gate build wall, p95, RSS, and artifact size on the realistic corpus; reach the first milestone
      before attempting the competitive target.

## Phase 3 — production runtime

- [x] Highest priority: authenticate and reproduce the constant-module canonicalization/SHA-256
      memoization candidate from its originating profile, raw report, throwaway worktree, and exact
      commit. Decide it only from clean committed baseline/candidate worktrees in serialized
      `baseline, spike, spike, baseline` order on forced-dynamic listing/detail routes at
      c={1,8,32}; retain throughput, p50/p95/p99, CPU, peak RSS, byte-equivalence, and before/after
      CPU profiles, and apply the plan's declared acceptance rule.
  - Evidence: [run `31754297930`, artifact
    `9203129430`](https://github.com/kovojs/kovo/actions/runs/31754297930/artifacts/9203129430)
    authenticated `3010e8df3…d87b4a132`, 84 windows/42 B,S,S,B pairs and four profiles; zero
    misses, +29.08% median throughput with paired 95% CI `[+26.07%, +30.23%]`, all p95 cells
    improved, byte-identical bodies, and loader profile share fell from 14.89%/21.57% to 0.02%.
- [ ] Freeze and run the current matched L0/L1 browser matrix before any further navigation or
      runtime-emission change. Preserve inert documents at zero JS; the deterministic spike found
      the ordinary deferred runtime at 49,236 B Brotli and the enhanced-navigation closure alone at
      22,642 B Brotli.
  - Evidence: `node benchmarks/matched-fixture-gate.mjs` passed before runtime candidates were
    integrated and proved the matched L0 document carries zero script/action capability.
- [ ] Profile matched L1 mobile navigation from click through destination paint. Attribute server,
      transfer, the trace-observable combined response-processing/DOM-apply envelope,
      style/layout, and paint; keep JS-internal decode/build and morph boundaries explicitly
      unsupported unless both entrants gain equivalent instrumentation.
  - Evidence: `55299dcc8`; the trace schema reports server, transfer, combined response
    processing/DOM apply, style/layout, and destination paint with one boundary and rejects invented
    JS-internal phase splits.
- [x] Revisit opt-in Speculation Rules only after repairing the rejected spike's compiler/runtime
      pattern disagreement and fail-open page indirection. `spec/07-navigation.md` default-off remains
      normative until a SPEC change is reviewed; never merge the historical branch as-is.
  - Evidence: `3aba43d7d`, `1d93b92bf` fail closed on unproved moderate prefetch, including route-access
    precedence; authenticated B,S,S,B evidence in
    `docs/performance/speculation-rules-repair-and-decision.md` rejected opt-in because desktop's
    +1.51% CI crossed zero and mobile regressed 7.61% with CI excluding zero. Default-off remains.
- [x] Implement a switchable compressed proved-document cache spike with a module-private witness
      carrying build token and body digest, bounded `{token,digest,encoding}` entries, and single-flight
      compression across live Node and emitted Node/Vercel adapters.
  - Required floors: public ETags cannot mint identity; cookie/authorization/Set-Cookie/
    Clear-Site-Data/private/no-store/no-transform/HEAD/304 bypass; `Kovo-Pad` is fresh on every hit;
    build changes and eviction cannot substitute bodies.
  - Evidence: `f2da7687e`; `pnpm exec vitest --run scripts/perf-compressed-cache-ab.test.mjs
scripts/perf-server-benchmark.test.mjs packages/server/src/build-compressed-document-cache.test.ts
packages/server/src/node.test.ts --reporter=dot` passed 88/88 and covers private authority,
    exact identity, bypass floors, single-flight, LRU bounds, and disable-only parity.
- [x] Measure the compressed-cache spike in seven alternating 15-second samples after 5-second
      warmups at c={1,8,32}, routes={listing,detail}, encodings={identity,br}, and modes={HIT,304,dynamic};
      report req/s, p50/p95/p99, CPU, and RSS with the validated repo generator.
  - Evidence: [run `31751766130`, artifact
    `9205286040`](https://github.com/kovojs/kovo/actions/runs/31751766130/artifacts/9205286040)
    authenticated 504/504 clean B,S,S,B windows and accepted criterion A at +48.84% median
    throughput, paired 95% CI `[46.86%, 51.39%]`; full cells and custody are in
    `docs/performance-compressed-cache-ab.md`.
- [x] Measure per-route stylesheet splitting on the matched multi-route fixtures; implement only if
      it saves at least 10% route critical-path bytes without duplicating enough shared CSS to regress
      total session bytes.
  - Evidence: `402b0138b`; authenticated counterfactual rejected splitting: listing/detail Brotli
    regressed 2.83%/1.60% and the full session regressed 24.62%, so production remains unsplit.
- [x] Profile current forced-dynamic SSR before proposing hot-path work. The 2026-08-08 profile
      refuted JSX lowering, HKDF/HMAC, request proxy, head serialization, CSP rescan, and the claimed
      38% `Reflect.apply` opportunity; do not revive them without current contradictory evidence.
  - Evidence: [run `31753234275`, artifact
    `9201789476`](https://github.com/kovojs/kovo/actions/runs/31753234275/artifacts/9201789476):
    clean 15-second c=32 profile attributed 52.74% to generated server work and 22.23% to form
    property snapshotting; all five retired hypotheses remained outside the current top five.

## Phase 4 — continuous budgets and publication

- [x] Run deterministic bytes and a short correctness smoke per PR; schedule N=216 check scaling,
      matched dev edits, browser cells, builds, and throughput on a quiet pinned nightly runner.
  - Evidence: `faf00c5de`; `pnpm exec vitest --run scripts/perf-ci-policy.test.mjs
--reporter=dot` passed and proves PR smoke plus labeled/scheduled realistic matrices.
- [ ] Authenticate one exact-final-source `Production bytes` job and its one-member
      `kovo-perf-bytes` artifact as a required publication sidecar. Re-evaluate the exact five
      deterministic metrics against the measured commit's `perf-budgets.json`; publication must
      block on any failed byte budget and remain unproven on missing, malformed, dirty,
      source-unstable, wrong-lock, wrong-workload, or wrong-producer evidence. This is not an eighth
      statistically ratified family.
- [ ] Store raw reports as CI artifacts and commit only a clean reviewed baseline summary. A dirty,
      null, load-shed, wrong-posture, or integrity-failed run cannot update budgets.
- [ ] Ratify budgets from at least five independent baseline runs in one exact normalized
      per-family hosted-runner/workload cohort using median, MAD, p95, and the acceptance rules
      above; replace the rationale-only arrays for the realistic seven-family tier with the 21
      linked derived baseline, budget, and holdout-evaluation documents. The separate deterministic
      `perf-budgets.json` tier remains authoritative for the five exact production-byte gates and is
      linked through the required publication sidecar above.
- [x] Add a regression comparator that requires matching source/lock/workload identities and reports
      `unproven` rather than pass when load, sample count, or identity is outside policy.
  - Evidence: `faf00c5de`, `49f83a2a9`, `3aabc77ae`; comparator/ratifier tests passed 26/26 and
    reject dirty, short, busy, duplicate-execution, or identity-mismatched evidence.
- [ ] Publish Kovo-vs-Next claims only after both default and capability-matched first-milestone
      gates pass; keep stronger competitive follow-on misses literal and separately reported rather
      than relabeling them as completion failures or wins. Describe architectural differences beside
      the numbers and link the exact report and fixture sources.

## Standing constraints

- Security and stale-UI proof outrank performance. Technical preview means choosing the cleaner,
  stronger invariant instead of compatibility modes.
- Dev proves per commit, not per keystroke; whole-project analysis stays off HMR's blocking path and
  every dev response remains `Kovo-Dev-Posture: dev-unproven` (SPEC §9.5.1).
- `check` and `build` derive current-source proof synchronously and fail closed (SPEC §5.2 rule 9).
- No unauthenticated on-disk compiler/security cache, concurrent memory-heavy analyzer phases,
  process-global ts-morph project memo, or hand-authored lowered IR.
- Documents stay buffered unless SPEC's post-render status/header invariants are separately proved.
- The structured document-parts protocol and Trusted Types floor remain; no parser/policy shortcut.
- Client runtime remains capability-gated. A universal navigation runtime that makes inert pages
  heavier is not an acceptable way to win one navigation row.

## Latest verification

- `pnpm exec vitest --run benchmarks/harness/report.test.mjs scripts/perf-gate.test.mjs
--reporter=dot` — 63 passed.
- `node --check benchmarks/run-all.mjs && node --check scripts/perf-gate.mjs && node --check
scripts/lib/perf-provenance.mjs` — passed.
- `node scripts/perf-gate.mjs --evaluate /tmp/kovo-perf-bytes-20260813.json` — 5/5 byte gates passed.
- `pnpm exec vitest --run benchmarks/compare.test.mjs benchmarks/harness/{report,run,scenarios}.test.mjs
scripts/perf-{baseline-ratify,regression-check,ci-policy}.test.mjs --reporter=dot` — 67 passed.
- `pnpm exec vitest --run packages/server/src/{mutation-wire,vite-dev,vite-hmr-client-security,
vite-dev-intrinsics,vite-dev-middleware,vite}.test.ts --reporter=dot` — 102 passed; generated-app
  replay without `KOVO_LIVE_TARGET_SECRET` returned HMR 200 and preserved component/navigation state.
- Browser run integrity: zero page errors, zero rate limits, zero null Lighthouse samples, and HTTP
  statuses observed for every probe; two browser-originated favicon 404s were separately disclosed.

# Incremental Compiler (Fast Compilation Cache)

Created 2026-06-18. `SPEC.md` §5 is the normative source of truth for compiler behavior.

Make the Kovo compiler fast — especially for **incremental** recompilation. Build the internal
equivalent of TypeScript's `.tsbuildinfo`: a content-addressed, persistent cache so that an edit to
one component recompiles only that component (plus its true cross-module dependents), and a clean
checkout / CI run / test run warm-starts instead of recompiling every module from scratch.

## Sequencing

**Sequenced after [`no-checked-in-generated.md`](./no-checked-in-generated.md).** That plan deletes
the committed lowered IR and makes compile-on-the-fly the _only_ path in dev, build, **and the test
pipeline** (its Phase 1 wires the Kovo plugin into vitest/browser). Once no checkout ships
prebuilt IR, every dev boot, `vp test`, browser run, and CI job pays full compilation cost on cold
state. That is exactly what makes a persistent incremental cache load-bearing rather than a nicety:
this plan is the performance backstop for the "always compile from authored source" model. It
depends on that plan's compile-on-the-fly harness (the per-module `compileComponentModule` call
site in `packages/compiler/src/vite.ts:178` and the temp-emit helper) already being the single
funnel for lowering.

Relates to `plans/devtools.md` (HMR impact classification + `factHash` reuse) and the existing
`compiler-perf` gate (`tests/compiler-perf.test.ts`, `tests/compiler-perf.budgets.json`).

## Current state (audited 2026-06-18)

- **No caching anywhere in the compiler.** `compileComponentModule`
  (`packages/compiler/src/compile.ts:78`) re-runs `parseComponentModuleModel` (→ `ts.createSourceFile`)
  and the full lowering pass stack on every call. Each `*.ts` analysis module
  (`compile.ts`, `internal-graph.ts:389`, `mutation-inputs.ts:23`, `route-pages.ts:50`,
  `style.ts` ×5) calls `ts.createSourceFile` independently — **no shared `ts.Program`, no reused
  typechecker, no `SourceFile` reuse** across modules in one app.
- **The Vite `transform` hook recompiles unconditionally** (`packages/compiler/src/vite.ts:178-198`).
  The only stateful thing it keeps is `hmrImpacts`/`clientModules` maps; `factHash`
  (`vite.ts:123-125,315-317`) feeds **HMR impact classification only** (did a structural fact
  change → component-refresh vs full-reload), never work-skipping.
- **Whole-program graph is a cheap merge.** `deriveAppGraph` (`internal-graph.ts:37`) folds
  per-component `componentGraphFacts` + route facts into `RegistryGraphInput` → `RegistryFacts`.
  The expensive tier is per-module lowering; aggregation is cheap. This two-tier shape is the
  lever: cache the per-module tier, keep the merge cheap and incremental.
- **Cross-module inputs that affect a module's lowering** are already explicit `CompileComponentOptions`
  fields: `packageComponentPrefixes`, `registryFacts`/`previousRegistryFacts`, `queryShapeFacts`,
  `queryShapes` (`packages/compiler/src/types.ts:17-22`), plus mutation-input facts
  (`mutation-inputs.ts`). So per-module output is **not** a pure function of source alone — it is
  `f(source, relevant-slice-of-cross-module-facts, compiler-version)`. This is the crux the cache
  key must capture (TS solves the analogue with per-file referenced-file signatures).
- **A stable-hash kit already exists** — `hmr-impact.ts` computes `factHash` over a
  `canonicalJson()` (stable key ordering) and per-aspect sub-hashes (`queryUpdatePlanHash`,
  `liveTargetFactsHash`, `stylesheetAssetsHash`, `renderOutputHash`) for HMR classification, and
  `clientModuleVersion()` (FNV-1a, `handlers.ts:161`) versions client URLs. These are the
  fingerprint primitives to reuse for cache keys rather than inventing a parallel hasher.
- **Dev load compiles each file twice** (Vite `transform` + `handleHotUpdate`, `vite.ts:178,199`)
  and `CompileResult` carries **no** dependency/footprint field today — both addressed below.
- **A perf harness already exists** but proves nothing about incrementality: `compiler-perf`
  (`vite.config.ts:66`) runs `tests/compiler-perf.test.ts` against `compiler-perf.budgets.json`
  (6 corpora, 125 files, `total.coldMaxMs: 2750` / `warmMaxMs: 2700`). **Warm ≈ cold** — "warm" is
  only JIT-warmed, there is no cache, so the budgets can't distinguish a cache hit from a recompile.
- **Outer task cache exists, coarse.** `vp`'s `run.cache.tasks` (`vite.config.ts:31-35`) content-
  hashes task `input` globs and skips whole tasks. That is make-level (all-or-nothing per task);
  it does not make a _single edit within_ a task incremental. This plan adds the fine-grained tier
  beneath it.

## End State

- Editing one component in dev recompiles **only** that module and its real cross-module dependents;
  unchanged modules return cached `CompileResult`s. Measured cache-hit rate is asserted in CI.
- A persistent on-disk cache (the `.tsbuildinfo` equivalent) survives process restarts: a second
  `vp test` / `kovo build` / CI job on unchanged source is a near-total cache hit.
- Warm budgets in `compiler-perf.budgets.json` drop **substantially** below cold (the gap _is_ the
  incremental win), and a new single-edit corpus proves O(changed) not O(total) recompile cost.
- **Cache transparency gate:** compiling with the cache enabled is byte-identical to compiling with
  it disabled, on every corpus — the cache can never alter semantics, only latency.
- The cache key is versioned by compiler build identity, so any compiler change busts the cache
  globally and stale poisoning is impossible.

## Scope / Non-Goals

- **In scope:** an internal compile cache for `compileComponentModule` and the whole-program
  graph/registry derivation, its key/fingerprint design, in-memory + on-disk persistence,
  cross-module dependency tracking for correct invalidation, integration at the Vite/test/CLI call
  sites, and perf+correctness gates.
- **Out of scope (call out, don't touch):**
  - The wire/output format. SPEC §5.2 #1 forbids hashed _names_ in emitted artifacts; this cache is
    **internal build state**, never shipped, so content-addressing it does not conflict with #1.
    Emitted module URLs keep their existing cache-busting query hashes unchanged.
  - Fixpoint / render-equivalence _semantics_ (§5.2 #3). The cache must preserve them, not redefine
    them; those gates remain the behavioral source of truth.
  - The coarse `vp` task cache and CI job graph — coordinated with (Phase 5), not replaced.
  - Authoritative invalidation-graph derivation (`plans/authoritative-invalidation-graph.md`) — that
    changes _what_ facts exist; this plan caches _whichever_ facts the pipeline produces.

## Design (load-bearing decisions)

- **Two-tier cache mirroring the pipeline.** (1) Per-module `CompileResult` cache — the big win.
  (2) Whole-program graph/registry cache with incremental re-merge. Both content-addressed.
- **The per-module cache key is a fingerprint, not just a source hash.** It must include:
  `hash(source)` + a `hash(consumed cross-module facts slice)` + `compilerBuildId`. To get the
  facts slice right, record per module **which** external facts it actually read during lowering
  (package prefixes it resolved against, mutation inputs it referenced, registry facts it consumed).
  Store that dependency footprint with the cache entry. On the next compile, recompute only the
  footprint hash; a hit means none of _this module's_ real dependencies changed. This is the
  `.tsbuildinfo` "referenced-file signatures" idea, adapted to fact-slices instead of files.
- **Determinism is a prerequisite, and largely already holds.** §5.2 #3's byte-stable IR / fixpoint
  property means `compileComponentModule` is intended to be a deterministic pure function of its
  declared inputs. Content-addressed caching _requires_ that. Phase 0 audits and closes any
  nondeterminism (map/Set iteration order, `Date`/timestamps, absolute-path or cwd leakage into
  output, ambient env) so identical inputs always yield identical bytes; `canonicalJson()` already
  proves the team can serialize facts stably.
- **Fold the two dev-load compiles into one.** The `transform`/`handleHotUpdate` double-compile is
  a cheap early win once a per-module cache exists: the second pass becomes a cache hit.
- **On-disk layout:** a gitignored `.kovo/cache/` (or under the OS cache dir for shared CI) holding
  a manifest (`cacheKey → { artifacts, footprint, compilerBuildId }`) plus content-addressed
  artifact blobs. Atomic writes, version-prefixed so a format/compiler bump is a clean miss, and a
  prune policy (LRU / size cap). Concurrency-safe for parallel test workers / parallel Vite builds.
- **Invalidation correctness > hit rate.** A wrong hit ships stale lowered IR — strictly worse than
  a slow build. Every phase pairs the speedup with the transparency gate (cache-on ≡ cache-off).

## Phase 0 — Determinism + sequencing prerequisites

- [x] Confirm `no-checked-in-generated.md` Phase 1 (compile-on-the-fly harness + temp-emit helper)
      has landed; this plan layers caching onto that single funnel. Record the dependency in both
      ledgers.
  - Evidence 2026-06-19:
    `plans/no-checked-in-generated.md` Phase 1 records the Vite/test compile-on-the-fly harness,
    `scripts/commerce-graph.mjs` temp graph helper, and non-Vite temp emit flow as landed; this
    ledger now points Phase 1 cache wrapping at those same Vite, fixture-test, and CLI/temp compile
    funnels.
- [x] Determinism audit of `compileComponentModule` output: enumerate every nondeterminism source
      (iteration order over `Map`/`Set`/object keys in `internal-graph.ts`, `registry.ts`, `css.ts`,
      `style.ts`; any `Date`/clock; absolute path / `process.cwd()` leakage into emitted source or
      registry facts; env-dependent branches). Fix each so output is a pure function of declared
      inputs.
  - Evidence 2026-06-19:
    `rg -n "Date\\(|Date\\.now|Math\\.random|randomUUID|process\\.cwd\\(|Object\\.keys|Object\\.entries|\\.values\\(\\)|new Map|new Set" packages/compiler/src -g '!*.test.ts' -g '!*.test.tsx' -g '!gallery-merge-fixtures-oracle.tsx' -S`
    audited source-order and object/key iteration, clock/random, and cwd-sensitive sites; the
    output-sensitive paths either sort, preserve declared input/source order, or use explicit
    compile roots. `corepack pnpm exec vitest --run tests/compiler-determinism.test.ts` proves two
    fresh processes emit byte-identical `files[]`, graph/fact arrays, CSS assets, and input
    `registryFacts` signatures for all 125 perf-corpus files.
- [x] Define `compilerBuildId` — a stable identity for the compiler+deps that, when changed, must
      bust every cache entry (package version + a content hash of `packages/compiler/dist` or the
      source tree in dev). Single exported helper consumed by the key builder.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/cache-identity.test.ts` proves
    `compilerBuildId()` canonicalizes source fingerprint ordering and changes
    when a compiler source fingerprint changes.

## Phase 1 — In-memory per-module cache (single process)

- [x] Introduce a `CompileCache` abstraction in `@kovojs/compiler` keyed by `hash(source)` +
      `hash(cross-module facts passed in)` + `compilerBuildId`, storing `CompileResult`. Start with
      the _whole_ passed-in fact set in the key (over-invalidates but always correct); Phase 2
      narrows it to the per-module footprint.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/compile-cache.test.ts packages/compiler/src/vite.test.ts -t "CompileCache|caches repeated transforms by source hash and compile context|includes every declared component compile input"`
    proves the internal `CompileCache` dedupes work, keys by source and declared
    component compile inputs (`registryFacts`, query-shape inputs, package prefixes,
    root, provenance), and preserves Vite repeated-transform cache behavior.
- [x] Wrap the Vite `transform`/client-module hot path so `compileViteComponentModule`
      consults `CompileCache` before calling `compileComponentModule`.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/compile-cache.test.ts packages/compiler/src/vite.test.ts packages/compiler/src/cache-identity.test.ts -t "CompileCache|caches repeated transforms by source hash and compile context|compilerBuildId"`
    proves repeated Vite transforms use the shared `CompileCache` and preserve
    existing client-module behavior.
- [x] Wrap the test-pipeline plugin call site and the temp-emit helper from the
      predecessor plan with the same `CompileCache` abstraction.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/test/src/integration/fixture-compiler-plugin.test.ts`
    proves the test-pipeline fixture plugin reuses `CompileCache`; `corepack pnpm exec vitest --run packages/cli/src/index.kovo-compile.test.ts packages/cli/src/index.compile-mcp.test.ts -t "compile/v1|writes and checks component artifacts|writes component client files|passes query-shape"`
    proves the CLI/MCP component temp-emit facade remains correct through the shared cache wrapper;
    `corepack pnpm exec tsc --noEmit --pretty false` proves the new internal cache helper is valid
    across package boundaries.
- [x] Add a process-lifetime cache in the Vite plugin closure (alongside `clientModules`/`hmrImpacts`)
      so repeated imports of the same module within one dev session / test run never recompile.
  - Evidence 2026-06-19:
    `npx vitest --run packages/compiler/src/vite.test.ts packages/compiler/src/cache-identity.test.ts -t "caches repeated transforms by source hash and compile context|compilerBuildId"`
    proves repeated Vite transforms hit the in-process cache, source changes
    miss, and the cache key namespace includes the stable compiler build id.

## Phase 2 — Cross-module dependency tracking (correctness core)

- [x] Make `compileComponentModule` return an internal dependency footprint on `CompileResult`.
      Start conservatively with the whole declared cross-module input set so cache invalidation is
      correct before it is precise.
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run packages/compiler/src/compile-component.test.ts -t "dependency footprint|emits one server file"`
    proves `CompileResult.dependencyFootprint` records effective package prefixes, registry facts,
    previous registry facts, query-shape inputs, and compile roots; `corepack pnpm exec vitest --run tests/compiler-determinism.test.ts`
    proves the new internal field remains byte-stable across two fresh processes.
- [ ] Narrow `CompileResult.dependencyFootprint` from the whole declared fact set to the
      cross-module facts actually consumed (which package prefixes resolved, which mutation inputs
      referenced, which registry facts read). This is the per-file "referenced signatures" of the
      `.tsbuildinfo` analogue.
- [ ] Narrow the Phase 1 key from "all facts" to `hash(footprint slice)`, so a change to an
      unrelated module's facts does not invalidate this module.
- [ ] Build the inverse index (fact → dependent modules) so when the whole-program graph changes,
      only modules whose footprint touched the changed facts are recompiled.
  - Evidence target: edit module A's mutation input; assert only A and the modules whose footprint
    referenced that mutation recompile, while a structurally-unrelated module B is a cache hit
    (compile-count assertion).
- [x] **Transparency gate:** a test compiling each perf corpus with cache enabled vs a fresh
      cache-disabled run asserts byte-identical artifacts — including after a targeted single-module
      edit (the incremental path must equal the from-scratch path).
  - Evidence 2026-06-19:
    `corepack pnpm exec vitest --run tests/compiler-cache-transparency.test.ts` compiles all 125
    perf-corpus files directly and through `CompileCache`, then repeats after editing one component
    source, and asserts byte-identical emitted files/facts/signatures.

## Phase 3 — Persistent on-disk cache (the `.tsbuildinfo` equivalent)

- [ ] Define the on-disk format: a versioned manifest (`cacheKey → { artifactRefs, footprint,
compilerBuildId }`) + content-addressed artifact blobs under a gitignored `.kovo/cache/`.
      Atomic write (temp + rename), format-version prefix, corruption-tolerant (a bad/partial entry
      is a miss, never a crash).
- [ ] Persistence round-trip in Vite + CLI: warm-load the manifest at startup, write back new
      entries, so a _second_ process on unchanged source hits disk instead of recompiling.
- [ ] Concurrency safety for parallel vitest workers and parallel builds (per-entry atomic writes;
      no global lock that serializes compilation). Prune policy (size/LRU cap) so the cache can't
      grow unbounded.
- [ ] Add `**/.kovo/cache/` to `.gitignore`; confirm it is never an `input`/`output` of a `vp` task
      in a way that would re-trigger tasks (Phase 5 wires it deliberately).
  - Evidence target: run the perf corpus in one process (cold), exit, run again in a fresh process
    (warm-from-disk) — second run is a near-total cache hit and lands well under cold budget.

## Phase 4 — Incremental whole-program graph

- [ ] Make `deriveAppGraph` incremental: cache the merged `RegistryGraphInput`/`RegistryFacts`
      keyed by the multiset of contributing per-module fact hashes, and re-merge only the changed
      contributions instead of rebuilding from all components each edit.
- [ ] Diff registry facts across rebuilds and feed the diff into Phase 2's inverse index so a graph
      change recompiles exactly the dependent modules (closing the loop: per-module edit → fact
      change → graph re-merge → targeted dependent recompile).
- [ ] Reuse / unify with the existing `factHash` HMR machinery (`vite.ts:123-125`) where it already
      computes a structural fact hash, so HMR impact classification and cache invalidation share one
      fingerprint source of truth rather than two drifting hashes.

## Phase 5 — CLI incremental build + CI cache integration

- [ ] `kovo build`/`compile`/`emit` (`packages/cli/src/index.ts:101,145`) use the persistent cache so
      repeated builds are incremental; a `--no-cache` / clean flag forces a cold build for the
      transparency gate and debugging.
- [ ] Coordinate with the `vp` task cache (`vite.config.ts:31`): the fine-grained module cache lives
      _beneath_ the coarse task cache. Ensure task `input` lists for compile-driven tasks
      (`build`, `compiler-perf`, example builds) stay correct now that lowering reads `.kovo/cache`
      rather than committed IR (ties into `no-checked-in-generated.md` Phase "CI cache churn" risk).
- [ ] `.github/workflows/`: cache `.kovo/cache` across CI runs keyed by `compilerBuildId` + source,
      so CI warm-starts. Confirm a cache miss (compiler change) cleanly rebuilds.

## Phase 6 — Perf budgets + gates

- [ ] Extend `compiler-perf.budgets.json` so `warm` reflects a real cache hit: separate `cold`
      (cache cleared) from `warm` (cache primed) runs and drop warm budgets to the cached floor.
      The cold/warm gap becomes the asserted incremental win.
- [ ] Add an **incremental-edit** corpus/scenario: prime the cache over N files, edit 1, recompile —
      assert wall-time and compile-count are O(1+dependents), not O(N).
- [ ] Keep the transparency gate (Phase 2) in CI as a standing correctness check, plus a cache-hit-
      rate assertion on the warm run.
- [ ] Confirm fixpoint + render-equivalence gates (§5.2 #3, `scripts/prod-emit-check.mjs`) still pass
      with the cache enabled — the cache must be invisible to them.

## Risks / Open Questions

- **Footprint completeness (the staleness hazard).** If a module consumes a cross-module fact that
  Phase 2 fails to record in its footprint, a real dependency change yields a wrong cache hit →
  stale IR. Mitigation: derive the footprint at the same site facts are _consumed_ (not a hand-kept
  list), and let the transparency gate (cache-on ≡ cache-off after edits) catch any gap. Highest-risk
  item; treat an over-broad footprint (extra recompiles) as acceptable, an under-broad one as a bug.
- **Determinism regressions.** New compiler passes can reintroduce nondeterminism and silently lower
  the hit rate or (worse) make cache-on ≠ cache-off. Keep the two-process byte-identity test
  (Phase 0) as a standing gate so any nondeterminism fails loud.
- **Interaction with `authoritative-invalidation-graph.md`.** That plan makes the compiler populate
  `inferredTouches` / derive query `reads` from the Drizzle AST — new cross-module facts. The
  footprint model must already track them as dependencies, or it ships stale invalidation graphs.
  Sequence the cache's fact-tracking to be fact-agnostic (track whatever facts flow), so it absorbs
  that plan without rework.
- **On-disk cache portability/poisoning.** A blob from a different compiler/platform must never be
  used; `compilerBuildId` in the key plus a format-version prefix must make cross-version reuse a
  clean miss. Validate with a forced `compilerBuildId` bump → full miss test.
- **Concurrency.** Parallel vitest workers and parallel Vite builds write the same cache; design for
  lock-free per-entry atomic writes. A botched lock could serialize compilation and _regress_ perf.

## Latest verification

None yet — this ledger is the design + scoping pass; it sequences after `no-checked-in-generated.md`.
Proving commands to add per slice: `vitest --run tests/compiler-perf.test.ts` (cold/warm + incremental
corpus), the new two-process determinism + cache-transparency tests, `node scripts/prod-emit-check.mjs`
(fixpoint/render-equivalence unaffected), and a `vp run build` / `vp test` warm-vs-cold timing on a
clean worktree before flipping any budget checkbox.

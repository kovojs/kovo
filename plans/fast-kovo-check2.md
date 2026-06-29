# Plan: Make `kovo check` / `kovo build` fast (round 2)

Status: **#1, #2, #5, #6 implemented & verified; #3/#4/#7 deliberately deferred (see below)**
Owner: perf
Last verified: 2026-06-28 (after the first `fast-check` round merged: shared drizzle
project, static-analysis cache, query-shape worker parallelism)

## Implementation status (2026-06-28)

Implemented and merged this round: **#1, #2, #5, #6**. Net result: warm `kovo build` on
`examples/commerce` went from ~14.2s to **~2.6s** with **byte-identical** KV414+3×KV407
diagnostics, `kovo mcp` still serves, and the drizzle suite stays 614/614.

- **#3 (tsgo):** out of scope for this round (explicitly excluded by request).
- **#4 (root-cause handle disposal):** deferred by decision — #1's clean exit already
  captures the teardown win, so #4 adds ~0 CLI speedup; its only value is long-lived hosts,
  and the leak is the app's own PGlite handle, which the framework cannot dispose soundly
  without a new app-facing contract. Left open as a future robustness item.
- **#7 (in-process TS load hook):** deferred by decision — saves ~0.3s only in the monorepo
  dev CLI; published `@kovojs/cli` already ships a `.mjs` bin that never respawns, so real
  users pay zero. Left open as a dev-ergonomics item.

## Spike-round wins (2026-06-29)

A follow-up spike round (`fast-check-spikes`) measured four additional ideas; three were
adopted and implemented here. The headline #1 hypothesis (skip vite dep pre-optimization)
was **dropped** — there is no ~14s vite dep-optimize; the cold cost is a **duplicated drizzle
analysis**, which the spike surfaced instead. "Consolidate 3 vite servers" was also **dropped**
(the commerce build runs exactly one `createServer`; premise false).

- [x] **A. Dedup the duplicated build-time drizzle analysis.** The `@kovojs/server` vite plugin
      re-ran the whole-project drizzle data-plane analysis (to build the runtime registry +
      query-shape facts) when the CLI spun up a throwaway dev server _just to load app source for
      graph derivation_ — the SAME ts-morph analysis the CLI runs authoritatively in
      `runKovoBuildCheckPreflight`. Gated `collectDataPlaneAnalysis` behind `KOVO_BUILD_GRAPH_DERIVATION`
      (set by the CLI only around the graph/css load span; cleared for the production build passes so
      their fail-closed gate still fires). `packages/server/src/vite.ts` + `packages/cli/src/commands/build-export.ts`.
  - Verified: instrumentation shows the redundant 14-file analysis no longer runs (only the CLI's
    authoritative pass); **cold `kovo build` on commerce ~19s → ~10.6s (~44%)**; byte-identical KV
    diagnostics; the starter production-build-graph-gate test passes (passing app still emits a
    correct runtime registry, rebuilt by the flag-cleared build passes).

- [x] **B. Make the build caches portable (CI cache restore).** Relativized cache keys so a
      restored cache hits across checkout roots: static-analysis cache file paths + analyzer
      fingerprint (`build-export.ts`), and `fileName`/`root`/`packagePrefixDiscoveryRoot` in
      `compile-cache.ts` (`compilerBuildId` is version-based, so re-keying can't mis-hit old entries).
      Added an `actions/cache` step for `.kovo/cache` to the scaffolded starter CI.
  - Verified: cross-path restore test — build in worktree A, restore `.kovo` into worktree B at a
    **different absolute path**, rebuild → **cache HIT** (static 1→1, compiler 3→3, zero new
    entries; previously a full miss). compile-cache tests 7/7; diagnostics identical.

- [x] **C. Run the scaffolded `check` pipeline concurrently.** Shipped a cross-platform
      `scripts/check-parallel.mjs` in the starter; `check` runs `vp check` ‖ `check:sound-subset` ‖
      (`build:prod` → `check:endpoint-posture`) — the last two share `.kovo/cache` so they stay a
      sequential lane (the compiler manifest is read-modify-write, not atomic).
  - Verified: warm pipeline **~7.7s → ~6.1s (~20%** in-env; floored by the serial build lane);
    fail-closed proven (injected type error AND sound-subset violation both exit non-zero);
    create-kovo tests 21/21.

- [ ] **B-followup. Persistent compiler-cache value blobs** still contain one absolute path (in a
      stored result value, not the key — cross-path HIT confirmed unaffected). Cosmetic; not
      portability-blocking. Left as a minor follow-up.

Note: every failing test seen during integration (5 cli build-CSS + 1 ui keyframes + 4 server
route-jsx/live-target query tests) is **pre-existing on the base** (confirmed on a clean
`314f46981` worktree), not introduced by this round.

## TL;DR — why it's slow now

It is **no longer** the drizzle security analysis (warm it is a content-hash cache hit,
~7ms) and **not** the production bundle (already skipped whenever an earlier gate fails).
On the current code the warm `kovo build` cost is, in order:

1. **~75% is post-result event-loop teardown drain** — after the command result is
   computed, Node sits at ~1.5 GB RSS / 0% CPU for ~10.8s refusing to exit because the
   app's top-level `new PGlite()` (e.g. `examples/commerce/src/db.ts:30`, evaluated during
   `ssrLoadModule` to derive the app graph) plus vite-plus `createServer` handles are never
   disposed, and the one-shot CLI never reaches them. This tax is paid by **every** `kovo`
   invocation, and the scaffolded `check` pipeline runs several.
2. **~2s redundant `tsc --noEmit` subprocess** preflight (`build-export.ts:461`).
3. **Cold-build ts-morph re-parsing** (~20s of a cold build) — warm builds skip this via
   the cache; cold CI / fresh-checkout builds pay it.

The "minutes on real-world apps" = the teardown drain × every process in the pipeline
(`vp check`, `check:sound-subset`, `build:prod`, `vitest`), plus cold ts-morph on CI.

## Measured baseline (commerce, 22 files, current code)

- `kovo build ./src/app.tsx --preset node`: **~14.3s warm wall / ~8.6s user**.
  - Useful work finishes at uptime **~3.55s**; process does not exit until **~14.33s**.
  - Forcing flush + `process.exit(exitCode)` after `mainAsync` resolves →
    **~3.6–4.4s wall, byte-identical diagnostics** (KV414 + 3× KV407). Confirmed by two
    independent prototypes.
- Warm phase split of the ~3.55s useful work: startup→entry ~0.4s · tsc preflight ~2.0s ·
  loadApp+css (3× vite-plus `createServer`/`close`) ~1.5s · **drizzle static security
  analysis + deriveAppGraph + kovoCheck ~0.01s (cache hit)**.
- Cold cache regime (first build / fresh checkout): phase-2 vite cold dep-optimize ~14.1s;
  drizzle static ~6.08s (ts-morph project built from scratch). The cache is what makes the
  security gate ~7ms warm — the teardown drain masks that win.
- On commerce/crm/stackoverflow the bundle phases (4 client manifest, 5 server bundle,
  6 neutral+preset emit) **never run** — phase 3 throws on the failed security gate first.

CPU profile (single process): 38% idle + 6.4% `spawnSync` (the teardown drain + tsc
subprocess) · ~36% `@ts-morph/common` (cold only) · ~12% native · ~2% pglite.

## Ranked suggestions

Ranked by measured impact × confidence ÷ effort. Estimates are from worktree prototypes
measured back-to-back against baseline; all "adopt" items verified byte-identical KV
diagnostics. Each is a security-sensitive change — see Constraints.

- [x] **1. Force a clean exit in `packages/cli/src/bin.ts` once `mainAsync` resolves**
      (flush stdout/stderr, then `process.exit(exitCode)`).
      Est: **~14.3s → ~3.6–4.4s warm (~70%, 3.4–3.9×)** · Effort: low · Risk: medium · Confidence: high.
  - DONE. Implemented in `bin.ts`: one-shot commands flush stdout/stderr then
    `process.exit(exitCode)`; the long-lived `kovo mcp` server is guarded (`process.argv[2]
=== 'mcp'`) so it is never killed. `bin.ts` stays free of TypeScript-only syntax (it is
    copied verbatim to a `.mjs` and run as plain JS by the no-respawn test).
  - Verified this session: warm commerce build **14.2s → ~2.6s**, byte-identical
    KV414+3×KV407; `kovo mcp` still answers `initialize`+`tools/list` and exits cleanly on
    stdin EOF; `index.kovo-check.test.ts` "does not respawn…" green; starter production build
    test green.

- [x] **2. Make the `tsc --noEmit` preflight incremental** (`--incremental` +
      a stable `.kovo/cache/tsc-preflight.tsbuildinfo`).
      Est: **~1.95s → ~0.7s warm (~64% of the step)** · Effort: low · Risk: low · Confidence: high.
  - DONE. `runTypeScriptBuildPreflight` (`build-export.ts`) now passes `--incremental
--tsBuildInfoFile .kovo/cache/tsc-preflight.tsbuildinfo` (dir auto-created; `.kovo/cache`
    is already gitignored). `--noEmit` kept, so only the build-info is written.
  - Verified this session: standalone tsc **~1.95s → ~0.79s** warm; build diagnostics
    unchanged; an injected `TS2322` is still caught by the preflight (fail-closed).

- [ ] **3. Use `@typescript/native-preview` (tsgo) for the `--noEmit` preflight**, falling
      back to JS `tsc`. Complementary to #2 (tsgo helps cold; incremental helps warm).
      **Out of scope this round (excluded by request).**
      Est: **~11% wall / ~29% CPU on commerce; standalone preflight 8–10s → 1.74s** · Effort: low · Risk: low · Confidence: medium.
  - The scaffold template already ships native-preview. tsgo is not subpath-resolvable —
    resolve via `createRequire` of the package.json then `join(dir,'bin','tsgo.js')` with
    JS-`tsc` fallback (resolution fragility → medium confidence).
  - Evidence: prototype C8, byte-identical KV414+3×KV407, tsgo catches injected TS2322.

- [ ] **4. Root-cause the teardown drain (so `process.exit` is not load-bearing):** have
      `createApp` register a disposer the CLI invokes after `loadBuildAppModule`'s
      `ssrLoadModule` (`build-export.ts:1299-1336`) to dispose the app's PGlite handle, and make
      the 3 config/app/css `createServer`/`close` cycles (`build-export.ts:1349/1370`,
      `kovoBuildStylesheetCss:1177`) fully tear down vite-plus's lingering native handle (or
      reuse one shared server).
      **Deferred by decision (2026-06-28): not implemented this round** — #1 already captures the
      CLI win, so this is ~0 additional CLI speedup and the sound fix needs a new app-facing
      disposal contract. Left open for long-lived-host robustness.
      Est: same ~10.8s drain removed at the source; collapsing 3 `createServer` cycles → 1 also
      trims phase-2 · Effort: medium · Risk: medium · Confidence: medium.
  - Not prototyped end-to-end (the CLI doesn't own the app-created PGlite). Also benefits
    long-lived hosts (dev server, test workers) where force-exit is not an option.

- [x] **5. Memoize `withParsedSourceFile` by `(fileName+source)`, scoped PER static run**,
      in `packages/drizzle/src/static/tables.ts`.
      Est: **cold build ~35.9s → ~29.7s (~6s); `withParsedSourceFile` 10.2s → 4.6s; warm ~0**
      (already cache-skipped) · Effort: medium · Risk: medium · Confidence: medium.
  - DONE. `tables.ts` adds a module-level cache + reentrant `runWithSourceFileParseCache(fn)`
    that forgets every cached `SourceFile` and clears the map on scope exit; the 8 top-level
    `*FromProject` entry points in `static.ts` wrap their bodies in it. Outside a scope,
    behavior is unchanged (create + `forget`). Key uses a `\0` separator (collision-safe).
  - Verified this session: drizzle suite **614/614** (no OOM), byte-identical KV407/KV414.
    End-to-end cold delta is within run-to-run noise (drizzle parsing is a small slice of a
    full cold build); the win is the eliminated redundant re-parsing, not a headline number.

- [x] **6. Add a from-source `kovo build --check` validate-only flag.**
      Est: ~0 on gate-failing apps; **~0.2–1.1s only on apps that PASS the gate** · Effort: medium · Risk: medium · Confidence: high.
  - DONE. `--check` runs _every_ diagnostic-producing phase — the tsc preflight, the
    kovo-check security gate, **and the client/server compiler transform that raises KV235**,
    plus preset inspection — then returns before the deployable `preset.emit`. It is a strict
    subset of a full build, so it stays fail-closed and cannot pass where a build fails.
    (Deliberately did **not** repoint the scaffold `check` script: keeping `build:prod` there
    preserves the stronger "production emit actually works" CI signal; the flag is opt-in.)
  - Note: `kovo compile graph --check` is **not** this path — it only re-derives
    `deriveAppGraph` from pre-serialized JSON and never runs the from-source drizzle gate.
  - Verified this session: on commerce `--check` stays fail-closed with byte-identical
    KV414+3×KV407 (exit 1); on the real scaffolded starter `--check` exits 0, prints
    `CHECK ok`, and does **not** emit `dist/server/server.mjs` while a full build does.
    Usage/flags manifest updated (`commands-manifest.ts`) + assertion test updated.

- [ ] **7. (dev-only) Avoid the double-process `--experimental-transform-types` respawn** by
      registering an in-process TS load hook (amaro/swc) in `bin.ts`.
      **Deferred by decision (2026-06-28): not implemented this round** — ~0.3s only in the
      monorepo dev CLI; published `@kovojs/cli` already ships a `.mjs` bin that never respawns,
      so real users pay zero.
      Est: **~0.3s/invocation; ~0% for npm-installed users** · Effort: low · Risk: low · Confidence: medium.
  - Published `@kovojs/cli` bin already points at `./dist/bin.mjs` (a `.mjs` bin never
    triggers the respawn guard), so real users pay zero. Dev-ergonomics only.

## Rejected candidates (do not retry)

- [ ] ~~**R1. Overlap the security check preflight with the production bundle**~~ (concurrent
      promises in `runBuildCommand`). **REJECTED — fail-closed VIOLATION:** overlapping writes
      `dist/.kovo-client` on a _failed_ security gate where the sequential pipeline writes
      nothing; +110% cold (32.4s vs 15.3s); ~0 warm (the gate is a ~7ms cache hit, nothing to
      overlap). Breaks SPEC.md §11.1 fail-closed. (prototype C7)
- [ ] ~~**R2. Further trim/share the ts-morph type-checker surface in
      `createProjectExtraction`**~~ (`types:[]`/`lib`/documentRegistry). **REJECTED:** already
      sets `types:[]`, `lib:['lib.es2022.d.ts']`, `skipLibCheck`; ts-morph@28 has no
      `documentRegistry` option; only 2 extraction projects per cold build with non-identical
      file sets (0 memo hits). Process-global memo OOM'd the drizzle suite. Real cold cost is in
      `withParsedSourceFile` (#5). (prototype C3)
- [ ] ~~**R3. Run the compiled `dist` bin in the monorepo**~~. **REJECTED:** breaks the
      build (0 KV diagnostics, "parameter property not supported in strip-only mode" because
      `@kovojs/*` deps resolve to `.ts`). Published users already get dist; nothing to do.
      (prototype C5)

## Order of attack

#1 force-exit → #2 + #3 preflight (incremental + tsgo) → #4 root-cause handle disposal →
#5 cold-only per-run memoization. #6 is an independent ergonomics feature.

## Verification loop (throwaway worktree — used for every estimate above)

1. `git worktree add <wt> HEAD --detach`
2. `cd <wt> && pnpm install --offline --ignore-scripts` (~2s, **required**: re-links
   `@kovojs/*` to the worktree's own packages; symlinking `node_modules`→main does not
   isolate edits).
3. Edit `<wt>/packages/{cli,drizzle,compiler}/src/*.ts` — no build step (CLI runs TS source
   via `--experimental-transform-types`).
4. `cd <wt>/examples/commerce && /usr/bin/time -p ./node_modules/.bin/kovo build ./src/app.tsx --preset node`
   — measure baseline and prototype back-to-back; report the ratio (concurrent runs make
   absolute seconds noisy).
5. `git worktree remove <wt> --force`.

## Constraints (non-negotiable)

The drizzle static analysis is a **security gate** (SPEC.md §11.1: KV407/KV414/KV433/
KV438/KV429), and KV235/KV236/KV310/KV311 fire in the bundle phases. Every optimization
must: (a) preserve **byte-identical** KV diagnostics (the commerce KV414 + 3× KV407 is the
oracle), (b) **never write build artifacts on a failed gate** (fail-closed), and (c) keep
type-error coverage. Validate with the commerce oracle plus `pnpm --filter @kovojs/drizzle
test` before counting any win.

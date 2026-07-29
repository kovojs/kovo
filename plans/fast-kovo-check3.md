# Plan: Make `kovo build` faster (round 3)

Status: **#1 retained; #2 rejected; #3 retired on packed RSS evidence; #4 remains; #5 removed**
Owner: perf

## Implementation status (2026-06-29)

Current state: **#1 (drizzle memo)** remains. The former **#3 (overlap tsc preflight)** was removed
after an exact packed 44-component journey proved aggregate process-tree RSS breached the
provisional 2 GiB ceiling. The persistent compiler cache was later deleted, so its absolute-path
value cleanup is no longer applicable.

- **Round-2 ownership port:** the only still-live `fast-kovo-check2.md` item is the cosmetic
  absolute path in persistent compiler-cache result values. Cross-path cache hits are already
  proven; the remaining cleanup belongs here beside the lighter-loader work. The round-2
  teardown, native-loader, and rejected experiment notes remain historical in
  `plans/archive.md`.

- **#2 (tsgo):** not chosen this round (#3 covers the tsc preflight at lower risk / no native dep).
- **#4 (skip the vite load):** pursuing the **lighter-loader** variant (keep evaluating the app
  via a cheaper module runner) rather than static derivation — it preserves the security
  guarantee (full analysis on the real app), so it needs **no** enumerability diagnostic. The
  strict KV303-style "createApp arrays must be statically enumerable" safeguard was **dropped**
  (it would have broken `site`'s data-driven docs routes, and is only needed by the
  static-derivation path we're not taking). #4 remains a **measure-then-build** follow-up: spike
  whether a node-hook + kovo-transform loader evaluates each example app to a byte-identical
  graph (esp. apps with non-trivial `vite.config`) before committing.
  Last verified: 2026-06-29 (after rounds 1–2 + the `fast-check-spikes` round merged: shared
  drizzle project, static-analysis cache + portability + CI cache, query-shape workers, clean
  process exit, incremental tsc preflight, drizzle per-run parse cache, `kovo build --check`,
  **dedup of the duplicated drizzle data-plane analysis**, parallel scaffold check pipeline)

Every estimate below was **measured in a throwaway git worktree** (spike round `fast-check3-spikes`),
baseline vs spike back-to-back, with a byte-identical-KV-diagnostics correctness gate.

## Measured baseline (examples/commerce, 22 files)

- cold `kovo build ./src/app.tsx --preset node` **~9.4s**; warm **~2.6s**.
- COLD phase breakdown (instrumented): startup ~0.4s · **tsc preflight ~2.0s** · app+css vite
  load ~1.8s · **drizzle analysis + kovo-check ~5.0s** (the check preflight; throws on commerce's
  KV414 gate, so the production build passes never run).
- The drizzle analysis (~5s) is the single biggest cold cost; the tsc preflight (~2s) is an
  independent subprocess that runs sequentially first. Warm builds hit the content-hash analysis
  cache (~0.01s), so warm cost is startup + tsc(~0.8s incremental) + load(~1.0s).

Caveat on all numbers: a concurrent `vp dev`/vitest on this machine made absolute seconds noisy;
the reliable signal is the **back-to-back paired ratio** and **min CPU/user time**, reported per item.

## Ranked suggestions

Ranked by measured impact × confidence ÷ effort. Items 2 and 3 both target the ~2s tsc preflight
and **do not stack** (pick one as primary); item 1 is independent and **stacks** with them.

- [x] **1. Memoize the redundant per-function drizzle extraction passes (cold analysis).** DONE.
      Per-extraction memo (`extraction.memo`) of `projectContextFiles` / `projectFunctionExtractionsByFileName`
      / `projectSourceModuleContext`, cleared in `dispose()` (not process-global). Verified: byte-identical
      KV oracle, drizzle suite **620/620** no OOM, build-graph gate green, cold ~9.4s → ~7.8s (~1.6s).
      Est: **cold ~9.4s → ~8.0s (−1.2–1.6s, ~12–16%)**; warm unchanged (cache-gated) · Effort: low · Risk: low · Confidence: high.
  - The single biggest cold cost is the ts-morph analysis (~5s). Profiling it
    (`extractStaticBuildAnalysisFactsFromProject`) showed the **same per-function extraction runs 3×**
    across the touch-graph / write-scope / query-fact passes: `funcExtractions n=3 = 2642ms` (~1.8s
    redundant). A per-extraction memo (stored on the extraction object, dropped in `dispose()` — **not**
    the previously-rejected process-global memo, so no OOM risk) eliminates 2 of the 3 passes.
  - Files: `packages/drizzle/src/static/project-setup.ts` (+~40), `static/tables.ts` (+~7).
  - Verified: commerce KV oracle byte-identical; `pnpm --filter @kovojs/drizzle test` 618/618, no OOM;
    create-kovo production-build-graph-gate passes; user-time min 17.11s → 15.45s (−1.66s, matches the
    profile prediction). **The biggest win and the lowest risk — do this first.** Scales with app size
    (more functions ⇒ larger absolute saving).

- [x] **2. Reject `@typescript/native-preview` (tsgo) for the `tsc --noEmit` preflight.**
  - Decision: #3 overlaps the existing TypeScript preflight with independent work, preserving the
    supported compiler and avoiding a second native/fallback path. Reconsider only with a new
    measured budget breach and equivalent toolchain coverage.
  - Historical estimate: **cold ~−1.6s (~17–19%)** and **warm ~−0.6s (~24%)**.
  - The preflight itself drops **~5×**: isolated tsc 1.93–2.17s → tsgo 0.35–0.44s cold (0.77s → 0.17s
    warm). Helps **both** cold and warm because the preflight runs on every build. tsgo already ships in
    the repo root **and both starter templates**, so it's available where it matters.
  - Files: `packages/cli/src/commands/build-export.ts` `runTypeScriptBuildPreflight` (resolve
    `@typescript/native-preview` → `bin/tsgo.js`, same flags, fall back to `typescript/bin/tsc`).
  - Verified: commerce KV oracle byte-identical; tsgo genuinely catches an injected type error.
  - Risk (medium): **harden the fallback** — a missing/incompatible native binary must fall back to JS
    `tsc`, never surface a phantom error; confirm tsgo's `--incremental`/`--tsBuildInfoFile` behavior.
    Re-run the create-kovo graph-gate in CI (the offline worktree couldn't link the kovo dist).

- [x] **3. Retire tsc/load overlap after the exact packed memory regression.**
  - `kovo check` and `kovo build` now run TypeScript, project quality, sound-subset, and
    entry-reachable analysis sequentially while retaining TypeScript-first failure ordering and
    zero artifact emission on failure.
  - Evidence: the exact 44-component journey passes standalone typecheck at 553.8 MiB; the previous
    concurrent implementation was killed above 2 GiB before a valid result. The remaining
    KF-DEVEX-007 breach is isolated to the formatter process and stays open in
    `plans/devex-first-loop.md`.

- [ ] **4. Derive the app graph without a full vite dev server** (the ~1.8s load).
      Est: **potential cold ~−1.8s + removes the teardown-drain root cause** · Effort: high · Risk: medium · Confidence: **low (unmeasured)**.
  - The build spins up a vite dev server purely to `ssrLoadModule` the app module. Replacing it with a
    lighter SSR loader (native `--experimental-transform-types`, jiti/tsx) — or statically deriving the
    app structure — could remove the load cost and the app-owned PGlite handle that round 2 force-exits
    around. **The spike for this did not return a result** (it exceeded the structured-output retry cap),
    so this is the one item with no measured number. Needs a dedicated follow-up spike: the open question
    is whether the app object can be obtained without evaluating `createApp` under the kovo compiler
    transform. Highest ceiling, highest uncertainty.

- [x] **5. Retire the persistent compiler-cache value cleanup because the cache no longer exists.**
  - Evidence: commit `cab4b4b84` removed `compile-cache.ts`,
    `persistent-compile-cache.ts`, their tests, and the public/internal cache hooks; the current
    compiler source census contains no persistent compile-cache implementation to make portable.

### Combined potential

Keep **#1**. Do not restore #3 without a packed process-tree RSS proof. #4 remains the only live
performance experiment and must preserve the same diagnostics and artifact-failure contract.

### Still-deferred from prior rounds (low value)

- #4-round2 root-cause PGlite/vite handle disposal — ~0 CLI benefit (clean exit already handles it);
  only matters for long-lived hosts.
- #7-round2 in-process TS load hook — dev-only ~0.3s; published `@kovojs/cli` already ships a `.mjs`
  bin with no respawn.

## Verification loop (throwaway worktree — used for every estimate above)

1. `git worktree add <wt> <BASE_SHA> --detach`
2. `cd <wt> && pnpm install --offline --ignore-scripts` (~2s)
3. Edit `<wt>/packages/**/src/*.ts` — no build step (CLI runs TS via `--experimental-transform-types`).
4. COLD: `rm -rf examples/commerce/.kovo examples/commerce/node_modules/.vite node_modules/.vite`,
   then `/usr/bin/time -p ./node_modules/.bin/kovo build ./src/app.tsx --preset node` (run twice).
   WARM: build once to warm, then time the next. Report the back-to-back ratio + `user` time
   (absolute seconds are noisy under concurrent load).
5. `git worktree remove <wt> --force`.

## Constraints (non-negotiable)

The drizzle static analysis is a **security gate** (SPEC.md §11.1: KV407/KV414/KV433/KV438/KV429).
Every optimization must (a) keep **byte-identical** KV diagnostics (commerce oracle), (b) **never emit
artifacts on a failed gate** (fail-closed), and (c) keep type-error coverage. Validate with the commerce
oracle + `pnpm --filter @kovojs/drizzle test` + the create-kovo production-build-graph-gate before
counting any win.

# Plan: Make `kovo check` / `kovo build` fast

Status: **open / investigation complete, optimizations not started**
Owner: perf
Last verified: 2026-06-28

## Problem

`kovo check` takes minutes on real-world apps. The literal `kovo check <graph.json>`
subcommand is cheap (JSON parse + checks); the cost is the **static analysis the
compiler runs to produce the graph and prove the security gates** (SPEC.md §11.1
project-mode type proof: KV407/KV414/KV433/KV438/KV429). That analysis is driven by
`kovo build` (the scaffolded `build:prod` step) and re-run again by `vp test`/`vp check`
(vite-plus, external) and `check:endpoint-posture`.

Scaffolded app `check` script:
`vp check && pnpm run check:sound-subset && pnpm run build:prod && pnpm run check:endpoint-posture`.

## Measured baseline (2026-06-28)

- `kovo build ./src/app.tsx --preset node` on `examples/commerce` (22 files, 3041 LOC)
  = **~47s wall, ~52s user** → CPU-bound, mostly single-threaded. Extrapolates to
  minutes on larger apps.
- CPU profile (single process, self time):
  - **57% ts-morph** (`@ts-morph/common` bundled TypeScript: `scan`, `bind`,
    `cloneNode`/`deepCloneOrReuseNode`, `resolveExternalModule`,
    `getAccessibleSymbolChain`) + ts-morph wrappers (`getCompilerForEachDescendantsIterator`).
  - 30% native (fs, GC), 20% idle, 4.2% `spawnSync`.
  - ~2% kovo:drizzle (the analysis driver); compiler scan itself is <0.2%.
- **Root cause (instrumented & confirmed):** `createProjectExtraction`
  (`packages/drizzle/src/static/project-setup.ts:58`) is called **12 times per single
  `kovo build`**. Each call does `new Project({...})` (a fresh ts-morph project with its
  own type-checker), `createSourceFile` for all ~13 app files, then resolves
  Drizzle/lib types. The 12 projects each independently bind + resolve `drizzle-orm` and
  `lib.*.d.ts`. That redundant type-checker construction is the bulk of the 57%.
  - Call sites: `static.ts:750,1629,1649,1728,1799,1818`, `derivation.ts:130`
    (7 source sites → 12 runtime calls).

## Validated verification loop (use for every optimization spike)

Spikes run in **throwaway git worktrees**, discarded after measuring:

1. `git worktree add <wt> HEAD --detach`
2. `cd <wt> && pnpm install --offline --ignore-scripts`  (~2s, warm store; this is
   required — it re-links `@kovojs/*` to the worktree's own packages. Symlinking
   `node_modules`→main does **not** isolate package edits.)
3. Edit `<wt>/packages/{drizzle,compiler,cli}/src/*.ts` (no build step needed: the CLI
   runs TS source via `--experimental-transform-types`).
4. `cd <wt>/examples/commerce && /usr/bin/time -p ./node_modules/.bin/kovo build ./src/app.tsx --preset node`
   and compare to the 47s baseline. Use `examples/gallery`/`stackoverflow` for a
   larger-app reading.
5. **Correctness gate (non-negotiable):** the static analysis is a security gate. Any
   change must keep the same diagnostics. Re-run `packages/drizzle` + `packages/compiler`
   tests and the conformance fixtures before trusting a speedup.

## Ranked suggestions

Ranked by expected impact ÷ effort, highest first. Impact = effect on a real DB-backed
app's check time; all must preserve SPEC.md §11.1 soundness.

- [ ] **1. Share ONE ts-morph `Project` + type-checker across all drizzle static passes.**
  Impact: **very high** · Effort: medium · Risk: medium (lifecycle/`dispose`).
  Build a single project (one `createSourceFile` per file, one bound type-checker) per
  `kovo build` and thread it through touch-graph, domain-writes, receiver-surface, and
  IDOR-scope passes instead of constructing 12. Collapses the 12× redundant binding of
  `drizzle-orm`/lib `.d.ts` into 1×. Watch the `dispose()`/`forget()` lifecycle so passes
  don't tear down shared source files; today each extraction owns + forgets its files.

- [ ] **2. Syntactic fast-path: skip project-mode drizzle analysis when the app uses no
  Drizzle receivers/schema.** Impact: **very high for non-DB apps**, none for DB apps ·
  Effort: low · Risk: low. A cheap `ts.createSourceFile` pre-scan can prove "no drizzle
  import / no receiver surface" and short-circuit the entire expensive type-checker path.
  The project-mode passes are the cost; many apps don't need them.

- [ ] **3. Content-addressed incremental cache for the analysis.** Impact: **high**
  (repeat runs / dev / CI with warm cache) · Effort: medium-high · Risk: medium (cache
  invalidation must be sound — it gates security). Persist analysis facts keyed on the
  content hashes of the input files; unchanged files reuse cached facts. Most edits touch
  a handful of files; today every run re-analyzes everything from scratch.

- [ ] **4. De-duplicate analysis across the composite `check` pipeline.** Impact: **high**
  (the "minutes" multiplier) · Effort: medium · Risk: low. `build:prod`, `vp test` (kovo
  vite plugin), and `check:endpoint-posture` each re-derive overlapping facts. Produce the
  graph/facts once (or via the cache in #3) and have the later steps consume the artifact
  instead of recomputing. Consider whether `build:prod` is even required in `check` or can
  be a graph-only analysis run.

- [ ] **5. Narrow the type-checker's input surface.** Impact: medium-high · Effort:
  low-medium · Risk: low-medium. `skipLibCheck` is already on. Add `types: []` (stop
  auto-including every `@types/*`, e.g. node/vitest, into the drizzle project), trim `lib`
  to the minimum the analysis needs, and share a `ts.createDocumentRegistry` so `.d.ts`
  ASTs are parsed once even across any projects that must stay separate. The drizzle
  analysis only needs `drizzle-orm` types + app source.

- [ ] **6. Cut redundant AST traversals inside a pass.** Impact: medium · Effort: medium ·
  Risk: low. `projectFunctionExtractionsByFileName` walks `getDescendantsOfKind(FunctionDeclaration)`
  and `getVariableDeclarations()` twice each and re-runs cross-file work
  (`projectRelationTargetTableNamesByProperty(extraction.sourceFiles, …)`) once per file →
  O(files²). Walk each file's descendants once, hoist cross-file computations out of the
  per-file loop. ts-morph node-wrapping (`cloneNode`, `getCompilerForEachDescendantsIterator`)
  is ~3% and scales with traversal count.

- [ ] **7. Lazy-load pglite and eliminate the stray `spawnSync`.** Impact: low-medium ·
  Effort: low · Risk: low. `@electric-sql/pglite` (WASM Postgres) loads during static
  analysis and `spawnSync` is 4.2% of self time. Confirm what spawns and whether pglite is
  needed for the analysis path at all; lazy-import or drop it from the hot path.

- [ ] **8. CLI startup: avoid re-transforming the whole import graph each invocation.**
  Impact: low-medium (fixed per-invocation cost; matters most for the many small
  `kovo check`/`add`/`explain` calls) · Effort: low. `packages/cli/src/bin.ts` re-spawns
  node with `--experimental-transform-types` and transforms the entire CLI+compiler+server
  TS graph on every run (~0.4–0.7s). Confirm published create-kovo apps run compiled
  `dist/` (the package ships `dist` via `prepack`); for workspace/dev, point the bin at
  `dist` or cache transform output.

- [ ] **9. Parallelize independent per-file syntactic analysis across worker threads.**
  Impact: medium (large apps) · Effort: high · Risk: medium. Build is single-threaded
  (user ≈ real). The shared type-checker (#1) resists parallelism, so this mainly helps
  the syntactic passes and multi-app/monorepo runs; pursue only after #1 lands.

## Notes / constraints

- The drizzle static analysis is a **security gate**, not a convenience. Per
  `AGENTS.md` (technical-preview bias, type-level security): optimizations may not weaken
  the soundness of KV407/KV414/etc. Every spike validates identical diagnostics on
  `examples/commerce` (which intentionally surfaces KV414/KV407) before counting a win.
- Highest-leverage first move is **#1** (one shared project) gated by the existing drizzle
  + conformance test suites; it is the most direct attack on the measured 57% ts-morph
  cost. **#2** is the cheapest broad win for the non-DB cohort.

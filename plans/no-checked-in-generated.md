# No Checked-In Generated Files

Created 2026-06-18. `SPEC.md` is the normative source of truth for framework behavior.

This plan removes compiler-generated artifacts from version control and removes every
app-authored dependency on them. It supersedes the "generated artifacts stay committed and
inspectable" stance of [`no-magical-generated.md`](./no-magical-generated.md): that plan only
relocated the dependency behind `*generated-fixtures.ts` wrappers and kept the files checked in.

## Decisions (confirmed)

- **Auditability → on-demand inspection.** Drop "committed, reviewable" as the normative audit
  mechanism. Lowered IR is reproducible on demand via `kovo emit` / `kovo explain`, and proven by
  the fixpoint + render-equivalence gates — not by reviewing committed diffs. Requires `SPEC.md`
  amendments (see Phase 0).
- **Dependency target → authored-only, compile on the fly.** App entries, tests, and helpers
  import **authored** components/routes. Lowering happens transparently through the Kovo Vite
  plugin in dev, build, and the (Vite-powered) test pipeline. No `src/generated/` directory is
  required to exist in a clean checkout; when present it is a gitignored build artifact only.

## End State

- No compiler-generated artifact is git-tracked (`src/generated/**`, `graph.json`,
  `touch-graph.ts`, `optimistic/*`, `app.kovo-route.tsx`, `live-targets.ts`, `kovo-ui.css`,
  generated `*.client.js`).
- `rg` finds zero imports from app-facing source into a generated dir — **including transitive
  imports through fixtures wrappers**.
- `pnpm run check`, `vp test`, browser tests, and `typecheck-examples` pass with the generated
  dirs absent from a clean worktree.
- A guard fails CI if any `src/generated/**` artifact is committed or if app source imports one.

## Scope / Non-Goals

- **In scope:** compiler-generated lowered IR and derived registries/graphs in `examples/*`,
  `site/*`, `site/tutorial/steps/*`, and `packages/create-kovo/templates`.
- **Out of scope (NOT app-local generated artifacts):**
  - `@kovojs/runtime/generated` / `packages/runtime/src/generated.ts` — a published compiler-ABI
    package export (`SPEC.md` §5.2 rule 8), not an app-local artifact.
  - `packages/conformance-fixtures/src/generated-module-fixtures.ts` — hand-authored test fixtures
    that merely contain the word "generated".
  - `.deepsec/**` snapshots and `examples/gallery/src/__screenshots__/**` visual-regression
    baselines — test/data artifacts, not compiler IR. Call out explicitly; leave committed.

## Audit Findings (current state, 2026-06-18)

**127 git-tracked generated source files** under `src/generated/` (excluding `.deepsec`):

| Area                                          | Count | Notable artifacts                                                                                                 |
| --------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `examples/commerce/src/generated/`            | 9     | `app.kovo-route.tsx`, components, `live-targets.ts`, `graph.json`, `touch-graph.ts`, `optimistic/`, `kovo-ui.css` |
| `examples/crm/src/generated/`                 | 12    | same families + 4 `optimistic/*`                                                                                  |
| `examples/gallery/src/generated/interactive/` | 70    | per-demo `*.tsx` + `*.client.js`                                                                                  |
| `examples/stackoverflow/src/generated/`       | 10    | same families as commerce                                                                                         |
| `site/src/generated/`                         | 2     | `app.kovo-route.tsx`, `app.routes.tsx`                                                                            |
| `site/tutorial/steps/0{2..7}/src/generated/`  | 24    | per-step components + `*.client.js`                                                                               |

**The production path does not need them.** `kovo build ./src/app.tsx` and the Vite plugin
(`kovo({ app: '/src/app.tsx' })`, `packages/server/src/vite.ts`) compile from the **authored**
entry. The Kovo plugin's `transform` hook (`packages/compiler/src/vite.ts:178`) lowers `.tsx`
on the fly during dev/build. Committed artifacts exist only so non-Vite consumers get lowered
output.

**App-authored files still depend on generated — transitively.** `no-magical-generated.md`
removed direct `./generated/*` imports but added `*generated-fixtures.ts` wrappers (exempted by
`scripts/import-boundary.mjs` via `isExplicitArtifactFixture`). App entries import the wrapper;
the wrapper re-exports the committed artifact:

- `site/src/app.ts` → `./app.generated-fixtures.js` → `./generated/app.kovo-route.js`
- every `site/tutorial/steps/*/src/app.ts` → `./generated-fixtures.js` → `./generated/*`
- `examples/gallery/src/interactive-docs.tsx` → `./interactive-docs.generated-fixtures.js`
- `examples/commerce|crm|stackoverflow` fixtures + `*.generated-artifacts.test.ts`

**Compile-on-the-fly primitive exists.** `compileComponentModule()`
(`packages/compiler/src/compile.ts:78`, exported from `@kovojs/compiler`) lowers a single
component/route to `CompileResult` ({server, client, css, registry stamp, diagnostics}). Used by
`scripts/prod-emit-check.mjs` and the CLI.

**Why tests/typecheck currently read committed artifacts.** Vitest and `tsc` do **not** run the
Kovo Vite plugin today. Key mitigations:

- Vitest is Vite-powered: adding the Kovo plugin to the test config lowers `.tsx` on the fly for
  **both** node and browser vitest (vitest browser mode is also Vite-served). This is the unifying
  fix for the two hardest consumers.
- `tsc --noEmit` is **type-level only**: authored `component(...)` and its lowered form share the
  same public API shape, so typecheck resolves authored source fine — no lowering needed, only the
  removal of generated files from the `tsc` include set.
- Remaining non-Vite consumers: `node --test tests/kovo-check.node.mjs` and `kovo check
examples/commerce/src/generated/graph.json` (both must emit to a temp dir instead of reading a
  committed copy).

**Gates that read committed copies (must change):** `emit-components --check` / `emit-graph
--check` (diff vs committed), `scripts/kovo-check.mjs` (`kovo check .../graph.json`),
`vite.config.ts` lint/fmt `ignorePatterns` + task `input` lists, `create-kovo` template (ships a
committed `graph.json`).

---

## Phase 0 — SPEC & rules amendments (unblocks everything)

- [x] Amend `SPEC.md` to drop "committed" as the normative audit mechanism, replacing it with
      "reproducible on demand (`kovo emit`/`kovo explain`) and proven by fixpoint +
      render-equivalence."
  - Evidence: `SPEC.md` §5.1, §5.2 rule 8, §10.4, and §11.1 now describe emitted generated
    artifacts as reproducible outputs inspected through emit/explain/check flows rather than
    committed app-local files.
  - Targets: §11 line ~1107 ("Output is **committed and reviewable**…"), §10.4 optimistic
    ("committed, overridable"), §11.3 touch-graph ("committed, reviewable"), the §3 pipeline
    diagram annotations (lines ~400–401), and §5.2 rule 8 wording.
  - Keep Constitution #3 (fixpoint no-op) and #4 (the wire is the documentation) intact — those do
    not require committing, only reproducibility/inspectability.
- [x] Update `rules/` if any rule restates "committed/reviewable generated output" as binding
      (audit `rules/data-layer-policy.md`, `rules/compiler-hard-rules.md`,
      `rules/api-surface.md`). `rules/constitution.md` #3 stays as-is.
  - Evidence: `rg -n "committed|reviewable|generated output|generated artifacts|src/generated|generated dir|inspectable" rules`
    finds only `rules/constitution.md` #3, which remains the SPEC §5.2 fixpoint/auditability
    rule and does not require committed artifacts.
- [x] Add a one-line supersede note to `no-magical-generated.md` (or move it to `archive.md`)
      pointing here.
  - Evidence: `plans/no-magical-generated.md` now points readers to this plan as the superseding
    ledger for app-local generated artifact tracking.

## Phase 1 — Compile-on-the-fly harness (load-bearing)

- [ ] Wire the Kovo compiler plugin into the **test** pipeline so authored `.tsx`
      component/route imports lower on the fly:
  - root `vite.config.ts` `test:` plugins, each `examples/*/vite.config.ts` test usage, and
    `vitest.browser.config.ts`.
  - Verify a test importing an authored component sees lowered HTML (kovo stamps:
    `kovo-c`, `kovo-deps`, `data-bind`, `on:click`).
- [x] Expose a config-safe compiler plugin entry for Vite/Vitest config loading.
  - Evidence: `@kovojs/compiler/vite` (`packages/compiler/src/vite-config.ts`) loads without
    pulling compiler internals into config startup and uses Vite `ssrLoadModule` for transforms;
    `pnpm --filter @kovojs/compiler exec vitest run src/vite.test.ts src/vite-config.test.ts`
    covers config-safe loading and scoped transforms.
  - Gap: root/example config activation remains open because Commerce still imports authored
    component internals that disappear after lowering (for example `OrderHistory.definition`).
- [ ] Make registry/graph facts available to the plugin at test time **without** a committed
      `graph.json` (derive from authored route/mutation/query declarations, or emit to a temp
      cache during a pretest step). Document how `packageComponentPrefixes`/mutation-input facts
      are supplied.
- [x] Add module-compilation caching (keyed by source hash) so repeated imports in a test run do
      not recompile.
  - Evidence: `packages/compiler/src/vite.ts` caches transformed component compiles by source hash,
    file, root, package-prefix facts, and registry facts; `pnpm --filter @kovojs/compiler exec
    vitest run src/vite.test.ts` covers cache hits and source-hash invalidation.
- [ ] Handle non-Vite consumers: a shared helper that emits required IR to an OS temp dir for
      `tests/kovo-check.node.mjs` and the CLI graph check (Phase 4 consumes this).

## Phase 2 — Remove app-authored dependency on generated

Per area: delete the `*generated-fixtures.ts` wrapper, repoint app entries/helpers/tests to
authored components/routes, and convert or relocate artifact tests.

- [ ] **Commerce** — drop `app.generated-fixtures.ts`; `app.tsx`/helpers reference authored
      components; fold `app.generated-artifacts.test.ts` into compile-on-the-fly assertions or a
      compiler/package test. Derive `live-targets` at build, not via a committed module the app
      imports.
- [ ] **CRM** — same; reconcile `mutations.ts`/`optimistic-merge.ts` with non-committed optimistic
      plans (authored mutation exports own the runtime plan; generated optimistic is emit-only).
- [ ] **StackOverflow** — same as Commerce.
- [ ] **Gallery** — `interactive-docs.tsx` and browser fixtures import authored
      `src/interactive/*.tsx`; lower via the test plugin (Phase 1). Retire
      `interactive-docs.generated-fixtures.tsx` and `*.generated-browser-fixtures.ts`.
- [ ] **Site** — `site/src/app.ts` exports the authored app/route entry; drop
      `app.generated-fixtures.ts`, `src/generated/app.kovo-route.tsx`, `app.routes.tsx`.
- [ ] **Tutorial steps 02–07** — each `app.ts` imports authored `components/*.tsx`; drop every
      `generated-fixtures.ts` and `src/generated/*`. Update `site/tutorial/run-steps.mjs` to emit
      to a temp/gitignored dir for any check it performs.

## Phase 3 — Stop committing + gitignore

- [ ] Add ignore rules: `**/src/generated/`, plus root-level `graph.json` artifacts where
      committed (e.g. `packages/create-kovo/templates/graph.json`). Confirm the `.deepsec` and
      `__screenshots__` exclusions in Scope are preserved.
- [ ] `git rm -r --cached` all tracked generated artifacts enumerated in the audit table.
- [ ] Remove generated dirs from `vite.config.ts` lint/fmt `ignorePatterns` and from task `input`
      lists (`kovo-check` `graph.json` input, etc.).
- [ ] `create-kovo` template: add `.gitignore` covering generated output, remove committed
      `templates/graph.json`, and update `templates/docs/graph-assertions.md` +
      `scripts/graph-assertions.mjs`/`emit-graph.mjs` to emit-then-assert on demand.

## Phase 4 — Replace committed-artifact freshness gates

- [ ] Rework `examples/*/scripts/emit-components.mjs` and `emit-graph.mjs` `--check`: compile to a
      temp dir and assert the **fixpoint** (recompiling the output is a no-op) and
      render-equivalence, instead of diffing against a committed file.
- [ ] `scripts/kovo-check.mjs`: emit the commerce graph to a temp path, then run `kovo check
<temp>` (no committed `graph.json` dependency).
- [ ] `.github/workflows/pages.yml`: keep `emit:interactive-gallery` as a build step that writes
      into the gitignored generated dir before the pages build (it is not `--check`).
- [ ] Confirm `scripts/prod-emit-check.mjs` already compiles in-memory (no committed input) and
      keep it as the canonical "compile output is clean" gate.

## Phase 5 — Strengthen guards

- [ ] `scripts/import-boundary.mjs`: remove/restrict the `isExplicitArtifactFixture` +
      `*generated-fixtures` exemption so app-facing source cannot reach a generated dir
      transitively. Allow generated reads only in compiler/package-internal tests.
- [ ] Add a `check:no-committed-generated` guard (new script or extend import-boundary) that fails
      if `git ls-files` lists any `src/generated/**` / derived artifact in the in-scope roots.
      Wire it into `pnpm run check`.
- [ ] Update `scripts/import-boundary.test.mjs` to cover the tightened rule (transitive fixture
      rejection, committed-artifact rejection).
- [ ] Finalize `SPEC.md` §5.2 rule 8 wording from Phase 0 to match the stricter guard.

## Phase 6 — Verification

- [ ] Clean-worktree proof: `git clean -ndx` shows generated dirs would be created (not tracked);
      `git ls-files | rg '/src/generated/'` returns nothing in scope.
- [ ] Zero app dependency: `rg -n "generated" examples site --glob '!**/generated/**'` shows no
      import/`export … from` into a generated path (direct or via fixtures).
- [ ] Gates: `pnpm run check` (incl. `check:imports`, new `check:no-committed-generated`,
      `typecheck-examples`), `vp test`, browser tests (`vp run browser`), `vp run kovo-check`,
      `git diff --check`.
- [ ] Spot-check on-demand inspection: `kovo emit`/`kovo explain` reproduce the lowered IR for one
      component per example, and the fixpoint gate passes on the freshly emitted output.

## Risks / Open Questions

- **Registry facts at test time without committed graph.** The Vite plugin needs mutation-input
  and component-prefix facts to lower correctly (commerce's emit script feeds `registry-facts`).
  Phase 1 must establish how these are derived from authored declarations at test/dev time; this
  is the highest-risk item.
- **Browser-test serving.** Confirmed feasible because vitest browser mode is Vite-served, but
  validate the plugin runs in that pipeline (handler client-module emission, asset URLs).
- **Loss of review-time diffs.** Reviewers no longer see lowered-IR/graph changes as diffs.
  Mitigation per Decisions: fixpoint + render-equivalence gates + on-demand `kovo explain`. Confirm
  this satisfies `rules/data-layer-policy.md` and `rules/compiler-hard-rules.md` expectations.
- **CI cache churn.** Tasks that listed generated files as cache `input` need new inputs (authored
  source + compiler package) so caching stays correct after the files leave the tree.

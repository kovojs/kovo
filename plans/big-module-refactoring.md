# Big Module Refactoring

**Date:** 2026-06-23
**Scope:** tracked, text-like files over roughly 2,000 LoC, with source and test modules prioritized
over generated manifests, baselines, lockfiles, and benchmark artifacts.

Normative constraints: preserve `SPEC.md` §5.2 compiler/generated-artifact rules, §6.5 Better Auth
adapter behavior, §9.1/§9.2 mutation wire semantics, and §10/§11 data-plane verification semantics.
For compiler behavior edits also follow `rules/compiler-hard-rules.md`; for public/internal export
changes follow `rules/api-surface.md`.

## Current Inventory

Command used: `git ls-files | while IFS= read -r file; do [ -f "$file" ] || continue; case "$file" in *.png|*.jpg|*.jpeg|*.gif|*.webp|*.woff2|*.svg|*.snap) continue ;; esac; wc -l "$file"; done | awk '$1 > 2000 { print $1, $2 }' | sort -nr`

| LoC | File | Classification | Refactoring stance |
| ---: | --- | --- | --- |
| 12,244 | `packages/drizzle/src/static.ts` | production source | P0 split target |
| 8,719 | `packages/icons/package.json` | generated package manifest | do not hand-split; reduce/regenerate only if generator changes |
| 4,604 | `pnpm-lock.yaml` | lockfile | no module refactor |
| 4,193 | `benchmarks/results/results.json` | benchmark artifact | archive/prune policy, not code split |
| 3,216 | `api-surface-baseline.json` | generated baseline | no hand edit except API gate refresh |
| 2,149 | `public-packages.json` | generated/package inventory | no hand edit except source-of-truth refresh |

Current command output after completed splits:
`git ls-files | while IFS= read -r file; do [ -f "$file" ] || continue; case "$file" in *.png|*.jpg|*.jpeg|*.gif|*.webp|*.woff2|*.svg|*.snap) continue ;; esac; wc -l "$file"; done | awk '$1 > 2000 { print $1, $2 }' | sort -nr`

## Refactoring Rules

- [ ] Keep every extraction behavior-neutral unless the specific item says otherwise. The first
  checkpoint for each source split should be a pure move with unchanged exported names and unchanged
  call sites except imports.
- [ ] Prefer concern modules that match existing package boundaries instead of generic `utils.ts`
  buckets.
- [ ] Preserve public and declared internal subpath exports. Any renamed export or removed symbol needs
  an explicit API-surface decision and `pnpm run check:api-surface`.
- [ ] For compiler source moves, prove byte/fact neutrality with focused compiler tests, not fixpoint
  alone; `SPEC.md` §5.2 says emitted/generated artifacts are inspection targets, not hand-authored
  source.
- [ ] For server mutation and data-plane moves, include focused unit tests plus the relevant
  conformance or `kovo-check` path before committing.
- [ ] Leave generated JSON, manifests, and lockfiles out of manual refactoring. If their size is a
  problem, change the generator, prune stale content, or document the refresh command.

## P0 Source Splits

- [ ] **Split `packages/drizzle/src/static.ts` into static-analysis concern modules.**
  - [x] Extract SPEC §10.5 symbolic-effect and algebraic query-shape extraction to
    `packages/drizzle/src/static/derivation.ts`, with `static.ts` preserving the existing
    `./internal/static` export surface.
    Evidence: `packages/drizzle/src/static/derivation.ts` is 1,375 LoC and
    `packages/drizzle/src/static.ts` is reduced to 10,976 LoC; `pnpm exec vitest --run packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive.test.ts packages/drizzle/src/derive-codegen.test.ts` passed 3 files / 74 tests; `git diff --check` passed.
  - [x] Extract session/private-scope provenance helpers to
    `packages/drizzle/src/static/session-provenance.ts`.
    Evidence: `packages/drizzle/src/static/session-provenance.ts` is 398 LoC and
    `packages/drizzle/src/static.ts` is reduced to 10,609 LoC; `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts` passed 3 files / 83 tests.
  - [x] Extract source-module table/import resolution to `packages/drizzle/src/static/tables.ts`.
    Evidence: `packages/drizzle/src/static/tables.ts` is 774 LoC and
    `packages/drizzle/src/static.ts` is reduced to 9,883 LoC; `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.columns-keys-predicates.test.ts packages/drizzle/src/derive.test.ts` passed 4 files / 111 tests; `git diff --check` passed.
  - [x] Extract domain action and write-callback resolution to
    `packages/drizzle/src/static/domain-writes.ts`.
    Evidence: `packages/drizzle/src/static/domain-writes.ts` is 745 LoC and
    `packages/drizzle/src/static.ts` is reduced to 9,180 LoC; `pnpm exec vitest --run packages/drizzle/src/index.write-callbacks-carriers.test.ts packages/drizzle/src/index.write-callbacks-aliases.test.ts packages/drizzle/src/index.query-loader-config.test.ts packages/drizzle/src/index.receiver-alias-bindings.test.ts` passed 4 files / 70 tests; `git diff --check` passed.
  - [x] Extract receiver alias, carrier, helper-handoff, and unclassified receiver-surface analysis
    to `packages/drizzle/src/static/receiver-surface.ts`.
    Evidence: `packages/drizzle/src/static/receiver-surface.ts` is 1,854 LoC and
    `packages/drizzle/src/static.ts` is reduced to 7,476 LoC; `pnpm exec vitest --run packages/drizzle/src/index.receiver-alias-bindings.test.ts packages/drizzle/src/index.query-loader-receivers.test.ts packages/drizzle/src/index.writes-receivers.test.ts packages/drizzle/src/index.write-callbacks-carriers.test.ts packages/drizzle/src/index.query-loader-config.test.ts` passed 5 files / 94 tests; `git diff --check` passed.
  - Target shape:
    - `static/project.ts`: `ts-morph` project setup, file discovery, extraction context.
    - `static/tables.ts`: table/domain/view annotations and Drizzle surface classification.
    - `static/query-shapes.ts`: read/query-loader shape extraction.
    - `static/writes.ts`: write receiver classification, mutation touch extraction, predicate facts.
    - `static/session-provenance.ts`: private/session scope aliasing and KV414-related facts.
    - `static/symbolic-effects.ts`: `extractSymbolicEffectsFromProject` and derivation callbacks.
    - `static/algebraic-shapes.ts`: `extractAlgebraicShapesFromProject` and rowset/projection helpers.
    - `static.ts`: compatibility barrel for the existing `./internal/static` export.
  - Keep `packages/drizzle/package.json` exports unchanged.
  - Verification: `pnpm run test -- packages/drizzle/src`, `pnpm run test:conformance`,
    `pnpm run check:api-surface`, `pnpm run check:imports`.

- [ ] **Split `packages/server/src/mutation.ts` around the mutation response pipeline.**
  - [x] Extract public definition/form/type surface to `packages/server/src/mutation/definition.ts`.
    Evidence: `pnpm exec vitest --run packages/server/src/mutation-delta.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-wire.test.ts packages/server/src/mutation.test.ts packages/server/src/replay.test.ts packages/server/src/query-endpoint.test.ts` passed 8 files / 119 tests after extraction; `pnpm run check:api-surface` unchanged at baseline 1338/1871; `pnpm run check:imports` passed.
  - [x] Extract streaming chunk helpers and renderer to `packages/server/src/mutation/streaming.ts`.
    Evidence: same focused server mutation command above passed after extraction.
  - [x] Extract query rerun, fragment rendering, and live-target selection to `packages/server/src/mutation/targets.ts`.
    Evidence: same focused server mutation command above passed after extraction; `packages/server/src/mutation.ts` is now 1,225 LoC.
  - Target shape:
    - `mutation/definition.ts`: `write`, `mutation`, mutation form attributes, and type helpers.
    - `mutation/run.ts`: input parsing, guard execution, replay reservation, result normalization.
    - `mutation/enhanced-response.ts`: enhanced mutation wire selection and response headers.
    - `mutation/no-js-response.ts`: PRG/no-JS rendering and replay-unavailable pages.
    - `mutation/streaming.ts`: stream coalescing, chunk rendering, streaming error handling.
    - `mutation/targets.ts`: query rerun selection, fragment/live target rendering, target matching.
    - `mutation.ts`: compatibility barrel preserving current imports.
  - Verification: `pnpm run test -- packages/server/src/mutation*.test.ts packages/server/src/replay.test.ts packages/server/src/query-endpoint.test.ts`,
    plus `pnpm run check:api-surface` if exports move.

- [ ] **Split `packages/compiler/src/lower/structural-jsx.ts` by declared lowering phases.**
  - [x] Extract primitive static spread, primitive composition, and navigation/href lowering phases
    to `packages/compiler/src/lower/primitive-spreads.ts`,
    `packages/compiler/src/lower/primitive-composition.ts`, and
    `packages/compiler/src/lower/navigation-lowering.ts`.
    Evidence: `packages/compiler/src/lower/structural-jsx.ts` is now 1,959 LoC; `pnpm exec vitest --run packages/compiler/src/compile-component.test.ts packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/gallery-merge-fixtures.disclosure.test.tsx packages/compiler/src/gallery-merge-fixtures.forms.test.tsx packages/compiler/src/gallery-merge-fixtures.idref-oracle.test.tsx packages/compiler/src/gallery-merge-fixtures.menus.test.tsx packages/compiler/src/gallery-merge-fixtures.overlays.test.tsx packages/compiler/src/diagnostic-coverage-matrix.test.ts` passed 8 files / 90 tests; `pnpm run check:api-surface`, `pnpm run check:imports`, and `git diff --check` passed.
  - Use `structuralJsxPhaseOrder` as the module boundary guide: primitive spreads/composition,
    navigation/static hrefs, platform substitutions, view-transition stamps, inline attribute derives,
    primitive reactive attributes, inline text bindings, static text escaping, and helper import
    insertion.
  - Keep the existing phase order explicit in one orchestrator file so future changes can be reviewed
    against `SPEC.md` §5.2.
  - Verification: `pnpm run test -- packages/compiler/src/compile-component.test.ts packages/compiler/src/compiler-conformance.test.ts packages/compiler/src/gallery-merge-fixtures.*.test.tsx packages/compiler/src/diagnostic-coverage-matrix.test.ts`,
    plus `pnpm run check:api-surface`.

## P1 Source Splits

- [ ] **Split `packages/cli/src/index.ts` into command-facing modules.**
  - [x] Extract graph/check/audit/explain output and input parsing to
    `packages/cli/src/graph-output.ts`, preserving the internal compatibility exports from
    `packages/cli/src/index.ts`.
    Evidence: `packages/cli/src/index.ts` is now 151 LoC and
    `packages/cli/src/graph-output.ts` is 1,736 LoC; `pnpm exec vitest --run packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-add.test.ts packages/cli/src/index.kovo-audit.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-compile.test.ts packages/cli/src/index.compile-mcp.test.ts packages/cli/src/index.kovo-explain.test.ts packages/cli/src/index.kovo-export.test.ts` passed 8 files / 132 tests; `pnpm run check:api-surface`, `pnpm run check:imports`, and `git diff --check` passed.
  - [x] Extract add/compile, build/export, MCP, and shared result helpers to command modules
    under `packages/cli/src/commands/` plus `packages/cli/src/shared.ts`.
    Evidence: `wc -l packages/cli/src/index.ts packages/cli/src/graph-output.ts packages/cli/src/commands/*.ts packages/cli/src/shared.ts` reports all split CLI modules under 2,000 LoC; the non-build CLI vitest command above passed after extraction.
  - [ ] Reconcile the existing build-command tests with the current KV417 deploy-skew retention
    preset policy before marking the full CLI split verified.
    Gap: `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts packages/cli/src/index.kovo-build-browser.test.ts` still fails 7 tests because built-in node/vercel/cloudflare presets emit KV417 when app client modules require a 24-hour retention proof.
  - Target shape:
    - `dispatch.ts`: `main`, `mainAsync`, usage/error routing.
    - `commands/check.ts`, `commands/audit.ts`, `commands/explain.ts`: graph command execution and
      output formatting.
    - `commands/build.ts`, `commands/compile.ts`, `commands/export.ts`: async filesystem/Vite commands.
    - `commands/mcp.ts`: MCP server/tool definitions.
    - `graph-output.ts`: stable JSON/text formatting helpers shared by check/audit/explain.
    - `index.ts`: internal compatibility barrel; `api.ts` remains the public API entry.
  - Verification: `pnpm run test -- packages/cli/src/index.*.test.ts packages/cli/src/commands-manifest.test.ts`,
    `pnpm run check:kovo`, `pnpm run check:api-surface`.

- [ ] **Split `packages/better-auth/src/internal.ts` into adapter concern modules.**
  - [x] Extract structural Better Auth contracts and schema/input bridge declarations to
    `packages/better-auth/src/internal/contracts.ts`, with compatibility re-exports from
    `internal.ts` and public root re-exports for app-facing companion types.
    Evidence: `wc -l packages/better-auth/src/internal.ts packages/better-auth/src/internal/contracts.ts` reports `internal.ts` at 1,995 LoC and `contracts.ts` at 545 LoC; `pnpm run check:api-surface` passed with 30 recursive-publicness baseline entries fixed.
  - [x] Extract credential cookie forwarding, credential success classification, active-organization
    guards, and plugin metadata constants to `packages/better-auth/src/internal/credential.ts`
    and `packages/better-auth/src/internal/plugin-metadata.ts`.
    Evidence: `pnpm exec vitest --run packages/better-auth/src` passed 5 files / 76 tests; `pnpm run check:imports` and `git diff --check` passed.
  - Target shape:
    - `internal/session-api.ts`: structural Better Auth API/request/response/session contracts.
    - `internal/schema-bridge.ts`: schema validation, table metadata, source annotation, generated
      schema source.
    - `internal/cookies.ts`: Set-Cookie parsing/forwarding and credential success classification.
    - `internal/credential-mutations.ts`: credential mutation options, touch graph, failure/success
      resolution.
    - `internal/guards.ts`: active organization and auth guard helpers.
    - `internal.ts`: compatibility barrel preserving the existing `./internal` subpath.
  - Verification: `pnpm run test -- packages/better-auth/src`, `pnpm run check:api-surface`,
    `pnpm run check:imports`.

- [ ] **Split `packages/compiler/src/scan/parse.ts` after parser-fact seams are stable.**
  - [x] Extract exported scanner model interfaces to `packages/compiler/src/scan/model.ts` and
    re-export them from `parse.ts`.
    Evidence: `pnpm exec vitest --run packages/compiler/src/scan packages/compiler/src/compile-component.test.ts packages/compiler/src/compiler-conformance.test.ts` passed 6 files / 82 tests after deletion of the original declarations; `pnpm run check:imports` passed; `packages/compiler/src/scan/parse.ts` is now 1,946 LoC.
  - Target shape:
    - `scan/model.ts`: exported model interfaces and shared span types.
    - `scan/source-file.ts`: `parseSourceFile` and TypeScript module setup.
    - `scan/imports.ts`: import/export/module-scope binding models.
    - `scan/jsx.ts`: JSX element/attribute/expression/comment extraction.
    - `scan/calls.ts`: call expression, object literal, arrow function, temporal read extraction.
    - `scan/component.ts`: `parseComponentModule` orchestration.
  - Verification: `pnpm run test -- packages/compiler/src/scan packages/compiler/src/compile-component.test.ts packages/compiler/src/compiler-conformance.test.ts`,
    plus fact-level snapshots if model field construction changes.

## P2 Test And Fixture Splits

- [x] **Split `conformance/drizzle-pin/src/index.receiver-handoffs.test.ts` by handoff class.**
  - Evidence: split into `index.receiver-handoffs.test.ts` (1,493 LoC),
    `index.receiver-callback-containers.test.ts` (813 LoC), and
    `index.receiver-domain-actions.test.ts` (665 LoC); `pnpm run test:conformance` passed
    Drizzle pin 11 files / 188 tests and the remaining conformance packages.
  - Candidate files: domain receiver handoffs, query-loader receiver handoffs, write-callback handoffs,
    destructured/aliased receiver handoffs.
  - Verification: `pnpm run test:conformance`.

- [x] **Split `tests/kovo-check.node.mjs` into reusable fixtures plus command scenarios.**
  - Evidence: split into `tests/kovo-check.node.mjs` (1,680 LoC),
    `tests/kovo-check.compiler-runtime.node.mjs` (1,629 LoC), and
    `tests/kovo-check.server-browser.node.mjs` (1,255 LoC); `vp run build` produced fresh
    dist artifacts and `pnpm run check:kovo` passed 52 tests.
  - Preserve the current `vp run kovo-check` task entrypoint.
  - Candidate modules: temp workspace setup, CLI invocation, graph fixture builders, expected-output
    assertions, scenario list.
  - Verification: `pnpm run check:kovo`.

- [x] **Split `examples/gallery/src/demo-fixtures.tsx` by primitive or demo family.**
  - Evidence: moved controls/form/demo tail fixtures to
    `examples/gallery/src/demo-fixtures-controls.tsx`; `demo-fixtures.tsx` is now 1,861 LoC and
    `demo-fixtures-controls.tsx` is 1,059 LoC; `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/component-catalog.test.ts` passed 2 files / 37 tests.
  - Candidate modules: controls, disclosure/dialog/menu, list/table, forms, routing/navigation,
    streaming/async demos.
  - Preserve gallery route IDs and snapshot names unless a snapshot refresh is intentionally included.
  - Verification: `pnpm run test -- examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/component-catalog.test.ts`,
    and browser gallery tests if rendered markup changes.

- [x] **Split `packages/compiler/src/diagnostic-coverage-matrix.test.ts` into matrix data and
  scenario groups.**
  - Evidence: matrix data moved to `packages/compiler/src/diagnostic-coverage-matrix.data.ts`;
    `packages/compiler/src/diagnostic-coverage-matrix.test.ts` is now 994 LoC; `pnpm exec vitest --run packages/compiler/src/diagnostic-coverage-matrix.test.ts` passed 1 file / 4 tests; `git diff --check` passed.
  - Candidate modules: matrix definitions, expected-code coverage meta-test, JSX diagnostics,
    mutation/query diagnostics, route/style diagnostics.
  - Verification: `pnpm run test -- packages/compiler/src/diagnostic-coverage-matrix.test.ts`.

## Generated Or Artifact Size Policy

- [x] **Document ownership for large generated/package inventory files.**
  - Evidence: `scripts/build-icons.mjs` owns `packages/icons/package.json` exports and the icons
    `public-packages.json` entry (`pnpm --filter @kovojs/icons run build:icons`, check mode via
    `node scripts/build-icons.mjs --check`); `scripts/api-surface-gate.mjs --write` owns
    `api-surface-baseline.json`; `public-packages.json` is the package-boundary source of truth
    loaded by `scripts/public-packages.mjs` and verified by `scripts/public-packages.test.mjs`;
    `benchmarks/run-all.mjs` writes `benchmarks/results/results.json` and the derived
    `benchmarks/results/report.md`. Review rule: accept large diffs only with the matching generator
    or boundary-test command, not by hand-splitting these artifacts.

- [x] **Evaluate whether `benchmarks/results/results.json` belongs in an archive or rolling summary.**
  - Evidence: `benchmarks/run-all.mjs` overwrites one latest-run `results.json` and regenerates
    `report.md`; `benchmarks/README.md` documents the same active output paths. No archive split is
    needed while the file remains a single latest-run artifact; add an archive only if multiple
    historical benchmark runs become intentionally committed.

## Sequencing

- [x] Start with `packages/server/src/mutation.ts` or `packages/compiler/src/lower/structural-jsx.ts`
  for a bounded P0 proof-of-pattern. These are large but have strong local tests and clearer seams than
  Drizzle static extraction.
  - Evidence: server mutation and structural JSX split items above are both under 2,000 LoC and have
    focused test/API/import evidence recorded under their checkboxes.
- [ ] Tackle `packages/drizzle/src/static.ts` in multiple worktree-backed slices after the proof-of-pattern
  lands; avoid one giant move commit.
- [x] Run independent P1/P2 test-file splits in parallel worktrees only after the relevant source split is
  not actively changing the same ownership area.
  - Evidence: conformance receiver handoffs, `tests/kovo-check.node.mjs`, gallery fixtures, and the
    diagnostic coverage matrix are split and verified in the P2 section above.
- [x] After each split, update this plan with the exact verification command that proved the checkbox before
  marking it complete.
  - Evidence: every completed checkbox above includes the focused command, line-count check, or
    authoritative artifact inspected for that exact item.

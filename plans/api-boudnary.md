# API Boundary — Internal Subpaths and Public Docs

**Status:** Draft implementation ledger. This plan tightens the current
`@internal` convention from "exported but hidden from docs" to "reachable only
through an explicit internal subpath." `SPEC.md` remains the behavior source of
truth; this plan governs package-boundary mechanics and docs generation.

**Goal:** Every public package has a clean app-facing root surface and, where
needed, explicit non-public subpaths for generated-code ABI and repo-internal
helpers. Symbols tagged `@internal` must not be reachable from public roots,
symbols tagged `@generated` must not be reachable from public roots, neither
tier appears in generated public API pages, and each non-public import path says
who is allowed to consume it.

**Current gap:** `rules/api-surface.md` and `scripts/api-surface-gate.mjs`
currently allow a symbol reachable from a published entry point when it is
documented or tagged `@internal`. That classifies the symbol but does not force
the import path to communicate the private contract. The generated API reference
already excludes `@internal`, but the root barrels can still export those names.

## Decisions

- [ ] **Adopt root-public/generated/internal/private semantics.**
  - Public roots (`@kovojs/core`, `@kovojs/server`, etc.) expose only documented,
    app-facing APIs covered by `STABILITY.md`.
  - Compiler-emitted app imports use explicit generated-code ABI subpaths, with
    `./generated` preferred over `./abi` because the allowed consumer is clearer.
    Generated ABI is published and typed, but excluded from human public docs and
    allowed to change when compiler/runtime packages ship together.
  - Repo-internal APIs move to explicit internal subpaths chosen by dependency
    graph shape, tree-shaking, and cycle/blast-radius control. Prefer narrow
    subsystem paths such as `./internal/graph`, `./internal/wire`, or
    `./internal/static-export` when consumers do not need the same internal module
    graph. Use a package-wide `./internal` only as a small, explicitly curated
    compatibility barrel, not as the default aggregation point.
  - External users can technically import an internal subpath if it is published;
    the boundary is contractual and enforced by gates, docs, and stability policy,
    not by consumer authentication.
- [ ] **Keep package-private implementation unexported.**
  - Files that only the same package needs should stay out of `package.json`
    `exports` and be imported by relative paths inside that package.
  - Do not create an internal subpath merely to expose implementation details that
    no sibling package, emitted module, test fixture, or tool consumes.
- [ ] **Make docs root-only by default.**
  - Generated API reference pages render public app-facing entries from the
    manifest.
  - Generated and internal subpaths are excluded from the public docs site unless
    a future agent-only/internal reference is explicitly designed.
- [ ] **Allow published `.d.ts` for non-public subpaths.**
  - Published generated/internal subpaths may ship declaration files. The docs and
    gate, not declaration stripping, define whether an entry is human-public.
  - Public roots must not expose generated/internal declarations, but generated and
    internal entrypoints may be typed so sibling packages, emitted modules, and
    tests stay typechecked.

## Phase 1 — Policy and Gate Semantics

- [ ] **Update `rules/api-surface.md` to define public, generated, internal, and private rules.**
  - Done = the rules state that `@internal` and `@generated` are prohibited on
    public roots, allowed only on configured non-public subpaths, and omitted from
    public API docs.
  - Prove: `pnpm exec vp check rules/api-surface.md plans/api-boudnary.md`.
  - Evidence: `rules/api-surface.md` now defines public, generated, internal, and
    private tiers; `pnpm exec vp check rules/api-surface.md plans/api-boudnary.md`
    on 2026-06-17 reported both files formatted but failed to start linting with
    "No files found to lint", so this remains open pending the exact proving gate.
- [x] **Extend `public-packages.json` with API-boundary metadata.**
  - Done = each public package can declare public doc entries, generated ABI
    subpaths, and internal subpaths. Private packages remain classified as private
    and do not participate in public docs.
  - Prove: `pnpm exec vitest --run scripts/public-packages.test.mjs`.
  - Evidence: `pnpm exec vitest --run scripts/public-packages.test.mjs scripts/api-surface-gate.test.mjs`
    passed on 2026-06-17 with 13 tests; manifest tests assert exact public,
    generated, and internal tier coverage against package exports.
- [x] **Change `scripts/api-surface-gate.mjs` from classification-only to boundary enforcement.**
  - Done = public subpaths fail when any exported declaration is tagged
    `@internal` or `@generated`; generated subpaths allow `@generated`
    declarations plus re-exported public types; internal subpaths allow
    `@internal` declarations plus re-exported public types; undocumented public
    exports still fail through the existing ratchet.
  - Internal subpath classification must be exact or manifest-declared; wildcard
    internal exports are allowed only when a package proves they do not widen the
    internal graph or hide cycles.
  - Prove: focused gate unit tests cover public-root `@internal` leaks, internal
    subpath untagged leaks, generated-subpath rules, undocumented public exports,
    and baseline ratcheting: `pnpm exec vitest --run scripts/api-surface-gate.test.mjs`.
  - Evidence: `pnpm exec vitest --run scripts/public-packages.test.mjs scripts/api-surface-gate.test.mjs`
    passed on 2026-06-17 with 13 tests. `node scripts/api-surface-gate.mjs`
    now fails on existing package migration debt, reporting 343 boundary
    violations after the compiler slice, which proves hard enforcement is active.
- [ ] **Keep publish generation aware of generated/internal subpaths.**
  - Done = `scripts/build-publish.mjs` includes generated/internal subpaths in
    `publishConfig` when they are in top-level `exports`, and verifies their dist
    outputs without treating them as public API docs.
  - Prove: `pnpm run check:publish`.

## Phase 2 — Docs Enforcement

- [x] **Make `site/scripts/api-ref.mjs` consume only public doc entries.**
  - Done = API docs are generated from manifest-declared public entries; generated
    and internal subpaths are ignored even when published.
  - Prove: `pnpm --filter @kovojs/site run api:ref` and confirm generated
    `site/gen/api/*.md` contains no `@internal` or `@generated` entries.
  - Evidence: `pnpm --filter @kovojs/site run api:check` (2026-06-17) regenerated
    public API pages from manifest entries and typechecked 51 examples; the
    generator now rejects generated/internal doc entries and filters non-public
    declaration tags.
- [x] **Add a docs regression test for internal leakage.**
  - Done = the site API tests fail if any generated API page includes a symbol
    whose declaration is tagged `@internal` or `@generated`, or if a generated or
    internal subpath receives a public docs page.
  - Prove: `pnpm exec vitest --run site/scripts/api-ref.test.mjs`.
  - Evidence: `pnpm exec vitest --run site/scripts/api-ref.test.mjs` (2026-06-17)
    passed 10 tests, including manifest subpath rejection and generated page
    assertions for `@internal`, `@generated`, and generated/internal page slugs.
- [x] **Keep API examples public-only.**
  - Done = `site/scripts/api-examples-check.mjs` extracts examples only from
    public API pages and therefore never teaches imports from `/internal`.
  - Prove: `pnpm --filter @kovojs/site run api:check`.
  - Evidence: `pnpm exec vitest --run site/scripts/api-examples-check.test.mjs`
    (2026-06-17) passed 4 tests, including a stale `core-internal.md` page with a
    `kovo/internal` import that the extractor ignores; site `api:check` passed.

## Phase 3 — Package Migrations

- [ ] **Migrate `@kovojs/core` internals to `@kovojs/core/internal`.**
  - Move graph/verifier explain types, derivation IR, package-prefix helpers, and
    other `@internal` exports off the root barrel; split into narrower internal
    subpaths when graph/derivation/package-prefix consumers do not need the same
    module graph.
  - Update sibling packages, compiler output, tests, and docs references to import
    those names from the narrowest approved `@kovojs/core/internal/*` path.
  - Prove: `pnpm --filter @kovojs/core exec vitest run`, affected package tests,
    `node scripts/api-surface-gate.mjs`, and
    `pnpm --filter @kovojs/site run api:check`.
  - Evidence 2026-06-17 (`agent/api-boundary-core`): root `@kovojs/core` no longer
    re-exports the `graph`, `derivation`, or `package-prefix` `@internal`
    declarations; new narrow subpaths are `@kovojs/core/internal/graph`,
    `@kovojs/core/internal/derivation`, and
    `@kovojs/core/internal/package-prefix`, with sibling import sites updated to
    the narrowest subpath. Prove ran green: core vitest (65 tests), API surface
    gate, core dist build, Drizzle vitest (251 tests), and focused formatting /
    lint / type checks over touched files. Gap: site API check and broader
    non-Drizzle affected package suites were not run in this slice, so the
    checkbox remains open.
- [ ] **Migrate `@kovojs/server` internals to `@kovojs/server/internal` or narrower existing subpaths.**
  - Move escape helpers, mutation-wire parsers, route-dispatch internals, static
    export helpers not intended for app authors, and other `@internal` exports
    off public roots while preserving app-shell imports that are genuinely public.
    Prefer subsystem paths such as `@kovojs/server/internal/wire` or
    `@kovojs/server/internal/static-export` when they keep dependency graphs
    smaller than a package-wide barrel.
  - Prove: `pnpm --filter @kovojs/server exec vitest run`, example build checks,
    `node scripts/api-surface-gate.mjs`, and site API checks.
  - Evidence: server internals slice added `@kovojs/server/internal/html`,
    `@kovojs/server/internal/wire`, `@kovojs/server/internal/route`,
    `@kovojs/server/internal/static-export`, and
    `@kovojs/server/internal/app-shell-vite`; moved root/app-shell consumers for
    escape helpers, mutation-wire types, route/shell dispatch, and raw Vite
    plugin diagnostics to those subpaths; verified with
    `pnpm --filter @kovojs/server exec vitest run` (62 files, 404 tests) and
    `node scripts/api-surface-gate.mjs`
    (`public-exports-needing-attention=2904`, `baseline=2907`).
- [x] **Migrate `@kovojs/runtime` emit-target surface to `@kovojs/runtime/generated`.**
  - Emitted modules import from `@kovojs/runtime/generated` rather than the public
    root or an internal path; update compiler emitters, gallery replacements, and
    runtime export tests in the same slice.
  - Treat this as generated-code ABI: breaking source-level changes are allowed
    when compiler/runtime ship together, but emitted code must compile against the
    real runtime export map and deployed immutable artifacts still obey the
    framework's deploy-skew/version-retention guarantees.
  - Evidence 2026-06-17: branch `agent/api-boundary-runtime-generated` adds
    `@kovojs/runtime/generated` as a source and publish export, moves compiler
    emitted client/bootstrap/derive imports to that subpath, and pins the emitted
    bootstrap contract against the real generated barrel. Verified with
    `pnpm --filter @kovojs/compiler exec vitest run`,
    `pnpm --filter @kovojs/runtime exec vitest run`,
    `pnpm run check:inline-loader`, and
    `pnpm --filter @kovojs/runtime run build:dist`; gallery generated fixtures
    refreshed with `pnpm --filter @kovojs/example-gallery run emit:interactive-gallery`
    and checked with
    `pnpm --filter @kovojs/example-gallery exec vitest run src/interactive-gallery.static-export.test.ts src/interactive-gallery.artifacts.test.ts`.
  - Evidence 2026-06-17 (`agent/api-boundary-runtime-root`): runtime declarations
    reachable from the public root and generated ABI are now documented as public
    runtime APIs instead of tagged `@internal`, so `@kovojs/runtime/generated`
    re-exports documented public declarations for compiler-emitted code while
    the root remains app-facing. Verified with
    `pnpm --filter @kovojs/runtime exec vitest run` (75 files, 374 tests),
    `pnpm --filter @kovojs/compiler exec vitest run` (42 files, 356 tests),
    `pnpm run check:inline-loader`,
    `pnpm --filter @kovojs/example-gallery exec vitest run src/interactive-gallery.static-export.test.ts src/interactive-gallery.artifacts.test.ts`
    (2 files, 5 tests), and
    `node scripts/api-surface-gate.mjs 2>&1 | rg '@kovojs/runtime|api-surface:'`,
    which reported only `api-surface: 2 boundary violation(s):` with no
    `@kovojs/runtime` entries; the remaining full-gate failures are unrelated
    `kovo` CLI root internals.
  - Prove: `pnpm --filter @kovojs/runtime exec vitest run`,
    `pnpm --filter @kovojs/compiler exec vitest run`, generated fixture tests,
    and `pnpm run check:inline-loader`.
- [ ] **Migrate `@kovojs/compiler` internal structures to compiler internal subpaths.**
  - Keep build-template APIs public; move lowered IR, fact shapes, fixture-only
    utilities, and verifier plumbing to `@kovojs/compiler/internal` or narrower
    subpaths.
  - Prove: `pnpm --filter @kovojs/compiler exec vitest run`,
    `pnpm --filter create-kovo exec vitest run`, examples' graph-emission checks,
    and the API surface gate.
  - Evidence: local compiler split introduced `@kovojs/compiler/internal` and
    `@kovojs/compiler/internal/graph`; `pnpm --filter @kovojs/compiler exec vitest run`
    passed on 2026-06-17 with 42 files / 356 tests. `node scripts/api-surface-gate.mjs | rg '@kovojs/compiler|api-surface:'`
    reported 343 non-compiler boundary violations and no compiler-specific
    violations. Remaining proof gaps: create-kovo vitest and example graph-emission
    checks have not run in this session.
- [ ] **Audit `@kovojs/drizzle`, `@kovojs/better-auth`, `@kovojs/test`, `@kovojs/headless-ui`, `@kovojs/style`, and CLI packages.**
  - For each package, root exports must be documented public API; `@internal`
    declarations move behind internal subpaths or become package-private.
  - Preserve existing intentional public subpaths such as build-time/static
    entries when they are app-consumed, documented, and not `@internal`.
  - Evidence, 2026-06-17 adapter/test/style slice: `@kovojs/better-auth` root now
    re-exports only app-facing auth/session/credential helpers and publishes
    schema/touch-graph helpers through `@kovojs/better-auth/internal`;
    `@kovojs/style` moved `getPriority` to `@kovojs/style/internal`;
    `@kovojs/test` moved framework-owned integration fixtures to
    `@kovojs/test/internal/integration`; `@kovojs/drizzle` export map was audited
    as public root/derive/static only.
  - Prove, 2026-06-17 adapter/test/style slice:
    `pnpm --filter @kovojs/better-auth exec vitest run`;
    `pnpm --filter @kovojs/style exec vitest run`;
    `pnpm --filter @kovojs/drizzle exec vitest run`;
    `pnpm --filter @kovojs/test exec vitest run`;
    `node scripts/api-surface-gate.mjs`;
    `pnpm run check:publish`.
  - Prove: package-specific tests, `node scripts/api-surface-gate.mjs`,
    `pnpm --filter @kovojs/site run api:check`, and `pnpm run check:publish`.

## Phase 4 — Import Hygiene

- [x] **Add a compiler diagnostic for app-authored imports from non-public Kovo subpaths.**
  - Done = Kovo app compilation fails when app-authored source imports
    `@kovojs/*/internal`, `@kovojs/*/generated`, or `kovo/internal`; the diagnostic
    cites `SPEC.md` §5.2 because generated/lowered artifacts are compiler-owned and
    app code must stay on public TSX/JSX APIs.
  - The audit covers static `import`, `export ... from`, and string-literal dynamic
    `import()` in app graph modules.
  - Generated compiler output is exempt from the app-authored check, but generated
    output has its own contract tests proving it imports only approved generated
    ABI paths such as `@kovojs/runtime/generated`.
  - Prove: negative compiler fixtures for `@kovojs/core/internal`,
    `@kovojs/runtime/generated`, and `kovo/internal`; positive fixture for
    compiler-emitted `@kovojs/runtime/generated`; plus
    `pnpm --filter @kovojs/compiler exec vitest run`.
  - Evidence 2026-06-17 (`agent/api-boundary-import-hygiene`): compiler parser
    module-specifier facts now carry source spans for static imports, re-exports,
    and string-literal dynamic `import()`. `validateAuthoringSurface` emits an
    error diagnostic that cites `SPEC.md §5.2` for app-authored imports from
    `@kovojs/*/internal`, `@kovojs/*/generated`, and `kovo/internal`, while
    preserving the `sourceProvenance: 'compiler-emitted'` exemption. Verified by
    `pnpm --filter @kovojs/compiler exec vitest run` (42 files / 359 tests),
    including negative fixtures for `@kovojs/core/internal/graph`,
    `@kovojs/server/internal/html`, `@kovojs/runtime/generated`, `kovo/internal`,
    and dynamic `import('@kovojs/runtime/generated')`, plus the generated-output
    contract test for `@kovojs/runtime/generated`.
- [ ] **Add or extend a repo import-boundary check.**
  - Done = app-facing examples/site/tutorial code cannot import `*/internal` or
    `*/generated`; only packages, tests, generated artifacts, or explicitly-listed
    tool scripts may import internal subpaths, and only generated artifacts plus
    their contract tests may import generated subpaths.
  - Prove: focused import-boundary test plus `pnpm run check`.
  - Evidence 2026-06-17 (`agent/api-boundary-import-hygiene`):
    `scripts/import-boundary.mjs` scans app-facing examples, create-kovo
    templates, site content/src, and tutorial code for static imports,
    re-exports, and string-literal dynamic imports from non-public Kovo subpaths;
    it skips generated artifacts and tests and records explicit current internal
    tool/app exceptions in one allowlist. Verified by
    `pnpm exec vitest --run scripts/import-boundary.test.mjs` (3 tests) and
    `node scripts/import-boundary.mjs`. Gap: `pnpm run check` was not run in this
    slice, so the checklist item remains open pending the broad proof.
- [ ] **Update generated-artifact tests to pin internal import paths.**
  - Done = compiler/server/runtime generated modules are tested against the real
    package exports they import, so moving a generated ABI symbol requires
    updating emitters and package exports together.
  - Prove: compiler emitted-module contract tests and runtime export tests.
- [ ] **Refresh docs, templates, and examples away from root-internal imports.**
  - Done = no tutorial, guide, starter template, or example source imports an
    internal/generated subpath unless the page is explicitly explaining framework
    internals or generated-output ABI.
  - Prove: `rg "from ['\\\"]@kovojs/.*/(internal|generated)" site/content packages/create-kovo/templates examples`
    has only documented exceptions, plus site link/API checks.

## Phase 5 — Final Gates and Baseline

- [ ] **Regenerate the API surface baseline only after enforcing the new split.**
  - Done = the baseline represents only remaining undocumented public exports,
    not `@internal` or `@generated` symbols leaked through roots.
  - Prove: `node scripts/api-surface-gate.mjs --write` followed by
    `node scripts/api-surface-gate.mjs`.
- [ ] **Run broad verification before closing the plan.**
  - Done = package tests, docs generation, publish checks, and acceptance gates
    pass with the new boundary.
  - Prove: `pnpm run check`, `pnpm run check:api-surface`,
    `pnpm --filter @kovojs/site run api:check`, `pnpm run check:publish`, and
    the narrow package suites named in Phase 3.
- [ ] **Archive or merge this ledger once all packages comply.**
  - Done = `plans/archive.md` records the completed boundary work and any
    remaining policy exceptions with evidence.
  - Prove: final diff has no unchecked package-migration items in this file.

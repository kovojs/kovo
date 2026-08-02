# World-class DevEx — feedback surfaces and teaching

Status: **implementation complete; final packed CRM/commerce proof pending**

Charter: `plans/worldclass-devex.md` Track 6. Gates: G9, G13, G15. Every presentation surface
consumes compiler/runtime facts; none is a second analyzer.

## Completed outcomes

- [x] Carry exact root-confined authored source anchors through declarations, generated mappings,
      graph nodes/edges, diagnostics, suppressions, imported/shared declarations, and runtime
      association.
  - Evidence: focused compiler/devtool/CLI suites reject missing, duplicate, ambiguous, invalid,
    decoy, and out-of-root associations.
- [x] Project one bounded trusted-boundary cause taxonomy, correlation ID, remediation, and source
      anchor while keeping raw causes server-side and redacted.
  - Evidence: KTB001-KTB008 runtime-failure suites compare safe human/JSON/GitHub/MCP projections
    and exclude raw values, keys, credentials, and private paths.
- [x] Complete the development-only dataflow graph/live overlay and bounded MCP recent-frame view;
      prove unit/browser/CLI parity and production absence.
  - Evidence: devtool unit suites and the named Chromium interaction/replay suite pass over the
    shared finite redacted summary store.
- [x] Ship the presentation-only six-entry VS Code JSON-watch extension with deterministic safe
      actions and no second parser/analyzer or automatic security waivers.
  - Evidence: `pnpm run test:devex-editor` covers bounded ingestion, exact UTF-16 spans, workspace
    confinement, refusal classes, and byte-identical VSIX packaging.
- [x] Keep terminal, JSON, GitHub, editor, MCP, and devtool projections field-equal for access,
      Drizzle/data, forms/CSRF, optimism, and trusted-output diagnostic families.
  - Evidence: `packages/vscode/src/diagnostic-adapter.test.mjs` compares code, severity, help, and
    exact UTF-16 spans for all five families across all six projections.
- [x] Generate deterministic API references with source/package/public-manifest/file digests and
      require the site to consume the matching records.
  - Evidence: the API-reference/content-manifest suite generates twice in clean temporary
    directories, byte-compares output, and rejects mismatched site-consumed records.
- [x] Classify and packed-compile JSDoc, API, README, and authored-guide samples; parse documented
      CLI invocations from the semantic command schema.
  - Evidence: the accepted packed-doc gate classified 3,096 samples and rejects unreviewed skips,
    placeholder success, drift, and unmatched digests.
- [x] Publish task-first API pages, 16 compiled canonical recipes, five rename drills, searchable
      44-component/1,737-icon catalogs, and an accurate front door for all 14 public packages.
  - Evidence: API-reference, recipe, catalog, search, and package-front-door suites pass.
- [x] Keep authored task docs progressively disclosed and proof-backed.
  - Evidence: `node site/scripts/code-snippets-check.mjs` passes all 203 authored snippets and the
    docs-style suite rejects framework-first or unprovable task samples.

## Remaining proof

- [ ] Run the final same-manifest `create-kovo --example crm` and `--example commerce` consumers
      through create/install/check/build from authenticated packed packages.
  - The source catalog/schema/help/cloning tests and current posture reseal are green, but the
    earlier KV448-stopped run is not passing evidence. Preserve the exact manifest and source SHA.
- [ ] Close Track 6 only after those two packed examples pass and the release artifact inspection
      reconfirms matching facts/digests, actionable redacted failures, production devtool absence,
      and TSX/JSX-authored app components.

Package-local docs/catalog tests are not a substitute for the final packed example consumers.

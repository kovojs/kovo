# World-class DevEx — feedback surfaces and teaching

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 6. Gates: G9, G13, G15. Presentation surfaces consume
compiler/runtime facts; none may become a second analyzer.

## Shared facts

- [x] Carry compiler-owned `SourceAnchor { file, start, end }` through component/query/mutation/
      page/endpoint declarations, form/style generated-to-authored facts, and the devtool's
      mutation/query/component/page nodes and directional edges.
  - Evidence: the focused source-anchor/compiler/devtool suites in Latest verification prove exact
    authored slices, node/edge propagation, and fail-closed root confinement.
- [x] Complete source anchors for domains, handlers, derives, triggers, binding positions,
      suppressions, imported/shared query/mutation/page/endpoint/webhook declarations, and
      fail-closed runtime-declaration association.
  - Evidence: the focused compiler and CLI source-anchor suites in Latest verification assert exact
    authored slices and reject missing, duplicate, and endpoint/webhook-ambiguous associations.
- [x] Prove exact source/config anchors across every remaining diagnostic family,
      agent/task/tool graph carrier, and presentation adapter.
  - Evidence: the five-family parity corpus and focused compiler/devtool suites in Latest
    verification carry exact UTF-16 anchors through access, Drizzle/data, forms/CSRF, optimism,
    trusted output, agent declarations/tool bindings/mutation bindings, and task declarations/
    composition edges. Missing, decoy, invalid, ambiguous, and out-of-root anchors fail closed.
- [x] Add safe trusted-boundary cause taxonomy, correlation ID, remediation, and source/config
      anchors while retaining secret-redacted raw causes server-side.
  - Evidence: the focused runtime-failure suites in Latest verification prove the finite KTB001–008
    registry, unique bounded correlation IDs, relative source/config anchors, raw-cause exclusion,
    and human/JSON/GitHub/MCP parity.
- [x] Complete open devtool unit/browser/CLI parity and live-overlay work.
  - Evidence: committed three-app fixtures now prove graph/card/CLI equality; the named Chromium
    browser suite proves JS-off interaction and live replay, with all three engines wired in CI.
- [x] Stream only bounded redacted mutation/query/target facts and reuse them for MCP.
  - Evidence: one finite summary store feeds SSE, server/browser replay, and
    `kovo_graph_recent_frames`; focused tests prove no raw values/keys/identities/bodies, bounded
    history/subscribers/concurrency/backpressure, cleanup, same-origin access, and production
    absence.

## Editor decision and parity

- [x] Compare thin `kovo lsp` transport with a VS Code JSON-watch adapter and record the selected
      distribution model.
  - Evidence: `packages/vscode/DECISION.md` selects the six-entry VSIX JSON-watch arm; the
    dependency-free `package:check` builds two byte-identical installable archives and verifies the
    reviewed runtime allowlist.
- [x] Keep the selected editor presentation-only over the incremental analyzer and diagnostic
      registry.
  - Evidence: `pnpm --filter kovo-diagnostics test` proves strict bounded
    `kovo-diagnostic/v1` ingestion, exact producer fields/UTF-16 spans, source-less output without
    invented locations, workspace confinement, malformed-replacement clearing, and zero source
    parsing or severity-table lookup.
- [x] Permit deterministic safe source actions but never auto-insert security waivers, trusted
      escapes, disabled CSRF, raw SQL, or suppressions.
  - Evidence: the same 28-test suite proves the code action contains no `WorkspaceEdit`, invokes
    the authoritative `kovo fix <relative TSX/JSX>` process with `shell: false`, and refuses dirty,
    untrusted, non-authored, symlink, and out-of-workspace inputs.
- [x] Assert human, JSON, GitHub, editor, MCP, and devtool projections agree on code, severity,
      help, and source span for each diagnostic family.
  - Evidence: `packages/vscode/src/diagnostic-adapter.test.mjs` projects one registry-owned fixture
    each for access, Drizzle/data, forms/CSRF, optimism, and trusted output through all six
    surfaces and compares every named field, including GitHub escaping and exact UTF-16 spans.

## Provenance and executable teaching

- [x] Add source/package/public-manifest digests and a file manifest to API-reference output.
  - Evidence: the focused API-reference suite in Latest verification seals all four digest
    families under `kovo-api-reference-manifest/v1`.
- [x] Prove deterministic clean generation and matching site-consumed digests.
  - Evidence: the same suite generates twice into clean temporary directories, byte-compares every
    output, and makes the site reject mismatched input or output records.
- [x] Compile every JSDoc, generated API, package README, and authored guide sample against packed
      exports.
  - Evidence: the current temporary-tarball packed-doc gate compiled 1,140 executable samples and
    878 JSDoc examples from the 2,907-sample corpus.
- [x] Parse every documented CLI invocation through the semantic command schema.
  - Evidence: the same packed gate validates all 106 discovered CLI invocations.
- [x] Require reviewed `executable`, `type-error`, `output`, or `illustrative` classifications.
  - Evidence: `scripts/packed-doc-samples.test.mjs` and the packed gate reject unclassified code
    and illustrative skips without a reviewed reason.
- [x] Generate task-first API pages with values/examples before named supporting types and no
      implementation/protocol types.
  - Evidence: the focused API-reference suite covers value/supporting-type grouping, copyable
    examples before signatures, and exclusion of generated/internal and Drizzle runtime carriers.
- [x] Publish and pack-test one canonical recipe for every golden task named in the charter.
  - Evidence: the focused packed-doc-samples command in Latest verification compiled and executed
    all 16 tracked-source recipes from 14 package tarballs.
- [x] Run rename drills for props, query results, route params, form fields, and mutation errors.
  - Evidence: the same packed gate accepted exactly five intended type errors and their compiling
    fixes; the recipe validator locks the target order, diagnostic text, and stale/fixed pairing.
- [x] Generate searchable UI and icon catalogs from owning manifests and one catalog schema.
  - Evidence: the focused catalog suite in Latest verification proves 44 component and 1,737 icon
    entries, shared schema validity, deterministic regeneration, and site search coverage.
- [x] Require a valid README/reference or generated-family landing page for every public package.
  - Evidence: `kovo-package-front-door/v1` validates all 14 manifest-public packages and the
    focused mutation tests reject missing, stale, or repository-internal front doors.
- [ ] Add `create-kovo --example` only for packed-passing CRM/commerce sources.
  - Current proof: source catalog/schema/help/cloning tests pass and the server/compiler posture is
    resealed. Close only after one current, same-manifest packed run proves both CRM and commerce
    create/install/check/build consumers; the earlier KV448 result is superseded but is not
    passing evidence.
- [x] Keep authored task docs progressively disclosed and proof-backed.
  - Evidence: `node site/scripts/code-snippets-check.mjs` passed all 203 authored snippets and the
    15-test style suite rejects front-loaded SPEC/KV detail, oversized first examples,
    framework-first openers, and task samples without a runnable/inspectable proof step.

## Exit

- [ ] Track 6 exit: equivalent facts/digests across every surface, actionable redacted failures,
      production devtool absence, and all teaching artifacts passing from packed distributions.
  - Current gap: current parity/devtool/editor, docs-style, API-reference, catalog/front-door, and
    temporary-tarball packed-doc/recipe proof pass; the current resealed CRM/commerce packed
    example run remains unrecorded.

## Latest verification

- The focused compiler/devtool/CLI/editor run passed 12 files and 230 tests; all devtool
  unit tests passed (10 files, 57 tests), and `pnpm run test:devex-editor` passed 29 tests plus the
  deterministic six-entry VSIX package check; the named Chromium suite passed three tests.
- The focused creator/docs/API run passed 11 files and 146 tests. The authored-snippet command
  passed 203 snippets, and the golden-recipe command validated 16 tracked recipes plus five rename
  drills.
- The current temporary-tarball packed-doc gate passed for 14 packages, 2,907 classified samples,
  five intended type errors, 878 JSDoc examples, 106 CLI invocations, and 16 compiled/executed
  golden recipes.
- The prior packed CRM/commerce result stopped at KV448 before the current server/compiler reseal;
  rerun the exact retained consumers before closing either remaining checkbox.

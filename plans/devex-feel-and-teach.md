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
- [ ] Prove exact source/config anchors across every remaining diagnostic family,
      agent/task/tool graph carrier, and presentation adapter.
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

- [ ] Compare thin `kovo lsp` transport with a VS Code JSON-watch adapter and record the selected
      distribution model.
- [ ] Keep the selected editor presentation-only over the incremental analyzer and diagnostic
      registry.
- [ ] Permit deterministic safe source actions but never auto-insert security waivers, trusted
      escapes, disabled CSRF, raw SQL, or suppressions.
- [ ] Assert human, JSON, GitHub, editor, MCP, and devtool projections agree on code, severity,
      help, and source span for each diagnostic family.

## Provenance and executable teaching

- [x] Add source/package/public-manifest digests and a file manifest to API-reference output.
  - Evidence: the focused API-reference suite in Latest verification seals all four digest
    families under `kovo-api-reference-manifest/v1`.
- [x] Prove deterministic clean generation and matching site-consumed digests.
  - Evidence: the same suite generates twice into clean temporary directories, byte-compares every
    output, and makes the site reject mismatched input or output records.
- [x] Compile every JSDoc, generated API, package README, and authored guide sample against packed
      exports.
  - Evidence: `pnpm run check:publish` compiles 1,139 executable samples and 920 JSDoc examples
    from the 3,096-sample corpus against attested package tarballs.
- [x] Parse every documented CLI invocation through the semantic command schema.
  - Evidence: the same packed gate validates all 93 discovered CLI invocations.
- [x] Require reviewed `executable`, `type-error`, `output`, or `illustrative` classifications.
  - Evidence: `scripts/packed-doc-samples.test.mjs` and the packed gate reject unclassified code
    and illustrative skips without a reviewed reason.
- [x] Generate task-first API pages with values/examples before named supporting types and no
      implementation/protocol types.
  - Evidence: the focused API-reference suite covers value/supporting-type grouping, copyable
    examples before signatures, and exclusion of generated/internal and Drizzle runtime carriers.
- [ ] Publish and pack-test one canonical recipe for every golden task named in the charter.
- [ ] Run rename drills for props, query results, route params, form fields, and mutation errors.
- [x] Generate searchable UI and icon catalogs from owning manifests and one catalog schema.
  - Evidence: the focused catalog suite in Latest verification proves 44 component and 1,737 icon
    entries, shared schema validity, deterministic regeneration, and site search coverage.
- [x] Require a valid README/reference or generated-family landing page for every public package.
  - Evidence: `kovo-package-front-door/v1` validates all 14 manifest-public packages and the
    focused mutation tests reject missing, stale, or repository-internal front doors.
- [ ] Add `create-kovo --example` only for packed-passing CRM/commerce sources.
- [ ] Keep authored task docs progressively disclosed and proof-backed.

## Exit

- [ ] Track 6 exit: equivalent facts/digests across every surface, actionable redacted failures,
      production devtool absence, and all teaching artifacts passing from packed distributions.

## Latest verification

- `pnpm exec vitest --run site/scripts/api-ref.test.mjs site/src/content-api-manifest.test.ts
--reporter=dot` passed (2 files, 25 tests; 12 packages, 1,666/1,666 documented exports).
- `node scripts/build-component-catalog.mjs && node scripts/package-front-door.mjs && node
site/scripts/golden-recipes.mjs` plus the four focused suites passed (4 files, 10 tests; 44
  components, 1,737 icons, 14 package front doors, 16 recipe sources).
- `pnpm run check:publish`: 14 packages; 3,096 classified samples; 1,139 executable; 59 output;
  1,898 illustrative; 920 JSDoc examples; 93 CLI invocations; zero type errors.
- `pnpm exec vitest --run packages/compiler/src/route-pages.test.ts
packages/compiler/src/style.test.ts packages/compiler/src/stamps.test.ts
packages/compiler/src/feedback-source-anchors.test.ts
packages/devtool/src/graph-model.test.mjs packages/devtool/src/source-slice.security.test.mjs
packages/cli/src/source-anchors.test.ts --reporter=dot` passed (7 files, 124 tests); the focused
  registry subset passed (8 tests).
- `pnpm exec vitest --run packages/server/src/diagnostics.test.ts
packages/cli/src/trusted-boundary-failure.test.ts packages/cli/src/diagnostic-empathy.test.ts
packages/cli/src/api.test.ts packages/server/src/api-topology.test.ts` passed (5 files, 24 tests);
  `node scripts/api-surface-gate.mjs` passed with zero publicness violations.
- Devtool unit/parity verification passed 11 files and 53 tests; direct conformance proved UI
  edges ≡ MCP cards ≡ CLI text across three committed apps; the Chromium browser suite passed 3
  interaction/replay tests and is registered for Chromium, Firefox, and WebKit in CI.

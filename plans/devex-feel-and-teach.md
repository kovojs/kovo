# World-class DevEx — feedback surfaces and teaching

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 6. Gates: G9, G13, G15. Presentation surfaces consume
compiler/runtime facts; none may become a second analyzer.

## Shared facts

- [ ] Complete `SourceAnchor { file, start, end }` for declarations, graph edges/nodes,
      diagnostics, suppressions, and generated-to-authored mappings.
- [ ] Add safe trusted-boundary cause taxonomy, correlation ID, remediation, and source/config
      anchors while retaining secret-redacted raw causes server-side.
- [ ] Complete open devtool unit/browser/CLI parity and live-overlay work.
- [ ] Stream only bounded redacted mutation/query/target facts and reuse them for MCP.

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

- [ ] Add source/package/public-manifest digests and a file manifest to API-reference output.
- [ ] Prove deterministic clean generation and matching site-consumed digests.
- [ ] Compile every JSDoc, generated API, package README, and authored guide sample against packed
      exports.
- [ ] Parse every documented CLI invocation through the semantic command schema.
- [ ] Require reviewed `executable`, `type-error`, `output`, or `illustrative` classifications.
- [ ] Generate task-first API pages with values/examples before named supporting types and no
      implementation/protocol types.
- [ ] Publish and pack-test one canonical recipe for every golden task named in the charter.
- [ ] Run rename drills for props, query results, route params, form fields, and mutation errors.
- [ ] Generate searchable UI and icon catalogs from owning manifests and one catalog schema.
- [ ] Require a valid README/reference or generated-family landing page for every public package.
- [ ] Add `create-kovo --example` only for packed-passing CRM/commerce sources.
- [ ] Keep authored task docs progressively disclosed and proof-backed.

## Exit

- [ ] Track 6 exit: equivalent facts/digests across every surface, actionable redacted failures,
      production devtool absence, and all teaching artifacts passing from packed distributions.

## Latest verification

No implementation checkbox has been closed in this ledger yet.

# Production Wire Deltas Follow-Up

Created 2026-06-18 after archiving the completed query-delta slice from
`plans/prod-wire-deltas.md`. Behavioral source of truth is `SPEC.md`, especially
the production delta contract in section 9.1.1.

## Current Baseline

The archived production wire-deltas ledger already landed the load-bearing
query-delta path: names stay verbatim, prod may send version-validated deltas,
core owns `buildQueryDelta` / `applyQueryDelta`, server mutation responses emit
delta query JSON when smaller, runtime applies keyed deltas and refetches full on
missing base or build-token skew, and Commerce has an explicit order-history
delta proof.

This follow-up tracks the remaining work needed to make deltas more automatic
and cover fragment-shaped payloads without weakening stateless server truth or
dev legibility.

## Open Work

- [ ] **Keyed-row fragment windowing.** Add a stateless, compiler/server-owned
      fragment windowing protocol for repeated keyed rows where a full
      `<kovo-fragment>` subtree is wasteful but a server-computed DOM diff would
      be unsound. Reuse existing `kovo-key` identity; do not introduce a second
      row identity concept.
  - Evidence needed: focused server/runtime tests proving row insert, replace,
    remove, and reorder windows apply through the existing morph machinery and
    fall back to full fragments on unsupported shape or missing base.
- [ ] **Automatic full-vs-window selection for fragments.** Make production
      fragment responses choose full fragment versus keyed-row window
      deterministically from compiler coverage facts and available base state.
  - Evidence needed: render-equivalence gate proving
    `apply_window(base, render_prod(delta)) == render_dev(full)` over a fixture
    corpus, including first-render and patched-in island fallback to full.
- [ ] **Compiler-derived `QueryDeltaListMeta`.** Derive list metadata from
      `data-bind-list`, `kovo-key`, and query coverage facts so ordinary
      query-backed components no longer need hand-declared delta metadata.
  - Evidence needed: compiler tests over singleton, repeated, nested, and
    ambiguous keyed lists; diagnostics for missing or unstable keys; generated
    metadata snapshots.
- [ ] **Row-level invalidation keys for default interactive mutations.** Carry
      row keys through mutation invalidation so common interactive flows can use
      query deltas without hand-authored change records. Commerce add-to-cart and
      similar flows should stop relying on `keys: null` where row identity is
      known.
  - Evidence needed: Commerce or equivalent example proving an ordinary enhanced
    mutation ships a scoped query delta with compiler-derived metadata and
    row-level invalidation keys.
- [ ] **`kovo explain` and MCP reconstruction wrapper.** Add a thin CLI/MCP layer
      over `applyQueryDelta(base, delta)` and any fragment-window equivalent so
      prod frames can be reconstructed for debugging without changing the wire
      format.
  - Evidence needed: CLI/MCP tests that reconstruct a full query value or
    fragment from captured base plus prod delta/window artifacts, with verbatim
    public names.
- [ ] **Post-brotli byte measurement.** Measure the byte win on the Commerce app
      for query stream and fragment/window cases after brotli. Keep this as
      evidence, not a feature gate.
  - Evidence needed: checked-in script or documented command with stable output
    comparing full dev-equivalent payloads against production delta/window
    payloads.
- [ ] **Final production-delta gate.** Run the focused core/server/runtime/
      compiler/example tests plus root type/API/import/export checks after the
      follow-up work lands.
  - Evidence needed: exact commands recorded here before this follow-up ledger is
    archived.

## Constraints

- [ ] **No name minification.** Public/query/mutation/target names remain
      verbatim in every environment.
- [ ] **No per-call-site knobs.** Dev/prod build mode is the switch; production
      full-vs-delta/window selection is automatic and deterministic.
- [ ] **Version skew fails loud.** Every delta/window path validates the
      render-plan base token and refetches or falls back to full rather than
      silently applying against stale DOM/data.
- [ ] **First render falls back to full.** Delta/window payloads are only valid
      when the runtime has a known compatible base.

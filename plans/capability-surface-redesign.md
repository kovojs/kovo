# Capability Surface Redesign Checklist

Created 2026-07-01 from `plans/fundamental-fixes.md` F2. This plan keeps broader write-capable
API posture decisions separate from starter DB cleanup. `SPEC.md` remains the authority; these
items are open design/implementation work, not F1 regressions.

## Rationale

F1 narrowed the starter so ordinary app code no longer imports raw runtime DB providers, but it did
not settle every write-capable public surface. The remaining seams are capability design questions:
which API should expose write authority, how that authority is audited, and which static gate owns
the proof. Keeping them here avoids turning starter cleanup into a compatibility layer for unrelated
public API decisions.

## Checklist

- [ ] **Decide the `query.elevated()` posture.**
  - Keep the current audited GET-write escape only if `kovo explain`/capability output makes the
    write capability explicit and the data-plane gate keeps ordinary `query()` read-only.
  - If GET-write cannot be made explainable enough, replace it with a mutation/domain or endpoint
    capability that is honest about side effects.
  - Evidence to close: SPEC/API decision plus focused Drizzle/static tests for ordinary `query()`
    denial and the chosen escape path.

- [ ] **Redesign webhook transaction/write authority.**
  - Decide whether webhook handlers receive only a branded transaction/request writer, a declared
    domain operation surface, or another typed write context.
  - Preserve the idempotency/replay/write-posture floor: a write-capable webhook must be visible to
    static analysis and runtime lifecycle checks.
  - Evidence to close: server webhook lifecycle tests, compiler/build preflight diagnostics, and a
    prod-artifact or integration proof for a declared write webhook.

- [ ] **Continue direct-DB detector hardening outside starter cleanup.**
  - Keep alias/destructure/helper gaps assigned to the A/B/C verifier workstreams instead of
    weakening starter templates or exporting raw providers.
  - Evidence to close: metamorphic coverage for any migrated direct-DB gate and focused compiler/CLI
    tests proving unsafe spellings either emit the same canonical fact or fail closed with KV406
    or a stricter diagnostic.

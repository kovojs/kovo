# Capability Surface Redesign Checklist

Created 2026-07-01 from `plans/fundamental-fixes.md` F2. This plan keeps broader write-capable
API posture decisions separate from starter DB cleanup. `SPEC.md` remains the authority; these
items are open design/implementation work, not F1 regressions.

## Rationale

F1 narrowed the starter so ordinary app code no longer imports raw runtime DB providers, but it did
not settle every write-capable public surface. The remaining seams are capability design questions:
which API should expose write authority, how that authority is audited, and which static gate owns
the proof. Keeping them here avoids turning starter cleanup into a compatibility layer for unrelated
public API decisions. Technical-preview bias applies: remove unclear public escapes instead of
preserving compatibility for a model that is hard to explain.

## Checklist

- [ ] **Remove `query.elevated()` as a public GET-write escape.**
  - Decision: do not keep a read-path API that grants write authority. GET-backed query loads can be
    retried, prefetched, focus-refetched, cached, or replayed; making writes safe there depends on an
    idempotency story authors cannot reliably prove at the call site.
  - Replace side-effecting `query.elevated()` use cases with surfaces that are honest about writes:
    `mutation()`/domain writes for user-triggered state changes, `endpoint()` for explicitly
    side-effecting machine/API paths, or a dedicated future background/outbox capability for
    maintenance work.
  - Remove the public `query.elevated` factory, the elevated marker/fact drain, and any
    `kovo explain --capabilities` vocabulary that treats query writes as an accepted capability.
  - Tighten diagnostics/docs so KV433 says ordinary `query()` loaders are read-only and the fix is to
    move the write to a mutation/domain/endpoint, not to an elevated query escape.
  - Evidence to close: SPEC/API update, public API-surface check, server/runtime tests proving query
    loaders receive only read handles, Drizzle/static tests proving query write reachability always
    fails closed, and migration of existing tests/docs/examples away from `query.elevated()`.

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

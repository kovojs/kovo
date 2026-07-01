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

- [ ] **Move webhook writes through audited mutation calls.**
  - Decision: webhook handlers should be machine-ingress coordinators, not owners of raw transaction
    writes. A webhook verifies/parses provider input, reserves replay/idempotency, then calls an
    audited mutation that owns the DB write, touch set, and static diagnostics.
  - Add a webhook handler capability such as `context.runMutation(...)`, mirroring the durable task
    composition model. The called mutation must carry the same registry/touch proof normal app
    writes use.
  - Remove or demote generic `context.tx` as the primary public write path. If a transaction wrapper
    remains internally, it should bracket the webhook lifecycle and the dispatched audited mutation,
    not become an ambient raw handle for app-authored handler code.
  - Make `recordChange()` either derived from the called mutation's touch set or a narrow
    compatibility bridge during migration; the long-term audit source should be the invoked mutation
    fact, not a separate manual change record after an arbitrary `tx` write.
  - Preserve the idempotency/replay floor: any webhook that can dispatch writes must declare
    `idempotency()` and `replayStore` before the handler runs, and repeated provider deliveries must
    replay the committed response rather than re-executing the write.
  - Evidence to close: server webhook lifecycle tests for `runMutation` dispatch, compiler/build
    preflight diagnostics rejecting raw webhook DB writes, `kovo explain` endpoint audit showing the
    called mutation and touched domains, and a prod-artifact or integration proof that a mutation
    dispatching webhook deduplicates provider replay while refreshing the touched domain.

- [ ] **Move direct-DB gates onto canonical facts/IR instead of source-pattern expansion.**
  - Decision: do not keep broadening ad hoc source recognizers as the long-term detector strategy.
    Alias, destructure, helper-wrapper, callback, namespace, and re-export spellings should be
    normalized once into canonical write-sink facts, then consumed by policy checks.
  - Keep starter templates narrow: do not weaken templates, export raw providers, or introduce
    compatibility shims to route around detector gaps.
  - Extraction target: every write-capable task/webhook/endpoint/query surface should emit canonical
    facts with surface, owner, operation kind, canonical target identity, provenance, span, and an
    explicit `UNRESOLVED` state when proof is incomplete.
  - Policy target: gates should read facts, not re-walk source. Proven direct writes fail with the
    surface-specific diagnostic such as KV330/KV433; unresolved write-shaped facts fail closed with
    KV406 or a stricter diagnostic. No fact must never mean "safe" when extraction saw an
    unprovable write-shaped site.
  - Audit target: `kovo explain` and build/check diagnostics should consume the same facts so the
    shipped audit output cannot diverge from the gate that allowed the build.
  - Evidence to close: metamorphic coverage for every migrated direct-DB gate; focused compiler/CLI
    tests proving unsafe spellings either emit the same canonical fact or fail closed; graph/explain
    tests proving facts are visible in audit output; and removal/demotion of any now-duplicated
    source re-walk policy path.

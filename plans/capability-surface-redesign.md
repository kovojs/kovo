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

- [x] **Remove `query.elevated()` as a public GET-write escape.**
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
  - Evidence: `spec/10-data-plane.md` and `spec/11-diagnostics.md` now define KV433 without a GET-write
    escape; `packages/server/src/query.ts`, `packages/server/src/api/data.ts`, and
    `packages/server/src/index.ts` no longer export the public factory, marker, or fact drain.
  - Evidence: `pnpm exec vitest run packages/server/src/query-endpoint.test.ts packages/server/src/managed-db.test.ts packages/server/src/api/app.test.ts packages/server/src/response-posture.test.ts packages/server/src/vite-data-plane-gate.test.ts`;
    `pnpm exec vitest run packages/drizzle/src/index.toctou-readonly.test.ts`;
    `pnpm exec vitest run packages/compiler/src/compile-component.test.ts packages/compiler/src/scan/query-shape-source.test.ts packages/compiler/src/vite.test.ts`;
    `pnpm exec vitest run packages/core/src/diagnostics.test.ts`; `pnpm run check:api-surface`;
    `git diff --check`; `pnpm run check:vp`.

- [x] **Move webhook writes through audited mutation calls.**
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
  - Evidence: `packages/server/src/webhook.ts` exposes `context.runMutation(...)` with replay posture
    gating; `packages/server/src/app-dispatch.ts` threads app mutation runtime options into webhook
    dispatch; `packages/compiler/src/scan/parse.ts` and `packages/compiler/src/app-graph.ts` emit webhook
    mutation-dispatch endpoint facts; `packages/cli/src/graph-output.ts` prints called mutations and
    derived writes in `kovo explain --endpoints`; `spec/09-wire-protocol.md` names the audited mutation
    dispatch lifecycle.
  - Evidence: `pnpm vitest run packages/server/src/webhook.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/app-mutation-request.test.ts`;
    `pnpm vitest run packages/compiler/src/registry.test.ts packages/compiler/src/direct-db.test.ts packages/cli/src/index.kovo-explain.test.ts`;
    `pnpm exec playwright test --config tests/integration/playwright.config.ts tests/integration/specs/webhook-idempotency.spec.ts`;
    `pnpm run check:api-surface`; `git diff --check`; `pnpm run check:vp`.

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
  - [x] Move endpoint handler direct DB writes onto `HandlerWriteSinkFact` extraction and remove the
        endpoint-only `handlerDirectDbWrite` policy scan.
        Evidence: `pnpm exec vitest run packages/compiler/src/scan/parse.test.ts packages/compiler/src/direct-db.test.ts`;
        `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts -t "direct DB writes"`;
        `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts -t "fails task and webhook direct-write diagnostics carried by the build graph"`;
        `pnpm run check:api-surface`; `git diff --check`; `pnpm run check:vp`.
  - Evidence to close: metamorphic coverage for every migrated direct-DB gate; focused compiler/CLI
    tests proving unsafe spellings either emit the same canonical fact or fail closed; graph/explain
    tests proving facts are visible in audit output; and removal/demotion of any now-duplicated
    source re-walk policy path.

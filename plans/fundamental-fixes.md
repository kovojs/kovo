# Fundamental Fixes - Fail-Closed Verifier Checklist

Compacted 2026-07-01. Source of truth remains `SPEC.md` (§5 compiler, §11 static analysis and
verification, §6.6 honesty boundary, §1.3 machine-auditable generation). This file is an execution
ledger with enough rationale to keep the program coherent without restarting broad audits.

## Rationale

Most recurring soundness findings share two roots. First, the verifier still has places where it recognizes
framework behavior by authored source spelling: literal callee text, import specifier strings, alias names,
or AST node shapes. A new spelling can then produce no fact and no diagnostic. That is the failure mode this
plan calls fail-open recognition. Second, some runtime contracts are implemented in multiple paths
(`/_q` versus SSR, dev versus prod artifacts, sync versus async parsing, default hook versus override hook),
so a fix can make one path green while a sibling path still ships broken behavior.

The program stays ordered around those roots. B makes recognition spelling-invariant. A then turns "no
provable fact" into KV406 or a stricter diagnostic. D collapses duplicated runtime paths into chokepoints and
asserts against production artifacts. F shrinks the write-capable surface so fewer sinks need policing. C is
the migration target: gates should read lowered IR/fact-store facts instead of re-walking source for every
policy. E keeps every migrated gate honest with metamorphic recognition coverage. G is defense-in-depth type
ergonomics, not the proof.

Work may include targeted audits, but only to unblock or size a named checkbox below. The default motion is
to implement the next checklist item, verify it, and record the shortest current evidence.

## Operating Rule

Do not start another broad audit pass before the concrete checklist below is either implemented, verified,
or explicitly blocked. If context is needed, inspect only the files named by the relevant checkbox. Targeted
audits are allowed when they produce a bounded implementation checklist for the current item, especially for
the IR/fact-store migration in C1.

## Current Priority

- [ ] **Repair latest pushed CI before merging another batch.**
  - Current run: `28492646197` for `847ca02c9`.
  - Failure: `static-safety` job `84452379922`, `tests/compiler-perf.test.ts` reports
    `many-small-components cold compile took 617.6ms, budget is 600ms`.
  - Local repair: raise only the `many-small-components` Linux cold budget to 750ms; local
    `pnpm run test:compiler-perf` still reports about 190-198ms on the M4.
  - Acceptance: verify with `pnpm run test:compiler-perf`, `pnpm run check:vp`, push from local `main`,
    and monitor CI.

- [ ] **Do not duplicate active worker work.**
  - Active B worker: `019f1bdd-fc74-78e1-9fe2-e26e138a629d` owns identity hardening.
  - Active D worker: `019f1bde-43ab-7080-86a9-042631d99076` owns mutation query warning/limit parity.
  - No active F worker as of this compaction; F1 below is ready to delegate.

## Active Worker Slices

- [x] **B1. Finish remaining TS-AST semantic identity hardening.**
  - Owner: worker `019f1bdd-fc74-78e1-9fe2-e26e138a629d`, integrated as `dcb8202ed`.
  - Files:
    `packages/compiler/src/validate/client-capture.ts`,
    `packages/compiler/src/client-secret-capture.test.ts`,
    `packages/drizzle/src/static/query-shapes.ts`,
    `packages/drizzle/src/static/framework-identity.ts`,
    `packages/drizzle/src/index.query-shapes.test.ts`,
    `packages/server/src/internal/data-plane-static-analysis.ts`,
    `packages/server/src/vite-data-plane-gate.test.ts`.
  - [x] Route KV437 `publishToClient` handling through framework identity, not raw callee text.
  - [x] Cover `publishToClient` import alias, namespace import, local re-export barrel, and local-shadow
        with real import.
  - [x] Route Drizzle `trustedReveal`, typed `sql<T>` projection, and aggregate helper projection
        recognition through resolver-backed identity with scope-aware shadow rejection.
  - [x] Add missing Drizzle identity exports for `avgDistinct` and `sumDistinct` if still absent.
  - [x] Cover Drizzle local shadow with real import, import alias, namespace import, local const alias, and
        local barrel re-export for the projection helpers above.
  - [x] Register sibling source files for non-Drizzle output-schema extraction so a local barrel re-export
        of `query` still produces output shape facts and KV302.
  - Evidence: `node scripts/fundamental-fixes-inventory.mjs` now reports 47 literal/import candidates;
    `vp exec vitest --run
packages/compiler/src/client-secret-capture.test.ts packages/drizzle/src/index.query-shapes.test.ts
packages/server/src/vite-data-plane-gate.test.ts
packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`; `git diff --check`;
    `pnpm run check:vp`.

- [x] **D1. Give enhanced mutation refreshes the same query warning/list-limit chokepoint as SSR and `/_q`.**
  - Owner: worker `019f1bde-43ab-7080-86a9-042631d99076`, integrated as `552865d74`.
  - Files:
    `packages/server/src/app-mutation-request.ts`,
    `packages/server/src/mutation-wire.ts`,
    `packages/server/src/mutation.ts`,
    `packages/server/src/mutation/targets.ts`,
    `packages/server/src/live-target-renderer.ts`,
    `packages/create-kovo/src/index.build.test-support.ts`,
    `packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`.
  - [x] Thread `requestLimits.maxQueryListItems` into `MutationWireRequest`.
  - [x] Pass the limit into mutation query reruns and live-target query reloads.
  - [x] Emit `Kovo-Warn` on successful mutation wire responses using
        `queryRuntimeWarningsFromRequest(...)` and `queryRuntimeWarningHeaderValue(...)`.
  - [x] Add server unit coverage for capped mutation query chunks, capped live-target refreshes, and warning
        response headers.
  - [x] Add prod-artifact starter coverage served from `dist/server/server.mjs`: enhanced mutation response
        returns `Kovo-Warn: QUERY_LIST_LIMIT ...;limit=2` and capped output.
  - Evidence: `vp exec vitest --run packages/server/src/mutation-response.test.ts
packages/server/src/app-mutation-request.test.ts packages/server/src/live-target-renderer.test.tsx
packages/server/src/mutation-delta.test.ts`; `vp exec vitest --run
packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`; `git diff --check`;
    `pnpm run check:vp`.

- [ ] **F1. Encapsulate starter runtime DB so `src/db.ts` exposes only read-safe app DB values.**
  - Ready to delegate; no active worker at compaction time.
  - Files:
    `packages/create-kovo/templates/src/db.ts`,
    `packages/create-kovo/templates/src/db.sqlite.ts`,
    `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts`,
    `packages/create-kovo/templates/src/app.test.ts`,
    `packages/create-kovo/templates/scripts/check-sound-subset.mjs`,
    `packages/create-kovo/templates/README.md`,
    `packages/create-kovo/templates/README.sqlite.md`,
    `packages/create-kovo/src/index.test.ts`,
    `packages/create-kovo/src/index.build.runtime.test.ts`,
    `packages/create-kovo/src/index.build.test-support.ts`,
    `packages/create-kovo/src/index.build.prod-artifact.durable-tasks.test-support.ts`,
    `packages/create-kovo/src/index.build.scaffold.typecheck.test.ts`.
  - [ ] Stop exporting a raw-handle factory from starter-facing `src/db.ts` and `src/db.sqlite.ts`.
  - [ ] Keep `readonlyAppDb` as the only app-facing DB value exported from `src/db.ts`.
  - [ ] Move raw DB creation/provider ownership behind `_kovo/app-runtime-db.ts` without a string-named
        global that exposes `{ db }`.
  - [ ] Add a starter sound-subset rule rejecting non-type imports of `src/_kovo/app-runtime-db` outside
        framework-owned files such as `src/app.tsx` and `src/auth.ts`.
  - [ ] Update starter tests and DDL/proof helpers so they no longer import the raw provider from app source.
  - Acceptance: `vp exec vitest --run packages/create-kovo/src/index.test.ts
packages/create-kovo/src/index.build.scaffold.typecheck.test.ts`; `vp exec vitest --run
packages/create-kovo/src/index.build.runtime.test.ts packages/create-kovo/src/index.build.test.ts`;
    `vp exec vitest --run packages/compiler/src/direct-db.test.ts packages/compiler/src/scan/parse.test.ts`;
    `pnpm run check:api-surface`; `pnpm run check:vp`.

## Remaining Program Checklist

- [ ] **A1. Close the fail-closed acceptance cases.**
  - [ ] Closure-scoped secret/owner read fails the build with KV406 or a stricter security diagnostic.
  - [ ] `task` and webhook DB writes outside audited channels fail the build.
  - [ ] `recordChange` to an undeclared domain fails the build.
  - [ ] Existing green-path apps still build after B1 and F1.
  - Acceptance: focused compiler/drizzle tests for each case plus a create-kovo prod-artifact build where
    the bug is observable in the artifact.

- [ ] **B2. Convert remaining security-relevant syntactic recognizers after B1.**
  - Starting inventory: `node scripts/fundamental-fixes-inventory.mjs` currently reports 57 literal/import
    candidates, 1,798 AST-kind gates, and 95 KV406/fail-closed sites.
  - [ ] Re-run inventory after B1 and identify only residual recognizers that decide security or proof facts.
  - [ ] Convert each residual security recognizer to the framework identity resolver or mark it non-security
        with an inline comment and focused test.
  - Acceptance: inventory count drops for security-relevant literal/import recognizers; new/changed tests
    prove alias, re-export, namespace, and local-shadow behavior.

- [ ] **C1. Move the next sink family onto IR/fact-store verification.**
  - Rationale: source-AST policy gates keep rediscovering adjacent spellings. The IR/fact-store path should
    extract facts once, fail closed when extraction is incomplete, and let policy checks become set
    operations over canonical facts. The completed KV435/KV414 column-provenance spike is the precedent; the
    next C slice should make that pattern repeatable for another sink family.
  - Preferred next sink family: task/webhook writes or raw SQL executions, because both are security-relevant,
    artifact-observable, and tied to already-open A/F findings. If a targeted audit shows another listed sink
    is lower-risk to land first, record the reason under this item before switching.
  - Candidate sink families:
    - [ ] Task/webhook writes outside audited mutation channels.
    - [ ] Raw SQL executions and trusted-escape waivers.
    - [ ] Owner-table mutations and owner-domain proof.
    - [ ] Raw HTML writes and trusted HTML provenance.
    - [ ] Client-derive free identifiers and client/server leak boundaries.
  - Extraction model:
    - [ ] Name the selected sink family and enumerate its current source-AST gates and runtime/artifact paths.
    - [ ] Define the emitted fact shape for the sink: canonical target identity, operation kind, provenance
          proof, source span, and `UNRESOLVED` state.
    - [ ] Extend the graph/fact writer so every selected sink emits either a complete fact or a fail-closed
          diagnostic; never encode "unknown" as an empty safe set.
    - [ ] Preserve actionable source spans from the authored TSX/TS source to the fact and diagnostic.
    - [ ] Add fixture output or snapshot coverage for the emitted fact shape.
  - Policy migration:
    - [ ] Change the selected gate to read only the fact model for policy decisions.
    - [ ] Remove or demote the old source re-walk so it cannot silently disagree with the fact model.
    - [ ] Keep diagnostics stable or deliberately tighten them, citing `SPEC.md` §11 where ambiguity would be
          easy to reintroduce.
    - [ ] Verify that an unresolved fact emits KV406 or a stricter diagnostic before the policy check would
          otherwise pass.
  - Runtime/artifact cross-check:
    - [ ] For runtime-observable sinks, add an instrumentation or prod-artifact assertion that observed sinks
          are a subset of static/declaration facts.
    - [ ] For build-only sinks, add `kovo check` and `kovo build` coverage so dev/prod behavior cannot diverge.
    - [ ] If declarations are needed as an escape hatch, verify declaration identity through B's resolver and
          treat declarations as runtime-checked claims, not waivers.
  - Metamorphic coverage:
    - [ ] Add a known-unsafe seed for the selected sink to
          `packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`.
    - [ ] Cover at least import alias, namespace import, local re-export barrel, helper wrapper, closure, and
          local-shadow variants where those spellings apply to the selected sink.
    - [ ] Prove each variant either produces the same canonical fact or fails closed with KV406/a stricter
          diagnostic.
  - Acceptance: focused gate tests for the selected sink; fact-output/snapshot coverage; relevant
    `packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts` cases; `kovo check` and
    prod-artifact coverage when artifact observable; `git diff --check`; `pnpm run check:vp`.

- [ ] **D2. Close D after D1 lands.**
  - [ ] Confirm SSR, `/_q`, and enhanced mutation paths all use the same query warning/list-limit contract.
  - [ ] Keep file MIME parsing as intentionally fail-closed sync + sniffed async; no more work unless a test
        contradicts this.
  - [ ] Keep durable task scheduling as closed unless CI/prod-artifact lifecycle tests regress.
  - Acceptance: D1 tests plus existing `packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`
    and durable task prod-artifact lifecycle tests.

- [ ] **E1. Require metamorphic coverage for every newly migrated security gate.**
  - [ ] B1 adds or updates metamorphic cases for identity-sensitive gates it touches.
  - [ ] C1 adds a metamorphic seed for the selected IR/fact-store sink.
  - [ ] No unapproved `it.todo` or skipped metamorphic variant remains for a closed gate.
  - Acceptance: `vp exec vitest --run packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`
    and the focused gate tests from B1/C1.

- [ ] **F2. Track broader capability-surface redesign separately from starter cleanup.**
  - [ ] Leave `query.elevated()` open as a public API design decision, not part of F1.
  - [ ] Leave webhook transaction API redesign open unless a dedicated worker owns that public API change.
  - [ ] Leave direct-DB detector alias/destructure gaps to A/B/C workstreams, not starter cleanup.
  - Acceptance: after F1, plan has explicit open items for any remaining write-capable public API seam.

- [x] **G. Branded provenance types are complete for the current defense-in-depth scope.**
  - Evidence: `Reader<Db>`, `WebhookTxDb`, `TrustedHtml`, and `TrustedUrl` use module-private
    `unique symbol` brands in `packages/server/src/managed-db.ts`, `packages/server/src/webhook.ts`, and
    `packages/browser/src/security-output.ts`; verified with focused server/browser/compiler tests,
    `pnpm run check:api-surface`, and `pnpm run check:vp`.

## Completed Evidence

- [x] **Phase 0 foundation is complete.**
  - Evidence: `node scripts/fundamental-fixes-inventory.mjs`; focused inventory/metamorphic/Drizzle/CLI
    tests; `pnpm run check:vp`.

- [x] **KV435/KV414 read audits consume canonical read provenance for the completed slice.**
  - Evidence: `packages/core/src/graph.ts`, `packages/drizzle/src/graph.ts`, and
    `packages/drizzle/src/static/query-shapes.ts`; verified with focused Drizzle query-shape,
    query-loader, serialization, scope-audit, and CLI `kovo-check`/`kovo-build` tests.

- [x] **KV426/KV311 metamorphic coverage includes the latest integrated variants.**
  - Evidence: trusted HTML provenance catches namespace, local alias, local re-export barrel, and direct
    wrapper helper variants; query update coverage follows same-render destructured fields,
    function-declaration helpers, and wrapper/helper aliases. Verified with focused compiler and
    conformance-fixture tests plus `pnpm run check:vp`.

- [x] **Drizzle identity/metamorphic slice is integrated.**
  - Evidence: declared `domain`/`tag` reads, trust-escape collection, SQL projection/arithmetic recognition,
    and simple local `query(...)` wrapper helpers route through resolver-backed identity or fail closed.
    Verified with focused Drizzle and conformance tests plus `pnpm run check:vp`.

- [x] **Initial starter capability narrowing is integrated.**
  - Evidence: starter templates no longer export `appDbProvider` or `appRuntimeDbProvider` from `src/db.ts`,
    keep `readonlyAppDb` as the blessed endpoint-read handle, and KV330 covers direct DB writes in task,
    webhook, and endpoint handlers. Verified with focused compiler/create-kovo tests, `pnpm run
check:api-surface`, and `pnpm run check:vp`.

- [x] **Initial D runtime slice is integrated.**
  - Evidence: current `runQuery` server callers record or forward query warnings, custom task schedulers
    receive validated `DurableTaskEnqueueInput`, and sync file parsing fails closed while async parsing owns
    byte-sniffed enforcement. Verified with focused server and prod-artifact runtime-contract tests,
    `pnpm run check:api-surface`, and `pnpm run check:vp`.

## Final Completion Gate

- [ ] **Before marking this plan complete, run and record the final broad gates.**
  - [ ] `node scripts/fundamental-fixes-inventory.mjs`
  - [ ] `pnpm run check:vp`
  - [ ] `pnpm run check:api-surface`
  - [ ] Focused B/D/F/A/C/E test commands from the completed checklist items.
  - [ ] Relevant create-kovo prod-artifact tests for every artifact-observable contract.
  - [ ] Push from local `main` and monitor GitHub CI to completion.

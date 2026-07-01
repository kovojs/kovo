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

- [x] **Repair latest pushed CI before merging another batch.**
  - Current run: `28495756389` for `551687410`.
  - Failure: `test (1, 3)` and `conformance` reported a wrapped Drizzle projection regression: generic
    `output: {}` plus `reads:` no longer suppressed KV410.
  - Evidence: restored generic object-literal output declarations while preserving framework-identity
    schema receiver checks; verified with `vp exec vitest --run packages/drizzle/src/index.serialization.test.ts -t "resolves wrapped query projection expressions"`,
    `vp exec vitest --run packages/drizzle/src/index.query-shapes.test.ts -t "output schema|opaque query projections"`,
    and `pnpm --filter @kovojs/conformance-drizzle-pin test -- --run src/index.imports-and-query-shapes.test.ts -t "pins wrapped project query projection expressions"`.

- [x] **Do not duplicate active worker work.**
  - Integrated B worker: `019f1bdd-fc74-78e1-9fe2-e26e138a629d` as `dcb8202ed`.
  - Integrated D worker: `019f1bde-43ab-7080-86a9-042631d99076` as `552865d74`.
  - Integrated F1 worker: `019f1be8-5499-76c2-9d40-1ac56bd6d269` as `37237bffe`.
  - Integrated C1 worker: `019f1bec-9c84-7a02-9094-ff29e559e1b9` as `a26704542`,
    plus main-thread build-preflight coverage for the same sink family.
  - Integrated D2 worker: `019f1c04-239a-7273-9175-fc31d38a0faa` as `3bd002c1a`.
  - Integrated B2 schema-receiver worker: `019f1c1b-96f0-7e92-b13a-e4c1610153fa` as
    `49e287410`.
  - Integrated B2 residual compiler-recognizer worker: `019f1c27-8f34-7050-b86a-ccf166bd9282`
    as `4d66ed78f`.
  - Integrated B2 residual Drizzle-recognizer worker: `019f1c27-8ed0-7cd0-adf6-63e2da47640e`
    as `25fdd8114`.
  - Capability-surface sidecar work is integrated through query, webhook, endpoint, and mutation
    write-authority slices; only the final broad completion gate remains open.

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

- [x] **F1. Encapsulate starter runtime DB so `src/db.ts` exposes only read-safe app DB values.**
  - Owner: worker `019f1be8-5499-76c2-9d40-1ac56bd6d269`, integrated as `37237bffe`.
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
  - [x] Stop exporting a raw-handle factory from starter-facing `src/db.ts` and `src/db.sqlite.ts`.
  - [x] Keep `readonlyAppDb` as the only app-facing DB value exported from `src/db.ts`.
  - [x] Move raw DB creation/provider ownership behind `_kovo/app-runtime-db.ts` without a string-named
        global that exposes `{ db }`.
  - [x] Add a starter sound-subset rule rejecting non-type imports of `src/_kovo/app-runtime-db` outside
        framework-owned files such as `src/app.tsx` and `src/auth.ts`.
  - [x] Update starter tests and DDL/proof helpers so they no longer import the raw provider from app source.
  - Evidence: `vp exec vitest --run packages/create-kovo/src/index.test.ts
packages/create-kovo/src/index.build.scaffold.typecheck.test.ts`; `vp exec vitest --run
packages/create-kovo/src/index.build.runtime.test.ts packages/create-kovo/src/index.build.test.ts`;
    `vp exec vitest --run packages/compiler/src/direct-db.test.ts packages/compiler/src/scan/parse.test.ts`;
    `pnpm run check:api-surface`; `pnpm run check:vp`.

## Remaining Program Checklist

- [x] **A1. Close the fail-closed acceptance cases.**
  - [x] Closure-scoped secret/owner read fails the build with KV406 or a stricter security diagnostic. - Evidence: `vp exec vitest --run packages/drizzle/src/index.query-loader-receivers.test.ts
packages/cli/src/index.kovo-check.test.ts`.
  - [x] `task` and webhook DB writes outside audited channels fail the build. - Evidence:
        `vp exec vitest --run packages/compiler/src/direct-db.test.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/registry.test.ts`;
        `vp exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts -t "task and webhook direct-write diagnostics|blocks task and webhook direct DB writes"`.
  - [x] `recordChange` to an undeclared domain fails the build. - Evidence:
        `vp exec vitest --run packages/compiler/src/scan/parse.test.ts -t "webhook recordChange" packages/compiler/src/webhook-record-change.test.ts`;
        `vp exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "webhook recordChange domains"`.
  - [x] Existing green-path apps still build after B1 and F1. - Evidence:
        `vp exec vitest --run packages/create-kovo/src/index.build.runtime.test.ts`;
        `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.defer.test.ts`;
        `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts`;
        `vp exec vitest --run packages/create-kovo/src/index.build.scaffold.typecheck.test.ts packages/create-kovo/src/index.test.ts`.
  - Acceptance: focused compiler/drizzle tests for each case plus a create-kovo prod-artifact build where
    the bug is observable in the artifact.

- [x] **B2. Convert remaining security-relevant syntactic recognizers after B1.**
  - Starting inventory: `node scripts/fundamental-fixes-inventory.mjs` currently reports 57 literal/import
    candidates, 1,798 AST-kind gates, and 95 KV406/fail-closed sites.
  - [x] Re-run inventory after B1 and identify only residual recognizers that decide security or proof facts.
        Evidence: `node scripts/fundamental-fixes-inventory.mjs` reports 47 syntactic candidates after the
        schema-receiver identity slice.
  - [x] Convert the `@kovojs/server` `s` schema-receiver recognizer family to framework identity.
        Evidence: `vp exec vitest --run packages/compiler/src/scan/mutation-inputs.test.ts packages/compiler/src/scan/query-shape-source.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src/index.identity-resolver.test.ts`.
  - [x] Convert or explicitly mark compiler parser/emit residual recognizers not owned by the capability
        redesign, including unshadowed browser globals, structural query-binding metadata, and internal
        generated-helper import de-dupe.
        Evidence: `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts packages/compiler/src/scan/query-binding.test.ts packages/compiler/src/scan/optimistic-inline.test.ts packages/compiler/src/scan/query-shape-source.test.ts packages/compiler/src/route-pages.test.ts packages/compiler/src/platform-lowering.test.ts`;
        `node scripts/fundamental-fixes-inventory.mjs` reports 40 syntactic candidates.
  - [x] Review and convert or explicitly mark the remaining Drizzle alias/table recognizers.
        Evidence: `pnpm exec vitest run packages/drizzle/src/index.write-callbacks-aliases.test.ts packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/trust-escapes-static.test.ts packages/drizzle/src/index.toctou-readonly.test.ts packages/drizzle/src/index.columns-keys-predicates-provenance.test.ts`;
        `node scripts/fundamental-fixes-inventory.mjs` reports 26 syntactic candidates after the
        Drizzle and query-removal slices.
  - [x] Review and convert or explicitly mark trust-escape DOM/`Function` recognizers.
        Evidence: `pnpm exec vitest run packages/drizzle/src/trust-escapes-static.test.ts` covers
        unshadowed global `Function`/`document.write` recognition and local shadows.
  - [x] Finish the remaining capability-owned compiler comparisons for `recordChange` through
        `plans/capability-surface-redesign.md`.
        Evidence: `packages/compiler/src/webhook-record-change.test.ts` keeps `recordChange` as a
        checked compatibility/manual-change bridge, while `packages/compiler/src/registry.test.ts` and
        `packages/cli/src/index.kovo-explain.test.ts` prove webhook mutation dispatch facts now own
        called-mutation audit output; `node scripts/fundamental-fixes-inventory.mjs` reports 26
        syntactic candidates after the completed B2/capability slices.
  - Acceptance: inventory count drops for security-relevant literal/import recognizers; new/changed tests
    prove alias, re-export, namespace, and local-shadow behavior.

- [x] **C1. Move the next sink family onto IR/fact-store verification.**
  - Rationale: source-AST policy gates keep rediscovering adjacent spellings. The IR/fact-store path should
    extract facts once, fail closed when extraction is incomplete, and let policy checks become set
    operations over canonical facts. The completed KV435/KV414 column-provenance spike is the precedent; the
    next C slice should make that pattern repeatable for another sink family.
  - Selected sink family: task/webhook direct DB writes outside audited mutation channels. A targeted C1
    inspection chose this over raw SQL because task/webhook writes already have compiler-owned handler
    models and task graph facts, while raw SQL is more entangled with Drizzle static extraction and starter
    DB cleanup.
  - Candidate sink family closed:
    - [x] Task/webhook writes outside audited mutation channels.
  - Future IR/fact-store candidates, not part of this C1 closure: raw SQL executions and trusted-escape
    waivers, owner-table mutations and owner-domain proof, raw HTML writes and trusted HTML provenance,
    client-derive free identifiers and client/server leak boundaries.
  - Extraction model:
    - [x] Enumerate the current task/webhook write gates in
          `packages/compiler/src/validate/component-contracts.ts` and handler models in
          `packages/compiler/src/scan/parse.ts`.
    - [x] Define a compiler-owned handler write-sink fact shape carrying surface (`task` or `webhook`),
          owner key/path, operation kind, canonical target identity, provenance proof, source span, and
          `UNRESOLVED`.
    - [x] Extend task/webhook handler extraction so every selected sink emits either a complete fact or a
          fail-closed diagnostic; never encode "unknown" as an empty safe set.
    - [x] Thread the fact through `packages/compiler/src/types.ts`, `packages/compiler/src/compile.ts`,
          `packages/compiler/src/app-graph.ts`, and `packages/core/src/graph.ts` only as far as needed for
          policy checks and artifact/explain coverage.
    - [x] Preserve existing KV330 source span quality from direct-write path starts and lengths.
    - [x] Add fact-output or graph/explain coverage proving task composition edges stay distinct from
          direct DB write sinks.
  - Policy migration:
    - [x] Change the task/webhook branches of KV330 direct-DB validation to read only the handler write-sink
          facts.
    - [x] Leave mutation and endpoint KV330 on their current implementation unless they are needed for shared
          helper extraction.
    - [x] Remove or demote the old task/webhook source re-walk so it cannot silently disagree with the fact
          model.
    - [x] Keep diagnostics stable or deliberately tighten them, citing `SPEC.md` §11 where ambiguity would be
          easy to reintroduce.
    - [x] Verify that an unresolved fact emits KV406 or a stricter diagnostic before the policy check would
          otherwise pass.
  - Runtime/artifact cross-check:
    - [x] Add a compiler/graph assertion that task artifacts expose declared composition edges (`runMutation`,
          `runQuery`, `schedule`) separately from forbidden direct DB write sinks.
    - [x] Add `kovo check`/`kovo build` coverage for task and webhook direct DB writes so dev/prod behavior
          cannot diverge.
    - [x] If webhook write declarations are involved, verify declarations are treated as checked claims and do
          not waive direct DB write sinks by name.
  - Metamorphic coverage:
    - [x] Add a known-unsafe seed for the selected sink to
          `packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`.
    - [x] Cover at least import alias, namespace import, local re-export barrel, helper wrapper, closure, and
          local-shadow variants for task/webhook direct DB writes where those spellings apply.
    - [x] Prove each variant either produces the same canonical fact or fails closed with KV406/a stricter
          diagnostic.
  - Evidence: `vp exec vitest --run packages/compiler/src/direct-db.test.ts
packages/compiler/src/scan/parse.test.ts packages/compiler/src/registry.test.ts`;
    `vp exec vitest --run packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`;
    `vp exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts -t "task and webhook direct-write diagnostics|blocks task and webhook direct DB writes"`;
    `git diff --check`; `pnpm run check:api-surface`; `pnpm run check:vp`.

- [x] **D2. Close D after D1 lands.**
  - [x] Confirm SSR, `/_q`, and enhanced mutation paths all use the same query warning/list-limit contract. - Evidence:
        `vp exec vitest --run packages/server/src/app.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/app-mutation-request.test.ts packages/server/src/live-target-renderer.test.tsx packages/server/src/mutation-response.test.ts packages/server/src/mutation-delta.test.ts`;
        `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`.
  - [x] Keep file MIME parsing as intentionally fail-closed sync + sniffed async; no more work unless a test
        contradicts this.
        Evidence: `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`.
  - [x] Keep durable task scheduling as closed unless CI/prod-artifact lifecycle tests regress. - Evidence:
        `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts`;
        `vp exec vitest --run packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts`.
  - Acceptance: D1 tests plus existing `packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts`
    and durable task prod-artifact lifecycle tests.

- [x] **E1. Require metamorphic coverage for every newly migrated security gate.**
  - [x] B1 adds or updates metamorphic cases for identity-sensitive gates it touches.
  - [x] C1 adds a metamorphic seed for the selected IR/fact-store sink.
  - [x] No unapproved `it.todo` or skipped metamorphic variant remains for a closed gate.
  - Acceptance: `vp exec vitest --run packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`
    and the focused gate tests from B1/C1.
  - Evidence: `vp exec vitest --run packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts`;
    `vp exec vitest --run packages/compiler/src/client-secret-capture.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/server/src/vite-data-plane-gate.test.ts`;
    `vp exec vitest --run packages/compiler/src/direct-db.test.ts packages/compiler/src/scan/parse.test.ts packages/compiler/src/registry.test.ts`;
    `vp exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts -t "task and webhook direct-write diagnostics|blocks task and webhook direct DB writes"`.

- [x] **F2. Track broader capability-surface redesign separately from starter cleanup.**
  - [x] Leave `query.elevated()` open as a public API design decision, not part of F1.
  - [x] Leave webhook transaction API redesign open unless a dedicated worker owns that public API change.
  - [x] Leave direct-DB detector alias/destructure gaps to A/B/C workstreams, not starter cleanup.
  - Acceptance: after F1, plan has explicit open items for any remaining write-capable public API seam.
  - Evidence: `plans/capability-surface-redesign.md` now closes query write authority, webhook
    write-authority, and direct-DB detector hardening decisions with focused compiler/Drizzle/CLI
    evidence.

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

- [x] **Before marking this plan complete, run and record the final broad gates.**
  - [x] `node scripts/fundamental-fixes-inventory.mjs`
        Evidence: reports 28 syntactic recognition candidates, 23 literal comparisons, 5 import-specifier
        comparisons, 1,823 AST-kind gates, and 99 KV406/fail-closed sites.
  - [x] `pnpm run check:vp`
        Evidence: passed.
  - [x] `pnpm run check:api-surface`
        Evidence: passed with public-exports-needing-attention=0 and recursive-publicness baseline 832.
  - [x] Focused B/D/F/A/C/E test commands from the completed checklist items.
        Evidence: focused compiler/Drizzle/CLI/server suites, conformance metamorphic fixtures, Drizzle-pin
        conformance, and webhook idempotency Playwright test passed in this session.
  - [x] Relevant create-kovo prod-artifact tests for every artifact-observable contract.
        Evidence: serialized `pnpm exec vitest run packages/create-kovo/src/index.build.runtime.test.ts packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts packages/create-kovo/src/index.build.prod-artifact.defer.test.ts packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts packages/create-kovo/src/index.build.scaffold.typecheck.test.ts packages/create-kovo/src/index.test.ts --no-file-parallelism` passed.
  - [x] Push from local `main` and monitor GitHub CI to completion.
        Evidence: implementation batch push completed; GitHub CI run `28498101105`, Race-Prone
        Integration Repeats run `28498101130`, and GitHub Pages run `28498101126` all concluded
        successfully.

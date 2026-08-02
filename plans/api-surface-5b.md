# World-class DevEx — app-contract-dependent API batches

Status: **implementation complete; final same-manifest standing seal pending**

Charter: `plans/worldclass-devex.md` Track 5b. Gates: G17, G18, G22-G24. D1 selected the receiver-
provenance app contract; every batch carries the full public API/migration/snapshot/packed proof
checklist.

## Completed batches

- [x] **Server:** keep 116 decision-backed daily root declarations; move advanced capabilities to
      semantic task paths; internalize resolved options, generated protocol/fragment records, DB
      carriers, live-target authority, and `isKovoApp`; delete `committedSecretWaiver`; remove
      duplicate Core/Browser homes; retain documented literal-first `runtime-bootstrap`.
  - Evidence: Server topology/migration tests plus `check:api-surface` prove 116/116 root names,
    zero recursive leaks, canonical homes, and no `/types` count game.
- [x] **Better Auth:** keep human guards, CSRF/environment configuration, mounting, and mature
      workflows; converge Postgres/SQLite app bindings while moving generated backend carriers to
      the generated/private assembly boundary; label OAuth/password recovery experimental.
  - Evidence: generated API tests, packed consumer, README, and API ledger cover the converged
    boundary and workflow classification.
- [x] **Optimism:** make inline query-handle-bound `mutation({ optimistic })` the sole ordinary
      path and remove standalone plan/cast adapters.
  - Evidence: migration/compiler suites and the production CRM browser round trip prove
    success/rejection/reload behavior through emitted allowlisted modules.
- [x] **Test harness:** infer types from the imported app contract while admitting runtime graph
      facts only from a complete matching digest-verified artifact; reject stale, partial, failed,
      wrong-app, or path-invalid artifacts; consolidate helpers under `@kovojs/test`; remove
      `/test-case` and the parallel Server home; bound dependencies/size; use the public harness in
      the starter.
  - Evidence: harness refusal/type suites, `check:test-package-budget`, API gates, and packed G24
    prove the split type/runtime mechanisms and bounded closure.
- [x] Meet G22 and G24 through the decision-backed Server root and inferred packed starter harness.
  - Evidence: `pnpm run check:api-surface` reports the 116-name Server root with zero recursive
    leaks; packed G24 runs `templates/src/app.test.ts` through `createKovoTestHarness` with the
    imported app contract and matching digest-verified successful-build graph.

## Remaining integration proof

- [ ] Run Server, Better Auth, optimism, custom-adapter, and test-harness consumers from the one
      final authenticated release manifest.
- [ ] Close Track 5b only after that subject also passes the standing SPEC/API/migration/snapshot/
      ratchet, packed-declaration `any`, publish, pack-security, certificate, and full release
      acceptance gates.

Focused and earlier packed proofs remain valid implementation evidence but do not close the final
integrated seal.

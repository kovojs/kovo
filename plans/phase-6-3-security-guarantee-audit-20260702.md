# Phase 6.3 Security Guarantee Audit - 2026-07-02

Scope: non-implementer adversarial validation of `SECURITY.md` against `security/TCB.md`,
runtime/paranoid proof enrollment, DEC-G generator coverage, and sole-door/TCB gates at
`fc9a50b34c9780db3070a332298d60a796fdc108`.

## Result

- [x] **No blocking guarantee defect found in the current published register.**
      The three `SECURITY.md` guarantees are narrow query-wire confidentiality claims for runtime
      `Secret` values in paranoid production artifacts. Each names enrolled `tcb` manifest entries
      and a paranoid/runtime proof claim ID.
      Evidence: `pnpm run check:security-guarantee` passed with
      `OK 3 security guarantee(s) map to TCB chokes and paranoid/runtime proofs`.
- [x] **TCB manifest and wrapped decision inventory are mechanically consistent.**
      The manifest entries named by the guarantees are classified as `tcb`, and wrapped
      `securityClassifier`/`wireEmitter` decisions remain manifest-listed and within budget.
      Evidence: `pnpm run check:tcb-boundary` passed with `345 TCB lines`.
- [x] **DEC-J sole-door scan did not find an unclassified egress or DB-driver bypass.**
      The server egress/DB exec sink inventory still routes through the classified chokes scanned by
      `check-single-choke`.
      Evidence: `pnpm run check:single-choke` passed.
- [x] **Runtime box/wire finite-model proof surface passed.**
      The core `Secret` and wire JSON proof harnesses still reject coercion/serialization paths
      covered by the current TCB proof model.
      Evidence: `pnpm exec vitest --run packages/core/src/secret.tcb-proof.test.ts packages/core/src/internal/wire-json.tcb-proof.test.ts scripts/tcb-proof-harness.test.ts --reporter=dot`
      passed with 3 files / 9 tests.
- [x] **Published query-wire paranoid proof IDs execute in production artifacts.**
      The `runtime-secret-view-egress`, `runtime-secret-db-read-boundary`, and
      `runtime-secret-raw-sql-read-boundary` proof tests build paranoid production artifacts,
      serve `/_q`, and observe the stable 500 envelope without leaking the secret payload.
      Evidence: `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "runtime Secret|schema-declared secret reads|raw SQL aliases" --reporter=dot`
      passed with 2 tests / 8 skipped.
- [x] **Existing DEC-G/paranoid generator acceptance command passed under `KOVO_PARANOID=1`.**
      No new script was needed: `scripts/security-test-build-gate.mjs` already exposes
      `generateParanoidGeneratorAcceptanceCases()`, and `check:paranoid-runtime` runs the generated
      acceptance cases under paranoid production artifact build/server execution.
      Evidence: `pnpm run check:security-test-builds`, `pnpm run check:paranoid-classifiers`, and
      `pnpm run check:paranoid-runtime` passed.
- [x] **Focused server query endpoint runtime choke passed.**
      The direct framework query endpoint test refuses a runtime `Secret` and returns the opaque
      `{"code":"SERVER_ERROR","payload":{}}` body.
      Evidence: `pnpm exec vitest --run packages/server/src/query-endpoint.test.ts -t "refuses runtime Secret values" --reporter=dot`
      passed.

## Findings

- [x] **No guarantee with no choke found.**
      `SECURITY.md` does not publish broader claims outside the JSON register; its prose narrows the
      current guarantee to query-wire confidentiality for runtime `Secret` values and labels broader
      security language as architectural direction until enrolled.
- [x] **No enrolled choke with a failed sole-door gate found.**
      `check:single-choke` and `check:tcb-boundary` passed. I did not find a server egress or DB
      driver sink that escaped the current scanned inventories.
- [x] **No missing paranoid proof ID found for the current guarantees.**
      The three runtime proof IDs in `SECURITY.md` are present in `SECURITY_BUILD_PROOFS`, require
      `KOVO_PARANOID: '1'`, and passed their focused production-artifact test run.

## Residual Risks

- [ ] **`emitToWire` is named in the query-wire guarantees, but the decisive query payload refusal is
      the canonical wire JSON encoder.**
      This is not a failed guarantee because the tests and direct query endpoint path refuse the
      `Secret` before the `/_q` response crosses the client wire. The wording/choke list is slightly
      imprecise for body payloads: `emitToWire` finalizes framework responses and enforces header
      chokes, while `jsonSafeWireValue`/`stringifyWireValue` performs the recursive query payload
      `Secret` refusal. A future ledger cleanup could either add the wire JSON encoder to the TCB
      manifest/guarantee choke list or clarify that `emitToWire` is the outer response finalizer, not
      the payload serializer.
- [ ] **DEC-G paranoid generator acceptance currently varies header runtime-choke cases, not the
      three query-wire guarantee cases.**
      This is covered for the published guarantees by the separate
      `runtime-secret-*` paranoid production-artifact proofs, so it is not a current defect. If Phase
      6.3 wants the DEC-G generator itself to own query-wire shape variation, add a generated case
      family for secret column/raw/view query egress and enroll those needles in
      `SECURITY_BUILD_PROOFS`.

## Commands Run

- `pnpm install` (worktree setup only; not committed)
- `pnpm run check:security-guarantee`
- `pnpm run check:tcb-boundary`
- `pnpm run check:single-choke`
- `pnpm run check:security-test-builds`
- `pnpm exec vitest --run packages/core/src/secret.tcb-proof.test.ts packages/core/src/internal/wire-json.tcb-proof.test.ts scripts/tcb-proof-harness.test.ts --reporter=dot`
- `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "runtime Secret|schema-declared secret reads|raw SQL aliases" --reporter=dot`
- `pnpm run check:paranoid-classifiers`
- `pnpm run check:paranoid-runtime`
- `pnpm exec vitest --run packages/server/src/query-endpoint.test.ts -t "refuses runtime Secret values" --reporter=dot`

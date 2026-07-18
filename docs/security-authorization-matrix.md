# Authorization matrix

Kovo's Phase 1 authorization matrix is the executable forcing gate for the engine-door contract in
[SPEC §10.3](../spec/10-data-plane.md#103-mutations--writes) and the independent verification
contract in [SPEC §11](../spec/11-verification.md). The normative behavior remains in the SPEC;
[`security/authorization-matrix.json`](../security/authorization-matrix.json) fixes the test
denominator and replay data, while the production-artifact suite supplies the runtime witnesses.

## Fixed denominator

The matrix contains exactly 28 case rows. Those rows cover all 34 required values across five axes;
34 is the sum of the axis obligations, not a claim that the suite executes the full Cartesian
product.

| Axis         | Count | Required values                                                                               |
| ------------ | ----: | --------------------------------------------------------------------------------------------- |
| Principal    |     6 | anonymous, session owner, act-as owner, act-as other, ambient reader, runtime login           |
| Ownership    |     6 | own, other, owner-via, reference, unclassified, not applicable                                |
| Operation    |     5 | read, insert, schedule, invoke, boot                                                          |
| Query family |    11 | builder, relational, raw SQL, subquery-in-from, union, CTE, alias, join, view, function, none |
| Surface      |     6 | `readonlyAppDb`, endpoint, mutation, durable task, webhook, closure audit                     |

Every case has one closed verdict: `allow`, `allow-own-only`, `deny`, `idempotent`,
`least-privilege`, or `boot-refuse`. `pnpm run check:authorization-matrix` rejects a changed axis,
an uncovered value, a duplicate case, an open verdict, an incomplete replay record, or a missing
canary/reproducer mapping.

Five deliberately seeded canaries protect the highest-value edges:

1. allowing a builder read to cross owners;
2. allowing a raw-SQL cross-owner insert;
3. allowing the runtime login to assume the provision role;
4. allowing a reader-reachable, cross-schema `SECURITY DEFINER` function; and
5. denying the valid durable-task owner read.

Each canary has a committed seed and one-cell reproducer in the manifest. The mutation gate must
kill all five; the wider mutation catalog may contain additional, unrelated mutants.

## What the runtime proof exercises

The Postgres acceptance path scaffolds a real app, builds it, provisions an external database, and
starts `node dist/server/server.mjs` with `NODE_ENV=production` and `KOVO_PARANOID=1`. Reads,
mutations, durable tasks, and webhooks then cross the HTTP boundary of that built artifact. Closure
refusals run in the same suite through `kovo db check`; an unsafe database therefore fails before
the artifact is allowed to serve.

The 28 cells jointly witness:

- owner filtering across builder, relational, raw-SQL, subquery, union, CTE, alias, join, and
  owner-via paths; anonymous and principal-less reads return no owner rows, and secret reads remain
  denied;
- a valid own-row builder insert, plus database denial of builder and raw-SQL cross-owner inserts;
- principal propagation through a durable task and idempotent webhook replay;
- exact runtime identity with `rolsuper = false`, `rolbypassrls = false`, and
  `rolcreaterole = false`, plus both `pg_has_role(..., 'MEMBER') = false` and a rejected real
  `SET ROLE` attempt for the provision role; and
- a safe `security_invoker`/RLS closure that boots, while a reachable materialized view,
  `PUBLIC`-granted table, definer view, cross-schema `SECURITY DEFINER` function, and (when the local
  Postgres supports it) foreign table make the closure check refuse.

These are complementary layers. Source analysis and the matrix gate prevent proof drift; RLS and
least-privilege grants deny hostile row writes; the effective engine-graph closure check prevents a
reachable object from bypassing those policies. No wrapper-only result is treated as proof of the
SPEC §10.3 engine-door claim.

## Deterministic replay and failure artifacts

The committed seed is `kovo-authz-matrix:2026-07-18:v1`. The runner orders cases by a SHA-256 key
derived from that seed and the case ID, so the order is stable and can be changed deliberately with
`KOVO_AUTHZ_MATRIX_SEED`. Under `KOVO_PARANOID=1`, the suite also fails if the local Postgres
toolchain is unavailable, a required real-Postgres scenario is skipped, or any of the 28 case
executors is not reached.

On failure, the runner writes one minimized JSON record beneath
`.kovo/security-failures/authorization-matrix/`. It contains only the failed cell, the exact seed,
the error, and the replay command. These local artifacts are ignored by Git; the durable regression
seeds and human-readable minimized reproducers live in the manifest.

Use these gates:

```sh
pnpm run check:authorization-matrix
pnpm exec vitest --run scripts/check-authorization-matrix.test.mjs packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-gate.test.ts
pnpm run check:security-gate-mutations
KOVO_AUTHZ_MATRIX_SEED=kovo-authz-matrix:2026-07-18:v1 pnpm run test:authz-paranoid
```

Add `KOVO_AUTHZ_MATRIX_TRACE=1` to the replay command to print each seeded cell as it starts and
passes.

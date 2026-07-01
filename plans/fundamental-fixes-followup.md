# Fundamental Fixes Follow-up — close the deep-layer fail-opens (no deferred sinks)

Created 2026-07-01. Execution ledger continuing `plans/fundamental-fixes.md`. Source of truth remains
`SPEC.md` (§5 compiler, §11 static analysis and verification, §6.6 honesty boundary, §1.3 machine-auditable
generation). Folds the round-4 dogfood findings (`plans/claude-bugz-25.md`, `plans/claude-papercuts-23.md`)
into concrete work, AND fixes the process that let them ship. **Hard rule: no sink may be deferred (M5).**

## Why the original program missed these (and why the meta-invariants below exist)

The original plan defined "done" as _"I implemented my checklist and my tests pass"_ — it verified its
**input**, not its **output** (the same error class as the bugs). Concretely it missed round-4 because:
its root taxonomy had only _recognition_ + _path-duplication_ (no **value-flow**, **dialect**, or
**runtime-handle-shape** axis); its completeness metric counted **present** syntactic checks, so a
**missing** resolver branch (`bugz-25` B6) and a `Set`-membership **denylist** (`bugz-25` B1) were invisible;
its metamorphic harness ran on a **fixture-only path production never uses**, so it green-lit a live
fail-open (`bugz-25` B7); it validated on **one dialect** (the `raw-sql` prod-artifact test has zero SQLite
coverage), so the SQLite holes (`bugz-25` B1/B2) never ran; and it marked itself **complete while explicitly
deferring** KV426/KV435/KV311 (`plan complete ≠ framework sound`). The invariants below close each of those.

## Done-definition — meta-invariants (apply to EVERY workstream; nothing is "done" until all hold)

- [x] **M1. Independent adversarial gate.** A workstream closes only after an isolation-flip sweep over its
      enumerated variant axes — run on the **prod artifact**, for **every supported dialect**, by an agent/
      reviewer that is **not the implementer** (a `/dogfood` pass or a second reviewer) — finds **zero**
      fail-opens. "My acceptance test passes" is necessary, not sufficient.
      Evidence: `pnpm run check:fundamental-fixes-census` passed with 138 rows and `complete: true`; row evidence in `scripts/fundamental-fixes-census.manifest.json` records the prod-artifact M1 command for each closed child.
- [x] **M2. No fixture-only security certification.** Every test that certifies a security property resolves/
      builds through the **production `kovo build` code path** (not a fixture-only `extraFiles`/unit shortcut).
      Add a lint/gate that flags a security test which does not exercise the real build. (Generalizes E2; the
      `bugz-25` B7 root was the _safety net itself_ certifying a production fail-open.)
      Evidence: `pnpm run check:security-test-builds` passed 22 real-build security proofs.
- [x] **M3. Mutation testing on the gates.** For each security gate, deleting/negating any one branch MUST
      turn a test red. A branch whose removal breaks no test has fake coverage and blocks "done." (This is what
      let "explicitly marked safe" + green metamorphic tests coexist with a live fail-open.)
      Evidence: `pnpm run check:security-gate-mutations` passed with 32 mutants killed.
- [x] **M4. Completeness by census, not count.** "Done" is measured by the **Sink & handle census** below +
      the **resolver expression-kind table** (B3) + the **dialect × sink matrix** (I) all green — NOT by a
      syntactic-recognizer count. Retire `scripts/fundamental-fixes-inventory.mjs`'s "N candidates" as a
      done-signal (it counts _present_ checks, not _missing_ edges / denylist gaps / dialect gaps).
      Evidence: `pnpm run check:fundamental-fixes-census` passed with `complete: true`, proving the census, resolver table, and dialect matrix are all closed by manifest rows.
- [x] **M5. NO DEFERRAL of sinks.** Every row of the Sink & handle census is enumerated and **closed in this
      plan**. "Future candidate," "out of scope," or "deferred" is **not an allowed status** for a sink or a
      write-capable handle. A known-but-unclosed sink is an open HIGH security item that **blocks "complete."**
      A newly discovered sink/handle is **added to the census and closed**, never parked.
      Evidence: `pnpm run check:fundamental-fixes-census` passed with 138 rows and no open manifest rows.

## Sink & handle census (the M4 denominator — every row must reach `[x]`, no deferral per M5)

Master list of everything that can (a) write, or (b) reach a client/output channel. Parent rows are rollups
and stay open until every nested child row closes. Child rows are the closure unit: each one is closed by the
named workstream and must carry exact M1–M3 evidence in `scripts/fundamental-fixes-census.manifest.json`.

**(a) Write-capable handle surfaces** — close via H (statement-parse-primary allowlist) + I (dialect):

- [x] `readonlyDb()` read-only loader/endpoint handle (×6 call sites) — `bugz-25` B1 [H]
  - Evidence: children closed by current M1/M2/M3 evidence in `scripts/fundamental-fixes-census.manifest.json` and reverified in this worker branch.
  - [x] `readonlyDb()` raw SQL methods (`.all/.get/.values`) fail closed at runtime [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed 2 prod-artifact endpoint cases across default+SQLite; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 29 mutants.
  - [x] `readonlyDb()` transaction and future/unknown methods fail closed at runtime [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed default+SQLite endpoint cases covering `transaction` and `futureStatement`; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 29 mutants.
  - [x] `readonlyDb()` public endpoint cannot mutate in a prod artifact for every supported dialect [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed default+SQLite `/api/readonly-mutation-attempt` cases and kept the drift table at 0; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 29 mutants.
  - [x] `Reader<Db>` type surface rejects write-capable methods [H]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` passed 65 tests including a compiler-backed `Reader<Db>` type proof; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs for the matching public read-handle endpoint; M3 `pnpm run check:security-gate-mutations` killed 29 mutants.
- [x] `managedDb(…, 'write')` mutation handle + `wrapManagedDbForSqlSafety` (×3) — `bugz-25` B2 [H/I]
  - Evidence: children closed by the managed DB runtime matrix plus transaction/raw-SQL production artifact proofs recorded in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] write-mode declared-table statements pass and cross-table statements fail closed [H/I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` covers declared-table pass/cross-table KV406 fail-closed in write mode; production raw-SQL artifact shard covers trusted pass plus drift fail-closed.
  - [x] SQLite raw SQL statement parse parity matches the default dialect [I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` covers pglite/default, better-sqlite3, and synthetic unknown dialect sinks across the matrix.
  - [x] `wrapManagedDbForSqlSafety` enforces the same policy at every call site [H/I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` covers top-level, transaction, with-builder, nested escape, and unknown-method call sites.
- [x] `WebhookTxDb` webhook transaction handle [H]
  - Evidence: children closed by M1/M2/M3 evidence in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] `WebhookTxDb` declared transaction writes still execute through the audited path [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed default+SQLite served webhook transaction cases; M2 uses `buildProductionArtifact(root)` / `kovo build --no-cache`; M3 killed the webhook KV330 proof-enrollment mutant.
  - [x] `WebhookTxDb` raw `$client`/`.session` escape handles fail closed [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed default+SQLite build-fail cases for `context.tx.$client`/`.session`; M2/M3 security gates passed with the KV330 webhook proof enrolled and mutation-killed.
- [x] storage / capability write handles (upload/store/delete) [H]
  - Evidence: children closed by current prod-artifact M1/M2/M3 evidence in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] query/load storage upload, store, delete, and put writes fail closed [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t 'M1:storage-write' --reporter=dot` passed postgres+SQLite prod-artifact red/flip build-fail cases; M2 `pnpm run check:security-test-builds` passed 14 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 31 mutants including KV433 storage-delete proof enrollment.
  - [x] declared mutation/capability storage writes still work through the audited path [H]
        Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'storage' --reporter=dot` served the production artifact and observed declared mutation `put`/`delete` storage effects.
- [x] raw driver `$client` / `.session` escape from any managed handle [H]
  - Evidence: all children closed with production artifact fail-closed proofs in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] managed write handle `$client`/`.session` escapes fail closed before nested wrapping [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed 4 prod-artifact tests including default+SQLite build-fail managed-write escape attempts; M2 row proof uses `buildProductionArtifact(root)` / `kovo build --no-cache`; M3 `pnpm run check:security-gate-mutations` kills `sql-safe-handle/drop-managed-raw-driver-escape-denial`.
  - [x] read-only handle `$client`/`.session` escapes fail closed before execution [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts --reporter=dot` passed 8 prod-artifact tests including default+SQLite read-only escape attempts; M2 row proof uses `buildProductionArtifact(root)`; M3 `pnpm run check:security-gate-mutations` killed `sql-safe-handle/drop-managed-raw-driver-escape-denial`.
  - [x] webhook transaction `$client`/`.session` escapes fail closed before execution [H]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts --reporter=dot` passed default+SQLite build-fail cases for raw `context.tx.$client`/`.session` reads before artifact emission; M2/M3 security gates passed with the webhook KV330 proof enrolled and mutation-killed.
- [x] unknown/future drizzle method OR driver dialect → **fails closed by default** (not a matrix update) [H/I]
  - Evidence: children closed by current futureStatement and synthetic unknown dialect matrix evidence in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] unknown method with a SQL carrier is parsed before execution [H/I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` proves `futureStatement` parses SQL carriers at any argument position before execution.
  - [x] unknown method without a SQL carrier fails closed [H/I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` proves opaque no-carrier `futureStatement` calls throw the unknown-method KV422 path before execution.
  - [x] synthetic unknown driver/dialect fails closed without a matrix update [I]
        Evidence: M1 `pnpm exec vitest --run packages/server/src/managed-db.test.ts --reporter=dot` includes the synthetic unknown dialect across execute/query/run/get/all/values/transaction/with/unknown-method.

**(b) Output / wire sinks** — close via C2 (enumerate from the emitted artifact; proof-or-KV406):

- [x] SSR document HTML [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] SSR route render text is escaped in the production document [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'helper text' --reporter=dot` served the no-cache production artifact and observed escaped attacker text; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
  - [x] SSR raw/trusted HTML boundaries require proof-or-KV406 [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'helper text' --reporter=dot` enrolled production sink-census witnesses for framework-owned `trustedHtml`/escaped SSR boundaries; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
- [x] `/_q` query response [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] `/_q` query response body escapes client-visible HTML [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t '/_q query wire' --reporter=dot` passed the default+SQLite prod-artifact `/_q` attacker body proof; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` killed `server-wire-html/drop-query-wire-body-escaping`.
  - [x] `/_q` query response headers do not expose session data to shared caches [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t '/_q query wire' --reporter=dot` passed the default+SQLite prod-artifact `/_q` private-cache proof; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` killed `server-wire-html/drop-query-wire-body-escaping`.
- [x] mutation delta / enhanced-mutation response [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] enhanced mutation fragment bodies escape client-visible HTML [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'enhanced mutation fragments' --reporter=dot` passed default+SQLite prod-artifact enhanced mutation proofs and observed escaped fragment HTML; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
  - [x] mutation-triggered query refreshes preserve query wire bounds [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'enhanced mutation fragments' --reporter=dot` passed default+SQLite prod-artifact enhanced mutation proofs and observed escaped `<kovo-query>` refresh wire; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
- [x] streaming / `<Defer>` chunks [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] `<Defer>` shell streams before slow regions complete [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.defer.test.ts --reporter=dot` passed the default+SQLite prod-artifact stream proof; M2 proof calls `buildProductionArtifact(root)` and serves `dist/server/server.mjs`; M3 `pnpm run check:security-gate-mutations` killed 30 mutants.
  - [x] `<Defer>` region failures isolate to their own fallback [C2]
        Evidence: M1 same Defer prod-artifact shard returned HTTP 200 for a throwing region, streamed that region's error fallback, and still rendered a safe sibling fragment; M2 real-build proof and M3 30-mutant gate same as parent.
  - [x] streamed `<Defer>` chunks escape attacker markup and private details [C2]
        Evidence: M1 same Defer prod-artifact shard asserted attacker markup is escaped in fallback/chunks, raw sibling text is escaped, and private thrown details stay off the stream; M2 real-build proof and M3 30-mutant gate same as parent.
- [x] response headers (incl. `Set-Cookie`, redirects) [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] route outcome headers reject CRLF injection [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.headers.test.ts --reporter=dot` passed the no-cache prod-artifact route-header CRLF rejection proof; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled header/security gates.
  - [x] typed and raw `Set-Cookie` paths normalize safe cookies and reject unsafe cookies [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.headers.test.ts --reporter=dot` passed typed mutation cookie, raw endpoint cookie normalization, and unsafe cookie rejection in the production artifact; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled header/security gates.
  - [x] redirect `Location` headers are sanitized before send [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.headers.test.ts --reporter=dot` passed the no-cache prod-artifact raw redirect sanitization proof; M2 proof calls `buildProductionArtifact(root)` and `assertProdArtifactSinkCensus(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled header/security gates.
- [x] error shells / 500 bodies [C2]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] 500 shells escape request-controlled payloads [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'FormError' --reporter=dot` passed the no-cache prod-artifact no-JS 500 body proof and excluded submitted `<script>` payload; M2 proof calls `buildProductionArtifact(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
  - [x] 500 shells exclude private exception details [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'FormError' --reporter=dot` passed the no-cache prod-artifact no-JS 500 body proof and excluded private exception detail; M2 proof calls `buildProductionArtifact(root)`; M3 `pnpm run check:security-gate-mutations` covers the enrolled server-wire/security gates.
- [x] capability URLs / signed payloads [C2]
  - Evidence: children closed by current prod-artifact M1/M2/M3 evidence in `scripts/fundamental-fixes-census.manifest.json`.
  - [x] capability URLs mint and verify against the production artifact [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t 'M1:output-wire' --reporter=dot` passed postgres+SQLite served-artifact capability URL cases; focused `redirect-capability` prod-artifact test passed.
  - [x] tampered capability path/query payloads reject before read [C2]
        Evidence: focused `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts --reporter=dot` served `dist/server/server.mjs`, tampered the signed path, received generic 404, and storage guard did not expose pre-verification read errors.
- [x] raw-HTML sinks (`trustedHtml`, `trustedUrl`, `@internal renderedHtml`) [C2/B3]
      Evidence: children closed below with exact M1/M2/M3 prod-artifact proof.
  - [x] KV426 blocks `trustedHtml()` request taint in a prod artifact [C2/B3]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t M1:raw-html --reporter=dot` passed 2 dialect cases; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 28 mutants.
  - [x] KV426 blocks `trustedUrl()` query taint in a prod artifact [C2/B3]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t M1:raw-html --reporter=dot` passed 2 dialect cases; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 28 mutants.
  - [x] `TrustedUrl` values are rejected in non-URL JSX attributes [C2]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t 'TrustedUrl values in non-URL JSX attributes' --reporter=dot` passed the no-cache prod-artifact build-fail proof; M2 `pnpm run check:security-test-builds` passed 19 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 32 mutants.
  - [x] KV426 blocks `@internal renderedHtml()` query taint in a prod artifact [C2/B3]
        Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t M1:raw-html --reporter=dot` passed 2 dialect cases; M2 `pnpm run check:security-test-builds` passed 13 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 28 mutants.
  - [x] real build resolves local/star barrels and literal element access for raw-HTML sinks [B3/E2]
        Evidence: M1 `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight" --reporter=dot` passed and asserted `kovo build --no-cache` failed with four KV426 diagnostics and no `dist`; M2 `pnpm run check:security-test-builds` passed 14 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 30 mutants.
- [x] client-derive bodies (leak / `ReferenceError` boundary) [C2]
  - Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts --reporter=dot` passed 2 prod-artifact tests; M2 `pnpm run check:security-test-builds` passed 14 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 29 mutants.
  - [x] emitted client derives use state paths instead of render-local aliases [C2]
    - Evidence: M1 fetched the served `/c/__v/...client.js` from `packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts` and asserted `state.count`, `state.items[0]`, nested/computed state paths, and no render-local alias names.
  - [x] hydrated derives update on interaction without `ReferenceError` or framework requests [C2]
    - Evidence: M1 same prod-artifact browser test clicked the state-only control, observed all derived outputs update, `pageErrors=[]`, `consoleErrors=[]`, and no post-interaction `/_q` or `/_m` requests.
  - [x] module-helper-in-derive stays either lowered safely or fails KV311 [C2]
    - Evidence: M1 same prod-artifact shard passed the helper proof asserting built artifacts do not ship `format(state.count)`/`format =`; focused compiler shard `pnpm exec vitest --run packages/compiler/src/state-bindings.test.ts -t "state aliases|helper" --reporter=dot` passed 9 alias/helper tests including KV311 helper failures.
- [x] secret-column-to-wire across ALL value-flow paths [C2]
  - Evidence: M1 `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts -t M1:secret-wire --reporter=dot` passed 2 dialect cases and asserted direct, transformed, render-bound, and cross-select KV435 diagnostics plus the green non-secret sibling; M2 `pnpm run check:security-test-builds` passed 18 real-build proofs; M3 `pnpm run check:security-gate-mutations` killed 30 mutants.
  - [x] direct secret projection to query wire fails KV435 in every supported dialect [C2]
    - Evidence: M1 same prod-artifact shard asserted `queries/auth-secret-direct-leak-query.accessToken` and `.password` fail KV435 for postgres and sqlite.
  - [x] transformed query-loader return laundering fails KV435/KV406 [C2]
    - Evidence: M1 same prod-artifact shard asserted `queries/auth-secret-transformed-leak-query.password` fails KV435; focused static shard `pnpm exec vitest --run packages/drizzle/src/index.query-shapes.test.ts -t "secret|cross-select|transformed" --reporter=dot` passed 16 tests including transformed KV435/KV406 cases.
  - [x] render value-flow laundering of secret-selected rows fails KV435/KV406 [C2]
    - Evidence: M1 same prod-artifact shard asserted `queries/auth-secret-render-leak-query.renderPassword` fails KV435 before the rendered query prop can ship; the focused static shard passed the secret value-flow cases.
  - [x] cross-select laundering of secret columns fails KV435 [C2]
    - Evidence: M1 same prod-artifact shard asserted `queries/auth-secret-leak-query.accessToken` and `.password` fail KV435; the focused static shard passed cross-select laundering cases.
  - [x] explicit non-secret projection sibling builds in every supported dialect [C2]
    - Evidence: M1 same prod-artifact shard built the `addAuthSecretLeakProof(root, { leakToWire: false })` sibling for postgres and sqlite; focused security shard `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.security.test.ts -t "local-helper Better Auth credential" --reporter=dot` passed the unsafe/safe production build proof.

## Traceability (finding → workstream); the census above is the master closure list

| Finding                                                                   | Workstream |
| ------------------------------------------------------------------------- | ---------- |
| `bugz-25` B1 (readonly handle writes via `.all/.get/.transaction`)        | H + I      |
| `bugz-25` B2 (SQLite raw-SQL cross-check dead)                            | I          |
| `bugz-25` B3/B4/B5 (KV426 tracer gaps)                                    | C2         |
| `bugz-25` B6 (resolver computed element-access)                           | B3         |
| `bugz-25` B7 (resolver cross-file re-export; dead in real build)          | B3 + E2/M2 |
| `bugz-25` B8/B9 (island derive ReferenceError / array-destructure frozen) | C2         |
| `bugz-25` B10 (KV435 cross-select laundering)                             | C2         |
| `papercuts-23` A1 (SQLite escape hatch Postgres-only)                     | I          |
| `papercuts-23` A2 (`trustedUrl` unusable + ungated)                       | C2         |
| `papercuts-23` A3 (computed `request['db']` under-reports in explain)     | B3         |

## Operating rule

Implement the next census row / checklist item, verify it (isolation-flip: safe spelling RED, sibling GREEN
→ RED after the fix), then run M1–M3 for it, then record the shortest evidence. Each item names the file:line
to change. Do not open a broad audit before the concrete items are implemented, verified, or blocked.

## Workstreams

- [x] **H. Read + SQL capability handles: statement-parse PRIMARY, allowlist only as a fast path.** Closes census (a); `bugz-25` B1.
  - Files: `packages/server/src/managed-db.ts` (`WRITE_VERBS` denylist `:27`; `readonlyDb` proxy `:74-87`;
    `Reader<Db>` type `:52-59`), `packages/server/src/sql-safe-handle.ts` (get-trap guard-set `:98-128`).
  - [x] **Primary guard = parse the statement, not the method name.** Every call that reaches the driver
        (any method, any dialect) has its SQL parsed and its verb classified; a mutating verb on a read
        handle, or a write outside declared `tables:`, fails closed. A read-builder allowlist
        (`select`/`query`/`with`-read/`$count`) is only a fast-path that skips parsing — never the sole gate.
  - [x] Any property NOT on the allowlist and NOT proven read-only → fails closed by default (kills the
        `.all/.get/.values/.transaction/.with` and any future-method escape), including `$client`/`.session`.
  - [x] `Reader<Db>` becomes a read-surface type (mirrors the read builders), not `Omit<6 verbs>`, so
        `readonlyAppDb.all(...)`/`.transaction(...)` are `tsc` errors too.
  - [x] Apply to EVERY census-(a) surface: the 6 `readonlyDb` sites, the `managedDb('write')`/
        `wrapManagedDbForSqlSafety` path, `WebhookTxDb`, and storage/capability write handles.
  - Evidence: `pnpm run check:fundamental-fixes-census` passed with `complete: true`; census-(a) rows in `scripts/fundamental-fixes-census.manifest.json` carry M1/M2/M3 evidence for read handles, managed write handles, webhook transaction handles, storage handles, raw-driver escapes, and unknown methods.
  - Acceptance: `readonlyAppDb.all(sql`DELETE … RETURNING`)`, `.get(sql`INSERT … RETURNING`)`,
    `.transaction(tx => tx.insert(...))` fail closed at runtime AND `tsc`; a public GET endpoint cannot
    mutate through any read handle (prod-artifact test, both dialects); reads still work; M1–M3 green.

- [x] **I. Dialect parity — driver-agnostic guards + unknown-driver-fails-closed.** Closes `bugz-25` B2, `papercuts-23` A1; underpins H.
  - Files: `packages/server/src/sql-safe-handle.ts`, `packages/server/src/managed-db.ts`, the raw-SQL static
    classifier + escape-hatch discharge (`packages/drizzle/src/**`), `parseSqlWriteTables`.
  - [x] The SQL-safety proxy + write-detection are **driver-agnostic**: they run the statement-parse guard
        on whatever method reaches the driver (`better-sqlite3` `.run/.get/.all/.values`, pglite `.execute`,
        and any future driver), restoring §11.2 `observed ⊆ declared` on **all** dialects.
  - [x] The static raw-SQL classifier + escape-hatch discharge (`tables:`/`touches:`/`reads:`/`trustedSql`)
        recognize every dialect's sinks so a declared/attested SQLite raw statement builds; the diagnostic
        distinguishes a raw READ from a write site (fixes `papercuts-23` A1's mislabel).
  - [x] **Unknown-driver test:** a synthetic handle whose method names the framework has never seen must
        FAIL CLOSED (no write reaches the driver un-parsed) — so the next driver (D1/libsql/…) is safe by
        construction, not by a matrix update.
  - [x] Dialect × sink metamorphic matrix (feeds M4): for each SQL sink × {pglite, better-sqlite3, unknown},
        a cross-`tables:` write fails closed and a raw string fires KV422.
  - Evidence: `pnpm run check:fundamental-fixes-census` passed with `complete: true`; SQL/dialect rows in `scripts/fundamental-fixes-census.manifest.json` carry default, SQLite, and synthetic unknown-driver M1 evidence.
  - Acceptance: the `bugz-25` B2 smuggle throws on SQLite; a declared SQLite raw statement builds; the
    unknown-driver handle fails closed; per-dialect matrix green; M1–M3 green.

- [x] **C2. Enumerate EVERY output sink from the artifact and require proof-or-KV406 (not a 3-gate migration).** Closes census (b); `bugz-25` B3/B4/B5, B8/B9, B10, `papercuts-23` A2. **No sink deferred (M5).**
  - Invariant: **every value reaching a client/output channel, every raw-HTML sink, and every SQL statement
    is enumerated from the lowered IR/emitted artifact and carries a proof; an un-enumerable one is KV406.**
    This is the census-(b) closure, not a fixed list of gates — a new channel is added to the census and closed.
  - [x] **Value-flow / taint fails closed on UN-PROVABLE, never enumerate-the-forms.** A `secret:` column
        read must be _proven_ off-wire (else KV406) — no "trace `.find`/`.push`, miss `.reduce`/`Map`/JSON".
        Taint propagates through _every_ expression form (binary/logical/nullish/template/spread/call) or the
        unknown form is _tainted_ — never `return null`-as-clean (the current `trusted-html-provenance.ts:152-170` bug).
  - [x] KV435 secret-to-wire: read/secret provenance fact carries the secret READ and its flow onto the
        returned shape; stop whitelisting resolved secret projections at `packages/drizzle/src/static.ts:2812`;
        cross-select laundering fails closed (`bugz-25` B10).
  - [x] KV426 trusted-HTML: resolve the render request param by position/symbol (not name), collect query
        bindings from a non-destructured data param, propagate taint through all operator forms
        (`trusted-html-provenance.ts:82,84,152-170,435-440`) — `bugz-25` B3/B4/B5; add the same gate for
        `trustedUrl` + `TrustedUrl` in JSX `AttributeValue` (`papercuts-23` A2). Cover the `@internal renderedHtml` sink.
  - [x] KV311 / island derives: destructured/chained/nested/computed/array aliases lower to a derive body over
        `state.<path>` (never a render-local binding) or fire KV311 — no green build over a `ReferenceError`
        derive or a silently-frozen node (`reactive-aliases.ts:31,131-132` + the `lower/structural-jsx.ts`
        emitter). Verify `claude-bugz-24` B5 (module-helper-in-derive) closes here.
  - [x] The remaining census-(b) channels (streaming/`<Defer>`, headers/`Set-Cookie`, error shells,
        capability URLs) are each enumerated and proven — none deferred.
  - Evidence: `pnpm run check:fundamental-fixes-census` passed with `complete: true`; census-(b) rows in `scripts/fundamental-fixes-census.manifest.json` carry prod-artifact evidence for HTML, query wire, mutation wire, Defer streams, headers, error shells, capability URLs, raw HTML/TrustedUrl, derives, and secret-to-wire.
  - Acceptance: every census-(b) row's known-unsafe seed + value-flow siblings fail closed; a prod-artifact
    test where the leak/stale/crash was observable is green; the source re-walk for each migrated sink is
    removed/demoted so it cannot silently disagree with the fact model; M1–M3 green.

- [x] **B3. Complete the resolver: an expression-kind coverage table with no blanks.** Closes `bugz-25` B6, B7, `papercuts-23` A3. (Continues B.)
  - Files: `packages/core/src/internal/framework-identity.ts` (`canonicalExpression` `:262-294`,
    `resolveProjectSourceFile` `:682-771`, `exportedIdentity` `:712-737`),
    `packages/drizzle/src/static/framework-identity.ts:152,165`.
  - [x] Build a **resolver expression-kind table** (feeds M4): every `ts.SyntaxKind` an expression can be ×
        {resolved | fails-closed}. No blank cell — an unhandled kind falls to **fail-closed**, not silent
        `undefined`/clean.
        Evidence: M1 `pnpm exec vitest --run packages/core/src/internal/framework-identity.test.ts packages/compiler/src/vite.test.ts -t "framework identity resolver|registers local source files for framework identity|invalidates the Vite transform cache" --reporter=dot` passed 6 focused tests, including the resolver expression-kind table plus default fail-closed row; M3 killed the resolver denominator/status/coverage mutants.
  - [x] Add `ElementAccessExpression` (literal key resolves like property access; non-literal computed key
        fails closed) — `bugz-25` B6; also fixes computed `request['db']` in the write-sink/explain
        extraction (`papercuts-23` A3). Add `export *` to `exportedIdentity`.
        Evidence: M1 `pnpm exec vitest --run packages/compiler/src/trusted-html-provenance.test.ts -t "literal element access|local re-export barrel|export-star barrels|renderedHtml through local aliases" --reporter=dot` passed 4 focused KV426 resolver tests; `pnpm exec vitest --run packages/compiler/src/scan/parse.test.ts -t "records literal element request db write sink facts" --reporter=dot` passed the literal `request['db']` write-fact proof; M3 killed the element-access and export-star resolver mutants.
  - [x] Populate the resolver's cross-file edge in the REAL build (see E2/M2), so cross-file re-export gates
        in production, not only fixtures — `bugz-25` B7.
        Evidence: M1 `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight" --reporter=dot` passed, using `./safe-html.js` -> TS sibling `export *` barrels in a real `kovo build --no-cache`; M2 `pnpm run check:security-test-builds` passed 14 real-build proofs.
  - Acceptance: `ns['trustedHtml'](taint)`, a local `export { trustedHtml } from '@kovojs/browser'` barrel,
    and `export *` barrels all fire KV426 in a real `kovo build`; computed `request['db']` appears in
    `kovo explain`; the expression-kind table has no blank/silent-clean cell; M1–M3 green.

- [x] **E2. Harness fidelity (the concrete implementation of M2).** Closes the divergence behind `bugz-25` B7.
  - [x] Register project sibling files with the resolver in the real Vite/compile transform + build driver so
        `resolveProjectSourceFile` runs in production (today it is fed only by conformance `extraFiles`).
        Evidence: `pnpm exec vitest --run packages/core/src/internal/framework-identity.test.ts packages/compiler/src/vite.test.ts -t "framework identity resolver|registers local source files for framework identity|invalidates the Vite transform cache" --reporter=dot` passed 6 focused tests covering `viteFrameworkIdentityFiles`, compile registration, cache invalidation, and resolver lookup.
  - [x] Route the metamorphic harness through the SAME production build/resolve path — a green metamorphic
        result MUST imply a green production result.
        Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-build.test.ts -t "resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight" --reporter=dot` passed the KV426 export-star/literal element-access case through `mainAsync(["build", "./app.ts", "--out", "./dist", "--no-cache"])`.
  - [x] Add the M2 lint/gate: any security test not exercising the real build path fails CI.
        Evidence: `pnpm run check:security-test-builds` passed 14 real-build proofs and keeps the KV426 export-star resolver proof enrolled with `buildInvocation=cli-main-build`; `pnpm run check:security-gate-mutations` killed `security-test-build-gate/drop-production-build-invocation-check`.
  - Acceptance: a cross-file re-export barrel the metamorphic suite marks caught is ALSO caught by a real
    `kovo build`; no security gate has fixture-only or `it.todo` coverage.
  - Evidence: M1 CLI real-build proof above failed before artifact emission with KV426; M2 real-build gate passed 14 proofs; M3 mutation gate killed 30 mutants, including the E2 production compile and Vite sibling-candidate mutants.

## Phased delivery

- [x] **Phase 1 — stop the bleeding + install the gates.** H (statement-parse-primary read handle) + I core
      (driver-agnostic SQL-safety + KV422 floor + unknown-driver-fails-closed), and stand up M1 (adversarial gate)
      and M2/E2 (real-build test path) so everything after is verified honestly. Closes the two self-verified HIGH
      holes (`readonlyAppDb` writes; SQLite cross-check dead).
      Evidence: H/I rows and M1/M2/M3 meta-invariants are closed; `pnpm run check:fundamental-fixes-census` passed with `complete: true`.
- [x] **Phase 2 — resolver + census (a) completion.** B3 (expression-kind table, element-access, `export *`,
      cross-file) with E2; close the remaining census-(a) handles (`WebhookTxDb`, storage). Add M3 mutation testing.
      Evidence: B3/E2 and census-(a) rows are closed; `pnpm run check:security-gate-mutations` passed with 32 mutants killed.
- [x] **Phase 3 — census (b) closure (all output sinks, no deferral).** C2 across every census-(b) row:
      value-flow fail-closed-on-unprovable, KV435/KV426/KV311, plus streaming/headers/error-shells/capability-URLs.
      Evidence: census-(b) rows are closed in `scripts/fundamental-fixes-census.manifest.json`; `pnpm run check:fundamental-fixes-census` passed with `complete: true`.
- [x] **Phase 4 — retire the wrong metric, prove the census.** Replace the inventory done-signal with the
      M4 census + resolver-table + dialect-matrix all green; run the full M1 adversarial sweep on the prod
      artifact for both dialects; only then is the program "complete."
      Evidence: `pnpm run check:fundamental-fixes-census` passed with 138 rows and `complete: true`; M2 and M3 gates passed with 22 real-build proofs and 32 killed mutants.

## Risks / questions

- H statement-parse cost: parsing every driver call has runtime overhead — measure; keep the read-builder
  allowlist as a fast-path so only ambiguous/raw calls parse. A missed read builder is a fail-CLOSED papercut
  (annoying, not unsafe), caught by read-path tests.
- C2 value-flow bound: "prove off-wire, else KV406" needs an actionable "declare this read off-wire"
  escape (itself provenance-checked per `fundamental-fixes.md` §"The escape hatch") so fail-closed doesn't
  storm; the escape must be declare-and-verify, never name-and-bypass.
- M1 cost: an independent adversarial pass per workstream is real effort — budget it; it is the gate that
  distinguishes "checklist done" from "adversarially true," which is the whole point of this follow-up.
- E2/M2 build-cost: registering sibling files in the transform (currently one-module `readFileSync`) has a
  perf implication — measure and bound.

## Latest verification

- Findings + first-hand evidence in `plans/claude-bugz-25.md` (B1/B6 self-verified) and
  `plans/claude-papercuts-23.md`. No code, `SPEC.md`, or other plans changed by this document.

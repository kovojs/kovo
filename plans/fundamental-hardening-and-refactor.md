# Fundamental Hardening & Refactoring — unified, self-contained plan

Created 2026-07-01. **This document is self-standing:** every item carries its own evidence (file:line),
root-cause, decision, fix scope, and verification — no need to open other plans or ledgers. Absorbs
`plans/hvr.md` (High-Value Refactoring 5) and the round-5 findings (`claude-bugz-26.md`,
`claude-papercuts-24.md`). Continues the already-implemented `fundamental-fixes.md` + `-followup.md`; their
meta-invariants M1–M5 remain in force. Source of truth for framework behavior is `SPEC.md` (§2, §5, §6.6, §11).

Every leaf checkbox is a single commit. Where two copies of "the same" security logic disagree, the
unification IS the bug fix and the intended semantics is decided in the item.

## Why this order

The refactoring items are the **substrate** for the hardening items:

- The hardening program promises "**one** classifier / **one** choke / brand-derived census." You cannot have
  "one" while there are 2–4 divergent live copies (D1/D2/D3, C2, S1/S3/S4/S5) — hardening copy A while B stays
  fail-open, or minting a _third_ copy, is the trap. **Dedup first.**
- The hardening program _adds gates_. **T1** is a silent gate-bypass (a checkout path with a space makes a gate
  `exit 0` without running) and **T2** is a walker where files silently escape a gate — new gates on that infra
  are bypassable and their completeness claims unsound. **Fix gate infra first.**
- Exception: the **live, self-verified DDL hole (Phase 0)** sits in files the refactors don't touch, so it ships first.

## Meta-invariants (nothing is "done" until all hold)

M1 independent adversarial (`/dogfood`) pass on the prod artifact, every dialect, by a non-implementer, finds
zero fail-opens · M2 every security test builds through the real `kovo build` path (no fixture-only shortcut) ·
M3 mutation testing: deleting any gate branch turns a test red · M4 completeness measured by the census, not a
recognizer count · M5 no deferred sinks · **M6** every classifier fails closed on anything it cannot positively
prove safe · **M7** the census denominator is derived from source, not hand-authored · **M8** one fail-closed
runtime choke per sink category; static is advisory · **M9** categories from a threat taxonomy (DEC11) · **M10**
every static gate has a runtime enforcement twin (§11.2 `observed ⊆ static ∪ declared`) · **M11** gate scope is
brand-derived and every completeness gate has a planted-canary negative test · **M12** oracle + fuzz + green
corpus · **M13** the security suites run `dialect × preset × adversary`.

## Decisions register (DEC1–DEC12)

- **DEC1** — "security-decision function" = any function wrapped by `securityClassifier(name, fn)` (new brand, G3).
- **DEC2** — permissive-default is a build error: in a `securityClassifier` body, a terminal/fallback arm yielding
  the safe/allow/empty value without a positive-proof branch (`switch default:` returning non-closed; a
  fall-through `return <permissive>`; `?? <permissive>` / `|| <permissive>`; `if (!proven) return <permissive>`) is
  flagged. Required shape: return CLOSED by default; return safe only inside `if (proven…) return <safe>`.
- **DEC3** — SQL write-detection oracle = execute-and-diff-in-transaction (both dialects): BEGIN; snapshot
  `sqlite_master`/`pg_catalog` + affected-row counts; run; diff; ROLLBACK. Static/oracle mismatch fails CI.
- **DEC4** — the DB-write choke is one function `enforceManagedSql()` in `sql-safe-handle.ts`; the driver methods
  `run/get/all/values/execute/query/prepare/exec/$client/session` may appear ONLY there (lint P.1).
- **DEC5** — the wire-output choke is one function `emitToWire(value, channel, provenance)`; it refuses a value
  carrying a secret-classified provenance tag.
- **DEC6** — the egress choke is the existing egress floor; task `ctx.fetch` + webhook + agent-tool egress route through it.
- **DEC7** — the value-flow proven-off-wire allowlist is EXACTLY: (a) a direct `return db.select({<proj>}).from()`
  where every `<proj>` is a non-secret column of a resolved table; (b) an object/array literal whose leaves are
  non-secret columns of an analyzable select bound in-body, literals, or non-secret args/request scalars; (c)
  `.map(row => <literal per (b)>)` over an analyzable non-secret select. Everything else (unresolved call result,
  spread from unknown, closure invocation, member into unknown, Promise/await of un-analyzable, dynamic key,
  `.reduce/.flatMap`, `Object.*`) → KV435/KV406 fail-closed, dischargeable only by the provenance-checked
  `declare off-wire` escape.
- **DEC8** — the matrix is `{node, cloudflare, vercel} × {pglite, better-sqlite3}`; security suites run it in CI.
- **DEC9** — adversary map: DDL/SQL guards → hostile committer; KV426/KV435/taint → hostile end-user input;
  census/lint/policy gates → honest-fallible author; capability/auth gates → hostile end-user; egress → hostile
  committer + input.
- **DEC10** — green corpus = `examples/*` + the create-kovo starter (both dialects) + captured round-1..5 dogfood
  green patterns; must build with zero new KV errors after every J/K/L tightening.
- **DEC11** — the M9 threat-category set is fixed (9): egress/SSRF, filesystem, subprocess, deserialization,
  secret-lifecycle, auth-decision, DoS/rate-limit, timing side-channel, open-redirect/navigation.
- **DEC12** — legitimate DDL (schema init/migrations) runs on the un-managed provider, NOT a managed handle; the
  choke fails closed for app raw-SQL DDL (J.2 test).

## Scope discipline

- Refactors are behavior-preserving per `SPEC.md` unless the item says the copies disagree; those require a SPEC
  check to pick intended semantics first — and the unification is the fix.
- Compiler items respect `rules/compiler-hard-rules.md`: shared helpers stay AST/fact-string based (no new
  post-parse source-text channel); lowering stays fixpoint-stable.
- No overlap with open items in `plans/high-value-refactoring-4.md` (P1.4–P2.5) or the CAP items in
  `plans/compiler-refactoring.md`. HVR-4 P1.5 (unify response header floors) is complementary to S4/S5.

---

## Phase 0 — Stop the live bleed (self-verified HIGH; isolated files; no gate deps)

- [x] **J.1 — Classify DDL as a write in `writeTablesForStatement`.**
  - Problem: `packages/server/src/sql-write-allowlist.ts:119-134` switches only on
    `insert/update/delete/truncate table/with/with recursive`; `drop/alter/create table` (parsed fine by
    `pgsql-ast-parser`) hit `default: return []` → "not a write".
  - Fix (single commit): add cases returning target tables (or a new `UNTABLED_WRITE` sentinel) for
    `drop/alter/create table`, `create/drop index/trigger/view`, `attach database`, write-`pragma`, `vacuum`,
    `reindex`, and procedural blocks.
  - Verify: `parseSqlWriteTables('DROP TABLE contacts',{dialect:'sqlite'})` returns non-empty; `DELETE FROM contacts` still returns `['contacts']`.
  - Evidence: `pnpm exec vitest --run packages/server/src/sql-write-allowlist.test.ts packages/server/src/managed-db.test.ts` proves DDL/procedural statements return `UNTABLED_SQL_WRITE` while `DELETE FROM contacts` remains `['contacts']`.
- [x] **J.2 — Make both enforcement sites fail closed on non-proven-reads (closes `bugz-26` B1).**
  - Problem (self-verified both sites): `packages/server/src/sql-safe-handle.ts:582` (`assertReadSqlStatement`, the
    read-only floor) and `:550` (`assertSqlWriteTablesAllowed`, the declared-tables allowlist) both `if (writeTables.length === 0) return;`
    → a DDL statement (empty write set) is allowed. Confirmed: `readonlyDb(db).run(ksql`DROP TABLE contacts`)`
    executes (table count 1→0) while `DELETE` throws; a `wrapManagedDbForSqlSafety(db,undefined,{capability:'write',tables:['contacts']})`
    handle runs `DROP TABLE userx` (count 2→1) while `UPDATE userx` throws KV406.
  - Fix: the read-only floor rejects any statement not positively proven read-only; the write allowlist rejects
    `UNTABLED_WRITE` and any write not proven within `tables:`. Add a test that the starter's schema-init path runs
    on the un-managed provider, not a managed handle (DEC12).
  - Verify: the two isolation flips above now throw; a plain read still passes; starter `build:prod` stays green.
  - Evidence: `pnpm exec vitest --run packages/server/src/sql-write-allowlist.test.ts packages/server/src/managed-db.test.ts` proves read/write managed handles throw before executing raw SQL DDL and still pass ordinary reads/allowed DML; `pnpm exec vitest --run packages/create-kovo/src/index.test.ts` proves starter DDL runs on raw client/database before managed readonly wrapping.

## Phase 1 — Fix the gate infrastructure (so every later gate is trustworthy)

- [x] **T1 — One `isMainEntry` + one exit convention (silent gate-bypass hazard).** (M · low)
  - Problem: ≥8 run-as-main spellings; the `` `file://${process.argv[1]}` `` form
    (`scripts/check-spec-index.mjs:238`, `no-committed-generated.mjs:44`) and `.pathname` comparisons
    (`build-publish.mjs:253`, `check-pack-security.mjs:537`, `egress-floor.mjs:115`, `supply-chain-gates.mjs:96`) do
    not round-trip percent-encoding, so a checkout path with a space makes a security gate `exit 0` without running.
    Exit is also split (`process.exit(1)` in ~9 vs `process.exitCode = 1` in ~6; the former truncates buffered output).
  - Fix: add `scripts/lib/cli-entry.mjs` — `isMainEntry(importMetaUrl)` via `pathToFileURL`, `runGate(main)` setting
    `exitCode`; adopt everywhere. **Every new gate below uses `runGate`.**
  - Verify: each gate's `.test.mjs`; a path-with-space test that the gate still runs.
  - Evidence: `pnpm exec vitest --run scripts/check-spec-index.test.mjs scripts/no-committed-generated.test.mjs scripts/check-sink-policy-gate.test.mjs scripts/fundamental-fixes-census-gate.test.mjs scripts/check-pack-security.test.mjs scripts/egress-floor.test.mjs scripts/supply-chain-gates.test.mjs scripts/public-packages.test.mjs scripts/security-gate-mutations.test.mjs` passed after merging `agent/fundamental-t1-cli`.
- [x] **T2 — One source-file walker + `isProductionSourceFile` policy.** (M · med)
  - Problem: six independent recursive walkers with differing exclusion sets feed gates that decide which files get
    scanned for dangerous sinks (`check-sink-policy-gate.mjs:2344/2354/2374`, `check-pack-security.mjs:432`,
    `compiler-build-id.mjs:30`, `import-boundary.mjs:258`, `fundamental-fixes-inventory.mjs:117`, `ci-shards.mjs:515`);
    an omission in one means files silently escape a gate.
  - Fix: `scripts/lib/source-files.mjs` with one canonical collect + `isProductionSourceFile` predicate; adopt in all
    six; preserve each caller's current filter (their `.test.mjs` siblings cover it).
  - Evidence: `pnpm exec vitest --run scripts/lib/source-files.test.mjs scripts/check-sink-policy-gate.test.mjs scripts/check-pack-security.test.mjs scripts/import-boundary.test.mjs scripts/fundamental-fixes-inventory.test.mjs scripts/ci-shards.test.mjs` passed after merging `agent/fundamental-t2-source-files`.
- [x] **T8 — Fold repo-root bootstrapping into `scripts/lib`.** (S · low)
  - Problem: four `repoRoot` computations (`check-sink-policy-gate.mjs:6`, `public-packages.mjs:14`,
    `security-gate-mutations.mjs:13`, `fundamental-fixes-census-gate.mjs:9`).
  - Fix: one `repoRoot()` in `scripts/lib`; adopt (rides T1/T2's shared module).
  - Evidence: `pnpm exec vitest --run scripts/check-spec-index.test.mjs scripts/no-committed-generated.test.mjs scripts/check-sink-policy-gate.test.mjs scripts/fundamental-fixes-census-gate.test.mjs scripts/check-pack-security.test.mjs scripts/egress-floor.test.mjs scripts/supply-chain-gates.test.mjs scripts/public-packages.test.mjs scripts/security-gate-mutations.test.mjs` passed after merging `agent/fundamental-t1-cli`.

## Phase 2 — Collapse divergent security copies to one authority

- [x] **D3 — Move the byte-identical mutation-config cluster to `static/domain-writes.ts`.** (S · low; precursor to D1)
  - Problem: `forEachMutationConfig`, `mutationHandlerCallback`, `rawTablesFromMutationRegistry`,
    `isTrustedSqlArgument` are exact copies in `packages/drizzle/src/static.ts` (2130/2170/2162/2349) and
    `static/derivation.ts` (1266/1306/1298/1353) — the cluster D1 already drifted in.
  - Fix: pure mechanical dedup into `static/domain-writes.ts`.
  - Evidence: `pnpm exec vitest run packages/drizzle/src/raw-sql-static.test.ts packages/drizzle/src` passed after merging `agent/fundamental-d1-domain-writes`.
- [x] **D1 — Unify `rawWriteSqlTrustForCallback` (security divergence).** (M · med)
  - Problem: `static.ts:2229` recursively follows raw-SQL sinks through local helpers
    (`rawWriteSqlTrustForNode`/`rawSqlLocalFunctionsByName` 2238-2277) with a method-aware
    `sqlSinkReceiverCanCarrySql(expr, surface.name)`; `derivation.ts:1327` does a flat one-level scan with a
    method-agnostic check. A raw-SQL write hidden in a local helper called from a mutation handler is flagged by the
    first, **missed by the second** → a wrong "trusted" verdict.
  - Decision: the helper-following (`static.ts`) version is intended (confirm vs SPEC §11.1). Extract it as the one
    impl in `domain-writes.ts`; delete the divergence.
  - Verify: `pnpm --filter @kovojs/drizzle test`; a fixture where a helper-hidden raw write is now flagged.
  - Evidence: `pnpm exec vitest run packages/drizzle/src/raw-sql-static.test.ts packages/drizzle/src` passed after merging `agent/fundamental-d1-domain-writes`, including the helper-mediated mutation registry raw-write regression.
- [x] **D2 — Single `isQueryShapeWrapper`; the `schema.ts` copy drops `table-row` (secret-projection bug).** (S · med)
  - Problem: triplicated at `static.ts:366`, `static/query-shapes.ts:2797`, `static/schema.ts:111`. The schema.ts copy
    (116-120) omits `shape.kind === 'table-row'`, so `secretQueryShape` (schema.ts:103) wraps a table-row secret whole
    instead of recursing into `.shape` — a KV435 secret-projection miss.
  - Fix: export one predicate covering all six `QueryShapeWrapper` kinds (static.ts:236); delete copies; confirm the
    changed table-row secret output vs SPEC/tests.
  - Evidence: `pnpm exec vitest run packages/drizzle/src/index.query-shapes.test.ts packages/drizzle/src`, `vp check packages/drizzle/src/static.ts packages/drizzle/src/static/query-shapes.ts packages/drizzle/src/static/schema.ts packages/drizzle/src/index.query-shapes.test.ts`, and `git diff --check HEAD~1..HEAD` passed after unifying `isQueryShapeWrapper` and adding table-row secret projection regression coverage.
- [x] **C2 — Single `propertyNameText`; the KV426 copy omits `isNumericLiteral`.** (S · low-med)
  - Problem: five copies, three behaviors. `validate/trusted-html-provenance.ts:905` omits `isNumericLiteral`, so
    `{ 0: x }` resolves to `null` in the KV426 recognizer; `style.ts:1374` rejects template keys
    (`isStringLiteral` not `isStringLiteralLike`). Others: `route-pages.ts:983`, `optimistic-inline.ts:497`,
    `mutation-inputs.ts:137`, `parse.ts:2215`.
  - Fix: one helper covering Identifier + StringLiteralLike + NumericLiteral; verify the two narrower call sites don't rely on rejection.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/trusted-html-provenance.test.ts packages/compiler/src/style.test.ts packages/compiler/src/parse.test.ts packages/compiler/src/reactive-aliases.test.ts packages/compiler/src/redos-pattern.test.ts packages/compiler/src/route-pages.test.ts packages/compiler/src/mutation-inputs.test.ts packages/compiler/src/optimistic-inline.test.ts`, `vp check packages/compiler/src/scan/ast.ts packages/compiler/src/scan/parse.ts packages/compiler/src/analyze/reactive-aliases.ts packages/compiler/src/validate/redos-pattern.ts packages/compiler/src/scan/route-pages.ts packages/compiler/src/scan/mutation-inputs.ts packages/compiler/src/scan/optimistic-inline.ts packages/compiler/src/validate/trusted-html-provenance.ts packages/compiler/src/style.ts packages/compiler/src/trusted-html-provenance.test.ts packages/compiler/src/style.test.ts`, and `git diff --check HEAD~1..HEAD` passed after moving identifier/string-like/numeric property-name handling into `scan/ast.ts` and adding KV426/style regressions.
- [x] **C1 — One `unwrapExpression` for the compiler.** (M · med)
  - Problem: four copies peel different wrapper sets — `parse.ts:892` + `reactive-aliases.ts:357` (paren/non-null/as/
    satisfies), `redos-pattern.ts:397` (+`TypeAssertion`), `route-pages.ts:990` (+`TypeAssertion`+`Await`) — so the
    same authored expression normalizes differently per phase.
  - Fix: one shared AST-util (superset unless a phase demonstrably needs less); pin with fixpoint/golden tests first.
  - Evidence: Same focused compiler Vitest/VP/diff checks listed for C2 passed after replacing the divergent unwrap copies with the shared `unwrapExpression` helper in `scan/ast.ts`.
- [x] **S1 — Shared `guardFailureToResult`; four copies disagree on `auth`.** (S · low)
  - Problem: `route.ts:664` (`routeGuardFailure`, incl. `auth`) + `query.ts:431` (incl. `auth`) vs `mutation.ts:293`
    plus `mutation.ts:450` (omit `auth`) → can drop the unauthenticated→login redirect / `retryAfter` on the mutation surface.
  - Decision: determine whether the mutation paths' missing `auth` is intended (SPEC §9.5) before unifying; move
    `routeGuardFailure` into `guards.ts` as the single mapper; call from all four.
  - Evidence: `pnpm exec vitest --run packages/server/src/csrf.test.ts packages/server/src/guards.test.ts packages/server/src/route-query-guards.test.ts packages/server/src/route.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/mutation.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/mutation-no-js.test.ts packages/server/src/mutation-wire.test.ts packages/server/src/mutation-response.test.ts packages/server/src/replay.test.ts`, `vp check packages/server/src/guards.ts packages/server/src/route.ts packages/server/src/query.ts packages/server/src/mutation.ts packages/server/src/guards.test.ts`, and `git diff --check HEAD~1..HEAD` passed after route/query/mutation guard failures used the shared `guardFailureToResult` mapper while preserving mutation reauth/403 behavior.
- [x] **S3 — Collapse the double CSRF→parse→guard in the mutation lifecycle.** (M · med)
  - Problem: `executeMutationLifecycle` validates CSRF, parses input, maps guard failure (`mutation.ts:256-303`), then
    `runMutation` repeats the byte-identical CSRF gate (`:414`), parse, and guard mapping (`447-457`) — two identical
    security gates kept in lockstep by hand.
  - Fix: route all callers through one gate via a module-private `csrfValidated` sentinel consumed by `runMutation`;
    preserve the normative CSRF→parse→guard order (SPEC §9.1).
  - Evidence: Same focused server Vitest/VP/diff checks listed for S1 passed after `runMutation` consumed a module-private validated lifecycle sentinel and regression coverage asserted a single CSRF→parse→guard pass.
- [x] **S4 — One cookie-safe header-bag; make the unsafe spread unrepresentable.** (M · low)
  - Problem: the correct multi-value model exists (`response.ts:12` `ResponseHeaders`, `appendResponseHeader`,
    `mergeMutationResponseHeaders`), but many paths build ad-hoc `Record<string,string>` combined by object spread
    (`mutation.ts:833-843`, `webhook.ts:1034`, `response.ts:409` `retryAfterHeaders`, `query.ts:887`) — a spread of two
    bags silently collapses multiple `Set-Cookie`.
  - Fix: make the ad-hoc builders return `ResponseHeaders`, route every merge through the cookie-safe combinator;
    consider a branded `HeaderBag` whose only combinator is the safe merge (per CLAUDE.md type-level ergonomics).
  - Evidence: `pnpm exec vitest --run packages/server/src/response.test.ts packages/server/src/mutation-response.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/webhook.test.ts`, `vp check packages/server/src/response.ts packages/server/src/mutation.ts packages/server/src/query.ts packages/server/src/webhook.ts packages/server/src/response.test.ts packages/server/src/mutation-response.test.ts packages/server/src/query-endpoint.test.ts`, and `git diff --check HEAD~1..HEAD` passed after routing response header merges through the cookie-safe `mergeResponseHeaders` combinator and preserving repeated `Set-Cookie` in retry-after, mutation, and query response paths.
- [ ] **S5 — Share the fail-closed replay reservation; one webhook response builder.** (M · med)
  - Problem: `webhook.ts:741` (`reserveWebhookReplayBeforeRun`) hand-mirrors the mutation reserve→get→re-reserve→
    fail-closed machine (`replay.ts` / `mutation.ts:1143-1250`); the `Cache-Control: private, no-store` + `Content-Type`
    webhook floor is inlined 5× (`webhook.ts:962,997,1013,1024,1034`).
  - Fix: lift the reservation into `replay.ts` (parameterized by store shape); add one `webhookResponse(...)` builder owning the floor.
- [x] **S2 — De-duplicate the Node⇄Web HTTP adapter (Set-Cookie parity).** (M · med)
  - Problem: live `node.ts:344` (with `getSetCookie()` splitting + HTTP/2 pseudo-header rationale) vs the string-emitted
    copy in `nodeAdapterRuntimeSource()` `build.ts:606` (already diverged: `build.ts:713` guards `typeof
headers.getSetCookie === 'function'` where `node.ts:369` doesn't). Dev (vite-dev.ts imports node.ts) and every prod
    preset run different physical copies of the header bridge.
  - Fix: generate the emitted adapter from the same source, or add a parity test asserting Set-Cookie + pseudo-header agreement.
  - Evidence: `pnpm exec vitest --run packages/server/src/node.test.ts packages/server/src/build.test.ts`, `vp check packages/server/src/build.ts packages/server/src/build.test.ts`, and `git diff --check HEAD~1..HEAD` passed after the emitted Node/Vercel adapter tests asserted live parity for multi-value `Set-Cookie`, HTTP/2 pseudo-header URL fallback, and pseudo-header filtering.
- [x] **G2 + J.3 — SQL oracle + validate J (DEC3, M12).**
  - Add `packages/server/src/sql-write-oracle.ts` (execute-and-diff-in-transaction; pglite + better-sqlite3) and
    `sql-write-allowlist.oracle.test.ts` cross-checking `writeTablesForStatement` vs the oracle over the DDL corpus,
    on the DEC8 matrix (uses T1 `runGate`). A static/oracle mismatch fails CI.
  - Evidence: `pnpm exec vitest --run packages/server/src/sql-write-allowlist.oracle.test.ts packages/server/src/sql-write-allowlist.test.ts`, `vp check packages/server/src/sql-write-oracle.ts packages/server/src/sql-write-allowlist.oracle.test.ts`, and `git diff --check` passed with transaction-rollback oracle coverage for PGlite/Postgres and better-sqlite3/SQLite over DML, DDL, view/index, and SQLite pragma cases.
- [ ] **P.1 — DB-write choke (DEC4, M8).**
  - Route every handle family (`readonlyDb`×6, `managedDb`, `wrapManagedDbForSqlSafety`, webhook Tx, storage,
    `createDurableTaskSqlExecutor`) through `enforceManagedSql()`; add `scripts/check-single-choke.mjs` (via `runGate`)
    asserting the driver methods appear only inside the choke.

## Phase 3 — Structural splits (so later edits land in the right module)

- [x] **D5 — Finish the `static.ts` monolith extraction.** (L · med; after D1/D2/D3)
  - `packages/drizzle/src/static.ts` (4913 lines) re-exports 13 `static/*` modules yet still privately defines parallel
    copies (root of D1/D2/D3; the loose `'kind' in shape` at static.ts:3354 vs the strict predicate at
    query-shapes.ts:2790). Move query-shape traversal → `query-shapes.ts` (shared `foldQueryShape` visitor);
    raw-write/mutation cluster → `domain-writes.ts`; leave static.ts a thin barrel.
  - Evidence: `pnpm exec vitest run packages/drizzle/src`, `vp check packages/drizzle/src/static.ts packages/drizzle/src/static/query-shapes.ts packages/drizzle/src/static/domain-writes.ts`, and `git diff --check HEAD~1..HEAD` passed after moving query-shape traversal helpers and `foldQueryShape` into `static/query-shapes.ts` and raw-write/mutation handler map helpers into `static/domain-writes.ts`.
- [ ] **S6 — Split `mutation.ts` along the `mutation/` seam.** (L · low-med; after S3)
  - The 1973-line file mixes the lifecycle SM (242-382), `runMutation` (398-550), enhanced wire (744-1034), no-JS PRG
    (1071-1524), replay adapters (1143-1250), failure HTML (1686-1803). The enhanced/no-JS reauth + stale-session-CSRF
    branches are hand-forked pairs differing only in the terminal builder (1825-1842 vs 1936-1951; 1844-1867 vs
    1869-1892) despite `MutationResponseDeliveryMode` (211-223) existing to dispatch them. Extract
    `mutation/{wire-response,no-js,replay-policy,failure-html}.ts`; compute the outcome once, map to mode-specific responses.
- [ ] **T6 — Split `graph-output.ts` (3046 lines) along input/args/formatters.** (L · low; after T3)
  - Extract `graph-input.ts` (`readGraphInput:73`, `discoverGraphInputPath:112`), `graph-args.ts` (after T3), and the
    ~35 pure `Fact→string` formatters (≈1300-3046) → `graph-explain-format.ts`; keep orchestration in graph-output.ts.
- [ ] **C3 — Exhaustive fold for the two `QueryShapeWrapper` codegen switches.** (M · med)
  - `types.ts:918` (`wrapperQueryShapeTypeExpr`) + `941-963` (`typeExprFromRevealedQueryShape`) enumerate the same
    union with divergent arms; exhaustiveness is enforced in only one → a new kind ships a silent `.d.ts` gap. Extract
    one `foldQueryShapeWrapper` with a `Record<kind,…>` handler; guard with `.d.ts` goldens.
  - Gap: `packages/drizzle/src/types.ts`, `wrapperQueryShapeTypeExpr`, and `typeExprFromRevealedQueryShape` are absent on the current `2eef549be` base and integration branch, so this checkbox remains open pending plan correction or a later typegen surface.
- [ ] **D4 — Add `assertNever` exhaustiveness to the Drizzle analyzer.** (M · low-med)
  - Zero exhaustiveness across ~20k lines. `PredicatePnf` (summaries.ts:3352, 6 kinds) is dispatched by ~9 partial
    if-chains (summaries.ts:537-552 silently returns `[]` for three kinds; :3772 handles only `eq`/`and`) → a new kind
    silently degrades to "no scope proven". Add a shared `assertNever`, terminate total chains with it, convert central
    dispatchers to `switch`.

## Phase 4 — The fail-closed program on the clean substrate

- [ ] **G1 — Fail-closed-classifier lint (DEC1/DEC2, M6/M11).**
  - `scripts/check-fail-closed-classifiers.mjs` (via `runGate`, T2 walker) implements DEC2 over DEC1-branded functions;
    exit 1 on any permissive default arm. Wire `check:fail-closed-classifiers` into `check`. Add
    `packages/conformance-fixtures/src/fail-closed-canary.fixture.ts` (a branded classifier with a permissive
    `default:`) + a test asserting the lint flags it (M11 canary).
- [ ] **G3 — Security-decision brand (DEC1, M11).**
  - Add `packages/core/src/internal/security-markers.ts`: `securityClassifier(name, fn)` + `wireEmitter(name, fn)`
    (module-private `unique symbol`). Wrap: (a) the DB-write choke + SQL classifiers (`sql-safe-handle.ts`,
    `sql-write-allowlist.ts`); (b) the response emitters (SSR document, `/_q`, mutation delta, stream, headers, error
    shell, capability URL) with `wireEmitter`; (c) the now-deduped compiler recognizers/taint gates
    (`trusted-html-provenance.ts`, `confidentiality.ts`, `query-shapes.ts`, `framework-identity.ts`). Add
    `scripts/check-security-brands.mjs`: every function reachable from an enforcement site / in a security-decision file
    MUST be branded; unbranded → fail. (Split into 3.2a/3.2b/3.2c commits + the check.)
- [ ] **G4 — Fuzz corpus + green corpus (DEC10, M12).**
  - `packages/conformance-fixtures/src/adversarial-corpus.ts` + property generators (SQL, taint expressions,
    import/alias shapes). `scripts/check-green-corpus.mjs` builds the DEC10 corpus on both dialects and asserts zero new
    KV errors; wire into `check`.
- [ ] **G5 — Matrix + adversary map (DEC8/DEC9, M13).**
  - Parametrize the security suites by the DEC8 `preset × dialect` matrix. Add
    `packages/conformance-fixtures/src/gate-adversary-map.ts` encoding DEC9 + a test that every branded gate has an
    adversary and a matching hostile test.
- [ ] **K — Fail-closed KV426 recognizer (closes `bugz-26` B2; after C2).**
  - Problem (verified): direct `trustedHtml(request.headers.get('x-xss')??'')` → KV426 RED, but
    `const trust = { html: trustedHtml }; trust.html(reflected)` → GREEN, and the prod artifact reflects
    `<script>alert(document.cookie)</script>` from an `x-xss` header verbatim. Root: the KV426 recognizer
    (`trusted-html-provenance.ts:119-142`) recognizes a sink only via the brand resolver / dynamic namespace
    element-access / same-file identifier wrapper; a property-access callee on a local object matches none → returns
    null → the call is skipped (`:56-72`), with no fail-closed-on-unrecognized branch. Resolver gap:
    `framework-identity.ts:452-503` `namespaceMemberIdentity` doesn't resolve a property-access whose receiver is a var
    bound to an object literal.
  - Fix: **K.1** the resolver resolves an object-literal-member brand (`const trust={html:trustedHtml}; trust.html`);
    **K.2** the recognizer fails closed on any callee it cannot prove non-trust over request/query-derived args (DEC2;
    incl. `trustedUrl` and every raw-HTML/URL sink); **K.3** runtime twin (M10) — the SSR renderer (DEC5 wire choke)
    refuses an un-branded raw-HTML value.
  - Verify: object-literal member fires KV426 in a real `kovo build`; alias/as-cast/comma still fire (they already do).
- [ ] **L — Value-flow: narrow proven-off-wire allowlist + mutation-handler wire (closes `bugz-26` B3, B4).**
  - Problem B3 (verified): a second `{id, secret: contacts.apiKey}` select laundered onto the returned array via
    `const collect = () => { for (const r of secretRows) out.push({name:r.secret,…}); }; collect();` builds GREEN and
    the prod artifact serves the secret over `/_q` (top-level loop → KV435 RED). Root: `query-shapes.ts`
    `taintedValueReachesWire` recurses nested bodies only for named `FunctionDeclaration`s (`:419-435`), gates local-fn
    analysis behind `if (!taintedArgs) continue` (`:481`), and `topLevelDescendant` (`:774`) excludes the nested write.
  - Problem B4 (verified): a query loader projecting `session.token` → KV435 RED, but the identical read in
    `mutation({ handler })` returning `{ tokens: rows.map(r=>r.token) }` builds green — `redirectTo(result)`
    (`mutation.ts:241,305`) and `stream({result})` (`:884`) route it to the wire, but `confidentiality.ts:9`
    `validateSecretQueryWire` covers only query shapes.
  - Fix: **L.1** replace the form-chasing walk with the DEC7 allowlist (prove-off-wire only for DEC7 shapes, KV435/KV406
    fail-closed otherwise) — the arrow-closure fails because it's not on the allowlist, not because we enumerated
    arrows; **L.2** extend the same gate to mutation-handler returns via `redirectTo`/`stream` (shared via
    `confidentiality.ts:9`); **L.3** runtime twin (M10) — the DEC5 wire choke refuses a secret-tagged value; add the
    provenance-checked `declare off-wire` escape.
  - Verify: the arrow-closure laundering + the mutation-handler secret-return both fail closed; a legitimate non-secret
    literal return stays green (DEC10 corpus).
- [ ] **N — Source-derived census + enroll new surfaces (closes `papercuts-24` P1).**
  - Problem: `node scripts/fundamental-fixes-census-gate.mjs --require-complete` reports `complete: true` with ZERO
    durable-task rows, because it enforces a required-SET only for `resolver-expression-kind` + `dialect-sink`; the
    `write-capable-handle`/`output-wire-sink` denominators are hand-authored (`PLAN_CENSUS_SECTIONS`) and
    `requireComplete` only forces listed rows to `closed`.
  - Fix: **N.1** derive the write-capable-handle denominator from the G3.1-branded handle constructions (fail on any
    unlisted); **N.2** derive the output-wire-sink denominator from `wireEmitter` channels (fail on any unlisted);
    **N.3** enroll rows — DDL statement class, durable-task write family (`task`/`createDurableTaskSqlExecutor`/
    `request.schedule`/`TaskRunContext.*`/`_kovo_jobs`), mutation-handler wire, `createDurableTaskStatus.lastError`;
    **N.4** add a committed un-enrolled branded-sink canary the gate MUST flag (M11).
  - Verify: `--require-complete` FAILS on a source-discovered handle/channel with no row; the canary is caught.
- [ ] **P.2 / P.3 — Wire-output + egress chokes (DEC5/DEC6, M8; P.2 after S4/S5).**
  - P.2: route every response-emitting path through `emitToWire()`; structural test that no channel writes a
    `Response`/document/header outside it. P.3: route task `ctx.fetch` + webhook + agent-tool egress through the egress
    floor; structural test that outbound-network primitives appear only behind it.

## Phase 5 — Widen the net (M9 threat categories; one commit each + an M1 dogfood pass)

- [ ] **Q.1 egress / SSRF** — choke DEC6; destination allowlist; census section.
- [ ] **Q.2 filesystem** — single fs-access boundary; path-confinement gate.
- [ ] **Q.3 subprocess / command execution** — single exec boundary; default-deny.
- [ ] **Q.4 deserialization** — the request-body parser is the choke; schema-bounded shapes only.
- [ ] **Q.5 secret-material lifecycle** — `console.*` / logger / `reportServerError` / `createDurableTaskStatus` /
      at-rest columns scrub secret-tagged values via the DEC5 provenance tag.
- [ ] **Q.6 auth-decision points** — guard eval / `verifyCapability` / session provenance fail closed on an unresolved principal.
- [ ] **Q.7 DoS / rate-limit** — per-principal bucket keyed on a proven identity, not a shared `unknown` bucket.
- [ ] **Q.8 timing side-channel** — constant-time compare on secret-tagged material.
- [ ] **Q.9 open-redirect / navigation** — `redirect()` / `Location` route through the DEC5 choke; same-origin or allowlisted target.

## Phase 6 — Honesty edges + independent refactors (parallel worktrees)

- [x] **O.1** `task-observability.ts` redacts `lastError` on the same footing as `args` (`createDurableTaskStatus`
      returns `lastError` verbatim while `args` is redacted — a secret in a task error reaches the status surface). (`papercuts-24` P2)
  - Evidence: `pnpm exec vitest --run packages/server/src/task-observability.test.ts`, `vp check packages/server/src/task-observability.ts packages/server/src/task-observability.test.ts`, and `git diff --check` passed after the default status/failure surfaces redacted both `args` and `lastError`, with `{ includeArgs: true }` preserving privileged diagnostics.
- [x] **O.2** KV310 warns (not certifies-clean) when a hand-written optimistic transform's only consumers are
      fragment-target regions with no client optimism (SPEC §8:442 makes the fragment path a runtime no-op; the gap is
      the false-green certification — extend `papercuts-super-5` C1 from the no-consumer to the fragment-consumer case). (`papercuts-24` P3)
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-check.test.ts packages/compiler/src/scan/optimistic-inline.test.ts`, `vp check packages/cli/src/graph-output.ts packages/cli/src/index.kovo-check.test.ts`, and `git diff --check HEAD~1..HEAD` passed after KV310 treated fragment-only update coverage as a warning-worthy dead optimistic transform instead of a clean certification.
- Independent hvr fan-out (no dependency on the above):
  - [x] **C4** generic `mergeFactsByKey` for 7 byte-identical app-graph merge triplets (`app-graph.ts:164/194/215/236/316/351/361`, each with an unenforced key-fn/comparator, e.g. `mergeAccessExplainFacts` dedups on `kind\0name` but sorts on `kind,name,decision`). S · low.
    - Evidence: `pnpm exec vitest --run packages/compiler/src/registry.test.ts`, `vp check packages/compiler/src/app-graph.ts packages/compiler/src/registry.test.ts`, and `git diff --check` passed after extracting the four current key+sort fact merge triplets into `mergeFactsByKey`; task/handler/endpoint merges remain separate because they aggregate fields rather than doing simple caller/derived dedupe.
  - [ ] **C5** move byte-identical compiler micro-helpers to `shared.ts` — `uniqueSorted` (app-graph.ts:984, css.ts:554, package-styles.ts:283, route-pages.ts:380), `sanitizeIdentifier`/no-op `outputWriteFact` (style.ts + lower/structural-jsx.ts), three kebab variants. S · low.
  - [x] **C6** promote the rich `propertyAccessPath` (`parse.ts:708-745`: element access, zero-arg call receivers, optional chaining) as shared; retire the simplified `route-pages.ts:1034` / `query-binding.ts:146` copies (route/query-key facts diverge for accessor/call/optional forms). M · med.
    - Evidence: `pnpm exec vitest --run packages/compiler/src/scan/query-binding.test.ts packages/compiler/src/registry.test.ts packages/compiler/src/scan/parse.test.ts`, `vp check packages/compiler/src/scan/ast.ts packages/compiler/src/scan/parse.ts packages/compiler/src/scan/route-pages.ts packages/compiler/src/scan/query-binding.ts packages/compiler/src/scan/query-binding.test.ts packages/compiler/src/registry.test.ts`, and `git diff --check` passed after moving the richer property/call receiver path helper to `scan/ast.ts` and covering element access, zero-arg call receivers, and optional-chain route prop paths.
  - [ ] **T3** one CLI arg-parsing framework: express check/audit/explain as `CommandArgvSpec`s (`graph-output.ts:1261` `parseFlaggedArgs` diverges from `commands-manifest.ts:708` `parseCommandArgv` on `--flag=value`/missing-value/unknown-option); delete `parseFlaggedArgs`. M · med. _(precedes T6)_
  - [ ] **T4** shared `commandArgvError(name,error,usage)` + `requireSinglePositional(...)` (`build-export.ts:153,226` byte-identical; `compile.ts:587-822` repeats the mapper 7×). M · low.
  - [ ] **T5** shared `findNearestFile` + `readJsonRecord` (three drifted walk-ups: `build-export.ts:918` stops at `stopDir`, `compile.ts:416` to root, `build-export.ts:1556` to cwd; ~6 JSON idiom copies). S · low.
  - [ ] **T7** tightly-scoped `inline-loader-build.ts` cleanup: extract the ~80-entry line-array emission (`:1215`) into a named-parts builder; merge the readable/minified trusted-types assertions (`:1560,:1590`). Do NOT touch the `String.raw` installer (`:113-1042`) — byte-exact artifact parity. M · high (gate on `check:inline-loader` before/after).
  - [ ] **U1** `filterCollection({items,query,match,fields,excludeDisabled})` reconciling combobox (substring over label+textValue+value, keeps disabled: `combobox.ts:487,1054`) vs autocomplete (prefix over one field, excludes disabled: `autocomplete.ts:543,1183`). M · med.
  - [x] **U2** shared `isActivationKey` in `lib/keyboard-navigation.ts` (add legacy `'Spacebar'` to `select.ts:945`; siblings dropdown/context/menubar have it). S · low.
    - Evidence: `pnpm exec vitest run packages/headless-ui/src/lib/keyboard-navigation.test.ts packages/headless-ui/src/lib/active-descendant.test.ts packages/headless-ui/src/primitives/select.test.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/autocomplete.test.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/menubar.test.ts`, touched-file `vp check`, and `git diff --check HEAD~1..HEAD` passed after sharing `isActivationKey` across select/dropdown/context/menubar and covering legacy `Spacebar`.
  - [x] **U3** shared active-descendant/`describedBy` helpers in `lib/active-descendant.ts` (byte-identical at `combobox.ts:1007-1052` / `autocomplete.ts:1147-1191`). M · low.
    - Evidence: Same focused headless-ui Vitest/VP/diff checks listed for U2 passed after moving combobox/autocomplete active-descendant and described-by assembly into `lib/active-descendant.ts`.
  - [x] **U4** thread `now` through `selectKeyDown` (`select.ts:980` hard-codes `Date.now()`; siblings inject `now`; `selectTypeahead` already accepts it). S · low.
    - Evidence: Same focused headless-ui Vitest/VP/diff checks listed for U2 passed after adding deterministic `now` injection to `selectKeyDown`.
  - [ ] **U5** shared `triggerAttributes({open,disabled,controlsId,haspopup,labelledBy})` (`aria-controls` stripped when disabled by dropdown/context/menubar but emitted by select/combobox; `disabled` vs `aria-disabled` inconsistent). Diff ARIA snapshots. M · med.
  - [ ] **U6** `createCollectionAdapter({getItems,projector})` factory retiring the six-fold typeahead/move + option/result scaffolding (e.g. `dropdown-menu.ts:774-795` vs `select.ts:802-818`); home for U1/U2/U4. L · med.
  - [ ] **U7** delete or document the dead `lib/positioning-fallback.ts` (exported via `internal.ts:9,43`, consumed by nothing but its own test; primitives use CSS anchor positioning). Run `audit-public-api` first. S · low.

## Verification map

- Drizzle (D1–D5, L): `pnpm --filter @kovojs/drizzle test`, `pnpm run test:conformance`.
- Compiler (C1–C6, K): focused `@kovojs/compiler` test, `vp run compiler-perf`, render-equivalence/fixpoint, `.d.ts` goldens (C3).
- Server (S1–S6, J, P, O): `@kovojs/server` test; S2 parity test; `pnpm run test:integration` for mutation/webhook wire.
- CLI/scripts (T1–T8, G1–G5, N): `@kovojs/cli` test; each gate's `.test.mjs`; `pnpm run check` end-to-end; `check:inline-loader` + browser for T7.
- headless-ui (U1–U7): `@kovojs/headless-ui` test, `pnpm run test:browser`, gallery ARIA gate (U5); `audit-public-api` before U7.
- Program gates: `check:fail-closed-classifiers`, `check:security-brands`, `check:green-corpus`, `check:single-choke`, `fundamental-fixes-census-gate --require-complete`, `security-gate-mutations`, the DEC8 matrix.

## Areas checked and found healthy

- Compiler: no `as any` in non-test code; escaping centralized in `shared.ts` (`escapeAttribute`/`escapeCssString`).
- Server: webhook error swallowing (`webhook.ts:453,482,633-659`) is intentional fail-closed sanitization with SPEC cites, not a bug.
- headless-ui: `packages/ui` composes headless-ui without reimplementing; the `defaultPrevented` guard convention is machine-enforced (`tooling/primitive-handler-lint.ts`, KOVO_HUI001); `now`-injection is consistent except U4.
- Unproven (needs a deeper pass if pursued): token/value drift between `headless-ui/src/lib/token-sheet.ts` and `packages/style/src/theme.ts` — likely different layers, not duplicates.

## Latest verification

- Round-5 findings + first-hand evidence: `bugz-26` B1 self-verified on both enforcement sites (read-only floor
  `.run(DROP TABLE)` count 1→0; managed write handle `DROP TABLE userx` count 2→1); `papercuts-24` P1 verified
  (`--require-complete` reports `complete: true` with 0 durable-task rows). No code or `SPEC.md` changed by this document.

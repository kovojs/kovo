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

- [ ] **M1. Independent adversarial gate.** A workstream closes only after an isolation-flip sweep over its
      enumerated variant axes — run on the **prod artifact**, for **every supported dialect**, by an agent/
      reviewer that is **not the implementer** (a `/dogfood` pass or a second reviewer) — finds **zero**
      fail-opens. "My acceptance test passes" is necessary, not sufficient.
- [ ] **M2. No fixture-only security certification.** Every test that certifies a security property resolves/
      builds through the **production `kovo build` code path** (not a fixture-only `extraFiles`/unit shortcut).
      Add a lint/gate that flags a security test which does not exercise the real build. (Generalizes E2; the
      `bugz-25` B7 root was the _safety net itself_ certifying a production fail-open.)
- [ ] **M3. Mutation testing on the gates.** For each security gate, deleting/negating any one branch MUST
      turn a test red. A branch whose removal breaks no test has fake coverage and blocks "done." (This is what
      let "explicitly marked safe" + green metamorphic tests coexist with a live fail-open.)
- [ ] **M4. Completeness by census, not count.** "Done" is measured by the **Sink & handle census** below +
      the **resolver expression-kind table** (B3) + the **dialect × sink matrix** (I) all green — NOT by a
      syntactic-recognizer count. Retire `scripts/fundamental-fixes-inventory.mjs`'s "N candidates" as a
      done-signal (it counts _present_ checks, not _missing_ edges / denylist gaps / dialect gaps).
- [ ] **M5. NO DEFERRAL of sinks.** Every row of the Sink & handle census is enumerated and **closed in this
      plan**. "Future candidate," "out of scope," or "deferred" is **not an allowed status** for a sink or a
      write-capable handle. A known-but-unclosed sink is an open HIGH security item that **blocks "complete."**
      A newly discovered sink/handle is **added to the census and closed**, never parked.

## Sink & handle census (the M4 denominator — every row must reach `[x]`, no deferral per M5)

Master list of everything that can (a) write, or (b) reach a client/output channel. Each row is closed by
the named workstream and must pass M1–M3.

**(a) Write-capable handle surfaces** — close via H (statement-parse-primary allowlist) + I (dialect):

- [ ] `readonlyDb()` read-only loader/endpoint handle (×6 call sites) — `bugz-25` B1 [H]
- [ ] `managedDb(…, 'write')` mutation handle + `wrapManagedDbForSqlSafety` (×3) — `bugz-25` B2 [H/I]
- [ ] `WebhookTxDb` webhook transaction handle [H]
- [ ] storage / capability write handles (upload/store/delete) [H]
- [ ] raw driver `$client` / `.session` escape from any managed handle [H]
- [ ] unknown/future drizzle method OR driver dialect → **fails closed by default** (not a matrix update) [H/I]

**(b) Output / wire sinks** — close via C2 (enumerate from the emitted artifact; proof-or-KV406):

- [ ] SSR document HTML [C2]
- [ ] `/_q` query response [C2]
- [ ] mutation delta / enhanced-mutation response [C2]
- [ ] streaming / `<Defer>` chunks [C2]
- [ ] response headers (incl. `Set-Cookie`, redirects) [C2]
- [ ] error shells / 500 bodies [C2]
- [ ] capability URLs / signed payloads [C2]
- [ ] raw-HTML sinks (`trustedHtml`, `trustedUrl`, `@internal renderedHtml`) [C2/B3]
- [ ] client-derive bodies (leak / `ReferenceError` boundary) [C2]
- [ ] secret-column-to-wire across ALL value-flow paths [C2]

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

- [ ] **H. Read + SQL capability handles: statement-parse PRIMARY, allowlist only as a fast path.** Closes census (a); `bugz-25` B1.
  - Files: `packages/server/src/managed-db.ts` (`WRITE_VERBS` denylist `:27`; `readonlyDb` proxy `:74-87`;
    `Reader<Db>` type `:52-59`), `packages/server/src/sql-safe-handle.ts` (get-trap guard-set `:98-128`).
  - [ ] **Primary guard = parse the statement, not the method name.** Every call that reaches the driver
        (any method, any dialect) has its SQL parsed and its verb classified; a mutating verb on a read
        handle, or a write outside declared `tables:`, fails closed. A read-builder allowlist
        (`select`/`query`/`with`-read/`$count`) is only a fast-path that skips parsing — never the sole gate.
  - [ ] Any property NOT on the allowlist and NOT proven read-only → fails closed by default (kills the
        `.all/.get/.values/.transaction/.with` and any future-method escape), including `$client`/`.session`.
  - [ ] `Reader<Db>` becomes a read-surface type (mirrors the read builders), not `Omit<6 verbs>`, so
        `readonlyAppDb.all(...)`/`.transaction(...)` are `tsc` errors too.
  - [ ] Apply to EVERY census-(a) surface: the 6 `readonlyDb` sites, the `managedDb('write')`/
        `wrapManagedDbForSqlSafety` path, `WebhookTxDb`, and storage/capability write handles.
  - Acceptance: `readonlyAppDb.all(sql`DELETE … RETURNING`)`, `.get(sql`INSERT … RETURNING`)`,
    `.transaction(tx => tx.insert(...))` fail closed at runtime AND `tsc`; a public GET endpoint cannot
    mutate through any read handle (prod-artifact test, both dialects); reads still work; M1–M3 green.

- [ ] **I. Dialect parity — driver-agnostic guards + unknown-driver-fails-closed.** Closes `bugz-25` B2, `papercuts-23` A1; underpins H.
  - Files: `packages/server/src/sql-safe-handle.ts`, `packages/server/src/managed-db.ts`, the raw-SQL static
    classifier + escape-hatch discharge (`packages/drizzle/src/**`), `parseSqlWriteTables`.
  - [ ] The SQL-safety proxy + write-detection are **driver-agnostic**: they run the statement-parse guard
        on whatever method reaches the driver (`better-sqlite3` `.run/.get/.all/.values`, pglite `.execute`,
        and any future driver), restoring §11.2 `observed ⊆ declared` on **all** dialects.
  - [ ] The static raw-SQL classifier + escape-hatch discharge (`tables:`/`touches:`/`reads:`/`trustedSql`)
        recognize every dialect's sinks so a declared/attested SQLite raw statement builds; the diagnostic
        distinguishes a raw READ from a write site (fixes `papercuts-23` A1's mislabel).
  - [ ] **Unknown-driver test:** a synthetic handle whose method names the framework has never seen must
        FAIL CLOSED (no write reaches the driver un-parsed) — so the next driver (D1/libsql/…) is safe by
        construction, not by a matrix update.
  - [ ] Dialect × sink metamorphic matrix (feeds M4): for each SQL sink × {pglite, better-sqlite3, unknown},
        a cross-`tables:` write fails closed and a raw string fires KV422.
  - Acceptance: the `bugz-25` B2 smuggle throws on SQLite; a declared SQLite raw statement builds; the
    unknown-driver handle fails closed; per-dialect matrix green; M1–M3 green.

- [ ] **C2. Enumerate EVERY output sink from the artifact and require proof-or-KV406 (not a 3-gate migration).** Closes census (b); `bugz-25` B3/B4/B5, B8/B9, B10, `papercuts-23` A2. **No sink deferred (M5).**
  - Invariant: **every value reaching a client/output channel, every raw-HTML sink, and every SQL statement
    is enumerated from the lowered IR/emitted artifact and carries a proof; an un-enumerable one is KV406.**
    This is the census-(b) closure, not a fixed list of gates — a new channel is added to the census and closed.
  - [ ] **Value-flow / taint fails closed on UN-PROVABLE, never enumerate-the-forms.** A `secret:` column
        read must be _proven_ off-wire (else KV406) — no "trace `.find`/`.push`, miss `.reduce`/`Map`/JSON".
        Taint propagates through _every_ expression form (binary/logical/nullish/template/spread/call) or the
        unknown form is _tainted_ — never `return null`-as-clean (the current `trusted-html-provenance.ts:152-170` bug).
  - [ ] KV435 secret-to-wire: read/secret provenance fact carries the secret READ and its flow onto the
        returned shape; stop whitelisting resolved secret projections at `packages/drizzle/src/static.ts:2812`;
        cross-select laundering fails closed (`bugz-25` B10).
  - [ ] KV426 trusted-HTML: resolve the render request param by position/symbol (not name), collect query
        bindings from a non-destructured data param, propagate taint through all operator forms
        (`trusted-html-provenance.ts:82,84,152-170,435-440`) — `bugz-25` B3/B4/B5; add the same gate for
        `trustedUrl` + `TrustedUrl` in JSX `AttributeValue` (`papercuts-23` A2). Cover the `@internal renderedHtml` sink.
  - [ ] KV311 / island derives: destructured/chained/nested/computed/array aliases lower to a derive body over
        `state.<path>` (never a render-local binding) or fire KV311 — no green build over a `ReferenceError`
        derive or a silently-frozen node (`reactive-aliases.ts:31,131-132` + the `lower/structural-jsx.ts`
        emitter). Verify `claude-bugz-24` B5 (module-helper-in-derive) closes here.
  - [ ] The remaining census-(b) channels (streaming/`<Defer>`, headers/`Set-Cookie`, error shells,
        capability URLs) are each enumerated and proven — none deferred.
  - Acceptance: every census-(b) row's known-unsafe seed + value-flow siblings fail closed; a prod-artifact
    test where the leak/stale/crash was observable is green; the source re-walk for each migrated sink is
    removed/demoted so it cannot silently disagree with the fact model; M1–M3 green.

- [ ] **B3. Complete the resolver: an expression-kind coverage table with no blanks.** Closes `bugz-25` B6, B7, `papercuts-23` A3. (Continues B.)
  - Files: `packages/core/src/internal/framework-identity.ts` (`canonicalExpression` `:262-294`,
    `resolveProjectSourceFile` `:682-771`, `exportedIdentity` `:712-737`),
    `packages/drizzle/src/static/framework-identity.ts:152,165`.
  - [ ] Build a **resolver expression-kind table** (feeds M4): every `ts.SyntaxKind` an expression can be ×
        {resolved | fails-closed}. No blank cell — an unhandled kind falls to **fail-closed**, not silent
        `undefined`/clean.
  - [ ] Add `ElementAccessExpression` (literal key resolves like property access; non-literal computed key
        fails closed) — `bugz-25` B6; also fixes computed `request['db']` in the write-sink/explain
        extraction (`papercuts-23` A3). Add `export *` to `exportedIdentity`.
  - [ ] Populate the resolver's cross-file edge in the REAL build (see E2/M2), so cross-file re-export gates
        in production, not only fixtures — `bugz-25` B7.
  - Acceptance: `ns['trustedHtml'](taint)`, a local `export { trustedHtml } from '@kovojs/browser'` barrel,
    and `export *` barrels all fire KV426 in a real `kovo build`; computed `request['db']` appears in
    `kovo explain`; the expression-kind table has no blank/silent-clean cell; M1–M3 green.

- [ ] **E2. Harness fidelity (the concrete implementation of M2).** Closes the divergence behind `bugz-25` B7.
  - [ ] Register project sibling files with the resolver in the real Vite/compile transform + build driver so
        `resolveProjectSourceFile` runs in production (today it is fed only by conformance `extraFiles`).
  - [ ] Route the metamorphic harness through the SAME production build/resolve path — a green metamorphic
        result MUST imply a green production result.
  - [ ] Add the M2 lint/gate: any security test not exercising the real build path fails CI.
  - Acceptance: a cross-file re-export barrel the metamorphic suite marks caught is ALSO caught by a real
    `kovo build`; no security gate has fixture-only or `it.todo` coverage.

## Phased delivery

- [ ] **Phase 1 — stop the bleeding + install the gates.** H (statement-parse-primary read handle) + I core
      (driver-agnostic SQL-safety + KV422 floor + unknown-driver-fails-closed), and stand up M1 (adversarial gate)
      and M2/E2 (real-build test path) so everything after is verified honestly. Closes the two self-verified HIGH
      holes (`readonlyAppDb` writes; SQLite cross-check dead).
- [ ] **Phase 2 — resolver + census (a) completion.** B3 (expression-kind table, element-access, `export *`,
      cross-file) with E2; close the remaining census-(a) handles (`WebhookTxDb`, storage). Add M3 mutation testing.
- [ ] **Phase 3 — census (b) closure (all output sinks, no deferral).** C2 across every census-(b) row:
      value-flow fail-closed-on-unprovable, KV435/KV426/KV311, plus streaming/headers/error-shells/capability-URLs.
- [ ] **Phase 4 — retire the wrong metric, prove the census.** Replace the inventory done-signal with the
      M4 census + resolver-table + dialect-matrix all green; run the full M1 adversarial sweep on the prod
      artifact for both dialects; only then is the program "complete."

## Risks / questions

- [ ] H statement-parse cost: parsing every driver call has runtime overhead — measure; keep the read-builder
      allowlist as a fast-path so only ambiguous/raw calls parse. A missed read builder is a fail-CLOSED papercut
      (annoying, not unsafe), caught by read-path tests.
- [ ] C2 value-flow bound: "prove off-wire, else KV406" needs an actionable "declare this read off-wire"
      escape (itself provenance-checked per `fundamental-fixes.md` §"The escape hatch") so fail-closed doesn't
      storm; the escape must be declare-and-verify, never name-and-bypass.
- [ ] M1 cost: an independent adversarial pass per workstream is real effort — budget it; it is the gate that
      distinguishes "checklist done" from "adversarially true," which is the whole point of this follow-up.
- [ ] E2/M2 build-cost: registering sibling files in the transform (currently one-module `readFileSync`) has a
      perf implication — measure and bound.

## Latest verification

- Findings + first-hand evidence in `plans/claude-bugz-25.md` (B1/B6 self-verified) and
  `plans/claude-papercuts-23.md`. No code, `SPEC.md`, or other plans changed by this document.

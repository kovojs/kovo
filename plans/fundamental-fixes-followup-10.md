# Fundamental Fixes Followup 10 — the fox cannot guard the henhouse: authorization context must be unforgeable by the code it authorizes

Created 2026-07-04. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke line
(`fundamental-fixes-followup-{6,7,8,9}.md` + `postgres-v1-devex.md`). Responds to the Round-14 findings
(`plans/claude-bugz-35.md` B1–B3, `plans/claude-papercuts-33.md` P1). Line numbers cite `origin/main` (`a550fb9c9`).

## 1. The one foundational issue (round-14 restatement)

followup-9's C7 ("no security decision on a necessary-but-insufficient condition") was violated on followup-9's OWN
mechanisms. Two distinct roots, both instances of the same deeper error — **the framework's authorization inputs live
in the same mutable session namespace the (partially-trusted) app SQL runs in, and the audit models reachability by
direct privilege while code can also run as a side effect.**

| Round-14 finding | The mutable/insufficient thing                                                                                                              | The bypass                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1               | RLS trusts `current_setting('kovo.role'/'kovo.principal')` — USERSET GUCs the querying role can `SET`; identity is a `SET LOCAL ROLE` frame | `SET kovo.role='admin'` (no function EXECUTE needed) → escalate; `SET kovo.principal='x'` → impersonate; `RESET ROLE` → escape the frame back to the privileged login role |
| B2               | pooled connections assumed clean (framework uses `SET LOCAL`)                                                                               | a SESSION-level `SET` survives `client.release()` (no `DISCARD`) → bleeds to the next tenant                                                                               |
| B3               | routine audit gates on `has_function_privilege(EXECUTE)`                                                                                    | a SECURITY DEFINER function wired as a TRIGGER fires via DML, needs no EXECUTE → escapes; no `pg_trigger` scan                                                             |

**The unifying principle this plan enforces: the thing being authorized must not control its own authorization inputs,
and the audit must include code that runs as a side effect of a permitted operation, not only code the role can call
directly.** The `set_config` REVOKE (followup-9 C1) tried to lock the henhouse with one latch; the fox has three other
doors (the `SET` command, `RESET ROLE`, pool reuse), and the actual load-bearing latch (the managed-handle
single-statement confinement) is undocumented and unproven as the boundary.

## 2. The architectural moves

**Move 1 — carry PRIVILEGE in an unassumeable ROLE, not a settable value.** The crossOwnerRead/admin and system
elevations key on `current_setting('kovo.role')`, which the querying role sets. Move them to `SET LOCAL ROLE
kovo_admin`/`kovo_system` — roles the app connection provably CANNOT assume (followup-9 B2 already verified the runtime
cannot `SET ROLE kovo_admin`/`postgres`, and `RESET ROLE` returns to the least-priv login role, not admin). Then `SET
kovo.role='admin'` is a NO-OP because no policy reads it.

**Move 2 — confine the PRINCIPAL's carrier as an acknowledged sole door.** The per-request principal must stay a
GUC (a role-per-user is infeasible), but the security then rests entirely on "no app-reachable path can `SET`/`RESET
ROLE`/`SET ROLE`/run a multi-statement." Make that the DOCUMENTED, driver-level, uniformly-enforced boundary — a
statement guard that rejects those regardless of path — not an incidental property of one handle.

**Move 3 — scrub the connection at the request boundary.** `DISCARD ALL` (or `RESET ALL; RESET ROLE`) on pool release
so no session state (GUC or role) survives a handoff, re-establishing framework session setup per transaction.

**Move 4 — reachability includes side-effect-executed code.** A trigger fires on the role's permitted WRITE; a rule
rewrites its read; a default expression/generated column can call a function on write. The audit must enumerate these
side-effect execution mechanisms, not only `EXECUTE`-reachable routines, and fail closed on any it does not understand.

## 3. Meta-invariant (extends followup-9 C7)

- **C8 — The authorization context (principal AND privilege level) must be UNFORGEABLE by the code it authorizes and
  NON-PERSISTENT across request boundaries. Privilege is carried by an unassumeable role, never a value the authorized
  code can set; the per-request principal lives in state the authorized code's execution surface provably cannot
  mutate; and no session state survives a pooled-connection handoff. Corollary (extends C7 to the execution axis):
  "reachable" includes code that runs as a SIDE EFFECT of a permitted operation (DML triggers, rewrite rules, default/
  generated expressions), not only code the role can invoke directly.**

## 4. Decisions / work items

### DEC-A — Privilege elevation moves from settable GUCs to unassumeable roles (fixes B1's escalation half)

- [x] **A1 — Remove the `current_setting('kovo.role') = 'admin'` and `= 'system'` RLS policies (`postgres-runtime.ts:2410-2411,2431`). crossOwnerRead and system access are carried by `SET LOCAL ROLE kovo_admin`/`kovo_system` — roles the request runtime cannot assume (followup-9 B2). Per-table admin scope (resolves O2) is kept with ONE `kovo_admin` role + per-table opt-in policies: `CREATE POLICY … FOR SELECT TO kovo_admin USING (true)` ONLY on tables in `crossOwnerReadTables`; a table without the admin policy is RLS default-denied to `kovo_admin`. The scope lives in WHICH tables have the policy, not in the role.** After this, `SET kovo.role='admin'` reads nothing (no policy consults `kovo.role`). (Distinct admin PERSONAS — different table subsets per admin role — is post-v1 only if a concrete need appears; the app-level `role('admin')` endpoint guard + audit already scopes WHO invokes each crossOwnerRead.)
  - Acceptance: an app-SQL `SET kovo.role='admin'`/`'system'` does NOT widen the read/write set (no policy reads the GUC); a framework crossOwnerRead (via the `kovo_admin` role handle) reads across owners on opted-in tables ONLY and is logged; a non-opted-in table is default-denied to `kovo_admin`; `kovo_admin`/`kovo_system` remain app-unassumeable (B2 test still passes); the closure audit recognizes an admin-policy'd table as vetted. A paranoid test: `SET kovo.role='admin'` by app SQL is a no-op.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts` covers GUC forgery no-op, role policies, crossOwnerRead audit/default deny, unassumeable app roles, external privileged URLs, and closure-audited admin policy.

### DEC-B — The principal carrier has an acknowledged, uniform sole door (fixes B1's principal-forge + RESET-ROLE half)

- [x] **B1 — The app-SQL surface is confined by a SINGLE capability-gated chokepoint every path funnels through (query loader, mutation, durable task, webhook, `rawRead`, the `sql` escape, crossOwnerRead), enforcing THREE composed properties (resolves O1/O3): (i) SOLE DOOR — app code obtains a connection ONLY through the chokepoint, proven by a lint that no raw driver handle escapes it (reuse followup-7 A1/A2 no-raw-handle); (ii) EXTENDED-PROTOCOL ONLY — one statement per wire message, never the simple/multi-statement protocol (kills `RESET ROLE; set_config(...)`); (iii) a statement-shape ALLOWLIST, not a denylist — permit ONLY a single parameterized `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`WITH`; reject everything else (`SET`/`RESET`/`SET ROLE`/`DISCARD`/DDL/utility) by NOT being on the allowlist.** Builder SQL is shape-known from the Drizzle AST (no parse); the raw `sql`/`rawRead` string inputs parse-and-allowlist. The framework's own `SET LOCAL`/`set_config` run before app SQL, outside the chokepoint. Completeness reduces to two provable properties: sole door (i) + fail-closed allowlist (iii) — retain-and-prove on the statement axis.
  - Acceptance: an app-reachable `SET kovo.principal='victim'` / `SET kovo.role='admin'` / `RESET ROLE` / a node-pg simple multi-statement `RESET ROLE; SELECT set_config(...)` is REJECTED on EVERY path; the lint proves no raw connection escapes the chokepoint; a per-path test enumerates query/mutation/task/webhook/escape and asserts each routes through it. SPEC §10.3 documents the confined statement surface as the principal's enforcement boundary (the `set_config` REVOKE is defense-in-depth). (Spike first, ~30 min: test whether `REVOKE SET ON PARAMETER "kovo.principal" FROM PUBLIC` on a real PG15+ restricts a placeholder GUC — if it does, engine-level unsettability is a strictly stronger boundary that removes reliance on the confinement; expect it to fail because placeholder GUCs are `USERSET` and cannot be made privileged without a C extension, which is off the table for managed PG.)
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts packages/server/src/managed-db.test.ts packages/server/src/postgres-authz.test.ts --config ./vite.config.ts` covers the scoped-client allowlist, utility/multi-statement/set_config rejection, and nested transaction guard.

### DEC-C — Scrub the connection at the request boundary (fixes B2)

- [x] **C1 — On pool release, DEFAULT to `DISCARD ALL` (correctness-by-default; resolves O4); downgrade to the selective `RESET ALL; RESET ROLE; DISCARD TEMP; DISCARD PLANS` ONLY if `LISTEN` (Live/durable-tasks) or prepared-statement re-prep perf actually bites (`DISCARD ALL`'s implicit `UNLISTEN *` would drop listeners). Make framework per-connection setup idempotent and re-runnable so either path is safe.** This is defense-in-depth ON TOP of DEC-B — the pool must not assume DEC-B holds (managed PG behind PgBouncer transaction-pooling already scrubs, but Kovo cannot assume that).
  - Acceptance: a session-level GUC/role set on one borrow is ABSENT on the next borrow of the same pooled connection; framework session setup still works after the reset; a test sets `kovo.role` session-level on one connection and asserts it is cleared on reuse.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts` includes the node-postgres pooled-client `DISCARD ALL` reuse test.

### DEC-D — Reachability includes side-effect-executed code (fixes B3; extends the closure audit)

- [x] **D1 — NO-UNEXPECTED-ATTACHED-CODE (retain-and-prove on the execution axis; resolves O5/O6). An app-role-reachable table may carry ONLY framework-vetted attached code; ANY app-authored trigger, rewrite rule, `CHECK`/domain-constraint function, default/generated-column expression function, or index/predicate expression function on such a table is REFUSED unless explicitly vetted (proven `security_invoker`/non-definer + allowlisted). The audit does NOT trace per-function reachability edge-by-edge — it refuses UNRECOGNIZED attached code, so an unmodeled execution mechanism denies rather than passes.** The covered mechanism set is bounded and named in SPEC: {direct EXECUTE, DML trigger, rewrite rule, CHECK/domain constraint, default/generated expression, index/predicate expression}; event triggers (DDL) remain out of scope per followup-9 O3 (app roles do no DDL). This is the execution-axis parallel to followup-9's A5 no-unexpected-privilege (object axis).
  - Acceptance: a definer trigger / a `CHECK` constraint calling a definer function / an index expression calling a definer function on an owner-or-writable table each make `kovo db check` REFUSE; a framework-owned benign `updated_at` / FK trigger passes; a table with no attached code passes.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts` covers definer trigger/CHECK/default/index refusal and benign FK-trigger/no-attached-code pass.
- [x] **D2 — Add a REACHABILITY-MECHANISM axis to the DEC-F grant-shape fuzzer: {direct-grant, column-grant, DML-trigger, rewrite-rule, CHECK/constraint-function, default/generated-expression-function, index-expression-function} × the existing object/target/granularity/schema/RLS-state space.** The fuzzer asserts the audit refuses every side-effect path that reaches RLS-bypassing code — the empirical acceptance for O6.
  - Acceptance: re-introducing the B3 trigger gap (or a CHECK/index-expr variant) turns the fuzzer RED; the fuzzer covers each side-effect mechanism and over-blocks none.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts` covers direct/column grant shapes plus DML-trigger, rewrite-rule, CHECK, default, and index-expression attached-code mechanisms.

### DEC-E — SPEC + honesty: name the real boundary

- [x] **E1 — SPEC §10.3 states the authorization boundary precisely: privilege = unassumeable role (DEC-A); principal = a GUC enforced by the confined app-SQL statement surface (DEC-B) on a per-request scrubbed connection (DEC-C); the `set_config` REVOKE and the closure audit are defense-in-depth. Reclassify the role/principal codes in `security-markers.ts` accordingly (runtime-choke).**
  - Acceptance: SPEC names the sole door for each of privilege and principal; the registry has no authorization code resting on the `set_config` REVOKE alone.
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts packages/server/src/managed-db.test.ts packages/server/src/postgres-authz.test.ts --config ./vite.config.ts` verifies KV414 registry wording; `spec/10-data-plane.md` names the privilege/principal boundary and side-effect mechanisms.

## 5. Resolved design decisions (was "open issues"; decided 2026-07-04)

All six collapse to three real decisions — the principal boundary (O1=O3), the execution-axis boundary (O5=O6), and
two mechanical items (O2, O4). Each folds into a DEC above; recorded here with rationale.

- **O1 (statement-surface sole door) → RESOLVED into DEC-B1.** Not a per-handle denylist (enumerate-and-block, evadable) but a SINGLE capability-gated chokepoint enforcing three composed properties: sole door (lint, reuse followup-7 no-raw-handle) + extended-protocol-only + a statement-shape ALLOWLIST (permit only a single parameterized SELECT/DML/WITH; reject the rest by default). Completeness reduces to two provable properties (sole door + fail-closed allowlist) — retain-and-prove on the statement axis. This is the load-bearing item.
- **O2 (per-table admin scope with roles) → RESOLVED into DEC-A1: one `kovo_admin` role + per-table opt-in policies** (scope lives in which tables carry the admin policy, not in the role). Distinct admin personas deferred post-v1.
- **O3 (GUC-principal ceiling) → RESOLVED: accept GUC + DEC-B confinement + DEC-C scrub, with the confinement as the proven boundary; do a ~30-min `GRANT/REVOKE SET ON PARAMETER` spike first** (folded into DEC-B1). Expect the spike to fail (placeholder GUCs are `USERSET`; making them privileged needs a C extension, off the table for managed PG), so the confinement (O1) carries the weight. A non-GUC carrier (per-txn PID/txid-keyed table) is rejected — join cost + pooling footguns over a proven confinement.
- **O4 (`DISCARD ALL` vs session setup) → RESOLVED into DEC-C1: default `DISCARD ALL`, downgrade to selective reset only if `LISTEN`/prepared-statement perf bites; make framework per-connection setup idempotent.** Defense-in-depth on top of DEC-B, not a substitute.
- **O5 (bounded mechanism set) → RESOLVED into DEC-D1: audit "no-unexpected-attached-code" (refuse unrecognized attached code on app-reachable tables) rather than enumerate-and-allow mechanisms; the covered set {direct EXECUTE, DML trigger, rewrite rule, CHECK/domain constraint, default/generated expression, index/predicate expression} is named in SPEC and fails closed on anything unmodeled.** Extended DEC-D to include CHECK constraints + index expressions (were missing).
- **O6 (execution-axis completeness) → RESOLVED: the DEC-D1 structural rule makes completeness tractable (refuse unrecognized, don't trace every edge) + the DEC-F/D2 fuzzer mechanism axis is the empirical acceptance.** The execution-axis parallel to followup-9's A5 (object axis) and B2 (identity axis).

## 6. Probes before committing

- [x] **DEC-A:** app-SQL `SET kovo.role='admin'`/`'system'` reads nothing (no policy consults the GUC); framework crossOwnerRead via `kovo_admin` role still works + is audited.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts`.
- [x] **DEC-B:** app-reachable `SET kovo.principal='x'`, `RESET ROLE`, and node-pg simple `RESET ROLE; set_config(...)` are all rejected on query/mutation/task/webhook/escape paths.
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts packages/server/src/managed-db.test.ts packages/server/src/postgres-authz.test.ts --config ./vite.config.ts`.
- [x] **DEC-C:** a session GUC set on one pooled borrow is absent on the next.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts packages/server/src/postgres-authz.test.ts packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts`.
- [x] **DEC-D/F:** a definer trigger on an owner table makes `kovo db check` REFUSE; the fuzzer's mechanism axis turns RED on a re-introduced B3.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-grant-shape-fuzzer.test.ts --config ./vite.config.ts`.

## 7. Resolved design forks (recorded for provenance)

- **Privilege via GUC vs unassumeable role** — chose UNASSUMEABLE ROLE (DEC-A): a value the authorized code can set
  cannot gate that code; a role it cannot assume can.
- **`set_config` REVOKE vs statement-surface confinement as the principal boundary** — chose the CONFINEMENT as the
  acknowledged sole door (DEC-B); the REVOKE is necessary-but-insufficient (the `SET` command + `RESET ROLE` bypass it).
- **Pool: rely on `SET LOCAL` vs scrub on release** — chose SCRUB (`DISCARD ALL`, DEC-C); transaction-local state is
  only safe if nothing session-level is ever set, which DEC-B must guarantee but the pool should not assume.
- **Routine audit: EXECUTE-reachable vs side-effect-reachable** — chose SIDE-EFFECT-INCLUSIVE (DEC-D): a trigger fires
  via DML with no EXECUTE, so EXECUTE-reachability is a necessary-but-insufficient proxy (C7 on the execution axis).
- **Statement guard: denylist vs allowlist (O1)** — chose ALLOWLIST at a single capability-gated chokepoint (permit only
  a single parameterized SELECT/DML/WITH); a denylist of `{SET,RESET ROLE,…}` is enumerate-and-block and a novel utility
  statement evades it.
- **Admin scope: role-per-persona vs one role + per-table policies (O2)** — chose ONE `kovo_admin` role + per-table
  opt-in policies; personas deferred post-v1.
- **Principal carrier: engine-unsettable GUC vs confined GUC vs non-GUC table (O3)** — chose CONFINED GUC + scrub;
  engine-unsettable placeholder GUCs need a C extension (off the table), and a non-GUC table costs a per-policy join.
- **Execution-axis audit: trace-every-edge vs no-unexpected-attached-code (O5/O6)** — chose REFUSE-UNRECOGNIZED
  (structural, fail-closed) + fuzzer mechanism axis, mirroring the object-axis A5 that finally stabilized reachability.

# Round-16 Soundness Bugz 37

Created 2026-07-06. Source of truth remains `SPEC.md`. Security fail-opens found dogfooding AFTER
`plans/fundamental-fixes-followup-12.md` (C9: reconstruct-not-inspect at the wrapped DB client; enumerate every
writable relation + assumable role; trusted-plaintext auth zone; DEC-F sink inventory + hostile-value tests) landed on
`origin/main` (`767cd6a67`). Focus: security — Postgres, auth. DevEx/hygiene in `plans/claude-papercuts-35.md`.
Dogfooded in an isolated worktree at `origin/main`; `/Users/mini/kovo` untouched. Line numbers cite `origin/main`.

**Meta-theme — followup-12's MOVE 1 (value carriers) is COMPLETE; every remaining edge is on MOVE 2 (enumerate the
reachable set), and all four are the same shape: the enumeration covers DIRECT members and misses INDIRECT / propagated
ones.** This is the strongest acceptance result of the arc: the DEC-F sink inventory is COMPLETE (no missed sink; XSS,
open-redirect, SQL-identifier, headers, cookies, egress all reproduced SOUND) and the wrapped-client reconstruct
(DEC-A) survived 13 attack angles with ZERO findings — the "reconstruct/own the value that reaches a sink" axis holds.
The residual fail-opens are entirely on the enumeration axes:

| Axis (Move 2)                        | Enumerates                                           | Misses (→ fail-open)                                                                           |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| attached-code reachability (DEC-B/D) | DIRECTLY-writable relations (`has_table_privilege`)  | relations reached via WRITE PROPAGATION — FK `ON DELETE CASCADE`, partition tuple-routing (B1) |
| identity ATTRIBUTES (DEC-C)          | `SUPERUSER` + `BYPASSRLS`                            | `REPLICATION` — a login that streams the whole cluster (B2)                                    |
| audited IDENTITY set (routine audit) | the 4 framework roles `{reader,writer,admin,system}` | the runtime LOGIN role (B4)                                                                    |
| auth non-egress proof (DEC-D)        | `internal/trusted-plaintext.ts`                      | the request-reachable adapter surface that reads unboxed secrets (B3 + `papercuts-35` P1)      |

The round-16 lesson: "reachable" must be closed over PROPAGATION (cascades, routing); "dangerous authority" is the
COMPLETE attribute set, not the two you named; and the audited identity set is EVERY identity that touches the engine,
not just the app roles. Move 2's completeness is the last open axis.

Baseline: default Postgres/PGlite at `origin/main`. B1 (FK-cascade + partition-routing) and B2 (REPLICATION) roots
self-verified in source + reproduced at the engine layer; B3/B4 roots self-verified. **followup-12's round-15 fixes
HELD** (see Refuted — Submittable escape, view triggers, adopted BYPASSRLS all closed).

## Issues

- [ ] **B1 — A SECURITY DEFINER trigger on a relation the app role CANNOT directly write, but that its write PROPAGATES to — via an FK `ON DELETE CASCADE`/`SET NULL` action, or partition tuple-routing to a child — fires on a normal app-role write and runs definer code, while `checkPostgresAppDbPosture` stays GREEN.** (HIGH, framework/security, architectural; converged from `pg-attached-code-round3` pg-ac3-1 (FK cascade) + pg-ac3-2 (partition child); reproduced, engine-confirmed)
  - Observed: (a) FK cascade — an app-writable `orders` table has an FK `ON DELETE CASCADE` to a `line_items` table the app role has NO delete privilege on; `line_items` carries a `SECURITY DEFINER` trigger. Deleting an order (allowed) cascades a delete into `line_items`, firing the definer trigger (exfiltrating / cross-owner-writing). (b) Partition routing — an app-writable partitioned parent routes an INSERT to a child partition the app role cannot directly write; the child's definer trigger fires. Both: `checkPostgresAppDbPosture` returns ok=true.
  - Root cause (self-verified): the attached-code / reachability audit computes writability via `has_table_privilege(role, oid, 'INSERT'|'UPDATE'|'DELETE')` per relation (`postgres-runtime.ts:63-65`) — DIRECT write privilege only. It does not model write PROPAGATION: FK referential actions (`pg_constraint` `confdeltype`/`confupdtype` `c`/`n`/`d`) reach the referenced/referencing table, and partition tuple-routing (`pg_inherits`/`relispartition`) reaches the child — neither is "directly writable" so their triggers are never enumerated. followup-12 DEC-B closed view (INSTEAD OF) triggers, but the reachable-WRITE set is still the directly-privileged set, not its propagation closure.
  - Why it matters: FK cascades and declarative partitioning are ubiquitous, ordinary schema shapes; a definer trigger on a cascade target or partition child is exactly the round-15 B3/followup-12-DEC-B execution-axis edge, one propagation hop further. The write the app role legitimately performs REACHES definer code the audit never considered, on a green `kovo db check`.
  - Repro evidence: `/Users/mini/kovo-dogfood-round16/pg-attached-code-round3` — a definer trigger on an FK-cascade target and on a partition child both pass `checkPostgresAppDbPosture` and fire on an app-role write. Root: `postgres-runtime.ts:63-65` (direct-privilege reachability), no `pg_constraint` referential-action / `pg_inherits` partition closure.
  - Acceptance: the attached-code audit's reachable-WRITE set is the PROPAGATION CLOSURE of the directly-writable relations — include FK-referential-action targets (`pg_constraint` cascade/set-null/set-default) and partition children (`pg_inherits`/partition hierarchy) — and refuse a non-vetted definer trigger on any of them; add FK-cascade + partition-routing to the DEC-F fuzzer mechanism axis. A test: a definer trigger on a cascade target / partition child makes `kovo db check` REFUSE.

- [ ] **B2 — The identity least-privilege posture check tests `SUPERUSER` and `BYPASSRLS` but NOT `REPLICATION`: a runtime login (or assumable role) with the `REPLICATION` attribute passes provision/check/boot GREEN, yet can stream the entire cluster's data via the replication protocol — RLS-bypassed, cross-tenant, cross-database.** (HIGH, framework/security, architectural; `pg-identity-topology-round2` REPLICATION-login-rls-bypass; reproduced, engine-confirmed)
  - Observed: a login role with `REPLICATION` (a plausible DBA/managed-provider default, or a role reused from a replication setup) passes the DEC-C posture gate; it can then use `START_REPLICATION`/`pg_export_snapshot`/logical decoding to read every table in the cluster regardless of RLS, `FORCE ROW LEVEL SECURITY`, or column-REVOKE.
  - Root cause (self-verified): `runtimeConnectionLeastPrivilegeIssue` and the adopted/assumable-role checks test only `rolsuper || rolbypassrls` (`postgres-runtime.ts:2442`, `:2489-2490`, `:2522`, `:2560`); `rolreplication` is never queried. The check enumerates a SUBSET of the RLS-defeating authority attributes.
  - Why it matters: `REPLICATION` is a cluster-wide data-exfiltration authority equivalent in blast radius to `SUPERUSER`/`BYPASSRLS` for confidentiality; the whole engine-choke guarantee (RLS is the sole owner-scope door) is void for a `REPLICATION` identity, and the posture gate says green. Same class as round-15 B3 (adopted `BYPASSRLS`) — a dangerous attribute the check does not enumerate.
  - Repro evidence: `/Users/mini/kovo-dogfood-round16/pg-identity-topology-round2` — a `REPLICATION` runtime login passes `kovo db check`. Root: `postgres-runtime.ts:2442/2489-2490/2522/2560` (only `rolsuper`/`rolbypassrls`).
  - Acceptance: the identity check rejects any runtime login or assumable role with `rolsuper`, `rolbypassrls`, OR `rolreplication` (the complete RLS/confidentiality-defeating attribute set); document the audited attribute set in SPEC so future attributes are added deliberately. A test: a `REPLICATION` login/role fails provision/check/boot with the attribute named.

- [ ] **B3 — The Better Auth adapter's `systemRole` DB handle reads every user's `password` hash + live `session.token` UNBOXED and RLS-bypassed, and the handle is request-reachable — the DEC-D trusted-plaintext "prove-non-egress" guarantee does not actually cover the adapter surface.** (MED, framework/security; `pg-auth-trusted-zone` pgtz-1; reproduced, verifier-corrected HIGH→MED. Residual of `bugz-24` A1 / round-15 B4.)
  - Observed: the adapter's `systemRole`/`systemDb` handle (RLS-bypassing, `FORCE RLS`-exempt) reads all users' credential columns as plain strings on a request-reachable path; the boxing choke never sees these reads.
  - Root cause: followup-12 DEC-D made the adapter a "trusted-plaintext zone" but the non-egress PROOF (`papercuts-35` P1) statically scans only `internal/trusted-plaintext.ts` and does not model the actual request-reachable adapter/`systemDb` surface — so the systemRole read of unboxed cross-user secrets is neither boxed nor proven-confined. `systemDb` (`postgres-runtime.ts:433/572`) materializes secrets as plain values.
  - Why it matters: the auth-secret-leak finding (`bugz-24` A1, round-15 B4) recurs — the trusted zone's guarantee rests on a proof that checks the wrong surface, so a request-reachable handle reads every user's password hash/session token unboxed. Verifier corrected HIGH→MED (the read is the adapter's internal necessity, not a direct app read), but it is unboxed + RLS-bypassed + request-reachable, so not proven-confined.
  - Repro evidence: `/Users/mini/kovo-dogfood-round16/pg-auth-trusted-zone`; the systemRole handle returns unboxed cross-user credentials. Root: `postgres-runtime.ts:433/572` (`systemDb` plain read) + the P1 proof-scope gap.
  - Acceptance: the non-egress proof models the request-reachable adapter surface (not just the trusted file); the systemRole read is boxed for everything except the specific vetted compare/verify; a test asserts no request-reachable path yields an unboxed cross-user credential. Pairs with `papercuts-35` P1 (the proof-scope fix).

- [ ] **B4 — The SECURITY DEFINER routine audit enumerates only the four framework roles `{reader,writer,admin,system}`, not the runtime LOGIN role: a definer function EXECUTE-granted to the login role escapes the audit.** (MED, framework/security; `pg-identity-topology-round2` routine-audit-omits-login-identity; reproduced)
  - Observed: a `SECURITY DEFINER` function granted EXECUTE to the runtime login role (the identity the runtime connects as, before `SET ROLE`) is not enumerated by the routine audit, which binds only `[readerRole, writerRole, adminRole, systemRole]`.
  - Root cause (self-verified): the routine-audit query binds `config.readerRole/writerRole/adminRole/systemRole` and never the `runtimeLoginRole` (which the runtime resolves at `postgres-runtime.ts:624/662` but does not feed to the routine/attached-code audits). The audited identity set is the app roles, not every identity that touches the engine.
  - Why it matters: the login role runs the framework's own control statements and is the connection identity; a definer function it can execute is a reachable RLS-bypass surface the audit ignores. Reachability is narrower than the app-role case (app SQL runs as reader/writer, not the login), hence MED — but it is a completeness gap in the audited identity set, the identity-axis parallel to B1's write-propagation gap.
  - Acceptance: the routine + attached-code audits enumerate the runtime login role alongside the four framework roles; a definer function EXECUTE-reachable by the login role is refused unless vetted. A test covers a login-granted definer function.

## Refuted / Not Carried Forward (the strongest positive signal of the arc)

- **DEC-F sink inventory is COMPLETE** (9 refuted-sound in the sink track): no boundary-crossing sink found outside the ~22-sink registry; reproduced SOUND — HTML/render escape-by-default (script/img/svg payloads all contextually escaped), open-redirect normalization (`//evil.com`, `/\evil.com`, `https:evil.com` → `/`), `sql.identifier()` grammar+quoting, response headers/cookies via the typed channels, outbound egress via the allowlist. The one candidate (plain `{text,values}` carrier) was refuted — it IS the intended sole reconstruct door, not a second path.
- **DEC-A wrapped-client reconstruct is UNESCAPABLE** (13 refuted-sound, ZERO findings): a `Submittable`, a mutating/getter `.text`, a `Proxy`, a hostile `values` element, a thenable, and every Drizzle method (prepare/`$dynamic`/batch/transaction) route through the wrapped client's reconstruct; no raw connection reachable outside it. Round-15 B1 fully closed.
- **round-15 fixes HELD**: view (INSTEAD OF) triggers refuse; adopted `BYPASSRLS` reader/writer + login `ADMIN OPTION` refuse; the object-reachability + column/PUBLIC/cross-schema audits hold; auth CSRF/cookies/session-lifecycle sound (11 refuted in the auth track).

## Latest Verification

- B1 self-verified: `postgres-runtime.ts:63-65` reachability = direct `has_table_privilege`, no FK-referential-action / partition-inherit closure; reproduced (definer trigger on cascade target + partition child passes the gate). B2 self-verified: `:2442/2489-2490/2522/2560` test only `rolsuper`/`rolbypassrls`, never `rolreplication`. B4 self-verified: routine audit binds the 4 framework roles, not `runtimeLoginRole`. B3 reproduced (systemRole unboxed cross-user secret read) + root in the P1 proof-scope gap.
- Throwaway apps under `/Users/mini/kovo-dogfood-round16/` — safe to delete. No framework source or `SPEC.md` changed; `/Users/mini/kovo` untouched; no servers left running.

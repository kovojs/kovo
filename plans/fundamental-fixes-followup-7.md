# Fundamental Fixes Followup 7 — completeness is the enemy: audit the engine's actual reachable set, don't enumerate the shapes you know

Created 2026-07-03. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke line
(`fundamental-fixes-followup-6.md` + `postgres-v1-devex.md`). Responds to the Round-11 findings
(`plans/claude-bugz-32.md` B1–B4, `plans/claude-papercuts-30.md` PG-1/PG-2), all reproduced under `KOVO_PARANOID=1`
on `origin/main` (`c27edd34c`). Line numbers cite `origin/main`.

## 1. The one foundational issue (round-11 restatement)

followup-6 moved authorization to the storage engine — correct, and Round 11 confirmed it holds for 13 of 14 read
shapes + all writes. But it proved the engine is the sole door **only if the machinery that SETS UP the engine is
complete**, and that machinery is itself two static enumerations with the exact enumerate-and-allow blind spot the
whole arc is about:

| Enumeration | Enumerates | Missed (→ fail-open) |
| --- | --- | --- |
| RLS **provisioner** (`postgres-runtime.ts`) | `{owner, ownerVia-with-owner-parent}` base tables it GRANTs + policies | VIEWS run as definer (B1); ownerVia-of-non-owner-parent GRANTed but policy skipped (B2); functions, matviews, … |
| DEC-B1 **sole-door lint** (`static.ts`) | static `import` declarations from the runtime-db module specifier | aliased re-export through `./db` (B3); `dynamic import()` of the raw driver (B4) |

**The lesson is the arc's lesson one level up: you cannot make an incomplete enumerator complete by adding cases.**
A build-time lint over a Turing-complete language can never enumerate every handle-construction path (Rice). A
provisioner that lists "the object types I know about" can never enumerate every object type Postgres will let the app
create and grant. Both must be replaced by mechanisms that are complete **by construction**, not by coverage.

## 2. The two architectural moves

**Move 1 — the runtime holds no superuser authority (fixes B3, B4). Confine the capability, don't lint the syntax.**
The reason a raw reconnection or a re-exported provider leaks is that the RUNTIME process wields superuser. On managed
Postgres this is already solved — `postgres-v1-devex` DEC-I1 makes the runtime a least-privilege `NOBYPASSRLS` login
role, so `await import('pg'); new Client(process.env.KOVO_DATABASE_URL)` reconnects as that SAME least-priv role and RLS
still applies; the raw handle buys nothing. **B3/B4 are a PGlite-in-process parity gap**: PGlite runs in-process as
superuser and has no separate credential to be least-priv with. Fix: make the app-reachable PGlite connection least-priv
too, and gate the superuser handle behind an unforgeable capability — then no import shape matters.

**Move 2 — verify the engine's ACTUAL reachable closure, don't check a list of known objects (fixes B1, B2, + future
object types). Audit reachability, fail closed on the unproven.** Replace the boot posture *checklist* (which iterates
the tables the framework THINKS exist and misses views/ownerVia-gaps) with a *closure audit*: enumerate every object the
app roles can actually reach from the engine catalog, and refuse to serve unless each is provably safe. This is complete
by construction because it reads the engine's real grant graph, not the framework's model of it.

## 3. Meta-invariant (extends followup-6 C4)

- **C5 — Build-time enumeration of allowed shapes is defense-in-depth, NEVER the security boundary. Every value/effect
  security property must be enforced by either (a) an unforgeable runtime capability / least-privilege-by-construction
  identity, or (b) a closure audit that enumerates the ACTUAL reachable set from the engine and fails closed on anything
  not proven safe.** "Enumerate what I know and allow it" is replaced by "enumerate what is reachable and deny unless
  proven safe." A static lint may WARN early but may never be the thing a guarantee rests on.

## 4. Decisions / work items

### DEC-A — The runtime process wields no superuser/BYPASSRLS authority (fixes B3, B4; closes the dev/prod parity gap)

- [ ] **A1 — Make "runtime is non-superuser, `NOBYPASSRLS`, cannot `SET ROLE` to a privileged role" a HARD BOOT INVARIANT on every dialect, checked fail-closed.** At boot the runtime queries its own authority (`SELECT current_setting('is_superuser'), rolbypassrls, … ; SET ROLE <admin> → must error`) and REFUSES TO SERVE if it holds superuser/BYPASSRLS or can assume the admin/provision role. Managed PG already provisions this (DEC-I1) — this makes it *enforced*, not merely *documented*.
  - Acceptance: a runtime connection that is superuser or can `SET ROLE kovo_admin` fails boot with "runtime must be a least-privilege login role"; the managed-PG least-priv path passes. A paranoid test: `await import('pg'); new Client(KOVO_DATABASE_URL).query('SELECT * FROM orders')` returns 0/permission-denied (reconnect is same least-priv role) — B4 harmless on managed PG.
- [ ] **A2 — PGlite (in-process, unavoidably superuser) drops the APP-REACHABLE connection to a least-priv role at init, irreversibly for app handles; the superuser handle is gated behind a module-private `unique symbol` capability token held only by framework internals (DDL/seed/boot/provision).** `appRuntimeDbProvider()` — called with no args, via an aliased re-export (B3), or after a `dynamic import()` of `@electric-sql/pglite` (B4) — cannot present the token, so it yields a least-priv, RLS-subject handle, not the superuser client. `createInternalFrameworkDb` requires the token. (CLAUDE.md type-security: module-private `unique symbol` sentinel for a framework-owned capability; app code cannot forge it.)
  - Acceptance: with the DEC-B1 lint STUBBED, an endpoint that (i) calls a re-exported `appRuntimeDbProvider()`, or (ii) `new PGlite(process.env.KOVO_DATA_DIR)` via dynamic import, gets an RLS-scoped handle / cannot read another owner's rows on a green `KOVO_PARANOID=1` build. `grep` proves the superuser path is unreachable without the symbol.
- [ ] **A3 — Demote the DEC-B1 build lint (`static.ts:1288`, `1294`, `1464-1477`) from "the boundary" to "an early-warning diagnostic," and extend it opportunistically to re-exports (`export … from`) and `import()`/`require()` call expressions.** It stays useful (fast author feedback) but no invariant depends on its completeness — A1/A2 are the boundary.
  - Acceptance: the lint flags the B3/B4 shapes when statically visible; SPEC/registry state the lint is defense-in-depth and the runtime capability (A1/A2) is the enforcement. `security-markers.ts` classifies the superuser-door code `runtime-choke`/`by-construction`, not `build-only`.

### DEC-B — Grant implies policy, atomically; default-deny by construction (fixes B2; removes B1's app-grant surface)

- [ ] **B1 — One indivisible provisioning primitive per protected object: it (`ENABLE`+`FORCE ROW LEVEL SECURITY` + attach a live fail-closed `kovo` policy + `GRANT`) or it grants NOTHING. Never a GRANT without the matching policy.** Replace the separate unconditional grant loops (`postgres-runtime.ts:1323`/`1336` add every ownerVia child to readable/writable) and the policy loop that can `continue` past them (`:1380` `if (parentOwner === undefined) continue`) with a single per-table function whose only two outcomes are "protected+granted" or "untouched."
  - Acceptance: no code path GRANTs a table it did not also `FORCE RLS` + policy; a unit test over the provisioner asserts `granted_tables == force_rls_policied_tables` for every classification.
- [ ] **B2 — An `ownerVia` whose parent chain does not terminate in an `owner` (no principal predicate can be formed) is a BUILD ERROR (KV414), not a silent grant-without-policy.** The metadata that drives grants and the metadata that drives policies must be the SAME set — derive both from one "protectable with predicate P" resolution so they cannot diverge.
  - Acceptance: an ownerVia-of-non-owner-parent schema fails `build:prod` with KV414 naming the unresolvable parent; a well-formed ownerVia (owner parent) still provisions and scopes.
- [ ] **B3 — Reader/writer roles start from `REVOKE ALL ON ALL TABLES IN SCHEMA … FROM kovo_reader, kovo_writer` (default-deny), and ONLY the B1 primitive re-grants.** Any object the provisioner does not explicitly protect is unreachable by the app roles by construction — making DEC-C's audit the backstop for anything added out-of-band (a hand-written view/grant in a migration).
  - Acceptance: a table present in the DB but absent from the app schema is not readable by `kovo_reader` (permission denied); adding it to the schema + provisioning grants+policies it.

### DEC-C — Boot posture = capability-closure audit over the engine's real grant graph (fixes B1, B2, and future object types)

- [ ] **C1 — Replace the per-known-table posture CHECKLIST (`checkRuntimeDbPosture`, `postgres-runtime.ts:462-640`, which iterates framework-known tables and queries `pg_class`/`pg_policies`) with a CLOSURE AUDIT: enumerate EVERY object the app roles (`kovo_reader`/`kovo_writer`/`kovo_admin`) can actually access from the engine catalog (`information_schema.role_table_grants`, `pg_class`, `pg_proc`, `pg_views`/`reloptions` for `security_invoker`), and REFUSE TO SERVE unless each reachable object is one of: (i) a base table under `FORCE ROW LEVEL SECURITY` with a live `kovo` policy; (ii) a `security_invoker=true` view whose base relations are themselves in the safe set (resolve via `pg_depend`/`pg_rewrite`); (iii) an object on the explicit public/escape allowlist (`declarePublicRead`/a vetted `declarePublicView`).**
  - Acceptance: a definer view over an owner table granted to `kovo_reader` (B1) makes boot REFUSE with "reachable non-security_invoker view orders_v over owner table orders"; a granted table lacking FORCE RLS (B2) makes boot refuse; a fully-protected schema serves. A paranoid test reproduces `bugz-32` B1/B2 and asserts refuse-to-serve, not a served leak.
- [ ] **C2 — Provisioning forces `security_invoker=true` on every app-authored view over an owner/secret table (targeted default), with an explicit `declarePublicView`/vetted-definer escape (audited, allowlisted) for the rare curated-projection case.** The C1 audit is the backstop for anything the force step misses (e.g. a view created directly in a hand-written migration).
  - Acceptance: an app view over an owner table is `security_invoker` after provision and RLS-scopes; a deliberately-declared public/definer view passes the audit via the allowlist and is logged in `kovo explain --capabilities`.
- [ ] **C3 — `kovo db provision` and `kovo db check` run the SAME closure audit as boot; a fresh scaffold's `pnpm run check` runs it against the dev PGlite.** The audit is the single source of "is this DB safe to serve," used at provision, at check, and at boot.
  - Acceptance: `kovo db check` on a drifted DB (manually `DROP POLICY`/`ALTER … NO FORCE`/add a definer view) reports the exact unsafe object; on a clean DB it passes. (Subsumes `papercuts-30` PG-1's intent — the audit is a live reachability proof, not an order-sensitive fingerprint; see DEC-E.)

### DEC-D — SPEC + honesty: restate the guarantee

- [ ] **D1 — Rewrite SPEC §10.3 C4 to: "the engine is the sole authorization door only if EVERY object reachable by the app roles is a `FORCE`-RLS base table with a live policy or a proven-`security_invoker` view/function; the closure audit (DEC-C) is what makes this true, and the runtime holds no superuser authority (DEC-A). Build-time lints are defense-in-depth."** Enroll the closure audit + the PGlite capability token in `security/TCB.md`; reclassify the superuser-door and view-safety codes as `runtime-choke`.
  - Acceptance: SPEC states the completeness obligation and the layer that discharges it; the registry C5 test asserts no authorization/confidentiality code is `build-only`.

## 5. Related provisioning papercuts swept up here (not separate work)

- **`papercuts-30` PG-1 (order-sensitive boot fingerprint → spurious refuse)** — obviated by DEC-C: the closure audit is a live reachability proof, not a hashed fingerprint, so table order is irrelevant. If a fingerprint is still wanted as a fast-path, canonicalize (sort names before hashing) under DEC-C3.
- **`papercuts-30` PG-2 (provision omits runtime-login role membership + schema-state SELECT)** — fold into DEC-B: the provisioning primitive grants the runtime login role membership in the scoped roles and SELECT on the schema-state table as part of "make the DB usable," proven by A1's boot invariant (runtime CAN assume its scoped roles).

## 6. Probes to run before committing

1. **DEC-A2 capability token holds:** with the lint stubbed, prove a re-exported provider call and a dynamic-import PGlite reconnection both yield RLS-scoped handles (no superuser). (Raw-PGlite: confirm `SET ROLE` to a least-priv role + a gated reset cannot be undone by app SQL — reuse the round-6 single-statement-confinement result.)
2. **DEC-C closure audit catches the known holes:** on a DB with (i) a definer view over an owner table and (ii) an ownerVia-of-non-owner-parent granted table, the audit must flag BOTH. (Raw-PGlite: `scratchpad/definer-view-probe.mjs` already shows the definer-view leak; assert the audit query detects the view via `pg_views.reloptions`/`pg_class.reloptions` lacking `security_invoker=true`.)
3. **Managed-PG least-priv reconnect is harmless (B4):** against a real Postgres with a least-priv `KOVO_DATABASE_URL`, a raw `new Client(url)` reconnection reads 0 owner rows — confirming DEC-A1 already neutralizes B4 off-PGlite.

## 7. Resolved design forks (recorded for provenance)

- **Lint vs runtime capability for B3/B4** — chose the RUNTIME CAPABILITY (DEC-A2 token + A1 least-priv invariant); the lint is demoted to defense-in-depth (A3). Rationale: a build-time lint over a Turing-complete surface cannot be complete (the arc's core lesson); confine the capability instead of enumerating the syntax.
- **Checklist-plus-cases vs closure audit for B1/B2** — chose the CLOSURE AUDIT (DEC-C) over "add views + functions + matviews to the posture checklist." Rationale: enumerating object types is the same incompleteness; auditing the engine's actual grant graph is complete by construction and covers future object types for free.
- **Force security_invoker vs forbid app views** — chose FORCE + explicit escape (DEC-C2), consistent with the `declarePublicRead` escape-hatch-audit philosophy: safe by default, vetted opt-out, audited.

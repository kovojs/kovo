# Fundamental Fixes Followup 8 — ask the engine the actual question; make one posture module the single source of truth

Created 2026-07-03. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke line
(`fundamental-fixes-followup-{6,7}.md` + `postgres-v1-devex.md`). Responds to the Round-12 findings
(`plans/claude-bugz-33.md` B1–B3, `plans/claude-papercuts-31.md` P1–P10). Line numbers cite `origin/main` (`318810411`).

## 1. The one foundational issue (round-12 restatement)

followup-7 replaced the posture checklist with a "closure audit" meant to be complete by construction because it reads
the ENGINE catalog. The implementation regressed to `information_schema.role_table_grants` — the SQL-standard PORTABLE
view — which is lossy in exactly the two ways that matter:

| The audit queried                                                        | What it cannot see                                                                       | Fail-open                                                                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `information_schema.role_table_grants` (portable, standard-objects-only) | MATERIALIZED VIEWS (relkind `m`), FOREIGN TABLES (`f`) — not modeled by the SQL standard | B1: matview over an owner table granted to `kovo_reader` leaks cross-owner + secret on a green audit |
| `WHERE grantee IN (reader,writer,admin)` (direct named grants only)      | `GRANT … TO PUBLIC` (inherited by every role), role membership, column grants            | B2: any object granted `TO PUBLIC` over owner data leaks on a green audit                            |

**This is the arc's meta-bug reproduced on the mechanism designed to end it, for the third time in a new disguise:**
static-AST → result-name-match → builder-proxy → and now `information_schema`. Each modeled reachability with a proxy
for the truth (parse the code, match the names, read the grant rows) and each missed a case the proxy didn't cover. The
fail-closed backstop (`KV433_REACHABLE_OBJECT` catch-all, `postgres-runtime.ts:818`) is dead code, because objects the
enumeration never lists never reach it.

The DevEx findings share a sibling root: the CLI (`kovo db provision/migrate/check`) and the runtime boot are two
implementations of one contract that DISAGREE — `kovo db check` says OK while boot refuses (P1), provision succeeds but
leaves the runtime unable to connect (P2/P3), and the CLI ignores the app's runtime config entirely (P5).

## 2. The two architectural moves

**Move 1 — stop MODELING reachability; ASK THE ENGINE.** The maximally-ground-truth question is not "what grants
exist" but "can this role read/write this object?" — which Postgres answers directly with
`has_table_privilege(role, oid, 'SELECT'|'INSERT'|…)` for every relation in `pg_class`. That function IS the engine's
own access-decision procedure: it resolves `PUBLIC`, role membership, column grants, and default privileges by
construction, because it is the same code the engine uses to enforce access. Auditing with `has_table_privilege` over
`pg_class` (all relkinds) is complete in the strongest sense available — you are asking the enforcer, not a model of
it. This is the end of the line for "audit the reachable set": there is no more-ground-truth source than the engine's
own privilege oracle.

**Move 2 — one posture module, one config, shared by boot / `kovo db check` / `kovo db provision`.** The CLI and the
runtime cannot diverge if they are the SAME code deriving the SAME posture from the SAME app config. Load the app's
`createPostgresAppRuntime({...})` options in the CLI; make provision, check, and boot all call one
`assert/provision/checkPostgresPosture` against that config; delete the redundant order-sensitive fingerprint (the
closure audit is already a live, order-independent reachability proof).

## 3. Meta-invariant (extends followup-7 C5)

- **C6 — Reachability must be computed from the engine's GROUND-TRUTH access oracle (`pg_class` over every relkind +
  `has_table_privilege`/`aclexplode` effective privilege), never from a portable or lossy view (`information_schema`)
  or from direct-grant rows. And every reachable object must be classified by its CAPABILITY to enforce owner-scoping:
  an object that cannot carry RLS (materialized view, foreign table, definer view, `SECURITY DEFINER` function) is a
  leak-by-category and fails closed unless explicitly vetted onto a public allowlist.** "Enumerate what I can name and
  allow it" becomes "ask the engine what every role can reach, and deny anything that cannot prove it enforces scope."

## 4. Decisions / work items

### DEC-A — The closure audit asks the engine's privilege oracle (fixes B1, B2)

- [ ] **A1 — Replace the `information_schema.role_table_grants` enumeration (`postgres-runtime.ts:729-737`) with: enumerate EVERY relation from `pg_class` (join `pg_namespace`, exclude `pg_catalog`/`information_schema`) across ALL relkinds; for each, compute effective reachability with `has_table_privilege($role, c.oid, 'SELECT')` and `…'INSERT'|'UPDATE'|'DELETE'` for `kovo_reader`/`kovo_writer`/(admin if provisioned). Any relation an app role can effectively access enters the audit set.** This makes `PUBLIC` grants (B2), role-membership, and column grants visible by construction.
  - Acceptance: the raw-PGlite probe (`scratchpad/closure-audit-probe.mjs`) where the OLD audit returned `[]` now lists `user_mv` and `leak_tbl`; a matview and a `PUBLIC`-granted table over an owner table each make `kovo db check`/boot REFUSE. A test covers matview, foreign table, and `GRANT … TO PUBLIC`.
- [ ] **A2 — Delete the now-dead `information_schema` code path and prove the `KV433_REACHABLE_OBJECT` relkind catch-all (`:818`) is LIVE: any enumerated relation whose relkind cannot carry RLS refuses.** The catch-all stops being dead code once enumeration is `pg_class`-complete.
  - Acceptance: a `grep` shows no remaining `information_schema.role_table_grants` enumeration in the audit; a test asserts a reachable relkind `m`/`f` triggers `KV433_REACHABLE_OBJECT`, not a green pass.

### DEC-B — Fail-closed-by-category for objects that cannot enforce RLS (generalizes B1; hardens definer views/functions)

- [ ] **B1 — Classify each reachable object by RLS-capability and fail closed on the leak-by-category set unless vetted: base table (`r`)/partition (`p`) → require FORCE RLS + live kovo policy; view (`v`) → require `security_invoker` AND recursively-safe base relations (already present — keep); materialized view (`m`), foreign table (`f`), `SECURITY DEFINER` function reachable via a routine grant → REFUSE unless on the explicit public/vetted allowlist.** This subsumes B1, the round-11 definer-view class, and future object types (they refuse by category, not by being individually enumerated).
  - Acceptance: a reader-reachable matview/FDW/definer-function over owner data refuses with a message naming the object + why ("materialized views cannot enforce row-level security"); a `security_invoker` view over safe tables passes.
- [ ] **B2 — A single vetted-public escape (`declarePublicRelation`/extend `declarePublicRead`) is the ONLY way to admit a non-RLS-capable reachable object, audited + surfaced in `kovo explain --capabilities`.** No silent path; matches the escape-hatch-audit convention.
  - Acceptance: an app that deliberately exposes a public reporting matview declares it and the audit passes with an audit-log/`kovo explain` entry; without the declaration it refuses.

### DEC-C — One posture module + one config, shared by boot / check / provision / migrate (fixes P1, P2, P3, P4, P5)

- [ ] **C1 — `kovo db provision/migrate/check` load the app's `createPostgresAppRuntime({...})` config (the same options the server uses) so the CLI and runtime derive IDENTICAL roles/policies/grants/tables/`crossOwnerReadTables`/`adminRole`/`seedSql`.** Root fix for P5 (CLI ignores app config) and P3 (admin-role name mismatch → `role "kovo_admin" does not exist`).
  - Acceptance: a `crossOwnerReadTables`/custom `adminRole` set in app code is provisioned by `kovo db provision`; the default app (no `crossOwnerRead`) boots against external Postgres without referencing an uncreated admin role. A test asserts CLI-derived posture == runtime-derived posture.
- [ ] **C2 — Delete the order-sensitive schema fingerprint; the DEC-A closure audit IS the posture check, used identically by boot, `kovo db check`, and provision re-assert.** Fixes P1 (check says OK, boot refuses) by construction — one order-independent reachability proof, one implementation.
  - Acceptance: provision → `kovo db check` OK → boot serves, on the same DB; a round-trip test asserts check and boot return the identical verdict. `grep` shows no `KV433_SCHEMA_FINGERPRINT` divergence path.
- [ ] **C3 — Provision makes the DB USABLE, not just protected: grant the runtime login role membership in `kovo_reader`/`kovo_writer` + `SELECT` on `kovo_schema_state`; create (or tolerate the absence of) the admin role; run AFTER migrations (tables exist) and transactionally (no partial state on failure).** Fixes P2 (provisioned-but-unusable), P3, P4 (provision-before-migrate crash / dirty state).
  - Acceptance: post-`provision`, the runtime login role can `SET ROLE kovo_reader/kovo_writer` and read `kovo_schema_state`; provision on a fresh DB with no migrations fails EARLY with "run `kovo db generate`/`migrate` first" and rolls back; a scoped query as the login role succeeds after provision. (Absorbs `followup-7b` PG-2 scope.)

### DEC-D — Fix the reference/membership classification (fixes B3, P6)

- [ ] **D1 — Reference tables are IMMUTABLE global lookup data ONLY (reader grant, no writer grant, no tenant data). Tenant MEMBERSHIP (the documented team/org pattern) is NOT reference data — model it as an `authzPolicy`/`ownerVia` table that is tenant-scoped on READ and writable under a policy. Either retarget the docs/example to that shape, or add a first-class scoped-join classification.** Fixes B3 (membership globally readable → cross-tenant graph leak) AND P6 (membership unwritable at request time) — the reference model is miscalibrated for membership in both directions.
  - Acceptance: the documented team-membership table is tenant-scoped on read (a non-member cannot enumerate other tenants' memberships) AND writable at request time by an authorized user; `reference` remains for truly-global immutable data; SPEC/docs state which classification membership uses. Tests cover a scoped membership read and a request-time membership create/revoke.

### DEC-E — Finish the DevEx surface (fixes P7, P8, P9, P10)

- [ ] **E1 — Wire the DEC-F1 RLS empty-read diagnostic into the dev-mode scoped-read boundary (it is currently exported but never invoked — dead code); prod (least-priv, no privileged handle) does not run the re-count.** (P7)
  - Acceptance: a dev owner-read returns empty and emits the correct one of three signals (no-principal / RLS-filtered-N-rows / genuinely-empty); a test covers all three; prod does not run the privileged re-count.
- [ ] **E2 — Translate framework-provoked write denials (permission-denied on an ungranted table; RLS `WITH CHECK`/new-row-violates-policy) into actionable KV-coded diagnostics naming the table + likely cause, instead of raw Postgres text.** (P8)
- [ ] **E3 — The Postgres scaffold ships a `.env.example` documenting the full DB env surface and a README "Deploying to Postgres" section (generate → migrate → provision → check → serve; admin-vs-runtime URL split; least-priv role model); unify the config env namespacing (all DB config under one of `KOVO_*`/`KOVO_DB_*`, hard-break the outliers).** (P9, P10)
  - Acceptance: a developer can follow the scaffold from `create-kovo` to a serving external-Postgres app without reading framework source; `.env.example` lists every DB var under one convention.

### DEC-F — Acceptance discipline (process; the reason PG-1/PG-2 recurred)

- [ ] **F1 — followup-7 marked DEC-C3 (subsumes PG-1) and DEC-B §5 (grants login membership, fixes PG-2) `[x]`, but Round 12 found both still broken. followup-8 checkboxes may be marked done ONLY by the gate-16.9 paranoid harness proving the SHAPE is closed on a served/gated artifact, not by a unit test of adjacent behavior.** Add the matview / `PUBLIC` / reference-membership / check-vs-boot shapes to `test:authz-paranoid` (rules/v1-acceptance.md 16.9).
  - Acceptance: `test:authz-paranoid` includes a matview leak, a `PUBLIC`-grant leak, a reference-membership cross-tenant read, and a provision→check→boot round-trip; each `[x]` in this plan cites that harness.

## 5. Probes before committing

- [ ] **DEC-A engine oracle catches what information_schema missed:** raw-PGlite — `has_table_privilege(kovo_reader, oid, 'SELECT')` over `pg_class` returns `user_mv` + `leak_tbl` (the exact objects the old `role_table_grants` query returned `[]` for; see `scratchpad/closure-audit-probe.mjs`).
- [ ] **DEC-C check==boot round trip:** provision a DB, `kovo db check` OK, boot serves — identical verdict, no `KV433_SCHEMA_FINGERPRINT`.
- [ ] **DEC-C usable runtime role:** post-provision, the runtime login role can `SET ROLE kovo_reader` and read `kovo_schema_state`.

## 6. Resolved design forks (recorded for provenance)

- **Model reachability vs ask the engine** — chose ASK THE ENGINE (`has_table_privilege` over `pg_class`, DEC-A).
  Rationale: every prior "audit the reachable set" implementation modeled the truth with a proxy (AST, names, grant
  rows, `information_schema`) and missed a case; the engine's own privilege oracle is the only complete source.
- **Enumerate object types vs fail-closed-by-category** — chose FAIL-CLOSED-BY-CATEGORY (DEC-B): objects that cannot
  carry RLS (matview/FDW/definer) refuse by category unless vetted, so future object types are covered for free.
- **Fingerprint vs closure audit as the posture check** — chose the CLOSURE AUDIT alone (DEC-C2); the order-sensitive
  fingerprint is redundant and was the source of the check-vs-boot disagreement.
- **Reference table for membership vs scoped classification** — chose SCOPED (`authzPolicy`/`ownerVia`) for membership,
  `reference` reserved for immutable global data (DEC-D).

# Round-11 Papercuts 30

Created 2026-07-03. Source of truth remains `SPEC.md`. Over-block + dev-tooling + honesty-gap items from the Round-11
acceptance dogfood AFTER `plans/fundamental-fixes-followup-6.md` + `plans/postgres-v1-devex.md` landed on
`origin/main` (`c27edd34c`). Security fail-opens are in `plans/claude-bugz-32.md`. Dogfooded in an isolated
`origin/main` worktree; `/Users/mini/kovo` untouched. Line numbers cite `origin/main`.

**Meta-theme — the new Postgres operational surface (`kovo db provision/migrate`, boot posture, framework-owned
module) is where the papercuts cluster: two of them make a correctly-configured deploy FAIL to come up (fingerprint
drift, missing role membership), and the SQLite quarantine's "loud" disclaimer is computed but not actually surfaced.**
None are fail-opens, but PG-1/PG-2 block the happy-path deploy and the SQLite honesty gaps undercut DEC-A's whole
"loud not silent" premise.

## Issues

### A. Provision / migrate / boot (the new operational surface)

- [ ] **PG-1 — Boot posture fingerprint is table-order-sensitive: `kovo db provision` (CLI) and the built server compute DIFFERENT fingerprints for the same schema, so a correctly-provisioned DB is rejected at boot with "run kovo db provision" (spurious fail-closed).** (HIGH severity, over-block, dev-tooling/architectural; `pg-provision-migrate-bootposture`; reproduced, paranoid-confirmed)
  - Observed: provision a DB, then boot the built server → the server's posture check computes a schema/policy fingerprint that disagrees with the one provision wrote, because the two derive `SCHEMA_TABLES` in different orders; boot refuses to serve even though every policy/grant is present and correct.
  - Root cause: the fingerprint is order-dependent — the CLI provision path and the runtime boot path enumerate tables in different orders (one sorts by FK dependency, the other by schema-export order, or similar) and hash the concatenation without canonicalizing. (Root file: the framework-owned enforcement/posture module in `@kovojs/server` + the `kovo db` CLI; the fingerprint derivation must be order-independent.)
  - Why it matters: DEC-D's fail-closed boot posture is meant to refuse ONLY an un-provisioned/stale/drifted DB. An order-sensitive fingerprint makes it refuse a CORRECTLY provisioned DB — the deploy gate blocks the happy path. This is the fail-closed dual of a real posture check: it must not cry wolf, or teams will disable it.
  - Repro evidence: `/Users/mini/kovo-dogfood-round11/pg-provision-migrate-bootposture`; provision → boot → refuse-to-serve with fingerprint mismatch despite a correct DB.
  - Acceptance: the fingerprint is canonicalized (sort table/policy/column names before hashing) so provision and boot agree for the same schema regardless of enumeration order; a test provisions then boots and serves. Add a fingerprint round-trip test across both code paths.

- [ ] **PG-2 — `kovo db provision` never grants the least-privilege runtime login role membership in `kovo_reader`/`kovo_writer` nor `SELECT` on the schema-state table, so the provisioned app cannot actually assume its scoped roles at runtime (or read its own posture state).** (HIGH severity, over-block, dev-tooling; `pg-provision-migrate-bootposture`; reproduced)
  - Observed: after `kovo db provision`, the runtime login role cannot `SET LOCAL ROLE kovo_reader/kovo_writer` (no membership) and/or cannot `SELECT` from `kovo_schema_state`; the app fails to run scoped queries or its boot posture read.
  - Root cause: the provision command creates the roles + policies + grants on data tables but omits `GRANT kovo_reader, kovo_writer TO <runtime_login_role>` and `GRANT SELECT ON kovo_schema_state TO <runtime_login_role>`. In the default (framework-owned-roles) path the framework should do this; in the adopted-role path the DBA must, but the requirement is undocumented. (postgres-v1-devex DEC-B2 names the adopted-role path but the default path's membership grant is missing.)
  - Why it matters: a provisioned-but-unusable DB — the core `provision → run` handoff (DEC-B/E) does not connect the runtime login role to the scoped roles it must assume. On managed Postgres (where the login role ≠ superuser) this blocks every deploy.
  - Repro evidence: `/Users/mini/kovo-dogfood-round11/pg-provision-migrate-bootposture`; scoped query as the runtime login role → "permission denied to set role" / missing SELECT on schema-state.
  - Acceptance: default provision grants the runtime login role membership in both scoped roles + SELECT on the schema-state table; the adopted-role path documents the exact grants a DBA must run; a test runs a scoped query as the login role post-provision.

- [ ] **PG-3 — `kovo db generate --admin-database-url <external>` silently ignores the admin URL and introspects the embedded PGlite dev database instead of the target.** (MED, dev-tooling; `pg-provision-migrate-bootposture`; reproduced)
  - Observed: running `kovo db generate` with `--admin-database-url` pointing at an external Postgres produces a migration diffed against the local embedded PGlite, not the external target — wrong/empty diffs against production.
  - Root cause: the generate command does not thread `--admin-database-url` into the introspection connection; it defaults to the embedded PGlite data dir. (Root: the `kovo db generate` CLI path.)
  - Why it matters: the migration story (DEC-C) is a v1 headline; generating against the wrong database silently produces incorrect migrations. Silent is the problem — no error, just wrong output.
  - Acceptance: `generate` introspects the URL it is given (or errors if none resolves to the intended target); a test asserts the introspected DB matches `--admin-database-url`.

### B. Guards, audit, relational ergonomics

- [ ] **C3 — The DEC-B1 sole-door lint alone (at `build:prod`, the deploy gate) misses even a simple aliased re-export through a non-allowlisted helper module; only the app-copied source-scan catches some cases.** (MED, framework/security-adjacent, defense-in-depth; `pg-superuser-door-and-module`; reproduced)
  - Observed: an aliased re-export of the provider through a plain helper (not the blessed `db.ts`) is not flagged by the build-gate lint; the guard relies on a narrower scan that does not cover all re-export shapes.
  - Root cause: same enumeration blind spot as `bugz-32` B3 — `static.ts:1464-1477` resolves provider names only from imports whose specifier matches the runtime-db module. Recorded here as the defense-in-depth papercut variant; the served-leak version is `bugz-32` B3.
  - Why it matters: the lint gives partial coverage that reads as complete. Pairs with B3/B4 — the fix is re-export/`import()`-aware name resolution.
  - Acceptance: subsumed by `bugz-32` B3/B4 acceptance (re-export- and dynamic-import-aware lint).

- [ ] **endpoint-actas-write-audited-as-read — `ctx.actAs(id)` mints a single `operation:'read'` audit posture but returns BOTH a read and a write managed handle, so writes performed as the acted-as principal are audit-logged as reads.** (LOW, audit-integrity, framework; `pg-principal-seams-escapes`; reproduced)
  - Observed: `const s = ctx.actAs(id)` exposes `s.db.read` and a write handle; a write through it is recorded in the audit trail with `operation:'read'`.
  - Root cause: the actAs posture is stamped once as `read` (`endpoint.ts` actAs construction) and reused for the write handle; the write path does not re-stamp `operation:'write'`.
  - Why it matters: audit integrity — a cross-owner-capable acted-as WRITE is logged as a read, weakening the audit story the escapes (`crossOwnerRead`/`trustedAssign`) rely on. Not a fail-open (RLS still scopes), but the audit record is wrong.
  - Acceptance: the write handle under `actAs` stamps `operation:'write'`; a test asserts an acted-as write is audited as a write.

- [ ] **rqb-nested-with-ownervia-runtime-break — `db.query.<owner>.findMany({ with: { <ownerViaChild>: true } })` throws at runtime (`Cannot read properties of undefined (reading 'targetTable')`) on the auto-generated relation.** (LOW, over-block/bug, framework; `pg-cross-owner-allshapes`; reproduced)
  - Observed: a nested relational read across an ownerVia relation crashes rather than returning the scoped child rows.
  - Root cause: the RQBv2 relation config for the ownerVia child is incompletely generated (missing `targetTable`), so Drizzle throws when resolving the nested `with`. (Root: the generated relations wiring / `_kovo` adapter or the drizzle relation derivation.)
  - Why it matters: a legitimate relational read pattern is broken; pairs with the engine soundness work (the shape should return owner-scoped rows, not crash).
  - Acceptance: the nested `with` over an ownerVia relation returns the owner-scoped child rows; a test covers `findMany({ with: { child: true } })`.

### C. SQLite quarantine honesty (DEC-A "loud not silent")

- [ ] **SQLITE-KV447-INVISIBLE — the SQLite owner-scope build warning (KV447) is computed but never surfaced in `check`/`build`/`dev` (the data-plane gate hard-filters to error-only), so DEC-A2's promised per-`kovo({owner})`-table build warning does not actually reach the author.** (LOW→acceptance-gap, framework/honesty; `sqlite-quarantine-honesty`; reproduced)
  - Observed: an experimental SQLite app with a `kovo({owner})` table builds green with NO warning shown; the KV447 warning exists in the diagnostic set but is filtered out before display.
  - Root cause: the data-plane diagnostic gate filters to error-severity only, dropping the KV447 warning before it reaches `check`/`build`/`dev` output. (Root: the diagnostic surfacing path in `packages/drizzle`/`packages/cli`.)
  - Why it matters: **directly defeats followup-6 DEC-A2's acceptance** ("a per-`kovo({owner})`-table build warning disclaim it"). The quarantine's whole premise is "loud not silent"; the loudest per-table signal is silent. The banner still prints, but the build warning — the one an author sees when they add an owner table — does not.
  - Acceptance: KV447 is surfaced as a visible warning in `check`/`build`/`dev` for every `kovo({owner})` table on the SQLite dialect; a test asserts the warning appears in build output.

- [ ] **SQLITE-SCAFFOLD-SUCCESS-NO-DISCLAIMER — `create-kovo --sqlite` with the experimental flag scaffolds successfully but the SUCCESS output omits the experimental/no-authorization disclaimer; only the REFUSAL path prints it.** (LOW, dev-tooling/honesty; `sqlite-quarantine-honesty`; reproduced)
  - Observed: `KOVO_EXPERIMENTAL_SQLITE=1 create-kovo <app> --sqlite` prints the normal "Name/Dialect/Files/Next steps" summary with no reminder that SQLite provides no authorization/confidentiality guarantees.
  - Root cause: the disclaimer string is on the refusal branch only (`packages/create-kovo/src/index.ts`), not the successful-experimental-scaffold branch.
  - Why it matters: the author who opts in (the one who most needs the reminder) never sees it at scaffold time.
  - Acceptance: the successful experimental SQLite scaffold prints the single-principal/no-authorization disclaimer in its summary.

- [ ] **SQLITE-A1-REFUSAL-EXIT-0 — `create-kovo --sqlite` without the flag prints the refusal message but exits 0, not non-zero, so a scripted/CI scaffold cannot detect that no app was created.** (LOW, dev-tooling; found first-hand at baseline; reproduced)
  - Observed: `create-kovo <app> --sqlite` (no flag) prints "SQLite scaffold is experimental … Set KOVO_EXPERIMENTAL_SQLITE=1 …" and `echo $?` = 0; no app directory is created.
  - Root cause: the flag-gate refusal branch (`packages/create-kovo/src/index.ts`) prints and returns without a non-zero exit code.
  - Why it matters: followup-6 DEC-A1 acceptance says "exits non-zero naming the single-principal limitation." Exit 0 on a refusal makes CI/automation treat a no-op scaffold as success.
  - Acceptance: the refusal exits non-zero; a test asserts a non-zero exit and no created directory.

## Refuted / Not Carried Forward

- **OV-2 (authzPolicy string grants engine read+write with no RLS, no warning) — refuted as a fail-open**: this is the documented DEC-I honesty boundary (`authzPolicy` predicate correctness is the app's responsibility; FORCE-RLS + policy-present IS guaranteed). Not a security bug. (A "no loud warning like SQLite" note is minor and folded into the honesty theme; not tracked separately.)
- See `claude-bugz-32.md` "Refuted" for the 13/14 sound read shapes, sound cross-owner writes, secret-column REVOKE, and census default-deny — the encouraging acceptance evidence that the engine-choke thesis holds for base-table shapes.

## Latest Verification

- PG-1/PG-2/PG-3 reproduced in `/Users/mini/kovo-dogfood-round11/pg-provision-migrate-bootposture`. C3 shares `bugz-32` B3's root (`static.ts:1464-1477`). SQLITE-KV447-INVISIBLE + SUCCESS-NO-DISCLAIMER reproduced in the experimental SQLite scaffold; A1-exit-0 reproduced first-hand at baseline (`create-kovo --sqlite` → refusal message, `$?`=0).
- Throwaway apps under `/Users/mini/kovo-dogfood-round11/` — safe to delete. No framework source or `SPEC.md` changed; `/Users/mini/kovo` working tree untouched; no servers left running.

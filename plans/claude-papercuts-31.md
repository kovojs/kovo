# Round-12 Papercuts 31

Created 2026-07-03. Source of truth remains `SPEC.md`. DevEx + API-coherency items from the Round-12 Postgres
acceptance dogfood AFTER `plans/fundamental-fixes-followup-7.md` landed on `origin/main` (`318810411`). Security
fail-opens are in `plans/claude-bugz-33.md`. Dogfooded in an isolated `origin/main` worktree; `/Users/mini/kovo`
untouched. Line numbers cite `origin/main`. User focus: Security + DevEx + API coherency.

**Meta-theme — the Postgres CLI and the runtime are two implementations of the same contract that DO NOT AGREE, so the
happy-path deploy is broken in both directions: `kovo db check` says OK while the built server refuses to boot (P1),
and `kovo db provision` succeeds while leaving the runtime unable to connect (P2/P3).** Round-11's PG-1 and PG-2 are
still open and were marked resolved by followup-7 (DEC-C3 / DEC-B §5) without being fixed. On top of that, the whole
provision/migrate lifecycle is undiscoverable from the scaffold (P9) and its errors are raw Postgres text (P4/P8), and
the promised RLS empty-read diagnostic is dead code (P7). The security architecture is close; the operational surface
around it is not yet deployable by a normal developer.

## Issues

### A. The CLI and the runtime disagree (deploy-blocking)

- [ ] **P1 — Order-sensitive schema fingerprint: `kovo db check` reports OK while the built prod server REFUSES to boot with `KV433_SCHEMA_FINGERPRINT` against the same DB.** (HIGH severity, over-block, dev-tooling/architectural; `pg-provision-migrate-devex` PGDX-1; reproduced, paranoid-confirmed. RECURRENCE of still-open `claude-papercuts-30` PG-1 — followup-7 DEC-C3 marked its intent `[x]` done but the fingerprint was not made order-independent.)
  - Observed: provision a DB, `kovo db check` → OK, then boot the built server → refuses with `KV433_SCHEMA_FINGERPRINT` because the CLI and the runtime compute the fingerprint over a different table/column order.
  - Root cause: the schema/policy fingerprint is order-dependent and the CLI path and runtime boot path enumerate in different orders without canonicalizing (sort names before hashing). followup-7 DEC-C claimed the closure audit "obviates" the fingerprint, but a fingerprint check still exists AND still diverges between check and boot.
  - Why it matters: the two gates a developer trusts (`kovo db check` before deploy; boot at deploy) give OPPOSITE verdicts on the same DB — the deploy passes review and then fails to start. Worse than round 11 (there it was self-inconsistent; here check and boot actively disagree).
  - Repro evidence: `/Users/mini/kovo-dogfood-round12/pg-provision-migrate-devex` — `kovo db check` OK, prod boot `KV433_SCHEMA_FINGERPRINT`.
  - Acceptance: either drop the fingerprint entirely in favor of the DEC-C closure audit (its stated intent) OR canonicalize it (sort table/policy/column names before hashing) and share ONE implementation between `kovo db check` and boot; a test provisions, checks OK, and boots successfully.

- [ ] **P2 — `kovo db provision` leaves the least-privilege runtime login role UNUSABLE: no `kovo_reader`/`kovo_writer` membership and no `SELECT` on `kovo_schema_state`, so the app cannot assume its scoped roles or read its posture state.** (HIGH severity, over-block, dev-tooling; `pg-provision-migrate-devex` PGDX-2; reproduced. RECURRENCE of still-open `claude-papercuts-30` PG-2 — followup-7 DEC-B §5 line 96 claims provision grants login membership + schema-state SELECT, but it does not.)
  - Observed: after `kovo db provision` against an external Postgres, the runtime login role cannot `SET ROLE kovo_reader/kovo_writer` (no membership) and/or cannot `SELECT` from `kovo_schema_state`; the app fails to run scoped queries or its boot posture read.
  - Root cause: provision creates roles/policies/grants on data tables but omits `GRANT kovo_reader, kovo_writer TO <runtime_login_role>` and `GRANT SELECT ON kovo_schema_state TO <runtime_login_role>`. The plan's claim that DEC-B folds this in is not reflected in the provision path.
  - Why it matters: provisioned-but-unusable — the core `provision → run` handoff is broken on managed Postgres (where the login role ≠ superuser), blocking every real deploy.
  - Repro evidence: same track app; scoped query as the runtime login role → "permission denied to set role" / missing SELECT on `kovo_schema_state`.
  - Acceptance: default provision grants the runtime login role membership in both scoped roles + SELECT on the schema-state table; a test runs a scoped query as the login role post-provision. (Folded into `fundamental-fixes-followup-7b.md` scope if convenient.)

- [ ] **P3 — External-Postgres boot and `kovo db check` CRASH with a raw `role "kovo_admin" does not exist` whenever `crossOwnerRead` is unused — i.e. on the DEFAULT app.** (HIGH severity, dev-tooling; `pg-provision-migrate-devex` PGDX-3; reproduced)
  - Observed: on the default scaffold (no `crossOwnerRead` tables), boot/`kovo db check` against an external Postgres throws a raw `role "kovo_admin" does not exist`. The admin role is only created when `crossOwnerRead` is configured, but the boot/audit path references it unconditionally (the audit enumerates grants for `readerRole, writerRole, adminRole`).
  - Root cause: `checkPostgresAppDbPosture`/the grant enumeration passes `config.adminRole` (`postgres-runtime.ts:737`) as a query parameter and/or the posture references `kovo_admin` even when provision never created it (admin role creation is gated on `crossOwnerReadTables` being non-empty). CLI provision and runtime config also diverge (see P5).
  - Why it matters: the DEFAULT Postgres app does not boot against a real external Postgres — the most basic managed-PG deploy fails with an internal role error the developer cannot act on.
  - Repro evidence: same track; external PG boot → `role "kovo_admin" does not exist`.
  - Acceptance: the admin role is either always provisioned or the audit/boot tolerates its absence when no `crossOwnerRead` table exists; the default app boots against external Postgres. A test covers the no-crossOwnerRead external-PG boot.

- [ ] **P5 — `kovo db provision`/`migrate`/`check` IGNORE the app-runtime config (`crossOwnerReadTables`, `seedSql`, `adminRole`, `principalFromRequest`), so the CLI provisions a different posture than the runtime expects (e.g. `crossOwnerRead` policies silently not created; admin-role name mismatch → P3).** (MED, api-coherency/dev-tooling; `pg-realistic-multiowner-e2e` F3; reproduced)
  - Observed: the CLI `kovo db` commands read only their own flags/env, not the app's `createPostgresAppRuntime({...})` options, so a `crossOwnerReadTables`/`adminRole`/`seedSql` set in app code is not applied by `kovo db provision`; the runtime then expects policies/roles the CLI never created.
  - Root cause: `packages/cli/src/commands/db.ts` constructs its own config from flags/env and does not load the app's runtime config module; the two config sources diverge. Root of P3 (admin-role mismatch) and of silently-missing `crossOwnerRead` policies.
  - Why it matters: the CLI and runtime must agree on the posture or provision is meaningless; a silently-unprovisioned `crossOwnerRead` means the audited cross-owner escape does not work (fails closed) while the app believes it does.
  - Acceptance: `kovo db` commands load the app's runtime config (the same `createPostgresAppRuntime` options) so provision and runtime derive identical roles/policies/tables; a test asserts a `crossOwnerReadTables` set in app code is provisioned by the CLI.

### B. First-run + lifecycle DevEx

- [ ] **P4 — A fresh `kovo db provision` with no migrations dies with a raw `relation "user" does not exist` and leaves a partially-provisioned DB, with no hint that migrations must be generated/applied first.** (MED, dev-tooling; `pg-provision-migrate-devex` PGDX-4; reproduced)
  - Observed: on a brand-new external DB, `kovo db provision` (before any `kovo db generate`/`migrate`) attempts to apply policies/grants to tables that do not exist yet → raw `relation "user" does not exist`, DB left half-provisioned.
  - Root cause: provision assumes the schema tables exist (applies FORCE-RLS/policies/grants) but does not create them or order itself after migrations; the ordering/precondition is unstated.
  - Why it matters: the very first command a developer runs against a real DB fails cryptically and leaves a dirty state. First-run is the highest-leverage DevEx moment.
  - Acceptance: provision either runs migrations first (create tables) or fails EARLY with "no migrations found — run `kovo db generate` then `kovo db migrate`"; provision is transactional (no partial state on failure).

- [ ] **P9 — The default Postgres scaffold never surfaces the provision/migrate lifecycle or the admin-vs-runtime URL split: README, `.env`, `.env.example`, and generated comments are silent on `KOVO_ADMIN_DATABASE_URL` vs `KOVO_DATABASE_URL`, `kovo db provision/migrate/check`, or the least-priv role model.** (MED, docs/dev-tooling; `pg-provision-migrate-devex` PGDX-5; reproduced)
  - Observed: a developer scaffolding a Postgres app has no in-repo signal that deploying to real Postgres requires provisioning, migrations, and two different URLs (privileged admin for provision, least-priv for runtime).
  - Root cause: the scaffold templates were not updated for the postgres-v1-devex operational model; there is no `.env.example` documenting the DB env surface or a README "Deploying to Postgres" section.
  - Why it matters: the entire v1 Postgres deploy story is undiscoverable — a developer hits P1–P4 blind. This is the difference between "has a deploy story" and "has a deploy story someone can follow."
  - Acceptance: the scaffold ships a `.env.example` documenting `KOVO_DATABASE_URL`/`KOVO_ADMIN_DATABASE_URL`/role vars and a README section walking `generate → migrate → provision → check → serve`.

- [ ] **P10 — Database config env vars are namespaced inconsistently (`KOVO_DATABASE_URL`/`KOVO_ADMIN_DATABASE_URL`/`KOVO_DATA_DIR` vs `KOVO_DB_DRIVER`/`KOVO_DB_READER_ROLE`/`KOVO_DB_WRITER_ROLE`/`KOVO_DB_ADMIN_ROLE`) and the role/driver/admin-url vars are undocumented.** (LOW, api-coherency/docs; `pg-api-coherency` PGAC-4; reproduced)
  - Observed: two prefixes for the same domain — `KOVO_*` and `KOVO_DB_*` — with no rule for which a given DB var uses (`KOVO_DATABASE_URL` but `KOVO_DB_DRIVER`; `KOVO_DATA_DIR` but `KOVO_DB_READER_ROLE`).
  - Root cause: incremental addition of DB config across `postgres-v1-devex`/followup-7 without a namespacing convention.
  - Acceptance: pick one convention (e.g. all DB config under `KOVO_DB_*`, or all under `KOVO_*`) and document the full set in `.env.example`; alias or hard-break the outliers (preview bias permits a hard break).

### C. Diagnostics + error quality

- [ ] **P7 — The DEC-F1 RLS empty-read diagnostic is DEAD CODE: it is never wired into the app runtime, so a developer whose owner query returns 0 rows receives NONE of the three promised signals (no-principal / RLS-filtered-N-rows / genuinely-empty).** (MED, dev-tooling; `pg-rls-diagnostics-and-errors` F1-diag-never-wired; reproduced)
  - Observed: the `drainPostgresRlsSilentDenyDiagnostic` machinery + types are exported from `@kovojs/server`, but nothing in the generated app runtime invokes them and there is no documented way to enable them, so the "why did this return empty?" diagnostic postgres-v1-devex DEC-F1 promised does not fire in a real app.
  - Root cause: the diagnostic was implemented as a drain but never connected to the scoped-read boundary in the generated runtime; no wiring, no enablement API.
  - Why it matters: the empty-result ambiguity (unauthenticated vs RLS-filtered vs empty) is the #1 confusion of RLS-based apps, and the promised fix is inert. Developers will burn hours on "my query returns nothing."
  - Acceptance: the diagnostic is wired into the dev-mode scoped-read boundary and emits the three-way signal; prod (least-priv, no privileged handle) does not run the re-count; a test asserts each of the three cases produces its signal.

- [ ] **P8 — Data-plane write errors the framework itself provokes (permission-denied on an ungranted table; RLS `WITH CHECK`/new-row-violates-policy) surface as RAW Postgres errors, not actionable framework diagnostics.** (LOW, dev-tooling; `pg-rls-diagnostics-and-errors` raw-pg-write-errors-untranslated; reproduced)
  - Observed: a mutation writing an ungranted/out-of-scope table returns a raw `permission denied for table X` / `new row violates row-level security policy` to the handler, with no KV code or "this write is outside the declared scope / not owner-scoped" framing.
  - Root cause: the managed write path does not translate the Postgres error class into the framework's own diagnostic vocabulary the way reads/build gates do.
  - Acceptance: framework-provoked write denials are translated to an actionable KV-coded message naming the table + the likely cause (undeclared write / cross-owner / governed column); a test covers the permission-denied and WITH-CHECK cases.

### D. API-coherency

- [ ] **P6 — Reference join tables (the documented team-membership pattern) get NO writer grant, so memberships cannot be created or revoked at request time.** (MED, api-coherency/framework; `pg-realistic-multiowner-e2e` F4; reproduced)
  - Observed: expressing team membership as a reference/join table (per the postgres-v1-devex DEC-I team/org pattern) yields a table that is globally readable (see `bugz-33` B3) but has no writer grant, so a mutation cannot insert/delete a membership row — the documented pattern is read-only at runtime.
  - Root cause: reference tables are provisioned read-only (reader grant, no writer grant, no owner policy), which fits static lookup data but not membership tables that must be mutated by authorized users.
  - Why it matters: the framework's own recommended multi-tenant shape cannot perform its core operation (add/remove a member). Pairs with `bugz-33` B3 (same tables over-readable) — the reference-table model is miscalibrated for membership.
  - Acceptance: membership/join tables have a first-class, owner/authz-scoped write path (a classification that is both tenant-scoped on read AND writable under a policy), distinct from immutable reference data; a test creates and revokes a membership at request time.

## Refuted / Not Carried Forward (encouraging)

- **Escape-family naming incoherence (PGAC-2)** — refuted: the `trusted*`/`raw*`/`crossOwnerRead`/`declare*` scheme + read/write-twin convention is DELIBERATELY designed (postgres-v1-devex G1/G2), not accidental. (Confirms the design-review conclusion: keep principled per-danger-class prefixes; do NOT blanket-`unsafe`.) A read/write and `declareSystem`-vs-`asSystem` symmetry pass is still worth doing but is polish, not a defect.
- **Principal-elevation escapes not in the public prod API (PGAC-3)** — refuted: `actAs` is the production seam; `withPrincipal`/`asSystem`/`asAdmin` are intentionally test-subpath only.
- **rawRead emits no audit fact while crossOwnerRead/declarePublicRead do (PGAC-5)** — refuted as a defect: `rawRead` is a read-only capability, not an authorization-widening escape; the audit-fact asymmetry is defensible (but a `kovo explain` note for rawRead sites would be a nice-to-have).
- **DEC-F1 diagnostic public types unusable (diag-public-api-unusable)** — refuted as distinct: it is the surface symptom of P7 (dead-code wiring), folded there.

## Latest Verification

- P1/P2 confirmed as recurrences of still-open `claude-papercuts-30` PG-1/PG-2 (followup-7 marked their intent done; the code does not deliver). P3/P4/P5 reproduced in `/Users/mini/kovo-dogfood-round12/pg-provision-migrate-devex` + `pg-realistic-*` against the real CLI/boot gate. P7 confirmed by grep (drain exported, never invoked in generated runtime). Escape-naming (PGAC-2) refuted as intentional design.
- Throwaway apps under `/Users/mini/kovo-dogfood-round12/` — safe to delete. No framework source or `SPEC.md` changed; `/Users/mini/kovo` untouched; no servers left running.

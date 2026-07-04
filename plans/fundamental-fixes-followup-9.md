# Fundamental Fixes Followup 9 — fail the EXCLUSION, not the inclusion: retain-and-prove over the engine's finest granularity

Created 2026-07-03. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke line
(`fundamental-fixes-followup-{6,7,8}.md` + `postgres-v1-devex.md`). Responds to the Round-13 findings
(`plans/claude-bugz-34.md` B1–B5, `plans/claude-papercuts-32.md` P1–P6). Line numbers cite `origin/main` (`5b8d3c1b1`).

## 1. The one foundational issue (round-13 restatement)

followup-8 was right to "ask the engine" — but it asked at the wrong GRANULARITY, with a LITERAL predicate, in a
RESTRICTED scope, and — the root of all of them — it EXCLUDED objects from scrutiny on a NECESSARY-BUT-INSUFFICIENT
test. The audit enumerates every relation in `pg_class`, then drops any relation with `privileges.length === 0`
(`postgres-runtime.ts:925`), where `privileges` comes from `has_table_privilege` (`:793`). `has_table_privilege` is
TABLE-level, so a column-only grant returns `false` → the object is dropped BEFORE the fail-closed backstop
(`KV433_REACHABLE_TABLE`, `:835`) can fire → green audit, cross-owner column read (B1). The same shape recurs:

| Finding | The insufficient exclusion test               | What was let through                                         |
| ------- | --------------------------------------------- | ------------------------------------------------------------ |
| B1      | "no `has_table_privilege`" ⇒ drop             | column-only grant (readable via `has_column_privilege`)      |
| B2      | "grantee ≠ `kovo_reader`" ⇒ safe              | `GRANT … TO PUBLIC`/writer/membership (reader inherits)      |
| B3      | "not in an app schema" ⇒ skip                 | cross-schema `SECURITY DEFINER` function                     |
| B4      | "not a `has_table_privilege` relation" ⇒ skip | sequence (`has_sequence_privilege`)                          |
| B5      | "shaped like an act-as posture" ⇒ honor       | an UNBRANDED posture (no `assertNonRequestPrincipalPosture`) |

**The unifying lesson, and the point of this plan: incompleteness is survivable ONLY if it fails CLOSED. Every round's
bug is a security-relevant SKIP/ALLOW decision made on a necessary-but-insufficient condition — an object excluded from
scrutiny, or a value admitted, on a proxy for safety rather than a PROOF of safety.** "Ask the engine" (followup-8) and
"audit the closure" (followup-7) were correct directions; the defect is the exclusion test, not the inclusion test.

## 2. The architectural move

**Retain-and-prove.** An object/value leaves the checked set ONLY by a SUFFICIENT proof of safety — never by a proxy.
For the closure audit that means: retain every catalog object unless the app roles PROVABLY have zero effective access
to it or any of its parts (table, column, routine, sequence — resolving `PUBLIC` + role membership); everything
retained must prove FORCE-RLS/`security_invoker`/vetted-allowlist, and an unknown relkind fails closed. Concretely,
replace necessary-condition proxies with the engine's FINEST-granularity effective-privilege answer:

- table-level `has_table_privilege` → per-column `has_column_privilege` / `aclexplode` over `pg_attribute` (B1, B2),
- literal `grantee = readerRole` → effective privilege that resolves `PUBLIC` + membership (B2),
- app-schema-only routine scan → all-non-system-schema (match the relation scan) (B3),
- relation-only → include sequences via `has_sequence_privilege` (B4),
- structural posture shape → the `unique symbol`/WeakSet brand as the SOLE door to principal elevation (B5).

## 3. Meta-invariant (extends followup-8 C6)

- **C7 — No security-relevant SKIP or ALLOW decision may rest on a necessary-but-insufficient condition. An object,
  column, routine, shape, or value leaves the enforced set only by a SUFFICIENT PROOF of safety; absent that proof it
  is RETAINED and enforced (fail closed).** Corollary: audits must compute effective privilege at the engine's finest
  granularity (column, routine, sequence; resolving `PUBLIC` + membership), and every framework-owned capability
  (principal elevation, trusted value) must be reachable only through its unforgeable brand — the brand check is the
  sole door, not one of several paths.

## 4. Decisions / work items

### DEC-A — Effective-privilege closure audit at the engine's finest granularity (fixes B1, B2, B3, B4)

- [x] **A1 — Retain-and-prove over relations INCLUDING columns. Stop dropping relations with no table-level privilege (`postgres-runtime.ts:925`); a relation is retained if an app role has effective SELECT/INSERT/UPDATE/DELETE on the table OR on ANY column (`has_column_privilege` per `pg_attribute`, or `aclexplode` of `relacl`+`attacl`, resolving `PUBLIC` + membership). Every retained relation must prove FORCE-RLS + policy (`r`/`p`), `security_invoker` + safe bases (`v`), or vetted-allowlist; `m`/`f`/unknown relkind fail closed.**
  - Acceptance: a column-only `GRANT SELECT (secret) ON t TO kovo_reader`/`TO PUBLIC` over a non-RLS/owner table makes `kovo db check`/boot REFUSE; the framework's own column-granted owner tables still pass (they are FORCE-RLS + policied). Probe `scratchpad/col-priv-probe.mjs` shape must refuse.
  - Evidence: `pnpm exec vitest --run packages/server/src/auth-principal.test.ts packages/server/src/postgres-runtime.test.ts packages/server/src/egress.test.ts packages/server/src/egress-bootstrap.test.ts --config ./vite.config.ts` passed; `postgres-runtime.test.ts` covers column-only grants to app roles/PUBLIC and protected owner-table pass cases.
- [x] **A2 — KV435 secret-column check uses EFFECTIVE privilege: `has_column_privilege($readerRole, table, column, 'SELECT')` (resolves `PUBLIC` + membership), not a literal `grantee = readerRole` match (`postgres-runtime.ts:735-737`).**
  - Acceptance: `GRANT SELECT (secret) … TO PUBLIC` (or to `kovo_writer`, or a role the reader is a member of) makes the audit REFUSE.
  - Evidence: same focused vitest command passed; `postgres-runtime.test.ts` covers `GRANT SELECT ("secretNote") ... TO PUBLIC` refusing with KV435.
- [x] **A3 — Routine audit spans ALL non-system schemas. Change the `pg_proc prosecdef` scan from `WHERE nspname IN (app schemas)` (`postgres-runtime.ts:989`) to `WHERE nspname NOT IN ('pg_catalog','information_schema')` (match the relation scan `:799`); refuse any reader/writer-EXECUTE-reachable `SECURITY DEFINER` routine not vetted.**
  - Acceptance: a cross-schema definer function reachable by `kovo_reader` makes `kovo db check` REFUSE.
  - Evidence: same focused vitest command passed; `postgres-runtime.test.ts` covers cross-schema `SECURITY DEFINER` routines executable by app roles.
- [x] **A4 — Sequences are audited AND framework-owned serial sequences are allowlisted (resolves B4 under-audit AND `papercuts-32` P2 over-block coherently). A sequence (relkind `S`) reachable by an app role via `has_sequence_privilege` is retained; a sequence that backs a serial/identity column of a protected table (the writer needs `USAGE`) is allowlisted; any other reader/writer-reachable sequence is refused.**
  - Acceptance: a serial-PK owner table passes `kovo db check` and INSERTs; a hand-granted `USAGE` on an unrelated sensitive sequence refuses.
  - Evidence: same focused vitest command passed; `postgres-runtime.test.ts` covers protected-table serial INSERT/pass and unrelated sequence grant refusal.
- [x] **A5 — No-unexpected-privilege assertion (closes O1 by construction). Beyond the audited data channels (relations+columns, routines, sequences), assert the app roles hold ZERO privilege on every OTHER ACL-bearing catalog object — foreign-data-wrapper/server (`USAGE`), `pg_language`, `pg_largeobject_metadata`, and any `pg_default_acl` entry that would grant them future objects. Any such grant REFUSES.** This flips the guarantee from "enumerate what leaks" (incomplete) to "the app roles hold ONLY framework-issued privileges, on proven-safe relations/routines"; a reachable object CLASS the audit does not understand fails closed rather than passing.
  - Acceptance: a `GRANT USAGE ON FOREIGN SERVER … TO kovo_reader`, a `pg_default_acl` entry granting the reader future tables, or a large-object grant each REFUSE; SPEC §10.3 states the audited catalog set + data-plane threat boundary.
  - Evidence: focused Postgres runtime suite passed with default-ACL refusal coverage; focused external Postgres probe passed with foreign-data-wrapper, foreign-server, `pg_language`, and large-object grants refusing as `KV433_UNEXPECTED_PRIVILEGE`; `spec/10-data-plane.md` §10.3 names the unexpected ACL/default-privilege boundary.
- Implementation note (O6): compute effective privilege via `aclexplode(relacl)`/`aclexplode(attacl)`/`aclexplode(proacl)` joined to `pg_has_role` (membership) + `PUBLIC` (grantee oid 0) expansion — one set-returning query per catalog, O(grants), NOT a per-column/per-role `has_*_privilege` loop. The RETAIN decision only needs "any access to the relation" (FORCE-RLS protects all columns); only the KV435 secret-column check (A2) is genuinely per-column. Keep boot audit latency negligible on wide schemas.

### DEC-B — Principal elevation has a SOLE door: the posture brand (fixes B5)

- [x] **B1 — Make `assertNonRequestPrincipalPosture` (`auth-principal.ts:148`) the ONLY path from a request/non-request posture to a DB principal. Every consumer that derives `kovo.principal` from a posture must call it first; better, the derivation function accepts ONLY the branded `NonRequestPrincipalPosture` type whose sole constructor is the brand-minting one, so an unbranded object cannot type-check into the principal path.** (Defense-in-depth: B5 is app-code-reachable, not remote — the brand also prevents an author's ACCIDENTAL look-alike posture, not just malice.)
  - Acceptance: a hand-constructed `{kind:'act-as', principal:'victim', …}` attached to a DB request is REJECTED (throws the DEC-G brand error), not honored; `ctx.actAs(id)`/`declareSystem*` still work. A test asserts an unbranded posture cannot set `kovo.principal`.
  - Evidence: focused vitest command passed after `postgres-runtime.test.ts` switched valid non-request DB tests to `actAsNonRequestPrincipal(...)` and added unbranded act-as rejection; `pnpm run check:security-brands` passed.
- [x] **B2 — Identity-axis completeness (closes O5b). Add a named invariant + test: the runtime login is non-superuser/non-`BYPASSRLS`, app code can assume exactly the request app roles `{kovo_reader, kovo_writer}`, and cannot assume `kovo_admin`, `postgres`, or any other privileged connection identity.** `kovo_admin` remains a closure-audited role name and a fail-closed least-privilege sentinel; cross-owner admin reads use the audited `kovo.role = 'admin'` posture under the reader role, because SPEC §10.3/followup-7 forbid the request runtime from assuming the privileged admin role. This is the identity-axis parallel to A5's object-axis completeness.
  - Acceptance: a test enumerates the app-reachable connection identities and asserts the set equals the request app roles; admin/superuser reachability fails the test.
  - Evidence: focused external Postgres probe passed after `expectRuntimeIdentityClosure(...)` asserted the runtime login is non-superuser/non-`BYPASSRLS`, can `SET ROLE` only to `kovo_reader`/`kovo_writer`, and gets permission denied for `kovo_admin`/`postgres`; the same probe still fails runtime boot/posture when a runtime can assume `kovo_admin`.

### DEC-C — The least-privilege runtime is turn-key (fixes P1, P2, P3, P5)

- [x] **C1 — Provision grants `EXECUTE ON FUNCTION pg_catalog.set_config(text,text,boolean)` to the runtime login role (only) after the followup-6 `REVOKE … FROM PUBLIC` (`postgres-runtime.ts:582`), so a least-priv managed Postgres runtime can set `kovo.principal`. App SQL (a different path) still cannot.** (P1 — currently the supported production config cannot run.)
  - Acceptance: a least-priv external runtime role sets `kovo.principal` and serves owner data; `has_function_privilege(app_sql_role, 'set_config', 'EXECUTE')` remains false.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-external-probe.test.ts --config ./vite.config.ts -t "proves split provisioning"` passed against a local least-priv external runtime; `postgres-runtime.test.ts` verifies `set_config` EXECUTE belongs to the runtime login role, not `PUBLIC` or `kovo_reader`.
- [x] **C2 — Provision ordering + atomicity: ensure roles BEFORE applying migrations that may reference them, and wrap role/policy/grant + migration application in one transaction (no partial-provision state on failure).** (P3)
  - Acceptance: a migration referencing `kovo_reader` applies cleanly; a mid-provision failure rolls back.
  - Evidence: `pnpm exec vitest --run packages/server/src/postgres-runtime.test.ts --config ./vite.config.ts` passed; it covers migration SQL referencing `kovo_reader` and rollback of migration-created tables plus `kovo_migrations` when a later schema assertion fails.
- [x] **C3 — Exempt the app's own configured DB host from the egress floor UNIFORMLY (boot pool and per-request), so a loopback/managed Postgres works under `KOVO_PARANOID=1`.** (P5)
  - Acceptance: an app against `postgres://…@127.0.0.1` serves under `KOVO_PARANOID=1`; cloud-metadata/internal egress stays blocked.
  - Evidence: `packages/server/src/egress-bootstrap.test.ts` covers DB URL registration before and after floor install; focused vitest command passed. `KOVO_PARANOID=1 pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts --config ./vite.config.ts -t "runs provision -> check -> boot for the paranoid served artifact without manual runtime grants"` passed.
- [x] **C4 — Shrink the accidental-`PUBLIC` surface (O2 defense-in-depth; detection remains the guarantee). At provision, `ALTER DEFAULT PRIVILEGES IN SCHEMA <app> REVOKE ALL ON TABLES, SEQUENCES, FUNCTIONS FROM PUBLIC`, so future objects do not silently auto-grant to `PUBLIC`; run migrations as a non-superuser role.** Full prevention is impossible (any object owner can `GRANT … TO PUBLIC`; `PUBLIC` cannot be removed from a role), so DEC-A's retain-and-prove DETECTION is the boundary — this only removes the default/accidental path.
  - Acceptance: a newly created table in the app schema is not auto-readable by `PUBLIC`/app roles without an explicit grant; an explicit `GRANT … TO PUBLIC` is still caught by DEC-A.
  - Evidence: `postgres-runtime.test.ts` verifies provision removes app-schema table/sequence default grants before future objects are created; `postgres-runtime.ts` emits table, sequence, and function default-privilege revokes; the external probe runs migrations through non-superuser admin roles.

### DEC-D — Security opt-outs carry justification, never bare booleans (fixes P4)

- [ ] **D1 — Replace `postureCheckOnBoot: false` (a bare boolean disabling the sole runtime authorization backstop) with a justification-carrying discriminated shape (`postureCheck: { onBoot: false, justification: '…' }`), surfaced in `kovo explain`.** Matches the CLAUDE.md type-security convention (`csrf: false` + justification).
  - Acceptance: disabling the boot audit requires a written justification; `kovo explain --capabilities` lists it; a bare boolean no longer type-checks.

### DEC-E — Secret box channel consistency (fixes P6)

- [x] **E1 — `structuredClone` of a value containing a `Secret` box throws `KV435` (make the box non-structured-cloneable or add a clone trap), for parity with `JSON.stringify`/template-literal/`Response`/header coercion.** (Not a leak today — it strips to `{}` — but an inconsistent channel.)
  - Acceptance: a test cloning a boxed secret throws `KV435` alongside the other coercion-channel tests.
  - Evidence: `pnpm exec vitest --run packages/core/src/secret.test.ts packages/server/src/secret-read-boundary.test.ts packages/server/src/response-posture.test.ts --config ./vite.config.ts` passed after `packages/core/src/secret.test.ts` asserted direct, nested object, array, `Map`, and `Set` `structuredClone(...)` failures contain `KV435`.

### DEC-F — Prove the audit by fuzzing the grant-shape space (closes O4; HIGHEST priority)

- [ ] **F1 — Build a generative grant-shape FUZZER that materializes the cross-product of leak shapes and asserts the closure audit's verdict matches the actual engine leak on each point.** Space: object-class {table, view, matview, foreign-table, sequence, definer-function} × grant-target {reader, writer, admin, PUBLIC, a role the reader is a member of} × granularity {table, column} × schema {app, non-app} × RLS-state {force-rls+policy, no-rls, rls-no-force}. For each point: create the object + grant on raw PGlite, run the REAL `checkPostgresAppDbPosture`, and `SET ROLE` to read/write — assert (audit refuses) ⟺ (a leak is actually possible). Wire into `test:authz-paranoid` (gate 16.9).
  - Rationale: retain-and-prove (C7) REDUCES the completeness question to "is the reachability computation sound?" (A5's bounded catalogs); the fuzzer TESTS that reduction across the space. It is not a formal proof, but combined with fail-closed-on-unknown it gives "known space TESTED + unknown space fails closed" — the practical ceiling, and the mechanism that makes round-14's next-proxy a caught test rather than a served leak. This is the acceptance-level answer to the 13-round pattern and should GATE v1.
  - Acceptance: the fuzzer enumerates the space, every leaking point is refused by the audit, every safe point passes (no over-block); it runs in CI under `test:authz-paranoid`; a deliberately re-introduced round-13 bug (e.g. column-grant blindness) makes the fuzzer RED.

## 5. Resolved design decisions (was "open issues"; decided 2026-07-04)

All six flagged issues are now decided; each folds into a DEC above. Recorded here with the rationale.

- **O1 (complete catalog set) → RESOLVED into DEC-A5 (no-unexpected-privilege assertion).** The data-plane-relevant channels are a bounded set (relations+columns, routines, sequences); everything else either isn't a row/column-data channel or materializes through one of these (foreign tables → `pg_class`; definer functions → `pg_proc`). Rather than chase catalogs, assert the app roles hold ZERO privilege on any other ACL-bearing catalog object, and fail closed on any object class the audit does not understand. Bounded + closed-by-construction, not an open-ended chase.
- **O2 (`PUBLIC` prevention vs detection) → RESOLVED: DETECTION is the guarantee (DEC-A retain-and-prove) + DEC-C4 default-privilege revocation as defense-in-depth.** Full prevention is impossible in Postgres (`PUBLIC` is implicit + un-removable; any owner can grant to it); pursuing framework-owns-all-objects prevention would badly complicate migrations for marginal gain over a sound audit. Revoking default privileges from `PUBLIC` removes the accidental path; the audit is the boundary.
- **O3 (TOCTOU / point-in-time) → RESOLVED: document the contract, keep the point-in-time audit; the DDL event trigger is OUT OF SCOPE for v1.** Contract (state in SPEC): schema/grant changes go through `kovo db migrate` → `provision` (re-audit) → runtime restart (boot audit), all of which re-run the closure audit, so the new runtime never serves an un-audited state; out-of-band DDL to a live production DB is UNSUPPORTED. Kovo is sound at deploy boundaries. (A Postgres `ddl_command_end` event trigger would extend this to continuous/out-of-band-DDL coverage and is the named POST-v1 path, but is explicitly not v1 scope.)
- **O4 (asserted vs proven completeness) → RESOLVED into DEC-F (grant-shape fuzzer), HIGHEST priority.** Retain-and-prove reduces "is it complete?" to "is reachability computed soundly?"; the fuzzer tests that across the cross-product and gates v1 (16.9). This is the mechanism that ends the round-trip: round-14's next proxy becomes a caught test, not a served leak.
- **O5 (B5 scope + identity axis) → RESOLVED: DEC-B1 is defense-in-depth (harden the brand; cheap, also prevents accidental misuse) + DEC-B2 identity invariant** (the app-reachable DB identities are exactly the three app roles; the completeness obligation on the identity axis, parallel to A5 on the object axis).
- **O6 (column-audit cost) → RESOLVED: implement via `aclexplode` one-query-per-catalog, not a per-column `has_*_privilege` loop** (folded into DEC-A implementation note). Retain decision needs only "any access"; only the KV435 secret-column check is per-column.

## 6. Probes before committing

- [x] **DEC-A column leak refuses:** the `scratchpad/col-priv-probe.mjs` shape (column-only `GRANT SELECT (secret) … TO kovo_reader`/`TO PUBLIC`) makes `checkPostgresAppDbPosture` return not-ok; the framework's own column-granted owner tables still pass.
  - Evidence: focused vitest command passed; `postgres-runtime.test.ts` covers column-only app-role/PUBLIC grants and protected owner-table pass paths.
- [x] **DEC-A cross-schema definer refuses; sequence serial-PK passes, hand-granted sequence refuses.**
  - Evidence: focused vitest command passed; `postgres-runtime.test.ts` covers cross-schema `SECURITY DEFINER`, protected serial INSERT/pass, and unrelated sequence refusal.
- [x] **DEC-B unbranded posture rejected; branded `actAs` honored.**
  - Evidence: focused vitest command passed; `postgres-runtime.test.ts` covers both unbranded act-as rejection and branded act-as owner reads.
- [x] **DEC-C least-priv runtime sets `kovo.principal` (P1) and serves; serial-PK INSERT works (P2).**
  - Evidence: focused external Postgres probe passed and exercises least-priv owner isolation through `kovo.principal`; focused Postgres runtime suite passed and covers protected-table serial INSERT/pass.
- [ ] **DEC-F fuzzer refuses every generated leaking shape and over-blocks none; re-introducing a round-13 bug turns it RED.**

## 7. Resolved design forks (recorded for provenance)

- **Complete the inclusion test vs sound the exclusion test** — chose SOUND EXCLUSION (C7 retain-and-prove): the bug is
  never the inclusion test's incompleteness but the exclusion/skip decision failing open. Retain unless provably safe.
- **table-level vs column-level oracle** — chose COLUMN granularity (`has_column_privilege`/`aclexplode`); table-level
  is a necessary-not-sufficient proxy that dropped column-reachable objects.
- **app-schema vs all-schema routine scan** — chose ALL non-system schemas (match the relation scan).
- **bare boolean vs justification-carrying opt-out** — chose justification-carrying (DEC-D), per the type-security rule.
- **`PUBLIC` prevention vs detection** — chose DETECTION (retain-and-prove) + default-priv revocation defense-in-depth (DEC-C4); full prevention is impossible in Postgres and not worth the migration-model cost.
- **TOCTOU: point-in-time vs continuous** — chose POINT-IN-TIME + documented deploy-boundary contract for v1; DDL event trigger is the named POST-v1 path (out of v1 scope).
- **assert vs prove completeness** — chose PROVE-BY-FUZZING the grant-shape space (DEC-F); formal proof is infeasible, and asserting completeness is what let each round's next proxy through.

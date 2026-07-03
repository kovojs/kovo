# Fundamental Fixes Followup 6 — the sole door is the storage engine; make Postgres the sound default and quarantine SQLite

Created 2026-07-02. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the runtime-confinement line
(`fundamental-fixes-followup-{3,4,5}.md`). Responds to the round-10 findings (`plans/claude-bugz-31.md` B1–B3,
`plans/claude-papercuts-29.md` P1–P4), all reproduced under `KOVO_PARANOID=1`.

## 1. The one foundational issue (round-1..10 diagnosis, in one sentence)

**Every recurring hole is the same shape: a security property enforced at a choke that is _decidable_ but not the
_sole door_ for that property's data path.** A choke is sound only if every read/write of the protected data must pass
through it regardless of how the app _authored_ the query. Over a Turing-complete authoring surface the only layer that
is structurally unavoidable is the **storage engine**, because every query — builder, `db.query.*` relational, raw SQL,
view, subquery, UNION, an ambient singleton — reaches the engine, and the engine enforces by **role/principal**, never
by the query's syntactic shape. Each prior fix moved _down_ a layer but stayed _above_ the engine, so a new syntactic
door reopened the hole:

| Round | Choke                        | App-level shape it enumerated | Door that reopened                                               |
| ----- | ---------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| 1–6   | static AST classification    | Drizzle builder table symbols | raw `sql` (bugz-30 B1)                                           |
| 7–9   | result-name-match secret box | result key names              | alias / view / UNION (bugz-29 B1–B3)                             |
| 10    | SQLite `config.where` proxy  | recognized builder verbs      | `db.query.*`, subquery-FROM, unwrapped singleton (bugz-31 B1/B2) |

## 2. The resolution — Postgres already IS the sound architecture; SQLite structurally cannot be

Postgres enforces authorization/confidentiality **at the engine, keyed on role/principal, shape-independent** (verified
in `packages/create-kovo/templates/src/_kovo/app-runtime-db.ts` + `packages/server/src/managed-db.ts`):

- Non-superuser role per request: `SET LOCAL ROLE kovo_reader/kovo_writer` (`managed-db.ts:1289-1291`).
- Column default-deny: `REVOKE ALL … FROM kovo_reader` then `GRANT SELECT(publicCols)` (`app-runtime-db.ts:296-303`) —
  secret columns are engine-unreadable by the reader.
- Owner scoping: `ENABLE/FORCE ROW LEVEL SECURITY` + `CREATE POLICY … USING/ WITH CHECK (owner = current_setting('kovo.principal', true))` (`:331-339`).
- Unforgeable principal: transaction-local `set_config('kovo.principal',$1,true)` (`managed-db.ts:1285`) +
  `REVOKE EXECUTE ON set_config FROM PUBLIC` (`:79`).
- Escalation confinement: role-scoped clients reject `db.exec` and force one parameterized extended-protocol statement,
  so app SQL cannot append `RESET ROLE` / `SET ROLE` (`managed-db.ts:1252-1261`).

**This is why every SQLite finding has a PG twin that fails closed** (bugz-31 B1: `readonlyAppDb` on PG runs as
`kovo_reader` with `kovo.principal` unset ⇒ RLS `owner=NULL` ⇒ 0 rows). SQLite has **no** engine role/RLS/column-
privilege layer, so any SQLite owner-scope is necessarily an app-level shape-enumeration proxy — the exact unsound
pattern. Therefore:

**Decision: Postgres (PGlite in-process for dev, managed Postgres for deploy) is the sound, supported default. SQLite is
gated behind an explicit experimental opt-in and is documented as NOT providing the authorization/confidentiality
guarantees.** This deletes the entire round-10 class rather than chasing the next SQLite builder shape.

## 3. Meta-invariant (extends followup-5 C1–C3)

- **C4 — A value/effect security property (authorization, confidentiality) is sound only when its choke is the storage
  engine (role + RLS + column privilege), i.e. unavoidable for every query shape. A dialect that cannot host an engine
  choke cannot claim the property; it must fail the property's build/opt-in gate, not approximate it in the app layer.**
  The static classifiers and runtime boxes are defense-in-depth and diagnostics, never the proof (preserves the
  CLAUDE.md honesty boundary).

## 4. Decisions / work items

### DEC-A — Quarantine SQLite: single-principal / local-dev only, authorization is an explicit NO-OP (deletes bugz-31 B1/B2, papercuts-29 P1/P2)

**Chosen option: (iii) SQLite = single-principal / local-dev only; owner-scoping is a documented NO-OP with a loud
boot + build warning.** SQLite has no engine role/RLS/column layer, so any owner-scope it offers is necessarily an
app-level shape-enumeration proxy — the exact unsound pattern. The two rejected alternatives:

- **(i) best-effort proxy + docs disclaimer** — REJECTED: scopes recognized shapes, silently misses `db.query.*`,
  subquery-FROM, and the unwrapped singleton; the leak is silent at runtime on a green paranoid build (bugz-31 B1/B2
  shipped exactly this way). "Experimental" must never mean "silently unsound."
- **(ii) fail-closed on owner/unclassified reads** — REJECTED for v1: honest, but it rebuilds most of the engine's
  default-deny in the app layer — a second, unsound authorization implementation the framework must maintain forever,
  just to approximate what Postgres gets for free. Keep only if a concrete need to exercise multi-tenant behavior
  _specifically_ on SQLite appears.

Rationale for (iii): PGlite already runs in-process for dev, so the cost of "no multi-tenant on SQLite" is near zero,
and (iii) _deletes_ an unsound subsystem instead of hardening it.

- [x] **A1 — `create-kovo --sqlite` refuses to scaffold unless `KOVO_EXPERIMENTAL_SQLITE=1` (or `--experimental-sqlite`). Postgres (PGlite in-process for dev) is the default with no flag.**
  - Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.test.ts --config ./vite.config.ts` passed with CLI coverage for default Postgres, SQLite refusal without opt-in, and SQLite success with `--experimental-sqlite` or `KOVO_EXPERIMENTAL_SQLITE=1`.
- [x] **A2 — Remove the SQLite owner-scope proxy entirely (`createSqliteAuthorizationDb` and `sqliteAuthorizationProxy` in `managed-db.ts`); the SQLite managed handle applies read-only + SQL-safety + KV438 floors ONLY, and `kovo({owner})` is a build-time WARNING (not error) on the SQLite dialect stating owner-scoping is not enforced.** No partial proxy that reads as a guarantee.
  - Evidence: `rg -n "sqliteAuthorizationProxy|createSqliteAuthorizationDb" packages/server/src packages/create-kovo/templates packages/create-kovo/src` returned no matches; `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts packages/core/src/diagnostics.test.ts packages/server/src/sqlite-authz.test.ts packages/create-kovo/src/index.test.ts --config ./vite.config.ts` passed, covering the KV447 SQLite owner warning and proxy-free SQLite runtime. `pnpm run check:paranoid-runtime` passed with SQLite owner rows visible across principals but the experimental warning and secret/write chokes still active.
  - Acceptance: with the flag on, `KOVO_PARANOID=1` + the bugz-31 B1/B2 repro (`readonlyAppDb` endpoint read, `db.query.*` relational read) no longer _claims_ to scope; the boot banner + a per-`kovo({owner})`-table build warning disclaim it; `grep sqliteAuthorizationProxy` returns 0 in shipped source. Multi-owner data on SQLite is documented as visible across principals.
- [x] **A3 — The KV414 SQLite insert over-block (papercuts-29 P1) is deleted with the proxy: an owner-self insert on SQLite just succeeds (no owner enforcement to check).** Removes the green-build→HTTP-500 (`assertSqliteInsertIsOwnerCheckable`, `managed-db.ts:1073-1075`).
  - Evidence: `pnpm exec vitest --run packages/server/src/sqlite-authz.test.ts --config ./vite.config.ts` passed with a proxy-free SQLite owner-table insert that persists through the managed write handle.
  - Acceptance: an owner-table insert on the SQLite experimental path returns 2xx and persists; no KV414 runtime throw exists for SQLite inserts.

### DEC-B — Close the last app-level door in the Postgres authorization path: the superuser internal client

- [x] **B1 — `db(request)` returns the UNCONFINED superuser `createInternalFrameworkDb` when `request === undefined` (`app-runtime-db.ts:65-68`); this is the PG analogue of bugz-31's unscoped handle. Guarantee it is unreachable from app-authored request code — extend the DEC-H sole-door lint (`static.ts:1124` `endpointRawDriverImportDiagnostic`) to also forbid `appRuntimeDbProvider()`/`appRuntimeDbProvider(undefined)` and any import of the internal-db symbol from endpoint/webhook/task/query/mutation modules.**
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/sql-safety-static.test.ts --config ./vite.config.ts`, `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts --config ./vite.config.ts`, and `pnpm exec vitest --run packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts --config ./vite.config.ts` passed with KV414 coverage for unconfined `appRuntimeDbProvider()`, generated runtime DB value imports in request surfaces, type-only imports, and starter `createApp({ db: appRuntimeDbProvider })` wiring.
  - Acceptance: an endpoint calling `appRuntimeDbProvider()` (no request) or importing the internal framework db is a build error; a paranoid test proves no app surface can obtain a superuser handle.
- [x] **B2 — Add the census/role default-deny test that makes bugz-31 B3 (static census excludes endpoint/task reads) a non-issue on PG: prove an unclassified request-reachable table has NO grant to `kovo_reader` ⇒ engine `permission denied` / 0 rows, so the static census is demotable to defense-in-depth.**
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/create-kovo/src/index.test.ts --config ./vite.config.ts` passed with a real PGlite `kovo_reader` proof: owner-table reads return only the current principal's rows, unclassified `verification` reads are engine-denied, and the starter reader grant helper keys off authorization classifications.
  - Acceptance: a fresh app with a table absent from any owner/public classification, read by `kovo_reader`, returns permission-denied at the engine (not app-layer); documented that the static census is advisory once the role model is the floor.

### DEC-C — Write-scope (`observed ⊆ declared`): narrow the writer grant so the engine default-denies the dangerous tables

**Chosen option: (a′) narrow the writer grant to mirror the reader's default-deny.** The out-of-scope-write blast
radius splits by table class, verified against the current template:

| Out-of-scope write target                                                                                           | Engine protection today                                                                                                 | Harm                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| An **owner table** (incl. `user`/`session`/`account`, all `kovo({owner})` — `schema.ts:44,61,88`)                   | Owner-RLS `FOR ALL … WITH CHECK(owner=current_setting('kovo.principal'))` under FORCE RLS (`app-runtime-db.ts:338-339`) | **Benign** — can only write your OWN rows; no cross-owner tamper, no ownership reassignment.                                                       |
| An **unclassified / non-owner table** (`verification` — `schema.ts:96`, no `kovo()`; shared `settings`/`reference`) | **NONE** — blanket `GRANT …INSERT,UPDATE,DELETE` to `kovo_writer` (`app-runtime-db.ts:311-318`), no policy              | **Real** — forge a `verification` token, corrupt shared config; only the `createDeclaredWriteDb` framework shape-choke stands (bugz-29 B3's home). |

Owner-RLS already neutralizes the benign half. The dangerous half is exactly the tables the writer role is
_blanket-granted_ on with no policy — the mirror-image of the sound reader default-deny. Rejected alternatives:
**(a) accept as-is** understates this residual (leaves `verification`-forge behind the framework choke);
**(b) per-mutation engine confinement** (transient per-transaction roles / table-scoped `SET LOCAL`) is the "right"
answer but hard — declared-write scope is _dynamic per mutation_ while grants are _static per role_ — so it is post-v1.

- [x] **C1 — Stop blanket-granting `kovo_writer`. Grant `INSERT/UPDATE/DELETE` only to (i) owner tables (WITH CHECK bounds them) and (ii) tables the app explicitly declares writable; leave unclassified / reference tables (e.g. `verification`) UN-granted ⇒ engine default-deny on writes. `applyPgliteWriterTablePrivileges` (`app-runtime-db.ts:311-318`) must key off classification, not `SCHEMA_TABLES` wholesale.**
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts packages/create-kovo/src/index.test.ts --config ./vite.config.ts` passed with a PGlite writer-role proof: own-row owner insert succeeds, `verification` insert is engine-denied, and cross-owner/owner-reassignment writes are RLS-denied.
- [x] **C2 — Record the residual honestly in SPEC §11.2: with C1, `observed ⊆ declared` is engine-enforced for the DANGEROUS cases (cross-owner via RLS, unclassified/reference via default-deny grant); the framework declared-write choke remains only for the BENIGN case (over-declaring among the caller's own owner tables), which is a coverage/invalidation contract, not a confidentiality/integrity boundary.**
  - Evidence: `SPEC.md`, `spec/10-data-plane.md`, and `spec/11-verification.md` now state the Postgres/PGlite layer split; the focused PGlite proof above passed.

### DEC-D — Shrink the confidentiality TCB to the engine on the privileged path

- [x] **D1 — Column-REVOKE makes secret columns engine-unreadable for `kovo_reader`, but the provenance box (`createSecretBoxingReadDb`) remains load-bearing for the privileged read path (`createRequestScopedReadonlyDb` `privilegedDb`, `app-runtime-db.ts:134-140`) and the writer role (no column REVOKE). Confirm the box's bugz-29 alias/view/UNION provenance bugs are fixed OR that the privileged path is only reachable by framework auth internals (not app reads), and enroll the box in the TCB manifest with that boundary documented.**
  - Evidence: `pnpm exec vitest --run packages/server/src/secret-read-boundary.test.ts --config ./vite.config.ts` passed with alias/origin, hidden subquery, UNION, engine-backed raw denial, and privileged declared raw secret-read coverage; `security/TCB.md` names `server.secret-read.box-rows`, `server.secret-read.sqlite-boundary`, and Postgres scoped-client engine-choke boundaries.
  - Acceptance: either the privileged secret path is proven framework-internal-only (a lint/test), or the box is provenance-sound for alias/view/UNION (paranoid tests from bugz-29 B1–B3 pass); `security/TCB.md` names the exact confidentiality boundary per dialect.

### DEC-E — Task/webhook principal seam (papercuts-29 P3, dialect-independent)

- [x] **E1 — `runQuery`/`runMutation` drop `options.principalPosture` (`query.ts:418-424`; `mutation.ts` has no reference), so a durable task's `ctx.actAs(u)` / `declareSystem` reads/writes nothing. Thread the posture into the lifecycle request the way `endpoint.ts:290-313` does, so the task path derives the same principal the endpoint path does.**
  - Evidence: `pnpm exec vitest --run packages/server/src/task-runner.test.ts --config ./vite.config.ts` passed with task `ctx.actAs(...).runQuery` returning act-as scoped rows, `declareSystemRead(...).runQuery` returning system scoped rows, and `ctx.actAs(...).runMutation` returning an act-as scoped mutation value from lifecycle DB resolution.
  - Acceptance: a durable task `ctx.actAs(u).runQuery` against an owner table returns u's rows (engine-scoped on PG); `declareSystem` reads the declared system scope; a task-path paranoid test covers it.

### DEC-F — Dialect-independent floors (confirm, don't rebuild)

- [x] **F1 — Confirm the KV438 mass-assignment runtime floor is live for every write shape** (present at `managed-db.ts:818`; tests `managed-db.test.ts:1724-1780`). Verify it fires under `KOVO_PARANOID=1` for insert/update/onConflict on a governed column bound to client input — closing bugz-30 B4 on the supported (PG) path.
  - Evidence: `pnpm exec vitest --run packages/server/src/managed-db.test.ts --config ./vite.config.ts` passed after adding array `.values([...])` governed-column coverage alongside update, insert, spread, and `onConflictDoUpdate`.
- [x] **F2 — Re-audit the security-marker registry for C4: any code whose property is authorization/confidentiality must name the engine choke (role/RLS/column-privilege) as its enforcement on PG, not an app-level proxy.** SQLite entries are marked experimental/unsound.
  - Evidence: `pnpm exec vitest --run packages/core/src/internal/security-markers.test.ts --config ./vite.config.ts` passed with registry assertions that KV414/KV435 name the Postgres engine choke and SQLite experimental/non-guaranteeing posture.
  - Acceptance: registry test asserts every value/effect authorization/confidentiality code maps to an engine mechanism on the supported dialect; the SQLite dialect is flagged non-guaranteeing.

## 5. Acceptance (the round-11 finish line)

- [x] Re-run the §7-style paranoid generative dogfood **Postgres-only**: zero cross-owner reads/writes across builder,
      `db.query.*`, raw SQL, view, subquery, UNION, `readonlyAppDb`, endpoint, task, webhook. The engine-choke thesis
      predicts zero — this is the test of C4.
  - Evidence: `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts --config ./vite.config.ts` passed. The served Postgres/PGlite artifact under `KOVO_PARANOID=1` proves owner-only rows across builder, `db.query.*`, raw SQL, alias, view, ownerVia, subquery, UNION, `readonlyAppDb`, endpoint `actAs`, durable-task `actAs(...).runQuery`, and webhook mutation composition; cross-owner writes are denied by RLS and unclassified `verification` writes are denied by grants.
- [x] SQLite behind the experimental flag: dogfood confirms it either fails closed or loudly disclaims; no _silent_
      cross-owner leak.
  - Evidence: the same `pnpm exec vitest --run packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts --config ./vite.config.ts` pass includes the SQLite production-artifact harness and asserts the experimental/single-principal warning instead of any owner-scoping guarantee.
- [x] The static census + secret box are demonstrably demotable to defense-in-depth on PG (removing them does not
      produce a served leak in the paranoid harness) — the signal that enforcement has actually reached the engine.
  - Evidence: the same production-artifact pass proves the Postgres `readonlyAppDb` path denies unclassified `verification` reads by engine grant (`packages/server/src/postgres-runtime.ts` uses a reader-role DB for readonly reads, not a static-census proxy) and denies both builder and raw SQL secret-column reads by column privileges; the raw path is configured with `rawSecretTableRead: 'engine'`, so the secret box is not the blocker for that served check.

## 6. Resolved forks (decided; recorded here for provenance)

- **DEC-C write-scope** — chose **(a′)** narrow the writer grant so the engine default-denies unclassified/reference
  tables; framework choke retained only for the benign owner-table over-declaration case. Reserve (b) full
  per-mutation confinement for post-v1. (Rejected: (a) accept-as-is — understates the `verification`-forge residual.)
- **DEC-A quarantine** — chose **(iii)** SQLite = single-principal / local-dev only, owner-scoping is a NO-OP with a
  loud warning and the proxy is removed. (Rejected: (i) best-effort+disclaimer — silently unsound; (ii) fail-closed —
  rebuilds the engine in the app layer, deferred unless a concrete SQLite-multi-tenant need appears.)

## 7. Load-bearing claims — PROBED AND CONFIRMED on real PGlite 0.5.1

Both DEC-C (a′) claims verified empirically by replaying the template's exact mechanism (`CREATE ROLE` +
`SET LOCAL ROLE` + `GRANT` + `FORCE ROW LEVEL SECURITY` + `set_config('kovo.principal',…,true)`) on an in-memory
PGlite. All 9 checks PASS. Probe: `scratchpad/pg-writescope-probe.mjs`.

1. **[✓] `verification` is writer-granted today** — with the wholesale grant over `SCHEMA_TABLES`, `SET LOCAL ROLE
kovo_writer; INSERT INTO verification` SUCCEEDS. The `verification`-forge risk C1 closes is real.
2. **[✓] Narrowing the grant engine-denies the write** — with `verification`/`app_config` un-granted to the narrowed
   writer role, the same insert raises `permission denied for table verification` / `… app_config`, while the
   owner-table (`orders`) write STILL succeeds. (a′) works exactly as designed.
3. **[✓] THE CRUX — PGlite `SET LOCAL ROLE <non-superuser>` actually DROPS superuser.** The default connection is
   superuser (`postgres`, `rolsuper=true`), but after `SET LOCAL ROLE kovo_writer` a write to an _ungranted_ table
   denies (`permission denied for table stranger`). This validates the whole engine-choke thesis: reader default-deny,
   RLS, column-REVOKE, and the writer narrowing all rest on role privilege checks that PGlite honors. (Round-9's
   "PGlite is always superuser" is true of the _default_ connection but is confined by `SET LOCAL ROLE`.)
4. **[✓] Benign/dangerous split confirmed** — owner writes own row (OK); cross-owner write denied by WITH CHECK (`new
row violates row-level security policy for table "orders"`); principal-UNSET read ⇒ 0 rows (RLS default-deny — the
   `readonlyAppDb` PG twin failing closed, matching bugz-31 B1's PG behavior).

Caveat: tested on PGlite 0.5.1 (monorepo-resolved); the mechanism is core Postgres semantics (roles/GRANT/RLS) compiled
to WASM, stable across versions. Not re-probed: single-statement extended-protocol confinement (DEC-B, already
implemented) — orthogonal to DEC-C.

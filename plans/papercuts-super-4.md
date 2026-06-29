# Papercuts Super 4

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five advanced-feature tracks
(relations/joins, transactions/optimistic writes, persistent-volume schema drift,
form→postgres write coercion, and Better-Auth owner-scoping), each authored as a real
app and adversarially verified.

**Meta-theme — the hand-rolled `src/db.ts` DDL emitter is the hot spot.** The current
`main` tip `314f46981 "Fix starter DDL papercuts"` rewrote the starter to derive its boot
DDL from the Drizzle schema. That fixed super-3 §E, but the hand-rolled emitter now carries
four distinct defects (§A): it no longer type-checks against its own pinned `drizzle-orm`
(a **regression on a fresh scaffold**), it crashes on a `serial` PK it advertises support
for, it cannot re-order foreign-key tables, and against the new persistent `.kovo/pglite`
volume it silently never `ALTER`s — a green build that 500s every request. Two secondary
themes: the `s.*` schema builder has **no WRITE-side primitive** for money/date/json
postgres columns (§B), and three build gates **false-positive on canonical postgres
patterns** (§C).

No security/soundness defects were found this run (the KV414 insert item in §C1 is a
fail-**closed** false positive — a papercut, not a vuln; it is the inverse of the
fail-**open** hole already filed as `plans/bugz-13.md` B1).

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local
  to the local monorepo, under `/Users/mini/kovo-dogfood-pg-20260629/` (plus
  `/Users/mini/kovo-dogfood-pg-base` and `-pg-pristine`). Gates run per app: `pnpm run check`
  (`vp check` + sound-subset + `build:prod` + endpoint-posture), `pnpm exec tsc --noEmit`,
  `vp test`, and dev/build HTTP smokes.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; UI copy-in/`kovo
add` (covered by papercuts-8…14); the read-shape extractor, deploy artifact, webhooks,
  files/storage, Live, MPA spine, nav/events/VT (covered by super-1/2/3). Throwaway apps are
  safe to delete; do **not** re-run `pnpm install` in them without isolation (link-local
  installs repoint monorepo nested deps).

## Issues

### A. The hand-rolled `src/db.ts` DDL emitter is the hot spot (all in `templates/src/db.ts`, all touched by HEAD `314f46981`)

- [x] **A1 — A fresh default (postgres) scaffold fails its own `pnpm run check`/`tsc`: `drizzle({ client, schema })` + `AppDb = PgliteDatabase<typeof schema>` no longer type-checks against the pinned `drizzle-orm@1.0.0-rc.3`.** (HIGH, template; **regression in HEAD `314f46981`**; baseline)
  - Observed behavior: `vp check` / `pnpm exec tsc --noEmit` on a pristine scaffold report 3 errors in `src/db.ts` — `TS2344` (`typeof import("./schema")` does not satisfy `TablesRelationalConfig`: "Property 'contacts' … is missing the following properties from type 'TableRelationalConfig': table, relations"), plus `TS2322` and `TS2345` on the `drizzle()` call. The very first gate an author runs is red.
  - Root cause: `templates/src/db.ts:17` (`export type AppDb = PgliteDatabase<typeof schema>`) and `:40` (`return { db: drizzle({ client, schema }), ready }`). In `drizzle-orm` 1.0 RC the `schema` generic expects relational-config objects, not the raw `import * as schema` table namespace; commit `314f46981` ("Fix starter DDL papercuts") added the `import * as schema` + `schema`-arg to derive DDL, introducing the type break. `queries.ts` uses the `.select()` builder, not the relational `db.query.*` API, so the `schema` generic buys nothing functionally.
  - Why it matters: the default template — the headline first-run experience — does not pass the gate it ships and documents. The non-default `--sqlite` template and both example apps avoid it: `examples/commerce/src/db.ts:14,35` type `CommerceDb = PgliteDatabase` and call `drizzle({ client })`.
  - Repro evidence: `node …/create-kovo/dist/index.mjs <app> --disable-git` (default = postgres) → link → install → `pnpm exec tsc --noEmit` → 3 `src/db.ts` errors; reproduced on a pristine scaffold every time. `git log -S "drizzle({ client, schema })" -- packages/create-kovo/templates/src/db.ts` → first/only hit `314f46981` (current HEAD).
  - Acceptance: a fresh postgres scaffold passes `pnpm run check` and `tsc` with zero edits. Fix should match the example shape (`drizzle({ client })` + unparameterized `PgliteDatabase`, drop the now-unused `import * as schema`), or supply real relational config so `PgliteDatabase<typeof schema>` is valid. Prove with a `create-kovo` build test that runs `tsc` over a generated postgres app.
  - Fixed evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.test.ts --reporter=dot` passed; assertions cover unparameterized `PgliteDatabase`, `drizzle({ client })`, and generated-app starter gates.

- [x] **A2 — A `serial`/auto-increment PK — the canonical child-table pattern, used by both example apps — crashes app startup with a misdirecting "Unsupported Postgres starter default for id".** (med, template; found by `t1-relations`)
  - Observed behavior: adding `id: serial('id').primaryKey()` to a table and registering it in `SCHEMA_TABLES` crashes during `await appDbReady` (and fails `build:prod`, `vp dev`, `check`) with `Unsupported Postgres starter default for id` thrown from `columnDefaultDdl`. The message blames a _default value_; the real cause is unhandled serial DDL.
  - Root cause: `templates/src/db.ts` — `columnTypeDdl` advertises serial (`case 'PgSerial': return 'serial'`, ~`:85-86`) but `columnDefaultDdl` (`:96-103`, throw at `:102`) has no `PgSerial` branch. A serial column reports `hasDefault=true, default=undefined`, so it passes the `if (!hasDefault) return ''` guard, matches none of the boolean/number/string `typeof` checks, and falls through to the throw.
  - Why it matters: a serial PK is the idiomatic Postgres child-table key and is exactly what a relations author reaches for; `examples/crm/src/schema.ts` (`activities.id`) and `examples/commerce` (`cartItems.id`) both model it this way. The starter hard-crashes on it with an error pointing at the wrong thing.
  - Repro evidence: self-verified standalone against the app's installed `drizzle-orm`: a `serial('id').primaryKey()` column → `getTableConfig` reports `columnType=PgSerial hasDefault=true default=undefined`; emulating `columnDefaultDdl` printed `THREW: Unsupported Postgres starter default for id`.
  - Acceptance: a `serial` PK boots and emits valid DDL (no explicit `DEFAULT`, since `serial` implies one). Prove with a starter test that DDL-generates a serial-keyed table.
  - Fixed evidence: `packages/create-kovo/src/index.build.test.ts` test `boots Postgres starter DDL with serial columns, reordered foreign keys, and additive drift`; focused create-kovo Vitest command above passed.

- [x] **A3 — Against the persistent `.kovo/pglite` volume, `CREATE TABLE IF NOT EXISTS` never `ALTER`s, so an additive schema change passes `check`+`build`+`tsc` green and then 500s every request until the data dir is wiped.** (med, template; found by `t3-schema-drift`)
  - Observed behavior: with a previously-booted `.kovo/pglite`, adding a column to `schema.ts` leaves the persisted table unchanged; every request touching the new column returns HTTP 500 (PG 42703 undefined_column) while `tsc`/`build:prod`/`check` are all green. `rm -rf .kovo/pglite` + restart restores HTTP 200.
  - Root cause: `templates/src/db.ts:59` emits `CREATE TABLE IF NOT EXISTS` and `initializeAppDb` (`:43-45`) runs only that DDL — no `ALTER`/migration — against the persistent `DEFAULT_DATA_DIR='.kovo/pglite'` (`:34,:38`). `IF NOT EXISTS` makes the whole statement a no-op on an existing table, so the derived column never lands.
  - Why it matters: the starter advertises `build:prod`/`check` as the deploy gate. With a persistent volume in production, deploying any additive schema change is a silent no-op — green build, drifted DB, 500s. This is distinct from the **fixed** super-3 §E (a column absent from a _hand-written_ DDL): here the DDL is correct and derived, but the persistence + `IF NOT EXISTS` semantics drop it.
  - Repro evidence: `t3-schema-drift` — green `tsc`/`build`/`check`; `vp dev` + authed `curl /` → HTTP 500 on the drifted table; `rm -rf .kovo/pglite` + restart + same request → HTTP 200 with seeded rows.
  - Acceptance: an additive schema change applied to a persisted dev/prod DB is reflected without a manual wipe (e.g. derive + apply `ALTER`s, or a dev-mode drift detection that fails loudly at boot with the missing column named). At minimum the starter must warn that schema changes require wiping the volume.
  - Fixed evidence: `packages/create-kovo/src/index.build.test.ts` mutates a generated app schema after first boot and proves `select nickname from contacts` succeeds against the same PGlite data dir; focused create-kovo Vitest command above passed.

- [x] **A4 — `SCHEMA_TABLES` is emitted in array order with inline `FOREIGN KEY`s and no topological sort, so the canonical owner FK (an app table → `user`) crashes boot with a cryptic `relation "user" does not exist`.** (low, template; found by `t5-auth-ownerscope`)
  - Observed behavior: with `SCHEMA_TABLES = [contacts, user, …]` (app domain first) and a `contacts.ownerId → user.id` FK, boot fails with `relation "user" does not exist` and a large WASM trace; reordering to put `user` before `contacts` fixes it.
  - Root cause: `templates/src/db.ts:24` (`SCHEMA_TABLES` order) + `createTableDdl` (`:53-60`) emitting inline FKs via `foreignKeyDdl` (`:105-116`), with no dependency sort. The shipped order is accidentally fine only because the shipped `contacts` has no FK to an auth table.
  - Why it matters: adding an owner FK is the _first_ edit an owner-scope author makes, and it hard-fails the deploy build with an error that gives no hint the fix is reordering an array.
  - Repro evidence: `t5-auth-ownerscope/src/db.ts` with `SCHEMA_TABLES=[contacts,user,…]` + `rm -rf .kovo/pglite` + `build:prod` → `ERROR relation "user" does not exist`; reordering → boot proceeds.
  - Acceptance: table DDL is emitted in FK-dependency order (topological sort) regardless of `SCHEMA_TABLES` array order, or FKs are emitted as separate `ALTER TABLE … ADD CONSTRAINT` after all `CREATE TABLE`s.
  - Fixed evidence: `packages/create-kovo/src/index.build.test.ts` adds a generated-app owner FK from `contacts` to `user` while the template still lists `contacts` first; focused create-kovo Vitest command above passed.

### B. The `s.*` schema builder has no WRITE-side primitive for common postgres column types

- [x] **B1 — Money in a `numeric`/`decimal` column has no safe write path: `s.number()` float64-coerces and silently corrupts precision, and there is no `s.decimal`/string-numeric factory; `numeric` columns type as `string`, so `s.number()` output is also a `TS2769` type mismatch.** (med, framework; found by `t4-form-coercion`)
  - Observed behavior: POST `amount=9999999999999999.99` → stored `10000000000000000` (cents dropped, rounded up); `amount=12.50` → `12.5`. Feeding `s.number()` output to a `numeric` column is `TS2769` (Drizzle `PgNumeric` data type is `string`).
  - Root cause: `packages/server/src/schema.ts` — `NumberSchemaImpl.parse` (~`:424`) does `Number(value)` float coercion; `number()` (~`:160`) is the only numeric factory (no decimal/string-numeric schema), and Drizzle `PgNumeric` defaults `data: string`.
  - Why it matters: money in `numeric` is standard, and super-3 §A already certifies `numeric` is read back "correctly" — but on WRITE there is no safe option: `s.number()` silently corrupts high-precision values (a money data-integrity bug) and `s.string()` drops validation and the typed-error path.
  - Repro evidence: `node -e "Number('9999999999999999.99')"` → `10000000000000000`. `t4-form-coercion` invoice mutation reproduces the corrupted stored value end-to-end.
  - Acceptance: a `s.decimal()`/string-numeric primitive that preserves precision (string-carried), validates scale, and type-matches a `numeric` column. SPEC §6.3.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/schema.test.ts packages/compiler/src/query-bindings.test.ts --reporter=dot` passed; `schema.test.ts` proves `s.decimal({ scale: 2 })` preserves `9999999999999999.99` and rejects over-scale input as a 422 field error.

- [x] **B2 — No `s.date()`/`s.datetime()`: an `<input type="date">` → `timestamp` column has no coercing validator, forcing an unguarded `new Date()` in handlers where `Invalid Date` becomes a 500 instead of a §9.2 typed 422.** (low, framework; found by `t4-form-coercion`)
  - Observed behavior: with no date primitive, a handler must hand-roll `new Date(input)`; `dueDate=` (empty) or `dueDate=tomorrow` → HTTP 500 (Drizzle `timestamp.mapToDriverValue` calls `.toISOString()` on `Invalid Date`). Only a valid ISO date stores correctly.
  - Root cause: `packages/server/src/schema.ts` — the `s` object (~`:102-249`) exposes array/boolean/file/string/number/secret/object/record but no date/datetime member; `s.number()`/`s.boolean()` _do_ coerce form strings, so the date gap is an asymmetry.
  - Why it matters: date input → timestamp is an everyday CRUD pattern; the missing primitive routes malformed dates to a 500 rather than the framework's typed field-error path, defeating the schema's validation promise.
  - Repro evidence: `t4-form-coercion` — `dueDate=2026-07-15` → 303 (via hand-rolled `new Date()`); empty/garbage → 500.
  - Acceptance: an `s.date()`/`s.datetime()` primitive that parses form values, rejects invalid input as a 422 field error, and type-matches a `timestamp` column. SPEC §6.3, §9.2.
  - Fixed evidence: server schema Vitest command above passed; `schema.test.ts` proves `s.date()` and `s.datetime()` parse valid form strings and reject invalid calendar/date-time strings as typed validation errors.

- [x] **B3 — Writing a `jsonb` column from a no-JS form is unbridged: there is no `s.json()`, and `s.record`/`s.object` reject a flat form string, so the only path is a hand-rolled `JSON.parse` whose failure is an uncaught 500.** (low, framework; found by `t4-form-coercion`)
  - Observed behavior: POST `metadata={"note":"hello"}` works only via hand-rolled `JSON.parse`; `metadata=not-json` → HTTP 500. Feeding a JSON string to `s.record(s.string())` yields a 422 `Expected object input`, never a parse.
  - Root cause: `packages/server/src/schema.ts:719-726` (`formLikeToRecord` throws `Expected object input` for a string); the `s` builder (~`:103-248`) has no json primitive and `s.record`/`recordInput` consume objects, not JSON strings. Handler errors re-throw at `packages/server/src/mutation.ts:265`.
  - Why it matters: `jsonb` is a first-class column type; writing it from a progressive-enhancement form is impossible through the validating schema layer. This is the WRITE-direction counterpart left open after super-3 §A4 added `s.record` for READ/output.
  - Repro evidence: `t4-form-coercion` invoice `metadata` field as above.
  - Acceptance: a way to validate/parse a JSON-string form field into a typed `jsonb` value through the `s.*` layer, with parse failure surfaced as a 422. SPEC §6.3, §9.2.
  - Fixed evidence: server schema Vitest command above passed; `schema.test.ts` proves `s.json()` parses JSON-string form input and rejects malformed JSON as a typed validation error.

### C. Build gates false-positive on canonical postgres patterns

- [x] **C1 — KV414's write-side owner-scope audit fails closed on EVERY owner-table INSERT: "create a row owned by the session user" is unbuildable under `kovo build`, with no sound discharge.** (med, framework; found by `t5-auth-ownerscope`)
  - Observed behavior: an `owner:`-annotated table + `db.insert(contacts).values({ …, ownerId: request.session.user.id })` fails `build:prod` with `KV414 WRITE … domain=model/contact scope=unknown … Owner-table access is not scoped to the session principal (IDOR) … no owner-column session/principal predicate was proven` — even though the inserted `ownerId` _is_ session-derived.
  - Root cause: `packages/drizzle/src/static/project-receivers.ts:784` routes every write (including INSERT) through `writeInstanceKeyComparisons`, and `packages/drizzle/src/static/summaries.ts:3145-3147` derives owner-scope proof **only** from a `.where()` predicate. An INSERT has no `.where()`, so the proof is never found and KV414 fires unconditionally.
  - Why it matters: owner-scoping is the headline security-by-construction feature, and "insert a row owned by the current session user" is the most common owner-scoped write. The gate blocks the safe, idiomatic pattern with no escape (this is the **inverse** of `bugz-13` B1, where KV414 fails _open_ on the single-object handler form — same diagnostic, opposite failure mode).
  - Repro evidence: self-verified — `build:prod` in `t5-auth-ownerscope` (schema `owner:(t)=>t.ownerId`, mutation inserts `ownerId` from `request.session?.user.id`) → exit 1 with exactly that KV414 at `mutations.ts:75`.
  - Acceptance: an INSERT whose `ownerId` value is proven session/principal-derived (KV438 already proves the value provenance) discharges KV414 soundly. Prove with a starter owner-scope INSERT that builds clean while a cross-tenant INSERT still fails.
  - Fixed evidence: `pnpm exec vitest run packages/drizzle/src/index.scope-audits.test.ts --reporter=dot` passed; `classifies owner-table inserts from values() owner fields` proves session-owned inserts are `scope:session`, client-owned inserts are `scope:args`, and opaque owner inserts remain `scope:unknown`.

- [x] **C2 — The starter `check:sound-subset` gate bans the `as unknown as Db` cast that the framework's own `transaction()` mutation-option (per `examples/commerce`) requires, so a canonical transactional mutation fails `pnpm run check` despite green `tsc`+`build`.** (med, template; found by `t2-mutations-tx`)
  - Observed behavior: using the commerce-style `transaction(request, run)` mutation option → `tsc --noEmit` exit 0, `build:prod` exit 0, but `pnpm run check` fails at `check:sound-subset` with `SPEC.md §6.6 sound subset bans unchecked casts` (×3), exit 1.
  - Root cause: `templates/scripts/check-sound-subset.mjs:60-66` bans every non-`const` `as` expression (a true AST positive). The cast is _forced_ by `packages/server/src/mutation/definition.ts:310-313` — the `transaction` option hands an un-narrowed `Request` and requires `run(GuardedRequest)`, with no typed `tx → AppDb` bridge; `examples/commerce/src/domain.ts:238` does exactly `run({ …request, db: tx as unknown as CommerceDb })`.
  - Why it matters: `pnpm run check` is the headline gate. An author copying the one example this surface points at gets a red check with a diagnostic blaming a §6.6 soundness violation, not the gate's over-broad cast ban. The `transaction()` option is effectively unusable in a default starter (a cast-free in-handler `db.transaction(async (tx) => …)` works, but nothing hints the option pattern is rejected).
  - Repro evidence: `t2-mutations-tx` — added the commerce-style option → `check:sound-subset` failed ×3; reverting to in-handler `db.transaction` → green.
  - Acceptance: the canonical `transaction()` mutation-option pattern passes the starter's own gates (either a typed `tx`-as-`AppDb` bridge that removes the cast, or a sound-subset exemption for the framework-blessed bridge).
  - Fixed evidence: focused create-kovo Vitest command above passed; `index.test.ts` proves the transaction `run({ ...request, db: tx as unknown as AppDb })` bridge passes `check:sound-subset` while an unrelated unsafe cast still fails.

- [x] **C3 — KV302 rejects `query.items.length` as a binding path while accepting `query.items.map` on the same array, forcing an alias workaround.** (low, framework; found by `t2-mutations-tx`)
  - Observed behavior: `{query.items.length}` → `build:prod` fails `KV302 … data-bind path is not present in the declared query shape: …items.length`, while `{query.items.map(...)}` on the same array builds fine.
  - Root cause: `packages/compiler/src/analyze/query-shapes.ts:85-88` (`validatePathInShape`): on an array shape with remaining path segments it recurses into the item shape (`current[0]`) and resolves `length` as a _row field_; the row has none → `exists:false`. KV302 is emitted at `packages/compiler/src/validate/bindings.ts:53-57`.
  - Why it matters: "show N items" is a first-order idiom; the compiler rejects it with a message claiming the path is absent (`.length` is universal on arrays), and the only escape is aliasing the array to a local const.
  - Repro evidence: `t2-mutations-tx/src/components/activity.tsx` — `{activity.items.length}` → single KV302 at build; `.map` on the same path is accepted.
  - Acceptance: `.length` (and array index access) on an array query path type-checks as a binding without an alias. SPEC §4.8/§6.2.
  - Fixed evidence: compiler/server Vitest command above passed; `query-bindings.test.ts` accepts `cart.items.length` and `cart.items.0.productId` against an array query shape.

## Refuted / Not Carried Forward

- **vitest `TS2307 "Cannot find module 'vitest'"` on the fresh scaffold** — observed once on the first base install, but NOT reproducible on clean scaffolds (`pristine` app: plain `tsc` and `vp check` both show 0 vitest errors). The template's `node_modules` is untracked and not copied into scaffolds. A one-time first-install resolution transient, not a template defect. (Example apps use `types:["node","vitest"]` vs the template's `["node"]`, but that does not by itself cause the error under NodeNext module resolution.)
- **t2-3 — "KV438 blocks one-row-per-parent UPSERT on a client-provided key; only escape is a surrogate PK"** — refuted by the verifier: the headline claim is materially false. The session-derived key form (`adminAssign(contactId, reason)`) clears the build and is exactly the intended escape; the author's framing overstated the constraint.
- **One t2 candidate's verifier died** (`StructuredOutput` retry cap) — that candidate is not carried forward for lack of an independent verdict.

## Latest Verification

- `pnpm exec vitest run packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.test.ts --reporter=dot`: passed (A1-A4, C2).
- `pnpm exec vitest run packages/server/src/schema.test.ts packages/compiler/src/query-bindings.test.ts --reporter=dot`: passed (B1-B3, C3).
- `pnpm exec vitest run packages/drizzle/src/index.scope-audits.test.ts --reporter=dot`: passed (C1).
- `pnpm run check:vp`: passed.
- `pnpm run check:api-surface`: passed.

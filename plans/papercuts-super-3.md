# Papercuts Super 3

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five advanced-feature tracks
(pg data depth, schema evolution, multi-user auth/access, the L1→L4 interaction ladder,
and egress/deploy posture), each authored as a real app and adversarially verified.

**Meta-theme:** the postgres path is solid at runtime, but the _static Drizzle read-shape
extractor is sqlite-shaped_ — advanced pg-core column types (enum, jsonb, array) fall
through to mislabeled diagnostics or wrong shapes (§A) — and the _deploy artifact is the
other hot spot_ (§B): the documented non-Docker run path boots dev security posture, the
generated Dockerfile produces a non-booting image, and the default DB is silently ephemeral.

**Security/soundness defects escalated to `plans/bugz-13.md`:** the KV414 write-side IDOR
audit skips the idiomatic `mutation({ handler })` form, and §4.9 update-coverage silently
drops a state/query read aliased through a render-local `const`.

## Scope

- Apps: five fresh `create-kovo` default (postgres/PGlite) scaffolds, link-local to the local
  monorepo, plus a baseline app. Gates run per app: `vp check`, `check:sound-subset`,
  `kovo build`/`build:prod`, `check:endpoint-posture`, `vp test`, and dev + prod HTTP smokes.
- Out of scope: published-npm behavior; the two bugz items (in `bugz-13.md`); UI copy-in/`kovo add`
  (heavily covered by papercuts-8…13). Throwaway apps live under `/Users/mini/kovo-dogfood-2026-06-28/`
  and are safe to delete (do not re-run `pnpm install` in them without isolation).

## Issues

### A. The static Drizzle read-shape extractor is sqlite-shaped (postgres pg-core types)

- [x] **Projecting a `pgEnum` column in a query loader fails `kovo build` with KV406 mislabeled as a write site.** (med, framework; found by `pg-data-depth`)
  - Observed: `status: orders.status` (where `status: orderStatus('status')`, `orderStatus = pgEnum(...)`)
    → `ERROR KV406 … Query projection …status could not be resolved to a Drizzle column or typed sql<T>`.
    The KV406 headline ("write site; manual touches required") is nonsensical for a read projection,
    and the documented `output`+`reads` opaque-projection escape does NOT rescue it (that escape is
    KV410-only; a bare enum projection is KV406-unresolved). Only `sql<string>\`${orders.status}\``
    clears the build.
  - Root cause: in project mode, `schema.ts:1249-1267` `projectColumnBuilderName` resolves the enum
    column's builder via `projectDrizzleCoreIdentifierExportName` (`schema.ts:1512-1529`), which
    returns `undefined` for a _local_ `pgEnum()` factory const (not a drizzle-core export) → column
    dropped at `tableColumnShapes` `schema.ts:668` (`if (shape) shapes[name] = shape`) →
    `unresolvedPaths` → `unresolvedProjectionDiagnostics` emits KV406 reusing the write-site message
    (`query-shapes.ts:2329-2340`; KV406 is concatenated unconditionally at `static.ts:2065`).
    (`columnBuilderBaseShape` 1158-1176 also lacks an enum case, but project mode fails one step
    earlier — so adding an enum case there alone is insufficient.)
  - Why it matters: `pgEnum` is the idiomatic Postgres status/lifecycle type (SPEC §11.1 promises read
    extraction from Drizzle selects); every example app sidesteps it via `text()` + a TS union, hiding
    the gap. The first author to project an enum hits a build-blocker with a diagnostic that points at
    writes/manual touches, not "wrap the enum in `sql<string>`".
  - Repro: `pg-data-depth/src/queries.ts`, change `status: sql<string>\`${orders.status}\``back to`status: orders.status`→`pnpm run build:prod`→`ERROR KV406 queries.ts:80 …order-list-query.status…`.
Verified deterministically via the framework's own `tableColumnShapes(…, 'project')`: the enum
column is dropped while a control `text()`column resolves to`"string"`.
  - Acceptance: project-mode shape extraction resolves a local `pgEnum()` column to a string/enum
    shape (and/or KV406 stops firing for read projections and uses a read-oriented message naming the
    enum/`sql<string>` remedy).
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/drizzle/src/index.query-shapes.test.ts --testNamePattern "pgEnum and text array|s.record" --reporter=dot` proves local `pgEnum()` projections extract as `status: 'string'`.

- [x] **Projecting a `jsonb` column (Drizzle default `unknown`) fails query()'s JSON boundary with a misleading "Property 'args' is missing".** (med, framework; found by `pg-data-depth`)
  - Observed: a query whose result contains a jsonb field typed `unknown` (Drizzle's default) →
    `TS2345 … is not assignable to QueryArgsDeclarationDefinition … Property 'args' is missing`. The
    error blames a missing `args` declaration and never mentions JSON-serializability or jsonb; the
    only clean fix is `.$type<…>()` on the column.
  - Root cause: `json-boundary.ts:8` `JsonSerializable<Value> = unknown extends Value ? JsonValue : …`
    maps an `unknown` field to `JsonValue`, but the gate is `Awaited<Result> extends
JsonSerializable<Awaited<Result>>` and the original `unknown` field is not assignable back to
    `JsonValue`, so both single-arg `query()` overloads (`query.ts:293-305`) are discarded and
    resolution falls through to the args-declaration overload — surfacing "args is missing".
  - Why it matters: jsonb is a first-class advanced column type; the §6.6 JSON honesty boundary fires
    on a perfectly serializable column and reports a wrong, unrelated cause, sending the author chasing
    a phantom overload problem. (The shipped starter dodges it because it never projects jsonb.)
  - Repro: `pg-data-depth` — set the column to bare `jsonb('attributes')` and result field to
    `unknown` → `tsc --noEmit` → the `args` error; a concrete result type reveals the real
    `unknown`-not-assignable cause; `.$type<…>()` clears it.
  - Acceptance: the diagnostic for a non-serializable/`unknown` query result names the offending
    field and the `.$type<>()` remedy rather than "Property 'args' is missing".
  - Fixed evidence (2026-06-29): in-memory TypeScript compile of `query('jsonb-unknown', { load: () => ({ attributes: undefined as unknown }), reads: [] })` now reports `QueryJsonBoundaryErrorUseJsonbTypeOrSRecord` and `__kovoQueryJsonBoundary`, with no `args` diagnostic; `pnpm exec vitest run packages/server/src/query-endpoint.test.ts --testNamePattern "bounds query load results" --reporter=dot` passes the `unknown` result type guard.

- [x] **`text().array()` (text[]) columns are mis-classified as scalar `'string'` by read-shape extraction.** (low, framework; found by `pg-data-depth`)
  - Observed: `text('tags').array().notNull()` is shaped as scalar `'string'`; `.array()` is consulted
    only for nullability, never element-ness, so the §11.1 read-shape disagrees with the real `string[]`.
  - Root cause: `packages/drizzle/src/static/schema.ts:1158-1176` `columnBuilderBaseShape` has no array
    case; the only array-aware branch (`schema.ts:1118-1121`) is gated on the `s` output-schema DSL,
    not Drizzle column builders. No `.array()` column test exists in `packages/drizzle/src/*.test.ts`.
  - Why it matters: §10.5 optimistic derivation and shape checks build on extracted column types; an
    array column typed as a scalar string is a latent soundness gap for any derivation over array
    columns (it did not break the build because a scalar shape is permissive).
  - Acceptance: `.array()` columns extract an array shape; add an array-column extraction test.
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/drizzle/src/index.query-shapes.test.ts --testNamePattern "pgEnum and text array|s.record" --reporter=dot` proves `text().array().notNull()` extracts as `tags: ['string']`.

- [x] **The `s` schema builder cannot express a record/unknown/json shape, so a jsonb column cannot appear in any `input`/`args`/`output`/`error` schema.** (low, framework; found by `pg-data-depth`)
  - Observed: `s` exposes only `array/boolean/file/string/number/secret/object`, and `object` requires
    fixed `Record<string, Schema>` keys. There is no `record`/`unknown`/`json` combinator, so an
    open-keyed jsonb value cannot be declared when a query is forced to carry `output:` (e.g. it also
    has a `sql<T>` projection).
  - Root cause: `packages/server/src/schema.ts:101-211` — the `s` object literal defines only those
    members; `object` is constrained to a statically-known key set.
  - Why it matters: §6.6/§11.1 make `s` the validating constructor for author-declared payloads; jsonb
    cannot be described to the framework's own schema layer (an escape exists — a hand-rolled
    `Schema<T>` cast — but it is non-validating). `s.record()` already appears as an open item in
    `plans/secure-by-construction.md:559`.
  - Acceptance: a validating `s.record(valueSchema)` (open keys, validated values) so jsonb shapes are
    expressible without weakening §6.6 honesty.
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/server/src/schema.test.ts packages/drizzle/src/index.query-shapes.test.ts --reporter=dot` proves `s.record(valueSchema)` validates open-key values, rejects unsafe record keys, preserves async stored-file parsing, and extracts as object-shaped JSON for query output schemas.

### B. The deploy artifact is the other hot spot

- [x] **The documented non-Docker deploy path (`pnpm run serve`/`start` → `node dist/server/server.mjs`) boots DEV security posture without `NODE_ENV=production`.** (med, template; found by `egress-ssrf-deploy`; sharpens baseline)
  - Observed: booting the README/package.json deploy command without `NODE_ENV=production` logs
    `[kovo egress] … outbound-egress floor in development with local private-network destinations
permitted`. In that posture: (1) outbound fetch to RFC1918/loopback is PERMITTED (only cloud
    metadata stays blocked); (2) the CSRF cookie is `kovo_csrf=…; HttpOnly; SameSite=Lax` with no
    `Secure`/`__Host-`; (3) a weak `KOVO_CSRF_SECRET` only WARNs `[WOULD-REFUSE-BOOT-IN-PROD]` and
    boots. `NODE_ENV=production` blocks private egress, sets `__Host-…; Secure`, and refuses to boot.
  - Root cause: `env.ts:105-111` `resolveBootMode()` returns `'production'` only for
    `NODE_ENV==='production'`; `app.ts:174` keys the lenient floor (`allowPrivateNetwork`), `cookies.ts`
    keys `Secure`/`__Host-`, and `env.ts:141-149` keys warn-vs-throw — all on that one env var. The
    generated `dist/server/Dockerfile` (`build.ts:921`) is the ONLY artifact that sets it; the
    template `serve`/`start` scripts and README "Deploying" never mention it.
  - Why it matters: any non-Docker deploy following the framework's own documented commands (VM/systemd/
    PaaS `npm start`) ships a fail-OPEN posture (RFC1918/loopback SSRF reachable, cookie un-host-bound,
    weak signing secret tolerated). The metadata floor (highest-value SSRF target) holds in both modes,
    which caps this at med — but it is a real degradation on the documented path. (The cookie facet
    partially overlaps `bugz-3.md:140` L1, which was cookie-only/low.) `site/.../deployment.md:189`
    lists `NODE_ENV=production` but undersells it (omits the egress consequence).
  - First-hand: contrast confirmed — weak 5-char secret boots+serves 200 without `NODE_ENV`; refuses to
    boot (`CreateAppBootError`) with `NODE_ENV=production`.
  - Acceptance: the emitted prod bundle defaults to production posture when `NODE_ENV` is unset (it is
    only ever a `kovo build` artifact; `vp dev` is the dev path) — or the template `serve`/`start`
    scripts and README set `NODE_ENV=production` and the deployment guide names the egress consequence.
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/create-kovo/src/index.test.ts packages/server/src/build.test.ts --reporter=dot` proves generated `serve`/`start` set `NODE_ENV=production` and README deployment guidance names private-network egress, secure cookies, weak-secret refusal, and `KOVO_DATA_DIR`.

- [x] **The generated `dist/server/Dockerfile` builds a NON-BOOTING image: `COPY . .` ships no node_modules/package.json but the handler externalizes `better-auth`/`drizzle-orm`/`@electric-sql/pglite`.** (med, framework; found by `egress-ssrf-deploy`)
  - Observed: `dist/server` contains only `client/`, `server/handler.mjs`, `server.mjs`, `Dockerfile`
    (no node_modules, no package.json), yet `handler.mjs` opens with bare external imports of
    `better-auth`, `better-auth/adapters/drizzle`, `@electric-sql/pglite`, `drizzle-orm/*`. Running the
    image's runtime (`cp -r dist/server/* /tmp/sim && NODE_ENV=production node server.mjs`) crashes:
    `ERR_MODULE_NOT_FOUND: Cannot find package 'better-auth'`. README.md:51 claims "a self-contained
    server under dist/server".
  - Root cause: `packages/server/src/build.ts:919-927` `nodeDockerfileSource()` hardcodes `COPY . .`
    with no `npm/pnpm install` and copies neither package.json nor node_modules (`build.ts:215-238`);
    the neutral SSR bundle externalizes runtime deps as bare specifiers. `build.test.ts:573-605` only
    asserts the Dockerfile text, never boots the image, so the gate stays green.
  - Why it matters: the Dockerfile is the framework's primary container artifact and the only path that
    sets the secure `NODE_ENV=production` posture (§B/B1); `docker build && docker run` crashes on the
    first import with a green build and a false "self-contained" claim. (`node dist/server/server.mjs`
    from the _installed app dir_ boots only because it resolves the app's node_modules — proving the
    artifact is not portable, which caps this at med.)
  - Acceptance: the node preset emits a package.json+lockfile beside the artifact and a `RUN <pm>
install --prod` step (or bundles externals / ships node_modules), build warns when externalized
    bare specifiers have no shipped install path, and the README "self-contained" claim is corrected.
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/server/src/build.test.ts --testNamePattern "installable Dockerfile" --reporter=dot` proves the node preset emits runtime `package.json`, copies optional lockfiles, and writes a Dockerfile with a production dependency install before `CMD ["node", "server.mjs"]`.

- [x] **The default postgres starter deploys an EPHEMERAL in-memory PGlite DB — every restart/redeploy silently wipes all data, with no persistence seam or warning.** (med, template; found by `egress-ssrf-deploy`)
  - Observed: `src/db.ts` `new PGlite()` has no data directory (in-memory; `new PGlite().dataDir ===
undefined`) and `appDb` is a module singleton. Two separate node processes each show only the 3
    seed rows — no cross-process persistence — so the documented deploy recreates a fresh seeded DB on
    every boot. README pitches "the building blocks a real CRM/ecommerce app needs — a typed database"
    and a full "Deploying" section with no persistence note; `db.ts:5`'s "per request" comment is also
    stale (it is a singleton).
  - Root cause: `packages/create-kovo/templates/src/db.ts:32` `const client = new PGlite();` (no
    `dataDir`/env seam) → `db.ts:40` `export const appDb = createAppDb();`. No `KOVO_DATA_DIR`/
    connection-string hook, no boot warning.
  - Why it matters: a starter the framework actively encourages deploying loses 100% of its data on
    every container restart/redeploy with zero signal; on the serverless presets the README suggests
    uncommenting, process churn can lose data between requests.
  - Acceptance: add a persistence seam (`new PGlite(process.env.KOVO_DATA_DIR ?? …)` or a real
    connection string) and/or a Deploying-section warning that the default PGlite is in-memory and
    non-durable; fix the stale `db.ts:5` "per request" comment.
  - Fixed evidence (2026-06-29): `pnpm exec vitest run packages/create-kovo/src/index.test.ts --testNamePattern "default scaffold dialect|lean script set" --reporter=dot` proves default Postgres scaffolds `new PGlite(process.env.KOVO_DATA_DIR ?? DEFAULT_DATA_DIR)`, idempotent DDL/seed, and README deploy guidance for mounted `KOVO_DATA_DIR`.

### C. The no-op-field / type-level-security-ergonomics contract is applied unevenly

- [ ] **`component()` silently accepts ANY unknown/misspelled definition key (no TS error, no runtime guard) — the no-op-field defect fixed for `query()` (super-1 D2) but left open on the most-used API.** (med, framework; found by `interaction-ladder-live`)
  - Observed: `component({ stat:…, querys:{}, isomorphi:true, disableServerRefres:true, totallyMadeUp:99,
render })` passes `tsc --noEmit` with zero errors and has no runtime validation; the parallel
    `query({ live:true })`→TS2353, `query({ guardd })`→TS2561 are correctly rejected. Misspelling a real
    option silently yields no island state / no query bindings / wrong refresh posture.
  - Root cause: `packages/core/src/index.ts:180-208` — `component()`'s parameter is an intersection type
    (TS suppresses excess-property checks against intersection targets) and the runtime body is just
    `descriptor.definition = definition; return descriptor;` — no analogue of `query()`'s
    `assertKnownQueryDefinitionKeys` (`packages/server/src/query.ts:357,403-428`). The compiler also
    name-looks-up known keys only (`scan/parse.ts:720-745`), silently dropping misspellings.
  - Why it matters: SPEC §9.3 codifies the no-op-field contract and super-1 D2 enforced it for `query()`;
    the same hazard is wide open on `component()`, the most-used app API. Cleanest unambiguous case:
    `disableServerRefres` (typo of the typed, compiler-read `disableServerRefresh`) — real option,
    silently ignored, no error anywhere.
  - Acceptance: add an `assertKnownComponentDefinitionKeys` closed-set runtime guard (and/or a
    closed-shape validating overload) to `component()`, and add `isomorphic` to `ComponentDefinitionInput`
    so the typed surface is complete.

- [ ] **`guards.role()` type-checks against a session schema that declares no `roles`, so an RBAC guard silently always-denies with no compile-time or runtime signal.** (low, framework; found by `auth-access-depth`)
  - Observed: `guards.role<AppRequest>('admin')` compiles cleanly though the starter session
    (`{ id, user:{ id, email, name } }`) has no `roles`; at runtime
    `request.session.user.roles?.includes('admin')` → `undefined` → denies every caller (an authed
    non-admin → 403, the role-guarded mutation → 403 for everyone). Nothing flags the missing §6.5 field.
  - Root cause: `packages/server/src/guards.ts:167-170` (`SessionUserLike.roles?` is optional, so a
    roles-less user structurally satisfies it), `:487` (`role()` constrains only on session presence),
    `:491` (`undefined?.includes` → forbidden).
  - Why it matters: per the project's Type-Level Security Ergonomics rule, a security combinator should
    make the empty/roles-less construction awkward, not silently accept it. (Fail-CLOSED, so not a bugz;
    §6.5 frames the principle around untyped sessions and does not normatively require `role()` to
    demand `roles`, so this is an ergonomic gap vs the project's own design values.)
  - Acceptance: constrain `role()`'s `Request` so `session.user.roles` is required (a missing field
    becomes a compile error), and/or a runtime diagnostic that the session schema lacks `roles`.

- [ ] **`errorShells.forbidden/notFound/serverError` reject a raw HTML string body though the runtime renders it — the type is narrower than the runtime contract.** (low, framework; found by `auth-access-depth`)
  - Observed: `createApp({ errorShells: { forbidden: () => '<main>denied</main>' } })` → `TS2322: …
'() => string' is not assignable to 'ErrorShellRenderer' … 'string' is not assignable to
'RoutePageResponse'`. The JSX form (`() => <main/>`) compiles; the raw-HTML-string form (how the
    starter authors its own shell bodies) does not.
  - Root cause: `packages/server/src/app-types.ts:75-78` `ErrorShellRenderer => RoutePageResponse`
    (an object, `response.ts:99`). `papercuts-14` item B widened the _runtime_
    (`app-document.ts:391-409`) to accept string/JSX/object bodies but the public `ErrorShellRenderer`
    type was never widened to match. (Corrected from the candidate's narrative: route `page()` also
    rejects a bare string, and the runtime forces the framework status, so there is no wrong-status
    risk — this is purely a type-narrower-than-runtime gap.)
  - Why it matters: authors reaching for a branded 403/404/500 shell in the same raw-HTML idiom the
    starter uses hit an opaque TS2322 though the runtime renders it fail-closed. Cross-ref
    `papercuts-14.md:62` (that fixed the runtime; this is the residual type gap).
  - Acceptance: widen `ErrorShellRenderer`'s return to `RoutePageResult | string | RoutePageResponse`
    to match the runtime.

### D. Client-island (L1) authoring ergonomics

- [ ] **`HtmlAttributes` types only `onClick`/`onKeyDown` — `onInput`/`onChange`/`onSubmit`/`onFocus`/`onBlur` are unauthorable, so the SPEC §7 L1 "filter as you type" marquee is a type error.** (med, framework; found by `interaction-ladder-live`)
  - Observed: `<input value={state.query} onInput={…}>` → `TS2322 … Property 'onInput' does not exist
on type 'HtmlAttributes'`. Only `onClick` and `onKeyDown` exist.
  - Root cause: `packages/server/src/jsx-runtime.ts:862-863` declares exactly `onClick?` and `onKeyDown?`
    and no other camelCase `on*` handler. The compiler fully lowers any `on*`
    (`scan/parse.ts:1359-1362`, `lower/handlers.ts:51-99`) — it is purely a TS-type omission. (Hand-
    authoring `on:input` is forbidden lowered IR = KV235.)
  - Why it matters: the L1 marquee (§7) is an input-driven filter; with only `onClick`/`onKeyDown`
    typed, an author cannot type-safely capture typing/selection (`onKeyDown` fires pre-settle, misses
    paste/IME). Same class as `papercuts-8.md:84` (streaming JSX attrs, fixed) but never extended to the
    event-handler family.
  - Acceptance: add `onInput`/`onChange`/`onSubmit`/`onFocus`/`onBlur` (ideally the broader `on*` DOM
    event set, with a typed event param) to `HtmlAttributes`.

- [ ] **Island-handler KV201 mis-fires on global coercion built-ins: `Number()`/`String()`/`Boolean()`/`parseInt()` are treated as "unserializable captures" (`Math.*`/string methods pass).** (med, framework; found by `interaction-ladder-live`)
  - Observed: `onClick={() => { state.n = Number(state.n)+1 }}` → `ERROR KV201 Closure captures
unserializable value`; `Math.min(state.n,5)` and `state.q.trim()` compile fine. The KV201 fix-menu
    (move value into state via ctx / data-p-\* params / module constants) cannot resolve a bare global.
  - Root cause: `packages/compiler/src/lower/handlers.ts:319` — the `allowed` free-identifier set is
    `{Object, Promise, clearTimeout, ctx, event, setTimeout, state, undefined}` ∪ imports/module
    bindings/element-params; it omits `Number`/`String`/`Boolean`/`Array`/`JSON`/`parseInt`/`parseFloat`.
    `Math.*`/`JSON.*` pass only because member accesses are routed through the element-param path
    (`:329,508`) — an accidental side effect. KV201 text (`core/diagnostics.ts:210-224`) never names a
    global built-in.
  - Why it matters: input coercion (`Number(input)`/`String(value)`/`parseInt`) is bread-and-butter for
    L1/L2 island handlers; combined with the missing `onInput`/`onChange` typing (above) and `event:
unknown`, reading a typed value from an island input is effectively un-authorable on the happy path.
    (Over-rejection / fail-closed, so not a bugz.)
  - Acceptance: add the side-effect-free JS global built-ins (`Number`, `String`, `Boolean`, `Array`,
    `JSON`, `Math`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`, …) to the base allowed set; specialize
    the KV201 help when the offending reference is a known global.

### E. Hand-DDL template fragility (PGlite, no migration tool)

- [ ] **A schema/query column absent from the hand-written `db.ts` DDL passes `kovo build` + `vp check`, then 500s only at query execution (PG 42703).** (low, template; found by `pg-schema-evolution`)
  - Observed: adding `archived: boolean(...)` to a table in `schema.ts` and selecting it in a query,
    but not adding it to `SCHEMA_DDL`, builds green; the drift surfaces only at runtime as
    `DrizzleQueryError`/PG 42703 `column … does not exist`.
  - Root cause: the template duplicates the Drizzle schema as opaque DDL string literals
    (`templates/src/db.ts:14-24`, app `src/db.ts`) that `kovo build` never parses or diffs against the
    Drizzle tables; no `kovo check` subcommand introspects DDL (`packages/cli/src/commands-manifest.ts`).
    SPEC §10.1's propagation is type-level (and holds — surfacing the column in the typed result row
    _does_ fail the build); raw DDL text is outside that surface.
  - Why it matters: the starter advertises `pnpm run check` as the deploy gate; a fully-typed query with
    no hand-built row literal can ship green and 500 on the first real request. (Loud at runtime — PG
    42703 names the column — so low; the durable fix is the template, not a framework SQL differ.)
  - Acceptance: derive DDL from the Drizzle tables (or add a drizzle-kit `generate`/`push` migration
    step) so `schema.ts` is the single source of truth.

- [ ] **`void client.exec(...)` DDL/seed construction swallows DDL errors into `unhandledRejection` and surfaces a misleading "relation does not exist".** (low, template; found by `pg-schema-evolution`)
  - Observed: an invalid DDL line does NOT throw at construction; it becomes an unhandled promise
    rejection, and a later query fails with the downstream `relation "<t>" does not exist` rather than
    the true syntax error (which is present in the rejection output / as the error `.cause`).
  - Root cause: `packages/create-kovo/templates/src/db.ts:31-37` fires `void client.exec(SCHEMA_DDL)` /
    `void client.exec(SEED_*)` with no `await`/`.catch`, then `:40` exports `appDb` at module load; the
    broken db object is still exported. The `db.ts` comment reassures about submission _order_ but is
    silent on error handling.
  - Why it matters: a hand-DDL template guarantees authors will make DDL typos; under Node's default
    `unhandledRejection` policy the documented `node dist/server/server.mjs` path can crash, and the
    surfaced "relation does not exist" hides the real syntax error.
  - Acceptance: `await` the execs (or make `createAppDb` async-and-throwing / run DDL synchronously) so
    a bad DDL fails loudly at construction with the real cause.

### F. Expected / known friction (recorded, not filed as a defect)

- [ ] **A new cross-domain JOIN query retroactively requires optimistic coverage on a previously-green, unrelated mutation (KV310).** (low, EXPECTED; found by `pg-schema-evolution`)
  - Adding a `notes INNER JOIN contacts` query made `addContact` fail `KV310 mutations/add-contact ->
queries/notes-query`, because the JOIN puts `contact` in the query's read set at domain granularity
    (`summaries.ts:216`; `app-graph.ts:763-769`), so every `contact` write gains an invalidation edge.
    This is whole-program freshness exhaustiveness working as SPEC §10.6/§11.1 designs (SPEC.md:583
    ships the same `'cart' | 'product'` cross-domain coupling with `'await-fragment'` as the named
    escape). The friction is the lack of join-aware row-key narrowing for read sets, not a defect —
    recorded as a candidate for a future join-narrowing ergonomics study.

## Refuted / Not Carried Forward

Most advanced postgres surfaces verified SOUND (encouraging):

- **Data layer:** `numeric`/`decimal` column shape is coerced correctly (`derive-codegen.ts:198-272`;
  dev smoke confirmed `SUM(numeric)` arithmetic); `db.transaction(...)` static analysis extracts writes
  - invalidations correctly with no spurious KV406; GROUP BY / `count()` / `sql SUM` aggregation read
    extraction produces correct non-empty touch sets; KV422 SQL-sink, KV414 owner-scope, and KV433
    read-only-handle do NOT misfire on enum/numeric/jsonb/array tables; the declared `output` shape is not
    cross-checked against column shapes (so a benign mismatch builds).
- **Schema evolution:** a NEW `kovo({ domain, key })` table is picked up by invalidation with no extra
  wiring; the PGlite fire-and-queue _ordering_ is sound (a query cannot run before DDL/seed completes);
  FK `ON DELETE CASCADE` (DDL + `.references({onDelete:'cascade'})`) works; composite-key type surface
  accepts the array form.
- **Auth/access:** owner-scoped read isolation is sound (`where(eq(ownerId, session.user.id))` emits a
  `scope=session` query audit); KV438 mass-assignment fires on inline single-object handlers
  (provenance=input) — proving the inline handler IS analyzed, which is what makes the KV414 write-side
  gap in `bugz-13.md` B1 a true asymmetry; reauth-on-session-expiry returns `401 + kovo-reauth:
/login?next=…` (not a confusing 422); the route-guard 403 forbidden error shell is FIXED (papercuts-14
  item), not a regression; §6.5 session typing is end-to-end.
- **Interaction ladder:** super-1 D2 query() unknown-key rejection RE-VERIFIED FIXED on postgres
  (`live:true`→TS2353, `guardd`→TS2561); KV310 optimistic coverage fires when the transform is removed;
  L4 Live SSE is honestly marked roadmap in SPEC §9.3 and `live:true` is correctly tsc-blocked (not a
  bug); `refetchOnFocus:false` is a correct typed opt-out; `isomorphic:true` is functional (the only gap
  is the type surface, filed as C above).
- **Egress/deploy:** cloud-metadata (169.254.169.254) is BLOCKED in both dev and prod posture; the
  empty-allowlist production semantics DENY private/loopback/RFC1918 with clear remediation; DNS-rebind/
  TOCTOU is closed by a pinning `dns.lookup`; the egress config surface is exported/typed/documented;
  `vp dev` enforces the floor; prod refuse-to-boot on a too-short secret works; §14 version-skew uses a
  stable framework runtime URL.
- **Refuted candidates:** `ddl-default-silent-divergence` (schema `.default()` vs hand-DDL DEFAULT — the
  realistic typed edit fails the build; EXPECTED); `tsc/tsgo framework-source typecheck divergence`
  (dev-tooling, not reproduced as a starter defect). BASELINE-2 (PGlite-only template still nags
  `better-sqlite3` ignored-build-scripts at install, a transitive drizzle/better-auth peer) reproduced
  but is LOW; recorded here, not expanded.
- **Environmental (not a finding):** `kovo build`/`vp check` were intermittently blocked by an UNRELATED
  in-flight `@kovojs/ui` vendored-source-hash refactor on `main` (progress/skeleton/tabs/toast manifest
  hashes stale vs committed source; the "got" hash even changed between consecutive runs) — concurrent
  development, worked around for the verifications below, not attributable to the postgres template.

## Latest Verification

- Baseline postgres app: `pnpm run check` (vp check + sound-subset + build:prod + endpoint-posture) and
  `pnpm run test` (5/5) GREEN; dev + prod HTTP smokes (sign-in 303, query, per-form-CSRF mutation 303)
  pass on PGlite; dev binds `127.0.0.1` (old `::1` papercut fixed).
- First-hand reproductions of the two escalated bugz items (`bugz-13.md`): KV414 write-side IDOR
  differential (FORM A inline → no KV414, exit 0; FORM B top-level → `ERROR KV414 WRITE … IDOR`) and the
  §4.9 const-aliased coverage drop (`kovo compile component`: const `<p>` no derive/no KV311, inline `<p>`
  derive) both reproduced on the fresh postgres app.
- Monorepo repaired (`pnpm install` at root, no-op; `drizzle-orm`/`@material` resolve); the temporary
  local `@kovojs/ui` hash workaround was reverted; `git status` for this work shows only the new
  `plans/papercuts-super-3.md` and `plans/bugz-13.md` (other working-tree changes are concurrent dev,
  untouched by this run).

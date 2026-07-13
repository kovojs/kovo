# Data Plane (SPEC §10)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 10. Data Plane

### 10.1 Schema as domain registry (Drizzle-blessed path)

```ts
// schema.ts
export const carts = pgTable('carts', { id: text('id').primaryKey() /*…*/ });
export const cartItems = pgTable(
  'cart_items',
  {
    /*…*/
  },
  kovo({ domain: 'cart' }),
);
export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    stock: integer('stock').notNull(),
  },
  kovo({ domain: 'product', key: (t) => t.id }),
); // row-level invalidation key
```

Tables default to a same-named domain; annotations group tables into logical domains and declare key granularity. App-authored `domain()`/`tag()` declarations derive their default stable names from their exported binding plus module path (§4.1); explicit domain annotation strings remain for shared schema vocabulary where several declarations intentionally speak the same invalidation currency. The reverse index (table → domain), the `DomainKey` type, and key extractors are all generated from this single file. An optional `owner:` annotation (`kovo({ domain: 'cart', owner: (t) => t.userId })`) names the column tying a table's rows to a principal — it powers the `--unscoped` audit (§10.3). An optional `governed:` annotation (`kovo({ domain: 'account', governed: [(t) => t.role, (t) => t.balance] })`) names columns that may only be written from a server-derived value — the declare-once mass-assignment fact (the primary `key:` and `owner:` columns are governed automatically); it powers the KV438 write-provenance gate (§10.3). Optional `atomic:`/`version:` annotations (`kovo({ domain: 'product', atomic: (t) => t.stock, version: (t) => t.lockVersion })`) name a contended value column and an optimistic-concurrency counter — the declare-once lost-update facts that power the KV429 TOCTOU gate (§10.3).

A table may opt out of domain mapping with `kovo({ exempt: true })` (silencing KV404 for writes — append-only logs, outbox tables), but **exemption is write-side only**. An exempt table has no domain, so no write can ever invalidate a query reading it; a query whose read set includes an exempt table is therefore error **KV411** — the silent-staleness bug §10.6 exists to kill, reintroduced through the exemption. The teaching error's fix is to map the table after all: for an append-only log this costs nothing — inserts then invalidate exactly the timelines reading it. `exempt` is reserved for tables nothing queries.

### 10.2 Queries

```ts
// cart.queries.ts — session-derived, no client-visible args
export const cartQuery = query({
  load: (db, req) =>
    db
      .select({
        count: count(cartItems.id),
        items: jsonAgg(cartItems),
      })
      .from(carts)
      .leftJoin(cartItems, eq(cartItems.cartId, carts.id))
      .leftJoin(products, eq(products.id, cartItems.productId))
      .where(eq(carts.id, req.session.cartId)),
});

// product.queries.ts — parameterized: args declared once, schema-style
export const productQuery = query({
  args: s.object({ id: s.string() }), // coerced wherever args arrive: props, route params, /_q/ search params (§9.4)
  guard: authed, // optional — checked at page render AND at every typed read / live push
  // guards receive the query's validated args/instance key (§10.3): guard: owns((a) => a.id, products.id)
  load: (db, args, req) =>
    db
      .select({ name: products.name, stock: products.stock })
      .from(products)
      .where(eq(products.id, args.id)),
});
```

Derived from this one expression, statically:

- **Registry key** from the exported binding plus module path (§4.1) — this key is the generated
  `QueryRegistry` identity and the base name for `/_q/<key>`, `<script kovo-query>`,
  `<kovo-query name>`, `kovo-deps`, and explain output.
- **Read set** `{cart, product}` — the JOIN _is_ the declaration (forgetting a joined entity's dependency is unrepresentable).
- **Result type** from the select shape — drives the client JSON, `data-bind` paths, derive inputs, and optimistic transform parameters. Query results are `JsonValue`-bounded client wire payloads; app-authored `query().load` results may use named interfaces and readonly JSON arrays/objects, but they cannot carry `Date`, `Map`, functions, class instances, or other non-JSON values. A column rename in `schema.ts` propagates through TypeScript static checking to every template. **Opaque projections are the read-side raw-SQL seam:** Drizzle's `sql<T>` generic is an unchecked assertion, so any `sql`/raw projection requires a declared `s.*` output schema (**KV410**), and the observed result shape is runtime-verified (§11.2). An opaque projection also hides which tables it reads, so its output schema says nothing about source tables; a KV410 site MUST therefore additionally declare a `reads:` table set — the exhaustive set of tables/relations the raw read touches. The `reads:` set is statically checked against exemption (§10.1): a `reads:` entry naming an `exempt` table is **KV411**, exactly as a statically-visible join would be, so an opaque projection cannot smuggle an exempt/outbox read past the static pass. The declared `reads:` set is folded into the query's read set (§11.1) and drives invalidation; a KV410 projection with no `reads:` declaration is itself a KV410 error. A query whose opaque projection reads a table absent from `reads:` is a CI failure under runtime verification (§11.2). The inferred-type chain stays sound or the seam is visible; never both unsound and silent.
- **Instance key** from the WHERE eq-predicates, resolved to `args.*` or `req.session.*` — only args are client-visible. Canonical encoding: `name:keyValue` in declared arg order (`product:p1`). This one string keys the client store (`<script kovo-query="product:p1">`), `kovo-deps` stamps, `Kovo-Targets` (§9.1), optimistic transform keys (§10.4), and live-push routing. Two instances of one query coexist on a page; `data-bind` inside an island resolves against that island's instance.

**Args bind locally (Constitution #2).** A component declares how its args derive from its own props — `queries: { product: productQuery.args((p) => ({ id: p.productId })) }` — so any page rendering the component satisfies the dependency without call-site knowledge. Route params reach queries as ordinary props through `route().page`; no call site enumerates query dependencies.

**Queries are the UI data contract.** A query-backed component's declared queries must contain the
data needed to render that component. "Skinny" queries maintained only for optimistic derivation
plus separate page/region loaders for presentation are rejected for ordinary app code: they split the
server-truth render path from the statically declared dependency graph and force app authors back
into manual fragment routing. The compiler may derive optimistic transforms, deltas, or §4.8 update
plans for only the fields and query shapes it can prove; unproved presentation fields still travel
through the same declared query and refresh via full server fragments.

#### Default-deny access decisions (normative)

Authorization is **default-deny, by construction**. Every request-reachable surface — a `query`, a
`mutation`, a route `page`, an `endpoint`, or a `webhook` — MUST carry an **explicit access
decision**. A surface's decision is **satisfied** by any one of:

- an **access guard chain** — one or more self-naming executable guards declared in `access:
[guard("name", fn), …]` on the surface (or inherited from a parent `layout`);
- a **public** decision — `access: publicAccess("reason")`, declaring the surface intentionally
  reachable without authentication, with a human-readable justification recorded in the ledger;
- a **verified machine-auth** decision — `access: verifiedAccess`, or (for an `endpoint`/`webhook`)
  an `auth:`/`verify:` scheme that authenticates a machine caller.

A surface with **none** of these is **undecided**: the static app graph classifies it
`decision: 'missing'` and the build fails with **KV436** (§11.3). An existing guard already _counts_
as a decision — guarded surfaces are not forced to re-declare `access`. The decision is recorded as a
static graph fact (`graph.access`) that the build derives from each surface's source-captured
`access` posture; `kovo explain --access` renders the full ledger (every surface, its decision, the
names of the guards that actually execute, and any public justification), and a reviewer audits the
`public` set before ship.

This is **by-construction**: the unsafe state (a request-reachable surface with no access decision)
is unrepresentable in a passing build, proven by the static graph fact rather than a TypeScript brand
(the compiler runs no type checker, §6.6). The audited decision MUST be the enforced decision:
`access` guard names are attached to the executable guard values, runtime dispatch runs those same
guards, and audit-only guard labels are not an accepted access decision. The proof is
**completeness, not correctness**: KV436 proves a decision _exists_, never that it is _right_ — a
no-op `return true` guard satisfies it. Row ownership / IDOR correctness remains KV414's obligation
(§10.3), and `publicAccess` reason strings are greppable, so they MUST NOT carry sensitive
operational detail.

#### SQL statement safety on managed DB handles

Framework-managed DB handles — `req.db`, query loaders, mutation domains, endpoint/webhook request
handles, and blessed-adapter wrappers — treat executable SQL text as a typed surface, not an
arbitrary string channel. The ordinary accepted forms are: Drizzle query builders and native SQL
objects that keep text separate from bound parameters, Kovo tagged-template SQL values (`sql` and
`staticSql`), and the single audited `trustedSql(...)` escape hatch. KV406/KV410 remain the
freshness/read-write proof
diagnostics; **KV422** is distinct and answers how executable SQL text was constructed before it
reached a managed handle.

App-provided driver streaming/cursor values such as node-postgres `Submittable` objects are not an
accepted v1 SQL carrier. Large owner-scoped reads, when needed after v1, must use a
framework-owned SQL-level cursor that reconstructs `DECLARE`/`FETCH` statements through the same
managed carrier boundary rather than blessing a driver-polymorphic app object.

Scalar/runtime values MUST bind as parameters, never by interpolating bytes into SQL text.
Identifiers, operators, sort directions, and clause fragments are not scalar values; they MUST come
from static schema facts or typed allowlists such as `sql.identifier(..., { allow })` /
`sql.allow(...)`, never directly from request strings.

For the static analyzer and explain/audit surfaces, the source set is the request-derived boundary:
`input`, `req.search`, `req.params`, form bodies, headers, and cookies. The sink set is every
framework-managed SQL construction/execution boundary: `db.execute(...)`, `db.query(...)`,
`db.exec(...)`, `db.prepare(...)`, `sql.raw(x)`, `sql.identifier(x)`, and untagged template/string
assembly routed into SQL execution. A request-derived or otherwise unproven value that can become
executable SQL text at one of those sinks is **KV422**.

Non-goals are explicit. Kovo does not sanitize arbitrary SQL strings into safety; it requires
parameterization, a typed allowlist, or an explicit `trustedSql(...)` brand. It does not prove
safety for driver handles captured before the framework wraps them. **Second-order injection is out
of scope**: a value read back from the database and later re-used in another query is governed by
the same `sql\`\``/`trustedSql(...)` discipline at the second query site, not by request-taint
tracking across storage.

### 10.3 Mutations & writes

> **Open design decision:** The domain-write declaration shape in this section is the target
> contract, not the current app-facing root API. `@kovojs/server` does not ship `write()` or `tag()`
> from its root public surface until the same change also ships the static enforcement and generated
> routing that make those declarations authoritative. Until then, authored apps use mutation
> handlers with analyzed Drizzle writes plus explicit `registry.tables`/`registry.touches` on opaque
> write sites.

```ts
// cart.domain.ts — ALL writes flow through here (error KV330 bans db access in handlers)
export const cart = domain({
  addItem: write(async (db, cartId: string, productId: string, qty: number) => {
    await db.insert(cartItems).values({ cartId, productId, qty })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.productId],
                            set: { qty: sql`${cartItems.qty} + ${qty}` } });
    await db.update(products)
      .set({ stock: sql`${products.stock} - ${qty}` })
      .where(eq(products.id, productId));
  }),
  // Statically un-analyzable writes REQUIRE declaration, runtime-verified.
  // Raw-SQL writes MUST enumerate every table they touch via `tables:` — a
  // structurally-parsed allowlist the executor enforces (§11.2); `touches:`
  // names the resulting domains. The executor parses each emitted statement
  // and FAILS CLOSED (conservative whole-domain invalidation of `touches`,
  // plus a CI failure) on any production write to a table outside `tables:`.
  merge: write({ tables: ['cart_items', 'carts'], touches: ['cart'] }, async (db, …) => {
    await db.execute(sql`/* gnarly CTE */`);
  }),
});
```

**No `touches` on `addItem`, no `invalidate()` in handlers.** The static pass (§11) extracts `{cart_items→cart, products→product}` from the AST; calling `cart.addItem` _is_ the invalidation declaration. `invalidate()` survives only as a linted escape hatch for external-system effects (e.g., a Stripe webhook changing data Kovo should refresh).

**`touches`/`tables` declarations on opaque writes are statically required, not best-effort.** A write site whose touch set is not fully statically resolved — an `'unresolved'` runtime-flowing table value (§11.1 step 2.E) or a call into `node_modules` carrying a `db` arg (§11.1 step 3) — is **error KV406** when it lacks a manual `touches`; the dev/build/export gate blocks until one is supplied. A raw-SQL write (`db.execute(sql`…`)` / opaque projection write) MUST additionally declare `tables:` — the exhaustive set of tables the statement mutates — which the runtime executor parses and enforces (§11.2). On a production write to a table outside the declared `tables:`, the executor MUST fail closed: invalidate every domain in `touches` conservatively (whole-domain, ignoring key granularity) so no reader is left silently stale, and record a CI-failing violation; it MUST NOT skip invalidation on the unexpected table. Dev/test instrumentation under-approximates (executed branches only, §11.2), so passing dev/test coverage **does not prove KV406 completeness** — an unexercised conditional raw-SQL arm that writes an undeclared table is exactly the case the `tables:` allowlist and the production fail-closed rule exist to catch, since the dev cross-check never observes it.

For managed Postgres/PGlite, declared write scope has an engine backstop for the dangerous cases. The writer role is not blanket-granted over the schema: owner/owner-via tables receive writer privileges only with RLS `USING`/`WITH CHECK` policies that bind the row to the current principal, and unclassified/reference tables receive no writer grant. `reference: true` is reserved for immutable global lookup rows that contain no tenant membership or owner graph data. Team/org membership is tenant data and MUST be modeled as an owner/ownerVia/authzPolicy table so reads are scoped and request-time create/revoke flows stay behind an explicit policy. Therefore an out-of-declaration write to another principal's row, an ownership reassignment, or an unclassified table such as `verification` is denied by the database. The remaining declared-write wrapper obligation for benign over-declaration among writable owner/authzPolicy tables is coverage and invalidation honesty, not the primary confidentiality/integrity boundary.

**Compiler-bound custom policy authority (normative).** Generated dev/build/export paths MUST bind
each `authzPolicy` into the compiler-owned table-security manifest as an exact discriminated value.
A literal string is an exact guard assertion; a custom engine predicate is accepted only when static
analysis can canonicalize it as zero-parameter literal SQL (currently a no-substitution SQL tagged
template or `sql.raw(<literal>)`). Dynamic or interpolated policy authority is **KV414** and fails
closed.
Runtime boot MUST compare the live Drizzle callback projection with that exact manifest value once,
then derive every RLS/grant/posture sink from the immutable compiler snapshot. It MUST NOT re-read
the callback slot after comparison; callback replacement between validation and asynchronous
policy installation cannot weaken the emitted engine policy (C9/C15, §6.6).

**Engine-door completeness (normative).** Kovo may claim the storage engine is the sole authorization/confidentiality door only when the runtime itself holds no superuser/`BYPASSRLS` authority and cannot assume a privileged provision/admin role, and when a closure audit over the engine's actual grant graph proves that **every** object reachable by the app roles is one of: (i) a base table under `FORCE ROW LEVEL SECURITY` with a live `kovo` policy; (ii) a proven `security_invoker` view/function whose reachable base relations are themselves in that safe set; or (iii) a relation declared through the reviewed public escape, `declarePublicRelation(...)`, and surfaced as a `publicRelation` row in `kovo explain --capabilities`. The audit MUST ask the engine's finest-granularity effective-privilege oracle instead of lossy grant views or direct-grant rows: table and column reachability both count for relations, `PUBLIC` and role membership count for every privilege decision, sequence reachability is audited separately from relation reachability, and `SECURITY DEFINER` routines are scanned across all non-system schemas. Reachable objects that cannot enforce RLS, including materialized views, foreign tables, unsupported relation kinds, non-allowlisted sequences, and reachable `SECURITY DEFINER` routines, MUST fail closed. App roles MUST also hold no unexpected privilege on other ACL-bearing catalog objects or default privileges that would create future reachable objects outside the audited relation/routine/sequence set; such grants are refused rather than ignored. Build-time lints and source enumerations remain defense-in-depth only — never the thing the authorization/confidentiality guarantee rests on.

**Production database driver floor (normative).** In-process PGlite is a dev/test-only,
single-tenant database. Its bootstrap identity is necessarily superuser because PGlite has no
connection-authentication boundary; an app-authored raw `new PGlite(dataDir)` handle therefore sits
outside Kovo's owner-scoping and confidentiality guarantee and is only warned by the
defense-in-depth raw-driver lint. A runtime whose bootstrap-pinned operator environment reports
`NODE_ENV=production` MUST refuse the PGlite driver before opening a listener or serving static or
dynamic traffic. Production requires `KOVO_DATABASE_URL` to select external Postgres, and the
external runtime login MUST pass the non-superuser/`NOBYPASSRLS`/non-admin-membership boot invariant
and the reachable-object closure audit above before the app serves. This relocation preserves
zero-dependency local development without claiming that an in-process superuser can be made into a
production least-privilege identity.

The real authorization boundary is split. **Privilege** belongs to unassumeable Postgres roles such
as `kovo_admin`/`kovo_system`, and those roles may be assumed only inside framework-owned scoped
clients for provisioning, migration, audit, or other system work. App/runtime roles cannot assume
them. **Principal** belongs to the request-scoped GUC that RLS reads, but only the confined app-SQL
statement surface may set it on a per-request scrubbed connection before executing app work. A
`set_config` revoke, routine inventory, or source-level wrapper audit is defense-in-depth: no
authorization code may rest on that revoke alone.

**Capability ownership is framework-owned, not comment-owned.** System/auth DB handles, privileged
role assumptions, raw driver clients, and secret-readable handles MUST have exactly one framework
mint site and MUST cross app-authored or public-package boundaries only as a narrowed, branded
facade with an audited consumer path. Generated app source MUST NOT export a raw system DB,
`AppDb`, provision/admin client, or equivalent ordinary value that app modules can import and route
around the managed read/write chokes. Better Auth and other framework integration code may consume a
module-private or opaque adapter capability, but request-authored code only receives request-scoped
read/write facades whose SQL methods are governed by the source/sink, statement-identity, guard, and
secret-read boundaries in this section and §11.2. Any public use of such a privileged facade MUST
appear in `kovo explain --capabilities` with its reason and consumer surface.

**C9 — boundary-crossing doors are reconstructed, boxed, or framework-owned (normative).** Any
value crossing a security-relevant boundary in Kovo MUST do so through exactly one of three
mechanisms:

1. **Reconstructed carrier** — the framework snapshots or rebuilds the boundary value from
   normalized facts before the sink sees it, so caller-owned mutable carriers cannot change meaning
   between validation and execution.
2. **Boxed value** — the framework keeps the runtime value inside a non-coercible box until an
   explicit reveal/redaction path discharges the sink.
3. **Framework-owned door** — the only way across the boundary is a typed or branded framework
   channel whose implementation owns grammar, normalization, and fail-closed rejection.

Two corollaries are mandatory:

- **Complete engine-door enumeration.** Where Kovo claims the engine is the authorization or
  confidentiality door, the complete boundary-crossing set is the engine's effective privilege graph
  itself (§10.3 engine-door completeness), not a source scan, proxy wrapper, or comment inventory.
- **Secrets leave only boxed or owned sinks.** A secret, governed, or principal-bearing value MUST
  never rely on a read-only proxy or a best-effort caller convention at egress. It crosses only via
  a runtime box, a reconstructed carrier, or a framework-owned sink that is named in the proof
  inventory and hostile-value tests.

**C10 — security sets are closures or allowlists, never subsets or denylists (normative).** Any set
used for an authorization, confidentiality, or privileged-execution decision MUST be computed from
the boundary relation it represents: a reachability set is the complete closure over the relevant
engine edges, and a property set is an allowlist of the minimal safe members. The write-reachability
audit closes directly writable relations over structural write-propagation edges: FK referential
actions, partition/inheritance routing, and rewrite-rule redirects that can route app-role writes.
The runtime identity audit checks the runtime login plus the complete `pg_has_role(..., MEMBER)`
assumable-role closure against **two** allowlists that jointly range the complete escalation surface,
which is role ATTRIBUTES ∪ predefined-role MEMBERSHIP: (i) the classified role-attribute allowlist —
`rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreaterole`, and `rolcreatedb` MUST be false, while
benign role metadata is classified explicitly and future unclassified `pg_roles` role-attribute
columns fail closed; and (ii) an allowlist over PostgreSQL predefined-role membership — the login and
every assumable role may be a member of only the framework's own roles plus an explicit benign
don't-care set, so membership in any `pg_*` predefined role outside that allowlist (e.g.
`pg_execute_server_program` ⇒ `COPY … FROM PROGRAM` OS command execution,
`pg_read_all_data`/`pg_write_all_data`, `pg_read_server_files`/`pg_write_server_files`, `pg_monitor`,
`pg_maintain`) is refused and named. The predefined-role allowlist is required because predefined
roles carry NONE of the five elevated role attributes and would otherwise pass the attribute
allowlist unflagged; predefined roles are detected by the reserved `pg_` name prefix and the
< `FirstNormalObjectId` (16384) system-OID range and surfaced through the same `MEMBER` closure. As
an allowlist (member-of-only-known-safe, not a denylist of known-bad roles), a new `pg_*` predefined
role in a future PostgreSQL release fails closed by default. The SECURITY DEFINER routine and
attached-code audits use that same login-plus-assumable identity set for execution reachability. The auth non-egress proof enumerates the request-reachable
secret-handling surface and boxes or confines each path; it MUST NOT use a named file as a proxy for
that surface, and its plaintext-API confinement enumerates every request-reachable `auth.api.*`
plaintext-reading endpoint so a new or unclassified endpoint used outside the trusted module fails
closed rather than sliding through a fixed subset regex. The Better Auth plugin secret classifier
follows the same rule in the confidentiality direction: a credential-shaped plugin column — one
whose final name segment is a credential noun (`key`, `token`, `secret`, `password`, `hash`, …) —
defaults to `secret:` unless the author explicitly annotates it non-secret, so the apiKey plugin's
`key` column and custom credential additional fields fail closed to secret rather than being emitted
as ordinary readable columns.

The canonical C9 sink inventory is:

| Sink                  | Mechanism            | Sole door                                                                  | Proof inventory / hostile-value evidence                                                                                            |
| --------------------- | -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| DB driver statement   | reconstruct          | Managed SQL snapshots the statement carrier before validation/execution.   | `packages/server/src/managed-db.test.ts`; §11.2 immutable-statement rule.                                                           |
| HTTP response body    | reconstruct          | `emitToWire`/wire render helpers rebuild fragment/query/error bodies.      | `packages/server/src/wire-html.test.ts`; `packages/create-kovo/src/index.build.prod-artifact.security.test.ts`.                     |
| HTTP response headers | framework-owned door | Finalized typed header channel owns names, repetition, and control chars.  | `packages/server/src/response-posture.test.ts`; `packages/create-kovo/src/index.build.prod-artifact.headers.test.ts`.               |
| Redirect URL          | reconstruct          | Redirect targets are normalized back to same-origin path form.             | `packages/server/src/response-posture.test.ts`; `packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts`.   |
| `Set-Cookie`          | framework-owned door | Typed cookie builder/serializer owns value encoding and attributes.        | `packages/server/src/cookies.test.ts`; `packages/create-kovo/src/index.build.prod-artifact.headers.test.ts`.                        |
| Blob/file write       | framework-owned door | Storage/static-export writers own key/path containment.                    | `packages/core/src/storage.test.ts`; `packages/server/src/static-export-output.test.ts`.                                            |
| Durable-task payload  | framework-owned door | Queue envelope and observability views own serialization/redaction.        | `packages/server/src/task-observability.test.ts`; `packages/server/src/task-runner.test.ts`.                                        |
| Webhook payload       | framework-owned door | Verifier-before-parse plus replay-scoped dispatch owns raw bytes.          | `packages/server/src/webhook.test.ts`; `tests/integration/specs/webhook-hmac.spec.ts`.                                              |
| HTML/render output    | reconstruct          | Escaped render pipeline or explicit trusted output escape.                 | `packages/browser/src/security-output.test.ts`; `packages/create-kovo/src/index.build.prod-artifact.security.test.ts`.              |
| Log/error output      | box                  | Secret/redacted boxes refuse coercion before logs or wire-visible errors.  | `packages/core/src/secret.test.ts`; `packages/server/src/task-observability.test.ts`; `packages/server/src/query-endpoint.test.ts`. |
| Outbound egress       | framework-owned door | Framework egress allowlist choke owns network targets on privileged paths. | `packages/server/src/task-runner.test.ts`.                                                                                          |

**External Postgres role topology is a manifest, not environment inference.** The runtime config
MUST resolve reader, writer, admin, and system roles into one topology that records whether Kovo
creates or adopts each role, the runtime login, and required runtime-login membership edges. The
same topology facts drive provision, posture check, production boot, and `kovo db` output. Adopting
pre-created roles does not relax verification: provision/check/boot MUST verify required role
existence and runtime membership edges, fail before partial DDL when a required adopted role is
missing, and refuse configurations where the ordinary runtime login can assume privileged
admin/system roles outside framework-owned scoped clients. The runtime login and every role it can
assume through the `MEMBER` closure MUST have only the classified minimal-safe role attributes AND
must be a member of only framework-owned roles plus an explicit benign don't-care set; unknown
role-attribute columns and non-allowlisted `pg_*` predefined-role memberships (C10/C11) both fail
closed until classified.

**C15 — classify-and-pin or reconstruct after runtime classification (normative).** When a
security-relevant sink accepts a caller-owned carrier whose bytes or object identity can still
change after runtime validation/classification, the framework MUST do one of the following before
the sink executes:

1. **Pin** the exact accepted value into an immutable framework-owned carrier that the sink then
   consumes without re-reading the caller-owned source; or
2. **Reconstruct/fix** the sink value from normalized facts, discarding the caller-owned carrier and
   failing closed to a fixed fallback when normalization does not bless the value.

Re-reading or re-stringifying the mutable caller-owned carrier at the sink after an earlier
classification decision is forbidden. A sink may be recorded as **N/A** only when the sink is
already framework-owned and structural from construction time, so no caller-owned carrier survives
to the decision point. The required audit inventory for this rule includes at least the egress
resolved-IP floor, redirect `Location`, managed SQL statement carriers, `sql.identifier(...)`, and
header/cookie serialization; each row must be classified as `pinned`, `fixed`, or `N-A` with
hostile-value evidence.

The closure audit is side-effect-inclusive. Attached code is reachable when the app role can reach
it by direct `EXECUTE`, DML trigger, rewrite rule, `CHECK`/domain constraint function,
default/generated expression function, or index/predicate expression function, including structural
write propagation through FK referential actions, partition/inheritance routing, and rewrite-rule
redirects. Each such attached code path MUST resolve to the same safe object set above or fail
closed.

**Request lifecycle (normative):**

```
(pre-dispatch shell: max-body-size → 413 · coarse per-IP/global rate → 429 — §9.5)
CSRF validation → replay reservation by (principal, derived mutation identity, idem-token) → parse+coerce input (schema)
→ guard chain → BEGIN tx → handler (receives a transaction-scoped db whose public type hides raw transaction openers)
→ COMMIT (settle reservation, store response) → re-run invalidated queries (post-commit, same request context)
→ render <kovo-query>/<kovo-fragment> → respond
                    ⇘ on fail(): ROLLBACK → typed error fragment, 422
```

This ordering closes the read-your-writes hazard: responses can never render pre-commit data (which would visibly revert the user's optimistic update). A replay hit does not bypass authorization: the runtime MUST re-evaluate the session-bound guard chain against the **current** principal before re-serving a stored response, so a replay never re-serves a private response after the principal's authorization changed (role revoked, ownership lost). The replay store is keyed on (principal ∧ source-derived mutation identity ∧ idem-token), so a replay can only ever return to the same principal that produced it.

The handler `request.db` type is a defense-in-depth authoring guardrail, not the security proof:
it preserves the configured DB provider's read/write surface while hiding public transaction
openers such as `.transaction()`, so nested transaction/open-handle misuse is a TypeScript error
on the normal `createApp({ mutations })` path. TypeScript cannot prove arbitrary object lifetime
or reject every closure/module-scope capture of a handler parameter; runtime transaction ownership,
rollback-on-throw, SQL provenance gates, and fail-closed sinks remain authoritative. External I/O
inside a mutation handler is not a mutation-specific type or KV-gate error; it is governed by the
uniform outbound-egress floor (§6.6). Durable tasks (§9.6) are the framework primitive for
retryable/idempotent after-commit effects, not the only syntactically legal place to call `fetch`.

**Replay is an atomic reservation, not a lookup (normative).** The replay step MUST atomically claim the `(principal, source-derived mutation identity, idem-token)` triple before the guard chain — an `INSERT … ON CONFLICT` against the replay store (or an equivalent unique-key claim) inside the same serialization boundary that the commit settles. A submit that wins the claim proceeds; a concurrent or sequential submit carrying the same triple MUST block on the in-flight reservation and then replay the settled response, never re-execute the handler. This holds for **all** mutation paths — the enhanced and no-JS `mutation()` lifecycle, `webhook()` (§9.1, keyed by provider event id), and the streaming path — so concurrency, not merely strictly-sequential retries, is deduplicated. The store is scoped to the current principal (a different `req.session` identity never replays a prior principal's response) and to the specific mutation, so an idem-token reused across mutations cannot cross-replay.

**Idem-token minting and entropy (normative).** `Kovo-Idem` is a per-submit token, not a per-form constant. The client MUST mint a fresh high-entropy token (≥ 128 bits from a cryptographic source) for each logical submit and place it in the stamped hidden field; the enhanced success response MUST refresh the hidden field with a new token so an immediate re-submit of the same form instance carries a different token and is treated as a new logical mutation rather than replaying the first response. Because the replay step precedes input parsing, the token MUST NOT be derived from input. A re-submit that edits visible fields therefore produces a distinct token — eliminating the silent lost-update where an unchanged hidden field replayed the first commit. Token collision within `(principal, source-derived mutation identity)` is a server-detectable integrity fault answered as a 422 schema-class failure (§9.2), never a silent replay of an unrelated commit.

**Guards (arg-aware, normative).** A guard is a refinement run before `page`/`load`/`handler`. Beyond `req.session`, every guard receives the query's or mutation's **validated args / resolved instance key** — the same `s.*`-coerced values the loader and handler see (§9.4, §10.2). A guard may therefore express ownership over a client-visible key, not only session-wide roles. Guards run after schema parse/coerce so the args they inspect are already validated (§10.3 lifecycle).

**`owns()` ownership combinator.** `owns((args) => args.id, table.ownerColumn)` is the sanctioned ownership guard: it passes only when the principal (`req.session`, the column declared by the table's `owner:` annotation, §10.1) owns the row the key selects. `owns()` is composable with the other combinators (`all(authed, owns(...))`) and discharges the KV414 IDOR obligation for the key it covers. The shipped runtime contract is `guards.owns(keyOf, ownsRow)` where `ownsRow(req, key)` is an app-provided ownership predicate (so `@kovojs/server` stays decoupled from the data layer); the `table.ownerColumn` column-form above is the planned compile-time sugar that lowers to it.

```ts
export const adminRefund = mutation({ guard: role('admin') /*…*/ });
export const orderQuery = query({
  args: s.object({ id: s.string() }),
  guard: all(
    authed,
    owns((a) => a.id, orders.id),
  ), // args.id ownership — discharges KV414
  load: (db, args) => db.select().from(orders).where(eq(orders.id, args.id)),
});
// composable: guard: all(authed, rateLimit({ per: 'session', max: 10 }))
// rateLimit also admits per: 'ip' and a global dimension; a coarse per-IP/global
// body-size + rate limiter runs PRE-DISPATCH (413/429) ahead of replay+parse (§9.5)
// static audit: `kovo explain --unguarded` lists every mutation, route, and query reachable without `authed`
// static audit: `kovo explain --unscoped` lists every query/write touching an owner-annotated
// table (§10.1) whose key predicate is not traceable to req.session and not authorized by an
// ownership guard — the IDOR audit; the §11.1 predicate extractor does the tracing
```

**KV414 — IDOR audit is a blocking gate, not advisory.** A query or write whose key predicate touches an `owner:`-annotated table (§10.1) MUST resolve that key to either `req.session.*` or an `owns()`-class ownership guard. A site that reaches an owner-table row through a client-visible `args.*` key with neither is **KV414** (`error`) — runtime-verified by the §11.2 cross-check against the executed read/write predicates and the §11.1 predicate extractor's session-traceability result, so a smuggled or branch-hidden arg-keyed owner read fails CI as loudly as silent staleness (KV407/KV411). The `--unscoped` audit prints the same set; KV414 is its enforced form. A genuinely public read suppresses KV414 only with a recorded justification at the site, which `kovo explain --unscoped` surfaces verbatim.

**KV429 — single-row lost-update is by-construction for declared contended columns.** A column declared `kovo({ atomic })` (a contended value column) or `kovo({ version })` (an optimistic-concurrency counter) signals that its single-row read-modify-write MUST fold the check and the act into one statement. A self-referential write to an `atomic` column — `set({ stock: stock - qty })`, lowered to a §10.5 SymbolicValue arithmetic over a self-`col` reference — whose `where()` carries NO eq-predicate on that atomic column (a compare-and-set guard) NOR on a declared `version` column is **KV429** (`error`): a lost-update race where two concurrent read-decide-write requests survive auth and validation and overwrite each other (oversell, double-spend, coupon reuse). The fix is a CAS predicate (`where(and(eq(t.id, id), eq(t.stock, prevStock)))`) or a carried row version, with a typed 409/422 on a stale write; a DB `CHECK`/unique constraint is the fail-closed backstop. **Honest ceiling (single-row only):** a write whose `where()` is opaque (range/`IN`/no key) or multi-row is NOT flagged — multi-row/aggregate invariants need `forUpdate`/`SERIALIZABLE` + retry and are **not** by-construction (the mutation transaction's READ COMMITTED alone does not prevent lost-update). The cross-function check-then-act is a false-negative floor until the interprocedural write-summaries land.

**KV433 — a read-surface that writes is a confused deputy.** A `query({ load })` loader is a read surface; reaching a Drizzle write (insert/update/delete/execute/run/batch) from it is a state change on an idempotent GET. A loader whose body directly reaches such a write is **KV433** (`error`) — the static no-write-reachable proof (Stage 2). There is no public GET-write query escape: move user-triggered state changes to `mutation()`/domain writes, and move explicitly side-effecting machine/API paths to `endpoint()`. **Current scope:** Stage 1 is shipped where Kovo owns the handle: the managed loader `db` is a read-only proxy whose write verbs throw at runtime, and its `Reader<Db>` type mirror makes those verbs a `tsc` error. That proxy is defense-in-depth, not the proof (§6.6). Stage 2's broader interprocedural case (a loader calling an imported `domain()` function that writes through some captured handle) still needs the bottom-up write-summaries that are not yet built and remains documented residue; today's direct static check covers writes directly reachable in the loader body and treats legacy/demoted query-write spellings as read-surface writes, never as escapes.

**KV438 — mass-assignment is by-construction write-provenance.** Where KV414 governs _which row_ a write touches, KV438 governs _which value_ reaches a **governed column**. A column is governed when it is the table's primary `key:`, its principal `owner:` column (both AUTO-governed), or is named in the `kovo({ governed })` annotation (the declare-once fact for `role`/`balance`/`isAdmin`-class columns, Constitution #2 — no call-site allowlists). A write that lands **request input** on a governed column — directly, through an alias/destructure, or via a `.values(input)` / `{ ...input }` spread — is **KV438** (`error`). The gate is **fail-closed**: a value the static analyzer cannot prove server-derived, literal, or explicitly-asserted is rejected on a governed column (over the §11.1 AST symbol-identity provenance engine, never a branded type or runtime taint, §6.6). This is stronger than Rails `strong_parameters` / Django serializer denylists because it is schema-anchored and provenance-checked rather than an enumerated allowlist. Two author-assertion escapes (SPEC §6.6: audit-grade, not proofs) route the residue: `serverValue(value, reason)` discharges a value proven _not_ to be request input (`serverValue(input.x,…)` still fails), and the louder `trustedAssign(input.x, reason)` is the audited path for a deliberate privileged write (a legit admin role grant), surfaced in `kovo explain --writes`. A same-package helper computing a server value (e.g. `resolveOwner()`) discharges the gate by declaring `kovoAnalyzerSummary(fn, { returns: { kind: 'server' } })` rather than reflexively wrapping its result. **Ceiling:** by-construction write-provenance for statically-analyzable Drizzle writes; the escapes are author assertions; a write whose value flows through an unsummarized cross-module helper fails closed (an explicit annotation, not a silent pass).

### 10.4 Optimistic updates

Optimism is keyed to **queries** (the data), never islands. One transform per (mutation × invalidated query); every island consuming the query updates from it — including islands written after the mutation (Constitution #2).

**Hand-written:** transforms are authored in the mutation file as pure `(data, input)` functions against the query's inferred result type. **Explicitly deferred:** `'await-fragment'` documents "considered; 1-RTT latency accepted here."

**Derived:** for writes whose dataflow is closed over `{mutation input, schema constants, data the query already ships}` and queries within the shape grammar `{scalar-from-keyed-row, COUNT, SUM(arith), jsonAgg, filtered-COUNT, membership transitions}`, the compiler generates the transform (full derivation algebra in §10.5). Hand-written transforms share the same IR, so an app can override generated transforms pair by pair.

```ts
// emitted optimistic/cart.add.ts — DO NOT EDIT (override in cart.mutations.ts)
export const derived = {
  [cartQuery.key]: (cart, $input) => {
    const r = cart.items.find((i) => i.productId === $input.productId);
    if (!r) cart.count += 1;
    if (r) r.qty += $input.quantity;
    else cart.items.push({ productId: $input.productId, qty: $input.quantity, pending: true });
  },
  [productQuery.key(($i) => ({ id: $i.productId }))]: (p, $input) => {
    p.stock -= $input.quantity;
  },
} satisfies OptimisticFor<typeof addToCart>;
```

**Runtime protocol:** snapshot the affected query values → apply transforms to the shared query values and run their update plans (all dependent islands update at once; affected islands get `kovo-pending` + `aria-busy` automatically) → on success, `<kovo-query>`/morph reconciles over the prediction (right guess ⇒ near-no-op; wrong guess ⇒ silent correction) → on error, restore snapshots, render error fragment.

**Bounded snapshot (normative).** The snapshot MUST cover only the change-record-touched subset of each affected query value — the keyed rows, scalar fields, and aggregate inputs a transform can mutate — under structural sharing (copy-on-write of the touched path), not an unconditional deep `structuredClone` of the whole value. The `JsonValue` constraint bounds serializability, not size; cloning a large dataset per mutation or per rebase is forbidden. A transform may mutate only within its declared touch scope, so an untouched subtree is retained by reference and restored by reference on rollback.

Successful enhanced mutation responses should include `<kovo-query>` chunks for every invalidated query instance the server can derive and rerun in the request (§10.3). When server truth for an optimistic transform is missing, the client MUST emit a visible runtime diagnostic (**KV313**) and **discard** the prediction — roll the affected query back to its pre-transform snapshot (§10.4 bounded snapshot) or force a `/_q/<key>` refetch (§9.4) — never freeze the unconfirmed prediction on screen as authoritative-looking data. "Settle" here means "discard the transform and reconcile against server truth," not "promote the prediction." This is a development escape valve for explicitly fragment-only or temporarily uncovered responses: KV310 exhaustiveness (§10.6) makes a covered mutation that ships no truth for an invalidated query a build failure, so a missing-truth discard never reaches a production end user as the steady-state contract.

**Concurrency:** a per-query pending-transform log keyed by `Kovo-Idem` token (§9.1). On each arriving server-truth chunk the runtime first **settles** the log: it drops every pending transform whose token is in the chunk's settlement set (§9.1.1) — those commits are already reflected in the arriving truth — then morphs the truth in, then re-applies **only the not-yet-committed** transforms in log order (rebase). Purity gives determinism but not idempotency, so settlement-before-rebase is mandatory: re-applying an already-committed additive transform would double-count the write. A transform whose token is absent from every truth chunk remains pending until its own response settles it. The settlement-matching rule is exact token-set membership; a truth chunk that carries no settlement set is treated as settling its triggering mutation's token only.

**Named FIFO queues (`queue: 'cart'`, normative).** A queue serializes the mutations declaring the same conceptual group name. Queue names are not mutation registry identities and are intentionally allowed to span declarations (§4.1). Its semantics are pinned so two conforming implementations cannot diverge between "frozen cart" and "dropped actions":

- **Transform-apply timing.** A queued mutation applies its optimistic transform on **enqueue** (immediately, against the current optimistic value including earlier queued-but-unsent transforms), not on dequeue — so the UI reflects the full queued intent without waiting for the head to drain. Its network request is sent only when it reaches the head.
- **Head-of-line timeout/abort.** The in-flight head MUST carry a bounded timeout; on timeout or transport error the head is aborted, its transform is rolled back via its bounded snapshot, an error fragment is rendered, and the queue advances to the next entry. A hung head MUST NOT block the tail indefinitely.
- **Failed/hung-head drain.** When the head fails or times out, the tail is **not** silently dropped: each surviving entry is re-validated against the rolled-back optimistic value and either advances or is discarded with a visible KV313 diagnostic; ordering among survivors is preserved.
- **Queued-but-unsent fate on navigation.** Entries already in flight complete via `keepalive`; entries still queued-unsent at navigation are abandoned with the document (their optimistic transforms die with the log), exactly as for un-queued in-flight work — navigation is a reconciliation point, not a delivery guarantee.
- **Queue bound.** Each named queue has a bounded depth; enqueue past the bound is refused with a visible diagnostic rather than growing without limit.

Navigation is a free reconciliation point: in-flight requests complete via `keepalive`, the log dies with the document.

### 10.5 Derivation algebra

The compiler may derive an optimistic transform only when the write can be reduced to symbolic
row-effects over mutation input, schema constants, and columns already present in the affected query,
and the query shape fits the grammar named in §10.4. The derivation is all-or-nothing per affected
field: an opaque server computation, non-key match, unsupported aggregation/windowing shape,
interprocedural opacity, or untraceable parameter punts that field to `await-fragment` or a
hand-written transform. Every punt is named in `kovo explain --optimistic` with the exact expression
and reason.

**Soundness is property-tested:** for derivable pairs, generated-state tests assert
`patch(clientShape(s), i) ≡ clientShape(apply(effect, s, i))` — the commuting diagram is the
deriver's test suite. The expanded derivation grammar and examples live in
`site/content/guides/optimistic.md`.

### 10.6 Exhaustiveness

Per mutation, coverage = invalidated-query set (derived) × status. Valid statuses are `derived`, `hand-written`, and `await-fragment`:

```
kovo check optimistic
mutation cart/applyCoupon:
  cartQuery.items      hand-written ✓
  cartQuery.subtotal   hand-written ✓
  cartQuery.discount   UNHANDLED ⚠ KV310
     → hand-write in cart.mutations.ts, or declare 'await-fragment'
```

Punts report their reasons inline (e.g. `PUNTED (Opaque: compute_discount)`).

The check runs at two altitudes off the same derived set: the compiler emits each mutation's invalidated-query keys into the registries (§6.1 `InvalidationSets`), so `OptimisticFor<typeof addToCart>` requires an entry — transform or `'await-fragment'` — per invalidated query, making KV310 an editor-visible type error; `kovo check` remains the CI/agent surface.

Forgetting an optimistic update is a visible, suppressible diagnostic with the suppression recorded in source — never a silent UI inconsistency.

---

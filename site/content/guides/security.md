---
title: Security & authorization
description: Protect routes and actions, keep secrets off the wire, scope writes, and review the security graph without a browser.
order: 2.5
---

# Security & authorization

You have an `/admin/orders` page and a `refund/order` action. Only staff should open the page, only
admins should submit the refund, and every review should show that no secret field, unsafe write, or
capability URL slipped onto the public surface. This guide starts with that job: guard the route,
guard the action, then use `kovo explain` to inspect the rest of the security graph.

One explicit honesty line up front: Kovo does **not** claim prompt-injection immunity. If an app
hands adversarial text to a model or lets a model choose tools, OWASP LLM01-class failures are still
possible. Kovo's claim is narrower: default-deny guards, the outbound-egress floor, structured
HTML/URL/SQL sinks, and future capability-bounded tool adapters can reduce the consequence of a bad
model decision, but they do not make prompt-driven apps safe by construction.

## Guard the route and action

A guard is a function from a request to `true` or a denial. The same `guards` combinators apply to
mutations, routes, and queries, so authorization is one vocabulary across the app.

```ts
import { guards, mutation, route } from '@kovojs/server';

export const adminPage = route('/admin', {
  guard: guards.role<AdminRequest>('admin'),
  page: () => <AdminDashboard />,
});

export const refundOrder = mutation('refund/order', {
  guard: guards.all(guards.role('admin'), guards.rateLimit({ max: 20, per: 'ip' })),
  // …
});
```

The combinators (verified against `@kovojs/server`'s `guards`):

- **`guards.authed()`** — passes when `request.session?.user` is present; refines the request type so
  `req.session.user` is non-null inside the handler. A `null`/`undefined` session means anonymous and
  is treated as unauthenticated, never as a malformed request.
- **`guards.role(role)`** — fails unauthenticated callers as unauthenticated, and authenticated-but-
  wrong-role callers as unauthorized (403), checking `req.session.user.roles`.
- **`guards.rateLimit({ max, per, windowMs? })`** — `per: 'ip' | 'session' | 'global'`, with a keyed
  variant for per-tenant limits. `per: 'ip'` keys from `req.clientIp`, the normalized client address
  Kovo exposes from the request shell. Use it for anonymous forms and machine ingress where there is
  no stable session yet. `per: 'session'` is only as strong as the anonymous session binding before
  login; do not treat it as a per-person throttle until the session is authenticated.
- **`guards.all(...guards)`** — composes left to right and propagates the first denial as-is, so the
  status mapping stays intact.

Guard outcomes are fixed so auth stays part of the typed surface. Route/query `authed` failures run
the app's `onUnauthenticated` handler; authenticated-but-unauthorized failures render the 403 shell.
Mutation guard failures split the same way: expired sessions get the reauth path, while valid sessions
that lack permission get a typed form failure. See [mutations](/guides/mutations/) for the form
failure paths.

## A practical security checklist

1. **Type the session** with `session(s.object(...))`; guards and query keys depend on it.
2. **Resolve it once** with a `sessionProvider`; treat `null` as anonymous.
3. **Guard from the bottom up**: `authed` on per-user reads, `role` on admin surfaces, `rateLimit` on
   actions, `guards.all(...)` to compose.
4. **Annotate `owner:`** on every per-user table and scope predicates to `req.session`, never to
   client input.
5. **Classify confidential columns** with `secret`; reveal only reviewed fields with
   `trustedReveal(...)`, then inspect `kovo explain --revealed`.
6. **Govern server-owned columns** with `governed`; write them through `serverValue(...)` or
   `adminAssign(...)`, never from request input.
7. **Leave CSRF on**; justify every `csrf: false` and confirm it in `kovo explain --endpoints`.
8. **Use capability URLs for downloads**: mint with `ctx.signUrl(...)`, serve through
   `createStorageDownloadEndpoint`, and review `kovo explain --capabilities`.
9. **Run the security review modes in CI** next to `kovo check`: `--unguarded`, `--unscoped`,
   `--endpoints`, `--revealed`, `--trust`, `--access`, `--capabilities`, `--cookies`, and
   `--sources-sinks`.
10. **Review every escape hatch** in the source/sink table before merging raw protocol code.

## Type your session

`req.session` is a declared `s.object` schema, not an `any` bag — and that's structural, not a
nicety. Query instance keys (`product:p1`) and guard refinements (`authed` making `req.session.user`
non-null) are load-bearing on session fields, so an untyped session would be a hole directly under the
proof surface:

```ts
import { s, session } from '@kovojs/server';

export const commerceSession = session(
  s.object({
    id: s.string(),
    user: s.object({
      id: s.string(),
      roles: s.array(s.string()),
    }),
  }),
);
```

## Resolve the session with a provider

Session provenance is an application capability, not a framework-owned identity system. The app
declares a `sessionProvider` in the request shell; Kovo runs it once per request, before any route,
query, or mutation guard, and exposes the result as `req.session`. The provider's return type must be
assignable to the session schema under static checking; browser input still crosses the runtime
validators:

```ts
// the provider adapts your auth library to the declared session shape
export const commerceSessionProvider = commerceSession.provider(
  betterAuthSession(commerceBetterAuth, ({ session: authSession, user }) => ({
    id: authSession.id,
    user: { id: user.id, roles: user.roles },
  })),
);

// wired into the request shell alongside routes, mutations, and the db provider
createApp({
  sessionProvider: commerceSessionProvider,
  // routes, mutations, queries, csrf, db, …
});
```

A provider that returns `null`/`undefined` is anonymous, and `guards.authed()` rejects it as
unauthenticated.

## Authorization: the `owner:` / IDOR model

Authentication asks "who are you?"; authorization asks "may you touch _this row_?" The second is where
IDOR (insecure direct object reference) bugs live — a query or write scoped to a user id that comes
from request input instead of the session. Kovo makes that statically visible.

Annotate the column that ties a table's rows to a principal in the schema:

```ts
// schema.ts — `owner:` names the principal column
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    total: integer('total').notNull(),
  },
  kovo({ domain: 'order', owner: (t) => t.userId }),
);
```

Then scope every read and write of that table to the session, not to client input:

```ts
// CORRECT: the user id comes from req.session, traceable by the predicate extractor
export const orderHistoryQuery = query('orderHistory', {
  guard: authed,
  load: (db, _args, req) => db.select().from(orders).where(eq(orders.userId, req.session.user.id)),
  reads: [order],
});
```

A query or write that touches an `owner:`-annotated table whose key predicate the analyzer can't trace
back to `req.session` is reported by the `--unscoped` audit below. The same predicate extractor that
derives row keys does the tracing. The fix is always the same: filter by a session field, never by an
unguarded `args.userId`.

## CSRF is on by default

`kovo-csrf` is a synchronizer token stamped into every emitted mutation form. The server verifies it
**first**: before schema parsing, before replay reservation, before the guard chain, on every
mutation POST. When `req.session` exists, the token is bound to that session. When the user is
anonymous, it is bound to a framework-owned signed-cookie secret so login, signup, and password-reset
forms are protected before there is a session. Note the wire field name is
`kovo-csrf`; the app-side config object carries a `field` (e.g. `'csrf'`) plus the signing `secret`
and a `sessionId` resolver:

```ts
export const commerceCsrf = {
  field: 'csrf',
  secret: process.env.CSRF_SECRET!,
  sessionId(request: CommerceRequest) {
    return request.session?.id;
  },
};

export const addToCart = mutation('cart/add', { csrf: commerceCsrf /* … */ });
```

You render the field with `csrfField`, though enhanced forms emit it for you:

```ts
import { csrfField } from '@kovojs/server';

const csrf = csrfField(request, commerceCsrf); // → <input type="hidden" name="csrf" value="…">
```

CSRF stays on for server-rendered mutation endpoints. The only opt-out is `csrf: false` on an
individual mutation, reserved for non-browser or externally authenticated endpoints. A `csrf: false`
mutation must not read `req.session` or run a session/cookie-derived guard; doing so is **KV418**
because the mutation would skip CSRF while still using ambient browser authority. Route non-browser
writes through [endpoints and webhooks](/guides/endpoints-webhooks/), where cookies are not
interpreted and verifier auth is explicit. Every opt-out shows up in the `--endpoints` audit with
its justification.

## Idempotency and replay

Each emitted form carries a `Kovo-Idem` token. It is fresh for each logical submit, not a hidden
form-instance constant, and enhanced success responses refresh it for the next submit. The replay
store atomically reserves `(principal, mutation, idem-token)` before input parsing; a duplicate or
concurrent submit with the same triple replays the settled response and does not execute the handler
again. A replay hit still re-evaluates the current guard chain before serving the stored response, so
revoked authorization does not get an old private response.

## Review the security graph

Security review's first questions are answerable from the committed `graph.json` without executing a
browser. Each review mode prints a stable, diffable table you can run in CI.

```sh
kovo explain --unguarded graph.json   # reachable without an authed guard
kovo explain --unscoped graph.json    # owner-annotated rows not provably session-scoped (IDOR)
kovo explain --endpoints graph.json   # machine ingress: auth scheme + CSRF posture
kovo explain --revealed graph.json    # confidential fields intentionally revealed
kovo explain --trust graph.json       # trusted HTML/SQL/URL escapes and their evidence
kovo explain --access graph.json      # explicit public/authenticated/machine access decisions
kovo explain --capabilities graph.json # held dangerous capabilities and capability URLs
kovo explain --cookies graph.json     # cookie posture and downgrade findings
kovo explain --sources-sinks          # source/sink inventory
```

### `--unguarded` — what's reachable without auth

Lists every mutation, route, and **query** reachable without an `authed` guard. Queries count because
every query is addressable over GET at `/_q/<key>` and its guard runs on every read. Clean output on
the commerce app:

```txt
kovo-explain/v1
UNGUARDED
SUMMARY total=0
```

A finding adds one line per reachable item above the summary, so a guard dropped in a refactor turns
CI red instead of landing quietly.

### `--unscoped` — the IDOR audit

Lists every query and write touching an `owner:`-annotated table whose key predicate the analyzer
can't trace to `req.session` — data that should be scoped to its owner but provably might not be:

```txt
kovo-explain/v1
UNSCOPED
UNSCOPED query:orderHistory order via user_id  key predicate not traceable to session
SUMMARY total=1
```

The fix is to scope the predicate to a session field as shown above; the line disappears when the
extractor can trace it.

### `--endpoints` — the machine-ingress table

The stable machine-ingress audit: every declared `endpoint()` and `webhook()`, plus every route
returning `respond.file()`/`respond.stream()`. Each row lists name, method, path, mount mode, auth
scheme (`session+guard`, `verifier:<scheme>`, `custom:<name>`, or `none:<justification>`), CSRF posture
(`checked` or `exempt:<justification>`), and for webhooks the write→domain chain:

```txt
kovo-explain/v1
ENDPOINTS
webhook:stripe POST /hooks/stripe prefix verifier:stripe-signature exempt:webhook order
SUMMARY total=1
```

This answers "what can reach this app, and what can it touch?" — the report is snapshot-locked with
the rest of the explain output, so a new endpoint or a `csrf: false` opt-out can't slip in unreviewed.

### `--revealed` — confidential data crossing the boundary

Lists every reviewed confidentiality reveal. A proof-grade row comes from a statically analyzed
projection that excludes secret columns. An audit-grade row comes from an explicit
`trustedReveal(value, { justification })` call and must be reviewed like any other escape hatch.

### `--access` — default-deny access decisions

Lists the explicit access decision for each query, mutation, route/page, endpoint, or webhook. A
missing row is a build-blocking access gap; add a guard chain, `publicAccess("reason")`, or verified
machine auth rather than relying on default reachability.

### `--capabilities` — held dangerous powers

Lists tool capabilities, audit-grade `trustedReveal` rows, and capability URL mints. This is where a
reviewer sees "this code can email a customer," "this action can read a secret," or "this route can
mint a signed storage URL" in one table.

## Keep confidential data off the wire

Mark confidential fields at the data boundary. A `secret` field is not eligible for the client query
wire or a client module. That keeps readable HTML and query frames from becoming a data leak.

```ts
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordDigest: text('password_digest').notNull(),
  },
  kovo({ domain: 'user', secret: (t) => [t.passwordDigest] }),
);
```

Project only the fields the UI needs:

```ts
export const supportUser = query('supportUser', {
  guard: guards.role('support'),
  load: (db, args) =>
    db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, args.userId)),
  reads: [user],
});
```

If a reviewed admin or support tool must reveal something the analyzer cannot prove safe, make that
decision visible:

```ts
trustedReveal(maskedEmail, { justification: 'support staff can see masked email on open tickets' });
```

An unresolved projection from a table with secret columns is **KV435**. Remove the secret field,
rewrite the projection so it is statically visible, or use `trustedReveal(...)` with a concrete
justification and review `kovo explain --revealed`.

## Prevent mass assignment

Do not let request input choose server-owned columns. Mark those columns `governed`, then write them
through explicit server provenance.

```ts
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name').notNull(),
    role: text('role').notNull(),
  },
  kovo({ domain: 'account', governed: (t) => [t.role] }),
);
```

This is the bad shape:

```ts
await db.update(accounts).set({ displayName: input.displayName, role: input.role });
```

`role` came from the request, so Kovo reports **KV438**. Use a server-derived value or an explicit
admin assignment instead:

```ts
await db.update(accounts).set({
  displayName: input.displayName,
  role: serverValue('member'),
});

await db.update(accounts).set({
  role: adminAssign(input.role, { justification: 'admin role editor' }),
});
```

`serverValue(...)` says the value is framework or app-server provenance. `adminAssign(...)` says an
authorized admin action intentionally writes a governed column and leaves an audit row.

## Serve file downloads with capability URLs

Do not hand-build storage URLs or raw download endpoints. Use a framework download endpoint and mint a
short-lived signed URL from the request context.

```ts
export const downloads = createStorageDownloadEndpoint({
  path: '/downloads',
  storage: invoicesBucket,
  scope: ({ req }) => `user:${req.session.user.id}`,
});

export const invoiceDownload = mutation('invoice/download', {
  guard: guards.authed(),
  handler: async (_input, ctx) => ({
    href: await ctx.signUrl({
      key: `invoices/${ctx.req.session.user.id}/latest.pdf`,
      scope: `user:${ctx.req.session.user.id}`,
      expiresIn: '10m',
    }),
  }),
});
```

`ctx.signUrl(...)` uses `signCapability` under the hood. The download endpoint verifies the method,
key, expiry, and scope before any storage read. A leaked URL is still a bearer credential, so keep the
expiry short and prefer one-time URLs for sensitive exports. Every mint appears in
`kovo explain --capabilities`.

## Source/sink boundaries

The same audit posture applies outside SQL. Treat every value that crossed a request, session,
database, model, generated DOM stamp, static-export path, or environment boundary as a source until a
Kovo parser, schema, guard, or trust API narrows it. Treat every output that can execute, navigate,
select, cache, download, store, or authorize as a sink.

| Source                                                      | Safe Kovo path                                                                                   | Dangerous sink                                                           | Escape hatch                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Request params, search, forms, query args, headers, cookies | Route/query/mutation schemas, CSRF, guards, typed redirects                                      | HTML text/attributes, URL attrs, redirects, selectors                    | `trustedHtml` / `trustedUrl` with provenance                 |
| Session and provider state                                  | `session(s.object(...))`, `sessionProvider`, `guards.authed`, `owner:` predicates                | Owner-table reads/writes, auth redirects, cacheable private reads        | Public-read or custom guard justification                    |
| Raw endpoint or webhook body                                | `endpoint()` audit metadata, executable verifier auth, `webhook()` verify-before-parse lifecycle | Raw `Response`, `Location`, headers, cookies, file/stream output         | Raw endpoint purpose plus verifier/custom/none justification |
| Database, model, or streamed text                           | Query output schemas, `<kovo-query>`, `<kovo-text>`, contextual escaping                         | SQL text, raw HTML insertion, script/JSON islands, stream renderers      | `trustedSql` / `trustedHtml` from reviewed renderer code     |
| Files, storage keys, manifests, static export paths         | `respond.file`, `respond.stream`, containment checks, static-export validation                   | Filesystem/S3 paths, `Content-Disposition`, inline HTML/SVG/MIME         | App-owned raw download endpoint with review                  |
| Framework code paths and generated artifacts                | Shared source/sink registry plus drift detection                                                 | `innerHTML`, `Headers`, `querySelector`, dynamic import, eval/process/fs | Narrow repo-internal exclusion with evidence                 |

Common app code rules are intentionally blunt:

- Never interpolate request, session, database, model, or generated-DOM data into HTML, URL, SQL,
  headers, cookies, filesystem paths, or raw endpoints without the matching Kovo safe helper or a
  named trust API.
- Do not present CSV, TSV, spreadsheet, or formula hardening as a Kovo-supported safe-by-default
  lane. If an app exports spreadsheet-readable data, it is app-owned raw endpoint/download code
  behind its own security review.
- Prefer typed `mutation()`, `query()`, `route()`, `respond.file()`, `respond.stream()`, cookies, and
  verifier helpers over hand-built response strings. When you need an escape hatch, make it show up
  in `kovo explain`.

For agentic or LLM-backed features, treat model output like any other untrusted source until a Kovo
schema, guard, or sink-specific trust API narrows it. Prompt injection is about confused instructions;
Kovo can narrow what a compromised model action may touch, not prove the model will ignore malicious
content.

## Next

- [Mutations & forms](/guides/mutations/) — the guarded request lifecycle and the 422 path.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — machine ingress and CSRF exemptions.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the review modes as CI assertions.
- [Domains, writes & data access](/guides/data-layer/) — where `owner:` annotations live.

<details>
<summary>Spec & diagnostics</summary>

The guard chain, combinators, and the `--unguarded` / `--unscoped` audits: SPEC §10.3 (verified
against `examples/commerce/src/domain.ts` and `@kovojs/server`'s `guards`). Typed sessions, the
`sessionProvider`, and guard-failure outcomes: SPEC §6.5. CSRF default-on, anonymous-CSRF, KV418, the
`kovo-csrf` token, and the soundness boundary: SPEC §6.6, §9.1. Per-submit `Kovo-Idem` and replay
reservation: SPEC §10.3. The typed read endpoint and per-read guard checks: SPEC §9.4. Live-push
guard re-checks (fragments must not become a privilege-escalation channel): SPEC §9.3. The `owner:`
annotation and `exempt`: SPEC §10.1. The verification surface and `--endpoints` machine-ingress
audit: SPEC §11.4. Confidential data and `trustedReveal`: SPEC §6.6, KV435. Governed write
provenance and mass-assignment: SPEC §10.3, KV438. Capability URLs for storage downloads:
SPEC §6.6. Typed mutation error path: SPEC §9.2.

</details>

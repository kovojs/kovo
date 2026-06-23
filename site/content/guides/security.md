---
title: Security & authorization
description: Compose guards, type your session, scope rows to their owner, and let three static audits answer "what can reach this app, and what can it touch?" without a browser.
order: 2.5
---

# Security & authorization

Kovo's security model is built so the hard questions — what's reachable without auth, which rows
leak across users, what a deploy exposes to the public internet — are answerable from a committed
artifact instead of a manual audit. This guide collects that model in one place: the guard
combinators shared by routes, queries, and mutations; typed sessions and the `sessionProvider`; the
`owner:`/IDOR authorization story; CSRF; and the three `kovo explain` audits that turn all of it into
CI gates.

## Guards: one combinator chain everywhere

A guard is a function from a request to `true` or a denial. The same `guards` combinators apply to
mutations, routes, and queries, so authorization is one vocabulary across the app:

```ts
import { guards, mutation, route } from '@kovojs/server';

// composable: short-circuits on the first denial
export const addToCart = mutation('cart/add', {
  guard: guards.all(
    guards.authed<CommerceRequest>(),
    guards.rateLimit<CommerceRequest>({ max: 10, per: 'session' }),
  ),
  // …
});

export const adminRefund = mutation('admin/refund', {
  guard: guards.role('admin'),
  // …
});

export const adminPage = route('/admin', {
  guard: guards.role<AdminRequest>('admin'),
  page: () => <AdminDashboard />,
});
```

The combinators (verified against `@kovojs/server`'s `guards`):

- **`guards.authed()`** — passes when `request.session?.user` is present; refines the request type so
  `req.session.user` is non-null inside the handler. A `null`/`undefined` session means anonymous and
  is treated as unauthenticated, never as a malformed request (SPEC §6.5).
- **`guards.role(role)`** — fails unauthenticated callers as unauthenticated, and authenticated-but-
  wrong-role callers as unauthorized (403), checking `req.session.user.roles`.
- **`guards.rateLimit({ max, per, windowMs? })`** — `per: 'session' | 'global'`, with a keyed variant
  for per-tenant limits.
- **`guards.all(...guards)`** — composes left to right and propagates the first denial as-is, so the
  §6.5 status mapping stays intact.

Guard outcomes are fixed so auth stays part of the typed surface. Route/query `authed` failures run
the app's `onUnauthenticated` handler (default: 303 redirect to the login route with the original URL
as `next`); authenticated-but-unauthorized failures render the 403 shell with status 403. Mutation
guard failures split the same way: unauthenticated submits return HTTP 401 with `Kovo-Reauth` on the
enhanced path, or 303 to login on the no-JS path; authenticated-but-unauthorized submits return HTTP
403 with a typed `forms.<mutation>.failure` code. See [mutations](/guides/mutations/) for the form
failure paths (SPEC §6.5, §9.2).

## Type your session

`req.session` is a declared `s.object` schema, not an `any` bag — and that's structural, not a
nicety. Query instance keys (`product:p1`) and guard refinements (`authed` making `req.session.user`
non-null) are load-bearing on session fields, so an untyped session would be a hole directly under the
proof surface (SPEC §6.5):

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
validators (SPEC §6.5):

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
back to `req.session` is reported by the `--unscoped` audit below — the same §11.1 predicate extractor
that derives row keys does the tracing (SPEC §10.1, §10.3). The fix is always the same: filter by a
session field, never by an unguarded `args.userId`.

## CSRF is on by default

`kovo-csrf` is a synchronizer token stamped into every emitted mutation form. The server verifies it
**first** — before schema parsing, before replay reservation, before the guard chain — on every
mutation POST (SPEC §6.6, §9.1). When `req.session` exists, the token is bound to that session. When
the user is anonymous, it is bound to a framework-owned signed-cookie secret so login, signup, and
password-reset forms are protected before there is a session. Note the wire field name is
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
its justification (SPEC §6.6, §11.4).

## Idempotency and replay

Each emitted form carries a `Kovo-Idem` token. It is fresh for each logical submit, not a hidden
form-instance constant, and enhanced success responses refresh it for the next submit. The replay
store atomically reserves `(principal, mutation, idem-token)` before input parsing; a duplicate or
concurrent submit with the same triple replays the settled response and does not execute the handler
again. A replay hit still re-evaluates the current guard chain before serving the stored response, so
revoked authorization does not get an old private response.

## The three static audits

Security review's first three questions are answerable from the committed `graph.json` without
executing a browser. Each is a `kovo explain` mode that prints a stable, diffable table you run in CI
with fail-on-findings (SPEC §10.3, §11.4):

```sh
kovo explain --unguarded graph.json   # reachable without an authed guard
kovo explain --unscoped graph.json    # owner-annotated rows not provably session-scoped (IDOR)
kovo explain --endpoints graph.json   # machine ingress: auth scheme + CSRF posture
```

### `--unguarded` — what's reachable without auth

Lists every mutation, route, and **query** reachable without an `authed` guard. Queries count because
every query is addressable over GET at `/_q/<key>` and its guard runs on every read (SPEC §9.4). Clean
output on the commerce app:

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
(`checked` or `exempt:<justification>`), and for webhooks the write→domain chain (SPEC §11.4):

```txt
kovo-explain/v1
ENDPOINTS
webhook:stripe POST /hooks/stripe prefix verifier:stripe-signature exempt:webhook order
SUMMARY total=1
```

This answers "what can reach this app, and what can it touch?" — the report is snapshot-locked with
the rest of the explain output, so a new endpoint or a `csrf: false` opt-out can't slip in unreviewed.

## Source/sink boundaries

The same audit posture applies outside SQL. Treat every value that crossed a request, session,
database, model, generated DOM stamp, static-export path, or environment boundary as a source until a
Kovo parser, schema, guard, or trust API narrows it. Treat every output that can execute, navigate,
select, cache, download, store, or authorize as a sink.

| Source                                                      | Safe Kovo path                                                                                   | Dangerous sink                                                           | Escape hatch                                                 | Diagnostic          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------- |
| Request params, search, forms, query args, headers, cookies | Route/query/mutation schemas, CSRF, guards, typed redirects                                      | HTML text/attributes, URL attrs, redirects, selectors                    | `trustedHtml` / `trustedUrl` with provenance                 | KV236, KV423, KV425 |
| Session and provider state                                  | `session(s.object(...))`, `sessionProvider`, `guards.authed`, `owner:` predicates                | Owner-table reads/writes, auth redirects, cacheable private reads        | Public-read or custom guard justification                    | KV414, KV418        |
| Raw endpoint or webhook body                                | `endpoint()` audit metadata, executable verifier auth, `webhook()` verify-before-parse lifecycle | Raw `Response`, `Location`, headers, cookies, file/stream output         | Raw endpoint purpose plus verifier/custom/none justification | KV415, KV418, KV422 |
| Database, model, or streamed text                           | Query output schemas, `<kovo-query>`, `<kovo-text>`, contextual escaping                         | Raw HTML insertion, script/JSON islands, stream renderers                | `trustedHtml` from reviewed renderer code                    | KV236, KV423, KV425 |
| Files, storage keys, manifests, static export paths         | `respond.file`, `respond.stream`, containment checks, static-export validation                   | Filesystem/S3 paths, `Content-Disposition`, inline HTML/SVG/MIME         | App-owned raw download endpoint with review                  | KV415, KV424        |
| Framework code paths and generated artifacts                | Shared source/sink registry plus drift detection                                                 | `innerHTML`, `Headers`, `querySelector`, dynamic import, eval/process/fs | Narrow repo-internal exclusion with evidence                 | KV424               |

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

## A practical security checklist

1. **Type the session** with `session(s.object(...))` — guards and query keys depend on it.
2. **Resolve it once** with a `sessionProvider`; treat `null` as anonymous.
3. **Guard from the bottom up** — `authed` on anything per-user, `role` on admin surfaces,
   `rateLimit` on mutations, `guards.all(...)` to compose.
4. **Annotate `owner:`** on every per-user table and scope predicates to `req.session`, never to
   client input.
5. **Leave CSRF on**; justify every `csrf: false` and confirm it in `--endpoints`.
6. **Run the three audits in CI** with fail-on-findings, next to `kovo check`.
7. **Review every escape hatch** in the source/sink table before merging raw protocol code.

## Next

- [Mutations & forms](/guides/mutations/) — the guarded request lifecycle and the 422 path.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — machine ingress and CSRF exemptions.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the audits as CI assertions.
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
audit: SPEC §11.4. Typed mutation error path: SPEC §9.2.

</details>

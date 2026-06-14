# jiso

## What this codebase does

Jiso is a pre-v1 TypeScript web framework (pnpm monorepo) for multi-page apps
that are server-rendered, resumable (Qwik-style), and statically verifiable.
Mutations return server-rendered HTML *fragments* applied over the wire
(htmx/LiveView-style); queries declare typed `reads` on domains; optimistic
updates rebase against authoritative responses. `packages/*` is framework
internals — the realistic app-shaped attack surface lives in `examples/commerce`
(the reference app) and in the framework's wire/trust boundaries
(`packages/server`, `packages/runtime`). Nothing is published to npm; backends
are in-memory stubs.

## Auth shape

Authorization is per-declaration, not middleware. Each
`mutation()`/`query()`/`route()`/`endpoint()` may carry its own `guard`:

- Built-in guards: `guards.authed()`, `guards.rateLimit()`, `guards.all(...)`
  (compose). A guard returns `true` or a `GuardFailure`.
- App auth via better-auth adapters: `betterAuthAuthed()`,
  `betterAuthRole('admin')` (→ `commerceAdminGuard`), `betterAuthSession`.
  Session is reached as `request.session.user.id`.
- CSRF: `csrfToken` / `csrfField` / `validateCsrfToken` — HMAC-SHA256 over the
  session id with a `timingSafeEqual` compare. Mutations take a `csrf` option;
  endpoints are CSRF-on by default and require `csrf: false` plus a
  `csrfJustification` string to opt out.

## Threat model

An attacker submits crafted wire requests (form/file bodies,
`FW-Fragment`/`FW-Idem`/`FW-Targets` headers) to mutations, queries, routes,
endpoints, or webhooks. Ranked by impact: (1) reach a state-changing handler
whose `guard` or ownership check is missing and mutate or read another user's
data; (2) IDOR — load another user's order/attachment via a route param not
scoped to the session user; (3) stored XSS — get unescaped user/DB data into a
server fragment, which the client applies via `innerHTML`; (4) forge or replay
an unverified webhook/payment event.

## Project-specific patterns to flag

- **Missing `guard`** on a `mutation()`/`query()`/`route()` that reads or writes
  user-scoped data — these are public unless a guard is declared. Compare
  against sibling declarations carrying `betterAuthAuthed`/`commerceAdminGuard`.
- **Unescaped fragment HTML.** Server fragment renderers must run user/DB
  strings through `escapeHtml`/`escapeAttribute` (in `packages/server/src/html.ts`,
  `packages/compiler/src/shared.ts`). Fragments are applied client-side via
  `innerHTML`/`insertAdjacentHTML` (`runtime/response-fragment-apply.ts`,
  `morph.ts`) — an unescaped interpolation is stored XSS.
- **IDOR.** Handlers/routes that look up `request.db` by `context.params.id`
  must also filter by `request.session.user.id` (the attachment/order routes
  show the intended pattern).
- **CSRF opt-out without justification.** A state-changing mutation with
  `csrf: false`, or an endpoint exempting CSRF without a real `csrfJustification`.
- **Unverified webhooks.** A `webhook()` missing `verify` (e.g.
  `stripeSignature`) or `idempotency`/`replayStore` trusts unauthenticated input.

## Known false-positives

- `EXAMPLE_ONLY_*_CSRF_SECRET` constants and the in-memory `commerceAuthUsers`
  map (`password: 'correct'`) — example fixtures, not real secrets/credentials.
- `createCommerceBetterAuth`'s in-memory session/user store — a reference stub,
  not production auth.
- `escapeHtml` intentionally does not escape quotes (that is `escapeAttribute`'s
  job); the split is by design, not a missing-encoding bug.
- `inlineJisoLoaderInstallerSource` (the inline-loader string in
  `runtime/inline-loader.ts`) builds DOM/regex from attributes by design —
  framework runtime, not app data flow.
- `endpointRequestWithoutSession` strips `session` from raw endpoints on
  purpose (SPEC §9.1), so a raw endpoint reading no session is expected.
</content>

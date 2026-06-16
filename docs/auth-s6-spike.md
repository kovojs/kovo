# Auth S6 Spike: Wrapped-Mutation Credential Flow

Status: bounded decision-gate artifact, 2026-06-11.

## Decision

Proceed with B4's wrapped credential mutations as the blessed path, with B6 still required to pin a real `better-auth` package version and exercise its database/API behavior.

The spike does not install `better-auth` or claim SQL/API drift coverage. It records the framework-side contract that must remain true for the integration style to work: a credential form posts to a Kovo `mutation()`, the handler calls Better Auth server-side, every `Set-Cookie` produced by that call is forwarded through the SPEC §9.1 mutation response-header channel, the mutation returns the normal Kovo redirect/fragment vocabulary, and the next request's SPEC §6.5 `sessionProvider` observes the new session.

## Source Evidence

Official Better Auth docs, current as checked on 2026-06-11:

- The server auth instance exposes an `api` object, and endpoints are called server-side as functions. Bodies, headers, and query params are passed in `{ body }`, `{ headers }`, and `{ query }` fields: https://better-auth.com/docs/concepts/api.
- `signInEmail` is documented with `auth.api.signInEmail({ body: { email, password } })`, and the API page documents `asResponse: true` returning a `Response`: https://better-auth.com/docs/concepts/api.
- The same page documents `returnHeaders: true`, returning a `Headers` object whose cookies can be read with `headers.getSetCookie()`: https://better-auth.com/docs/concepts/api.
- Email/password docs say cookie-setting server methods require cookies to be passed back to the client: https://better-auth.com/docs/authentication/email-password.

That evidence is enough to keep S6 moving without inventing an adapter API. It is not enough to replace B6, because B6 must pin a concrete Better Auth version and verify actual exported types, error classes, cookie multiplicity, redirects, and SQL writes.

## SPEC Anchors

- SPEC §6.3: credential fields remain ordinary typed mutation form inputs.
- SPEC §6.5: the app-owned `sessionProvider` maps Better Auth's session into the declared Kovo session schema; Better Auth is not the source of truth for the Kovo session type.
- SPEC §9.1: enhanced and no-JS mutation responses share one endpoint; handlers may attach transport headers such as `Set-Cookie` without replacing the body/status vocabulary.
- SPEC §9.2: invalid credentials are a declared mutation error, returned through the 422 typed-error path rather than a Better Auth JSON/body escape hatch.
- SPEC §10.3: the session provider runs before guards on the next request, so a successful sign-in must be visible to guarded routes and queries after PRG.
- SPEC §14: Better Auth remains the blessed adapter over Kovo's auth capability floor, not a core dependency.

## Flow Contract

1. Login page renders `form(signIn)` with `email`, `password`, optional `next`, and framework CSRF fields.
2. Browser posts to `/_m/auth/sign-in`.
3. Kovo validates CSRF, parses the input schema, and enters the mutation handler.
4. The handler calls the Better Auth server API with incoming request headers and a response/header-returning option:

   ```ts
   await auth.api.signInEmail({
     body: { email: input.email, password: input.password },
     headers: req.headers,
     asResponse: true,
   });
   ```

5. The wrapper extracts all returned `Set-Cookie` values, preferably with `Headers.getSetCookie()`, and forwards each one through the §9.1 response-header channel.
6. On success, the mutation returns Kovo's normal redirect intent to `input.next ?? '/'`. Enhanced responses and no-JS PRG both receive the same cookies.
7. On credential failure, the wrapper catches Better Auth's documented API error shape and returns `fail('INVALID_CREDENTIALS', {})`.
8. The redirected request runs `sessionProvider`, which calls `auth.api.getSession({ headers: req.headers })` and maps the result into the declared Kovo session schema.
9. Sign-out is symmetrical: call the server API, forward clearing cookies, redirect to `/login`.

## Local Fixture

`conformance/auth-spike/src/index.test.ts` locks down the Kovo-side adapter behavior without live external services. It uses a fake Better Auth-like API with the documented server-call shape and real platform `Response`/`Headers` objects. The fixture covers:

- no-JS and enhanced sign-in both forwarding multiple `Set-Cookie` headers;
- the next request's session provider seeing the signed-in user;
- invalid credentials mapping to `INVALID_CREDENTIALS` without cookie leakage;
- sign-out forwarding clearing cookies and making the next session anonymous.

## Remaining B6 Work

B6 must still install and pin Better Auth, then verify the real package:

- exported endpoint names and option names (`signInEmail`, `signUpEmail`, `signOut`, `getSession`, `asResponse`, `returnHeaders`);
- multiple-cookie behavior in the Node runtime Kovo supports;
- real `APIError`/`isAPIError` classification and status codes for invalid credentials, unverified email, 2FA-required, and plugin-mediated failures;
- Drizzle schema generation and observed SQL writes against pglite for declared touch sets;
- OAuth/SAML/magic-link callback behavior through `endpoint()`/`mount()`, not credential mutations.

If B6 contradicts the documented `Response`/`Headers` contract, fall back only for affected credential flows to B5-style mounting and record the loss of typed-form/no-JS composition explicitly.

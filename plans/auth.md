# Auth — agnostic core seams + blessed better-auth adapter (D5)

Status: design agreed 2026-06-11; SPEC A-track text landed; A-track core seams implemented; S6 bounded spike artifact landed; B2/B3 initial adapter seam landed
Scope: SPEC additions (session population, guard-failure contract, mutation response headers, raw endpoints), `@jiso/core`/`@jiso/server` seams, a new `@jiso/better-auth` package, a `conformance/better-auth-pin/` suite, and starter/example adoption. Referenced from `IMPLEMENT_v1.md` as workstream **D5**.

## Progress checklist

- [x] S6 spike artifact: wrapped-mutation credential flow decision gate documented without touching core/server internals. Evidence: `docs/auth-s6-spike.md` records the flow, SPEC anchors, official Better Auth API evidence, and caveats; `conformance/auth-spike/src/index.test.ts` locally exercises multiple `Set-Cookie` forwarding, typed invalid-credential failure, session mapping, and sign-out clearing with a Better Auth-like `Response`/`Headers` fixture. This is not the B6 real-package pin.
- [x] SPEC A-track text: session population seam, guard-failure contract, mutation response-header channel, `endpoint()` primitive (normative text; supersedes the gaps listed under Background).
- [x] A1 session-resolution seam in the request lifecycle. Evidence: `packages/server/src/index.ts` exposes `sessionProvider`/`SessionProvider` lifecycle options and resolves the provider before route/query/mutation guards without runtime-parsing the declared session shape; `packages/server/src/index.test.ts` covers provider ordering and static provider/session assignability.
- [x] A2 guard-failure contract (`onUnauthenticated` redirect, 403 path for failed `role()`). Evidence: `packages/server/src/index.ts` maps route/query unauthenticated guard failures to 303 login redirects with `next` and authenticated unauthorized failures to 403 shells while keeping mutation guard failures on the typed 422 path; focused server tests cover default and route-level override behavior.
- [x] A3 mutation response-header channel (`ctx.setCookie` / header passthrough). Evidence: `packages/server/src/index.test.ts` covers enhanced Set-Cookie forwarding, no-JS PRG Set-Cookie forwarding, and no typed-failure leakage; focused server tests and `vp check` passed in `agent/auth-headers`.
- [x] A4 `endpoint()` raw endpoint primitive with CSRF exemption + unguarded-audit enrollment.
- [ ] B1 schema bridge: better-auth tables into `schema.ts` domains with declared touches.
      Partial evidence 2026-06-12: `packages/better-auth/src/index.ts` now exports
      `betterAuthSchemaBridge`, `betterAuthTableDomain`, and `validateBetterAuthSchemaBridge`
      so the blessed adapter has explicit core-table `schema.ts` annotations (`user` -> `user`,
      `account`/`session` -> `auth`, `verification` exempt with rationale) and validates that
      credential declared table touches match their bridged domains. `packages/better-auth/src/index.test.ts`
      covers the local bridge/touch invariants and missing/unbridged metadata reporting;
      `conformance/better-auth-pin/src/index.test.ts` pins the bridge against real
      `better-auth@1.6.17` `getAuthTables(auth.options)` output. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts`
      and `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: `betterAuthSchemaBridge` now maps the blessed
      organization/admin plugin surface by accepting Better Auth's `organization`, `member`,
      `invitation`, `team`, `teamMember`, and `organizationRole` tables under an `organization`
      domain while keeping only the four core tables required for core-only installs.
      `packages/better-auth/src/index.test.ts` covers core-only and plugin-present validation;
      `conformance/better-auth-pin/src/index.test.ts` pins real `admin()` plus organization
      plugin table/field metadata with teams and dynamic access control enabled from
      `better-auth@1.6.17`, and verifies the bridge no longer reports those plugin tables as
      unbridged. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`.
      Remaining gaps: plugin-generated tables outside the blessed organization/admin surface are
      still not mapped, app `schema.ts` generation is not exercised, and the declared table touches
      are not yet wired through the P9 wrapper as a general observed-write verifier.
- [x] B2 typed session mapper (`betterAuthSession(auth, map)`). Evidence: `packages/better-auth/src/index.ts` exports a dependency-light Better Auth-like `auth.api.getSession({ headers })` provider adapter that returns `null` for anonymous sessions per SPEC §6.5 and maps the inferred Better Auth `session`/`user` payload through an app-owned total mapper; `packages/better-auth/src/index.test.ts` covers runtime mapping, anonymous requests, and a `@ts-expect-error` totality check that dropped declared session fields fail under `vp check`.
- [x] B3 guard bindings: `authed` / `role()` / org-scoping over the mapped session. Evidence: `packages/better-auth/src/index.ts` exports `authed()`, typed `role<Request>()`, and `activeOrganization()` guards over the mapped session while preserving SPEC §10.3 unauthenticated vs unauthorized guard failures; focused tests cover success/failure behavior and stale role-name type failures without requiring live Better Auth services.
- [x] B4 ejectable credential mutations (sign-in / sign-up / sign-out) wrapping `auth.api`.
      Evidence 2026-06-11: `packages/better-auth/src/index.ts` exports
      `betterAuthSignInEmailMutation`, `betterAuthSignUpEmailMutation`, and
      `betterAuthSignOutMutation` helpers with credential input/error schemas, `Set-Cookie`
      forwarding through `ctx.setCookie`, same-origin `next` redirect guards, and typed
      `INVALID_CREDENTIALS` failures for credential rejection. `packages/better-auth/src/index.test.ts`
      covers sign-in, sign-up, sign-out, cookie forwarding, typed failures, and redirect guards.
      Same-session evidence: `pnpm exec vitest run packages/better-auth/src/index.test.ts`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts`,
      `pnpm exec tsc --noEmit`, and `pnpm run check`.
- [x] B5 `mount()` for browser-redirect protocols (OAuth callbacks, SAML ACS, magic links).
      Evidence 2026-06-11: `packages/better-auth/src/index.ts` exports `mount()` for Better
      Auth-like redirect/callback handlers, returning a prefix `endpoint()` with CSRF exemption,
      audit-visible auth metadata, optional method narrowing, and no ambient session surface.
      `packages/better-auth/src/index.test.ts` covers Better Auth-owned GET/POST redirect
      protocol paths, direct handler mounting, custom audit metadata, prefix matching, method
      narrowing, and stripped request session state. Same-session evidence:
      `pnpm exec vitest run packages/better-auth/src/index.test.ts` and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts`.
- [x] B6 pinned better-auth conformance suite in CI.
      Evidence 2026-06-11: `conformance/better-auth-pin` pins `better-auth@1.6.17` and
      exercises the real Better Auth `auth.api.getSession`/`signInEmail`/`signUpEmail`/`signOut`
      and handler surfaces, table metadata through `getAuthTables`, session mapping through
      `betterAuthSession`, credential mutation cookie forwarding and `INVALID_CREDENTIALS`
      mapping, `mount()` prefix routing over the real handler, and declared table/domain touches
      against observed memory-adapter writes. `vite.config.ts` includes the suite in
      `vp run conformance` and `typecheck-examples`; `tests/fw-check.node.mjs` structurally
      asserts the conformance wiring. Same-session evidence:
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts`,
      and
      `pnpm exec vp check packages/better-auth/src/index.ts conformance/better-auth-pin/src/index.test.ts conformance/better-auth-pin/package.json conformance/better-auth-pin/tsconfig.json vite.config.ts tests/fw-check.node.mjs pnpm-lock.yaml`.
- [ ] B7 starter login recipe + reference-app adoption behind real `authed`/`role()` guards.
      Partial evidence 2026-06-11: `packages/create-jiso/templates/src/auth.tsx` ships an
      ejectable Better Auth starter recipe using `betterAuthSession`,
      `betterAuthSignInEmailMutation`, `betterAuthSignOutMutation`, `authed`, and `role()`.
      The generated login/logout forms post directly to `/_m/auth/sign-in` and
      `/_m/auth/sign-out` with CSRF fields and only use `enhance` as a progressive upgrade; the
      starter package template declares `@jiso/better-auth` and `@jiso/server` dependencies.
      `packages/create-jiso/src/index.test.ts` now scaffolds `src/auth.tsx`, asserts the no-client
      SDK form contract, and typechecks the generated auth recipe inside a scaffold with starter
      dependencies linked. Same-session evidence:
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts` and
      `pnpm exec vp check packages/create-jiso/src/index.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/src/auth.tsx packages/create-jiso/templates/package.json packages/create-jiso/templates/README.md`.
      Partial reference-app evidence 2026-06-12: `examples/commerce/src/app.ts` now imports
      `@jiso/better-auth` and wires a commerce-local Better Auth-like surface through
      `betterAuthSession`, `betterAuthSignInEmailMutation`, `betterAuthSignOutMutation`,
      adapter `authed()`, and adapter `role('admin')`. Existing commerce mutations/routes now use
      the adapter `authed()` guard, `commerceAdminRoute` exercises the server 303/403 role guard
      contract, and the graph/audit metadata includes the guarded `auth/sign-out` mutation plus
      `/admin` page. `examples/commerce/src/app.test.ts` covers no-JS sign-in cookie forwarding,
      typed invalid credentials, sign-out cookie clearing, session-provider mapping from cookies,
      and anonymous/member/admin outcomes for the admin route; `fwExplain(..., { unguarded: true })`
      and `fwExplain(..., { unscoped: true })` still report `SUMMARY total=0`. Same-session
      evidence: `pnpm exec vitest --run examples/commerce/src/app.test.ts`.
      Tightened pinned-package evidence 2026-06-12:
      `conformance/better-auth-pin/src/index.test.ts` now proves a starter/reference-shaped
      recipe against real `better-auth@1.6.17`: the adapter sign-in mutation forwards the real
      session cookie, `betterAuthSession` maps that cookie-backed session into the app-declared
      session shape (SPEC §6.5), an `authed()` route redirects anonymous requests with `next` and
      renders for the real signed-in member session, and `role('admin')` returns the SPEC §10.3
      403 path for a member session while rendering for a real signed-in admin-mapped session.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts packages/create-jiso/src/index.test.ts`.
      Remaining gap: there is still no `examples/reference` app in this checkout, commerce's
      app-level adoption uses a deterministic Better Auth-like test surface rather than the pinned
      real Better Auth package, and the anonymous sign-in mutation is not represented in the
      current mutation guard audit vocabulary, so B7 remains open.

## Background — the gap

SPEC v0.2 ships authorization without authentication. Typed sessions (§6.5), guard combinators (`authed`, `role()`, §10.3), and the `--unguarded`/`--unscoped` audits all _consume_ `req.session`, but nothing specifies how a session is created: no login flow, no session store contract, no OAuth/SSO story, no logout/rotation, and no defined behavior when a route guard fails (§6.4 sanctions only `redirect()` and `notFound()` as non-200 page outcomes — 401/403 are unspecified). The proof surface is load-bearing on session fields while their provenance is entirely off-spec. For the CRM/internal-tools segment, SSO and org membership are day-one requirements, and an unowned auth integration pushes adopters outside the verified surface at its most security-critical point.

### Decision: §14's floor+blessed pattern, applied to auth

Recorded so we don't relitigate:

- **Core stays agnostic.** Jiso defines a minimal capability floor (the A-track below) that works with any auth source — homegrown sessions, Auth.js, WorkOS, better-auth. This mirrors the §14 data-layer strategy: capability interface in core, adapters implement what they can, the floor is universal.
- **better-auth is the blessed v1 adapter.** Fit, verified against current docs (2026-06): TypeScript-first; self-hosted; persists through a first-class Drizzle/pg adapter into the app's own `schema.ts` (so auth tables enter the touch-graph machinery rather than living beside it); server-side `auth.api.*` surface can return a raw `Response` (`asResponse: true`) including `Set-Cookie`; plugin map lands directly on the CRM segment — `organization` → multi-tenancy + `owner:` audit, `admin` → `role()` guards, `sso` → OIDC + SAML 2.0 with per-org provider config, plus passkey/2FA.
- **Rejected:** building auth in-house (fails §13.5 adopt-don't-invent); recipes-only agnosticism (every adopter re-derives the integration; session provenance stays unverified); Auth.js (Next-gravitating, loosely typed); Lucia (self-deprecated); hosted-only providers as the blessed path (undercut the self-host posture; second source of truth outside the verifiable boundary — still reachable via the agnostic floor).
- **The better-auth client SDK never enters the page.** Credential flows are ordinary Jiso `mutation()`s calling `auth.api` server-side. Anything else bolts an unverified fetch/JSON wire onto the front door and breaks the no-JS contract (§9.1) and Constitution #4.

## A-track — the agnostic core (spec + `@jiso/server`, provider-independent)

These are core seams regardless of which auth library an app uses. Each needs normative SPEC text before implementation (SPEC is the source of truth; this plan sequences the work).

- **A1 — Session-resolution seam.** App-level config `sessionProvider: (req) => Promise<Session | null>` running in the request lifecycle (§10.3) before the guard chain. The declared `s.object` session schema (§6.5) remains the single source of truth; the provider's return type must be assignable to it (checked in `tsc`, not at runtime — the provider is in-process, not a wire boundary).
- **A2 — Guard-failure contract.** Today a failed route guard has no spec'd outcome. Add app-level `onUnauthenticated` (default: `redirect('/login', { next })`-shaped, overridable per route) and a 403 rendering path for authenticated-but-unauthorized (`role()` failure). Mutation guard failures keep their existing typed-error/422 path (§9.2); this contract covers `route()` and query (`/_q/`) guards.
- **A3 — Mutation response-header channel.** Sign-in/out must set cookies, but the §10.3 lifecycle gives handlers no response-header access. Add a narrow channel (`ctx.setCookie(...)` or equivalent) usable by any mutation. Useful beyond auth; deliberately not a general "write the response" escape hatch — headers only, the body remains the §9.1 vocabulary.
- **A4 — `endpoint()` raw-endpoint primitive.** A declared, registry-visible route variant for machine-facing HTTP: no page render, raw `Request → Response`, exempt from `fw-csrf` (named, justified exemption — same philosophy as FW211/FW302 justification comments), enrolled in the `--unguarded` audit with its own auth declaration. Auth is the first consumer (OAuth/SAML callbacks); it also closes the webhook/CSV-export gap noted in the CRM review. Spec PR decides whether enrollment violations get a new FW code or ride the existing audit output.

## B-track — `@jiso/better-auth` (the blessed adapter)

- **B1 — Schema bridge.** better-auth's CLI-generated Drizzle tables (`user`, `session`, `account`, `verification`, plugin tables) live in the app's `schema.ts` and are mapped by the adapter into domains (e.g. `user`, `auth`) via `jiso({ domain })`. Library-internal writes are invisible to the §11.1 extractor, so the adapter ships **declared `touches` for each wrapped `auth.api` write surface** — the §14 declared-touches floor, runtime-verified by the P9 wrapper (`observed ⊆ static ∪ declared`). Do **not** blanket-`exempt` the `user` table: app queries render user names/avatars from it, and exemption recreates the silent-staleness bug (profile edits never invalidating consumers). Pure-bookkeeping tables (`verification`, `session`) may be exempted with a recorded rationale.
- **B2 — Typed session mapper.** The app declares its §6.5 session schema as today; `betterAuthSession(auth, map)` maps better-auth's inferred session/user (plugin-extended) into it, with totality checked by `tsc` — a plugin change that drops a declared field turns the mapper red. better-auth never becomes the schema's source of truth.
- **B3 — Guard bindings.** Canonical `authed` and `role()` implementations over the mapped session; `admin`-plugin roles feed `role()` so the `--unguarded` audit speaks real role names; `organization`'s `activeOrganizationId` lands in the typed session so query instance keys (§10.2) and the `owner:`/`--unscoped` IDOR audit can scope to tenant — multi-tenancy falls out of existing machinery.
- **B4 — Ejectable credential mutations.** Sign-in / sign-up / sign-out as pre-built `mutation()`s wrapping `auth.api.signInEmail(...)` etc., forwarding `Set-Cookie` via A3. Everything composes for free: typed forms with completeness checking (§6.3), `INVALID_CREDENTIALS` as a declared error code through the 422 path, no-JS POST-redirect-GET, `fw-csrf`, and a wire that stays in Jiso's documented vocabulary. Shipped as authorable source the app can eject (Constitution #3).
- **B5 — `mount()` for browser-redirect protocols.** The better-auth handler mounted via A4 `endpoint()` for the flows that are irreducibly redirect-based: OAuth callbacks, SAML ACS, magic-link verification. This is the _only_ place the mounted handler is the surface; credential flows stay on B4.
- **B6 — Pinned conformance suite** (`conformance/better-auth-pin/`): pins a better-auth version; exercises the wrapped `auth.api` surface, CLI schema-generation output, and B1's declared touch sets against better-auth's actual SQL (pglite). Same doctrine as the Drizzle pin — fails loudly on API drift instead of letting declarations go silently stale.
- **B7 — Starter + example adoption.** Login page recipe in `create-jiso`; the reference app adopts the adapter so `authed`/`role()` guards and the unguarded/unscoped audits are exercised by a real flow (P3's guard exits currently run against guards no one can satisfy end-to-end).

## Spike S6 — wrapped-mutation flow (run before committing to the B-track)

Prove end-to-end against pinned better-auth: form POST → Jiso `mutation()` → `auth.api.signInEmail({ asResponse: true })` → `Set-Cookie` forwarded through A3 → PRG redirect → guarded page renders with `req.session.user` populated → sign-out clears it. Both enhanced and no-JS paths. The whole blessed-path design hangs on this integration style working cleanly; if it doesn't (cookie semantics, header timing), the fallback is B5-style mounting for credential flows too, at the cost of the typed-form/no-JS story — a decision-gate writeup either way, per the existing spike discipline.

**S6 result (2026-06-11):** proceed with B4 as the intended adapter shape, gated by B6. `docs/auth-s6-spike.md` captures the bounded decision gate using official Better Auth docs evidence for server-side `auth.api`, `asResponse`, `returnHeaders`, and cookie pass-through requirements; the local `conformance/auth-spike/` fixture verifies the Jiso-side header/session/error contract without live external services. Because this slice deliberately avoids adding Better Auth as a dependency, B6 remains responsible for pinning the real package and verifying actual endpoint types, cookie multiplicity, error classes, and SQL touch behavior against pglite.

## Out of scope

better-auth's client SDK (never enters the page) · Jiso-owned auth UI components beyond the starter recipe · wrapping every better-auth plugin (bless email/password, `organization`, `admin`, `sso`; the rest ride the agnostic floor) · session storage backends beyond what better-auth provides · auth for the v2 live/SSE transport (guard-recheck-per-push is already specified in §9.3 and consumes the same session).

## Sequencing & dependencies

- A1–A3 slot into the P3 surface area (sessions, guards, lifecycle live there); they are small and unblock independently.
- A4 (`endpoint()`) is a spec design first — auth is its first consumer, webhooks/exports its second. B5 depends on it.
- S6 runs before B-track build-out; B1–B7 follow as a D-track (after P3, parallel to later phases).
- B6 joins the standing CI gates next to the Drizzle pin.

## Exit criteria

1. S6 decision-gate writeup merged; SPEC PR for A1–A4 merged (normative text, not this plan).
2. Starter login/logout works no-JS and enhanced; failed `authed` route guard redirects with `next`; failed `role()` renders 403.
3. `fw explain --unguarded` lists mounted auth endpoints with their declared exemption; nothing else is CSRF-exempt.
4. Profile-field rename in the declared session schema turns the B2 mapper and every consuming guard/query red under `vp check`.
5. A better-auth write surface change (new column written by `auth.api`) fails the B6 conformance suite, not production: `observed ⊆ static ∪ declared` holds over the adapter's touch sets in the P9 harness.
6. Reference app passes the unguarded/unscoped audits with real authenticated flows behind them.

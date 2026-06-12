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
      Partial evidence 2026-06-12: `validateBetterAuthSchemaBridge` now reports
      `keyFieldMismatches`, verifying each bridged domain key against Better Auth table `fields`
      metadata when the metadata is present, while treating Better Auth's implicit `id` key as
      available. `packages/better-auth/src/index.test.ts` covers a negative drift case where a
      declared `account.userId` bridge key is absent; `conformance/better-auth-pin/src/index.test.ts`
      pins that real `better-auth@1.6.17` core and blessed organization/admin plugin metadata have
      no key-field drift. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: `validateBetterAuthSchemaBridge` now reports
      `pluginTableDegradations` for Better Auth table metadata outside the blessed bridge,
      preserving `ok: false`/`unbridgedTables` while attaching the table fields and an actionable
      §14 declared-touch coverage message. `packages/better-auth/src/index.test.ts` covers the
      local degradation payload for an unmapped plugin table, and
      `conformance/better-auth-pin/src/index.test.ts` pins real `better-auth@1.6.17`
      `twoFactor()` metadata degrading as unsupported rather than being silently accepted. Same-session
      evidence: `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: `packages/better-auth/src/index.ts` now materializes the
      adapter's declared credential table touches as P9 verifier facts via
      `betterAuthCredentialMutationTouchGraph` and `betterAuthDbVerificationConfig`, derived from
      the schema bridge and exported default mutation keys. `packages/better-auth/src/index.test.ts`
      pins the generated touch graph/config shape, and `conformance/better-auth-pin/src/index.test.ts`
      runs the wrapped sign-up/sign-in/sign-out credential mutations through `@jiso/test`
      `createJisoTestHarness`, proving observed Better Auth-like writes to `user`, `account`, and
      `session` satisfy the declared touch graph with `verificationDiagnostics()` empty. Same-session
      evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts conformance/better-auth-pin/package.json plans/auth.md pnpm-lock.yaml`.
      Partial evidence 2026-06-12: `packages/better-auth/src/index.ts` now exports
      `annotateBetterAuthSchemaSource`, a bounded app `schema.ts` annotation helper that validates
      Better Auth table metadata and materializes matching Drizzle table declarations with
      `jiso({ domain, key })` or `jiso({ exempt: true })` annotations while reporting already
      annotated, pre-existing extra config, and missing source tables. `packages/better-auth/src/index.test.ts`
      covers local core metadata fixtures and safety reporting, and
      `conformance/better-auth-pin/src/index.test.ts` drives the helper from real
      `better-auth@1.6.17` `getAuthTables(auth.options)` metadata with admin/organization plugin
      tables enabled, proving the generated app-schema annotations match the blessed bridge facts.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: the bridge now maps Better Auth's `twoFactor` plugin table
      to the `auth` domain keyed by `userId`, and `annotateBetterAuthSchemaSource` materializes
      the matching app `schema.ts` annotation. `validateBetterAuthSchemaBridge` now labels
      unsupported plugin-table degradations with `FW406`, and local fixtures prove unsupported
      plugin metadata reports fields and an actionable manual coverage message rather than being
      silently accepted. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`.
      Partial evidence 2026-06-12: the real Better Auth `twoFactor()` pin now also covers
      OTP and backup-code provider options, proving those provider configurations keep the
      same `twoFactor` table fields and `userId` auth-domain bridge instead of adding
      plugin tables or changing B1 ownership. `conformance/better-auth-pin/src/index.test.ts`
      verifies clean validation and generated `schema.ts` annotations from
      `better-auth@1.6.17` metadata. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: the bridge now recognizes the real Better Auth
      `deviceAuthorization({ schema: {} })` plugin `deviceCode` table as exempt
      redirect/device-flow protocol state, matching SPEC §10.1's rule that pure Better
      Auth bookkeeping tables are not app read surfaces. `packages/better-auth/src/index.test.ts`
      covers local bridge/config invariants and generated `schema.ts` annotations for
      `deviceCode`; `conformance/better-auth-pin/src/index.test.ts` pins real
      `better-auth@1.6.17` table/field metadata and verifies validation plus generated
      annotations are clean. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`, and
      `git diff --check HEAD~1..HEAD`.
      Partial evidence 2026-06-12: unsupported Better Auth plugin table degradation payloads now
      include manual bridge steps for inspecting fields, choosing `jiso({ domain, key })` versus
      `jiso({ exempt: true })`, and adding declared API touches under SPEC §11.2; generated
      `schema.ts` annotation results also report whether the required `@jiso/drizzle` `jiso`
      import is already present, including aliased annotation callees. `packages/better-auth/src/index.test.ts`
      covers a local unsupported plugin table and default/aliased import-note cases, while
      `conformance/better-auth-pin/src/index.test.ts` pins real schema-annotation import notes
      from `better-auth@1.6.17`. Same-session
      evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: `annotateBetterAuthSchemaSource` now inserts the required
      `@jiso/drizzle` `jiso` import into returned app `schema.ts` source when it materializes
      annotations, either by adding a standalone import or extending an existing
      `@jiso/drizzle` named import; the import note records whether the import was pre-existing
      or inserted, including aliased annotation callees. `packages/better-auth/src/index.test.ts`
      covers default standalone insertion, existing-module import extension, and aliased
      pre-existing imports; `conformance/better-auth-pin/src/index.test.ts` keeps pinning the
      real Better Auth metadata path. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`, and
      `git diff --check`.
      Partial evidence 2026-06-12: the bridge now maps the real Better Auth `oidcProvider()`
      plugin table family (`oauthApplication`, `oauthAccessToken`, and `oauthConsent`) to the
      `auth` domain keyed by `userId`, so app `schema.ts` annotations and validation no longer
      degrade those tables as unsupported FW406 plugin metadata. `packages/better-auth/src/index.test.ts`
      covers local OIDC provider schema annotation fixtures and bridge/config invariants, while
      `conformance/better-auth-pin/src/index.test.ts` pins the real `better-auth@1.6.17`
      `oidcProvider({ loginPage: "/login" })` table/field metadata and generated annotations.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: the deprecated `oidcProvider()` successor path is now
      explicitly pinned as unavailable in the current `better-auth@1.6.17` dependency set:
      `packages/better-auth/src/index.ts` exports
      `betterAuthOAuthProviderSuccessorMetadataDegradation()` with an `FW406` diagnostic,
      attempted import paths for `@better-auth/oauth-provider`/subpath variants, and manual
      migration steps for inspecting successor `getAuthTables(auth.options)` metadata before
      adding schema annotations or declared touches. `packages/better-auth/src/index.test.ts`
      covers the exact degradation payload, and `conformance/better-auth-pin/src/index.test.ts`
      proves those successor import paths are absent while the legacy OIDC provider metadata
      remains pinned. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: the bridge now maps the real Better Auth `siwe()` plugin
      `walletAddress` table to the `auth` domain keyed by `userId`, matching the plugin-owned
      wallet credential identity surface without treating it as app-owned user profile data.
      `packages/better-auth/src/index.test.ts` covers local bridge/config invariants and
      generated `schema.ts` annotations for `walletAddress`; `conformance/better-auth-pin/src/index.test.ts`
      pins real `better-auth@1.6.17` SIWE table/field metadata and verifies validation plus
      generated annotations are clean. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`.
      Partial evidence 2026-06-12: the bridge now treats the real Better Auth `jwt()` plugin
      `jwks` table as exempt signing-key bookkeeping, matching SPEC §10.1's write-side-only
      exemption rule for tables the app must not query. `packages/better-auth/src/index.test.ts`
      covers local bridge/config invariants and generated `schema.ts` annotations for `jwks`;
      `conformance/better-auth-pin/src/index.test.ts` pins real `better-auth@1.6.17` JWT
      table/field metadata and verifies validation plus generated annotations are clean.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: the existing `user` table bridge is now pinned against the
      real Better Auth `username()` plugin's user-field extension surface (`username` and
      `displayUsername`) so plugin-added fields on an already bridged app-visible table stay
      covered by `jiso({ domain: "user", key: "id" })` rather than degrading as unsupported
      plugin metadata. `packages/better-auth/src/index.test.ts` covers local generated
      `schema.ts` annotations for plugin-added user fields, and
      `conformance/better-auth-pin/src/index.test.ts` pins real `better-auth@1.6.17`
      username table/field metadata with clean validation plus generated annotations.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: the existing `user` table bridge is now also pinned
      against real Better Auth `anonymous()`, `phoneNumber()`, and
      `lastLoginMethod({ storeInDatabase: true })` user-field extension metadata
      (`isAnonymous`, `phoneNumber`, `phoneNumberVerified`, and `lastLoginMethod`).
      This keeps SPEC §10.1 app-visible `user` reads under the single
      `jiso({ domain: "user", key: "id" })` table annotation instead of creating
      FW406 unsupported-plugin degradations for fields on an already bridged table.
      `packages/better-auth/src/index.test.ts` covers the local dependency-light
      fixture for these plugin-added user fields, and
      `conformance/better-auth-pin/src/index.test.ts` pins the real
      `better-auth@1.6.17` metadata with clean validation plus generated
      annotations. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: the bridge now treats Better Auth's real
      database-backed `rateLimit` table as exempt adapter enforcement state, matching
      SPEC §10.1's rule that app queries must not read Better Auth bookkeeping tables.
      `packages/better-auth/src/index.test.ts` covers local bridge/config invariants and
      generated `schema.ts` annotations for `rateLimit`; `conformance/better-auth-pin/src/index.test.ts`
      pins real `better-auth@1.6.17` `rateLimit: { storage: "database" }`
      table/field metadata and verifies validation plus generated annotations are clean.
      Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`.
      Partial evidence 2026-06-12: real Better Auth `emailOTP()` metadata is now pinned as
      staying inside the existing core table bridge (`account`, `session`, `user`, and exempt
      `verification`) rather than requiring a plugin-table bridge. This keeps SPEC §10.1
      verification/OTP protocol state out of app query domains while making future Better Auth
      table drift fail B1 validation. `conformance/better-auth-pin/src/index.test.ts` verifies
      the real `better-auth@1.6.17` table/field metadata, clean schema-bridge validation, and
      generated `schema.ts` annotations. Same-session evidence:
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: real Better Auth `magicLink()` metadata is now pinned as
      staying inside the existing core table bridge (`account`, `session`, `user`, and exempt
      `verification`) rather than requiring a plugin-table bridge. This covers the B5 blessed
      magic-link redirect surface while keeping SPEC §10.1 token protocol state out of app
      query domains. `conformance/better-auth-pin/src/index.test.ts` verifies the real
      `better-auth@1.6.17` table/field metadata, clean schema-bridge validation, and generated
      `schema.ts` annotations. Same-session evidence:
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: real Better Auth `oneTimeToken()` metadata is now pinned as
      staying inside the existing core table bridge (`account`, `session`, `user`, and exempt
      `verification`) rather than requiring a plugin-table bridge. This keeps SPEC §10.1
      one-time verification protocol state out of app query domains while making future Better
      Auth table drift fail B1 validation. `packages/better-auth/src/index.test.ts` covers the
      local dependency-light token metadata fixture, and `conformance/better-auth-pin/src/index.test.ts`
      verifies the real `better-auth@1.6.17` table/field metadata, clean schema-bridge
      validation, and generated `schema.ts` annotations. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: real Better Auth `mcp()` metadata is now pinned as using
      the already bridged OAuth table family (`oauthApplication`, `oauthAccessToken`, and
      `oauthConsent`) with `userId` auth-domain ownership. This keeps SPEC §10.1 MCP
      authorization state inside the existing B1 schema bridge rather than degrading as an
      unsupported plugin table. `conformance/better-auth-pin/src/index.test.ts` verifies the
      real `better-auth@1.6.17` table/field metadata, clean schema-bridge validation, and
      generated `schema.ts` annotations. Same-session evidence:
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: real Better Auth `genericOAuth()` metadata, including the
      exported `auth0()`, `keycloak()`, `okta()`, and `slack()` provider config helpers, is now
      pinned as staying inside the existing core bridge (`account`, `session`, `user`, and
      exempt `verification`). This keeps SPEC §10.1 OAuth provider account state under the
      existing `account.userId` auth-domain annotation while making future provider-table drift
      fail B1 validation. `conformance/better-auth-pin/src/index.test.ts` verifies the real
      `better-auth@1.6.17` table/field metadata, clean schema-bridge validation, and generated
      `schema.ts` annotations. Same-session evidence:
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: the same real `genericOAuth()` metadata pin now covers the
      remaining exported provider config helpers in the pinned dependency set:
      `gumroad()`, `hubspot()`, `line()`, `microsoftEntraId()`, and `patreon()`. They continue
      to produce only the existing core Better Auth tables, so SPEC §10.1 OAuth account rows stay
      under the `account.userId` auth-domain bridge with no new plugin tables or FW406
      degradations. Same-session evidence:
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check conformance/better-auth-pin/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: `annotateBetterAuthSchemaSource` now infers aliased named
      Drizzle table factory imports and namespace imports from `drizzle-orm/*-core`, so generated
      app `schema.ts` annotations do not miss real Better Auth tables when code uses
      `pgTable as authPgTable` or `sqlite.sqliteTable`. `packages/better-auth/src/index.test.ts`
      covers local alias/namespace fixtures, while `conformance/better-auth-pin/src/index.test.ts`
      drives the generalized scanner from real `better-auth@1.6.17` admin/organization table
      metadata and proves no source tables are reported missing. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: `validateBetterAuthSchemaBridge` now also validates the
      wrapped credential mutation registry domains against the adapter's declared table touches,
      so a wrapper that keeps `auth/sign-up` touching only `auth` while declared Better Auth
      writes include `user` reports `ok: false` under the B1 bridge validation path.
      `packages/better-auth/src/index.test.ts` covers the injectable drift fixture, and the
      pinned conformance suite remains clean against the default declared touches. Same-session
      evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: `validateBetterAuthSchemaBridge` now rejects declared
      credential table touches whose Better Auth table metadata is absent, covering stale
      plugin-generated table touch declarations before they can satisfy the domain-only registry
      check. `packages/better-auth/src/index.test.ts` covers a local negative fixture where a
      `twoFactor` touch is declared without the plugin table metadata, and
      `conformance/better-auth-pin/src/index.test.ts` proves the same declared touch is clean
      against real `better-auth@1.6.17` `twoFactor()` metadata. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: declared Better Auth table-touch validation now reports a
      stale/unbridged plugin table touch as a B1 mismatch instead of assuming every declared
      touch already belongs to the fixed schema bridge. `packages/better-auth/src/index.test.ts`
      covers a local `webauthnCredential` touch with present metadata but no bridge annotation,
      producing both the FW406 plugin-table degradation and the declared-touch mismatch. The
      pinned suite also verifies remaining real `better-auth@1.6.17` plugin exports
      (`bearer`, `captcha`, `customSession`, `haveIBeenPwned`, `lastLoginMethod`,
      `multiSession`, `oauthPopup`, `oAuthProxy`, `oneTap`, `openAPI`, and `testUtils`)
      add no plugin tables under minimal supported options and remain covered by the core
      `account`/`session`/`user`/exempt `verification` bridge. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check conformance/better-auth-pin/src/index.test.ts plans/auth.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: unsupported plugin-table FW406 degradation diagnostics now
      include a structured suggested `schema.ts` ownership annotation when Better Auth metadata
      exposes a familiar ownership key (`userId`, `organizationId`, or `teamId`), while still
      keeping validation `ok: false` until the bridge is explicitly updated. Local tests cover
      auth-owned, organization-owned, and metadata-unavailable cases, and the pinned
      `better-auth@1.6.17` conformance suite remains clean. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: the B1 bridge now has an explicit extension path for plugin
      tables outside the blessed fixed set. `validateBetterAuthSchemaBridge` and
      `annotateBetterAuthSchemaSource` accept caller-provided table annotations, so an unsupported
      plugin table keeps degrading as `FW406` by default but can become a first-class
      `schema.ts` `jiso({ domain, key })` or exempt annotation only when the app supplies the
      bridge entry and declared Better Auth table touches remain domain-aligned.
      `packages/better-auth/src/index.test.ts` covers the local `webauthnCredential` fixture in
      both default-degraded and explicitly-bridged modes. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts`,
      `pnpm exec vitest --run conformance/better-auth-pin/src/index.test.ts`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts plans/auth.md`.
      Partial evidence 2026-06-12: explicit plugin-table bridge extensions now flow through
      the P9 runtime verification path, not only validation and generated `schema.ts`
      annotations. `createBetterAuthDbVerificationConfig(schemaBridge)` materializes extended
      domain/exempt/key facts, and the touch-graph factory can emit a focused declared-touch
      graph for an ejectable wrapper that mutates an app-declared plugin table such as
      `webauthnCredential`. `packages/better-auth/src/index.test.ts` covers the extended
      validation/config/touch-graph facts, and `conformance/better-auth-pin/src/index.test.ts`
      drives the generated facts through `createJisoTestHarness`, proving observed writes to
      `session` plus an explicitly bridged plugin table satisfy P9 coverage with no
      diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md`, and
      `git diff --check`.
      Partial evidence 2026-06-12: the B1 schema bridge now honors Better Auth `modelName`
      table aliases in generated app `schema.ts` annotations and P9 verifier facts while
      keeping declared Better Auth API touches on the logical Better Auth table names.
      `annotateBetterAuthSchemaSource` maps real metadata `modelName` values to physical
      Drizzle table declarations and reports the physical table as missing when only a stale
      logical table declaration is present. `createBetterAuthDbVerificationConfig(schemaBridge,
tables)` now emits both logical and physical table facts for runtime SQL verification.
      `packages/better-auth/src/index.test.ts` covers local core/organization alias fixtures,
      and `conformance/better-auth-pin/src/index.test.ts` pins real `better-auth@1.6.17`
      core plus organization `modelName` metadata through generated annotations and verifier
      config. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`, and
      `git diff --check`.
      Partial evidence 2026-06-12: `validateBetterAuthSchemaBridge` now rejects Better Auth
      `modelName` collisions where two logical tables resolve to the same physical Drizzle table,
      and `annotateBetterAuthSchemaSource` no longer annotates an ambiguous physical table when
      such a collision is present. `createBetterAuthDbVerificationConfig` also omits the colliding
      physical table fact instead of letting P9 runtime table facts hide one Better Auth table
      behind another.
      `packages/better-auth/src/index.test.ts` covers a local `session`/`twoFactor` physical
      collision fixture, and `conformance/better-auth-pin/src/index.test.ts` pins a real
      `better-auth@1.6.17` core `user`/`session` `modelName` collision. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`.
      Partial evidence 2026-06-12: schema-bridge key-field drift diagnostics now include
      Better Auth's physical `modelName` table alias when one is configured, so app `schema.ts`
      and P9 verifier failures identify the real SQL table as well as the logical Better Auth
      table. `packages/better-auth/src/index.test.ts` covers local alias-aware key drift for
      `oauthApplication.userId`, and `conformance/better-auth-pin/src/index.test.ts` pins real
      `better-auth@1.6.17` plugin alias metadata for OIDC-provider tables, `twoFactor`, and
      exempt `deviceCode` through generated annotations plus verifier facts. Same-session
      evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`
      and `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`.
      Partial evidence 2026-06-12: schema bridge extensions can no longer collide with or
      downgrade blessed built-in Better Auth table mappings. Extension entries remain available
      for plugin tables outside the fixed bridge, but attempts to remap or exempt built-in
      tables such as `user` now make validation `ok: false` while generated app `schema.ts`
      annotations and P9 verifier facts continue to use the adapter-owned built-in mapping.
      `packages/better-auth/src/index.test.ts` covers the local validation/annotation/verifier
      behavior, and `conformance/better-auth-pin/src/index.test.ts` verifies the same downgrade
      attempt against real `better-auth@1.6.17` core table metadata. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: `annotateBetterAuthSchemaSource` now reports duplicate
      app `schema.ts` physical table declarations as `duplicateSourceTables` and leaves those
      ambiguous declarations unmodified instead of generating multiple `jiso(...)` annotations
      for one Better Auth table. `packages/better-auth/src/index.test.ts` covers the local
      duplicate `user` declaration fixture, and `conformance/better-auth-pin/src/index.test.ts`
      pins the same bounded behavior against real `better-auth@1.6.17` core
      `getAuthTables(auth.options)` metadata. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: explicit plugin-table bridge extensions now preserve Better
      Auth `modelName` physical aliases in the same schema-annotation and P9 verifier paths as
      blessed built-in tables, while unsupported-plugin FW406 diagnostics report the physical
      table name alongside the logical Better Auth table. `packages/better-auth/src/index.ts`
      adds the structured `physicalTable` degradation field when an unsupported table is aliased;
      `packages/better-auth/src/index.test.ts` covers alias-aware diagnostics plus extension
      alias annotation/verifier facts, and `conformance/better-auth-pin/src/index.test.ts`
      drives an explicitly bridged plugin table through the P9 harness with observed writes to
      the aliased physical table. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: app `schema.ts` annotation is now explicitly bounded to
      Drizzle table declarations recognized through imported `drizzle-orm/*-core` table
      factories or caller-provided `tableFactories`. Unbridged future plugin tables still
      degrade as FW406 unsupported-plugin metadata even when their source declaration is
      recognizable, and explicitly bridged tables declared through unrecognized/local factories
      now return `unrecognizedSourceTables` FW406 facts instead of synthesizing a fabricated
      `jiso(...)` mapping. `packages/better-auth/src/index.test.ts` covers future-plugin
      degradation, unrecognized local factories, and the explicit escape hatch for intentionally
      wrapped factories; `conformance/better-auth-pin/src/index.test.ts` pins the same
      unrecognized-factory behavior against real aliased `better-auth@1.6.17` OIDC-provider
      metadata. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Partial evidence 2026-06-12: unsupported/future Better Auth plugin metadata now flows
      through generated schema-source results as `unsupportedSourceTables` FW406 facts when an
      app `schema.ts` declares the table, including recognized Drizzle declarations and
      unrecognized local factory declarations with Better Auth `modelName` physical aliases.
      The adapter still leaves those declarations unannotated unless a caller supplies an
      explicit `schemaBridge` entry, so suggested ownership can no longer be confused with a
      generated mapping. The unavailable OAuth-provider successor degradation now carries
      explicit `tableMetadata: null` and `schemaBridge: null` fields. `packages/better-auth/src/index.test.ts`
      covers recognized and aliased future-plugin source declarations, and
      `conformance/better-auth-pin/src/index.test.ts` pins the null successor metadata/bridge
      payload against the real `better-auth@1.6.17` dependency set. Same-session evidence:
      `pnpm exec vitest --run packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts --reporter=dot`,
      `pnpm exec tsc -p conformance/better-auth-pin/tsconfig.json --noEmit`,
      `pnpm exec vp check packages/better-auth/src/index.ts packages/better-auth/src/index.test.ts conformance/better-auth-pin/src/index.test.ts plans/auth.md IMPLEMENT_v1.md`,
      and `git diff --check`.
      Remaining gaps: plugin-generated tables outside the blessed organization/admin/two-factor/OIDC-provider/MCP/SIWE/JWT/device-authorization
      surface are still not mapped, the OAuth-provider successor package/table metadata is not
      installed or exportable from the pinned dependency set, and full app `schema.ts` generation
      remains bounded to recognized Drizzle table declarations.
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
- [x] B7 starter login recipe + reference-app adoption behind real `authed`/`role()` guards.
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
      Partial reference-app shell evidence 2026-06-12: `examples/commerce/src/app-shell.ts`
      registers `auth/sign-in` and guarded `auth/sign-out` beside the existing cart mutation in
      the shared D8 app shell, preserving the no-JS credential mutation flow and routing the
      issued Better Auth-like session cookie through `commerceSessionProvider` before the guarded
      `/admin` role page renders. `examples/commerce/src/app-shell.test.ts` covers anonymous
      `/admin` redirect to `/login?next=%2Fadmin`, invalid credential re-render with the preserved
      `next` field, successful shell POST to `/_m/auth/sign-in`, authenticated admin render through
      `role('admin')`, and shell POST to guarded `/_m/auth/sign-out` clearing the cookie. Same-session
      evidence: `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`.
      Remaining gap unchanged: commerce still uses the deterministic Better Auth-like test surface
      rather than the pinned real Better Auth package, and B7 remains open.
      Partial commerce shell evidence 2026-06-12: `examples/commerce/src/app.ts` now renders the
      guarded adapter sign-out form from the `role('admin')` page after `commerceSession.parse`,
      keeping the credential lifecycle on Jiso mutation forms per SPEC §6.5 and §10.3. The shell
      HTTP test covers member sign-in followed by `/admin` returning the 403 role-failure path,
      admin sign-in rendering the `/admin` page with `/_m/auth/sign-out`, and the existing guarded
      sign-out POST clearing the session cookie. Same-session evidence:
      `pnpm exec vitest --run examples/commerce/src/app.test.ts examples/commerce/src/app-shell.test.ts`.
      Partial reference-app evidence 2026-06-12: `examples/reference` now exists as a focused
      starter/reference adoption app for the blessed adapter. It wires a Better Auth-like
      implementation through `betterAuthSession`, `betterAuthSignInEmailMutation`,
      `betterAuthSignOutMutation`, adapter `authed()`, and adapter `role('admin')`; its tests
      prove no-JS credential forms, invalid-credential rendering, cookie-backed session mapping,
      anonymous `/account` redirect, member `/admin` 403, admin `/admin` render with guarded
      sign-out, and sign-out cookie clearing. `vite.config.ts` includes
      `examples/reference/tsconfig.json` in `vp run typecheck-examples` so the reference app stays
      typechecked with the rest of the standing gates.
      Partial real-package evidence 2026-06-12: `examples/reference/src/app.ts` now exposes
      injectable auth bindings while keeping the deterministic fake as the default app surface.
      `examples/reference/src/app.test.ts` instantiates those same reference-app bindings with
      real `better-auth@1.6.17` plus its memory adapter, signs up member/admin users through
      `auth.api.signUpEmail`, then proves no-JS sign-in, cookie-backed `betterAuthSession`,
      anonymous `/account` redirect, member `/admin` 403, admin `/admin` render, and guarded
      sign-out cookie clearing. `examples/reference/package.json` pins the real package and
      same-session evidence is:
      `pnpm exec vitest --run examples/reference/src/app.test.ts`,
      `pnpm exec tsc -p examples/reference/tsconfig.json --noEmit`, and
      `pnpm exec vp check --fix examples/reference/src/app.ts examples/reference/src/app.test.ts examples/reference/package.json examples/reference/tsconfig.json plans/auth.md IMPLEMENT_v1.md pnpm-lock.yaml`.
      Remaining gap at that point: B7 remained open until the reference app was represented in
      the graph/audit vocabulary and passed the unguarded/unscoped audits with authenticated flows.
      Partial graph/audit evidence 2026-06-12: `examples/reference/src/app.ts` now exports a
      typed `referenceGraph` for the authenticated reference surfaces: guarded `/account`,
      `role:admin` `/admin`, and guarded `auth/sign-out`, plus session-scoped `user` owner-domain
      facts. `examples/reference/src/app.test.ts` proves `fwCheck(referenceGraph)` is clean,
      `fwExplain(referenceGraph, { unguarded: true })` and `{ unscoped: true }` both return
      `SUMMARY total=0`, and page/mutation explanations include the guarded authenticated
      surfaces. Same-session evidence:
      `pnpm exec vitest --run examples/reference/src/app.test.ts`,
      `pnpm exec tsc -p examples/reference/tsconfig.json --noEmit`, and
      `pnpm exec vp check --fix examples/reference/src/app.ts examples/reference/src/app.test.ts examples/reference/package.json examples/reference/tsconfig.json pnpm-lock.yaml`.
      Completion evidence 2026-06-12: mutation graph facts now support an explicit `auth`
      declaration for intentionally public credential entrypoints. `packages/core/src/graph.ts`
      exposes `MutationExplain.auth`, `packages/cli/src/index.ts` prints it in mutation explain
      output and treats it as an auth declaration for `fw explain --unguarded`, and
      `packages/cli/src/index.test.ts` covers a `custom:better-auth-credential` sign-in mutation
      that explains with `auth:` while producing `SUMMARY total=0` for unguarded audit.
      `examples/reference/src/app.ts` now includes `auth/sign-in` in `referenceGraph` with that
      declaration, so the same graph represents the real Better Auth sign-in route, guarded
      sign-out mutation, guarded `/account`, and `role:admin` `/admin`; the reference tests prove
      `fwCheck`, `fwExplain` page/mutation output, and unguarded/unscoped audit cleanliness.
      Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts -t "mutation auth declarations|unguarded mutations" examples/reference/src/app.test.ts packages/core/src/graph.test.ts` and
      `pnpm exec vp check packages/core/src/graph.ts packages/cli/src/index.ts packages/cli/src/index.test.ts examples/reference/src/app.ts examples/reference/src/app.test.ts examples/reference/package.json examples/reference/tsconfig.json IMPLEMENT_v1.md plans/auth.md pnpm-lock.yaml`.

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

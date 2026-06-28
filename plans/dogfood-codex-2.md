# Dogfood Codex 2

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures framework,
template, docs, and dev-tooling papercuts found while dogfooding local Kovo with one
baseline starter and five advanced throwaway apps.

Meta-theme: the runtime paths mostly worked, but deploy/check metadata and multi-form
anonymous mutation plumbing still create fail-closed author friction.

## Scope

Exercised local packages from `/Users/mini/kovo` via rebuilt `packages/create-kovo/dist/index.mjs`
and `scripts/link-local-kovo.mjs`. Apps live under `/Users/mini/kovo-dogfood-codex-20260627-*`:

- baseline: fresh SQLite starter; `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, dev HTTP smoke.
- ladder: state islands, data-bind/derive attributes, query-backed regions, enhanced mutations, optimism, live-target attempts.
- navquery: typed routes/links/search, typed reads, `/_q`, MPA redirects, CSRF mutation, `<Defer>`.
- authguards: Better Auth starter login, session roles, route/query/mutation guards, owner checks, error shells, rate-limit guards.
- files: endpoint/webhook/raw upload-like flow, `respond.file`/`respond.stream`, `rootedFiles`, capability download endpoint.
- registry-ui: `renderRegistry`/`renderTree`, `@kovojs/ui`, `@kovojs/icons`, theme tokens, accessibility assertions.

No production code was intentionally edited. Security/soundness findings were not confirmed, so no
new `bugz` ledger was created.

## Issues

### A. Mutation And Refresh Plumbing

- [x] **Anonymous pages with multiple mutation forms mint one `kovo_csrf` cookie per form, making earlier form tokens unusable.** (medium, framework; found by ladder)
  - Observed behavior: `GET /ladder` emitted four `Set-Cookie: kovo_csrf=...` headers and four hidden CSRF tokens. Posting the first form with a normal curl cookie jar returned `422`; posting the same token with the first emitted cookie returned `303 /ladder`.
  - Root cause: `renderMutationCsrfField` resolves a binding with `{ mintAnonymous: true }` for each form (`packages/server/src/csrf.ts:158-169`); `resolveCsrfBinding` mints a fresh anonymous secret when the request has no usable cookie (`packages/server/src/csrf.ts:338-365`); page rendering appends every collected cookie (`packages/server/src/app-document.ts:93,114-119`), so the browser retains only the last same-name cookie.
  - Why it matters: a public anonymous page with more than one CSRF-protected mutation form can fail all but the last action before app code runs, breaking normal no-JS and enhanced mutation workflows covered by SPEC §9.1 and §10.3.
  - Repro evidence: verifier started the built ladder app on `127.0.0.1:5200`; `GET /ladder` had four `kovo_csrf` cookies; first-form POST with cookie jar returned `422`; first-form POST with `Cookie: kovo_csrf=<first Set-Cookie value>` returned `303`.
  - Acceptance: render one stable anonymous CSRF binding per response/request context, or otherwise ensure every emitted form token validates against the cookie a browser will retain; add a multi-form anonymous page test that submits the first and last generated forms with a normal cookie jar.
  - Integrated evidence (2026-06-28): `packages/server/src/csrf.ts` now caches the
    minted anonymous CSRF binding in the JSX framework render context, so a
    sessionless document emits one cookie and signs every mutation form token
    against that retained secret. `packages/server/src/csrf.test.ts` proves two
    rendered mutation forms emit one `kovo_csrf` cookie and both form tokens
    validate against that cookie. Verification: `pnpm exec vitest run
packages/server/src/csrf.test.ts`, `pnpm run check:vp`, and `git diff --check`
    PASS.

- [x] **Build KV310 ignores inline optimistic entries unless the invalidated query is also in `mutation.registry.queries` or live targets.** (medium, framework-build-check; found by navquery/authguards/ladder)
  - Observed behavior: mutations with valid inline `optimistic` entries still produced `WARN KV310` for touch-graph-derived query invalidations until the app duplicated those queries in `registry.queries`.
  - Root cause: build graph extraction derives invalidates from `registry.queries` plus live-target queries (`packages/cli/src/commands/build-export.ts:583-601`) and emits optimistic coverage only for that same subset (`packages/cli/src/commands/build-export.ts:609-628`); later KV310 checks touch-graph/query domain intersections (`packages/cli/src/graph-output.ts:2130-2145`), which can be wider than the coverage facts.
  - Why it matters: authors can follow the mutation API and diagnostic intent yet still fail the deploy gate until they learn to repeat query membership in a separate registry field. This strains SPEC §10.6 / KV310 coverage ergonomics.
  - Repro evidence: verifier created and removed a minimal navquery file; `kovo build ... --no-cache` with `registry: { touches: [contactDomain] }` emitted `WARN KV310 verifyAddContact -> verifyContacts`; adding only `queries: [verifyContactsQuery]` removed the warning.
  - Acceptance: build preflight should emit optimistic coverage facts for every declared optimistic key that intersects derived writes/touches, or KV310 should diagnose the missing `registry.queries` prerequisite explicitly with a focused fixture.
  - Integrated evidence (2026-06-28): `packages/cli/src/commands/build-export.ts`
    now emits optimistic coverage for every authored `mutation.optimistic` query key,
    not only keys duplicated in `registry.queries` or live targets.
    `packages/cli/src/index.kovo-build.test.ts` proves `kovo build` accepts a mutation
    with `registry: { touches: [contactDomain] }` plus inline
    `optimistic: { contacts: 'await-fragment' }` and no `registry.queries`
    duplication. Verification: `pnpm exec vitest run
packages/cli/src/index.kovo-build.test.ts`, `pnpm run check:vp`, and
    `git diff --check` PASS.

- [x] **Query-backed component roots can render without refresh/live-target stamps, leaving enhanced mutation refresh with an empty body.** (medium, framework; found by ladder; duplicate family)
  - Observed behavior: `GET /ladder` had no `kovo-deps`, `kovo-fragment-target`, `kovo-live-component`, or `kovo-live-token` despite `LadderRegion` declaring `queries: { ladder: ladderQuery }`; an enhanced-style mutation returned `200`, `Kovo-Changes: [{"domain":"ladderItem"}]`, `text/vnd.kovo.fragment+html`, and a 0-byte body.
  - Root cause: `component-root-stamps.ts` only stamps when it has component query metadata and a usable component name (`packages/server/src/component-root-stamps.ts:21-79`); `jsx-runtime` calls `stampKovoComponentRoot` without a generated component name and relies on `component.name` (`packages/server/src/jsx-runtime.ts:543-571`). The built throwaway app had `var LadderRegion = component({ queries: ... })` but no emitted name assignment, so metadata returned null.
  - Why it matters: SPEC §9.1/§9.3 refresh and live-target behavior depends on DOM target metadata. Without it, successful mutations can visibly do nothing.
  - Repro evidence: verifier grepped `/ladder` output for the four stamp attributes and found zero occurrences; the enhanced mutation response had change metadata and an empty body.
  - Acceptance: compiler/runtime should preserve a stable component name for query-backed component roots or otherwise pass the generated component identity into stamping; add an SSR test asserting initial query-backed roots carry refresh target metadata.
  - Integrated evidence (2026-06-28): `packages/server/src/component-root-stamps.ts`
    now exposes the generated `assignDerivedComponentName(...)` ABI and standalone
    lowering wraps top-level `component({ ... })` declarations with source-derived
    component identities. `packages/server/src/route-jsx.test.tsx` proves a
    source-derived query-backed component root renders `kovo-c`, `kovo-deps`,
    `kovo-fragment-target`, `kovo-live-component`, and `kovo-live-token` stamps.
    Verification: `pnpm exec vitest run packages/compiler/src/vite.test.ts
packages/server/src/route-jsx.test.tsx` and `pnpm exec vp check --fix
packages/compiler/src/source-derived-lowering.ts packages/compiler/src/vite.test.ts
packages/server/src/component-root-stamps.ts packages/server/src/internal/wire.ts
packages/server/src/route-jsx.test.tsx` PASS.

### B. Build And Posture Audits

- [x] **Build preflight `UNGUARDED` audit ignores explicit access facts and generic runtime guard facts.** (medium, framework; found by authguards; regression/variant)
  - Observed behavior: the authguards app declared structured access metadata and runtime guards on routes, queries, mutations, auth mutations, and `/api/health`, but `pnpm run build:prod` failed with `WARN UNGUARDED` for every surface. Runtime smoke confirmed `/case/case-admin-1` and `/admin` returned `403` for a non-admin demo session.
  - Root cause: `build-export.ts` passes `accessFactsFromApp(app)` into the graph (`packages/cli/src/commands/build-export.ts:472-481`), and compiler graph merging is additive; the false warning comes from `graph-output.ts` calling `unguardedAccesses(graph)` (`packages/cli/src/graph-output.ts:877-878`) and inspecting raw endpoint/mutation/query/page guard labels instead of `graph.access` (`packages/cli/src/graph-output.ts:1726-1770`). Build facts use placeholder labels such as `query.guard`, `mutation.guard`, and `route.guard` (`packages/cli/src/commands/build-export.ts:578-580,597-600,652-653`), while the audit recognizes only narrower labels such as `authed` or `role:*` (`packages/cli/src/graph-output.ts:1942-1948`).
  - Why it matters: guarded apps fail the deploy gate with a misleading security warning even though runtime enforcement works; this is a fail-closed build papercut, not an auth bypass.
  - Repro evidence: verifier ran `pnpm run build:prod` in `/Users/mini/kovo-dogfood-codex-20260627-authguards` and reproduced the `UNGUARDED` warnings; then signed in and confirmed guarded paths returned `403`.
  - Acceptance: the `UNGUARDED` audit should consume normalized access facts and treat explicit public/verified access plus generic guard-chain facts as satisfying SPEC §10.2/§11.3, with a build fixture proving guarded pages/queries/mutations stay green.
  - Integrated evidence (2026-06-28): `packages/cli/src/graph-output.ts` now overlays
    normalized `graph.access` decisions before legacy raw guard-label heuristics, so
    `guard`/`public`/`verified` access facts suppress false `UNGUARDED` warnings while
    `missing` still feeds KV436. `packages/cli/src/index.kovo-check.test.ts` proves
    generic `query.guard`/`route.guard`/`mutation.guard` facts and a public endpoint
    stay green, and `packages/cli/src/index.kovo-build.test.ts` proves the real
    `kovo build` preflight accepts guarded page/query/mutation surfaces without
    `UNGUARDED`. Verification: `pnpm exec vitest run
packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-build.test.ts`,
    `pnpm run check:vp`, and `git diff --check` PASS.

- [x] **`createStorageDownloadEndpoint` does not declare `reservedHeaders` for its own `X-Content-Type-Options` header.** (medium, framework; found by files)
  - Observed behavior: after app-side workarounds for already-known capability endpoint metadata gaps, a minted `/_kovo/storage/...` URL returned `500` in dev/posture verification. Adding `reservedHeaders: ['X-Content-Type-Options']` to the returned declaration made the same request return `200`.
  - Root cause: `createStorageDownloadEndpoint` writes `X-Content-Type-Options: nosniff` (`packages/server/src/capability-route.ts:307-318`) but declares `response` without `reservedHeaders` (`packages/server/src/capability-route.ts:321-337`). Endpoint posture verification rejects reserved security headers not declared in `response.reservedHeaders` (`packages/server/src/endpoint.ts:341-355,368-378`).
  - Why it matters: a framework-owned secure download helper should be mountable without mutating its descriptor. The failure is fail-closed in dev/CI posture verification, but it blocks the app-author workflow.
  - Repro evidence: verifier temporarily removed only the app workaround's `reservedHeaders`, kept access/auth/appOwnedSafety metadata, and `GET` of a minted capability URL returned `500` with `reserved response header x-content-type-options was written without response.reservedHeaders declaration`; restoring it returned `200`.
  - Acceptance: the helper should declare every reserved header it writes; add a capability-download endpoint-posture test that exercises the generated endpoint descriptor directly.
  - Integrated evidence (2026-06-28): `packages/server/src/capability-route.ts` declares
    `reservedHeaders: ['X-Content-Type-Options']` on the framework-owned download endpoint posture,
    and `packages/server/src/capability-route.test.ts` locks that descriptor while existing
    `runEndpoint(...)` cases exercise posture verification.
  - Verification: `pnpm exec vitest run packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts`
    passed.

### C. Type And Diagnostic Ergonomics

- [x] **`query().instanceKey` is typed as `unknown` instead of the validated query args input.** (low, framework type ergonomics; found by navquery)
  - Observed behavior: with `args: s.object({ id: s.string() })`, `load(input: { id: string })` is typed, but `instanceKey(input) { input.id }` fails TypeScript because `input` is `unknown`. The starter sound-subset discourages the cast authors naturally reach for.
  - Root cause: query definitions type `instanceKey` as `(input: unknown) => string | undefined` across the args declarations (`packages/server/src/query.ts:147-153,190-204,215-227`); the typed-args overload preserves `Input` for `load` but not `instanceKey` (`packages/server/src/query.ts:286-300`).
  - Why it matters: arg-backed typed reads are a core SPEC §9.4 path; the identity hook needs the same validated input as `load` and `version`.
  - Repro evidence: verifier created and removed a temporary navquery file; `pnpm exec tsc --noEmit --pretty false --project tsconfig.json` produced `TS18046: 'input' is of type 'unknown'` for `input.id` inside `instanceKey`.
  - Acceptance: type `instanceKey` against `Input` for typed-args queries and add a type test proving casts are unnecessary.
  - Integrated evidence (2026-06-28): `packages/server/src/query.ts` now exposes
    `QueryInstanceKey<Input>` and applies it to typed-args query definitions;
    `packages/server/src/query-endpoint.test.ts` proves `instanceKey(input)` can read
    `input.id` without casts. Verification: `pnpm exec vitest run
packages/server/src/query-endpoint.test.ts packages/server/src/route.test.ts
packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts
packages/server/src/api/app.test.ts`, `pnpm run check:api-surface`, `pnpm run
check:vp`, and `git diff --check` PASS.

- [x] **Optional route search schema fields infer `undefined`, which violates the route search `Record<string, JsonValue>` bound.** (medium, framework type ergonomics; found by navquery; regression/follow-up)
  - Observed behavior: `route('/optional-search', { search: s.object({ next: s.string().optional() }) })` fails TypeScript because `{ next: string | undefined }` is not assignable to `Record<string, JsonValue>`.
  - Root cause: route/search types constrain `Search` to `Record<string, JsonValue>` (`packages/core/src/index.ts:335-349`; `packages/server/src/route.ts:68-69,171-178,191-219,277-287,315-325`), while schema `.optional()` returns a schema whose value includes `undefined` (`packages/server/src/schema.ts:282,390`).
  - Why it matters: optional search params are ordinary typed navigation ergonomics under SPEC §6.4; authors currently encode absence as `''` or a default instead of the natural optional shape.
  - Repro evidence: verifier created and removed a temporary navquery file; `pnpm exec tsc --noEmit --pretty false --project tsconfig.json` produced `TS2322` for the optional search schema.
  - Acceptance: support absent optional search keys at the route type boundary, or provide a first-class optional-query-param helper whose output satisfies the route schema bound.
  - Integrated evidence (2026-06-28): `packages/core/src/index.ts` now publishes
    `RouteSearchValue = JsonValue | undefined`, and `packages/server/src/route.ts`
    accepts search schemas whose optional fields include `undefined`.
    `packages/server/src/route.test.ts` and `packages/core/src/index.test.ts` prove
    optional search fields type-check, omit `undefined` from `href`, and remain
    available to GET form helpers. Verification: same focused suite and gates above.

- [x] **Query binding validation follows the statically extracted Drizzle projection shape, not the broader load return annotation, with weak author guidance.** (low, docs/diagnostic; found by navquery)
  - Observed behavior: a query loader returning a typed nested result such as `{ item, related }` failed KV302 for a binding like `contact.item.name`; flattening to the projection-like shape passed.
  - Root cause: Drizzle extraction selects static projection shape and only falls back to output shape when static selection is empty (`packages/drizzle/src/static.ts:1521-1555,2312-2323`; `packages/drizzle/src/static/query-shapes.ts:78-115`); compiler binding validation then checks `data-bind` paths against those query-shape facts (`packages/compiler/src/analyze/query-shapes.ts:46-52`; `packages/compiler/src/validate/bindings.ts:39-57`).
  - Why it matters: the behavior is conservative and defensible, but the author-visible TypeScript return annotation suggests the path exists. Diagnostics/docs should explain the projection-shape contract or expose an explicit output-shape path.
  - Repro evidence: source-level verifier confirmed the extractor/validator path; navquery authoring hit KV302 until the result shape was flattened.
  - Acceptance: improve KV302 help/docs for Drizzle-backed query bindings so authors know bindings follow the proven projection shape unless an explicit supported output shape is present.
  - Integrated evidence (2026-06-28): `packages/core/src/diagnostics.ts` KV302 help
    now explains the Drizzle projection-shape contract, and
    `site/content/guides/queries.md` documents binding the projected shape.
    `packages/core/src/diagnostics.test.ts` locks the diagnostic text. Verification:
    same focused suite and gates above.

## Refuted / Not Carried Forward

- Registry/UI track: `renderTree`, UI primitives, icons, theme tokens, and accessibility assertions passed all gates. Missing `@kovojs/icons` in local dogfood app dependencies is already `plans/papercut-super-2.md` D3.
- Better Auth / Drizzle peer warning: reproduced on fresh installs, but already tracked in `plans/papercut-super-1.md` G3 and later explicitly not carried forward.
- Capability endpoint build metadata gaps: direct `createStorageDownloadEndpoint` KV423/KV436 and webhook appOwnedSafety failures are already `plans/papercut-super-2.md` A1/B1; this ledger only carries the narrower reserved-header runtime/posture variant.
- Node preset `undici` runtime dependency: reproduced in the files track, already tracked in `plans/papercuts-3.md`.
- Guard runtime security: authguards confirmed owner route/mutation denials, admin role denial, and per-form CSRF on auth/guarded forms. No auth bypass was found.
- Query-backed empty fragment/lost live target stamps: carried above as a concrete current reproduction, but it belongs to the existing family in `plans/papercuts-1.md` and `plans/papercuts-2.md`, not a wholly new category.
- `<kovo-live>` SSE: source comments in `packages/core/src/index.ts:269-272` explicitly mark the subscriber unimplemented/roadmap-only; no no-op `live: true` field was found.
- Typed route `Link`/`href`, guarded `/_q` cache posture, and `<Defer>` route content all worked in the navquery app.
- Raw upload-like endpoint, `respond.file`/`respond.stream`, rooted local file serving, and capability token verification worked after known metadata workarounds.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`: rebuilt local scaffold CLI before dogfood.
- Baseline app: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and dev HTTP smoke passed; root redirected to login and rendered a CSRF form.
- Registry/UI app: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and `/registry` dev smoke passed.
- Files app: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and dev smokes for endpoint/webhook/file/capability flows passed after app-side known-workaround metadata.
- Navquery app: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and dev smoke for redirects, typed pages, `/_q`, CSRF mutation, and `<Defer>` passed.
- Authguards app: `pnpm exec tsc --noEmit`, sound-subset, and `pnpm run test` passed; `pnpm run check`/`build:prod` intentionally failed with confirmed false-positive `UNGUARDED` and KV310 warnings; dev runtime guard smoke passed.
- Ladder app: `pnpm run check`, `pnpm run test`, and `pnpm run build:prod` passed; dev/built-server smokes reproduced the CSRF multi-cookie failure and empty enhanced-refresh body.
- Verifier agents independently confirmed: capability reserved-header omission, navquery KV310/`instanceKey`/optional search/query-shape behavior, authguards `UNGUARDED` false positives, and ladder CSRF/stamp findings.
- 2026-06-28: Fixed and verified the capability download reserved-header posture with
  `pnpm exec vitest run packages/server/src/capability-route.test.ts packages/server/src/endpoint.test.ts`.
- 2026-06-28: Fixed and verified Dogfood C type/diagnostic ergonomics with
  `pnpm exec vitest run packages/server/src/query-endpoint.test.ts packages/server/src/route.test.ts
packages/core/src/index.test.ts packages/core/src/diagnostics.test.ts packages/server/src/api/app.test.ts`,
  `pnpm run check:api-surface`, `pnpm run check:vp`, and `git diff --check`.
- 2026-06-28: Fixed and verified build `UNGUARDED` access-fact false positives with
  `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts
packages/cli/src/index.kovo-build.test.ts`, `pnpm run check:vp`, and `git diff --check`.
- 2026-06-28: Fixed and verified multi-form anonymous CSRF binding reuse with
  `pnpm exec vitest run packages/server/src/csrf.test.ts`, `pnpm run check:vp`, and
  `git diff --check`.
- 2026-06-28: Fixed and verified build KV310 inline optimistic coverage with
  `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts`, `pnpm run check:vp`,
  and `git diff --check`.

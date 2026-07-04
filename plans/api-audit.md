# API Audit — 2026-07-03

**Scope:** Every API reachable from the 26 guides in `site/content/guides/`, plus the full
manifest-public surface of the packages behind them (`public-packages.json`).
**Lens:** Conservative JS framework API review — less public API is more; internals leak forever.
Two questions per API: (1) does it make sense / could it be removed or simplified? (2) is it
accurately documented with useful examples?
**Sources:** `SPEC.md` + `spec/*.md`, `rules/api-surface.md`, `rules/accessibility-conformance.md`,
`STABILITY.md`, `public-packages.json`, `site/gen/api/*.md`, `examples/`, source declarations.
**Commands:** `node .claude/skills/audit-public-api/scripts/inventory-public-api.mjs` (100 public
subpaths, ~1.9k exports); `pnpm run check:api-surface` → green (`public-exports-needing-attention=0`,
`recursive-publicness-needing-attention=821`, at baseline).
**Git:** `main` @ `2345f0845`.
**Method:** 5 parallel read-only audit agents, one per guide group + owning packages; main-thread
synthesis. Guide samples were verified against source declarations and real call sites; the
routing slice additionally type-checked 9 samples with `tsc` against built dist types and
runtime-probed `component()` against `packages/core/dist`.

## Executive Summary

- `Definitely remove`: **12 symbol families** (~320 exported symbols, dominated by the
  headless-ui transition-machinery types and the `@kovojs/ui` `*Styles` tables)
- `Borderline`: **~40 symbols/families** (mostly plumbing on app-facing roots and duplicate vocabulary)
- `Should keep`: the large majority of the authoring surface — `route`/`layout`/`createApp`,
  `query`/`mutation`/`domain`/`form`, guards/schemas/CSRF/webhooks, `component`/`derive`/`handler`,
  trust sinks, `@kovojs/style`, the test packages, and the CLI programmatic core are well designed
  and SPEC-grounded.
- **Docs:** 26 guides audited. 2 are fully clean (`postgres-authz-policy.md`,
  `compiler-internals.md`); ~19 contain concrete defects, including **at least 12 code samples that
  cannot compile or throw at runtime** and **several fabricated claims** (APIs, CLI output, and
  starter files that do not exist).

Highest-leverage items, in order:

1. **The data-layer story the guides teach does not exist.** `queries.md`, `mutations.md`, and
   `data-layer.md` center on `write()` + a `db.<domain>.<write>` call shape that nothing in the
   framework constructs, parses, or enforces; the reference app writes with raw Drizzle. Remove
   `write`/`tag` from the public root and rewrite the guides to the enforced reality, or implement
   SPEC §10.3.
2. **`islands.md` documents a `component({ clocks })` API that throws at runtime** (core's key
   allowlist rejects it while the compiler validates it) — a direct core↔compiler contract
   contradiction.
3. **The flagship `endpoints-webhooks.md` webhook example throws at module load** (declares writes
   with `idempotency` but no `replayStore`), and its `hmacSignature` call shape is fabricated.
4. **`@kovojs/better-auth#role` silently breaks `crossOwnerRead`**: it never calls
   `markPassedRoleGuard`, so the runtime role gate always denies for apps using it — while
   `security.md` recommends the combination.
5. **Latent codegen break:** `@kovojs/drizzle` derive-codegen emits
   `import { now, tempId } from '@kovojs/browser'` but `now` is not exported from the browser root
   (or `./generated`) — any derived transform using a `now` placeholder emits an unresolvable import.
6. **~266 headless-ui transition-machinery types and 44 `@kovojs/ui` `*Styles` tables are public**
   in violation of the generated-ABI boundary and `STABILITY.md:27-28` respectively — together
   roughly a quarter of the entire public symbol count.
7. **Fabricated tooling claims**: the starter `graph-assertions` script (`kovo-explain.md`,
   repeated in `deployment.md` and `testing.md`), the `kovo explain --capabilities` capability-mint
   audit (`security.md`), and `kovo emit` (`queries.md`) do not exist.

## Coverage Ledger

| Package | Public subpaths | Exports reviewed | Primary evidence | Notes |
| --- | --- | ---: | --- | --- |
| `@kovojs/core` | `.` | ~120 (component 14, route/link 10, query/form/storage ~50, verifier/secret ~48, registries 5) | source + `site/gen/api/core.md` + 481 example imports | full root covered across 4 slices |
| `@kovojs/server` | `.` | ~430 of 509 (routing/render ~155, security/session/schema ~195, data-layer ~75) | full source reads of route/guards/csrf/schema/endpoint/webhook/query/mutation/domain files; 9 samples tsc-checked | remaining ~80 are task/postgres-runtime internals reviewed by family |
| `@kovojs/server` | `./build`, `./testing`, `./vite` | 17 + 6 + 3 | build.ts (KV417/445/446), testing.ts, vite.ts | all reviewed |
| `@kovojs/browser` | `.`, `./client` | 24 + 78 | src read in full; consumer grep; compiler bootstrap emit checked | `./client` reviewed by family |
| `@kovojs/drizzle` | `.` | 38/38 | drizzle-surface.ts, cas.ts, runtime-metadata.ts; gen-doc diff | 8 exports missing from API ref |
| `@kovojs/better-auth` | `.` | 32/32 | all src files read | |
| `@kovojs/cli` | `.` + `kovo` bin | 18 exports + 10 commands, all flags | api.ts, commands-manifest.ts vs impls, locked format tests | |
| `@kovojs/test` | 7 subpaths | 63 | all subpath sources read (html-fragment by family) | |
| `@kovojs/headless-ui` | 34 subpaths + `./types` | 699 (mechanical classify; 4 families deep-read) | public barrels vs `generated.ts` vs `@kovojs/ui` consumers | |
| `@kovojs/ui` | root + 44 subpaths | 460 (pattern audit; 8 files deep-read) | registry.json, copy-in.test.ts, `site/gen/api/ui.md` | |
| `@kovojs/style` | `.` | 35/35 | index/engine/theme read; every styling.md claim checked | |
| `@kovojs/icons` | root + 1,740 glyph subpaths | root 2/2 + 1 glyph sampled | icon-base.ts, gen doc | generator-uniform family |
| `create-kovo`, `@kovojs/compiler`, `@kovojs/devtool` | bins / empty / private | boundary-verified | package.json + manifest | boundaries correct (see devtool guide finding) |

Guides: all 26 read end-to-end by their owning slice.

## Definitely Remove

### `@kovojs/headless-ui/<primitive>#<transition-machinery types>` (family, ~266 exports)
**Current exposure:** public on all 34 primitive subpaths (`*ChangeOptions`, `*KeyDownOptions`,
`*ChangeResult`, `*TriggerEvent`, `*ChangeDetail`, `*ChangeReason`, …).
**Evidence:** these types exist solely to type transition functions exported ONLY from
`./generated`, whose header forbids app imports (`packages/headless-ui/src/generated.ts:2`); e.g.
`packages/headless-ui/src/public/select.ts:13-39` exports 17 such types whose functions are absent
from the public barrel. The styled layer consumes only builders + item/state types
(`packages/ui/src/select.tsx:3-12`). `rules/api-surface.md` assigns "types needed to type that ABI"
to generated subpaths.
**Recommendation:** move to `./generated` via the barrel generator
(`packages/ui/scripts/primitive-component-manifest.mjs`); keep `*State`/`*Item`/
`*AttributeOptions`/`*PrimitiveAttributes`, builders, and value helpers public. Halves the
headless-ui public surface.
**Migration:** none for apps (0 genuine app-source imports found; the one example consumer is
`examples/gallery/src/primitive-actions.ts:3-4`, which already imports `./generated`/`./internal`
in violation of the boundary and should be fixed regardless).

### `@kovojs/ui/<component>#<component>Styles` (family, 44 exports)
**Current exposure:** public const on every versioned subpath (`buttonStyles`
`packages/ui/src/button.tsx:151`, `selectStyles` `select.tsx:149`, …), documented in
`site/gen/api/ui.md`.
**Evidence:** `STABILITY.md:27-28`: "Compiled atomic-class strings and internal style tables are
not part of the versioned surface." Zero importers repo-wide; the typed `style`/`styles` override
props are the sanctioned channel (components.md:39-40).
**Recommendation:** stop exporting from the versioned modules; copy-in source keeps them local.
**Migration:** none (zero usage).

### `@kovojs/server#write` + `#WriteDefinition`
**Current exposure:** public root (`api/data.ts:22,65`; identity fn at
`mutation/definition.ts:143-152`).
**Evidence:** zero consumers of its output — neither `packages/drizzle/src/static.ts` nor the
compiler parses authored `write({touches})`; touch graphs derive from Drizzle SQL, and declared
touches ride `MutationRegistry.touches`. 0 named imports/examples. SPEC §10.3
(`spec/10-data-plane.md:143-163`) prescribes a *different* two-arg shape that also doesn't ship.
Yet `queries.md`/`data-layer.md` teach it as the load-bearing center of the data layer.
**Recommendation:** remove from the public root until the SPEC §10.3 domain-write mechanism exists;
rewrite guides to the enforced reality (analyzed Drizzle writes + registry-declared touches).
**Migration:** zero external usage; guide rewrite only.

### `@kovojs/server#tag` + `#Tag`
**Evidence:** `tag()` byte-identical to `domain()`; `Tag` a bare alias of `Domain`
(`domain.ts:33-53`); 0 imports; only doc mention `data-layer.md:45-49`.
**Recommendation:** remove; `domain('billing:invoice')` says the same thing. Migration: rename in docs.

### `@kovojs/server#GuardFailure`
**Evidence:** self-described back-compat alias of `GuardDenial` (`guards.ts:67-76`), 0 imports —
CLAUDE.md technical-preview bias forbids compat aliases.
**Recommendation:** remove. Migration: mechanical rename.

### `@kovojs/server#EndpointReason` `purpose` synonym
**Evidence:** two spellings of one required field (`endpoint.ts:139-143,219-222`); no `purpose:`
usage in docs/examples/templates.
**Recommendation:** keep `reason`, drop the synonym branch.

### `@kovojs/better-auth#role` (replace body, or drop)
**Evidence:** weaker parallel reimplementation of `guards.role`
(`packages/better-auth/src/guards.ts:53-65`): no proven-principal check, never calls
`markPassedRoleGuard`, so `db.crossOwnerRead(..., { role: 'admin' })`'s runtime gate
(`postgres-runtime.ts:983`) **always denies** for apps using it, and it carries no guard audit
facts (invisible to `--unguarded`). Fails closed but contradicts `security.md`'s admin recipe.
**Recommendation:** delegate internally to `guards.role` (keeping the typed-role overload) or drop
(2 imports, 1 example). This is also a **bug fix**, not just surface hygiene.

### `@kovojs/server#createElement` (root re-export)
**Evidence:** barrel leak (`packages/server/src/index.ts:2`); 0 imports; the JSX-transform homes
`./jsx-runtime`/`./jsx-dev-runtime` already exist.
**Recommendation:** drop from root; keep on `./jsx-runtime` only.

### `@kovojs/server#{MutationResponseHeaderValue, MutationResponseHeaders}`
**Evidence:** pure aliases of `ResponseHeaderValue`/`ResponseHeaders` (`response.ts:20-24`), 0 imports.
**Recommendation:** remove; mechanical rename.

### `@kovojs/server#{DeferredQueryChunk, DeferredFragmentChunk, DeferredStreamChunk, DeferredPriority}`
**Evidence:** framework-owned deferred wire chunk shapes (`deferred-stream.ts:11-50`), 0 imports;
the only app authoring surface is `<Defer>` (SPEC §8/§9.1). Referenced by
`RoutePageResponse.deferredChunks` (`response.ts:163`), itself internal-flavored.
**Recommendation:** move to `./internal/wire` (with `RoutePageResponse` or accept the reference).

### `@kovojs/server#meta`
**Evidence:** identity function (`meta.ts:18-20`), 0 imports; `route()` `meta:` takes the plain
object; a third way to say the same thing.
**Recommendation:** delete; pass the object.

### `@kovojs/cli#runKovoCommand`
**Evidence:** JSDoc claims generated maintenance scripts use it; zero call sites repo-wide — the
repo's own consumers bypass it (`site/scripts/export-static.mjs:320` deep-src import;
`examples/gallery/.../kovo-explain-contracts.test.ts:9` uses `main` from `./internal`).
**Recommendation:** remove or demote to `./internal`; the `kovo` bin is the contract. If kept, fix
the false JSDoc.

## Borderline

Grouped by theme; each needs a decision, not necessarily removal.

### Duplicate vocabulary (pick one name)
- `@kovojs/core#query/Query/QueryConfig` vs `@kovojs/server#query` — same exported name, different
  meaning; near-zero app usage of the core handle; the collision already confused the framework's
  own docs (queries.md put `refetchOnFocus` on the wrong one). Rename (e.g. `queryRef`) or absorb
  `refetchOnFocus` into the server definition (`core/src/index.ts:610`, `server/src/query.ts:104`).
- `@kovojs/core#route/Route/RouteOptions` vs `@kovojs/server#route` — core `route()` has 0 imports,
  incompatible options, and the compiler populates `RouteRegistry` without it
  (`core/src/index.ts:425-490`). Remove the core function; keep types if generated code needs them.
- `@kovojs/server#CsrfValidationOptions` = alias of `CsrfOptions` with a JSDoc describing nothing it
  adds (`csrf.ts:62-63`; 25 imports incl. templates). Collapse to one name (ripples into
  `@kovojs/better-auth#BetterAuthCredentialMutationOptions.csrf`).
- `@kovojs/server#CsrfSecret` 5-shape union overlaps `SigningSecret` (`csrf.ts:34-43` vs
  `keyring.ts:68`); consolidate on `SigningSecret` + keyring per the branded-constructor rule.
- `@kovojs/server#JsonSerializable` (0 imports) vs `@kovojs/core#JsonValue` (101 imports)
  (`json-boundary.ts:8`).
- `@kovojs/server#Stylesheet` (document primitive) vs `#stylesheet` (factory) — case-only collision
  on one barrel (`document-structured.ts:186`, `hints.ts:177`); consider `StylesheetLink`.
- `@kovojs/ui/field#FieldError` vs `@kovojs/core#FieldError` — two different public components with
  one name, both appearing in form code (`ui/src/field.tsx:608`, `core/src/index.ts:935`).
- `@kovojs/server#safeRichHtml` dual-homed on server root and `@kovojs/browser` (the home examples
  actually use). Pick one canonical home for a security-sensitive sink.
- `@kovojs/browser#ImportHandlerModule`, `#MutationChangeRecord` duplicated on root and `./client`
  (`handlers.ts:16`). One public home per symbol.
- `@kovojs/test` db handles: `query()`/`sql()` byte-identical; `insert().values()` duplicates
  `write()` (`test/src/pglite.ts:186-238`, `sqlite.ts:66-74`). Collapse.
- `@kovojs/test/harness#KovoTestContext.dbHandle()` returns the `db` property beside it
  (`harness.ts:127-133`). Remove the method.
- `@kovojs/server#Endpoint` base interface nearly identical to `EndpointDeclaration`
  (`endpoint.ts:70-84`); could inline.

### Plumbing/ABI on app-facing surfaces (reclassify)
- `@kovojs/browser/client` DI-seam families (~25-37 of 78 exports): `QueryApplyInterposition`/
  `QueryChunk`/`WireAttribute`, `ClockUpdate*`, `CompiledQuery*` ×6, `VisibleObserver*`,
  `InlineQueryEvent*`, `QueryRefetch*`, `StructuralMorph*`, and the 12-type `dom-like` family —
  public only because `KovoLoaderOptions` exposes framework DI seams (`loader.ts:40-59`); compiled
  bootstraps import from `./generated` (`compiler/src/emit/bootstrap.ts:5,112`); 0 named imports
  each. Split `KovoLoaderOptions` into an app-facing core (`importModule`, `root`, `queryStore`,
  `enhancedMutations`) and move seams + type closures to generated/internal. `installKovoLoader` is
  already `@experimental`, so preview bias favors doing it now.
- `@kovojs/browser#tempId` (+ un-exported `now`): consumed only by compiler-generated optimistic
  modules (`drizzle/src/derive-codegen.ts:52-58`). Move both to `@kovojs/browser/generated` and
  point derive-codegen there. **Fix the missing `now` export either way (latent break).**
- `@kovojs/server` audit-fact accumulators: `drainTrustedAssignFacts`/`drainCapabilityMintFacts`/
  `drainUnsafeRegexFacts`/`drainUnverifiedMimeFacts` (+ fact types) and
  `@kovojs/core#drainSecretRevealAuditFacts` — CLI/graph plumbing on app roots; two have **zero
  consumers anywhere** and JSDoc citing explain modes that don't exist
  (`capability-route.ts:131-138` carries the unwired TODO). Move internal; fix JSDoc.
- `@kovojs/server` capability primitives: `signCapability`/`verifyCapability`
  (`capability-url.ts:172,236`), `createSignUrl`/`deriveDownloadKey`/`CAPABILITY_TOKEN_PARAM`
  (`capability-route.ts`) — raw sign/verify invites hand-built sinks that skip the fail-closed
  route; 0 usage. Keep the high-level pair (`createStorageDownloadEndpoint` + `ctx.signUrl`) public.
- `@kovojs/server` egress families: `installEgressFloor`/`selfProbe`/`EgressFloorInstall`,
  `awsCredential`/`gcpCredential`/`azureCredential`/`CredentialProvider` — 0 imports, no guide
  coverage; internal if `createApp` owns floor install, else needs a guide.
- `@kovojs/server` secret-read boundary: `createSecretBoxingReadDb`/`declareSecretReadCapability` +
  types — consumed by drizzle wiring, not apps; internal candidates
  (`declareSecretReadCapability` could stay as the audited raw-SQL escape but is undocumented).
- `@kovojs/server` CSP render helpers: `renderContentSecurityPolicy`/`cspSha256`/`CspInline*` — 0
  usage; keep `DocumentCspConfig`, move renderers internal (`csp.ts`).
- `@kovojs/server` managed-db adapter hooks: `kovoReadonlyDbHandle`/`kovoDeclaredWriteDbHandle`/
  `createDeclaredWriteDb`/`createAuthorizationCensusDb`/`createPostgresReadonlyClient`/
  `createPostgresScopedClient` + drain/fact types (~15) — export comment says they exist for
  framework-owned adapters (`api/data.ts:119-164`). Keep `readonlyDb`/`Reader`/`Writer`/
  `declarePublicRead` public; move the rest internal.
- `@kovojs/drizzle` runtime-metadata family (8 exports: `extractKovoRuntimeDbMetadata` +
  `KovoRuntime*`): consumed by `postgres-runtime.ts` and create-kovo-scaffolded
  `_kovo/app-runtime-db.ts`; absent from `site/gen/api/drizzle.md` (30 documented vs 38 exported —
  a live surface/docs mismatch). Reclassify generated/internal or render into the API ref.
- `@kovojs/server#{createKovoAppShellViteDevIntegration, kovoAppShellViteDevPlugin}` on the request
  root while `./vite` exists (`index.ts:217`); one consumer (`examples/devtool/vite.config.ts:44`).
  Move to `./vite`.
- `@kovojs/server#{ResolvedAppRateLimitOptions, …}` normalized internal shapes public only via
  `KovoApp.requestLimits` (`app-types.ts:191-211`); `@internal` or narrow the face.

### Design fixes (keep the API, change the shape)
- `@kovojs/core#Component` call signature `(props?: Record<string, unknown>): any`
  (`core/src/index.ts:168-172`): every `component()` descriptor — all 44 `@kovojs/ui` components
  and every app component — is **unchecked at JSX call sites**; contradicts the typed-props story
  in components.md and CLAUDE.md's type-ergonomics rule. **Decision 2026-07-03: full fix, not the
  conservative staged version — see Phase 4 of the remediation plan below.**
- `@kovojs/server#ComponentRegistry` uses a **public structural brand**
  (`render-tree.ts:63-66`) for what SPEC §4.10 calls the pre-approval security boundary — CLAUDE.md
  forbids exactly this shortcut; convert to the module-private symbol/WeakSet pattern already used
  in `document-structured.ts:19-22`.
- `@kovojs/core#Link` dual signature: JSX form silently returns `undefined` at runtime
  (compiler-lowered); overload union is awkward (`core/src/index.ts:542-556`). Consider Link
  JSX-only + `href()` for strings; `LinkDescriptor` adds little.
- `@kovojs/core#ComponentDefinitionInput.fragmentTarget?: never` tombstone + over-loose
  `mutations?: Record<string, unknown>` on the public input (`core/src/index.ts:151-152`). Delete
  the tombstone.
- `@kovojs/server#committedSecretWaiver` waives by value process-globally and discards the
  justification it claims to record (`env.ts:316-324`); 0 usage. Record the fact or drop.
- `@kovojs/cli#kovoCheck` hidden option `paranoidStaticAdvisory` undocumented in JSDoc/gen doc
  (`graph-output.ts:617-620` vs `site/gen/api/cli.md:349`). Document with SPEC rationale or hide.

### Weak-evidence surface (needs a consumer, a guide, or an `@experimental` marker)
- `@kovojs/server` render-tree family (`renderRegistry`/`renderTree`/`parseComponentXml` + types):
  SPEC §4.10-grounded and well documented, but zero example usage — the one rich-text example uses
  `safeRichHtml` instead. Add a real example or mark `@experimental`.
- `@kovojs/server#{rootedFiles, RootedFiles, RootedFileServeOptions}`: 0 imports, no guide/example
  (`file.ts:13-40`). Needs usage or removal.
- `@kovojs/server#renderRoute`/`renderRouteHtml`/`AppRouteRenderContext`: whole-route render hook
  that sits in tension with request-shell.md's "templates are not an app surface" (SPEC §9.5);
  used by examples, so keep, but needs an explicit SPEC citation or `@experimental`.
- `@kovojs/test/test-case` (`kovoTest` et al): `@experimental`, zero consumers outside its own unit
  test; ~30 lines of userland-replicable code. Adopt in the starter/tutorial or drop the subpath.
- `@kovojs/style#defineVars/createTheme/Vars/Theme`: StyleX-legacy second theming system; no
  non-test importers; unmentioned in styling.md; `Theme` vs `KovoTheme` confusable. Document or
  fold internal.
- `@kovojs/drizzle#kovoAnalyzerSummary` + types: documented escape with 0 usage; keep only if a
  guide teaches when to reach for it.
- `@kovojs/server#encryptAtRest` + types: 0 usage, no guide/recipe; internals leak until a guide
  owns it.
- `@kovojs/core` storage family (22 exports): fully gen-documented, used by scaffolds, but zero
  guide coverage and an odd resident of the component-model package. Write the uploads/storage
  guide or move to a subpath.
- `@kovojs/headless-ui/types`: exists correctly for recursive publicness, but even `@kovojs/ui`
  re-declares `CollectionOrientation` locally instead of importing it. Consume it or document why.
- `@kovojs/ui` root `.` exports `{}` while components.md calls it "reserved for package-wide
  helpers". Drop the subpath or fix the wording.
- `@kovojs/server#QueryDefinition.delta`: JSDoc says compiler-populated, but commerce sets it by
  hand (`examples/commerce/src/queries.ts:119`). Document honestly as an app-authored knob until
  compiler derivation lands.
- `@kovojs/better-auth` input schemas (`betterAuthSignInEmailInput` …): JSDoc says "reuse it when
  building the matching login form" but they are not exported from the package root
  (`internal/contracts.ts:184-207`). Export or fix the JSDoc.

## Should Keep (grouped)

- **Routing/app**: `route`, `layout`, `notFound`, `createApp`, `createRequestHandler`,
  `toNodeHandler`, `respond`/outcome types, boundary/region/layout type families, document
  primitives (`Document`/`Head`/… — exemplary sentinel-proof design), hints/meta
  (`stylesheet`, `metaFromQuery`, `prefetch`), `Defer` + streaming vocabulary, static export
  (`exportStaticApp` family), client-module registry. SPEC §§4-9 grounded, heavy example usage.
- **Data plane**: `query`/`mutation`/`domain`/`queue` + definition/context/failure families
  (branded `MutationRequestDb` is a model of the type-ergonomics rule), the query boundary-error
  types (produce readable type errors by design), CAS pair (`compareAndSet` +
  `StaleVersionError`), `@kovojs/drizzle#kovo` annotations (every guide-named option verified
  real), `sql`/`staticSql`/`trustedSql`, `readonlyDb`/`Reader`/`Writer`/`declarePublicRead`,
  `form`/`Form` + GetForm* family, registries, replay stores.
- **Security**: `guards` family (intent-based denials, fail-loud rate limits, `guards.owns` —
  exactly the discriminated-union posture CLAUDE.md asks for), schema family (`s`, KV428/KV434
  hardening), CSRF mint/validate family, `endpoint`/`webhook` families (the
  `csrf:false`+justification unions and the declaration-time write-posture throw are the pattern
  done right), capability download endpoint + `SignUrlContext`, keyring/password (Argon2id-only,
  branded digest), `serverValue`/`trustedAssign`/access decisions, `trustedReveal`/`secret`,
  core verifiers (`hmacSignature`/`standardWebhooks`/`customVerifier`), cookie class floor.
- **Client authoring**: `trustedHtml`/`trustedUrl`/`safeRichHtml` (WeakSet-witnessed), `derive`,
  `handler`, `OptimisticFor` + optimistic family, `component`/`ErrorBoundary`/`Serializable`.
- **Styling/UI**: `@kovojs/style` core (`create`, `attrs`, `keyframes`, `defineTheme`/`tokens`) —
  exemplary tight surface; headless-ui builders + state/item/attribute-options types; `@kovojs/ui`
  parts + `*Props`/`*StateProps`/`*StyleOverrides`/variant unions; `@kovojs/icons` (`IconProps`
  design is a11y-aware and deliberate).
- **Tooling/testing**: `kovoCheck`/`kovoExplain` + option types (opaque-`unknown` inputs with
  documented rationale), the 10-command `kovo` bin (manifest-driven, drift-tested),
  `@kovojs/test` assertions/harness/headers/html-fragment/pglite/sqlite cores,
  `@kovojs/server/build` (all `@experimental`, retention proof matches deployment.md exactly),
  `./testing`, `./vite` (model minimal plugin surface), `@kovojs/browser/client` value core,
  `create-kovo` (zero exports, pure bin), `@kovojs/compiler` empty public boundary (correct).

## Doc Accuracy — per guide

Legend: ✅ clean · ⚠️ minor issues · ❌ material defects (broken samples or false claims).

### Data layer
- ❌ **queries.md** — `query({ refetchOnFocus: false })` on the server definition cannot compile
  (field lives on the core client handle; the definition boundary rejects unknown fields by design,
  `server/src/query.ts:104-163` vs `core/src/index.ts:610`). Loaders shown as
  `request.db.select(...)` while the shipped model threads `context.db` (`Reader`, KV433 exists for
  exactly this) — the guide never mentions `context.db`. `guard: authed` passes an uncalled factory
  (denies every request). First sample lacks the `access` posture KV436 requires. `kovo emit`
  doesn't exist. Wire/stamp claims (kovo-deps, `/_q/`, `Kovo-Build`, domain defaults) all verified
  accurate.
- ❌ **data-layer.md** — the central `db.<domain>.<write>` shape has no framework backing (commerce
  writes raw Drizzle, `examples/commerce/src/domain.ts:240-270`); "the lint is not a hard error" is
  false (KV330 is severity `error`, `core/src/diagnostics.ts:725`); `touches: ['cart']` is a type
  error (`readonly Domain[]`); the "committed `generated/touch-graph.ts`" artifact exists in no
  example. Schema annotations, CAS, `kovo db` commands verified accurate.
- ❌ **mutations.md** — same phantom `request.db.cart.add(input)` shape; the `ctx.submit` island
  section documents an unwired `@internal` context (`submit-context.ts` has zero consumers; public
  `HandlerContext` is `{params, signal, state}`) and uses `err.data` where failures carry
  `payload`; first sample lacks `access`. The other ~14 checkable samples (errors/fail, queue,
  transaction, form, wire headers, redirectTo, CAS, 401/403 split) verified accurate.
- ⚠️ **optimistic.md** — accurate throughout (statuses, KV codes, pending stamping, `OptimisticFor`,
  unit-test sample); missing the keyed `{keys, transform}` entry form entirely
  (`definition.ts:198-222`); `now` placeholder grammar rides the broken `now` export (above).
- ✅ **live-queries.md** — honest roadmap framing; verified no phantom exports; BroadcastChannel
  fingerprint claims match source.
- ✅ **postgres-authz-policy.md** — verified accurate throughout; best guide in the data slice.

### Routing & rendering
- ❌ **routing.md** — `route({ queries: {...} })` does not exist (`RouteDefinition`,
  `route.ts:219-254`; tsc-confirmed TS2353). Everything else checked (staticPaths, search schema,
  redirect/notFound, respond.file/stream, prefetch justification, dispatch order, 6 KV codes)
  verified accurate.
- ❌ **layouts.md** — two samples fail tsc: named `regions.*` on bare `layout()` (Regions defaults
  to empty record, `route.ts:111`) and `guard: guards.authed()` on bare `layout()` (Request
  defaults to `unknown`; works only via the `createApp` authoring context, which the guide never
  explains). Parent chaining, boundaries, layout queries verified accurate.
- ⚠️ **render-tree.md** — API-accurate and honest about the trust boundary; but zero example usage
  of the family, and the closing `safeRichHtml` pointer doesn't name its import home (dual-homed).
- ❌ **request-shell.md** — the config sample has three wrong option names: `errors` → `errorShells`,
  `unexpected` → `serverError`, `limits` → `requestLimits` (whose real shape differs entirely), and
  **`maxFragmentTargets` exists nowhere** (`app-types.ts:272-282`; tsc-confirmed). Document
  primitives, dispatch order, adapter sample verified accurate.
- ❌ **islands.md** — the "Declare clocks" section documents `component({ clocks })`, which **throws
  at runtime** (`assertKnownComponentDefinitionKeys`, `core/src/index.ts:256-283`;
  runtime-probed) while the compiler validates it (`compiler/src/validate/temporal.ts:52`) — a
  core↔compiler contradiction; both samples crash on module load. `renderOnce(...)` is called like
  a framework export but is app-defined (never stated). State/derive/handler/refresh content
  verified accurate.
- ⚠️ **streaming.md** — Defer/loader content accurate; but the `fragments:` snippet floats with no
  app-authorable owner (it's the internal `DeferredStreamChunk` shape), `Defer.timeoutMs` (30s
  default) is undocumented, `installKovoLoader` is `@experimental` in source with no caveat in the
  guide, and "the starter's `client.ts` wires it" is false (no `client.ts` in templates).
- ❌ **static-export.md** — never names the API: `exportStaticApp`, `kovo export`,
  `StaticExportOptions`, `onNonExportable` all absent even though the prose describes them; the
  only commands shown are repo-internal site scripts. Conceptual constraints verified consistent.

### Components, styling, accessibility
- ❌ **components.md** — headless-ui "URL helpers" don't exist; the styled-Button sample doesn't
  typecheck (`variant` includes `'secondary'` but `buttonStyles` lacks the key); the "spread the
  builder's output" prose contradicts both its own example and shipped source (both hand-map
  attributes); copy-in install omits `@kovojs/icons` (5 registry components need it). Registry
  block, attribute-builder options, `kovo add` target verified accurate (7 of 9 samples fine).
- ⚠️ **styling.md** — 8 of 8 theme/style samples verified accurate; but it presents
  `stylesheetsForTargets(manifest, targets)` as callable API when it is `@internal` and unexported
  (`server/src/hints.ts:158`).
- ❌ **accessibility.md** — the `<Select labelledBy=…>` sample puts the prop on the wrong part and,
  with no children, renders an empty div (only "works" because Component call sites are untyped);
  the "every reachable state is asserted axe-clean" claim is contradicted by concrete holes
  (switch-checked, hover-card-open, standalone-checkbox-checked have no axe assertion), and the
  cited proof file is the wrong one (coverage lives in `interactions-a/b` suites). Run commands,
  transition-zeroing, static-tier list verified accurate. `rules/accessibility-conformance.md`'s
  MUST list is currently not fully met by the cited suite.

### Security, auth, wire
- ❌ **security.md** — `guard: authed` uncalled (denies everything); query `load` signature wrong
  (and contradicts line 305 of the same guide); the `csrfField` example omits `mutation:` and mints
  a token dispatch rejects with 422 (the exact "audit trap" the source JSDoc warns about,
  `csrf.ts:176-183`); `--capabilities` capability-mint audit claim is false (plumbing unwired,
  `capability-route.ts:131-138`); `--unscoped`/`--endpoints` sample output fabricated vs the real
  key=value formats; rate-limit throw-on-missing-principal behavior and `guards.owns` (the IDOR
  guide's own best tool) both missing. ~14 other claims verified accurate (CSRF-before-parse, guard
  re-check before replay, storage endpoint shapes, explain flags).
- ❌ **endpoints-webhooks.md** — flagship webhook example **throws at module load** (writes +
  `idempotency` without `replayStore`, `webhook.ts:736-757`); `hmacSignature` shape fabricated
  (missing `encoding`/`secret`; `payload: 'raw-body'` would sign that literal string;
  `tolerance: '5m'` a type error); `.passthrough()` doesn't exist; `ctx.cookies.set`/
  `ctx.headers.setCacheControl` exist nowhere; `--endpoints` sample format wrong; DEC-G write
  posture (`ctx.actAs`/`declareSystemWrite` — without which the shown `tx` throws) never mentioned.
  Endpoint example and lifecycle claims verified accurate.
- ⚠️ **auth-better-auth.md** — most accurate of the four; `vp check`/`vp test` are monorepo-root
  scripts, not the starter's (`templates/package.json` uses `npm run check`); the guide's inline
  `requireAuthSecret` omits the placeholder check it claims; `betterAuthSignUpEmailMutation` never
  mentioned.
- ⚠️ **wire-protocol.md** — protocol facts largely verified (headers, content type, kovo-query
  delta, kovo-text modes); but the prod-delta example uses `settlement=` where the client parses
  `settles` (`browser/src/wire-parser.ts:150`), and **no server code emitting the settlement set
  was found at all** — the documented mechanism appears unproducible by the current server
  (implementation gap or wrong doc).

### Tooling & testing
- ⚠️ **cli.md** — explain kind list omits `task` and the `document` form; review-mode list omits
  `--trust`/`--tasks` (kovo-explain.md disagrees with cli.md and both undercount source); the
  "starter wires these npm scripts" framing describes the monorepo, not the starter; `--preset`
  guide text is right but `commands-manifest.ts:571` is stale ("fail loudly until emitters land" —
  they landed). ~20 commands/flags verified accurate, 0 broken invocations.
- ❌ **kovo-explain.md** — "the starter generates `scripts/graph-assertions.mjs`" and "runs in the
  starter's CI as `vp run graph-assertions`" are **fabricated** (zero matches repo-wide); mode list
  omissions as above. The KV310 sample output is byte-identical to a locked snapshot — the capture
  mechanism works where it's used.
- ⚠️ **testing.md** — "this is the commerce app's own test shape" is false for the harness example
  (commerce tests are wire-level); the flagship sample teaches a docs-sanctioned double cast
  (`as unknown as KovoTestTouchGraph`); "contained in" should be "deep-equals"; graph-assertion
  pointer inherits the kovo-explain fabrication. KV402-411 table, harness/assertions/pglite samples
  all verified accurate.
- ❌ **deployment.md** — "the starter's CI runs exactly this list" is false (actual:
  `vp check` / `vp test` / `build:prod`); the Dockerfile `CMD ["node", "dist/server.js"]` points at
  a file no pipeline produces (starter runs `dist/server/server.mjs`; `kovo build` emits its own
  Dockerfile). Retention proof, adapters, and the full env-var table verified accurate.
- ✅ **compiler-internals.md** — clean; respects the empty compiler public boundary; capture-pipeline
  claims have a real mechanism.
- ❌ **dataflow-devtool.md** — sells the **private** `@kovojs/devtool` package as importable public
  API on a public site page (violates `rules/api-surface.md` and STABILITY.md); `dev:mounted`
  script doesn't exist; other commands are monorepo-only. The named APIs do exist in the package —
  promote the package or reclassify the guide as internal tooling docs.

### Generated reference (`site/gen/api/*.md`) staleness
- `route()`'s canonical JSDoc example returns a string from `page` — fails its own declared type
  (`RoutePageResult` excludes string; tsc-confirmed). The most-used server API's example doesn't
  compile.
- `site/gen/api/drizzle.md` documents 30 of 38 exports (runtime-metadata family invisible).
- `site/gen/api/create-kovo.md` missing `--experimental-sqlite`; its own example now fails closed.
- `site/gen/api/cli.md`: no-args list missing `db`; `kovoCheck` missing `paranoidStaticAdvisory`;
  `ExplainKind` prose omits `task` while the union shows it.
- headless-ui/ui JSDoc examples are mechanical placeholders (`{} as SelectState`) — 100%
  "documented" by count, near-zero informational value across ~1,100 exports.

## Decided Remediation Plan (2026-07-03)

Recommendations accepted by the product owner; sequenced by dependency and cost-of-delay. Phase 4
(Component call-site typing) is explicitly the **full fix** — do the hard thing completely, no
conservative half-step left as the end state.

### Phase 1 — standalone bug fixes (independent, land first)

- [ ] **Fix `@kovojs/better-auth#role`**: delegate the body to `guards.role` (keep the typed
      role-name overload), so proven-principal checks, `markPassedRoleGuard`, and guard audit facts
      come along. Add a regression test asserting `db.crossOwnerRead(..., { role })` succeeds
      behind the better-auth guard (`packages/better-auth/src/guards.ts:53-65`,
      `packages/server/src/guards.ts:550-560`, `postgres-runtime.ts:983`).
- [ ] **Export `now` next to `tempId`** so derive-codegen's emitted
      `import { now, tempId } from '@kovojs/browser'` resolves (`browser/src/index.ts:4`,
      `optimism.ts:553`, `drizzle/src/derive-codegen.ts:52-58`). Add a test that renders a derived
      transform exercising **every** placeholder and typechecks/executes the emitted module — the
      drift-proof is the real fix.
- [ ] **Resolve the `clocks` core↔compiler contradiction**: add `clocks` to
      `COMPONENT_DEFINITION_KEYS` + a SPEC section, or delete the compiler path
      (`compiler/src/validate/temporal.ts`) and the islands.md section — one owner, not two truths.

### Phase 2 — data-layer reconciliation

- [ ] **Remove `write`/`WriteDefinition` and `tag`/`Tag` from the `@kovojs/server` root** (inert;
      zero consumers) and record the SPEC §10.3 divergence as an explicit open design decision —
      if the domain-write mechanism lands later, `write()` returns *with* its enforcement in the
      same change.
- [ ] **Rewrite queries.md / mutations.md / data-layer.md to the enforced model**: analyzed Drizzle
      writes + registry-declared touches (what commerce does), `context.db`/`Reader` loader
      handles, `access` posture on every request-reachable sample, correct KV330 severity.

### Phase 3 — surface removals and ABI reclassification

- [ ] Land the remaining **Definitely Remove** items (createElement, MutationResponseHeaders,
      Deferred*Chunk family, meta(), GuardFailure, EndpointReason `purpose`, runKovoCommand).
- [ ] **Reclassify compiled-ABI types**: headless-ui transition machinery → `./generated` (one
      generator change in `packages/ui/scripts/primitive-component-manifest.mjs`); drop the 44
      `@kovojs/ui` `*Styles` exports from versioned modules (keep module-local for copy-in);
      `@kovojs/browser/client` DI seams → generated/internal via the `KovoLoaderOptions` split;
      emit generated optimistic modules' imports from `@kovojs/browser/generated`.
- [ ] **Barrel hygiene on the `@kovojs/server` root**: move plumbing families (drain-facts,
      capability primitives, CSP renderers, vite-dev, adapter hooks) behind internal subpaths.
- [ ] **Kill duplicate vocabulary in one pass** (tag/domain done in Phase 2; GuardFailure,
      MutationResponseHeaders, CsrfValidationOptions alias, purpose/reason, core-vs-server
      `query`/`route`, FieldError ×2, Stylesheet/stylesheet, dual-homed browser exports).
- [ ] Fix `examples/gallery/src/primitive-actions.ts` importing `./generated`/`./internal`
      headless-ui subpaths from example app source.

### Phase 4 — typed Component call sites (the full fix)

Goal: `<Button varient="x">` is a `tsc` error in every app, example, template, and doc sample —
the JSX call site enforces the exact props contract the definition declares, including `children`
composition. This is the SPEC §1.3 promise ("generated apps fail TypeScript static checking if
wiring is wrong") applied to the most common wiring there is. No `Record<string, unknown>` escape
hatch survives this phase.

- [ ] **Codify the decided props-derivation contract (decided 2026-07-03: infer-from-render with
      framework-checked channel consistency)** in SPEC §4.1/§6.2. The runtime contract is already
      uniform and stays unchanged: render's first parameter is **one merged bag** — query results
      ∪ call-site props (`examples/crm/src/components/deal-detail.tsx:133` has both, with
      `props: { dealId: String }` metadata; `packages/ui/src/button.tsx:164` is the props-only
      case; `examples/commerce/src/components/cart-badge.tsx:45` the queries-only case; state is
      positional param 2, slots param 3). Today the props type is stated in up to three unlinked
      places (render annotation, `props:` constructor metadata, `.args()` mapper `Props`); the
      render annotation becomes the single source of truth and the other two are checked against
      it. Rejected alternatives, for the record: explicit `component<Props>({...})` generic (TS
      has no partial type-argument inference — it would force a curried call shape), and merging
      the type channel into the `props:` metadata field (constructor maps can only carry the
      JSON-serializable subset; `ButtonProps`'s union literals, style objects, and `children` are
      composition-time values that never cross the wire). Sub-contracts:
      - [ ] Call signature = bag type minus `keyof Definition['queries']`, with exact-key
            (excess-property) checking; expose it as a named `ComponentProps<Definition>` alias so
            errors read legibly instead of as raw `Omit<...>` failures. A prop name colliding with
            a query key is a compile error + new KV diagnostic (ambiguous in the merged bag).
      - [ ] Unannotated render ⇒ props = `{}`: call sites accept nothing (default-deny, Prime
            Principle posture); annotating the bag is the fix. Supply the bag's query-result keys
            contextually from the `Query<Key, Result>` handles so authors stop hand-annotating
            result types the framework already knows (retires a small declare-once violation).
      - [ ] Constrain `.args(mapper)` — `QueryArgsBinding`/`Query.args` at
            `core/src/index.ts:296-345` — so the mapper's `Props` must be assignable from the
            component's derived call-site props: mappers narrow, never invent.
      - [ ] Type the `props:` metadata field as a constructor map whose derived type
            (`{ dealId: String }` → `{ dealId: string }`) must be assignable to the matching keys
            of the call-site props — it remains the serializable-subset declaration for
            live-target renderers, but can no longer contradict the annotation.
      The contract must also type the compiler-injected `style`/`styles` override channel and
      `kovo-key`.
- [ ] **Implement `Component<Definition>` call-signature inference in core** — replace
      `(props?: Record<string, unknown>): any` (`core/src/index.ts:168-172`). Exact-key checking
      (excess-property errors) is required, not just known-key widening.
- [ ] **Wire the JSX side**: `JSX.ElementType`/`KovoJsxComponent` in
      `packages/server/src/jsx-runtime.ts:870-921` must resolve per-descriptor props (not
      `JsxComponent<any>`), preserving intrinsic-element and plain-function-component behavior.
      Extend `jsx-runtime-types.test.ts` with descriptor-component cases: wrong prop name, wrong
      value type, missing required prop, excess property, `children` JSX nesting — all asserted as
      type errors (the test currently proves enforcement only for plain function components).
- [ ] **`children` sweep across `@kovojs/ui`**: fix the 126 `children?: string` declarations (and
      `Card`'s `children?: unknown`) to the real composition type (`ComponentRenderResult`) on
      every container part that nests JSX; string-only stays only where the contract is genuinely
      text-only. Fix prop placement errors the new checking surfaces (e.g. `labelledBy` belongs on
      `SelectTrigger`, not `Select`).
- [ ] **Sweep all call sites the checking breaks**: `packages/ui` internal composition, `site/`,
      `examples/*` (commerce, gallery, crm, stackoverflow, devtool, reference), `create-kovo`
      templates, tutorial steps. Every break is a latent bug being surfaced — fix the call site,
      don't loosen the type.
- [ ] **Icons**: verify the 1,740 generated icon components type-check under the new signature and
      **benchmark `tsc`** before/after across the monorepo and a scaffolded app; if inference cost
      is material, precompute each icon's call signature in the generator output instead of
      deriving it generically.
- [ ] **Compiler/runtime alignment**: confirm compiler lowering and `assertKnownComponentDefinitionKeys`
      agree with the chosen props channel; type-level enforcement remains defense-in-depth per the
      honesty boundary (SPEC §6.6) — the compiler's validation stays authoritative.
- [ ] **Fix the guide samples this invalidates or vindicates**: accessibility.md `<Select
      labelledBy>` (broken composition the old signature hid), components.md Button
      `'secondary'` variant sample, plus any sample the sweep breaks.

### Phase 5 — docs truth and drift-proofing (after Phase 4, so the gate has teeth)

- [ ] **Compile guide samples in CI**: extract TSX/TS snippets from `site/content/guides/**` and
      typecheck against built dist types, same discipline as the `{{capture:*}}` CLI-transcript
      pipeline. ≥12 currently-broken samples across 9 guides become impossible to reintroduce.
- [ ] **Fix the remaining per-guide defects** catalogued above (request-shell option names,
      routing `queries:`, layouts typing, static-export missing its own API, security.md CSRF
      audience + fabricated explain output + `--capabilities` claim, endpoints-webhooks broken
      flagship example, wire-protocol `settles`, streaming/islands issues, devtool guide
      public/private status).
- [ ] **Stop describing a starter that doesn't exist**: align `create-kovo` templates or the
      guides for graph-assertions, CI script list, Dockerfile entrypoint, `client.ts` — one truth.
- [ ] **Regenerate stale generated docs** (route() JSDoc example, drizzle 30/38, create-kovo
      `--experimental-sqlite`, cli no-args list, `ExplainKind` prose) and replace the mechanical
      `{} as SelectState` placeholder examples in headless-ui/ui JSDoc with real ones.
- [ ] **Close the a11y claim gap**: add missing axe end-state assertions (switch-checked,
      hover-card-open, checkbox-checked) or soften the guide/rules claim; fix the cited proof file.

### Side investigations (parallel, unowned by a phase)

- [ ] **Wire `settles` emission gap**: client parses it (`browser/src/wire-parser.ts:150`); no
      server emission found — implementation gap or dead doc.
- [ ] **Commerce KV330 alias question**: `const db = request.db; db.insert(...)` — analyzer
      evasion or unflagged reference-app violation; either outcome is a real issue.

## Gaps And Follow-Up

- Sub-agents were read-only: `tsc`/`kovo check` were run only in the routing slice (9 samples) and
  a `component()` runtime probe; other "cannot compile / throws" verdicts come from reading
  declarations and enforcing code paths against real call sites — high confidence, not executed.
- Not verified: trailing-slash 308 emission, GET-form field-name compile validation, CR/LF header
  rejection sink, prod delta selection path, `encryptAtRest` body, `vp check` inside a scaffolded
  app, whether all 74 `@kovojs/browser/client` types are transitively reachable (orphans would only
  strengthen the narrowing), per-icon uniformity beyond one sampled glyph.
- The ~266 headless-ui machinery-type count is a name-pattern classification (±10 on edge names).
- `api-surface-gate` recursive-publicness baseline (821) was not re-derived; several Borderline
  reclassifications above would reduce it.
- Product-owner judgment needed: render-tree family (example vs experimental), `renderRoute` escape
  hatch, storage guide vs subpath move, `@kovojs/devtool` promote-vs-reclassify, core client
  `query` handle rename.

# Papercut Super 2

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found in a SECOND advanced-feature
dogfood pass, on a codebase where all of `papercut-super-1.md` (27 items) is
already fixed. One security/soundness defect from the same run was escalated to
`plans/bugz-5.md` (H1: `kovo build` skips the IDOR/mass-assignment/GET-write/
TOCTOU gates) and is not repeated here.

## Scope

Five fresh SQLite apps from local `packages/create-kovo` (linked via
`scripts/link-local-kovo.mjs`), each on a DEEPER advanced surface untouched by
round 1, exercised through install → `check` → `test` → `build:prod` → dev HTTP
smoke:

- **auth-security-depth** — `guards.role`/`rateLimit`/`owns`, custom 403/404/500
  error shells, capability/signed-URL downloads (SPEC §6.5/§9.5/§10.2/§10.3).
- **files-blobs** — `s.file().store()`, `respond.storedFile`, capability download,
  content sniffing, 413/Cache-Control/Content-Disposition (SPEC §9.5/§9.2).
- **endpoints-webhooks** — `endpoint()` exact/prefix, `webhook()` signature +
  idempotency, JSON-body CSRF posture (SPEC §9.5/§6.6/§10.3).
- **theme-ui-a11y** — `style.create`/tokens/`createTheme`, `@kovojs/ui`, `@kovojs/icons`,
  accessibility (SPEC §7).
- **nav-deploy-skew-events** — enhanced-nav `regions`, view transitions, mutation
  streaming, `emit()` events, version recovery (SPEC §8/§14/§7).

All checkboxes start open (finding session). Each item names the track and the
verified root-cause file:line. The security escalation lives in `bugz-5.md`.

**Meta-theme:** the `kovo build` preflight (the gate added in round 1) is the
round-2 hot spot. Beyond the bugz-5 security gap, it **rejects the framework's
own surfaces** (`createStorageDownloadEndpoint` and every `webhook()` fail
KV423/KV436; `domain('string')` trips KV406) — fail-closed false positives that
block shipping correct code.

---

## Issues

### A. Capability / file-download surface (built but unbuildable)

- [x] **A1 — The framework's own `createStorageDownloadEndpoint` cannot pass `kovo build` (KV423 + KV436).** (HIGH, framework; auth-C2 = files-C1)
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts --testNamePattern "storage download endpoint|webhook build facts|Drizzle security extractors|fatal optimistic"` proves a mounted storage download endpoint passes build preflight without KV423/KV436.
  - Observed: registering `createStorageDownloadEndpoint({ storage, secret })` in
    `createApp({ endpoints })` makes `build:prod` exit 1 with
    `ERROR KV423 ENDPOINT /_kovo/storage … missing=appOwnedSafety` and
    `ERROR KV436 ENDPOINT /_kovo/storage … auth=-`.
  - Root cause: the factory (`packages/server/src/capability-route.ts:336`)
    hard-codes `response:{ appOwnedSafety:false, body:'bytes', cache:'private' }`
    and sets no `auth`. The build gate `packages/cli/src/graph-output.ts:1337`
    requires `appOwnedSafety===true` for `surface==='endpoint'` (KV423), and
    `:1611-1652` marks an endpoint with no auth as decision `missing` (KV436,
    error at :797-800). `StorageDownloadEndpointOptions` (:187-202) exposes neither
    field, so the app cannot satisfy either gate via supported options. The
    framework's own `endpoint.test.ts:477` uses `appOwnedSafety:true` for a
    bytes/private endpoint — the factory's `false` is the anomaly.
  - Why it matters: the SPEC §6.6-sanctioned secure-download primitive cannot be
    mounted in an app that runs the standard build gate; the failure reads as an
    author-error KV423/KV436. Fails closed (no exploit) but blocks the feature.
  - Repro: temp entry registering the endpoint → `kovo build` exit 1 (KV423+KV436);
    the dogfood apps leave it unregistered with an explanatory comment for exactly
    this reason.
  - Acceptance: the factory should set `appOwnedSafety:true` + `auth:'none'` with a
    capability-token justification, or KV423/KV436 should exempt the framework-owned
    verify-before-read byte sink. Add a build test mounting the endpoint that exits 0.

- [x] **A2 — No public `StorageCapability` constructor: `createMemoryStorage`/`createFileSystemStorage`/`createS3CompatibleStorage` are `@internal`, reachable only via the `@kovojs/core/internal/storage` deep import.** (MEDIUM, framework; auth-C3 = files-C3)
  - Evidence: `pnpm exec vitest run packages/core/src/storage.test.ts packages/core/src/index.test.ts packages/server/src/webhook.test.ts packages/server/src/api/app.test.ts` plus `pnpm run check:api-surface` prove storage factories/options are public and server API exports remain surface-compliant.
  - Observed: `import { createMemoryStorage } from '@kovojs/core'` → TS2305; only
    `@kovojs/core/internal/storage` works.
  - Root cause: `packages/core/src/index.ts:34-42` re-exports only `type
StorageCapability`; the three factories (`packages/core/src/storage.ts:148/199/268`)
    are `@internal`, exposed solely through the `./internal/storage` subpath
    (`core/package.json` exports). Yet two public sinks REQUIRE a `StorageCapability`:
    `createStorageDownloadEndpoint` (`capability-route.ts:257`) and `s.file().store()`
    (`packages/server/src/schema.ts:263-268`). `@kovojs/server` re-exports no factory.
  - Why it matters: the canonical SPEC §6 upload flow forces every storage author
    onto an `internal/` deep import that signals "not semver-stable / not for app
    use" — contradicting `rules/api-surface.md` and the `@internal` JSDoc's own
    claim that "apps wire storage through @kovojs/server" (which isn't implemented).
  - Repro: `tsc` TS2305 on the public import; the dogfood apps import from
    `@kovojs/core/internal/storage`.
  - Acceptance: re-export the validated factories (and option types) from public
    `@kovojs/core`/`@kovojs/server` and drop the `@internal` tags.

- [x] **A3 — `mutationFormAttributes()` omits `enctype="multipart/form-data"` for `s.file()` upload mutations, so a no-JS upload form silently posts urlencoded and 422s with no surfaced reason.** (MEDIUM, framework; files-C4)
  - Evidence: `pnpm exec vitest run packages/server/src/mutation.test.ts packages/server/src/app-authoring-context.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/style.test.ts --reporter=dot` proves file mutation helpers and compiler lowering emit multipart form facts/attributes.
  - Observed: a no-JS `<form {...mutationFormAttributes(uploadDoc)}>` with `<input
type=file>` posts without multipart enctype → 422, no visible message; builds clean.
  - Root cause: `mutationFormAttributes` (`packages/server/src/mutation/definition.ts:399-405`)
    emits no enctype (its return type has no enctype member), and compiler form
    lowering (`packages/compiler/src/emit/server-emit-shared.ts:155-201`) emits
    none either. The explain slots `enctype`/`fileFields`
    (`packages/core/src/graph.ts:256-257`, printed at `graph-output.ts:537-539`) are
    never populated, and no diagnostic fires for a file mutation form lacking
    multipart. (JS-enhanced submit sends FormData regardless, so only no-JS breaks;
    file fields also can't bind `<FieldError>` per KV242, so the 422 has no no-JS surface.)
  - Why it matters: a documented public helper produces a form that can't carry the
    file on the no-JS path Kovo guarantees, failing silently.
  - Repro: `build:prod` clean with a file form lacking enctype; the built graph has
    no generated enctype fact.
  - Acceptance: have `mutationFormAttributes`/compiler lowering emit
    `enctype="multipart/form-data"` when the mutation input has an `s.file()` field
    (or emit a diagnostic). Wire the dead `enctype`/`fileFields` explain slots.

- [x] **A4 — The security guide's capability-URL example does not compile against the real API (path/scope/expiresIn/`ctx.signUrl` all diverge).** (MEDIUM, docs; auth-C4)
  - Evidence: `node site/scripts/code-snippets-check.mjs site/content/guides` proves the security guide's capability URL snippet uses the shipped `createStorageDownloadEndpoint`/route `signUrl` API shape.
  - Observed: every executable line of the only documented secure-download flow
    fails `tsc`.
  - Root cause: `site/content/guides/security.md:388-406` uses `path` (the option is
    `basePath`, `capability-route.ts:193`), omits the REQUIRED `secret` (:190),
    destructures `scope: ({ req }) =>` (the type is `(request: Request) =>`, :195),
    passes `expiresIn:'10m'` (the type is `number` ms, :64), and calls
    `ctx.signUrl`/`ctx.req` inside a mutation handler (`signUrl` is only on the
    route page context, `route.ts:187`; the mutation handler's 2nd arg is the
    request, `mutation.ts:235`). `doc-gap.md` DG-32 is marked `[x]` but the added
    content is type-incorrect.
  - Why it matters: the only documented secure-download example is copy-paste-fatal
    on a security-sensitive surface.
  - Repro: compare each call shape to the cited public types.
  - Acceptance: rewrite the example against the shipped types and add it to the
    docs snippet typecheck (so it can't regress).

### B. Webhooks & endpoints (the build gate rejects correct webhooks)

- [x] **B1 — Every `webhook()` fails `kovo build`/`check`: the surface is misclassified as a plain endpoint → KV423 (missing appOwnedSafety) + KV436 (missing access).** (HIGH, framework; endpoints-C1)
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts --testNamePattern "storage download endpoint|webhook build facts|Drizzle security extractors|fatal optimistic"` proves signature-verified webhooks serialize as webhook/verifier facts and pass build preflight without KV423/KV436.
  - Observed: a textbook public `webhook()` + `hmacSignature()` → `build:prod` exit 1
    with `ERROR KV423 ENDPOINT /webhooks/payment … missing=appOwnedSafety` and
    `ERROR KV436 ENDPOINT /webhooks/payment … auth=hmac-sha256:hex` (labeled ENDPOINT,
    not WEBHOOK).
  - Root cause: `endpointCheckFact` (`packages/cli/src/commands/build-export.ts:681`)
    hard-codes `surface:'endpoint'` (never reads `endpoint.webhook`), and (:643)
    serializes verifier auth as the bare scheme `hmac-sha256:hex` with no `verifier:`
    prefix. So KV423 fires (`graph-output.ts:1337`; `webhook()` sets
    `appOwnedSafety:false`, `packages/server/src/webhook.ts:229`) and KV436 fires
    (`core/graph.ts:764` only counts `verifier:`/`custom:`-prefixed auth). The
    webhook-aware classifier `packages/server/src/access-graph.ts:78-121` is bypassed
    by the build path. (Explain test fixtures hand-feed `verifier:…`, so the real
    serializer is never exercised.)
  - Why it matters: a correct, signature-verified webhook cannot ship; no app-side
    workaround exists (`appOwnedSafety` is hard-coded false by `webhook()`).
  - Repro: `build:prod` on a webhook app → KV423+KV436 (first-hand via verifier).
  - Acceptance: `build-export.ts` must serialize the webhook surface (`surface:'webhook'`)
    and prefix verifier auth as `verifier:<scheme>`; add a build test that a
    signature-verified `webhook()` exits 0.

- [x] **B2 — A writable `webhook()` fails KV406 "un-analyzable write site" attributed to its `domain('payment')` declaration — the string-key `domain()` form is misread as an un-analyzable write-action object.** (HIGH, framework; endpoints-C2)
  - Evidence: `pnpm exec vitest run packages/drizzle/src/index.write-callbacks-carriers.test.ts --testNamePattern "string-keyed domain"` proves the Drizzle touch graph no longer treats `domain("payment")` as an unresolved write-action object.
  - Observed: `const paymentDomain = domain('payment')` in a writable webhook →
    `ERROR KV406 webhooks.ts:5 Statically un-analyzable write site; manual touches
required.` Removing `recordChange`/`transaction` does NOT clear it; only removing
    the `domain('payment')` declaration does.
  - Root cause: `unresolvedDomainWriteCallbacks`
    (`packages/drizzle/src/static/domain-writes.ts:39-104`, invoked unconditionally
    at `static.ts:1450`) runs over every `const x = domain(arg)` and treats the
    argument as a write-ACTION OBJECT (`domainWriteObject`, :115-155). It models a
    `domain({ add: write(...) })` shape that the shipped API does not have — the only
    `domain` export is `@kovojs/server`'s `domain(key: string)` (`packages/server/src/domain.ts:19`),
    a string-keyed invalidation domain. A string literal can't resolve to a write
    object → `{unresolved:true}` → KV406 at the `domain()` line. The framework's own
    `webhook.ts:186-198` JSDoc example uses the same `domain('order')` pattern and
    would also fail. (Distinct from round-1 A3, which fixed the `count()`-projection
    KV406 trigger; this is the `domain('string')` trigger, unfixed.)
  - Why it matters: a webhook recording a change to an external-event domain not
    backed by a Drizzle table — the documented primary use case — cannot build, and
    the diagnostic blames the wrong line with a dead-end "manual touches" remedy
    (`webhook()` has no `touches` escape, `webhook.ts:112-125`).
  - Repro: `build:prod` → KV406 at the `domain()` line; toggling `recordChange` vs
    the `domain()` decl isolates the trigger (first-hand via verifier).
  - Acceptance: `unresolvedDomainWriteCallbacks`/`domainWriteObject` must recognize
    the string-key `domain(key)` form as a plain invalidation-domain identifier (not
    a write-action object). Add a fixture: `domain('x')` used by a webhook `recordChange`.

- [x] **B3 — A writable webhook MANDATES `idempotency()` + a `replayStore`, but no usable store ships and the `WebhookReplayStore` types are `@internal`/unexported (and the mutation store is type-incompatible).** (MEDIUM, framework; endpoints-C3)
  - Evidence: `pnpm exec vitest run packages/core/src/storage.test.ts packages/core/src/index.test.ts packages/server/src/webhook.test.ts packages/server/src/api/app.test.ts` proves `createMemoryWebhookReplayStore` and webhook replay types satisfy the writable webhook posture.
  - Observed: a tx-exposing webhook throws at declaration without `idempotency()` +
    `replayStore`, but there's no `createMemoryWebhookReplayStore`, the store
    interfaces are unexported (TS2305), and `createMemoryMutationReplayStore` is not
    assignable (status unions differ).
  - Root cause: `assertWebhookWritePosture` (`packages/server/src/webhook.ts:470-481`,
    from bugz H8) makes both mandatory; `grep export function createMemory` yields
    only mutation/capability/client-module stores — no webhook store (the framework's
    own `webhook.test.ts:679` hand-rolls one). `WebhookReplayStore`/`WebhookReplayReservation`/
    `WebhookWireResponse` (`webhook.ts:57/64/71`) are absent from `index.ts` exports.
    `MutationReplayResponse` status (200/401/403/409/422/429/500) ≠ `WebhookResponseStatus`
    (200/400/401/422/429/500), so the mutation store fails to assign (403 not in the union).
  - Why it matters: the (correct) H8 write-posture mandate has no supported way to be
    satisfied — every webhook author must hand-roll a store against `@internal` types.
  - Repro: `tsc` TS2305 importing `WebhookReplayStore`; TS2322 assigning the mutation store.
  - Acceptance: export `createMemoryWebhookReplayStore` + the webhook store types from
    `@kovojs/server` (mirroring mutation/capability).

- [x] **B4 — A default-CSRF endpoint silently returns 422 "CSRF" forever when `createApp()` has no top-level `csrf` — and the starter wires `csrf` only per-mutation.** (MEDIUM, template; endpoints-C5)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts --testNamePattern "sound-subset policy"` proves the starter imports `appCsrf` and wires `createApp({ csrf: appCsrf })`, so default-CSRF endpoints consume the same app CSRF provider as mutations.
  - Observed: the first non-`csrf:false` endpoint an author adds 422s permanently;
    no boot error, no diagnostic distinguishing missing-token from missing-config.
  - Root cause: `validateEndpointCsrf` (`packages/server/src/app-dispatch.ts:126`)
    returns a bare 422 when `app.csrf===undefined` (the Origin floor is never even
    reached). `app.csrf` is set only when `options.csrf` is provided (`app.ts:135`),
    the starter `createApp()` omits it (its only endpoint is `csrf:false`), and
    `validateFrameworkSecret` (`env.ts`) returns early for an undefined secret, so it
    boots clean in dev AND prod. Mutations escape via the per-mutation `csrf` fallback
    (`csrf.ts:277`), masking the gap.
  - Why it matters: confusing onboarding failure requiring nontrivial debugging; the
    framework fails closed (no security hole) but gives the author no signal.
  - Repro: a default-CSRF endpoint + `createApp()` with no `csrf` → permanent 422.
  - Acceptance: have the starter set `createApp({ csrf: appCsrf })` and/or emit a dev
    warning when a default-CSRF endpoint is registered but `app.csrf` is undefined.

- [x] **B5 — Webhook verifier helpers (`hmacSignature`/`standardWebhooks`/`customVerifier`) are exported only from `@kovojs/core`, not re-exported from `@kovojs/server` alongside `webhook()`.** (LOW, framework; endpoints-C6)
  - Evidence: `pnpm exec vitest run packages/core/src/storage.test.ts packages/core/src/index.test.ts packages/server/src/webhook.test.ts packages/server/src/api/app.test.ts` plus `pnpm run check:api-surface` prove verifier helpers/types are exported from `@kovojs/server` without widening undocumented API.
  - Observed: authoring a verified webhook splits imports across two packages; the
    helpers don't appear in `@kovojs/server` autocomplete.
  - Root cause: `packages/server/src/index.ts` re-exports `webhook` (:339) but not the
    verifier builders; their only public home is `@kovojs/core` (`index.ts:61`, defs
    `core/src/verifier.ts:142/190/215`).
  - Why it matters: the same recurring export-placement friction as round-1 E3
    (`trustedHtml` from the wrong package); the mandatory `verify` arg's builders
    aren't surfaced where `webhook()` lives.
  - Repro: `grep` the server barrel — zero verifier exports; the dogfood app imports
    `hmacSignature` from `@kovojs/core` and `webhook` from `@kovojs/server`.
  - Acceptance: re-export `customVerifier`/`hmacSignature`/`standardWebhooks` + the
    `WebhookVerifier` type from `@kovojs/server` (named re-exports per api-surface rules).

### C. Typed-routing inference

- [x] **C1 — Inline `route()` declared in `createApp({ routes: [...] })` loses path-param typing: `context.params` and `regions` callbacks become `unknown`; the SPEC §8 example doesn't typecheck.** (MEDIUM, framework; files-C2 + nav-REGIONS-4)
  - Evidence: `pnpm exec vitest run packages/server/src/mutation.test.ts packages/server/src/app-authoring-context.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/style.test.ts --reporter=dot` proves inline `route('/x/:id', ...)` entries in `createApp({ routes })` keep typed params for pages and regions.
  - Observed: an inline `route('/x/:id', { page(ctx){ ctx.params.id } })` → TS18046
    `'params' is of type 'unknown'`; the same route declared as a hoisted `const`
    types `params.id` as `string`. Region callbacks lose params the same way.
  - Root cause: `packages/server/src/app-types.ts:32-39` types the routes array as
    `AppRouteDeclaration = RouteDeclaration<any,…>` (used at :242), so each array
    element's contextual `any` Path overrides the `const Path extends string`
    inference in `route()` (`route.ts:315-325`). `RouteParamsFor<any,…>` collapses
    (`route.ts:60-66`), making `RouteRequest.params` `unknown` for page AND region
    callbacks. Hoisting to a `const` lets `const Path` infer the literal first.
  - Why it matters: the natural authoring path on a core typed-routing surface (and
    the flagship SPEC §8 `regions` example) breaks under the starter's mandated
    strict/no-cast config with a cryptic error that vanishes on extraction. The
    starter's own `/`/`/login` routes have no `:params`, so it's invisible until the
    first dynamic route.
  - Repro: `tsc` TS18046 on an inline `:param` route; clean as a hoisted const or
    with a redundant `params:` schema.
  - Acceptance: make `AppRouteDeclaration` a non-`any` shape (or type the `routes`
    field with an identity-preserving helper/tuple) so inline `route()` calls keep
    their inferred Path/ParamsSchema.

### D. UI / theme / accessibility

- [x] **D1 — `@kovojs/ui` Table family silently renders `[object Promise]` when composed with natural JSX children.** (HIGH, framework; theme-ui)
  - Evidence: `pnpm exec vitest run packages/ui/src/table.stylex.test.tsx packages/server/src/jsx-runtime.test.ts scripts/link-local-kovo.test.mjs` proves natural JSX Table composition renders semantic table sections instead of `[object Promise]`.
  - Observed: `<Table><TableHead><TableRow>…</TableRow></TableHead><TableBody>…</TableBody></Table>`
    renders `<table><caption>…</caption>[object Promise][object Promise]</table>` —
    the thead/tbody are gone.
  - Root cause: `renderKovoComponent` (`packages/server/src/jsx-runtime.ts:543-561`)
    is async; compiler-emitted `jsx()` children are Promises, and it passes
    `props.children` into the component render WITHOUT awaiting (:557). The Table
    family's local synchronous `escapeHtml` (`packages/ui/src/table.tsx:86-99`) only
    special-cases arrays + branded `kovoRenderedHtml`; a Promise hits `String(value)`
    = `"[object Promise]"` (emitted at :182/:272). By contrast Card/Dialog render
    children through `renderServerRenderable` (`packages/server/src/renderable.ts:21-31`),
    which DOES await Promise children. (Distinct from bugz-4 M15, which added the
    synchronous `escapeHtml` for the XSS fix but never handled async children.)
  - Why it matters: a primary data-display component silently corrupts output via the
    documented TSX authoring model, with zero signal across `tsc`/`vp check`/`vp test`/
    `kovo build`; the only working path is the undocumented `.definition.render()`
    string-concat the gallery hides internally.
  - Repro: composing the Table family through the real jsx runtime emits
    `[object Promise]` ×2 (first-hand via verifier vitest).
  - Acceptance: route Table children through the runtime renderable (await Promises)
    instead of a bespoke synchronous `escapeHtml`. Add a JSX-composition test for Table.

- [ ] **D2 — The server JSX namespace is effectively untyped (`Element=any`, `children: unknown`, intrinsics `Record<string,unknown>`), so declared component prop/children types and intrinsic attribute names/aria values are never enforced at call sites.** (MEDIUM, framework; theme-ui)
  - Observed: `<Card>{42}{true}{{not:'render'}}<Button>{[1,2,3]}</Button></Card>`
    (children typed `string`) typechecks clean; `onClik`/invalid aria values are
    unchecked app-wide.
  - Root cause: `packages/server/src/jsx-runtime.ts:683-693` declares
    `type Element = any`, `JsxComponent = (props:any)=>any` (:93), `children: unknown`,
    and `IntrinsicElements { [tag:string]: Record<string,unknown> }`. `Element=any`
    collapses JSX expressions; the open intrinsic index admits any attribute name.
  - Why it matters: nullifies the precise `children?: string` types across the whole
    `@kovojs/ui` family and silences intrinsic-attribute typos — an object-literal
    child renders `[object Object]` with no compile-time warning. (Author-time
    defense-in-depth per CLAUDE.md, not the security proof — runtime escaping still
    enforces — so this is misleading authoring confidence, not an exploit.)
  - Repro: `tsc` exits 0 on number/boolean/object/array children to `string`-typed
    props; control (`const x: string = 123`) exits 2, proving the typecheck runs.
  - Acceptance: give the JSX namespace real types (per-component prop derivation, a
    constrained `Element`, typed intrinsic attributes/aria) so declared shapes are
    enforced.

- [x] **D3 — The local dogfood flow (`create-kovo` + `link-local-kovo`) doesn't provide `@kovojs/icons` or `@kovojs/headless-ui`; a direct icon import fails with a bare TS2307 / module-not-found.** (LOW, dev-tooling; theme-ui)
  - Evidence: `pnpm exec vitest run packages/ui/src/table.stylex.test.tsx packages/server/src/jsx-runtime.test.ts scripts/link-local-kovo.test.mjs` proves `link-local-kovo` now links `@kovojs/icons` and `@kovojs/headless-ui`.
  - Observed: `import { Plus } from '@kovojs/icons/plus'` fails to resolve in a
    linked dogfood app.
  - Root cause: `scripts/link-local-kovo.mjs:6-15` lists 8 packages and omits
    `@kovojs/icons` + `@kovojs/headless-ui`, which `@kovojs/ui` declares as
    `workspace:*` deps. With pnpm's symlinked node*modules and the kovo monorepo in a
    separate tree, a direct import of an unlinked package fails. (`@kovojs/ui`'s own
    internal subpath imports still resolve through the link: target's monorepo
    node_modules, so only the app's \_direct* icon imports break.)
  - Why it matters: local-dogfood/dev-tooling only — a published `pnpm add @kovojs/ui`
    pulls icons/headless-ui transitively — but it blocks dogfooding the icon surface.
  - Repro: lockfile importer `.` block lacks icons/headless-ui; direct icon import → TS2307.
  - Acceptance: add `@kovojs/icons` + `@kovojs/headless-ui` to `kovoPackageNames` (or
    have the helper transitively close over `@kovojs/*` deps).

### E. Navigation, events & view transitions

- [x] **E1 — A prop/local conditional style `style={cond ? a : b}` is rejected as KV236 "dynamic style text"; only query/state-driven conditionals lower.** (HIGH, framework; nav-STYLE-2)
  - Evidence: `pnpm exec vitest run packages/server/src/mutation.test.ts packages/server/src/app-authoring-context.test.ts packages/compiler/src/stamps.test.ts packages/compiler/src/style.test.ts --reporter=dot` proves prop/local conditional `style.create` handle ternaries lower without KV236.
  - Observed: `style={slug === activeSlug ? styles.active : styles.link}` (both
    branches `style.create` handles) → `KV236 … Unsafe output context requires an
explicit trusted Kovo escape hatch. dynamic style text` at build.
  - Root cause: `dynamicStyleAttributeLowering` (`packages/compiler/src/style.ts:1083`)
    returns null unless the condition roots are a known query/island `state`
    (:1078-1082); a prop/local condition yields `query=null`, the span is never
    marked handled (:907-909), and `resolveStyleBindings` (:1029-1054) doesn't handle
    `ConditionalExpression`. The variant machinery (`styleClassVariants`, :1172-1202)
    supports the shape but is unreachable past the gate, so `validateStyleAttribute`
    (`output-context.ts:424-432`) emits KV236.
  - Why it matters: build-fails a universal idiom (active nav link, prop/zebra
    styling) with a security-flavored diagnostic that steers authors to `trustedHtml`
    — the wrong fix for safe style handles. The repo's own site uses this shape
    (`site/src/components/landing.tsx:2002` etc.). Fails closed (safe), so DX not security.
  - Repro: changing one route component's `style` to a prop-conditional ternary →
    KV236 (first-hand via verifier).
  - Acceptance: emit a server-evaluated conditional class attribute (reuse
    `styleClassVariants`) for pure prop/local conditionals between `style.create`
    handles, instead of requiring a query/state derive root.

- [ ] **E2 — SPEC §7 typed fire-and-forget events (`emit`/`on`) are non-functional end-to-end: the lowered `emit(...)` free identifier has no runtime binding, and `on()` has no authoring surface.** (MEDIUM, framework; nav-EVENTS-1)
  - Observed: authoring `emit('cart:add', …)` (the import-free form docs prescribe)
    typechecks and lowers, but resolves to an unbound identifier at runtime
    (ReferenceError); `on()` has no recognized form at all.
  - Root cause: the compiler lowers `emit(...)` verbatim with no import added
    (`packages/compiler/src/emit/client.ts:149-162`; `handler-lowering.test.ts:739`
    emits bare `emit(...)`) and only lints it via KV320
    (`component-contracts.ts:574`). The event bus `createEventBus`
    (`packages/browser/src/events.ts:88`) is never instantiated/wired into any
    loader/runtime, and `createEventBus`/`event` stay `@internal`/unexported. No
    `globalThis.emit`/`on` exists.
  - Why it matters: SPEC §7 / `islands.md:280-289` prescribe events as
    cross-island coordination mechanism #2; the prescribed primitive isn't functional.
    (No security impact — KV320 forbids server facts on events — so a dead `emit`
    can't leak truth.)
  - Repro: source trace (bus never wired); lowered handler emits bare `emit(...)`.
  - Acceptance: wire `createEventBus` into the runtime and give `on()` an authoring
    surface, OR strike the prescription from SPEC §7 / `islands.md`.

- [x] **E3 — `viewTransitionName` silently leaks as an inert HTML attribute when authored in a plain route-page helper function (it is lowered only inside `component()`).** (MEDIUM, framework; nav-VT-3)
  - Evidence: `pnpm exec vitest run packages/ui/src/table.stylex.test.tsx packages/server/src/jsx-runtime.test.ts scripts/link-local-kovo.test.mjs` proves direct server JSX lowers `viewTransitionName` to sanitized CSS and does not leak the camelCase prop.
  - Observed: `<span viewTransitionName="page-hero">` in a route `page()` helper
    emits `<span viewTransitionName="page-hero">` verbatim (camelCase, inert), with
    no diagnostic; the same prop inside a `component()` lowers to
    `style: view-transition-name: …`.
  - Root cause: `component()`/region modules go through the compiler
    (`packages/compiler/src/lower/structural-jsx.ts:290-302` lowers `viewTransitionName`),
    but route-page helper JSX is rendered at runtime by
    `packages/server/src/jsx-runtime.ts:216-282`, which has no `viewTransitionName`
    handling; the camelCase name passes `safeRuntimeAttributeName` and is emitted
    verbatim (:281). (Round-1 verified VT pairing only inside `component()`; this is
    the distinct runtime route-page path.)
  - Why it matters: SPEC §8 markets cross-document View Transitions as opt-in via
    `view-transition-name` props the compiler stamps across route templates — but a
    hero authored in a route-page helper (a very common shape) silently never pairs,
    with zero feedback (the JSX prop type is accepted; no runtime KV diagnostic).
  - Repro: `jsx('span', { viewTransitionName:'page-hero' })` via the runtime factory
    emits the prop verbatim; `component()` cache blobs show the lowered form.
  - Acceptance: lower `viewTransitionName` in the runtime jsx path too, or emit a
    diagnostic for the un-lowered framework-special camelCase prop.

### F. Diagnostics surfacing

- [x] **F1 — `kovo build` fails (exit 1) but prints only WARN-labeled findings and no ERROR cause; a SPEC-fatal KV310 is rendered identically to non-fatal WARN UNGUARDED lines.** (LOW, dev-tooling; auth-C5)
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts --testNamePattern "Drizzle security extractors|fatal optimistic"` proves a build-fatal KV310 now gets an `ERROR BUILD_FATAL KV310 ...` summary before the raw verifier output.
  - Observed: removing an optimistic transform makes `build:prod` exit 1 with
    `ERROR kovo build check preflight failed:` then a single `WARN KV310 …` buried
    among 11 same-styled `WARN UNGUARDED …` lines — no per-finding ERROR/FATAL marker
    identifies the cause.
  - Root cause: `graph-output.ts:782` pushes the fatal optimistic-coverage finding via
    `pushFinding(warning, true)` (sets exit 1) but formats it as `WARN KV310 …`
    (:2153), indistinguishable from non-fatal `WARN UNGUARDED` (:878); `build-export.ts:465`
    wraps it in a generic preflight-failed message. (KV310 is build-fatal by SPEC
    §10.6 — that's correct; the defect is presentation.)
  - Why it matters: the author can't tell which line caused exit 1 (cry-wolf).
  - Repro: drop one `optimistic.contacts` transform → exit 1 with a WARN-labeled fatal line.
  - Acceptance: render build-fatal findings with an ERROR/FATAL marker regardless of
    nominal severity class, and/or have the wrapper name the fatal finding(s).

- [x] **F2 — An endpoint posture mismatch (declared `cache`/`body` vs actual response headers) throws an opaque 500 "Server Error" with zero diagnostic in dev unless `onError` is configured.** (LOW, dev-tooling; endpoints-C4)
  - Evidence: `pnpm exec vitest run packages/server/src/vite-dev.test.ts --testNamePattern "endpoint posture mismatches|route diagnostics"` proves Vite dev records endpoint posture mismatch throws into the dev diagnostic ledger and serves a KV423 diagnostic containing the cache/body drift.
  - Observed: a posture-mismatched endpoint 500s in dev with no console output.
  - Root cause: `reportServerError` no-ops without an app-configured `onError`
    (`diagnostics.ts:43`), so a server-component/endpoint throw yields an opaque 500.
    (Overlaps the residual noted in `papercut-super-1.md` ~L600 but was never
    separately filed.)
  - Why it matters: SPEC §5.2 #5 (diagnostics are teaching errors); dev-only, but the
    author is blind to the cause.
  - Repro: source trace; dev 500 with empty console.
  - Acceptance: surface server-component/endpoint throws in the dev diagnostic ledger
    by default (not gated on `onError`).

---

## Refuted / Not Carried Forward

- **bugz-4 M2 (guarded `respond.storedFile` loses `no-store`/`Vary:Cookie`)** — NOT
  reproducible at runtime: guarded `/download/:id` and `/view/:id` both returned
  `cache-control: no-store` + `vary: Cookie` + `x-content-type-options: nosniff`.
- **Content sniffing / inline bypass** — sound: a client-lied `image/jpeg` PNG was
  stored and served as server-sniffed `image/png`; `respond.storedFile` defaults to
  attachment+nosniff; `accept()` checks sniffed bytes (KV428). No bypass.
- **Webhook signature/idempotency runtime** — sound: no-sig 401, valid 200, replay
  200 with no double-execute, tampered-body 401 (bugz H8/H9 fixes hold).
- **`guards.role`/`rateLimit`/`owns` author ergonomics + `errorShells` API** — clean
  and working end-to-end (custom 403/404/500 served with correct status; §6.5
  unauthenticated 303 to `/login?next=…`).
- **auth-C6** (`kovo build` UNGUARDED audit false-positives on guarded surfaces) —
  refuted: not reproducible; the build prints no WARN UNGUARDED for guarded surfaces.
- **auth-C7** (`ctx.signUrl` derives a different secret than the download endpoint) —
  refuted: the load-bearing secret-mismatch half is false and was never runtime-verified.
- **No-JS sign-in 422 CSRF** — app/harness artifact (round-1 authed-path territory;
  adding `Origin`/`Referer` headers makes sign-in 303 succeed).
- **NAV-STREAM-5** (mutation streaming forces magic-string internals) — refuted: the
  compiler lowers `stream`/`streamText` and `<kovo-text>` via KV243.
- **`@kovojs/ui` `style` vs `styles` prop naming** — mirrors the react-aria/shadcn
  single-`style`-vs-slotted-`styles` convention; minor nit, not a bug.

### Dogfood-setup notes (contributor tooling)

- Parallel link-local installs again repointed the monorepo's
  `packages/style/node_modules/@material` symlink into a dogfood dir; repaired with
  `pnpm install` at the monorepo root. (See `papercut-super-1.md` for the standing
  recommendation of a store-isolated/no-workspace dogfood mode.)

---

## Latest Verification

- `kovo build` on a fresh `create-kovo --sqlite` scaffold → EXIT 0, node preset
  emitted, zero KV errors (confirms all of `papercut-super-1.md` is fixed).
- Security escalation (IDOR builds green) reproduced first-hand and filed as
  `plans/bugz-5.md` H1.
- 26 round-2 candidates adversarially verified; 21 confirmed framework/template/docs/
  dev-tooling papercuts (1 escalated to bugz-5), 5 refuted/dup. Each item above
  carries the originating track's reproduced symptom + verified root-cause file:line.
- Monorepo restored: `pnpm install` at `/Users/mini/kovo`; `@material` resolves again.

# Public API DevEx Audit — 2026-06-19

**Scope:** Every manifest-declared **public, app-facing** export in `public-packages.json`
(`apiBoundary.public` subpaths). Generated ABI (`apiBoundary.generated`) and internal
(`apiBoundary.internal`) subpaths are out of scope except where they leak into public
signatures or are misclassified. `@kovojs/compiler` is excluded (build-tool, no public
subpath). `create-kovo` is reviewed as a command contract only.

**Lens:** Developer experience for a React developer arriving from **Next.js, TanStack Query,
TanStack Router/Start, shadcn/ui, Radix UI, and Base UI** — would they correctly *guess* each
API's name, shape, and behavior, and is each one documented at the point of use? This is a
*familiarity/clarity* audit, not the conservative "less surface is more" audit (that lens lives
in `plans/audit-api-*.md`). The two agree on most removals.

**Categories & confidence:** Every finding is **Remove**, **Change** (name/signature), or
**Document**, each with confidence **H** (clear, well-evidenced, low-risk), **M** (reasonable
but debatable / needs product judgment), or **L** (speculative or stylistic). Confidence shown
is *post-verification*; where an adversarial verifier adjusted it, the original is noted
(`H→M`) with the reason.

**Sources:** `SPEC.md`, `rules/api-surface.md`, `STABILITY.md`, `public-packages.json`,
`site/gen/api/*.md`, package source declarations + JSDoc, and real call sites in `examples/`
and `site/`. Per-API named-import / example-usage counts are from
`scratch/public-api-inventory.md` (the manifest-driven inventory helper).

**Method:** 15 package-scoped auditors (covering every public subpath) → per-slice adversarial
verification of every Remove/Change finding against source + real React-ecosystem API knowledge
→ cross-cutting synthesis. 163 findings (24 Remove, 39 Change, 100 Document); the verifier
**rejected 1** and **weakened 24** Remove/Change findings, all reflected below. Document-category
findings were not independently re-verified (low risk: each is "add docs").

**Git:** `agent/plan-remainder` @ `493eeaec`.

---

## Executive Summary

| Category | Count | of which H / M / L (post-verify) |
| --- | ---: | --- |
| **Remove** | 24 | 0 / 12 / 12 |
| **Change** (rename/signature) | 39 | 6 / 13 / 20 |
| **Document** | 100 | 14 / 46 / 40 |

The public surface is *mostly* well-shaped — routing (`href`/`route`/`redirect`), the styling
engine (`create`/`defineVars`/`createTheme`), guards, `s.*` schemas, the test PGlite harness,
and the headless-ui Radix-aligned part vocabulary are genuine keeps. The DevEx problems cluster
into a few systemic patterns rather than one-off mistakes:

1. **Name collisions with React's most load-bearing words.** `Link` returns `{ href }` (not a
   JSX anchor); `query`/`session`/`form`/`defineConfig`/`attrs` each reuse a famous ecosystem
   name for an incompatible contract. **(highest leverage)**
2. **Compiler/runtime ABI leaks onto app entry points** via "recursive publicness" —
   `@kovojs/browser/client` publishes ~60 of 72 symbols that are DOM-shim / wire / morph
   plumbing with zero app usage. Same pattern in `@kovojs/ui` (`*Classes`/`*ClassNames`) and
   `@kovojs/headless-ui` (the `*Change*` type taxonomy: ~589 zero-usage type exports).
3. **Adapter packages shadow/restate brand names** instead of extending the ecosystem:
   `betterAuthSignInEmailMutation` (package name + return type baked into the symbol),
   `drizzle#kovo()` (brand-as-verb).
4. **SPEC ↔ implementation disagreements on headline ergonomics** erode trust in the docs:
   `trustedUrl` is spec-mandated but missing; drizzle `key`/`owner` are stringly-typed or
   absent vs the spec's column-selector form; `kovoTest`'s shipped signature differs from §12.
5. **Documentation gaps at the point of use** — `@kovojs/headless-ui` (largest surface, 871
   symbols) and `@kovojs/ui` ship almost no JSDoc and no generated API page; the unfamiliar
   models (attribute-functions, controlled-only, positional `render` args, `class`-typed
   children) are powerful but undocumented, so familiarity is accidental rather than taught.

### Highest-leverage actions (do these first)

- **Rename the 6 collision names** (H–M): `Link`→`linkProps`, `@kovojs/style#attrs`→`props`,
  `@kovojs/server/build#defineConfig`→`defineKovoConfig`, `@kovojs/server#session`→`defineSession`,
  drop the `betterAuth*`/`*Mutation` affixes (`signInEmail`/`signUpEmail`/`signOut`), and resolve
  the dual `query` (`@kovojs/core#query`→`queryRef`, or `@kovojs/server#query`→`defineQuery`).
- **Demote the ABI families** off app subpaths (H–M): `@kovojs/browser/client` `*Like`/`Compiled*`/
  `Morph*` → `/internal`+`/generated`; `@kovojs/ui` `*Classes`/`*ClassNames`; the headless-ui
  `*ChangeReason/Detail/Result/Options` taxonomy.
- **Reconcile the 4 SPEC↔impl gaps** before v1 (H): `trustedUrl`, drizzle `key:(t)=>t.id`,
  drizzle `owner:`, and `kovoTest`'s §12 signature — fix the code or amend the spec, but stop
  shipping a public surface that contradicts the normative spec.
- **Ship docs for the two biggest, thinnest surfaces** (H): `@kovojs/headless-ui` and
  `@kovojs/ui` — generated API pages + per-symbol JSDoc + one package-level "mental model"
  overview each.

---

## Cross-Cutting DevEx Themes

These are framework-wide patterns; the per-API findings that follow are instances of them.

### T1 — Bare-verb definition factories where the ecosystem prefixes `define*`/`create*`, and the verbs collide across packages — **H**
Server registration builders are bare verbs (`query`, `mutation`, `endpoint`, `webhook`,
`domain`, `tag`, `write`), and `query`/`form`/`session` double as both core handles and server
definitions. The clash is real enough that the core JSDoc must say "the server-side query is
`query` from `@kovojs/server`," and `session()` is a *schema declaration* named like a runtime
accessor. **Contrast:** Next `defineConfig`, TanStack `createRoute`/`createFileRoute`, Astro
`defineCollection`, Nuxt `defineEventHandler` all prefix registration builders; TanStack/tRPC
keep client-handle vs server-definition under distinct names (`useQuery` vs
`publicProcedure.query`). No major lib reuses one verb across an import boundary.
**Recommendation:** adopt a consistent `define*` family for registration
(`defineQuery`/`defineMutation`/`defineEndpoint`/`defineWebhook`/`defineDomain`/`defineSession`),
freeing bare `query`/`session` and resolving the cross-package collision; rename the core string
handle to `queryRef`.

### T2 — Kovo overloads React's most load-bearing names with incompatible shapes — **H**
`Link` returns a non-JSX `{ href }` object (devs will reach for `<Link to=…/>`);
`@kovojs/server/build#defineConfig` collides with Vite's own `defineConfig` in the same project;
`@kovojs/style#attrs` occupies StyleX's `props` slot while *reading* like styled-components
`.attrs`; `session()` is a schema, not an accessor. Each reuses a famous name for a different
contract, and the shared name implies shared behavior Kovo doesn't deliver. **Recommendation:**
disambiguate (`linkProps`, `defineKovoConfig`, `props`, `defineSession`); where a name must
stay, document the deviation loudly with the ecosystem mapping.

### T3 — Compiler/runtime ABI leaks onto app-facing entry points via "recursive publicness" — **H**
`@kovojs/browser/client` exposes ~60 of 72 symbols as `*Like`/`Compiled*`/`Enhanced*`/`Morph*`/
`Query*` ABI types with 0 app imports — surfaced only because a kept option interface references
them, so the surface must include them recursively (per `rules/api-surface.md`). The same recurs
in drizzle's `Kovo*ExtraConfig` callback-carrier intersections, server's `isKovoApp`/
`isHeaderSource` validators, and the `kovoAppShellViteDev*` dev-integration cluster.
**Contrast:** React keeps `HostConfig`/Fiber/reconciler shapes internal; Next keeps Flight wire
types internal; TanStack keeps its query-cache wire format internal — none expose a DOM-shim ABI
or compiler IR on the app import path. **Recommendation:** move these to existing `/internal` and
`/generated` subpaths and reference them *structurally* so they vanish from app-facing docs;
target ~12 app symbols on `/client`.

### T4 — Kovo invents vocabulary for universally-known concepts without bridging to it — **H**
`s` mimics `z` but lacks `optional`/`nullable`/`enum`/`literal`/`union`/`safeParse`;
`html-fragment` models DOM assertions as flat `*Fact` data records over regex parsing instead of
element queries; `defineVariants` *is* cva and `cn` *is* a clsx-style joiner, but both are hidden
behind `/internal`; "Enhanced"/"Morph"/"preset" are Kovo coinages for fetch/reconcile/adapter;
optimistic rollback is unexposed where TanStack makes `onMutate`/`setQueryData`/rollback explicit.
**Recommendation:** for each invented term, either adopt the ecosystem name (`defineVariants`→a
`cva` alias on a public `./variants` path; `preset`→document as "deploy adapter") or ship an
explicit mapping doc (`s`'s subset + coercion contract; a TanStack→Kovo optimistic map; what
"Enhanced" means).

### T5 — Deprecated aliases, tombstones, and duplicate type pairs inflate the surface — **M**
Near-duplicate pairs and dead vocabulary recur: `ComponentDefinition` vs `ComponentDefinitionInput`
(plus a `fragmentTarget?: never` "Removed:" tombstone), `GuardDenial` vs deprecated `GuardFailure`,
`ResponseHeaders` vs aliased `MutationResponseHeaders`, three near-identical drizzle view types,
and `KovoFanAnnotation` referenced by public types but not exported. Most have 0 imports / 0
examples. **Recommendation:** pre-v1 prune to one canonical name per concept; export every
referenced type; drop the never-typed tombstone field.

### T6 — Adapter packages shadow and restate framework/brand names instead of extending them — **H**
`@kovojs/better-auth` prefixes nearly every export with `betterAuth*` (restating the package
name) and suffixes mutations with `Mutation` (restating the return type) — call sites immediately
rebind to `signIn`/`signOut`, proving the names are unusable as-is. `@kovojs/drizzle` names its
helper `kovo()`, colliding with the package, the compiler call-name, and the CLI, never spelling
its role. **Contrast:** better-auth (`signInEmail`/`signOut`), Auth.js (`signIn`/`signOut`), and
Drizzle adapters all favor short unprefixed verbs named for their role. **Recommendation:** drop
the `betterAuth*` prefix and `Mutation` suffix; rename drizzle `kovo()` to a role verb
(`domain()`/`invalidation()`).

### T7 — Per-component styling/override contract diverges from the universal `className` escape hatch — **M**
`@kovojs/ui` accepts no `className`/`class` on any of 45 subpaths; overrides go through a
per-component `styles?: XStyleOverrides` slot-map (MUI `slotProps`-shaped), each component ships
three unused styling exports (`xStyles`/`xClasses`/`xClassNames`), variant props are union-typed
with no `buttonVariants`/`VariantProps`, and `children` is typed `string`. **Contrast:**
shadcn/Radix/Base universally forward `className` (merged via `cn()`+tailwind-merge), type
`children` as `ReactNode`, and ship `xVariants = cva(…)` + `VariantProps`. **Recommendation:**
add a top-level `style?: StyleInput` on every component (Button already has it) for the
single-root case; drop `*Classes`/`*ClassNames` from the public surface; document the StyleX
(not-cva) and class-typed-children compile-model artifacts.

### T8 — Positional/builder-chain authoring & controlled-only payloads have no ecosystem analogue — **M**
`component().render` is `(queries, state, slots)` positional with `children` in the slots bag,
not props; query bindings use a fluent `.args().refresh()` chain instead of an options object;
headless-ui is controlled-only (no `defaultValue`/`defaultOpen`) with single cancelable
detail-object change payloads; `derive` uses named-string-input arrays with no runtime dep
tracking. These are defensible *architectural* choices, but they are undiscoverable.
**Recommendation:** each needs an explicit mental-model bridge doc (props-vs-positional,
options-bag-vs-builder, controlled-only rationale, derive-vs-`useMemo`); where feasible, accept
an options object on query bindings to match `useQuery` muscle memory.

### T9 — Packaging conventions misfire — **H**
`@kovojs/headless-ui` publishes an **empty `.` barrel** and an `./internal` subpath that is
`@internal` on every member yet is the *only* path to app-required token CSS (`kovoUiTokenSheetCss`,
imported by every example's `emit-ui-css.mjs`); `@kovojs/test` splits into 6 blurred subpaths;
`@kovojs/server` ships a types-only duplicate `static-export` subpath; `@kovojs/better-auth`
authors all 13 public symbols in `src/internal.ts`. **Contrast:** Radix has no umbrella barrel
(each primitive is its own package) and ships shared utilities as *public* `@radix-ui/react-*`
packages, never an "internal" door apps must use. **Recommendation:** drop the empty `.` key;
move app-facing token emitters to a public `./styles` or `./tokens` path; collapse the test
6-way split toward one root; delete the duplicate `static-export` subpath; move better-auth's 13
public symbols into named source files.

### T10 — SPEC and implementation disagree on headline ergonomics — **H**
Several normative SPEC promises are unmet on the public surface: `trustedUrl` (the spec-mandated
pair of `trustedHtml`, §4.8/§5.2/KV236) is missing on the security-critical path; drizzle's
`key` column-selector and `owner:` annotation (§10.1/KV414) are absent or stringly-typed;
`kovoTest`'s §12 signature (no options arg) differs from the shipped form; and generated docs are
entirely missing for `@kovojs/test` and `@kovojs/headless-ui`. **Recommendation:** reconcile each
gap before v1 — fix the code *or* downgrade the spec, but don't leave a public surface that
contradicts the normative spec.

### Naming-convention recommendations (consolidated)

| Conf | Symbol | Current → Proposed | Ecosystem precedent |
| --- | --- | --- | --- |
| H | `@kovojs/server#query/mutation/endpoint/webhook/domain` | → `defineQuery/defineMutation/defineEndpoint/defineWebhook/defineDomain` | Next `defineConfig`, Astro `defineCollection`, Nuxt `defineEventHandler` |
| H | `@kovojs/better-auth#betterAuthSignInEmailMutation` (+SignUp/SignOut) | → `signInEmail`/`signUpEmail`/`signOut` | better-auth, Auth.js short unprefixed verbs |
| H | `@kovojs/drizzle#kovo({ key: 'id' })` | → `key: (t) => t.id` (column selector) | SPEC §10.1 itself; Drizzle `index().on(t.col)` |
| M | `@kovojs/core#query` | → `queryRef` | tRPC/TanStack distinct client-handle vs server-def names |
| M | `@kovojs/core#Link` / `LinkDescriptor` | → `linkProps` / `LinkProps` (or a real JSX anchor) | Next/TanStack `<Link href\|to>` |
| M | `@kovojs/style#attrs` | → `props` (keep `class` key) | StyleX renamed `spread`→`props` |
| M | `@kovojs/server/build#defineConfig` | → `defineKovoConfig` | avoid colliding with Vite/Vitest `defineConfig` |
| M | `@kovojs/server#session` | → `defineSession` / `sessionSchema` | Auth.js `getSession()`/`auth()` *return* the session |
| M | `@kovojs/better-auth#mount` | → `betterAuthEndpoint` / `authHandlerEndpoint` | bare `mount` reads as DOM/React mount |
| M | `@kovojs/drizzle#kovo()` | → `domain()` / `invalidation()` | Drizzle adapters name the helper for its role |
| M | `@kovojs/headless-ui/tabs#tabsPanelAttributes` | → `tabsContentAttributes` | Radix `Tabs.Content` + Kovo's own "Content" convention |
| M | `@kovojs/browser/client#EnhancedMutationFetch` (+Options) | → `MutationFetch` (+Options) | drop Kovo-invented "Enhanced" jargon |
| L | `@kovojs/ui/command#CommandListbox` | → `CommandList` | cmdk/shadcn `CommandList` muscle memory |
| L | `@kovojs/server#GuardFailure` | → drop (alias of `GuardDenial`) | one canonical name per concept |
| L | `@kovojs/drizzle#KovoTableAnnotation` family | → `TableAnnotation`/`ViewAnnotation` (drop `Kovo` prefix) | Drizzle uses unprefixed `PgTable`/`BuildColumns` |
| L | `@kovojs/cli#KovoCheckResult` | → `KovoVerifierResult` (shared by check + explain) | neutral name for a shared type |
| L | `@kovojs/test/headers#enhancedMutationHeaders` | → `mutationRequestHeaders` | name for what it builds, not "enhanced" |
| L | `@kovojs/headless-ui/internal#defineVariants`/`cn` | → `cva`/`cn` on a public `./variants` | the two most-recognized React styling helpers |

---

## REMOVE (24)

> Removing/relocating these reduces app-facing surface with no capability loss. Confidence is
> post-verification; "weakened/rejected" reflects the adversarial pass. Items flagged
> **⚠ withdrawn** failed verification and are recorded for completeness, *not* recommended.

### High-value removals (M, verified)

**`@kovojs/browser/client` — the DOM-shim / wire / morph ABI families — M (was H), weakened**
- **`*Like` DOM-shape family** (`dom-like.ts:2`: `DomAttributeLike`, `AttributeReader/Writer/MutatorLike`,
  `ClosestElementLike`, `ListenerTargetLike`, … ~13 interfaces across `dom-like.ts`/`events.ts`/
  `mutation-form.ts`/`pending.ts`): pure DOM-abstraction ABI so the runtime can run against test
  doubles; 0 examples, 0 app imports; on the public path only by recursive publicness. Like
  exposing `react-reconciler`'s `HostConfig`.
- **`Compiled*`/`Query*` binding-wire family** (`query-bindings.ts:40`: `CompiledQueryDerive/Stamp/
  UpdatePlan(s)`, `QueryBinding*`, `QueryChunk`, `QueryRefetch*`, `InlineQueryEvent*`, …): the
  compiler→runtime query ABI; "Compiled*" *means* generated. SPEC §5.2 treats lowered IR/stamps
  as artifacts (KV235), not app-authored code.
- **`Enhanced*Mutation*` family** (`mutation-fetch.ts:43`: keep `EnhancedMutationFetch`+`Options`
  as the `defaultEnhancedFetch`-wrapper type — *rename* to `MutationFetch`; relocate
  `MutationBroadcast`, `MutationChangeRecord`, `TargetCollectorRoot`, `FragmentTargetRoot`,
  `PendingRoot`, `EnhancedFormElementLike`).
- **`Morph*`/`StructuralMorph*` family** (`morph.ts:8`): reconciler ABI (SPEC §9.1). **Verifier
  scope correction:** keep `MorphRoot`/`MorphTarget`/`MorphFragment` (recursive-public via the
  `enhancedMutations` loader option); only relocate `StructuralMorph*` (used solely by a
  conformance test helper — import it from the existing `./internal/morph`).
- **Recommendation:** move to `@kovojs/browser/internal/*` / `/generated` and reference
  structurally. Target ~12 app symbols on `/client` (`installKovoLoader`, `createBrowserKovoRoot`,
  `createQueryStore`, `KovoLoader(Options)`, `defaultEnhancedFetch`, the kept option/root types).
- **Verifier note (why weakened H→M):** several of these are *reachable* from public option
  interfaces (`KovoLoaderOptions.queryPlans`, `enhancedMutations`), so "0 examples" does not by
  itself prove they're safe to relocate — each move must re-route the referencing option type to
  the internal/generated path first. The relocation is correct; it's slightly more than a flag
  flip.

**`@kovojs/headless-ui#*ChangeReason/*ChangeDetail/*ChangeResult/*ChangeOptions` type taxonomy — M, confirmed**
- ~589 type-export rows (`command.ts:80` representative) show `named imports: 0, examples: 0`.
  This per-primitive change-event taxonomy (Reason/Detail/Result/Options × Open/Input/Value) is
  far more granular than anything in the React ecosystem (Radix exposes `onValueChange(value)`
  with *no* public Reason/Detail/Result types) and is almost entirely unused. It makes every
  primitive's IntelliSense and `.d.ts` noisy.
- **Recommendation:** demote the zero-usage `*ChangeReason/*Detail/*Result/*Options/*MoveResult/
  *SelectResult/*KeyboardResult` families to internal; keep only the handful examples actually
  import (e.g. `AutocompleteItem`, the `*ChangeDetail` consumed by handlers). Packaging cleanup,
  not a behavior change.

**`@kovojs/ui#<part>Classes` / `<part>ClassNames` dual styling exports — M, confirmed**
- Each component exports `xStyles` **and** `xClasses` (positional class-tuple) **and**
  `xClassNames` (raw StyleX object) — three overlapping styling exports per part, all 0/0 usage
  (`alert-dialog.tsx:199-216` defines 10 such for one component). A shadcn user expects at most
  one (the `cva` variants recipe); the trio reads as leaked SSR class-warmup machinery.
- **Recommendation:** drop `*Classes` and `*ClassNames` from the public surface (keep as
  non-exported internals if SSR warmup needs them); expose at most one named styling export per
  component.

**`@kovojs/headless-ui#` root barrel `.` (empty module) — M, confirmed**
- The published `.` entry resolves to `export {}`. `import { … } from '@kovojs/headless-ui'` (the
  reflexive first move) yields nothing, with no error pointing at the per-primitive subpaths.
  Radix avoids a root barrel by *not publishing* `.` at all — an empty-but-present `.` is worse
  than absent. **Recommendation:** drop the `.` key from `package.json#exports` so a bare import
  errors loudly and tooling suggests subpaths.

**`@kovojs/test/html-fragment#` framework-conformance probes — M, confirmed**
- `documentQueryScriptBehaviorFact` (`html-fragment.ts:284`) bundles rendered query-script
  strings only the compiler/runtime produce — an app author never asserts head-vs-body
  query-script placement. The unused `*Fact` *result* interfaces (`HtmlDocumentFact`,
  `HtmlJsonScriptFact`, `KovoQueryFact`, … all 0 imports) are inferred return types apps never
  name. **Recommendation:** move the conformance probe to an internal/conformance module; stop
  exporting the zero-import `*Fact` result interfaces (let them be inferred). Keep only
  caller-annotated input types (`HtmlElementSelector`).

**`@kovojs/server#write` — M, confirmed**
- `write({key, touches, run})` (`mutation.ts:257`) returns its input; 0 example usage; overlaps
  `mutation`'s `touches`/`context.invalidate`, adding a second "write" noun a React dev has no
  analogue for. **Recommendation:** remove from the public root (or demote to an advanced
  subpath) until a real app consumes it; if kept, it needs a "how a `write` composes into a
  `mutation`'s touched set" example, since the standalone object is inert at the call site.

**`@kovojs/server#GuardFailure` — M, confirmed**
- `type GuardFailure = GuardDenial` (`guards.ts:57`), `@deprecated`, 0 usage. Pure redundancy.
  **Recommendation:** remove before v1; keep only `GuardDenial`.

**`@kovojs/server#isHeaderSource` — M, confirmed**
- A low-level header type guard (`response.ts:89`) on the public surface, 0 usage, whose
  companion `readHeader` is already `@internal`. App authors read headers via the standard
  `Headers` API. **Recommendation:** mark `@internal` (mirroring `readHeader`) and drop from the
  public export.

### Lower-confidence removals (L, verified)

**`@kovojs/core#ComponentDefinition` + `fragmentTarget?: never` tombstone — L, confirmed**
- `ComponentDefinition` (`index.ts:87`, the fully-typed body) has 0 imports/0 examples; only
  `ComponentDefinitionInput` is referenced (by the gallery's generated jsx-runtime). Both carry a
  dead `fragmentTarget?: never` field with a "Removed:" JSDoc — migration vocabulary leaking into
  the public type. **Recommendation:** collapse to one public definition type (or mark
  `ComponentDefinition` internal); delete the tombstone field; move the "use
  `disableServerRefresh`" guidance to docs.

**`@kovojs/server#MutationResponseHeaders` / `MutationResponseHeaderValue` aliases — L, confirmed**
- Exact aliases of `ResponseHeaders`/`ResponseHeaderValue` (`response.ts:1`), 0 usage.
  **Recommendation:** remove the `Mutation*` aliases.

**`@kovojs/test/html-fragment#htmlMainMarkerFact` — L, confirmed (narrowed)**
- Defaults to the framework-internal attribute `data-kovo-check-export` (`html-fragment.ts:208`)
  — a conformance probe. **Verifier note:** the 2nd positional arg lets apps pass their own
  marker (a test uses `data-commerce-shell`), and it has a real internal caller, so it is *not*
  strictly dead. **Recommendation (safer half):** if kept for app docs, rename to
  `htmlExportMarker` and document the marker attribute; otherwise demote to the conformance
  module.

**`@kovojs/test/headers#EnhancedMutationTarget` / `EnhancedMutationLiveTarget` / `EnhancedMutationHeaderOptions` — L, confirmed**
- Three option/target interfaces no test annotates by name (callers pass inline literals); 0
  imports; carry the "Enhanced" jargon (`headers.ts:41`). **Recommendation:** keep
  `EnhancedMutationHeaderOptions` inline-inferred (or rename with the function — see Change
  §`enhancedMutationHeaders`); stop exporting the two `*Target` types.

**`@kovojs/server#isKovoApp` — L (was M), weakened**
- A deep structural validator (`app-guards.ts:9`), 1 import / 0 examples. **Verifier correction:**
  its own JSDoc says "app-owned dev and export scripts use this" (SPEC §9.5) — so it is an
  app-facing contract, *not* a pure internal leak. The "app author never needs it" framing is
  wrong. **Recommendation:** at most, document it as a dev/export-script utility rather than
  removing it.

**`@kovojs/browser#ImportHandlerModule` — L (was M), weakened**
- The dynamic-import callback type (`handlers.ts:13`), exported from both `.` and `/client`, 0
  usage, with boilerplate "Runtime API used by Kovo applications…" JSDoc. **Verifier note:** Next/
  TanStack *do* expose import-shaped option types in places, so "no React analogue" is too
  absolute. **Recommendation:** remove from the app-facing `.` entry (keep on `/client` if the
  bootstrap needs it, or mark `@internal`).

**`@kovojs/browser/client#VisibleObserver*` / `LoaderLifecycleTarget` lifecycle family — L (was M), weakened**
- IntersectionObserver-shim shapes (`loader-lifecycle.ts:24`) an app never supplies (the loader
  defaults them); 0 usage. **Verifier correction:** the analogy to TanStack
  `refetchOnWindowFocus` is imprecise (that's `boolean | "always" | fn` over a focus manager, not
  an observer) and these back on-`visible` execution (closer to a lazy-mount/in-view hook).
  Keep a single documented `LoaderRoot` if `options.root` needs a public type; relocate
  `VisibleObserver*`/`LoaderLifecycleTarget` to `/internal`.

**`@kovojs/drizzle#KovoTableExtraConfig` / `KovoViewExtraConfig` (+`KovoDomainTableAnnotation`) — L (was M), weakened**
- The intersected callback-carrier *return* types of `kovo()` (`drizzle-surface.ts:50`); apps
  never name them (0 usage). **Verifier correction:** the cited inventory line numbers were
  misattributed to a different artifact — the zero-usage claim must be sourced from a direct grep,
  not those lines. **Recommendation:** make the `*ExtraConfig` types internal and let `kovo()`'s
  return type be inferred; keep `KovoTableAnnotation`/`KovoViewAnnotation` as the input vocabulary.

**`@kovojs/better-auth#authed` — L (was M), weakened**
- A self-described thin re-wrap of `@kovojs/server`'s `guards.authed` (`internal.ts:1420`).
  **Verifier corrections:** (1) `@kovojs/server` exposes the guard only as `guards.authed` (no
  top-level `authed`), so there is **no forced name collision** — the reference example imports
  `authed` unaliased; the "must alias as `betterAuthAuthed`" claim is wrong. (2) `activeOrganization`
  is **not** a public export, so the genuinely adapter-specific public guard is only `role`.
  **Recommendation (softened):** consider dropping the re-export so apps import `guards.authed`
  from `@kovojs/server`; low priority given no real collision.

**`create-kovo` published JS exports (`createKovoProject`/`writeKovoProject`/`generateCsrfSecret`/…) — L (was M), weakened**
- **Verifier correction (key):** `create-kovo`'s `package.json` has **no `exports`/`main`/`module`
  field** — only `bin` + `publishConfig.bin` + `files:["dist"]`. The `export` keywords in
  `src/index.ts` are therefore **not importable** from the published package, so there is no
  leaked public JS surface. The finding's "de facto importable" premise is unsubstantiated.
  **Recommendation:** no action required; optionally mark the file `@internal` for clarity. ✅
  treat `create-kovo` as a command contract (it already is).

**`@kovojs/headless-ui/internal` (whole subpath) — L (was M), weakened → see Change instead**
- **Verifier correction:** `/internal` is a *deliberate* framework-maintenance entrypoint used
  package-wide (`@kovojs/style/internal`, `@kovojs/cli/internal`, `@kovojs/core/internal/*`), and
  app source *cannot* validly import `@kovojs/*/internal` (SPEC §442 + the authoring-surface
  compiler diagnostic). Dropping it from `exports` would break `@kovojs/cli` and the examples'
  CSS emitters. **Do not remove.** The real problem is that the **app-required token CSS**
  (`kovoUiTokenSheetCss`) is only reachable through `/internal` — addressed as a **Change** below
  (split to a public `./styles`/`./tokens` path).

### ⚠ Withdrawn after verification

**`@kovojs/server/app-shell/static-export` (whole subpath) — REJECTED (was M)**
- The finding claimed the subpath duplicates 5 types already at the package root. **False
  premise:** only `StaticExportNonExportablePolicy` of the 5 is at root (`index.ts:43-47`); the
  other 4 (`StaticExportArtifact`, `StaticExportAssetArtifact`, `StaticExportAssetInput`,
  `StaticExportClientModuleArtifact`) are **not** exported from the root and are member/element
  types of `StaticExportResult`/`StaticExportOptions`. The "same names already at `.`" evidence
  does not hold. **Not recommended for removal** (it is the only public path to 4 of those types).
  If anything, consider surfacing those 4 from the root *and* keeping or dropping the subpath —
  a documentation decision, not a removal.

---

## CHANGE (39)

> Keep the capability, change the **name** or **signature** for React-ecosystem familiarity or
> internal consistency. Each gives a concrete proposal.

### Spec ↔ implementation gaps (reconcile before v1) — High confidence

**`@kovojs/browser#trustedUrl` — missing — H, confirmed**
- Only `trustedHtml` (`security-output.ts:34`) exists. SPEC §4.8 (line 355) and KV236 (line 1264)
  normatively define the escape hatch as a **pair**: `trustedHtml`/`trustedUrl`. A dev told
  "brand trusted URLs for `href`/`src`" will import `trustedUrl` and find nothing; the URL-scheme
  allowlist (`kovoSafeUrl`) has no author opt-out, so a legitimately-trusted `javascript:`/`data:`
  URL is undismissable. **Mirrors** Trusted Types' `TrustedHTML`/`TrustedScriptURL` split.
  **Recommendation:** export `trustedUrl(value): TrustedUrl` suppressing KV236 for URL-scheme
  attributes — or strike `trustedUrl` from SPEC. (Verifier confirmed the citation trio; the
  literal pair lives at §4.8:355 and KV236:1264.)

**`@kovojs/drizzle#kovo({ key })` — stringly-typed vs column selector — H, confirmed**
- `key?: string` (`drizzle-surface.ts:29`) used as `kovo({ domain: 'product', key: 'id' })`. SPEC
  §10.1 (line 968) normatively shows `key: (t) => t.id` — a Drizzle column selector. A string is
  unchecked against the table's columns and silently breaks on rename. **Recommendation:** change
  `key` (and `fans[].via`) to accept `(t) => t.id` (or a union with string), matching SPEC §10.1
  and Drizzle's `index().on(t.col)` idiom. One of spec/impl is wrong — reconcile.

**`@kovojs/drizzle#kovo` — missing `owner:` annotation — H, confirmed**
- `KovoTableAnnotation` has no `owner` field (`drizzle-surface.ts:25`). SPEC §10.1 (line 972) +
  KV414 define `owner: (t) => t.userId` powering the IDOR (`owns()`) and `--unscoped` audits;
  it's entirely absent, and the reference app instead carries ownership via app-level
  `ownerDomains` (`app.ts:218`) — a second, inconsistent path. **Recommendation:** add the SPEC
  §10.1 `owner?: (t) => t.col` field to the domain annotation, or strike `owner:` from SPEC and
  document that ownership lives only in `ownerDomains`. Resolve the two-path inconsistency.

**`@kovojs/drizzle#KovoFanAnnotation` — referenced by public types but not exported — H, confirmed**
- `KovoTableAnnotation.fans?: readonly KovoFanAnnotation[]` is public, but `KovoFanAnnotation`
  (`drizzle-surface.ts:12`) is not exported — a consumer cannot type a `fans` array (the KV413
  escape hatch a runtime diagnostic instructs them to write). **Recommendation:** export
  `KovoFanAnnotation`, or remove `fans` from the public annotation types if it is compiler-internal.

### Restructure / collision renames

**`@kovojs/better-auth` — entire public surface declared in `src/internal.ts` — H, confirmed**
- All 13 public exports are authored in a file literally named `internal.ts`, intermixed with ~65
  `@internal` schema-bridge symbols; `index.ts` re-exports the 13. The naming inverts the
  convention and makes the public/internal line invisible at the source. **Recommendation:** move
  the 13 public declarations into named files (`session.ts`, `mutations.ts`, `guards.ts`,
  `mount.ts`); keep `internal.ts` for the `@internal` machinery; `index.ts` stays the barrel.

**`@kovojs/headless-ui/internal` — app-required token CSS behind an `@internal` door — H, confirmed**
- The published `./internal` subpath re-exports 46 `@internal` symbols, yet `kovoUiTokenSheetCss`
  there is imported by every example's `scripts/emit-ui-css.mjs` and by `@kovojs/cli` — an
  app-required asset with no public path. Radix ships shared utilities as *public* documented
  packages, never an "internal" door apps must use. **Recommendation:** move the app-facing token
  emitters (`kovoUiTokenSheetCss`, `kovoUiDocumentTokenCss`, `kovoUiTokenSheet`) to a documented
  public `./styles` or `./tokens` subpath; keep true internals on `./internal`; stop
  `@internal`-tagging symbols examples import. (Do **not** remove `/internal` — see Remove note.)

**`@kovojs/core#Link` + `LinkDescriptor` — M, confirmed**
- `Link(path, options) => { href }` (`index.ts:375`) — a non-JSX descriptor, the single most
  mis-guessable routing name (every dev expects `<Link href|to>`). Zero app-source call sites.
  **Recommendation:** rename to `linkProps(path, options)` returning anchor-spreadable props
  (`LinkDescriptor`→`LinkProps`). **Verifier/SPEC note:** the "make it a real JSX anchor carrying
  prefetch" alternative *conflicts with SPEC §6.4* — the lowered form is a plain anchor with "no
  link runtime," and prefetch is a route-level Speculation-Rules opt-in (`prefetch:` on `route()`,
  KV419), not a Link feature. So the **SPEC-safe** path is the rename; treat the JSX `<Link>` as
  the existing compiler-sugar surface (keep prefetch on `route()`).

**`@kovojs/core#query` vs `@kovojs/server#query` — dual same-name export — M, confirmed**
- Two public `query` exports: server `query(key, {load, reads, args})` (the loader) and core
  `query(key)` (the `{key}` client handle, 0 examples — every binding uses the imported server
  value's `.args()`). Autocomplete and copied snippets silently pick the wrong one; the core
  JSDoc documents *around* the collision. **Recommendation:** rename the core handle to
  `queryRef(key)`, or the server builder to `defineQuery(key, …)`. **Verifier corrections:** the
  "SPEC §10.2 admits both are named `query`" claim is wrong — that note lives only in the source
  JSDoc (`index.ts:435`), not SPEC; cite the repo, not a misattributed inventory line.

**`@kovojs/server#session` — schema named like an accessor — M, confirmed**
- `session(schema)` (`guards.ts:276`) declares the session *shape* (like `pgTable`/a zod schema),
  but collides with the ecosystem meaning (`useSession`/`auth().session`/`getSession` *return* the
  session). The `.provider()` identity pass-through (exists only for inference) compounds the
  surprise. **Recommendation:** rename to `defineSession`/`sessionSchema`; document that the live
  value is reached via `ctx`/`req.session` and `.provider()` binds+infers a `SessionProvider`.

**`@kovojs/server/build#defineConfig` — collides with Vite's — L (was M), weakened**
- `defineConfig(config: KovoConfig)` (`build.ts:93`) for `kovo.config.ts`, while every example's
  `vite.config.ts` imports a *different* `defineConfig` from `vite-plus` — two same-named helpers
  in one project. **Verifier pushback:** the ecosystem norm is actually the *opposite* — multiple
  tools each ship their own `defineConfig` and coexist (e.g. Drizzle Kit's alongside Vite's), so
  this is a mild clarity nit, not a clear error. **Recommendation:** rename to `defineKovoConfig`
  (matching `KovoConfig`/`KovoPreset`) for unambiguous reading; low priority.

**`@kovojs/style#attrs` → `props` — L (was M), weakened**
- `attrs(...styles)` returns `{ class, style, 'data-style-src' }` (`engine.ts:309`). StyleX
  renamed its spread helper `spread`→`props`; a StyleX dev types `style.props(...)`, and `attrs`
  reads like styled-components `.attrs` (a different concept). **Verifier note:** the
  styled-components analogy is weak (that's a component-construction API), so the case rests on
  the StyleX `props` precedent, not confusion with `.attrs`. **Recommendation:** rename to `props`
  (keep the `class` key, since Kovo JSX is class-based) or document `attrs` as the deliberate
  Kovo-JSX analogue of `stylex.props`.

### Adapter brevity (better-auth / drizzle)

**`@kovojs/better-auth#betterAuthSignInEmailMutation` (+SignUp/SignOut) — M, confirmed**
- (`internal.ts:1125`) Names are far longer than the norm; the `betterAuth*` prefix restates the
  package name and `Mutation` restates the return type. Examples immediately rebind
  (`const signIn = betterAuthSignInEmailMutation(...)`), proving the names are unusable as-is.
  **Recommendation:** expose as `signInEmail`/`signUpEmail`/`signOut` (matching better-auth/
  Auth.js); let the `MutationDefinition` return type carry the "mutation" concept.

**`@kovojs/better-auth#mount` — M (was L), weakened**
- Bare `mount(path, auth|handler, options?)` (`internal.ts:148`) reads as a DOM/React mount;
  returns an `EndpointDeclaration` and forces `csrf:false`. 1 import / 0 examples — least-used
  symbol. **Recommendation:** rename to `betterAuthEndpoint(path, auth, options)` /
  `authHandlerEndpoint`; document the overload and the `csrf:false` rationale at the call site.

**`@kovojs/better-auth#betterAuthSession` → `sessionProvider`/`createSessionProvider` — L, confirmed**
- (`internal.ts:113`) Good capability, but the prefix is redundant and "session" reads like the
  value, not a provider factory. **Recommendation:** rename to `sessionProvider(auth, map)` /
  `createSessionProvider` to match the `SessionProvider` return type.

**`@kovojs/drizzle#kovo()` → `domain()`/`invalidation()` — L (was M), weakened**
- `kovo(annotation)` (`drizzle-surface.ts:73`) is a bare brand noun colliding with the package,
  the compiler call-name, and the CLI; `pgTable('x', {…}, kovo({domain}))` is opaque about its
  role. **Verifier correction:** governed by SPEC §10.1 (not §10.6 as cited). **Recommendation:**
  rename to a role verb (`domain(…)`/`invalidation(…)`), or keep `kovo` only as a documented
  escape-hatch namespace and explain the brand-noun choice.

**`@kovojs/drizzle#KovoTableAnnotation` naming family — L, weakened**
- Every type is `Kovo`-prefixed (`drizzle-surface.ts:25`) inside a package already namespaced
  `@kovojs/drizzle` — redundant and un-Drizzle-like (Drizzle uses unprefixed `PgTable`,
  `BuildColumns`); three near-identical view types (`KovoViewExtraConfigAnnotation` vs
  `KovoViewAnnotation` vs `KovoViewExtraConfig`). **Recommendation:** drop the `Kovo` prefix on
  input types (`TableAnnotation`/`ViewAnnotation`); collapse the three view types once
  `*ExtraConfig` is internalized.

### Schema / validation

**`@kovojs/server#s` — subset of Zod under a one-letter name — M, confirmed**
- `s` (`schema.ts:70`) has `object/string/number/boolean/array/file`; `parse` throws; no
  `.optional()`/`.nullable()`/`.enum()`/`.literal()`/`.union()`, no string `.email/.regex`, no
  `.safeParse()`. A dev expects `z.string().email().optional()`, `z.enum([…])`,
  `schema.safeParse()`. **Strengthening fact (verifier):** SPEC.md:677 itself writes
  `s.number().optional()`, which the shipped `NumberSchema` does not implement — a real SPEC↔impl
  gap. **Recommendation:** add the common combinators (`optional`/`nullable`/`enum`/`literal`/
  `union`/string `min/max/email`/`default`); document the deliberate subset and that `parse`
  throws (no `safeParse`) with a "why not Zod" note — the single-letter `s` invites the `z`
  comparison, so the gaps must be explicit.

### Test surface

**`@kovojs/test/html-fragment#` `html*Facts`/`*Fact` family — M, confirmed**
- 34 exports (`html-fragment.ts`): ~16 extractor fns + ~18 `*Fact` result interfaces returning
  flat data records. A React dev expects Testing Library (`render` + `getByRole`/`within`) or
  Playwright `locator()` returning live elements — not a bespoke string/regex "facts" library.
  **Recommendation:** front the parser with a small Testing-Library-flavored facade (a
  `screen`/`within`-style `byRole`/`byText`/`byTestId`/`byFormField`), rename the public concept
  "facts"→"query," and demote niche extractors + zero-import `*Fact` interfaces to a deep/internal
  subpath.

**`@kovojs/test/test-case#kovoTest` — signature diverges from SPEC §12 & Vitest — L (was M), weakened**
- `kovoTest(name, fn, options, runner?)` returns `{name, run}`, forcing a two-step
  `it(case.name, case.run)` (`test-case.ts:27`). **Verifier correction:** SPEC §12 (line 1352)
  *does* include the manual `it(...)` re-registration — so the only true divergence is the
  options arg (SPEC §12:1336 omits it). **Recommendation:** align `kovoTest` to register directly
  with the active runner (or match the SPEC snippet), and reconcile the options-arg difference.

**`@kovojs/test/headers#enhancedMutationHeaders` → `mutationRequestHeaders` — L (was M), weakened**
- (`headers.ts:63`) "enhanced relative to what?" — unguessable; builds the Kovo fragment-mutation
  request headers. "enhanced" appears nowhere in SPEC. **Recommendation:** rename to
  `mutationRequestHeaders`/`fragmentMutationHeaders`; document the `Kovo-*` wire headers per §9.1.

**`@kovojs/test/harness#KovoTestContext` — `db` + `dbHandle()` duplication — L, confirmed**
- Both reach the identical wrapped db (`harness.ts:21`). **Recommendation:** drop `dbHandle()` (or
  make `db` the getter) so there is one documented accessor.

### CLI surface

**`@kovojs/cli#KovoCheckInput` / `KovoExplainInput` alias `unknown` — M, confirmed**
- Both public input types are `unknown` (`index.ts:3589/3598`), so the facade gives no
  compile-time help — every real call site imports the *typed* `KovoExplainInput` from
  `@kovojs/core/internal/graph` and casts. **Recommendation:** collapse to a single exported
  branded/opaque `KovoGraph` type re-exported from `@kovojs/cli` (or re-export the core graph type
  publicly) so callers get one typed input instead of two `unknown` aliases + an `/internal`
  import.

**`@kovojs/cli#KovoCheckResult` → `KovoVerifierResult` — L, confirmed**
- Returned by *both* `kovoCheck` and `kovoExplain` (`index.ts:79`), so the check-specific name
  surprises readers of `kovoExplain(): KovoCheckResult`. **Recommendation:** rename to
  `KovoVerifierResult` (or `KovoCliResult`); keep the `{exitCode, output}` shape (its stable text
  format is SPEC §11.4 load-bearing) and document that `output` is the stable
  `kovo-check/v1`|`kovo-explain/v1` text.

**`@kovojs/cli#KovoExplainOptions` boolean-literal discriminator — L, weakened**
- Discriminates on `endpoints:true`/`unguarded:true`/`unscoped:true` vs a `kind` field
  (`index.ts:3536`). **Verifier note:** boolean-literal-presence discriminants are legitimate TS,
  not strictly "flag transliteration" — this is a stylistic preference. **Recommendation
  (optional):** offer a single `mode` discriminant (`{ mode: 'endpoints' } | { mode: 'unguarded';
  … } | { kind; target; … }`) for idiomatic narrowing; low priority given 0 import lock-in.

**`create-kovo` command flags — M, confirmed**
- Supports only `<target-dir> [--name]` (`index.ts:151`); lacks `--template`/`-t`, package-manager
  detection, `--yes`/non-interactive, git-init, auto-install, and interactive prompts — all
  `create-next-app`/`create-vite` conventions; unrecognized flags are silently ignored.
  **Recommendation:** add at least `--template <name>` (even with one template, for
  forward-compat + familiarity), package-manager handling, and an interactive prompt when args
  are omitted — or document the single-template-by-design choice in the README.

### Server: rendering / metadata / composition

**`@kovojs/server#metaFromQuery` — arity-overloaded return — L, confirmed**
- One name, two arities returning two different things — a deferred `RouteMetaFactory` (2-arg) vs a
  resolved `Meta` (3-arg) (`meta.ts:32`); the 3-arg form is undocumented. Next separates static
  `metadata` from async `generateMetadata`. **Recommendation:** keep the 2-arg deferred form as the
  documented primary (mirrors `generateMetadata`); split the eager form to
  `resolveMetaFromQuery(query, value, derive)`; add `@example` for both; cite SPEC §6.4.

**`@kovojs/server#mutationFormAttributes` / `renderMutationFormAttributes` — L, weakened**
- Two helpers for one job differing only by JSX-object vs HTML-string output, distinguished by a
  `render` prefix that doesn't telegraph "string vs object" (`mutation.ts:467/486`). **Verifier
  note:** the string variant *has* real SSR-template call sites (2 in `examples/reference`), so it
  is not vestigial. **Recommendation:** keep `mutationFormAttributes` (object) primary; rename the
  string form to `mutationFormAttributesHtml` (or document `render*` = HTML-string for non-JSX
  templates).

**`@kovojs/server#guards.all` — L, confirmed (softened)**
- `guards.all(...items)` composes left-to-right, first-denial-wins (`guards.ts:201`). **Verifier
  note:** short-circuit-on-first-failure is actually consistent with logical-AND (`&&`), so the
  name isn't as misleading as claimed; the real gap is that it returns a *guard composer*, not a
  boolean. **Recommendation:** keep `all` (or offer `compose`/`every` as an alias); document the
  short-circuit composition behavior.

### Headless-UI / UI component conventions

**`@kovojs/headless-ui/tabs#tabsPanelAttributes` → `tabsContentAttributes` — M, confirmed**
- Every other primitive uses "Content" (`dialogContent`, `selectContent`, …) and Radix Tabs uses
  `Tabs.Content`; Tabs uniquely uses "Panel" (`tabs.ts:159`; options interface at `:52`) — a
  double deviation (matches only Base UI). **Recommendation:** rename to `tabsContentAttributes`
  for Radix + house consistency, or explicitly document the deliberate Base-UI "Panel" choice.

**`@kovojs/headless-ui/field#field*` vs `fieldset*` mixed prefixes — M, confirmed**
- One `./field` subpath exports two distinct `*RootAttributes` (`fieldRootAttributes` and
  `fieldsetRootAttributes`, `field.ts:40`/`:102`) with divergent prefixes; a consumer can't tell
  Fieldset parts are bundled. Base UI splits Field and Fieldset. **Recommendation:** split Fieldset
  into its own `./fieldset` subpath; avoid two `*RootAttributes` in one entry.

**`@kovojs/headless-ui/internal#defineVariants` (+`cn`) → public `cva`/`cn` — M, weakened**
- `defineVariants` *is* cva and `cn` is a clsx-style joiner (`variants.ts:57`/`class-names.ts:34`),
  both hidden behind `/internal` with 0 usage. **Verifier correction:** `cn` is **not**
  clsx+tailwind-merge — it's a clsx-style joiner with Set dedup, *no* Tailwind conflict-merging;
  compare to `clsx`/`classnames`, not tailwind-merge. **Recommendation:** if intended app helpers,
  expose on a public `./variants` (alias `defineVariants`'s doc to "Kovo's cva"); don't leave a
  cva clone `@internal`.

**`@kovojs/headless-ui/toast#` event-name constants & `*Payload` types — L, confirmed**
- Toast adds an event-bus layer (`toastShowEventName='toast:show'`, `ToastShowPayload`,
  `toast.ts:10`) atop the house attribute-function model — an inconsistency with no analogue
  elsewhere. **Verifier note:** the standard `*Attributes` surface is still present (it's an
  *additional* layer), and `serverFactKeys` suggests the event names are an intentional
  server-integration contract. **Recommendation:** document why Toast uses an event protocol;
  confirm `toast:show`/`toast:dismiss` are an intentional public contract; consider a `ToastEvents`
  namespace.

**`@kovojs/ui/button#Button` — no `cva`/`buttonVariants`/`VariantProps` — M, confirmed**
- `variant`/`size` are union props; styling via StyleX `buttonStyles`/`buttonClasses`; no
  `buttonVariants()` recipe, the single most-recognized shadcn export (`button.tsx:60-161`).
  **Recommendation:** document prominently that Kovo uses StyleX (not cva); if a class-recipe is
  wanted, add `buttonVariants(opts)` returning the merged class string (mirroring shadcn's
  signature); at minimum rename/doc `buttonClasses` so its positional meaning is clear.

**`@kovojs/ui#<part>` `styles` slot-map vs `className` — M, confirmed**
- No component accepts `className`/`class`; overrides go through `styles?: XStyleOverrides`
  (MUI `slotProps`-shaped) (`dialog.tsx:15`). The universal escape hatch is absent — the single
  biggest familiarity gap. **Recommendation:** keep the slot-map for per-part overrides but *also*
  accept a top-level `style?: StyleInput` on every component (Button already does), named
  consistently; document `styles` as the multi-part analogue of shadcn slot styling.

**`@kovojs/ui/drawer` — monolithic `Drawer` + compound `DrawerRoot` dual API — L, weakened**
- Drawer exposes both a prop-driven `Drawer` (title/trigger props) and a `DrawerRoot/Trigger/
  Content` compound set (`drawer.tsx:29`/`:48`). **Verifier correction:** `sheet.tsx` has the
  *same* dual API — only `dialog.tsx` is compound-only — so "diverges from every other component"
  is wrong; it diverges from dialog and from Vaul/shadcn (compound-only). **Recommendation:** pick
  one (make `Drawer` the compound Root, or rename the convenience wrapper `SimpleDrawer`) and align
  Drawer + Sheet with the dialog pattern.

**`@kovojs/ui/command#CommandListbox` → `CommandList` — L, confirmed**
- cmdk/shadcn users know the part as `CommandList` (+`CommandGroup`/`CommandSeparator`); Kovo names
  it `CommandListbox` and omits Group/Separator (`command.tsx:425`). **Recommendation:** rename to
  `CommandList` (ARIA role can stay `listbox`); add/document `CommandGroup`/`CommandSeparator` and
  the `CommandValue` filtering model.

### Server registration naming (forward-looking)

**`@kovojs/server#query`/`mutation`/`endpoint`/`webhook`/`domain` → `define*` family — L, weakened**
- Bare-verb factories (`mutation.ts:444`, `query.ts:198`, …) read like hook calls and clash with
  the core `query` handle (see above). **Verifier note:** the codebase already aliases `mutation`
  as `defineMutation` in test fixtures, showing the `define*` name is feasible but deliberately not
  the public spelling. **Recommendation:** adopt a consistent `define*` family (at least resolving
  the `query` clash), or document the bare-verb convention so the asymmetry with `@kovojs/core#query`
  is intentional. High call-site cost (`mutation` 107 imports) — sequence carefully.

**`@kovojs/core#form` — `form(key)` + `form.get(path)` overload — L, weakened**
- One callable named `form` carries `.get` for an unrelated concept (GET-route search forms vs POST
  mutation forms, `index.ts:707`). **Verifier correction:** `form.get('/products')` is the
  *literal SPEC §6.3 spelling* (SPEC.md:697) and is demonstrated in the routing guide — renaming it
  would diverge from the normative spec. **Recommendation:** **do not rename**; instead document
  prominently that `mutation={value}` is preferred and `form(key)`/`form.get(path)` are the
  cannot-import-the-value fallback (SPEC §6.3 "survival spelling").

---

## DOCUMENT (100)

> Each API below should *stay as-is* but needs better docs — missing JSDoc, a usage example, a
> SPEC cite, or a "this is not what you think it is" disambiguation. Grouped by package; sorted by
> confidence. These were not independently re-verified (each is low-risk: "add docs").

### `@kovojs/core` — authoring (11)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | `href` | Familiar typed URL builder, but 0 app-source call sites + a hidden gotcha: `params` flips to a **required** positional object when the path has segments. Add a core.md example for the required-params and search cases; note it returns an encoded anchor-ready string. |
| H | `RouteRegistry`/`QueryRegistry`/`MutationRegistry`/`InvalidationSets`/`OptimisticDerivationSets` | Five empty augmentable interfaces populated by **compiler codegen** (TanStack's generated `routeTree` analogue) — but nothing says so; a dev won't know whether to hand-augment. Document them as compiler-generated registries (cite SPEC §6.1/§11.4), say apps don't hand-write the `declare module` block, and add a "generated registries" narrative. |
| M | `component` | `render` is `(queries, state, slots)` positional, forcing `(_q,_s,{children})` boilerplate; relationship to plain-TSX authoring is undocumented. Document the arg order with a slots-only example and that exported TSX fns are also components; consider a single-object `render({queries,state,slots})`. |
| M | `ComponentRenderSlots` | The third positional arg that delivers `children` (not props); named slots are untyped (`[slot]: unknown`); the `forms?`-vs-`forms` conditional is invisible. Document prominently with a slot-only example; consider typing named slots. |
| M | `ErrorBoundary` + `ErrorBoundaryProps` + `ComponentErrorBoundary` | Two shapes for one concept (`<ErrorBoundary>` element vs `definition.errorBoundary`); undocumented `target`; diverges from `react-error-boundary` (`fallback`/`onError`). Document both forms, define `target`, align on the `fallback` convention; consider aliasing away the duplicate. |
| M | `route` | Two `route()` exist (core vs server); the `params: { id: '' }` type-only sentinel is unfamiliar. Document the core-vs-server split and the sentinel convention (cite SPEC §6.4); consider accepting a validator to match TanStack. |
| M | `redirect` + `Redirect` | Matches Next/TanStack `redirect()` in name, but **returns** a 303 value (you `return` it) where Next/TanStack `redirect()` **throws** — a dev may call it for side effect and nothing happens. Document return-not-throw, the hardcoded 303, with a handler example. |
| M | `DiagnosticCode`/`DiagnosticSeverity` | High app/tooling usage but no pointer to where the 55 `KV###` codes are explained, and no severity-tier ordering for gating. Link the diagnostics reference, show a test-asserting-a-code example, document which severities block. |
| L | `Component` | Callable returns `any` with `Record<string,unknown>` props (untyped). Document as a compiler-facing descriptor rarely hand-annotated; give a typed-props example if app code references it, else consider `@internal`. |
| L | `ComponentRenderResult` | Kovo's `ReactNode` equivalent, but the `{[k]:unknown}` arm + "opaque" framing mislead. Note authored JSX/strings/fragment-arrays all satisfy it and the object arm is the lowered JSX element shape. |
| L | `Route`/`RouteOptions` | `prefetch: 'conservative'\|'moderate'\|false` semantics + the KV419 prerender hazard of `'moderate'` are undocumented. Document the values inline; confirm whether `RouteOptions` needs separate public existence from `Route`. |

### `@kovojs/core` — data / forms / webhooks (9)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `Query.refresh()/.args()` builder | The fluent chain is novel (no TanStack analogue) and thinly documented — only `.args()` appears in examples. Add a doc example for `.refresh({ every: '30s', until })` and `renderOnce` (cite SPEC §4.9). |
| M | `formFields` | Non-obvious: a compile-time exhaustiveness assertion, not a runtime accessor; the throwaway first arg + "Missing form fields" error-tuple are cryptic. Add an example and a one-line "omitting a field is a compile error" note. |
| M | `FieldError`/`FormError` | Render to string and are compiler-rewired (failure slot injected); calling them outside an enhanced form is a no-op. Add examples mirroring SPEC §6.3 and state the compiler-injection behavior. |
| M | `Storage*` types | The `StorageCapability` surface has no public way to obtain one (adapters are `@internal`). Add a cross-reference: "obtain a `StorageCapability` via `@kovojs/server`; these types describe read/write/stream." |
| M | `hmacSignature`/`standardWebhooks`/`customVerifier` | Good generated-doc examples but 0 real example-app usage. Document that verifiers attach via `webhook()` in `@kovojs/server`; add a real example wiring `standardWebhooks`. |
| L | `GetForm`/`GetFormInput`/`GetFormDescriptor` | Capitalized `.Form` property on an instance reads oddly and is undocumented as a renderable descriptor. Add one end-to-end example rendering `form.get(path)` into `<form method=get>`. |
| L | `Form`/`FormFailure`/`FormValidationFailure`/`FormInput`/`FormFieldName`/`ComponentMutationFormState` | Well-named but several are zero-example. Document `FormFailure`/`FormInput` with a "type a custom failure handler" example; note `Form`'s fields are type-only phantoms. |
| L | `Hmac*`/`Webhook*` support types | Mechanically identical config/result family, mostly 0/0. Keep the headline types public; reconsider exporting `ResolvedHmacSignatureConfig` and other internal-shape types. |
| L | `JsonValue` | High-use foundational type; only nit — note it's the canonical serializable-boundary constraint (island state, query args, route search) and cite SPEC. |

### `@kovojs/server` — data / validation (9)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `s.boolean` coercion | Empty string *and* absent both become `false` (not a validation error) — surprising vs strict `z.boolean()`, hides bugs. Document the exact truthy/falsy token table and the absent-as-false rule (§6.3 form rationale). |
| M | `MutationContext.fail`/`MutationFail`/`errors` | Kovo's whole typed-error model, diverging from every React analogue, with no top-level conceptual doc. Add a "typed mutation failures" block: declaring `errors`, returning `context.fail`, the `MutationFail` shape, status mapping, and `<FieldError>`/`<FormError>` rendering. |
| M | `invalidate` | Doc/visibility contradiction: public path but tagged `@internal`. Decide: if public, drop `@internal` and document standalone `invalidate` vs `context.invalidate` (domain-vs-queryKey semantics) with an example. |
| M | `QueryDefinition.instanceKey`/`version` | Cache-identity knobs a TanStack dev expects to map onto `queryKey`/`staleTime` but don't. Document `instanceKey` (canonical encoding, e.g. `product:p1`, when needed) and `version` (delta-base, §9.1.1) with an example. |
| L | `stream` | Public root export, generic name colliding mentally with web streams; 0 examples. Add a streaming-mutation example using `stream.text`/`stream.done`; document each builder + that text chunks are server-serialized. |
| L | `errorBoundary` | Name evokes React's `<ErrorBoundary>`/`error.tsx` but it's a server fragment-renderer wrapper taking a `FragmentRenderer`. Document the precise contract and disambiguate; consider renaming. |
| L | `endpoint` CSRF opt-out shape | The `csrf:false` + `csrfJustification` pair is unusual (justification usually inside the field). Document the contract (why justification is mandatory, §6.6 audit). |
| L | `QueryDefinition.reads` vs `MutationDefinition` `touches` | The read/write duality uses `reads` on one side but `touches`/`invalidate` on the other. Add one conceptual doc defining the domain graph (queries `reads`, writes `touches`, handlers `invalidate`); cross-link SPEC §10.1. |
| L | `Schema.parse` (throws, no `safeParse`) | Mirrors `z.infer` but no `safeParse` and a hidden `parseAsync` (only on object/file). Document that `parse` throws `SchemaValidationError`, no `safeParse` (catch instead), and which schemas require `parseAsync`. |

### `@kovojs/server` — request / auth lifecycle (12)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `guards` | Namespaced factory object that must be **called** (`guards.authed()`) before use — React devs from Auth.js/`beforeLoad` expect otherwise. Document `guards.all` composition, query+mutation attachment, `role()`/`rateLimit()` examples, the `AuthenticatedRequest` refinement. |
| M | `SessionProvider`/`sessionProvider` option | The `session()` → `SessionProvider` → `createApp({ sessionProvider })` chain is the auth-wiring story but undocumented end-to-end. Add a full-chain example. |
| M | `csrfToken`/`csrfField` | Bespoke and mostly auto-handled; docs don't say *when* an app must call them (hand-written forms only). Document that framework-emitted forms include CSRF automatically; note the secret/sessionId requirement. |
| M | `createApp` | Strong entry point, but `CreateAppOptions` has zero JSDoc on its auth-relevant fields. Add JSDoc per field + a fuller `sessionProvider`+`db`+`csrf`+`errorShells` example. |
| M | `setCookie` (`MutationContext.setCookie`) | No Next-style `cookies()` accessor and **no cookie reader** anywhere — cookies are set only inside a mutation ctx. Document the overloads + `CookieOptions`, why it's mutation-scoped, and how to **read** cookies. |
| L | `CsrfOptions`/`CsrfValidationOptions` | Two near-identical option types differing only by an optional `field`. Document which a mutation's `csrf:` takes, or collapse them. |
| L | `createRequestHandler` | Web-standard (Request→Response) but JSDoc lacks a usage example and doesn't mention it throws unless given a real `createApp()` aggregate. Add both. |
| L | `toNodeHandler` | Excellent ecosystem-matching name (mirrors better-auth). `NodeHandlerOptions` (`origin`/`earlyHints`) is thin — document `origin` resolution and `earlyHints`. |
| L | `CookieOptions` | Familiar shape but no JSDoc and 0 usage despite being needed for `ctx.setCookie`. Add per-field JSDoc; reference from the setCookie docs. |
| L | `GuardResult`/`GuardFailure`/`ResolvedGuardFailure` naming | Denial vocabulary is inconsistent (Denial vs Failure vs Result); `true`/`false`-vs-typed-Denial is only in prose. Add a "authoring a custom Guard" block. |
| L | `respond` | Clear name/JSDoc, but has only `file`/`stream` (no `respond.redirect`/`respond.json`) while `redirect` lives in `@kovojs/core`. Document the split; optionally cross-link. |
| L | `AuthenticatedRequest`/`SessionRequestLike`/`SessionUserLike` | The constraint+refinement types for `guards.authed<AppRequest>()`, but the contract is unexplained. Document that an app request should extend `SessionRequestLike` and `guards.authed()` refines to `AuthenticatedRequest`. |

### `@kovojs/server` — rendering / build (8)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `build#node`/`vercel`/`cloudflare` presets | Maps exactly to Nitro/Astro/TanStack-Start **adapters** but called "presets," documented only by JSDoc. Document each with a full `kovo.config.ts` example and the "preset = deploy adapter (Nitro-style)" sentence. |
| M | `kovoAppShellViteDevPlugin`/`createKovoAppShellViteDevIntegration` | Internal app-shell dev-integration leaked onto the public root; `kovo()` already wraps them. Move to `@kovojs/server/internal/*` and keep only `kovo()` public, or document them as advanced. |
| L | `build#KovoPreset` | Public custom-deploy-target interface with no hand-written-preset example. Add a "writing a custom preset" example (`emit()` copying `build.clientDir`/`serverHandlerPath`). |
| L | `vite#kovo` | Correct vite-plugin name, but the two surprising constraints (app must default-export a `KovoApp`; module-id form) aren't stated. Document `options.app`. |
| L | `i18n`/`t` | Single-letter `t` is the right i18n convention, but as a bare top-level export the design status is unclear. Document the status honestly and ground in SPEC if/when normative. |
| L | `DocumentTemplate`/`DocumentParts`/`DocumentTemplateContext` | Kovo's `_document`/app-shell equivalent, public but no example of re-emitting parts. Add a `DocumentTemplate` example inlining `parts.head`/`parts.queryScripts`. |
| L | `exportStaticApp` | Well-typed but 0 examples and a sharp gotcha — omitting `outDir` is a dry run (no writes). Add `@example` and document the dry-run + `createApp()`-input requirement. |
| L | `AppDocumentOptions`/`AppErrorShellOptions`/`ErrorShellRenderer` | App-shell 403/404/500 + document knobs on `createApp`, one-line JSDoc only. Document `createApp({ errorShells, document })` with a mapping example. |

### `@kovojs/browser` — authoring (8)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `trustedHtml` | Docs never name the React analogue (`dangerouslySetInnerHTML`), which sinks require it (KV236 raw HTML/`srcdoc`/script-JSON), or show an example. Document: "Kovo's `dangerouslySetInnerHTML`; suppresses KV236 only for SPEC §4.8 unsafe sinks." |
| M | `derive` | String-array-of-input-names + positional args is unusual; inline `{expr}` auto-lowers to this (KV210). Document that hand-authoring is the escape hatch and the input/arg contract. |
| M | `handler` | Two undocumented gotchas: `ctx.state` is **mutated in place** and committed by the runtime, and the commit model. Document the mutate-and-commit semantics. |
| M | `OptimisticTransform`/`OptimisticEntry`/`OptimisticPlan`/`OptimisticFor` | Strong design but its mapping onto TanStack's `onMutate`→`setQueryData`→rollback model is implicit. Add a family doc mapping "transform = pure `onMutate` predictor; snapshot/rebase = rollback." |
| M | `tempId` | Useful (§10.5 INSERT×AGG) but 0 usage — hard to discover. Add an example using `tempId()` in an `OptimisticTransform` that pushes a draft row. |
| L | `OptimisticChange`/`MutationChangeRecord` | Leak via `OptimisticQueryKey`'s function form; `change.domain`/`change.keys` are unexplained. Document them (domain defaults to `'mutation'`) with a `keys:` example, or hide if apps only pass strings. |
| L | `ElementParamValue`/`HandlerContext`/`ClientHandler` | App-facing handler typing but share placeholder boilerplate JSDoc. Replace with purpose-specific docs (`HandlerContext` = typed island ctx: mutable `state`, `params`, …). |
| L | `BrowserTrustedHTML`/`TrustedHtml` | Two near-identically-named types differing only by capitalization/prefix — a casing-collision footgun. Document the relationship; consider renaming the wrapper `KovoTrustedHtml`. |

### `@kovojs/browser/client` (6)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | stamped boilerplate JSDoc across ABI families | Dozens of public types carry the identical "Runtime API used by Kovo applications and generated runtime integration." stamp — useless next to `installKovoLoader`. Either remove (preferred, see Remove) or replace with a one-line "Runtime/compiler ABI — not hand-authored; SPEC §9.1" and segregate under an "Advanced / runtime integration" heading. |
| M | `installKovoLoader` | The one app-authored client entry (the `hydrateRoot`/`RouterProvider` analogue), but `KovoLoaderOptions` has ~20 fields with no minimal-vs-advanced guidance. Split the option doc into app-facing vs compiler-emitted. |
| M | app-facing loader/root/store option interfaces | Legitimately public (params/returns of kept helpers) but several carry only the stamp; fields undocumented. Document `KovoLoaderOptions` field-by-field (mark compiler-emitted vs app-set) and the `KovoLoader` handle's `dispose`/events. |
| L | `createBrowserKovoRoot` | Good `@example` but 0 usage / 1 import. Confirm in docs whether app entries hand-write it or the compiler emits it; if compiler-only, mark advanced. |
| L | `createQueryStore` | Clean factory + good `@example`; reads like TanStack `QueryClient` but isn't a fetching client. Document that it's the hydration-backed value store the loader reads. |
| L | `defaultEnhancedFetch` | Clear JSDoc but 0 usage. Document whether the loader applies it automatically when `enhancedMutations.fetch` is omitted. |

### `@kovojs/style` (9)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | `create` | Mirrors `stylex.create` (familiar) but the doc leans on internal framing ("TS-native fork point", "`__rules`") with no end-to-end example, and the optional `identity` arg is undocumented. Add `style.create({box:{padding:8}})` → `<div {...style.attrs(s.box)} />`; document or hide `identity`. |
| M | `defineVars` | Mirrors vanilla-extract `createVars`/StyleX `defineVars` but 0 app/example usage and competes with `defineTheme`. Document it as the manual StyleX-style token path, distinct from `defineTheme`. |
| M | `createTheme` | Mirrors vanilla-extract `createTheme` (returns a class) but 0 usage. Document the apply flow (`class={theme.className}`) and cross-link `defineTheme`. |
| M | `defineTheme` | The real app theme entry (every example uses it) but no React analogue — a Material Color Utilities seed generator. Expand docs: seed → `theme.css` → injection → `style.tokens.sys.color`. |
| M | `tokens` | Typed accessor used inside `create` (`style.tokens.sys.color.surface`) but Material-specific (sys/ref/custom) with no analogue. Document with a real example + a Material-role→plain-name map. |
| M | `keyframes` | Mirrors `stylex.keyframes` but JSDoc calls it a "placeholder for the compiler's later extraction pass." Document its current status honestly (what it emits today) with an example. |
| L | `cn`-equivalent (missing) | Every shadcn/Tailwind dev reaches for `cn()`; Kovo has none and `attrs` rejects plain strings. Add a "There is no `cn()` — why" doc: `style.attrs(a,b)` does last-wins per-property merging. |
| L | `Theme*ColorTypes` family | ~16 unfamiliar Material-domain types on the public surface (0/0). Document as one group anchored to `defineTheme`/`tokens`; consider whether all need exporting. |
| L | `data-style-src` leak | `attrs(...)` returns a `data-style-src` provenance attribute spread onto user elements. Document it (dev provenance; whether stripped in prod). |

### `@kovojs/better-auth` (2)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `role` | Overload type-checks the role name but no usage example and doesn't state the `session.user.roles` requirement. Add `role<Req>('admin')` + `all(authed, role('admin'))` examples and the required session shape. |
| L | `BetterAuth*` public types | Structurally-satisfied helper types apps rarely name (0 imports). Note they're structural/optional-to-name; consider dropping the `betterAuth` prefix for consistency with any function renames. |

### `@kovojs/drizzle` (1)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| M | `kovo` view/`fans` forms | The `view` (KV412) and `fans` (KV413) overloads are real capability with zero example coverage. Add worked examples (a `pgView` + `kovo({ view: { of: 'order', refresh: 'async' } })`, and a `fans` trigger fan-out) to `site/gen/api/drizzle.md` and an example schema. |

### `@kovojs/test` (5)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | `html-fragment` — all 16 extractor functions | **Zero JSDoc** on any extractor and **no generated doc page** (`test-html-fragment.md` absent). Add JSDoc (param/return/example + SPEC §9.1/§12) to every function; build the generated page; explain the `kovo-query`/`kovo-fragment`/`kovo-key` selectors. |
| M | `harness#createKovoTestHarness` exec/page return shapes | SPEC §12 shows `.queries.cart.count`/`.error.code` and `page()` returning HTML you call `.fragment()` on; the impl returns a generic shape. Reconcile the shape or update SPEC §12. |
| L | `headers` cookie/header readers | Familiar but no example/doc page; `firstSetCookiePair`'s attribute-dropping is a gotcha. Add a session-cookie-extraction example and the generated page. |
| L | `assertions#assertMutationError` | Well-documented in source but 0 imports + no doc page — looks unused. Surface it in the generated doc with the payload-return example. |
| L | `pglite#createPgliteTestDb` | `PgliteTestDb` exposes both `query()` and `sql()` with identical behavior. Document the intended distinction (or remove one); add the no-external-db note to the doc page. |

### `@kovojs/cli` (3)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | command naming (`kovo check`/`explain`/`audit`) | Names are well chosen, but `kovo audit` duplicates `kovo explain --unguarded/--unscoped` (same audits) — ambiguous "which do I run?". In cli.md, note `audit` = shorthand for both audits; cross-link. |
| M | `kovoCheck` | `options.family` type `KovoCheckFamily` (`'all'\|'coverage'\|'optimistic'`) is **not exported**, so a TS caller can't name it. Export `KovoCheckFamily`; add the literal values to the JSDoc. |
| M | `runKovoCommand` | 0 inventory usage but it *is* used by the create-kovo template (`export-static.mjs`). Document it as "generated-script-only; prefer the `kovo` bin," with a usage example. |

### `@kovojs/headless-ui` — conventions + barrel (12)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | `<part>Attributes` function model (whole package) | Radix/Base users expect compound **components**; here there are none — headless-ui is attribute-computers + state-reducers + chained handlers, consumed mostly by `@kovojs/ui`. Add a package-level overview stating the model (cite SPEC §4.6); without it the surface reads as a broken Radix. |
| H | compound-part naming (Root/Trigger/Content/Item/List/Viewport/Indicator) | The part vocabulary is **excellent and Radix-aligned** (exact NavigationMenu part names) — a keep — but the `<X.Root>` → `xRootAttributes()` mapping is never documented, so familiarity is accidental. Document the convention once. |
| H | `onValueChange`/`onOpenChange` detail-object signature | Radix passes the raw value (`onOpenChange(open: boolean)`); Kovo passes a cancelable **detail object** (`{value, reason, preventDefault}`). A Radix dev will read `detail` as a boolean and break. Document the detail shape + cancelable rationale (§4.6); consider matching Base UI's `(value, detail)`. |
| H | no uncontrolled/`defaultValue` mode | Radix/Base support both controlled and uncontrolled; Kovo is **controlled-only** (island state owns the value) — a dev will hunt for `defaultOpen` and not find it. Document the controlled-only contract + SPEC rationale once. |
| H | `<primitive>` attribute-builder model (barrel) | The prop-getter seam under the §4.6 attrs-function/`asChild` compiler form — closest to react-aria/downshift `getProps()`, but without the hook framing. Add a package doc + `site/gen/api/headless-ui.md` explaining when to call these directly vs author JSX. |
| H | JSDoc coverage across primitive subpaths | Largest surface (871 symbols), thinnest docs: most functions have no JSDoc; `separator`/`avatar`/`meter`/`progress` have **zero**; no generated page. Add `site/gen/api/headless-ui.md` and one JSDoc block per builder (part, state read, ARIA/`data-*` emitted, §4.6 merge, spread example). |
| M | `data-state`/`data-disabled`/`data-orientation` conventions | Exactly Radix's `data-*` surface (a keep), but values are only discoverable from source. Document the `data-state` vocabulary per primitive + the KV232 "primitive wins" override hazard (§line 310). |
| M | `*TriggerClick`/`*KeyDown` chained handler family | The primary app-facing entry points (called inside `onClick`), yet most carry only boilerplate JSDoc. Add per-handler JSDoc: event type, what the returned `ChangeResult` means, how to apply it, the `Object(event)` wrapping idiom. |
| M | `*AttributeOptions`/`*State`/`*ChangeDetail`/`*ChangeResult` type family | Mechanically-generated per-part types dominate the export count, mostly 0/0. Keep `*ChangeDetail`/`*State` (consumed); consider not exporting the zero-usage `*AttributeOptions`/`*MoveResult`/`*ChangeResult`. |
| M | `setXxx`/`toggleXxx`/`incrementXxx` state-mutator functions | Pure state-math reducers on the same subpath as attribute builders; an app author rarely calls them. Document the layering (reducers are the island-runtime seam, not app entry points) and/or namespace them. |
| L | `checkbox#applyCheckboxIndeterminate` | One imperative DOM-mutating fn among pure attribute computers; the `apply*` verb appears only here. Document that it mutates `.indeterminate` and must run in the island after render. |
| L | `PrimitiveDataAttributes`/`PrimitiveStateToken`/`PrimitiveChangeDetail` shared vocabulary | The shared base types leak into each primitive's public `.d.ts` but aren't themselves re-exported from a public path. Either re-export them publicly (since they appear in public types) or restructure so they don't leak. |

### `@kovojs/ui` (5)

| Conf | API | Doc gap → addition |
| --- | --- | --- |
| H | whole package — versioned-package shape vs copy-in starter | Presents as a normal versioned dep (`@kovojs/ui/button`, semver, dist build), yet STABILITY.md says it's a shadcn-style copy-in (`kovo add`, "you own the code"). Add `packages/ui/README.md` stating the supported path is `kovo add <component>` and direct imports are prototyping-only; surface STABILITY.md in the API ref; consider an `@experimental` marker. |
| H | `<component>` JSDoc (absent across all subpaths) | **Zero** symbol-level JSDoc on the entire app-facing surface (only the `@jsxImportSource` pragma) — empty hover-docs, empty API ref. Add 1–3 line JSDoc per component (what it renders, compound-part order, minimal snippet) and per non-obvious prop (`contentId`/`titleId`, `styles` slot-map). |
| M | `<part>` `children` typed as `string` (not `ReactNode`/JSX) | A dev reads `children?: string` and concludes JSX children are impossible. Document (SPEC §5.2) that `children?: string` is the lowered-IR surface type and authors nest JSX normally. |
| M | `toast` (no imperative `toast()`/`useToast`) | The one shadcn component everyone expects an imperative trigger for (`toast('Saved')`/`useToast`); Kovo ships only static markup. Document how to show a toast in Kovo's model (island state + `ToastViewport`, or server-driven) with an example. |
| L | `card` (no compound parts) | shadcn Card ships 5 compound parts; Kovo's is bare. Either add the standard sub-parts for parity, or document that Card is a minimal container and header/footer composition is left to you. |

---

## Coverage Ledger

Every manifest-public subpath was reviewed. Export counts are the inventory's per-entry totals
(public-symbol declarations, including types).

| Package | Public subpath(s) | Exports | Audit slice | Evidence |
| --- | --- | ---: | --- | --- |
| `@kovojs/core` | `.` | 71 | core-authoring + core-data | `index.ts`, `forms-types.ts`, `storage.ts`, `verifier.ts`, `diagnostics.ts`; `site/gen/api/core.md`; examples/* |
| `@kovojs/server` | `.` | 181 | server-data + server-request + server-render-build | `src/*.ts`; `site/gen/api/server.md`; examples/* |
| `@kovojs/server` | `./build` | 12 | server-render-build | `build.ts`; `site/gen/api/server-build.md`; create-kovo template |
| `@kovojs/server` | `./vite` | 3 | server-render-build | vite plugin; examples `vite.config.ts` |
| `@kovojs/server` | `./app-shell/static-export` | 5 | server-render-build | `static-export-types.ts` (removal **rejected** — see Remove) |
| `@kovojs/browser` | `.` | 18 | browser-authoring | `src/*.ts`; `site/gen/api/browser.md` |
| `@kovojs/browser` | `./client` | 72 | browser-client | `loader.ts`, `dom-like.ts`, `query-bindings.ts`, `morph.ts`, … ; `browser-client.md` |
| `@kovojs/style` | `.` | 35 | style | `engine.ts`; `site/gen/api/style.md`; theme.ts |
| `@kovojs/better-auth` | `.` | 13 | better-auth | `src/internal.ts`; `better-auth.md`; examples auth |
| `@kovojs/drizzle` | `.` | 7 | drizzle | `drizzle-surface.ts`; `drizzle.md`; examples db.ts/schema.ts |
| `@kovojs/test` | `./assertions`,`./headers`,`./harness`,`./html-fragment`,`./pglite`,`./test-case` | 6/9/6/34/2/3 | test | `src/*.ts`; `test-*.md`; examples `*.test.ts` |
| `@kovojs/cli` | `.` | 12 | cli | `src/index.ts`, `commands-manifest.ts`; `cli.md` |
| `create-kovo` | (bin only — no importable JS) | — | cli | `package.json` (bin-only), `src/index.ts`, `templates/` |
| `@kovojs/headless-ui` | `.` + ~37 component subpaths | ~871 total | headless-conventions + headless-barrel | `src/primitives/*.ts`, `src/lib/*`, `internal.ts`; examples + `@kovojs/ui` |
| `@kovojs/ui` | `.` + ~46 component subpaths | ~700 total | ui-starter | `src/*.tsx`; STABILITY.md; cli `kovo add` |
| `@kovojs/compiler` | (no public subpath) | 0 | — | build-tool; all `apiBoundary.internal` — out of scope |

---

## Verification Caveats & Provenance

- **Rejected (1):** `@kovojs/server/app-shell/static-export` removal — false-premise (4 of 5
  types are *not* duplicated at the root). Recorded under Remove as ⚠ withdrawn.
- **Materially weakened/withdrawn (not recommended as stated):** `create-kovo` JS-export "leak"
  (the functions aren't importable — no `exports` map); `@kovojs/headless-ui/internal` removal
  (deliberate framework entrypoint — addressed as a Change instead); `@kovojs/better-auth#authed`
  collision (no actual top-level name clash).
- **Factual corrections folded in:** `cn` is a clsx-style joiner *without* tailwind-merge;
  TanStack `refetchOnWindowFocus` is `boolean | "always" | fn` (not a plain boolean); the dual
  `query` disambiguation lives in source JSDoc, not SPEC §10.2; the drizzle `kovo()` helper is
  governed by SPEC §10.1 (not §10.6); `form.get` is the normative SPEC §6.3 spelling (do **not**
  rename); `defineConfig` collision is mild (multiple tools' `defineConfig` coexisting is normal).
- **Method:** 15 package-scoped auditors → per-slice adversarial verification of every Remove/
  Change finding → cross-cutting synthesis (31 agents total). Document-category findings were not
  independently re-verified.
- **Working artifacts:** `scratch/public-api-inventory.{json,md}` (inventory),
  `scratch/devex-digest.md` (full per-finding detail incl. verifier notes),
  `scratch/doc-findings.md` (document one-liners).

## Suggested Sequencing

1. **Pre-v1 blockers (H, spec-grounded):** reconcile the 4 SPEC↔impl gaps (`trustedUrl`, drizzle
   `key`/`owner`, `kovoTest` §12); these are correctness/trust issues, not polish.
2. **Surface cleanup (M, mechanical, low call-site risk):** demote the ABI families
   (`browser/client` `*Like`/`Compiled*`/`Morph*`, headless-ui `*Change*`, ui `*Classes`/
   `*ClassNames`), drop the empty headless-ui `.` barrel and the dead `GuardFailure`/
   `MutationResponseHeaders`/`ComponentDefinition` duplicates. Ratchet via the api-surface gate.
3. **Renames (H–M, breaking — batch into one `0.x` minor with deprecation aliases per
   STABILITY.md):** `Link`→`linkProps`, `attrs`→`props`, `defineConfig`→`defineKovoConfig`,
   `session`→`defineSession`, the `betterAuth*`/`*Mutation` affixes, the dual-`query` resolution,
   and the headless-ui token-CSS public path. High-usage symbols (`mutation`, `s`) last.
4. **Docs (H, parallelizable):** generated API pages + JSDoc for `@kovojs/headless-ui` and
   `@kovojs/test`; the package-level mental-model overviews (headless-ui attribute model,
   controlled-only, `@kovojs/ui` copy-in vs versioned); the per-symbol document table above.

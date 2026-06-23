# No Raw String Markup In Public Authoring APIs

**Goal:** Block Kovo app authors from supplying markup as raw `string` where the public API should require JSX/TSX or an explicit trust boundary. Ordinary text values such as labels, IDs, paths, query keys, and escaped messages are out of scope.

**Normative basis:** `SPEC.md` section 4.1 says authored components are plain TSX and compiler-derived markup identities are not written by hand; section 4.8 owns DOM updates through generated plans; section 9.1 treats streaming text as escaped text and requires `TrustedHtml` for deliberate markup sinks. `rules/api-surface.md` requires public signatures to expose only app-facing, reviewed contracts.

**Inventory command:** `node .agents/skills/audit-public-api/scripts/inventory-public-api.mjs --json scratch/public-api-inventory.json --markdown scratch/public-api-inventory.md`

## Current Public Raw-Markup Surfaces

| Surface | Current allowance | Evidence | Initial recommendation |
| ------- | ----------------- | -------- | ---------------------- |
| `@kovojs/core#ComponentRenderResult` and `component()` | `ComponentRenderResult` includes `string`; `component()` render generics are `any`, and the JSDoc example returns a template string. | `packages/core/src/index.ts:41`, `packages/core/src/index.ts:97`, `packages/core/src/index.ts:127`, `packages/core/src/index.ts:133` | Block raw `string` component render results; keep ordinary text as children/message values through narrower helper types. |
| `@kovojs/server#route()` and `layout()` page/chrome callbacks | `Page = unknown` lets route pages, boundaries, and layout renders infer `string`; the route JSDoc example returns raw HTML. | `packages/server/src/route.ts:115`, `packages/server/src/route.ts:121`, `packages/server/src/route.ts:159`, `packages/server/src/route.ts:166`, `packages/server/src/route.ts:256` | Introduce a public `PageRenderResult`/`LayoutRenderResult` that excludes raw `string` markup but still allows `Redirect`, `NotFound`, and response outcomes. |
| `@kovojs/server#stream.fragment()` | `stream.fragment({ html })` accepts `html: string` and emits it as a fragment chunk. | `packages/server/src/mutation/streaming.ts:13`, `packages/server/src/mutation/streaming.ts:83` | Require JSX-rendered fragments or `TrustedHtml`; keep the wire chunk's serialized `html: string` internal to the transport boundary. |
| `@kovojs/server#renderMutationFormAttributes()` | Public helper renders form attributes as a string for template-string forms. | `packages/server/src/mutation.ts:70`, `packages/server/src/api/data.ts:9` | Remove from public root/API barrels; keep `mutationFormAttributes()` as the JSX spread helper. Move any string renderer to an internal/generated subpath if framework code still needs it. |
| `@kovojs/icons` per-icon components | Generated public icon functions return `string` even though they are authored as TSX. | `scripts/build-icons.mjs:103`, `packages/icons/src/accessibility.tsx:5` | Change generated public return type to an opaque JSX/object render result so icons are not a public precedent for string components. |
| `@kovojs/server#DocumentTemplate` | Custom document template returns `string` and receives already-rendered `parts.body`/`parts.head`. | `packages/server/src/document-core.ts:36`, `packages/server/src/document-core.ts:49`, `packages/server/src/api/rendering.ts:16` | Treat as an explicit document-shell exception unless product direction says even document framing must move to a branded `TrustedHtml`/template API. |

## Blocking Plan

- [ ] Define the public render-result vocabulary before changing signatures.
  - Evidence to collect: `SPEC.md` sections 4.1, 4.8, and 9.1; current declarations in `packages/core/src/index.ts`, `packages/server/src/route.ts`, and `packages/server/src/mutation/streaming.ts`.
  - Target shape: a non-string JSX/render result for components, routes, layouts, boundaries, and icons; a separate escaped-text/message result for places where plain text is expected.

- [ ] Block raw string component renders in `@kovojs/core`.
  - Evidence to collect: type tests around `component({ render })`, generated API docs for `ComponentRenderResult`, and representative component examples.
  - Implementation direction: remove `string` from the component render result used by `component()`; replace `any` render callback return types with the narrowed public type; update docs/examples from template strings to TSX; preserve string children/messages only through explicitly text-oriented props.

- [ ] Block raw string route pages, boundaries, and layouts in `@kovojs/server`.
  - Evidence to collect: all `route()`/`layout()` fixtures and examples returning strings; render pipeline acceptance of JSX, `Redirect`, `NotFound`, and `RouteResponseOutcome`.
  - Implementation direction: introduce `RoutePageResult` and `LayoutRenderResult` types; default `Page` generics to those narrowed result types instead of `unknown`; update route JSDoc and tests that use string pages.

- [ ] Replace `stream.fragment({ html: string })` with an explicit markup boundary.
  - Evidence to collect: streaming chat fixture, `mutation-response.test.ts`, and `SPEC.md` section 9.1 streaming guarantees.
  - Implementation direction: prefer JSX fragment rendering if the server renderer can synchronously produce a chunk; otherwise require `TrustedHtml` and unwrap only at the wire serializer. Keep `stream.text()` as the plain-string escaped text path.

- [ ] Remove string-template mutation form attributes from the public API.
  - Evidence to collect: public export list from `@kovojs/server` and `@kovojs/server/api/data`, generated docs, examples importing `renderMutationFormAttributes`.
  - Implementation direction: stop re-exporting `renderMutationFormAttributes` from public barrels; keep `mutationFormAttributes()` for `<form {...mutationFormAttributes(def)}>`; route internal string rendering through a non-public subpath if still needed.

- [ ] Re-type generated icon components so they do not advertise string render output.
  - Evidence to collect: `scripts/build-icons.mjs --check`, one generated icon source, icon package tests, and generated API docs.
  - Implementation direction: update the generator, regenerate icons, and verify `@kovojs/icons` public API still typechecks when composed inside Kovo JSX.

- [ ] Decide the `DocumentTemplate` exception explicitly.
  - Evidence to collect: `SPEC.md` section 9.5 intent, `DocumentTemplate` docs, CSP/document tests, and whether examples author custom templates.
  - Implementation direction: either document it as the only public raw document-shell string escape, or replace its return type with a branded `TrustedHtml`/document-template result and provide a migration helper.

- [ ] Add public API regression tests and docs gates.
  - Evidence to collect: `pnpm run check:api-surface`, generated API markdown, focused type tests, and `vp run typecheck-examples`.
  - Implementation direction: add `@ts-expect-error` tests for raw component/page/layout/fragment strings, positive tests for JSX and escaped text, and API docs that point authors to TSX or `trustedHtml()` where markup trust is intentional.

## Verification Plan

- [ ] Run focused package tests after each slice: `@kovojs/core`, `@kovojs/server`, and `@kovojs/icons`.
- [ ] Run example typechecking after route/component signature changes: `vp run typecheck-examples`.
- [ ] Run public API gates after each public signature change: `pnpm run check:api-surface`, `pnpm run check:exports`, and `pnpm run check:imports`.
- [ ] Run generated icon drift check after icon signature changes: `node scripts/build-icons.mjs --check`.
- [ ] Run `git diff --check` before each checkpoint commit.

## Open Risks

- [ ] Route/page string returns are likely the largest migration because tests and fixtures currently use raw string pages as terse HTML fixtures.
- [ ] `FieldError` and `FormError` currently return strings; blocking them publicly may need a separate internal placeholder/render-result type so helper strings do not become app-authored markup precedent.
- [ ] `DocumentTemplate` may remain an intentional low-level escape; changing it could create churn without improving ordinary app authoring safety.
- [ ] Generated API docs may expose many recursive return types; the API-surface baseline should be checked for both direct export changes and recursive publicness changes.

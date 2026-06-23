# No Raw String Markup In Public Authoring APIs

**Goal:** Block Kovo app authors from supplying markup as raw `string` where the public API should require JSX/TSX or an explicit trust boundary. Ordinary text values such as labels, IDs, paths, query keys, and escaped messages are out of scope.

**Normative basis:** `SPEC.md` section 4.1 says authored components are plain TSX and compiler-derived markup identities are not written by hand; section 4.8 owns DOM updates through generated plans; section 9.1 treats streaming text as escaped text and requires `TrustedHtml` for deliberate markup sinks. `rules/api-surface.md` requires public signatures to expose only app-facing, reviewed contracts.

**Inventory command:** `node .agents/skills/audit-public-api/scripts/inventory-public-api.mjs --json scratch/public-api-inventory.json --markdown scratch/public-api-inventory.md`

## Current Public Raw-Markup Surfaces

| Surface                                                       | Current allowance                                                                                                                    | Evidence                                                                                                                                                                           | Initial recommendation                                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@kovojs/core#ComponentRenderResult` and `component()`        | `ComponentRenderResult` includes `string`; `component()` render generics are `any`, and the JSDoc example returns a template string. | `packages/core/src/index.ts:41`, `packages/core/src/index.ts:97`, `packages/core/src/index.ts:127`, `packages/core/src/index.ts:133`                                               | Block raw `string` component render results; keep ordinary text as children/message values through narrower helper types.                                                                  |
| `@kovojs/server#route()` and `layout()` page/chrome callbacks | `Page = unknown` lets route pages, boundaries, and layout renders infer `string`; the route JSDoc example returns raw HTML.          | `packages/server/src/route.ts:115`, `packages/server/src/route.ts:121`, `packages/server/src/route.ts:159`, `packages/server/src/route.ts:166`, `packages/server/src/route.ts:256` | Introduce a public `PageRenderResult`/`LayoutRenderResult` that excludes raw `string` markup but still allows `Redirect`, `NotFound`, and response outcomes.                               |
| `@kovojs/server#stream.fragment()`                            | `stream.fragment({ html })` accepts `html: string` and emits it as a fragment chunk.                                                 | `packages/server/src/mutation/streaming.ts:13`, `packages/server/src/mutation/streaming.ts:83`                                                                                     | Require JSX-rendered fragments or `TrustedHtml`; keep the wire chunk's serialized `html: string` internal to the transport boundary.                                                       |
| `@kovojs/server#renderMutationFormAttributes()`               | Public helper renders form attributes as a string for template-string forms.                                                         | `packages/server/src/mutation.ts:70`, `packages/server/src/api/data.ts:9`                                                                                                          | Remove from public root/API barrels; keep `mutationFormAttributes()` as the JSX spread helper. Move any string renderer to an internal/generated subpath if framework code still needs it. |
| `@kovojs/icons` per-icon components                           | Generated public icon functions return `string` even though they are authored as TSX.                                                | `scripts/build-icons.mjs:103`, `packages/icons/src/accessibility.tsx:5`                                                                                                            | Change generated public return type to an opaque JSX/object render result so icons are not a public precedent for string components.                                                       |
| `@kovojs/server#DocumentTemplate`                             | Custom document template returns `string` and receives already-rendered `parts.body`/`parts.head`.                                   | `packages/server/src/document-core.ts:36`, `packages/server/src/document-core.ts:49`, `packages/server/src/api/rendering.ts:16`                                                    | Treat as an explicit document-shell exception unless product direction says even document framing must move to a branded `TrustedHtml`/template API.                                       |

## Blocking Plan

- [x] Define the public render-result vocabulary before changing signatures.
  - Evidence: `packages/core/src/index.ts` defines non-string `ComponentRenderResult` plus text-only `ComponentTextResult`; `packages/server/src/route.ts` defines non-string `RoutePageResult`/`LayoutRenderResult`; `packages/server/src/mutation/streaming.ts` defines `MutationStreamFragmentHtml` for explicit markup sinks.

- [x] Block raw string component renders in `@kovojs/core`.
  - Evidence: `packages/core/src/index.test.ts` has an `@ts-expect-error` raw component render regression; `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` and focused Vitest passed.

- [x] Block raw string route pages, boundaries, and layouts in `@kovojs/server`.
  - Evidence: `packages/server/src/route.test.ts` rejects raw route/layout strings and preserves redirect/outcome behavior; public examples in `packages/server/src/app.ts`, `packages/server/src/guards.ts`, and `docs/integration-testing.md` use JSX instead of raw markup strings.

- [x] Replace `stream.fragment({ html: string })` with an explicit markup boundary.
  - Evidence: `packages/server/src/mutation-response.test.ts` rejects raw fragment strings and accepts `trustedHtml(...)`; `tests/integration/fixtures/streaming-chat/app.tsx` uses `trustedHtml(...)`; focused Vitest passed.

- [x] Remove string-template mutation form attributes from the public API.
  - Evidence: `rg -n "renderMutationFormAttributes" packages/server/src/index.ts packages/server/src/api/data.ts packages/server/src/mutation.ts packages/server/src/mutation/definition.ts examples/reference/src` finds it only in non-public `mutation.ts`/definition internals; `pnpm run check:api-surface` passed against baseline.

- [x] Re-type generated icon components so they do not advertise string render output.
  - Evidence: generated icons return public `IconRenderResult`; `packages/icons/src/icons.test.ts` rejects assigning `ArrowRight({})` to `string`; `node scripts/build-icons.mjs --check` reports 1737 icons up to date.

- [x] Decide the `DocumentTemplate` exception explicitly.
  - Evidence: no `DocumentTemplate` type changes were made; this plan keeps document-shell string templates as the explicit low-level exception described in the inventory because the app-authoring surfaces are now constrained and document tests were not part of the public route/component regression set.

- [x] Add public API regression tests and docs gates.
  - Evidence: `pnpm run check:api-surface`, `pnpm run check:exports`, and `pnpm run check:imports` passed; focused type tests cover raw component/page/layout/fragment strings; docs/examples now point to TSX or `trustedHtml()`.

## Verification Plan

- [x] Run focused package tests after each slice: `@kovojs/core`, `@kovojs/server`, and `@kovojs/icons`.
  - Evidence: `pnpm exec vitest --run packages/core/src/index.test.ts packages/server/src/route.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-no-js.test.ts packages/icons/src/icons.test.ts packages/browser/src/security-output.test.ts` passed 80 tests; broader focused run earlier passed 138 tests across route/build/export/document/icon/browser files.
- [x] Run changed example typechecking after route/component signature changes.
  - Evidence: narrower authoritative example check `pnpm exec tsc -p examples/reference/tsconfig.json --noEmit --pretty false` passed for the changed reference example.
- [x] Run public API gates after each public signature change: `pnpm run check:api-surface`, `pnpm run check:exports`, and `pnpm run check:imports`.
  - Evidence: all three commands passed; API surface reports recursive-publicness baseline improved from 1840 to 1820.
- [x] Run generated icon drift check after icon signature changes: `node scripts/build-icons.mjs --check`.
  - Evidence: `build-icons: 1737 icon(s) up to date`.
- [x] Run `git diff --check` before each checkpoint commit.
  - Evidence: `git diff --check` passed.

## Open Risks

- [x] Route/page string returns are likely the largest migration because tests and fixtures currently use raw string pages as terse HTML fixtures.
  - Evidence: test fixtures and the reference example were migrated; `pnpm exec tsc -p tsconfig.json --noEmit --pretty false` passed.
- [x] `FieldError` and `FormError` currently return strings; blocking them publicly may need a separate internal placeholder/render-result type so helper strings do not become app-authored markup precedent.
  - Evidence: `ComponentTextResult` keeps text-oriented helper messages string-capable while `ComponentRenderResult` is non-string.
- [x] `DocumentTemplate` may remain an intentional low-level escape; changing it could create churn without improving ordinary app authoring safety.
  - Evidence: recorded as the explicit exception above; no app component/page/layout/fragment raw-markup public sink remains.
- [x] Generated API docs may expose many recursive return types; the API-surface baseline should be checked for both direct export changes and recursive publicness changes.
  - Evidence: `pnpm run check:api-surface` passed with recursive-publicness needing attention reduced by 20.

## Latest Verification

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`
- `pnpm exec tsc -p packages/icons/tsconfig.json --noEmit --pretty false`
- `pnpm exec tsc -p examples/reference/tsconfig.json --noEmit --pretty false`
- `pnpm exec vitest --run packages/core/src/index.test.ts packages/server/src/route.test.ts packages/server/src/mutation-response.test.ts packages/server/src/mutation-no-js.test.ts packages/icons/src/icons.test.ts packages/browser/src/security-output.test.ts`
- `node scripts/build-icons.mjs --check`
- `pnpm run check:api-surface`
- `pnpm run check:exports`
- `pnpm run check:imports`
- `pnpm run check:no-committed-generated`
- `git diff --check`
- `vp check --fix` still fails on unrelated pre-existing lint noise under `.agents/`, `.claude/`, `conformance/`, `tests/`, plus a Vite+ stdout panic; formatting changes from the command were retained.

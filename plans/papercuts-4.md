# Papercuts 4

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
confirmed framework/template/docs/dev-tooling papercuts found while dogfooding five
advanced local Kovo apps.

Meta-theme: the ordinary app-author path is much greener than prior sweeps, but
production serving and typed framework contracts still have sharp edges.

## Scope

Dogfooded local packages through fresh SQLite apps under
`/Users/mini/kovo-dogfood-20260627`: `base`, `layout-regions-defer`,
`typed-read-skew`, `drizzle-data-depth`, `composition-style-packages`, and
`request-shell-errors`.

Baseline scaffold/link/install passed, and the base app passed `pnpm run check`,
`pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke. Track apps exercised
layouts/regions/defer, typed reads and deploy-skew probes, Drizzle owner-scoped
data flows, style/UI/headless/icon composition, and request-shell errors. Every
carried item below was independently verified by a skeptical pass; top findings
were also self-checked on the main thread where local drift allowed it.

Security-header regression RSE-1 is filed separately in `plans/bugz-6.md`.

## Issues

### A. Production Node Preset Startup

- [x] **Node preset server imports the raw app module and loses source-derived mutation keys.** (high, framework; found by `typed-read-skew`)
  - Observed behavior: `pnpm run build:prod` emitted a node preset artifact, but `node dist/server/server.mjs` failed before listening with `createApp() received a mutation without a derived key`.
  - Root cause: `packages/cli/src/commands/build-export.ts:1375` emits a server handler that imports the raw app module by file URL; the Vite transform path that calls `lowerStandaloneSourceDerivedRegistryDeclarations` lives at `packages/compiler/src/vite.ts:266`, and the helper injects `assignDerivedMutationKey` at `packages/compiler/src/source-derived-lowering.ts:41`. `packages/server/src/app.ts:261` then correctly fails closed on the unkeyed mutation.
  - Why it matters: SPEC §6.1/§6.3 make mutation keys source-derived framework metadata; a valid scaffold-style app can pass build and still be undeployable.
  - Repro evidence: in `typed-read-skew`, `node dist/server/server.mjs` exits 1 at `dist/server/server/handler.mjs:11521`; the emitted handler contains `addContact` in `createApp({ mutations: [...] })` and no `assignDerivedMutationKey`.
  - Acceptance: a production node preset app with object-form `mutation({ ... })` starts successfully without app-authored registry-key strings, and the emitted handler contains compiler-derived mutation metadata.
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts` proves the Node preset bundle contains compiler-derived object-form mutation metadata, starts, serves the route, and dispatches the derived-key mutation.

- [x] **Regression: node preset output still requires app-local `undici`.** (med, framework; found by `typed-read-skew`)
  - Observed behavior: before the app-local workaround, the built server failed with `Cannot find module 'undici'`.
  - Root cause: `packages/server/src/egress-undici.ts:14` uses `createRequire(...)(\"undici\")`; `packages/cli/src/commands/build-export.ts:1331` declares `undici` as a dynamic require target, but the emitted handler still contains `createRequire(import.meta.url)(\"undici\")`.
  - Why it matters: `plans/papercuts-3.md` marked this fixed, but a standalone scaffold can again build successfully and fail late at production startup.
  - Repro evidence: verifier inspection found `createRequire(import.meta.url)(\"undici\")` in `dist/server/server/handler.mjs`; the direct `undici` dependency added in the throwaway app masked the crash and exposed the next startup failure above.
  - Acceptance: a fresh scaffold's `pnpm run build:prod && node dist/server/server.mjs` reaches listen without adding `undici` to the app package.
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts` and `pnpm exec vitest run packages/server/src/egress-undici.test.ts packages/server/src/egress-bootstrap.test.ts` prove emitted handlers no longer contain `createRequire(import.meta.url)("undici")`, node preset startup reaches listen, and egress undici behavior still works.

### B. Typed Authoring Contracts

- [x] **Layout region names are widened to `Record<string, unknown>`, so typos type-check.** (med, framework; found by `layout-regions-defer`)
  - Observed behavior: a layout can read `regions.sidebarTypo` while the route declares only `page` and `sidebar`; TypeScript exits 0 and the region silently disappears.
  - Root cause: `packages/server/src/route.ts:92` types `LayoutRenderSlots.regions` as `Readonly<Record<string, unknown>>`; `packages/server/src/route.ts:202` stores route layouts as `LayoutDeclaration<any, any, any>`; `packages/server/src/route.ts:672` returns rendered regions as another unbounded record.
  - Why it matters: SPEC §4.5 says additional region names are scoped to the route/layout contract. This is exactly the kind of string contract Kovo usually makes type-visible.
  - Repro evidence: `pnpm exec tsc --ignoreConfig --noEmit ... scratch-region-contract-hole.tsx` in `layout-regions-defer` exits 0 with `regions.sidebarTypo` against a `{ page, sidebar }` route.
  - Acceptance: a layout that reads an undeclared region key fails type-checking, while declared sibling regions keep their inferred value type.
  - Evidence: `pnpm exec vitest --run packages/server/src/route.test.ts packages/server/src/app-authoring-context.test.ts` proves uncontracted `regions.sidebarTypo` fails type-checking, declared region values remain typed, and routes must provide layout-required regions.

- [ ] **`kovo explain page --layouts` starts from an empty graph in a built scaffold.** (med, dev-tooling; found by `layout-regions-defer`)
  - Observed behavior: the dev server serves `/docs/layout-regions?view=full` as 200, but `pnpm exec kovo explain page /docs/:slug --layouts` exits with `ERROR NOT_FOUND page /docs/:slug`; `build:prod` leaves no discoverable `graph.json`.
  - Root cause: `packages/cli/src/graph-output.ts:71` returns `{}` when no graph path is supplied, `packages/cli/src/graph-output.ts:593` searches that empty `graph.pages`, and `packages/cli/src/commands/build-export.ts:523` builds the check graph in memory without persisting a normal explain artifact.
  - Why it matters: SPEC §4.5/§5.3 advertises layout explainability, but the ordinary scaffold/build workflow gives authors no obvious graph to pass.
  - Repro evidence: `pnpm exec kovo explain page /docs/:slug --layouts` in `layout-regions-defer` prints `kovo-explain/v1 ERROR NOT_FOUND page /docs/:slug`; `find . dist src -maxdepth 5 -name graph.json` returns nothing.
  - Acceptance: after build/check, an app author can run a documented `kovo explain page ... --layouts` command that finds the app graph or prints the exact artifact path to use.

- [x] **`createTheme().className` conflicts with a `style.create` handle on the same component element.** (med, framework; found by `composition-style-packages`)
  - Observed behavior: `<section class={duskTheme.className} style={styles.shell}>` in a `component({ render })` fails with KV231 `class (writers: author JSX, style lowerer)`.
  - Root cause: `packages/style/src/engine.ts:424` exposes a public theme `className`; `packages/compiler/src/style.ts:344` extracts theme rules, but `packages/compiler/src/style.ts:948` rejects any non-static authored `class` when the style lowerer also writes `class`, instead of applying SPEC §4.6 class concatenation/dedupe.
  - Why it matters: SPEC §13.1 positions `createTheme` and `style.create` as natural companions; authors should not need wrapper elements just to apply a theme class and local style.
  - Repro evidence: `pnpm exec kovo build ./src/csp1-repro.tsx` in `composition-style-packages` fails at `src/csp1-repro.tsx:44:14` with KV231.
  - Acceptance: theme class values produced by `createTheme()` merge with style-lowered classes, or the style API exposes a first-class same-element theme application shape.
  - Evidence: `pnpm exec vitest run packages/compiler/src/style.test.ts` proves `createTheme(...).className` composes with same-element `style.create` classes while arbitrary dynamic class conflicts still use KV231.

- [x] **KV414 false-positives on direct `ownerId = session.userId` predicates.** (low, framework; found by `drizzle-data-depth`)
  - Observed behavior: direct secure predicates such as `eq(projects.ownerId, context.request.session.userId)` and `eq(tasks.ownerId, request.session.userId)` are classified as args/unknown owner audits rather than session-scoped owner proofs.
  - Root cause: `packages/drizzle/src/static/summaries.ts:583` only proves owner-private scope when the private key exactly matches the owner column name, such as `session:${owner}`; `packages/drizzle/src/static.ts:396` and `packages/drizzle/src/static.ts:570` then let arg-keyed predicates win or fall through.
  - Why it matters: this is fail-closed, not a bypass, but it blocks a straightforward secure owner-scoped app and nudges authors toward weakening annotations.
  - Repro evidence: the verifier's app-local extraction over `drizzle-data-depth` produced non-session owner audits for `task-list`, `comment-list`, `complete-task`, and `add-comment`; production graph output would emit KV414 for those non-`session` audits.
  - Acceptance: direct predicates comparing an annotated owner column to the configured session principal are accepted as session-scoped owner proofs even when the column is named `ownerId` and the session field is `userId`.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.scope-audits.test.ts` and `pnpm exec vitest --run packages/drizzle/src` prove direct `ownerId = session.userId` read/write predicates are session-scoped while arg-keyed and unknown owner predicates still fail closed.

### C. Dev Typed-Read Wire

- [x] **Dev `/_q` typed-read responses are prefixed with the Kovo HMR client script.** (low, dev-tooling; found by `typed-read-skew`)
  - Observed behavior: direct `GET /_q/directory-stats` returns a body beginning with `<script type=\"module\" src=\"/@kovo/hmr-client\"></script><kovo-query ...>`.
  - Root cause: `packages/server/src/query.ts:776` returns successful query reads as `text/html`, and the dev HMR wrapper injects into HTML responses; loader-style typed reads use `Accept: text/html` and `Kovo-Fragment: true`.
  - Why it matters: SPEC §9.4 treats the typed-read endpoint as inspectable wire. Curling it in dev shows extra executable dev markup that is not part of the query chunk.
  - Repro evidence: `curl -H 'Accept: text/html' -H 'Kovo-Fragment: true' http://127.0.0.1:5179/_q/directory-stats` in `typed-read-skew` returned 200 and an HMR-prefixed body.
  - Acceptance: dev HMR injection skips fragment/query endpoint responses, or those endpoints use a content type/path marker that cannot be mistaken for full documents.
  - Evidence: `pnpm exec vitest --run packages/server/src/vite-dev.test.ts` proves dev `/_q` typed-read fragment responses are not HMR-prefixed while full route documents still receive the HMR client.

## Refuted / Not Carried Forward

- `layout-regions-defer`: inline route param/search typing for `regions` is now good enough for the exercised app; the prior papercut-super-2 C1 did not reproduce.
- `layout-regions-defer`: deferred route-region output and deferred stylesheet wiring rendered expected `<kovo-defer>`, streamed fragments, boundary markers, and deferred style metadata.
- `composition-style-packages`: direct `@kovojs/icons` and `@kovojs/headless-ui` use worked after explicit app-local link dependencies; the previous local-link missing-package issue was not carried as new.
- `composition-style-packages`: UI/headless composition generally rendered for the exercised Button, Badge, Card, Tabs, Progress, icons, and headless progress attributes.
- `request-shell-errors`: endpoint redirect failures were app posture mismatches; adding `Cache-Control: no-store` and `reservedHeaders: ['Location']` made the endpoint return 302.
- `request-shell-errors`: manual `csrfField()` without anonymous CSRF binding was an app/harness artifact; compiler-emitted mutation forms stamped and posted correctly.
- `drizzle-data-depth`: opaque aggregate over a secret table correctly failed closed with KV435 until rewritten to explicit non-secret columns.
- `drizzle-data-depth`: missing optimistic transforms were app errors; adding expected coverage removed KV310.
- `typed-read-skew`: explicit public typed reads carried `kovo-build` and intended cache headers in dev; production typed-read behavior was blocked by startup failures above.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`: rebuilt the local scaffolder before dogfooding.
- Base app: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and dev `/login` smoke passed.
- Author fan-out: each track scaffolded, linked local packages, installed, and ran its applicable gates; exact app dirs are under `/Users/mini/kovo-dogfood-20260627`.
- Verifiers independently confirmed LRD-1, LRD-2, TRS-1, TRS-2, TRS-3, CSP-1, DDD-1, and RSE-1; RSE-1 was routed to `plans/bugz-6.md`.
- Main-thread self-checks: `node dist/server/server.mjs` in `typed-read-skew` reproduced the unkeyed mutation startup error; `curl` against `request-shell-errors` reproduced missing 404/500 headers and a hardened 403 control; `tsc` and `kovo explain` in `layout-regions-defer` reproduced the region typing and explainability failures.

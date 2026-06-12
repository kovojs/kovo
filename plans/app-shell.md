# App shell — request dispatch, document assembly, dev/build/export (D8)

Status: design agreed 2026-06-11 (decisions: lives in `@jiso/server`; Vite+ plugin is the dev path; minimal static export in scope); SPEC PR and implementation not started
Scope: SPEC addition (proposed §9.5 "The request shell"), `@jiso/server` shell modules, a node adapter, a Vite+ plugin, a static exporter, and adoption by the starter + a docs site as the first outside consumer. Referenced from `IMPLEMENT_v1.md` as workstream **D8**.

## Progress checklist

- [x] S8 spike: serve the pinned wire fixtures over real HTTP through a prototype dispatch path (enhanced mutation, no-JS PRG, 422 fragment, typed read, `<fw-defer>` stream, `/c/` module load) before freezing the `createApp()` shape (decision-gate writeup). Evidence: `conformance/app-shell-spike/src/index.test.ts` and `docs/app-shell-s8-spike.md` prove the pinned fixture bodies/headers over `node:http`, deferred chunk boundaries, and a versioned `/c/` module load; R3 can proceed with the closed `Request -> Response` handler shape.
- [x] SPEC PR: §9.5 request shell — dispatch table, document assembly contract, `createApp()` config surface (including the §6.5 `sessionProvider` home), error shells, export semantics, and the FW228/FW229 diagnostics.
      Evidence 2026-06-11: `SPEC.md` now defines §9.5 Request shell with the closed
      `createApp()` aggregate, web-standard `Request -> Response` handler currency, normative
      dispatch order, static-first route matching, document assembly contract, error shells,
      `sessionProvider` placement, static export semantics, and FW228/FW229 diagnostic table
      rows. Same-session evidence: `pnpm exec vp check --fix SPEC.md` and `pnpm run check`.
- [x] R1 route matcher + dispatch table (pure, no I/O). Evidence 2026-06-11: `packages/server/src/match.ts` and `packages/server/src/shell.ts` add no-I/O helpers for static-first route matching, raw params, trailing-slash 308 metadata, FW228-style ambiguity detection, and the printable reserved dispatch order; `packages/server/src/shell.test.ts` covers the slice.
- [x] R2 document assembly (`renderDocument`, deferred-stream variant, error shells). Evidence
      2026-06-11: `packages/server/src/document.ts` composes `renderPageHints`, initial
      `fw-query` hydration scripts, and the runtime inline loader into deterministic
      document shells, feeds the same assembled shell parts into deferred streams, supports
      app-level templates over assembled parts, wraps successful HTML route responses while
      preserving non-HTML route outcomes, and provides stable 403/404/500 error documents.
      `packages/server/src/shell.test.ts` covers hints, loader/query ordering, deferred
      chunk placement, template override, safe query JSON escaping, and error shells.
- [x] R3 `createApp()` aggregate + `createRequestHandler(app)` over web-standard `Request → Response`. Evidence
      2026-06-11: `packages/server/src/app.ts` adds a closed app aggregate for routes,
      endpoints, query/mutation registries, session provider, CSRF, error shells, document
      options, client modules, and route rendering, plus a web-standard handler covering
      trailing-slash 308s, `/c/` modules, `/_q/` queries, endpoint-before-route dispatch,
      route GET/HEAD rendering through the existing route page renderer, 405s, and stable
      404/500 documents. `packages/server/src/app.test.ts` covers the scaffold and confirms
      no `use` middleware surface. Mutation dispatch remains stored-only in this narrow R3
      scaffold and is tracked for the next request-handler slice.
- [x] R4 node:http adapter (incl. Early Hints); `tests/p10-perf.node.mjs` migrates onto it as the parity proof. Evidence
      2026-06-11: `packages/server/src/node.ts` adds `toNodeHandler()` plus request/response
      conversion helpers for Node `IncomingMessage`/`ServerResponse`, streams web response
      bodies, suppresses HEAD bodies, and emits 103 Early Hints from the `Link` header when
      Node supports `writeEarlyHints`. `packages/server/src/node.test.ts` covers loopback
      request bodies, final headers, Early Hints, and HEAD semantics. `tests/p10-perf.node.mjs`
      now serves the perf proof through `createApp()` -> `createRequestHandler()` ->
      `toNodeHandler()`, including the versioned `/c/?v=` module registry path.
- [ ] R5 Vite+ plugin: dev middleware over the same handler; build wiring (manifest → stylesheet hints, compiled client modules → versioned emit).
      Progress 2026-06-11: `packages/server/src/vite.ts` adds `jisoAppShellVitePlugin()`,
      a Vite-shaped dev middleware that delegates to the same `createRequestHandler()` /
      `toNodeHandler()` path used by R3/R4. `packages/server/src/vite.test.ts` proves a
      route served through the plugin over `node:http`. Partial evidence 2026-06-11:
      `createJisoAppShellBuild()` and `jisoAppShellViteManifestHints()` now compose explicit
      route-to-manifest entries into deterministic stylesheet/modulepreload hints and register
      compiled `/c/` module sources into the existing immutable versioned client-module registry
      with stable content hashes; `packages/server/src/vite.test.ts` proves the hints on a real
      `createRequestHandler()` response and module serving through the public server barrel,
      with `packages/server/src/index.ts` exporting the helper as public server API.
      Additional evidence 2026-06-11: `jisoAppShellViteManifestAssets()` now turns the Vite
      manifest into deterministic, de-duplicated dist asset metadata, `createJisoAppShellBuild()`
      is base-aware, and built `/c/` module metadata includes served path, dist file, source,
      version, and optional content type for later emit/copy wiring. `packages/server/src/vite.test.ts`
      covers manifest asset planning, unsafe dist paths, base-aware route hints/assets, and
      built client module metadata; `packages/server/src/index.ts` exports the helper and type.
      Verification: `pnpm exec vitest --run packages/server/src/vite.test.ts`; `pnpm exec vitest --run packages/server/src/vite.test.ts packages/server/src/app.test.ts packages/server/src/static-export.test.ts`; `pnpm run check`.
      Remaining R5 work: compiler/plugin build hooks must still supply the route-entry mapping,
      compiled module sources, consume the asset/module plan, and perform dist-file
      emission/copying; this helper intentionally does not infer those facts.
- [ ] R6 static export: synthetic-request replay to `.html` files with the L0/L1-only constraint and teaching errors for non-exportable routes.
      Progress 2026-06-11: `packages/server/src/static-export.ts` adds the production-shaped
      `exportStaticApp()` foundation, replaying eligible static GET routes through
      `createRequestHandler(app)` and returning deterministic `.html` artifacts with body,
      status, and sorted response headers. The same module emits FW229 diagnostics for guarded
      routes, apps with a session provider that cannot yet prove route independence, and param
      routes without static-path metadata; `packages/server/src/static-export.test.ts` covers
      handler/document parity, successful `.html` export, guard/session failures, and loud
      param-route skip/error behavior, including explicit `onNonExportable: 'skip'` diagnostics.
      Additional evidence 2026-06-11: `exportStaticApp(app, { outDir })` writes replayed `.html`
      artifacts to disk with nested parent-directory creation; `packages/server/src/static-export.test.ts`
      verifies the on-disk bytes match the returned handler-replayed artifacts, with
      `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/app.test.ts`,
      `pnpm run check`, and `pnpm run check:fw` passing. Remaining R6 work: CLI/task wiring,
      `/c/` module and asset copying, and SPEC/compiler surfacing for the static-path
      enumeration field and session-dependence metadata.
      Additional evidence 2026-06-11: `exportStaticApp(app, { outDir })` now harvests referenced
      versioned `/c/` module URLs from exported HTML attributes and `Link` headers, replays those
      module requests through the same `createRequestHandler(app)` path, and writes exact served
      module bytes under `outDir/c/...`; tests cover handler-byte parity, unsafe encoded module
      paths, and conflicting query versions for one output path. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/server/src/app.test.ts`
      and `pnpm run check`. Remaining R6 work: CLI/task wiring and general static asset copying.
      Additional evidence 2026-06-11: `packages/cli/src/index.ts` now exposes async
      `fw export <app-module> [--out <dir>] [--origin <url>] [--skip-non-exportable]`, loads a
      default or named `app`, calls `exportStaticApp()`, writes to `dist` by default, and emits
      stable `fw-export/v1` output with HTML/client-module summaries plus FW229 diagnostics.
      `packages/cli/src/index.test.ts` covers successful export bytes and non-exportable-route
      diagnostics. Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts packages/server/src/static-export.test.ts`
      and
      `pnpm exec vp check packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json pnpm-lock.yaml`.
      Remaining R6 work: Vite/task template wiring for real starter/docs apps and general static
      asset copying.
      Additional evidence 2026-06-11: `exportStaticApp(app, { outDir, assets })` now copies
      configured static assets with exact filesystem bytes, returns asset artifacts with sorted
      represented headers/content type metadata, rejects unsafe/empty asset output paths and
      duplicate or generated-output conflicts with FW229, and validates the whole output plan
      before writing to avoid partial exports. `packages/server/src/static-export.test.ts` covers
      byte parity, nested assets, URL sources, unsafe paths, generated HTML conflicts, duplicate
      assets, and no-partial-write behavior. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export.test.ts` and
      `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts`.
      Remaining R6 work: Vite/task template wiring for real starter/docs apps.
- [ ] R7 adoption: starter becomes a routed app served by `vp dev`; commerce runs end-to-end over HTTP; a jiso docs site ships from `vp run export` as the first outside consumer.
      Progress 2026-06-11: commerce is now TSX-authored ahead of the HTTP serve
      entry — `CartBadge`, `OrderHistory`, and `ProductGrid` are authored in
      `examples/commerce/src/components/*.tsx` (SPEC §5.2 1:1 mapping), compiled
      by `scripts/emit-components.mjs` through `@jiso/compiler` with the §5.2.3
      fixpoint/render-equivalence gates, and served from committed lowered IR in
      `src/generated/*.tsx` with compiler-derived stamps (§4.2/§4.8); zero
      string-template components remain. Evidence:
      `npx vitest --run examples/commerce` (25/25, including the "compiles
      TSX-authored components to committed IR through the fixpoint gate" test),
      `pnpm run check`, `pnpm run check:fw` (generated/touch-graph.ts
      byte-identical), `pnpm run test:conformance`. The R7 `serve` entry itself
      remains open.
      Progress 2026-06-12: the create-jiso starter now emits `src/app-shell.ts`
      with a real `route('/')`, shared `createApp()`/`createRequestHandler()`
      exports, a versioned `/c/starter.client.js?v=starter-r7` interaction
      module, a starter-local Vite+ dev middleware that delegates document
      requests to the app-shell handler while leaving source assets to Vite, and
      a `vp run export` task backed by `fw export ./src/app-shell.ts --out dist`.
      Evidence: `packages/create-jiso/templates/src/app-shell.test.ts` proves the
      generated route document, `/c/` module response, and `exportStaticApp()`
      replay/output path; same-session verification ran
      `pnpm exec vitest --run packages/create-jiso/src/index.test.ts` and
      `pnpm exec vp check packages/create-jiso/src/index.ts packages/create-jiso/src/index.test.ts packages/create-jiso/templates/README.md packages/create-jiso/templates/docs/deployment.md packages/create-jiso/templates/package.json packages/create-jiso/templates/src/app.tsx packages/create-jiso/templates/src/app-shell.ts packages/create-jiso/templates/src/app-shell.test.ts packages/create-jiso/templates/src/styles.css packages/create-jiso/templates/vite.config.ts`.
      The broader R7 commerce HTTP serve entry and docs-site export consumer remain
      open.
      Progress 2026-06-12: commerce now has a shell-backed HTTP serve entry for
      the low-conflict document/query/module slice. `examples/commerce/src/app-shell.ts`
      creates a `createApp()` aggregate for `/cart`, `/login`, `/admin`, guarded
      file/stream routes, `/_q/` query registry entries, the Stripe webhook endpoint,
      and a versioned `/c/commerce.client.js?v=commerce-r7` module; it attaches the
      example DB/auth request context before delegating to `createRequestHandler()`
      and exports `commerceNodeHandler` for the dev server. `examples/commerce/vite.config.ts`
      now installs a commerce-local dev middleware that loads that handler for
      document routes while leaving source/assets to Vite. Evidence:
      `examples/commerce/src/app-shell.test.ts` serves the cart document, `/_q/cart`,
      and `/c/commerce.client.js?v=commerce-r7` over `node:http`; same-session
      verification ran `pnpm exec vitest --run examples/commerce/src/app-shell.test.ts`,
      `pnpm exec vitest --run examples/commerce`, and
      `pnpm exec vp check examples/commerce/src/app.ts examples/commerce/src/app-shell.ts examples/commerce/src/app-shell.test.ts examples/commerce/vite.config.ts`.
      Remaining R7 commerce work: the shared app shell still does not dispatch
      `/_m/` mutations, so the enhanced/no-JS commerce mutation round-trip over the
      `createApp()` handler remains open; docs-site `vp run export` adoption also
      remains open.

## Background — the gap

Every behavior the shell needs already exists in `@jiso/server` as transport-free, response-shaped functions, each proven by tests that hand-wire dispatch: `route()` carries `page`/`guard`/`params`/`search`/`onUnauthenticated` and `renderRoutePageResponse` handles guard failures, `notFound()`, `respond.file()/stream()` outcomes, and 500 fallbacks (SPEC §6.4, §9.2); `renderMutationEndpointResponse` covers enhanced + no-JS PRG; `renderQueryRegistryEndpointResponse` covers `/_q/`; `createMemoryVersionedClientModuleRegistry` implements the immutable `/c/*?v=` contract (§6.6); `endpoint()` is already web-standard `Request → Response` (D5 A4 / D6 E1); `renderPageHints` and `meta()`/`metaFromQuery` cover head assets; `sessionProvider` runs before guards (§6.5).

Nothing composes them. There is no URL→route matching (the only path matching anywhere is `href` _construction_), no document assembly (every `render` callback is caller-supplied), no `(Request) => Response` handler, no dev serving, no export. The only HTTP server in the repository is hand-assembled inside `tests/p10-perf.node.mjs`; the commerce app is exercised exclusively through vitest; the starter emits a single static `index.html`. SPEC §6.5 names "the server request shell" as where `sessionProvider` is declared, but no SPEC section defines the shell itself. Net: jiso cannot serve a page, and D5 B5 (`mount()` for OAuth callbacks) and D6 E7 (reference-app webhook) have no server to mount onto.

Constitution check: the shell introduces no new wire vocabulary and no new authoring surface beyond `createApp()` — it routes requests to renderers that already exist, so #1/#4 hold by construction, and the dispatch table is a closed, printable artifact (#2: nothing is registered from a distance; the registries the shell consumes are the ones `fw explain` already prints).

### Decisions (recorded so we don't relitigate)

- **The shell lives in `@jiso/server`** as new modules (`shell`, `match`, `document`), not a ninth package. SPEC already calls it the server request shell, and every renderer it composes is here. Cost accepted: `@jiso/server` gains a dependency on `@jiso/runtime` for `jisoLoaderSource` — a string constant, not runtime coupling. A separate `@jiso/app` package was considered and rejected: a new public surface to version, for what is composition of existing ones.
- **Web-standard `Request → Response` is the handler currency.** `endpoint()` already standardized on it; adapters convert at the edge (node:http in v1; anything fetch-shaped — workers, Deno, Bun — works without new framework code). The existing response-shaped objects (`RoutePageResponse` etc.) remain the internal IR; the shell converts at its boundary.
- **Dispatch is a closed table, not a middleware chain.** Order: `/_m/<mutation-key>` → `/_q/<query-key>` → `/c/<module>?v=` → `endpoint()` exact/prefix mounts → route table → 404 shell. No user middleware in v1 — ad-hoc middleware is exactly the unverifiable side door D5/D6 closed; the sanctioned extension points remain `sessionProvider`, guards, and `endpoint()`. (Rejected: Express/Hono-style `use()` — it reintroduces global knowledge at local sites and makes the dispatch table unprintable.)
- **Route matching is static-first, ambiguity is a compile error.** Static segments beat `:param` segments at each depth; two routes that can match the same path are **FW228** (ambiguous route table) at compile time rather than a precedence footnote at runtime. Trailing slashes normalize before matching (single canonical form, 308 to it). Routes answer GET and HEAD only; other methods on a page path are 405 — mutations own POST via `/_m/`.
- **The shell owns document assembly, with an app-level override.** Default document: doctype, `<html lang>` from i18n config, head from `meta()` + `renderPageHints` output (stylesheets from the Vite manifest, modulepreloads from compiled handler facts, speculation rules from route `prefetch`), the inline loader `<script>`, `<fw-query>` hydration scripts guaranteed before their consumers (§8 ordering), then the page body. The same assembly feeds `renderDeferredStream` for `<fw-defer>` pages. Apps may override the document template; the override receives assembled parts, not a blank canvas, so the loader/hydration contract cannot be silently dropped.
- **Error shells are app config with safe defaults.** `createApp({ errorShells })` supplies the 404 page, 403 shell, and 500 shell; defaults remain the current plain-text bodies (§9.2's "stable error shell or the fallback body"). `onUnauthenticated` stays per SPEC §6.5 (app-level default, per-route override).
- **Dev serves client modules from source; prod serves the versioned registry.** In dev the Vite+ plugin serves `/c/` from compiled-on-demand source (the §6.6 immutability contract is a deploy concern and is explicitly waived in dev). The prod build emits compiled client modules with content-hashed `v=` into the versioned registry / `dist`, and the §6.6 retention rule (old versions stay published) is documented as a deploy obligation.
- **Exported sites are L0/L1 only — a stated constraint, not a limitation discovered later.** Static export replays synthetic GET `Request`s through the _same_ handler (no second render path — partials-cannot-drift doctrine applied to export) and writes `.html` + `/c/` modules + assets. There is no server in the deployment, so no `/_m/`, no `/_q/`, no sessions: a route with a guard, a session dependence, or a page that renders mutation forms fails export with a teaching error (**FW229**). Queries may run at export time (build-time data); refetch-on-focus is disabled in exported documents. Routes with params export only via an explicit static-path enumeration on the `route()` declaration (name decided in the SPEC PR); param routes without it are skipped loudly, never silently.

## R-track

- **R1 — Route matcher + dispatch table.** Pure functions: `matchRoute(routes, pathname)` with the precedence rules above, raw param extraction feeding the existing `parseRouteRequest` coercion; the reserved-namespace dispatch order as data, not code branches, so it is testable and printable. FW228 detection over the route table (compiler-side, riding the FW220 route-table machinery in `packages/compiler/src/validate/navigation.ts`).
- **R2 — Document assembly.** `renderDocument(app, route, pageValue)` composing meta/hints/loader/`fw-query` scripts per the decision above; the deferred-stream variant; error-shell rendering. Byte-stable output (deterministic part ordering) so wire fixtures can pin full documents.
- **R3 — `createApp()` + `createRequestHandler(app)`.** The aggregate: routes, mutations, queries, endpoints, `sessionProvider`, CSRF config, error shells, i18n, document override, client-module registry. The handler: `(Request) => Promise<Response>`, composing R1 dispatch → existing renderers → R2 assembly. `sessionProvider` resolves once per request before any guard, per §6.5.
- **R4 — node:http adapter.** `toNodeHandler(handler)` including 103 Early Hints from `renderPageHints` where the client/protocol supports it. `tests/p10-perf.node.mjs` migrates from its hand-rolled server onto the adapter — the perf gates (TTI ≡ FCP, prerendered nav, zero memory growth) rerun unchanged as the parity proof.
- **R5 — Vite+ plugin.** `jiso()` with `configureServer` middleware wrapping the same handler for `vp dev` (Tailwind/assets/reload ride the existing Vite+ baseline); build hooks wiring the Vite manifest into stylesheet hints and emitting compiled client modules into the versioned registry. Dev/prod serve different `/c/` sources but identical dispatch — covered by a test that runs one wire fixture through both.
- **R6 — Static export.** `vp run export` (CLI entry decided in the SPEC PR: likely `fw export` invoked by a Vite+ task): enumerate exportable routes, replay synthetic requests, write files, copy `/c/` modules and assets, fail with FW229 on the constraint violations above. Output passes the §8 degradation contract by construction (it _is_ the no-JS-server case).
- **R7 — Adoption.** The starter becomes a real routed app (`route('/')` + one L1 island) served by `vp dev`; commerce gains a `serve` entry running the full wire surface over HTTP; a jiso docs site (content from `docs/` + SPEC-derived pages) ships from `vp run export` as the first outside consumer — feeding the P10 outside-legibility ledger with real evidence.

## Spike S8 — wire parity over real HTTP

Prove before freezing R3's shape: a prototype handler serving the pinned `fixtures/wire` set over node:http — enhanced mutation round-trip (FW-Idem replay, FW-Targets, FW-Changes), no-JS PRG, 422 fragment, typed read over `/_q/`, `<fw-defer>` stream chunk boundaries under real chunked transfer, and a `/c/` module import on first interaction — each byte-compared to the fixtures. Decision-gate writeup covers: where CSRF/session resolution sits relative to dispatch, whether `RoutePageResponse`→`Response` conversion loses anything the fixtures pin (header ordering, charset), and what HTTP/1.1 buffering does to deferred-stream placement guarantees (feeds §13.3).

**S8 result (2026-06-11):** proceed with R3's `createRequestHandler(app): Request -> Response` shape. `conformance/app-shell-spike/src/index.test.ts` runs the pinned `fixtures/wire` transcripts over a real `node:http` loopback server and compares live status lines, fixture-declared headers, and decoded body bytes for enhanced mutation, no-JS PRG, 422 validation fragment, typed read, and deferred stream. The deferred case additionally asserts the raw HTTP/1.1 chunked transfer keeps the shell chunk before `--jiso-boundary` and the query/fragment payload after it. The same prototype dispatch path serves `/c/cart.client.js?v=s8`; the test fetches and imports the module to prove the first-interaction module-load path. `docs/app-shell-s8-spike.md` records the decision gate: session resolution belongs before route/query/mutation guards per SPEC §6.5; CSRF validation belongs before mutation parsing/replay/guards per SPEC §6.6; `Response` conversion preserves the fixture-pinned protocol fields, while raw Node-only headers remain adapter metadata.

## Out of scope

User middleware API (rejected above, not deferred) · response caching (named in SPEC §15 as prerender mitigation; punt with a note) · serverless adapters beyond fetch-shaped compatibility (free by construction; not tested in v1) · incremental/partial export and export-time `/_q/` payload snapshots (exported sites are L0/L1, full stop) · locale negotiation (i18n catalogs render server-side already; negotiation is app code in v1) · the v2 SSE transport (§9.3 — additive transport onto this same dispatch table later).

## Sequencing & dependencies

- S8 gates R3. R1 and R2 are independent and can run in parallel ahead of it.
- R4 and R5 both depend on R3; they are independent of each other. R6 depends on R5 (build wiring) and R2.
- R7 lands last; the docs-site slice can start on R6's first working export.
- D5 B5 (`mount()`) and D6 E7 (reference-app webhook) consume R3's endpoint mounting — this workstream unblocks both.
- FW228 rides the existing FW220 route-table validation; FW229 is export-time, CLI-surfaced.

## Exit criteria

1. S8 decision-gate writeup merged; SPEC PR for §9.5 + FW228/FW229 merged (normative text, not this plan).
2. `vp dev` in the starter serves a routed page; first interaction loads its handler module from `/c/`; the enhanced mutation round-trip over real HTTP matches the pinned wire fixtures byte-for-byte.
3. `tests/p10-perf.node.mjs` runs on the shell's node adapter with the perf gates unchanged.
4. An ambiguous route table fails `vp check` with FW228; renaming a route path still turns every `<Link>`/GET form/`redirect()` red (§6.4 propagation holds through the shell).
5. `fw explain page /cart` output is unchanged; the dispatch order is documented in §9.5 and observable from the Network panel alone (Constitution #4).
6. `vp run export` writes a static docs site that works with JS disabled; a route with a guard or session dependence fails export with FW229's teaching error; a param route without static-path enumeration is skipped with a loud notice, never silently.

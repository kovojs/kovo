# Comprehensive Docs Plan

## Purpose

This plan tracks the documentation work needed for the site docs to be sufficient
for developers building an advanced Dyad/Kovo app. `SPEC.md` remains normative for
behavior; this ledger identifies where the public site, generated API reference,
examples, and agent-facing docs are missing, stale, or inconsistent with that
behavior.

Audit basis: main-thread repo sweep plus four read-only sub-agent audits on
2026-06-23: public API coverage, app-authoring flows, examples/advanced patterns,
and docs-site structure. No production docs were changed during the audit.

## Completion Standard

Before this plan can be retired, the site must let a developer build and verify an
advanced app that includes routing/layouts, authenticated mutations, guarded
queries, Drizzle data access, optimistic updates, UI primitives, deployment,
testing, diagnostics, and graph/devtool workflows without falling back to hidden
repo notes or reading examples as the only source of truth.

Each checkbox below stays open until the implementing session records exact
evidence under it: changed site/source files, generated artifacts, and the focused
commands that prove the claim.

## P0 - Correctness And Trust

- [x] **Reconcile live-query/SSE documentation with `SPEC.md`.**
  - Evidence: `SPEC.md:880` and `SPEC.md:886` define `<kovo-live>`, SSE transport, `live: true`,
    shared fragment/query vocabulary, and guard rechecks. The deployment guide currently says v1
    has no SSE/live bus and pushes SSE to v2 at `site/content/guides/deployment.md:20` and
    `site/content/guides/deployment.md:164`.
  - Deliverable: add or update `/guides/live-queries/`, Deployment, Queries, and Security with the
    current live-query contract, infra choices, instance-key routing, degradation, and per-push guard
    behavior.
  - Done evidence: `site/content/guides/live-queries.md`, `site/content/guides/deployment.md`,
    `site/content/guides/queries.md`, and `site/content/guides/security.md` document SSE live
    queries, instance-key routing, degradation, and per-push guard rechecks; `pnpm --filter
@kovojs/site build`, `pnpm --filter @kovojs/site check:links`, and `rg "no SSE|live bus|v2.*live|live.*v2" site/content/guides site/content/docs site/content/tutorial`
    verified the site and stale live-query language.

- [x] **Fix fragment-target and island-state preservation docs.**
  - Evidence: `SPEC.md:810` and `SPEC.md:1310` say morph preserves DOM/UA state but not serialized
    island-local `kovo-state`; KV420 rejects stateful islands inside server-refreshable targets. The
    mutations guide currently says nested island state survives fragments at
    `site/content/guides/mutations.md:183`.
  - Deliverable: update Mutations and Islands with server-refreshable boundary rules and the KV420
    fix menu: lift state to a query, use `isomorphic: true`, disable server refresh, or move the
    island.
  - Done evidence: `site/content/guides/mutations.md`, `site/content/guides/islands.md`, and
    `site/content/guides/diagnostics.md` now state that morph preserves browser/UA state but not
    island-local `kovo-state`, with the KV420 fix menu; `pnpm --filter @kovojs/site check:links`
    verified cross-links.

- [x] **Update auth/form failure, CSRF, and idempotency docs to match the spec.**
  - Evidence: `SPEC.md:733` and `SPEC.md:876` distinguish unauthenticated mutation failures
    (`401 Kovo-Reauth` enhanced, no-JS `303`) from authenticated unauthorized `403` typed failures.
    `SPEC.md:737`, `SPEC.md:1075`, and `SPEC.md:1077` require anonymous-CSRF, KV418 for unsafe
    `csrf: false`, and fresh per-submit `Kovo-Idem`. The security guide currently sends mutation
    guard failures through the typed-error path at `site/content/guides/security.md:56`.
  - Deliverable: expand Mutations and Security with pre-auth CSRF, reauth redirects, typed 403
    failures, KV418, replay reservation, and concurrent submit behavior.
  - Done evidence: `site/content/guides/mutations.md`, `site/content/guides/security.md`, and
    `site/content/guides/endpoints-webhooks.md` document 401 `Kovo-Reauth`, no-JS 303, typed 403,
    anonymous CSRF, KV418, replay reservation, and per-submit `Kovo-Idem`; `rg "guard failures take the typed-error|warn/error|KV406 \\| warn" site/content/guides site/content/docs site/content/tutorial`
    found no stale requested statements.

- [x] **Refresh starter and project-structure docs to match the real `create-kovo` scaffold.**
  - Evidence: Quickstart and Installation describe a small one-page starter
    (`site/content/docs/quickstart.md:25`, `site/content/docs/installation.md:34`), while
    `packages/create-kovo/src/index.ts:36` scaffolds auth, DB, schema, queries, mutations,
    components, tests, theme, CI, and dialect variants. The template app wires Better Auth, guarded
    routes, DB, mutations, and queries in `packages/create-kovo/templates/src/app.tsx:84`.
  - Deliverable: update Quickstart, Installation, Project Structure, and add a "from starter to app"
    tutorial path that explains how to safely extend the scaffold.
  - Done evidence: `site/content/docs/quickstart.md`, `site/content/docs/installation.md`,
    `site/content/docs/project-structure.md`, and `site/content/guides/starter-to-app.md` describe
    the current auth/DB/query/mutation/component/test scaffold and dialect variants; `pnpm --filter
create-kovo run build:dist` and `pnpm --filter @kovojs/site run check:links` passed.

- [x] **Resolve `@kovojs/ui` public-status drift in stability docs.**
  - Evidence: `STABILITY.md:21` says `@kovojs/ui` has dual distribution as a public library and
    copy-in starter. `public-packages.json:2058` marks it `visibility: public`, `kind: library`.
    The site stability table still places it in the "Internal / special" column at
    `site/content/docs/stability.md:32`.
  - Deliverable: make the site stability page match root policy and clarify direct import vs
    `kovo add` semantics.
  - Done evidence: `site/content/docs/stability.md` now lists `@kovojs/ui` in the public column
    with direct subpath imports and `kovo add` copy-in semantics; `pnpm --filter @kovojs/site run
check:links` passed.

- [x] **Promote or explicitly route important root `docs/` material into the public site corpus.**
  - Evidence: `site/src/content.ts:129` loads only `site/content/*`, `site/gen/api`, and
    `site/gen/reference`; root docs such as `docs/data-layer-dialects.md`,
    `docs/static-export.md`, `docs/integration-testing.md`, and
    `docs/worked-example-add-to-cart.md` are outside the human site. `SPEC.md:1390` cites root
    docs as related material.
  - Deliverable: add a curated "Evidence / Design Notes" site collection or explicitly link and
    classify root docs as non-site reference material.
  - Done evidence: `site/content/evidence/*.md` adds the public collection; `site/src/content.ts`
    registers the section; `pnpm --filter @kovojs/site run build` emitted `/evidence/*` pages and
    mirrors; `pnpm --filter @kovojs/site run check:links` passed.

## P1 - Advanced App Authoring Guides

- [x] **Add generated/public API coverage for `@kovojs/headless-ui`.**
  - Evidence: `public-packages.json:1942` marks `@kovojs/headless-ui` public with 34 primitive
    subpaths, but `site/gen/api/` has no `headless-ui.md`. Sub-agent inventory found about 880
    exports, zero documented by generated API, and 730 example imports.
  - Deliverable: generate an API reference grouped by primitive plus a package overview explaining
    SPEC section 4.6 attribute-builder composition, merge rules, `data-*` state vocabulary,
    controlled-only behavior, and direct-use vs styled-wrapper use.
  - Done evidence: `public-packages.json` and `site/scripts/api-ref.mjs` generate
    `site/gen/api/headless-ui.md` plus sidebar JSON for 34 primitive subpaths / 880 exports;
    `site/content/guides/components.md` explains direct headless use and styled-wrapper use;
    `pnpm --filter @kovojs/site exec vitest --run scripts/api-ref.test.mjs` and `pnpm run
check:api-surface` passed.

- [x] **Add generated/public API coverage for `@kovojs/ui`.**
  - Evidence: `public-packages.json:2058` marks `@kovojs/ui` public with many component subpaths, but
    `site/gen/api/` has no `ui.md`. Sub-agent inventory found about 460 exports and only two
    documented symbols.
  - Deliverable: document each component subpath's component factory, props, state/render-input
    props, variants, sizes, and `style`/`styles` override contract; link to copy-in docs.
  - Done evidence: `public-packages.json` and `site/scripts/api-ref.mjs` generate
    `site/gen/api/ui.md` plus sidebar JSON for 45 component subpaths / 460 exports;
    `site/content/guides/components.md` and component detail pages link import-vs-copy usage,
    source, and behavior contracts; `pnpm --filter @kovojs/site exec vitest --run
scripts/api-ref.test.mjs` and `pnpm run check:api-surface` passed with the existing public-export
    attention baseline unchanged.

- [x] **Turn example apps into copyable walkthroughs, not only live demos plus source tabs.**
  - Evidence: `/examples/` pages are manifest-built live app/source splits
    (`site/src/examples.ts:62`, `site/src/examples.ts:90`). Commerce source tabs omit core files such
    as `app.tsx`, `domain.ts`, `schema.ts`, `db.ts`, and auth forms even though
    `examples/commerce/README.md:11` lists those as central to the example.
  - Deliverable: add walkthrough pages for Commerce, CRM, and StackOverflow covering app wiring,
    DB/schema, route layout, query-backed regions, mutations, optimistic coverage, verification, and
    deploy/run commands.
  - Done evidence: `site/content/guides/example-commerce.md`,
    `site/content/guides/example-crm.md`, and `site/content/guides/example-stackoverflow.md` add
    copyable walkthroughs with source file inventories, app/query/mutation/optimism sections, and
    run/verify commands; `pnpm --filter @kovojs/site run build` emitted the routes and
    `pnpm --filter @kovojs/site run check:links` passed.

- [x] **Update optimistic docs for current derived/mixed/await-fragment practice.**
  - Evidence: StackOverflow documents fully compiler-derived optimism in
    `examples/stackoverflow/README.md:4`; CRM demonstrates mixed manual and await-fragment behavior
    in `examples/crm/src/mutations.ts:134` and `examples/crm/src/mutations.ts:197`. The site guide
    still frames derivation as future v2 work at `site/content/guides/optimistic.md:145`.
  - Deliverable: revise `/guides/optimistic/` or add a derived-optimism guide showing the current
    spectrum: derived transforms, hand-written transforms, `await-fragment`, punts, and graph/test
    verification.
  - Done evidence: `site/content/guides/optimistic.md`, `site/content/tutorial/05-optimistic.md`,
    and `site/content/guides/example-commerce.md` now describe derived, hand-written, and
    `await-fragment` statuses as current practice; `rg "v2|derived later|Future-derived|future v2|v2.*deriv|deriv.*v2" site/content/guides/optimistic.md site/content/tutorial/05-optimistic.md site/content/docs/why-kovo.md site/content/guides/example-commerce.md`
    found no stale claims.

- [x] **Add a Better Auth integration walkthrough.**
  - Evidence: the scaffold has real Better Auth over the same Drizzle DB, session adaptation,
    sign-in/out mutations, anonymous CSRF binding, and seeded demo user in
    `packages/create-kovo/templates/src/auth.ts:23`, `:54`, and `:90`. The reference auth/security
    example is only llms-facing (`site/scripts/examples.mjs:88`).
  - Deliverable: add `/guides/auth-better-auth/` and/or a human reference-auth example page with
    copyable schema, `sessionProvider`, login/logout forms, CSRF setup, guards, and audit commands.
  - Done evidence: `site/content/guides/auth-better-auth.md` documents scaffold files,
    `sessionProvider`, Better Auth sign-in/out mutations, anonymous/session CSRF, guards, and audit
    commands; `pnpm --filter @kovojs/site run check:links` passed.

- [x] **Add a layouts guide.**
  - Evidence: `SPEC.md:247` and `SPEC.md:263` define first-class `layout()` declarations with nesting,
    `parent`, `queries`, `guard`, `boundaries`, and `kovo explain page --layouts`. The routing guide
    currently shows only inline `layout:` examples (`site/content/guides/routing.md:25`,
    `site/content/guides/routing.md:32`).
  - Deliverable: document nested layouts, layout queries/guards/stylesheets, boundaries, no persistent
    layout state, and explain output.
  - Done evidence: `site/content/guides/layouts.md` documents nested layouts, layout queries/guards,
    stylesheets, boundaries, no persistent layout state, and `kovo explain page --layouts`, and
    `site/content/guides/routing.md` links it; site build/link checks passed.

- [x] **Document request shell, adapters, error shells, and load-shed configuration.**
  - Evidence: `SPEC.md:912` through `SPEC.md:920` describe `createApp()` ownership of routes,
    mutations, queries, endpoints, document options, errors, CSRF, db/session providers, dispatch
    order, no middleware chain, and pre-dispatch 413/429 limits. Deployment only shows a minimal
    server entrypoint.
  - Deliverable: add `/guides/request-shell/` covering app options, dispatch order, document
    templates, error shells, adapters, max body size, coarse limits, and no-middleware implications.
  - Done evidence: `site/content/guides/request-shell.md` documents `createApp()`, dispatch order,
    document templates, error shells, adapters, pre-dispatch 413/429 limits, no middleware chain, and
    links `/api/server/`; site build generated `/api/server/index.html` and link check passed.

- [x] **Document raw machine ingress: `endpoint()`, `webhook()`, typed headers, cookies, and audits.**
  - Evidence: `SPEC.md:856`, `SPEC.md:860`, `SPEC.md:862`, and `SPEC.md:1341` define endpoints,
    webhooks, verifier kits, typed response headers/cookies, CSRF exemptions, and `--endpoints`
    audit rows. Site docs mostly mention these as audits/escape hatches.
  - Deliverable: add `/guides/endpoints-webhooks/` for OAuth callbacks, webhooks, downloads,
    non-browser writes, `csrf: false`, typed cookies/headers, and security review.
  - Done evidence: `site/content/guides/endpoints-webhooks.md` documents `endpoint()`, `webhook()`,
    verifier kits, typed headers/cookies, KV415, KV418, CSRF exemptions, and a `--endpoints` audit
    example, with `/api/server/` cross-link verified by the site link check.

- [x] **Tighten deployment, deploy-skew, and static-export docs.**
  - Evidence: `SPEC.md:1431` and `SPEC.md:1435` require token-mismatch recovery and at least 24 hours
    of prior immutable `/c/__v/*` modules plus prior-token `/_q/` reads. Deployment currently says
    retain modules for "as long as you believe a tab can stay open" at
    `site/content/guides/deployment.md:53`. Static export has richer root notes in
    `docs/static-export.md`, not the public site.
  - Deliverable: document the 24-hour floor, prior-token query reads, KV417, token mismatch recovery,
    static export decision tree, and platform-specific retention checks.
  - Done evidence: `site/content/guides/deployment.md` and `site/content/guides/static-export.md`
    document the 24-hour floor, prior-token `/_q/` reads, KV417, token mismatch recovery, and static
    export decision tree; `rg "as long as you believe|Retain versions for as long" site/content`
    found no weaker retention language.

- [x] **Document typed query endpoint caching, versioning, and skew behavior.**
  - Evidence: `SPEC.md:906` and `SPEC.md:908` require render-plan version tokens on `/_q/` responses
    and private/no-store cache posture with `Vary: Cookie` for guarded or session-dependent reads.
    The Queries guide shows the GET shape but omits those cache/version rules.
  - Deliverable: add a Queries section on typed read endpoint headers, private caching, guard reruns,
    render-plan tokens, and recovery.
  - Done evidence: `site/content/guides/queries.md` documents `/_q/` render-plan tokens,
    `Cache-Control: private, no-store`, `Vary: Cookie`, guard reruns, and skew recovery, with
    deployment/live-query cross-links verified by the link check.

- [x] **Promote dataflow devtool and MCP docs to the site.**
  - Evidence: `packages/devtool/README.md:12` explains mounting and MCP, while the site only has a
    generic `kovo mcp` paragraph in `site/content/guides/cli.md:190`. `examples/devtool/README.md:3`
    says it wires emitted graphs from Commerce/CRM/StackOverflow into a reusable devtool.
  - Deliverable: add `/guides/dataflow-devtool/` covering graph generation, mounting at `/__kovo`,
    multi-app bundles, MCP `kovo_explain`, and same-artifact conformance.
  - Done evidence: `site/content/guides/dataflow-devtool.md` documents graph generation, `/__kovo`
    mounting, direct bundles, MCP `kovo_explain`, and conformance; `pnpm --filter @kovojs/site run
check:links` passed.

- [x] **Teach component usage recipes on component detail pages.**
  - Evidence: component pages render `demoHtml` but not copyable usage docs
    (`site/src/components/gallery.tsx:141`). Interactive source exists for dialog, combobox, select,
    command, toast, tabs, and form controls under `examples/gallery/src/interactive/`.
  - Deliverable: add "Usage", "Source", and "Behavior contract" sections to component pages, starting
    with advanced primitives and form controls.
  - Done evidence: `site/src/gallery.ts`, `site/src/components/gallery.tsx`, and
    `site/src/gallery-llms.ts` add usage/source/behavior sections to component detail pages;
    `pnpm --filter @kovojs/site test`, `pnpm --filter @kovojs/site run build`, and exact search
    probe for `/components/accordion/` passed.

- [x] **Add advanced app-pattern guides for CRM/dashboard and forum/Q&A shapes.**
  - Evidence: CRM demonstrates layouts, parameterized routes, aggregate queries, and dashboard regions;
    StackOverflow demonstrates nested routes, live-target renderers, session-isolated data, and region
    refreshes. Existing guides cover isolated mechanics but not end-to-end advanced app architecture.
  - Deliverable: add `/guides/app-patterns/dashboard-crm/` and `/guides/app-patterns/forum-qa/` with
    route layout, query composition, aggregate reads, mutation forms, optimism, and graph assertions.
  - Done evidence: `site/content/guides/app-pattern-dashboard-crm.md` and
    `site/content/guides/app-pattern-forum-qa.md` document route layout, query composition, mutation
    forms, optimism, and graph assertions; CRM/StackOverflow walkthroughs link them; `pnpm --filter
@kovojs/site run build` emitted both pages and `pnpm --filter @kovojs/site run check:links`
    passed.

## P2 - Site Architecture And Discoverability

- [x] **Fix llms canonical URLs for agent-only examples or make those pages real.**
  - Evidence: `LLMS_ONLY_EXAMPLES` excludes devtool/reference from human `/examples/` routes at
    `site/scripts/examples.mjs:88`, but `buildExamplesLlmsSection` still assigns `/examples/<name>/`
    URLs at `site/scripts/examples.mjs:160`. The human route builder only loops over `EXAMPLES` in
    `site/src/examples.ts:47`.
  - Deliverable: add real `/examples/devtool/` and `/examples/reference/` pages, or point llms
    canonical URLs at real mirrors/repo URLs; extend link checks to validate `llms-full.txt` URL lines.
  - Done evidence: `site/scripts/examples.mjs` points devtool/reference canonical URLs at
    `/examples/devtool.md` and `/examples/reference.md`; `site/scripts/check-links.mjs` validates
    `llms-full.txt` URL lines; `pnpm --filter @kovojs/site run check:links` passed.

- [x] **Include Components and Examples detail pages in site search.**
  - Evidence: `site/src/content.ts` populates `content.search` only from fixed markdown/generated
    sections plus spec, while components/examples are appended later by `site/src/app-data.ts:66` and
    `site/src/app-data.ts:77`; `site/src/aux.ts:39` writes only `content.search`.
  - Deliverable: add search entries for `/components/<name>/`, `/examples/<name>/`, and new
    reference/devtool pages, with smoke queries for `accordion`, `commerce`, and auth reference terms.
  - Done evidence: `site/src/aux.ts` adds synthetic Components/Examples pages to
    `search-index.json`; after `pnpm --filter @kovojs/site run build`, a focused node probe found
    `Accordion`, `Commerce`, `Dataflow Devtools`, and `Data-layer dialects` in the generated search
    index.

- [x] **Surface SQLite dialect support in the site data-layer docs.**
  - Evidence: `plans/sqlite-support.md:131` marks docs done via `docs/data-layer-dialects.md`, but the
    public site data-layer guide still says "Drizzle over Postgres (or PGlite)" at
    `site/content/guides/data-layer.md:219` and does not expose SQLite type mapping or
    `create-kovo --dialect sqlite`.
  - Deliverable: integrate supported dialects, blessed drivers, SQLite type mapping, and scaffold
    dialect selection into the public site.
  - Done evidence: `site/content/guides/data-layer.md` now exposes `create-kovo --dialect sqlite`,
    blessed drivers, SQLite type mapping, and Better Auth SQLite adapter posture, mirrored from
    `docs/data-layer-dialects.md`; site link check passed.

- [x] **Clarify the `@kovojs/browser/client` advanced boundary.**
  - Evidence: `@kovojs/browser/client` is public and generated in `site/gen/api/browser.md`, but the
    page includes intended manual-bootstrap APIs beside low-level support types (`Morph*`,
    `CompiledQuery*`, `QueryBinding*`). App authors need a boundary explanation.
  - Deliverable: add a focused manual browser bootstrap/reference section naming intended APIs such as
    `createBrowserKovoRoot`, `installKovoLoader`, `defaultEnhancedFetch`, and `createQueryStore`, and
    classifying lower-level types.
  - Done evidence: `site/content/guides/package-imports.md` and `site/content/guides/streaming.md`
    describe the manual bootstrap boundary for `createBrowserKovoRoot`, `installKovoLoader`,
    `defaultEnhancedFetch`, and `createQueryStore`; `pnpm --filter @kovojs/site run check:links`
    passed.

- [x] **Add an icon catalog or documented exclusion for `@kovojs/icons`.**
  - Evidence: `public-packages.json:33` marks `@kovojs/icons` public with 1,738 public icon subpaths,
    but there is no `site/gen/api/icons.md` or searchable icon catalog.
  - Deliverable: generate an icon catalog/API index with names, import paths, component shape, and
    search support, or record why icons are intentionally excluded from API reference generation.
  - Done evidence: `public-packages.json` documents the bounded `@kovojs/icons` API reference
    exclusion: the generated `/api/icons/` page covers the shared `IconProps` root while individual
    glyphs remain tree-shakeable subpaths; `pnpm --filter @kovojs/site run build` emitted
    `/api/icons/` and link checks passed.

- [x] **Document `create-kovo` CLI behavior and dialect flags.**
  - Evidence: `public-packages.json:2047` marks `create-kovo` public, and
    `packages/create-kovo/src/index.ts:155` exposes `create-kovo <target-directory> [--name]
[--dialect postgres|sqlite]`, but generated API refs omit this public CLI.
  - Deliverable: add CLI/reference docs for scaffold options, template contents, generated `.env`,
    Postgres default, SQLite opt-in, and non-empty directory behavior.
  - Done evidence: `site/scripts/create-kovo-ref.mjs`, `packages/create-kovo/src/index.ts`,
    `site/content/guides/cli.md`, and `site/content/guides/package-imports.md` document usage,
    dialect flags, generated files, `.env`, and non-empty directory behavior; `pnpm --filter
create-kovo run build:dist` and `pnpm --filter @kovojs/site exec vitest --run
scripts/create-kovo-ref.test.mjs` passed.

- [x] **Refresh diagnostics guide from generated diagnostics or add advanced-flow coverage.**
  - Evidence: the hand-authored diagnostics guide stops the touch-graph section at KV411
    (`site/content/guides/diagnostics.md:93`), while `SPEC.md:1313` and
    `site/gen/reference/diagnostics.md:57` include newer KV414-KV420 entries.
  - Deliverable: replace duplicate hand tables with generated diagnostics where possible, or add an
    "Advanced app flow diagnostics" section linked from Security, Routing, Mutations, and Deployment.
  - Done evidence: `site/content/guides/diagnostics.md` adds KV414-KV420 advanced-flow coverage and
    corrects KV405/KV406 severity; `site/content/guides/testing.md` summary table matches; `pnpm
--filter @kovojs/site build` emitted `diagnostics-ref/v1 codes=57` and link check passed.

- [x] **Wire or retire the site route artifact stale check.**
  - Evidence: `site/scripts/emit-routes.mjs:46` supports `--check`, but `site/package.json:15` exposes
    only `emit-routes`, and Pages CI does not run `emit-routes --check`.
  - Deliverable: add a check script/CI gate if route artifacts are intended to be committed, or remove
    the dead stale-check path.
  - Done evidence: `site/src/generated/` is gitignored, so the dead `--check` branch was removed from
    `site/scripts/emit-routes.mjs`; `pnpm --filter @kovojs/site run emit-routes` passed and generated
    `site-routes/v1 pages=104`.

## Latest Verification

- 2026-06-23 integrated comprehensive-docs implementation:
  - `pnpm exec vp check --fix ...` on changed docs, scripts, and plan files.
  - `pnpm --filter create-kovo run build:dist`.
  - `pnpm --filter @kovojs/site exec vitest --run scripts/api-ref.test.mjs scripts/create-kovo-ref.test.mjs src/gallery-llms.test.ts`.
  - `pnpm --filter @kovojs/site run content` (`api-ref/v1 packages=11 exports=1815 documented=580`;
    `diagnostics-ref/v1 codes=57`).
  - `pnpm run check:api-surface` (`public-exports-needing-attention=1338`, unchanged baseline).
  - `pnpm --filter @kovojs/site test` (15 files / 69 tests).
  - `pnpm --filter @kovojs/site run emit-routes` (`site-routes/v1 pages=122`).
  - `pnpm --filter @kovojs/site run build` (`site-export/v1 html=122 client-modules=85
diagnostics=0`; Vite logged a port-24678 websocket warning but exited 0).
  - `pnpm --filter @kovojs/site run check:links` (`pages=123 internal=26904 external=2402 OK`).
  - Exact probes found `/components/accordion/`, `/examples/commerce/`,
    `/guides/dataflow-devtool/`, `/evidence/data-layer-dialects/`,
    `/guides/app-pattern-dashboard-crm/`, `/guides/app-pattern-forum-qa/`,
    `/guides/auth-better-auth/`, `/api/create-kovo/`, `/api/headless-ui/`, `/api/ui/`, and
    `/api/icons/` in the generated search/page outputs.
  - `git diff --check`.

# Revamp the docs site — usable API reference, working ⌘K, CLI-first CLI page, unified Reference nav

Status: **implemented on branch `agent/revamp-docs` (not merged to main) — 2026-06-17.** Created
2026-06-17. `SPEC.md` is the source of truth for framework behavior; this plan changes only the
**docs site** (`site/`), the **API-reference generator** (`site/scripts/api-ref.mjs`), and adds a
shared **`@kovojs/cli` command manifest** consumed by the CLI page generator. It does not change
framework behavior. Keep this file compact: checklist, open work, risks, proving commands.

Verified end-to-end in a real browser (Playwright over `serve-static` of the static export):
collapsible API rail with counts (Functions 58 / Types & interfaces 154 / Constants 3), scroll-spy
highlight, `Parameter | Type | Description` tables with linked types, ⌘K opens the dialog on a cold
page, `createApp` search deep-links to `/api/server/#createapp`, and the `/reference/` hub cards
(API / Diagnostics / Specification). Gates: site tests 48/48, `@example` 51 OK, CLI tests 97/97,
check-links OK (pages=93, internal=13459), api-surface baseline unchanged (2907, +0), `vp check`
adds 0 lint/type errors over the base commit.

Driven by hands-on review of `/api/server/`, `/api/cli/`, and the ⌘K dialog on the live dev server
(`node site/scripts/serve.mjs`). The six critique clusters below are user-reported structural
problems, each verified against the current implementation.

## Goal

Make the generated API reference, search, CLI page, and top-level navigation pleasant to actually
use, while keeping the build's hard invariants intact: docs are generated from real sources and
cannot silently drift (`api-ref.mjs` reads TypeScript; `content-pipeline.mjs` captures real
toolchain output), the site stays a real Kovo app (SPEC §9.5), and interactivity stays lazy
(SPEC §4.4/§7 L1) except where a global keyboard shortcut genuinely requires an always-present
listener.

## Current state (verified 2026-06-17)

- The **"symbol sidebar"** the user means is the right-hand **"On this page" TOC rail**
  (`renderToc` in `site/src/components/chrome.tsx:156`, styled `.toc` in `site/src/styles.css:391`).
  On `/api/server/` it renders **215 `<a>` entries** flat (3 `toc-depth-2` = the category headings
  `Functions`/`Types & interfaces`/`Constants`, 212 `toc-depth-3` = every symbol). No scrollspy, no
  collapsing, no per-category counts, no link to the defining source file. `position: sticky` only
  pins the block; the 215-item list itself does not scroll independently.
- The **left sidebar** (`DocsSidebar`, `chrome.tsx:105`) lists sections/pages and is fine; the
  symbol problem is the right rail.
- **Param tables** come from `renderParamsTable` (`api-ref.mjs:215`): columns are **`Parameter |
Description`** only — no type. JSDoc `@param` carries no type; the only type information is in the
  fenced `ts` signature block. Types are therefore never tabulated and never linkable.
- **⌘K does not work on load.** `bindShortcuts()` (`site/src/client/search.js:19`) registers the
  `keydown` listener, but it is only ever called from inside `open()` (`search.js:51`), and `open()`
  only runs on the header button's `on:click` (`chrome.tsx:58`). The search island is L1-lazy, so
  until the user clicks the button once, no keydown listener exists and ⌘K is dead.
- **Search results are page-level and shallow.** The index has **one entry per page** plus one for
  the spec (`content-pipeline`/`content.ts:249`); an API page contributes a single entry titled e.g.
  `@kovojs/server` linking to `/api/server/`. Searching `createApp` matches that page's blob and
  links to the page top, not to `#createapp`. `renderResults` (`search.js:42`) shows only
  `section` + `title` — no kind, no signature, no symbol deep-link.
- **`/api/cli/` documents functions, not the CLI.** It is generated from `packages/cli/src/api.ts`
  (`kovoCheck`, `kovoExplain` + types). It contains **zero** command usage — no `kovo check`,
  `kovo explain <kind>`, `kovo add`, `kovo audit`, `kovo export`, `kovo mcp`, no flags. The real
  command surface + usage strings live in `packages/cli/src/index.ts` (`main`/`mainAsync` dispatch,
  `usage: kovo …` strings at lines ~775/896/1616/1629/1687).
- **Top nav has three sibling entries** `API` `/api/`, `Reference` `/reference/`, `Spec` `/spec/`
  (`NAV` in `chrome.tsx:20`). The user wants them grouped under one **Reference** entry while the
  URLs stay `/api/`, `/reference/`, `/spec/`.

## Locked decisions

- **The API sidebar becomes a dedicated, data-driven component, not the generic markdown TOC.**
  Category grouping, counts, source links, and scrollspy need structured data the markdown rail
  can't carry. `api-ref.mjs` already has every symbol's kind, name, anchor, and declaration node —
  it will emit a per-package **sidebar manifest** (JSON) alongside the markdown, consumed by a new
  `ApiSidebar` component used in place of `renderToc` on `/api/**` pages.
- **Types come from the TypeScript checker, not JSDoc.** The param-table Type column and signature
  type-links are derived in `api-ref.mjs` from the real declaration (the program/checker already
  exist there), so they cannot drift. A type token links iff its name resolves to a documented
  export (same page → `#anchor`; other documented package → `/api/<slug>/#anchor`); primitives and
  unknown/external types render as plain text.
- **⌘K gets a tiny always-present inline opener; everything else stays lazy.** A ~10-line inline
  script in `document-template.ts` listens for ⌘K/Ctrl-K and `Escape`, and opens the existing
  `<dialog id="site-search">`. Typing then loads `search.js#query` via the loader's existing
  delegated `on:input` binding — so the index and search logic stay L1-lazy; only the keystroke that
  _opens_ the dialog is eager. Remove the now-dead `bindShortcuts()` lazy path.
- **Per-symbol search entries.** The search index gains one entry per API symbol
  (`{section, title, url: /api/<slug>/#<anchor>, kind, signature}`), built from the same api-ref
  manifest so it cannot drift from the pages. Result rendering shows kind + symbol + section and
  deep-links to the anchor.
- **The CLI page is command-first, generated from a shared `@kovojs/cli` command manifest, functions
  demoted.** (Decided 2026-06-17.) Add a command manifest (commands, flags, examples) inside
  `packages/cli` that both the bin dispatch (`index.ts`) and the docs generator import — strongest
  no-drift guarantee. `/api/cli/` is special-cased: a command reference (one section per
  `kovo <command>` with usage, flags, short example) on top, with the programmatic
  `kovoCheck`/`kovoExplain` function/type reference moved below under a "Programmatic API" heading.
- **Reference becomes a landing-page hub at `/reference/`, no URL changes elsewhere.** (Decided
  2026-06-17.) `NAV` collapses to one `Reference` entry pointing at `/reference/`, which renders a
  zero-JS card grid linking to the API reference (`/api/`), the diagnostics catalog, and the Spec
  (`/spec/`). **Wrinkle:** `/reference/` is _currently_ the diagnostics-catalog section index
  (`gen/reference/diagnostics.md`). The hub takes over `/reference/`; the diagnostics catalog moves
  to a stable child URL (e.g. `/reference/diagnostics/` — already its page URL) and the section
  index is replaced by the hub. Active-state highlights Reference for any path under `/api/`,
  `/reference/`, or `/spec/`.

## Checklist

### 1. API symbol sidebar (right rail)

- [x] `api-ref.mjs` emits a per-package sidebar manifest (`site/gen/api/<slug>.sidebar.json`) with,
      per symbol: `name`, `anchor`, `kind`, `documented`, and `sourceHref` (GitHub blob URL + line),
      grouped into categories, plus a package-level `sourceHref`. (`buildSidebar`/`sourceHrefOf` in
      `api-ref.mjs`; covered by api-ref.test.mjs "emits a per-package sidebar manifest …".)
- [x] `ApiSidebar` component (`chrome.tsx`) renders the manifest: one collapsible `<details open>`
      per category with a count (`Functions` + `<span class="api-nav-count">58</span>`), each symbol
      row linking to `#anchor` plus a source link to `sourceHref`. (Browser-verified categories
      `["Functions 58","Types & interfaces 154","Constants 3"]`.)
- [x] `/api/**` routes use `ApiSidebar` instead of `renderToc`; non-API pages keep `renderToc`.
      (`PageOptions.apiSidebar` in `docs-layout.tsx`; `pageRoute` passes `page.apiSidebar` in
      `app.ts`; `content.ts` loads `<slug>.sidebar.json` for the api section.)
- [x] **Scroll-spy** highlights the current symbol, expands its category, and scrolls it into view.
      Implemented as an always-on inline `<script>` in the `ApiSidebar` (not a lazy island — scroll
      tracking is page behavior, not a deferred interaction); single `IntersectionObserver` over
      `h2/h3/h4[id]`; no-JS still renders the full linked list. (Browser-verified: scrolling makes
      `.api-nav a.active` = `#creatememoryversionedclientmoduleregistry`.) _Deviation from plan:
      inline script, not `client/api-nav.js`._
- [x] CSS: `.api-nav` scrolls within a `max-height` sticky container; `.active` teal highlight;
      `<details>` rotate affordance; count styling. (`styles.css` `.api-nav*`.)

### 2. Param tables: type column + linkable types

- [x] `api-ref.mjs` reads each parameter/return type from the real TS signature (`signatureTypes`
      via the checker, not JSDoc); `renderParamsTable` emits `Parameter | Type | Description`.
      (api-ref.test.mjs "renders @param/@returns … with a Type column".)
- [x] Type tokens resolving to a documented export link: same-package `#anchor`, cross-package
      `/api/<slug>/#anchor`; primitives/type-params/unknown stay plain; generics HTML-escaped so the
      GFM table survives. (`renderTypeCell`; global `targets` map built in pass 1. Verified
      `<td><code><a href="#createappoptions">CreateAppOptions</a>&lt;SessionValue&gt;</code>` and
      cross-package `/api/core/#endpointmethod` from server.md; api-ref.test.mjs "… links documented
      types".)
- [~] Signature-fence type-linking: **deferred.** Linking inside ` ```ts ` fences isn't expressible
  in markdown without Shiki post-processing and risks the `@example` gate; the param-table links
  deliver the core value. Left open intentionally.

### 3. ⌘K search shortcut

- [x] Always-present inline `SEARCH_HOTKEY` opener in `document-template.ts` (⌘K/Ctrl-K →
      `preventDefault` + `showModal()` + focus; Esc closes natively). (Browser-verified: ⌘K opens
      the dialog on a cold page.)
- [x] Removed the dead `bindShortcuts()` lazy path from `search.js`; `open()` stays for the button.
- [x] The input keeps its `on:input`/`kovo-state` attrs, so the loader lazy-loads `search.js#query`
      on first keystroke after the inline script opens the dialog. (Browser-verified search works.)

### 4. Search results: per-symbol + better preview

- [x] One search entry per API symbol (`{kind, section, text, title, url: <page>#<anchor>}`) merged
      into `content.search` alongside page entries. (`content.ts`; static export shows 462 symbol
      entries of 498 total, `createApp` → `/api/server/#createapp`.)
- [x] `renderResults` shows a kind badge + symbol + section and deep-links the anchor; `score()`
      weights exact/prefix title matches and symbol entries. Styled `.result-kind`/`.result-body`.
      (Browser-verified first result `{href:"/api/server/#createapp", kind:"function",
    title:"createApp"}`.)
- [x] `search-index.json` parity: emitted by `aux.ts` at export (498 entries) **and** served live in
      dev via a new `vite.config.ts` middleware, so search works in `serve` too (was 404 before).

### 5. CLI page is command-first (shared `@kovojs/cli` manifest)

- [x] `packages/cli/src/commands-manifest.ts` (`@internal`) is the shared source for all six
      dispatched commands' usage/flags/examples; `index.ts` imports its usage constants from it, and
      `commands-manifest.test.ts` (drift guard) asserts the manifest covers every dispatched command
      and matches the emitted literals. (CLI tests 97/97; api-surface baseline unchanged.)
- [x] `site/scripts/cli-ref.mjs` (run after api-ref in `content-pipeline.mjs`) rewrites `cli.md`
      command-first — `## Commands` (`### kovo check/explain/add/audit/export/mcp`) on top, the
      api-ref-generated function/type reference demoted under `## Programmatic API`. It also rewrites
      `cli.sidebar.json` to lead with a `Commands` group so the rail matches the page. (Browser:
      `<summary>Commands <span class="api-nav-count">6</span>`.)
- [x] `@example` (51 OK, command examples in ` ```sh `) and check-links stay green; CLI package test
      added.

### 6. Unified "Reference" navigation (landing hub at `/reference/`)

- [x] `API` / `Reference` / `Spec` collapsed into one top-level **Reference** nav entry → `/reference/`
      (`NAV`/`NavItem.match` in `chrome.tsx`).
- [x] `/reference/` is now a zero-JS card-grid hub → API (`/api/`), Diagnostics
      (`/reference/diagnostics/`), Spec (`/spec/`) via `referenceHubRoute` in `app.ts`; the
      diagnostics catalog keeps its `/reference/diagnostics/` URL (200). (Browser hub cards:
      `["API Reference","Diagnostics","Specification"]`.)
- [x] Active-state highlights **Reference** for paths under `/api/`, `/reference/`, or `/spec/`
      (`SiteHeader` prefix match). (Verified `/api/server/` shows `Reference … class="active"`.)
- [x] Footer keeps its Spec/llms/GitHub links (still valid); no landing link assumed three separate
      top-level destinations.

## Architecture / how it slots in

- The site is a static generator that is itself a Kovo app. `content-pipeline.mjs` runs
  `generateApiReference()` + `generateDiagnosticsReference()` + `captureAll()` into `site/gen/`
  **before** the app loads; `content.ts` reads `gen/**` as plain data; `app.ts` declares one route
  per page; `aux.ts` emits `search-index.json` + llms/mirrors at export.
- This plan adds **structured outputs** from `api-ref.mjs` (sidebar + type + search manifests)
  consumed by new/edited components, plus one inline script (⌘K) and one new lazy island (scrollspy).
  No framework package changes; the CLI command source lives in `packages/cli` but is consumed by
  the site generator.
- Touch list: `site/scripts/api-ref.mjs`, `site/src/components/chrome.tsx` (+ maybe
  `components/api-sidebar.tsx`), `site/src/components/docs-layout.tsx`, `site/src/route-kit.ts`,
  `site/src/app.ts`, `site/src/content.ts`, `site/src/aux.ts`, `site/src/client/search.js`,
  `site/src/client/modules.ts` (+ new `client/api-nav.js`), `site/src/document-template.ts`,
  `site/src/styles.css`, and a CLI command source under `packages/cli/`.

## Risks / watch-outs

- **`@example` typecheck gate** (`api:examples` / `api-examples-check.mjs`) extracts ` ```ts ` blocks
  from the generated markdown — type-linking inside signatures must not corrupt those blocks. Prefer
  linking in the rendered HTML layer, not the raw `ts` fence, or exclude example fences.
- **Link-check gate** (`check:links`) will validate the new `#anchor` deep links and `/api/<slug>/#…`
  cross-links — anchors must match the slugify rule in `md.mjs` (`createApp` → `createapp`).
- **Determinism**: api-ref output must stay deterministic (no timestamps/abs paths) — source hrefs
  use repo-relative paths mapped to a fixed GitHub base, line numbers from the AST.
- **Type extraction breadth**: full type-printing can be huge for complex generics; cap/elide long
  types in the table (mirror the existing `MAX_SIGNATURE_LINES` discipline) and only link bare
  identifier tokens.
- **Inline ⌘K script + CSP**: keep it inline-script-shaped like `THEME_SCRIPT`; ensure it coexists
  with the loader's delegated events and doesn't double-bind.
- **Scrollspy with 200+ targets**: use a single `IntersectionObserver`, not per-node listeners; it
  must degrade to the plain linked list with no JS.

## Proving commands

- `node site/scripts/serve.mjs` then load `/api/server/`, `/api/cli/`, press ⌘K, search `createApp`
  → lands on `/api/server/#createapp`; scroll the server page → sidebar highlights + collapses with
  counts; param tables show a Type column with working type links.
- `cd site && node scripts/api-ref.mjs` — regenerate; check `gen/api/*.md` + new manifest(s).
- `cd site && pnpm run api:check` — api-ref + `@example` typecheck gate.
- `cd site && pnpm run content && pnpm run build && pnpm run check:links` — full content pipeline,
  static export, anchor/link validation (page count stays green).
- `cd site && pnpm test` — site unit tests (`api-ref.test.mjs`, `serve-static.test.mjs`, etc.).
- `cd site && node scripts/smoke.mjs` — Playwright smoke (search index fetched on demand, pages
  render); extend it to assert ⌘K opens the dialog and a symbol search deep-links.
  </content>

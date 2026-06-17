# Revamp the docs site — usable API reference, working ⌘K, CLI-first CLI page, unified Reference nav

Status: **open — created 2026-06-17.** `SPEC.md` is the source of truth for framework behavior;
this plan changes only the **docs site** (`site/`) and the **API-reference generator**
(`site/scripts/api-ref.mjs`). It does not change framework behavior. Keep this file compact:
checklist, open work, risks, proving commands.

Driven by hands-on review of `/api/server/`, `/api/cli/`, and the ⌘K dialog on the live dev server
(`node site/scripts/serve.mjs`). The five critique clusters below are user-reported structural
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
  *opens* the dialog is eager. Remove the now-dead `bindShortcuts()` lazy path.
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
  (`/spec/`). **Wrinkle:** `/reference/` is *currently* the diagnostics-catalog section index
  (`gen/reference/diagnostics.md`). The hub takes over `/reference/`; the diagnostics catalog moves
  to a stable child URL (e.g. `/reference/diagnostics/` — already its page URL) and the section
  index is replaced by the hub. Active-state highlights Reference for any path under `/api/`,
  `/reference/`, or `/spec/`.

## Checklist

### 1. API symbol sidebar (right rail)

- [ ] `api-ref.mjs` emits a per-package sidebar manifest (e.g. `site/gen/api/<slug>.sidebar.json`)
      with, per symbol: `name`, `anchor`, `kind`, category, and `sourceHref` (GitHub blob URL +
      line, from `decl.getSourceFile().fileName` + `getLineAndCharacterOfPosition`). Include a
      package-level source link too.
- [ ] New `ApiSidebar` component (in `chrome.tsx` or a new `components/api-sidebar.tsx`) renders the
      manifest: one **collapsible** `<details open>` (or button-toggled) group per category, each
      header showing the count — `Functions (57)` — and each symbol row linking to `#anchor` plus a
      small "source" link to `sourceHref`.
- [ ] `/api/**` routes use `ApiSidebar` in the right rail instead of `renderToc`; non-API pages keep
      `renderToc`. Wire through `docs-layout.tsx`/`route-kit.ts` (e.g. an optional `apiSidebar` field
      on `PageOptions`, or a per-section toc override in `app.ts`).
- [ ] **Scrollspy**: a small client island (new `src/client/api-nav.js`, registered in
      `client/modules.ts`) uses `IntersectionObserver` over the `h3[id]` symbol headings to add
      `.active` to the matching sidebar row and keep it scrolled into view. Lazy per SPEC §7 L1
      (loads on first scroll/interaction); no-JS still renders the full linked list.
- [ ] CSS: the sidebar list scrolls within a max-height sticky container; `.active` highlight;
      collapsed/expanded affordance; counts styling (`styles.css` `.toc`/new `.api-nav`).

### 2. Param tables: type column + linkable types

- [ ] `api-ref.mjs` extracts each parameter's type text from the TS declaration (checker), not
      JSDoc, and `renderParamsTable` emits a **`Parameter | Type | Description`** table (returns row
      shows the return type).
- [ ] Type tokens that resolve to a documented export render as links: same-package →
      `#<anchor>`; other documented package → `/api/<slug>/#<anchor>`. Primitives / external /
      unresolved types stay plain text. Build the name→target map once from the manifest set.
- [ ] Apply the same type-linking to identifiers inside the fenced signature block where feasible
      (best-effort; do not break the `@example` typecheck gate, which extracts ` ```ts ` blocks).

### 3. ⌘K search shortcut

- [ ] Add an always-present inline opener in `document-template.ts` (⌘K / Ctrl-K → `preventDefault`
      + `dialog.showModal()` + focus input; `Escape` closes). Keep it tiny and CSP-safe (matches the
      existing `THEME_SCRIPT` pattern).
- [ ] Remove the dead `bindShortcuts()` lazy path from `search.js`; `open()` stays for the button.
- [ ] Verify the loader's delegated `on:input` still lazy-loads `search.js#query` when the dialog is
      opened via the inline script (the input keeps its `on:input` + `kovo-state` attrs).

### 4. Search results: per-symbol + better preview

- [ ] Build per-symbol search entries from the api-ref manifest (`{section, title: name, url:
      /api/<slug>/#anchor, kind, signature}`) and merge them into `content.search`
      (`content.ts`/`aux.ts`); keep the page-level entries too.
- [ ] `renderResults` (`search.js`) shows kind badge + symbol name + section and links to the deep
      anchor; `score()` weights symbol-name matches. Style the richer result row (`styles.css`
      `.search-results`).
- [ ] Confirm `search-index.json` is emitted for the served site (it is written by `aux.ts` at
      static export; ensure dev/static parity for the new entries).

### 5. CLI page is command-first (shared `@kovojs/cli` manifest)

- [ ] Add a command manifest in `packages/cli` (commands `check`/`explain`/`add`/`audit`/`export`/
      `mcp`, each with usage, flags, and a short example) and refactor `index.ts` dispatch + the
      `usage:` strings to read from it, so the bin and docs share one source.
- [ ] The docs generator imports that manifest to emit `/api/cli/` command-first: a **Commands**
      section on top (per-command usage/flags/example), with the programmatic `kovoCheck`/
      `kovoExplain` function + type reference moved under a lower **Programmatic API** heading.
- [ ] Keep the `@example` typecheck and link-check gates green for the restructured page; add a CLI
      package test asserting the manifest covers every dispatched command.

### 6. Unified "Reference" navigation (landing hub at `/reference/`)

- [ ] Collapse `API` / `Reference` / `Spec` into one top-level **Reference** nav entry pointing at
      `/reference/` (`NAV` in `chrome.tsx`).
- [ ] Replace the `/reference/` section index with a zero-JS card-grid **hub** linking to API
      (`/api/`), the diagnostics catalog, and the Spec (`/spec/`). Move the diagnostics catalog to a
      stable child URL (`/reference/diagnostics/`) so the hub can own `/reference/`; update its
      sidebar/section wiring in `content.ts`/`app.ts` accordingly.
- [ ] Active-state highlights **Reference** when the path is under `/api/`, `/reference/`, or
      `/spec/`; adjust the section-derived active logic in `SiteHeader`.
- [ ] Update footer/landing links that assume three separate top-level destinations.

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

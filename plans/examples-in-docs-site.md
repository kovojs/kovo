# Examples in the docs site — side-by-side running app + source

Status: **done (commerce + crm + stackoverflow, generalized) — 2026-06-14.** Created 2026-06-14.
`SPEC.md` is the source of truth for framework behavior; this plan changed the **docs site build**
(`site/`) and example docs pages. Static-export shells were later retired from
`examples/{commerce,crm,stackoverflow}` as part of example readability; the current docs pages embed
dynamic demo services beside authored source. Keep this file compact: checklist, open work, risks,
proving commands.

Shipped: `/examples/{commerce,crm,stackoverflow}/` each render the app in a sandboxed `<iframe>`
from the configured service URL beside a zero-JS tabbed viewer of the authored source. One
manifest-driven helper (`EXAMPLES` in `site/scripts/examples.mjs`) renders all three.
Verified end-to-end in a real browser by the site smoke gate (Playwright drives each docs page,
asserts the app renders _inside_ the iframe, and navigates CRM list → deal detail in-iframe).

## Goal

**Docs-site pages that show examples running next to authored source, side by side: the running app
in a sandboxed `<iframe>` on one side, and app-authored TSX/TS source (Shiki-highlighted,
file-tabbed) on the other.**

Done when:

- [x] A new docs page (`/examples/commerce/`) renders, in a two-pane layout, (a) a sandboxed
      `<iframe>` running the commerce demo service and (b) the authored source for
      `product-grid.tsx`, `cart-badge.tsx`, `order-history.tsx` in a tabbed (zero-JS, CSS `:checked`)
      Shiki code panel. (`site/scripts/examples.mjs` `renderExampleSplit`; smoke: "commerce example
      shows authored source windows" + screenshot.)
- [x] The examples manifest now points Commerce/CRM/StackOverflow at service embeds; the static
      export hook remains in `site/src/examples.ts` only for future examples with
      `embed: 'static'`.
- [x] The page is reachable from site nav and sidebar Examples group, and the docs link-check +
      smoke gate stay green.
- [x] Source shown is **app-authored** TSX (`examples/commerce/src/components/*.tsx`), never lowered
      IR / generated stamps (`SPEC.md` §5.2 — hand-authored lowered IR is KV235; we display, not
      author). Read from disk at build time (`loadCommerceSources`) so it cannot drift from what compiles.

Out of scope (this iteration): gallery (already embedded inline via `build.mjs:133`), reference
(auth, public-only export), and the data-only libs crm/stackoverflow (no UI to run). Revisit a
generalized `{{example:...}}` embed for those once commerce proves the pattern.

## Locked Decisions

- **Embed mechanism: service URL in a sandboxed `<iframe>`.** Strong isolation keeps app CSS,
  client modules, and runtime state out of the docs page scope while allowing live mutations.
- **Scope: commerce, crm, and stackoverflow.** Each example page uses the same manifest path.
- **Source is read from disk at build time**, not duplicated. The three authored components total
  ~3 files; show them as Shiki code-windows with a tab strip (reuse the existing `.code-window`
  markup from `site/scripts/md.mjs`, not a new highlighter).

## Architecture / how it slots into the existing build

The docs site (`site/`) is a build-time static generator built with Kovo. `site/scripts/build.mjs`
already SSR-loads an example (gallery) and emits pages; the commerce embed follows the same shape but
loads a **prebuilt export** rather than SSR-rendering inline.

- **Producer:** `site/scripts/examples.mjs` declares service URLs/env overrides and source tabs for
  each example.
- **Bridge:** `site/src/examples.ts` resolves the service URL (`KOVO_EXAMPLE_*_URL` or default)
  and renders the docs page. Static export code is still available for future `embed: 'static'`
  examples, but the three interactive examples no longer author export scripts.
- **Page:** add a content entry + a small renderer that emits the two-pane layout: left iframe,
  right a tabbed `.code-window` panel with the three source files Shiki-highlighted.
- **Source read:** at build time, read `examples/commerce/src/components/{cart-badge,order-history,
product-grid}.tsx` and run them through the existing Shiki path in `md.mjs`.

## Checklist

### Phase 1 — Producer hand-off (commerce export → site dist)

- [x] Wired through `site/src/examples.ts` + `site/scripts/examples.mjs`: examples use service
      embeds today, while `exportExampleApps()` skips dynamic examples and keeps the static hook
      available for future static examples.
- [x] Export loads standalone from the base path — re-rooting (below) makes `/assets` and `/c`
      resolve; the smoke gate drives the served export inside the iframe with zero resolution/404
      errors and asserts `[data-commerce-shell]` + the cart badge render.

### Phase 2 — Two-pane page in the site build

- [x] Build-driven page at `/examples/commerce/` (+ an `/examples/` section index), emitted in
      `build.mjs` alongside the gallery pages, using the Examples group in `groups`.
- [x] Renderer `renderExampleSplit` (`site/scripts/examples.mjs`): left pane sandboxed `<iframe>`
      (`sandbox="allow-scripts allow-same-origin"`) at the export base; right pane a tabbed
      `.code-window` viewer. Tabs are **zero-JS** — radio inputs + `:checked` sibling rules (per-index
      rules emitted inline so they track file count); source highlighted via the shared `md.mjs`
      Shiki pipeline (`renderMarkdown`).
- [x] Side-by-side layout styled in `site/src/styles.css` (`.example-split` etc.); single-column
      stack below 64rem (iframe above, source below).

### Phase 3 — Nav, links, and gates

- [x] Added to top nav (`chrome.mjs` NAV `/examples/`) and the docs sidebar (Examples group); section
      intro added.
- [x] `check:links` passes. The embedded app subtree (`dist/examples/*/app/**`) is excluded from the
      docs link gate — it is a self-contained export with intentionally-unexported in-app routes
      (commerce's `/products` "More" link). Evidence: `check-links/v1 pages=85 ... OK`.
- [x] `vp run smoke` green (14/14) incl. three new commerce checks; `site` `vitest --run` 50/50.

### Phase 4 — generalize + add crm/stackoverflow

- [x] Manifest-driven helper: `EXAMPLES` in `site/scripts/examples.mjs` declares each example's dir,
      export bridge (`exportFn`), and source-file list; `buildExampleEmbed` + `loadExampleSources` +
      `renderExampleSplit` are one generic path. `build.mjs` loops over `EXAMPLES` to emit
      `/examples/<name>/` pages and the `/examples/` index. Commerce migrated onto it (no behaviour
      change — re-verified).
- [x] CRM + StackOverflow given real multi-page apps and then moved to service embeds alongside
      Commerce so the docs iframe can show live dynamic behavior.
- [x] In-iframe multi-page navigation works: `rerootHtml` now re-roots **every** root-absolute
      attribute value (`href="/deals/d1"`, `href="/"`, `/assets`, `/c`) under the app base — a
      `<base href>` can't (it only rewrites relative URLs). Smoke asserts CRM list → deal detail
      navigates inside the iframe.
- [x] Source tabs show **TSX + the data/optimism story** (queries.ts, mutations.ts, the derived/
      custom optimistic transform) per the chosen scope.

## Risks / resolutions

- **Asset path rewriting (was top risk) — RESOLVED.** A `<base href>` does _not_ fix root-relative
  URLs (only relative ones), so we re-root instead: `rerootHtml` rewrites `="/assets/` and `="/c/`
  (covering the modulepreload href _and_ the inline loader's `on:*` handler refs like
  `/c/commerce.client.js#fn`) to the `/examples/commerce/app/` base. Verified: the served export has
  zero unresolved modules/404s in the smoke browser run.
- **`sandbox` scope — RESOLVED.** `allow-scripts allow-same-origin` (same-origin needed so the
  inline loader can `import()` the same-origin client module). The commerce public export is a fully
  client-runnable static replay (no live server); the in-app `/products` pagination link is _not_
  exported and 404s if clicked — acceptable for a demo, and excluded from the link gate.
- **Build cost / ordering.** `buildCommerceEmbed` runs commerce `vp build` during the site build
  (~adds a few seconds). Acceptable; the `build-site`/`export` vite tasks now list
  `examples/commerce/**` as inputs so the cache invalidates on commerce changes. (Note: the `vp run`
  output cache hashes git-tracked inputs — a first run with the new files _untracked_ can serve a
  stale dist; once committed it invalidates correctly. Use `vp run --no-cache export` to force.)
- **Source/compile drift — RESOLVED.** `loadCommerceSources` reads the three files from disk at build
  time; a missing/renamed file throws (ENOENT) and fails the build loudly rather than silently
  dropping a tab.

## Open work

- [x] **Live interactivity in the docs iframe.** The three example pages now point at deployed demo
      services via `site/scripts/examples.mjs`, with `KOVO_EXAMPLE_*_URL` env overrides for local
      builds.
- [ ] **reference example** (auth) could opt into the now-generic helper if a public-only export is
      added; the data-only nature of crm/so is resolved, but reference still needs a static shell.

## Proving commands

- Site build: `cd site && pnpm build` then confirm `/examples/{commerce,crm,stackoverflow}/` pages exist.
- Links + smoke: `cd site && node scripts/check-links.mjs && vp run smoke`.
- No-shim iframe sanity: adapt `scratch/gallery-verify-noshim.mjs` to load the commerce export base path.

## Key files

- `examples/commerce/src/app-shell.tsx` — dynamic Commerce app shell.
- `examples/commerce/src/components/{cart-badge,order-history,product-grid}.tsx` — authored source to display.
- `site/scripts/examples.mjs` — **new**: `buildCommerceEmbed` (export + re-root), `loadCommerceSources`,
  `renderExampleSplit` (two-pane layout + zero-JS CSS tabs).
- `site/scripts/build.mjs` — page emission; calls the above after the gallery loop; Examples group/section.
- `site/scripts/md.mjs` — Shiki render + `.code-window` markup reused for the source pane (`renderMarkdown`).
- `site/scripts/chrome.mjs` — NAV `/examples/`, sidebar Examples group, section intro.
- `site/scripts/check-links.mjs` — `EMBEDDED_APP` exclusion for `dist/examples/*/app/**`.
- `site/scripts/smoke.mjs` — three commerce-embed browser assertions (renders inside the iframe).
- `site/src/styles.css` — `.example-*` side-by-side + tab styles.

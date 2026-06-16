# Examples in the docs site — side-by-side running app + source

Status: **done (commerce + crm + stackoverflow, generalized) — 2026-06-14.** Created 2026-06-14.
`SPEC.md` is the source of truth for framework behavior; this plan changes the **docs site build**
(`site/`) and adds static-export shells + UI to `examples/{commerce,crm,stackoverflow}`. It does not
change framework behavior. Keep this file compact: checklist, open work, risks, proving commands.

Shipped: `/examples/{commerce,crm,stackoverflow}/` each render the app live in a sandboxed `<iframe>`
(its own §9.5 static export, re-rooted under `/examples/<name>/app/`) beside a zero-JS tabbed viewer
of the authored source. CRM and StackOverflow were data-only libraries and now ship real multi-page
read-only UIs (CRM: pipeline / contacts / deal detail; SO: question list / question detail). One
manifest-driven helper (`EXAMPLES` in `site/scripts/examples.mjs`) builds and renders all three.
Verified end-to-end in a real browser by the site smoke gate (Playwright drives each docs page,
asserts the app renders _inside_ the iframe, and navigates CRM list → deal detail in-iframe).

## Goal

**A docs-site page that shows the `commerce` example running live next to its authored source,
side by side: the running app in a sandboxed `<iframe>` (a self-contained static export of the
commerce app) on one side, and the app-authored TSX source (Shiki-highlighted, file-tabbed) on the
other.**

Done when:

- [x] A new docs page (`/examples/commerce/`) renders, in a two-pane layout, (a) a sandboxed
      `<iframe>` running the commerce static export and (b) the authored source for
      `product-grid.tsx`, `cart-badge.tsx`, `order-history.tsx` in a tabbed (zero-JS, CSS `:checked`)
      Shiki code panel. (`site/scripts/examples.mjs` `renderExampleSplit`; smoke: "commerce example
      shows authored source windows" + screenshot.)
- [x] The commerce static export is produced as part of the `site` build (`build.mjs` →
      `buildCommerceEmbed`, calling `exportCommerceStaticApp`) into `dist/examples/commerce/app/`,
      gated on the export's diagnostics (throws if any). One `pnpm build` produces everything.
- [x] The page is reachable from site nav (`chrome.mjs` NAV + sidebar Examples group) and the docs
      link-check + smoke gate stay green (`vp run export` → `check:links` OK pages=85; `vp run smoke`
      14/14 ok incl. 3 commerce checks).
- [x] Source shown is **app-authored** TSX (`examples/commerce/src/components/*.tsx`), never lowered
      IR / generated stamps (`SPEC.md` §5.2 — hand-authored lowered IR is KV235; we display, not
      author). Read from disk at build time (`loadCommerceSources`) so it cannot drift from what compiles.

Out of scope (this iteration): gallery (already embedded inline via `build.mjs:133`), reference
(auth, public-only export), and the data-only libs crm/stackoverflow (no UI to run). Revisit a
generalized `{{example:...}}` embed for those once commerce proves the pattern.

## Locked Decisions

- **Embed mechanism: static export in a sandboxed `<iframe>`.** Strong isolation — the commerce app
  ships its own CSS, client modules, and `@kovojs/runtime`, which would otherwise collide with the
  docs page scope. This matches how commerce already exports (`examples/commerce/scripts/export-static.mjs`
  → `exportCommerceStaticApp`, producing HTML artifacts + client modules + assets into `dist/`).
- **Scope: commerce only** for v1. It is the flagship full-stack example with real UI components.
- **Source is read from disk at build time**, not duplicated. The three authored components total
  ~3 files; show them as Shiki code-windows with a tab strip (reuse the existing `.code-window`
  markup from `site/scripts/md.mjs`, not a new highlighter).

## Architecture / how it slots into the existing build

The docs site (`site/`) is a build-time static generator built with Kovo. `site/scripts/build.mjs`
already SSR-loads an example (gallery) and emits pages; the commerce embed follows the same shape but
loads a **prebuilt export** rather than SSR-rendering inline.

- **Producer:** `examples/commerce` already has `exportCommerceStaticApp` (`scripts/export-static.mjs`,
  `vp run export`). It runs `vp build`, replays the public app shell (`commerceStaticExportApp`,
  routes `/`, `/cart`, `/login`), and writes HTML + client modules + assets. We reuse it as-is.
- **Bridge:** in the site build, invoke the commerce export (or assume a prebuilt `examples/commerce/dist`)
  and copy its output into the site `dist/` under a stable base path, e.g. `dist/examples/commerce/app/`.
  All asset/client-module hrefs in the export are root-relative, so the iframe must load the app from
  that base (verify href rewriting / `<base>` handling — see Risks).
- **Page:** add a content entry + a small renderer in `build.mjs` (and template hook in `chrome.mjs`)
  that emits the two-pane layout: left `<iframe src="/examples/commerce/app/" sandbox="allow-scripts">`,
  right a tabbed `.code-window` panel with the three source files Shiki-highlighted.
- **Source read:** at build time, read `examples/commerce/src/components/{cart-badge,order-history,
product-grid}.tsx` and run them through the existing Shiki path in `md.mjs`.

## Checklist

### Phase 1 — Producer hand-off (commerce export → site dist)

- [x] Wired into `site/scripts/build.mjs`: `buildCommerceEmbed` imports `exportCommerceStaticApp`
      and exports straight into `dist/examples/commerce/app/` (its `outDir` option), drops the
      shipped `.vite/manifest.json`, and throws if the export reports any diagnostic. One `pnpm build`
      (and `vp run export`) produces everything.
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
- [x] CRM + StackOverflow given real multi-page read-only static-export apps (see the sibling commit
      "Add multi-page UI to crm and stackoverflow examples"): `component`-free `@kovojs/server` JSX
      views, a richer demo-data seed layered on the untouched `createXDb()` seed, an app-shell static
      export + node handler, `export-static.mjs`, `serve.mjs`, `vite.config.ts`, `styles.css`.
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

- [ ] **Live interactivity in the docs iframe.** All embeds are read-only static exports (no server
      on a static host), so mutations/optimism don't run in-iframe — the source tabs tell that story.
      Each example ships a dynamic node handler + `serve.mjs` (`pnpm --filter @kovojs/example-<name>
start`) for full local interactivity; wiring mutation/optimism client modules into those dynamic
      shells (add-contact, vote, post-answer) is future work.
- [ ] **reference example** (auth) could opt into the now-generic helper if a public-only export is
      added; the data-only nature of crm/so is resolved, but reference still needs a static shell.

## Proving commands

- Commerce export: `cd examples/commerce && pnpm static` (→ `commerce-export/v1 html=… client-modules=… assets=…`).
- Site build: `cd site && pnpm build` then confirm `dist/examples/commerce/app/index.html` and the
  new `/examples/commerce/` page exist.
- Links + smoke: `cd site && node scripts/check-links.mjs && vp run smoke`.
- No-shim iframe sanity: adapt `scratch/gallery-verify-noshim.mjs` to load the commerce export base path.

## Key files

- `examples/commerce/scripts/export-static.mjs` — `exportCommerceStaticApp` (producer; reuse as-is).
- `examples/commerce/src/app-shell.ts` — `commerceStaticExportApp`, public routes `/`, `/cart`, `/login`.
- `examples/commerce/src/components/{cart-badge,order-history,product-grid}.tsx` — authored source to display.
- `site/scripts/examples.mjs` — **new**: `buildCommerceEmbed` (export + re-root), `loadCommerceSources`,
  `renderExampleSplit` (two-pane layout + zero-JS CSS tabs).
- `site/scripts/build.mjs` — page emission; calls the above after the gallery loop; Examples group/section.
- `site/scripts/md.mjs` — Shiki render + `.code-window` markup reused for the source pane (`renderMarkdown`).
- `site/scripts/chrome.mjs` — NAV `/examples/`, sidebar Examples group, section intro.
- `site/scripts/check-links.mjs` — `EMBEDDED_APP` exclusion for `dist/examples/*/app/**`.
- `site/scripts/smoke.mjs` — three commerce-embed browser assertions (renders inside the iframe).
- `site/src/styles.css` — `.example-*` side-by-side + tab styles.

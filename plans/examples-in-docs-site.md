# Examples in the docs site — side-by-side running app + source

Status: **open — not started.** Created 2026-06-14. `SPEC.md` is the source of truth for framework
behavior; this plan changes the **docs site build** (`site/`) and adds a thin static-export hand-off
from `examples/commerce`. It does not change framework behavior. Keep this file compact: checklist,
open work, risks, proving commands.

## Goal

**A docs-site page that shows the `commerce` example running live next to its authored source,
side by side: the running app in a sandboxed `<iframe>` (a self-contained static export of the
commerce app) on one side, and the app-authored TSX source (Shiki-highlighted, file-tabbed) on the
other.**

Done when:

- [ ] A new docs page (e.g. `/examples/commerce/`) renders, in a two-pane layout, (a) a sandboxed
      `<iframe>` running the commerce static export and (b) the authored source for
      `cart-badge.tsx`, `order-history.tsx`, `product-grid.tsx` in a tabbed Shiki code panel.
- [ ] The commerce static export is produced as part of `site` build (or a prebuild step) and its
      artifacts are copied into the site `dist/` under a stable path the iframe loads from.
- [ ] The page is reachable from site nav and the docs link-check (`scripts/check-links.mjs`) and
      smoke build stay green.
- [ ] Source shown is **app-authored** TSX (`examples/commerce/src/components/*.tsx`), never lowered
      IR / generated stamps (`SPEC.md` §5.2 — hand-authored lowered IR is FW235; we display, not
      author). Source is read from the repo at build time so it cannot drift from what compiles.

Out of scope (this iteration): gallery (already embedded inline via `build.mjs:133`), reference
(auth, public-only export), and the data-only libs crm/stackoverflow (no UI to run). Revisit a
generalized `{{example:...}}` embed for those once commerce proves the pattern.

## Locked Decisions

- **Embed mechanism: static export in a sandboxed `<iframe>`.** Strong isolation — the commerce app
  ships its own CSS, client modules, and `@jiso/runtime`, which would otherwise collide with the
  docs page scope. This matches how commerce already exports (`examples/commerce/scripts/export-static.mjs`
  → `exportCommerceStaticApp`, producing HTML artifacts + client modules + assets into `dist/`).
- **Scope: commerce only** for v1. It is the flagship full-stack example with real UI components.
- **Source is read from disk at build time**, not duplicated. The three authored components total
  ~3 files; show them as Shiki code-windows with a tab strip (reuse the existing `.code-window`
  markup from `site/scripts/md.mjs`, not a new highlighter).

## Architecture / how it slots into the existing build

The docs site (`site/`) is a build-time static generator built with Jiso. `site/scripts/build.mjs`
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

- [ ] Decide the trigger: add a site `prebuild`/script step that runs commerce `vp run export` (or
      depends on a prebuilt `examples/commerce/dist`), then copies the export tree into
      `dist/examples/commerce/app/`. Prefer wiring into `site/scripts/build.mjs` so one `pnpm build`
      produces everything; gate on the export's diagnostics (it sets non-zero exit on warnings).
- [ ] Confirm the copied export loads standalone from the chosen base path — open
      `dist/examples/commerce/app/index.html` served at `/examples/commerce/app/` and verify zero
      `Failed to resolve module specifier` / 404 asset errors (mirror the gallery no-shim check in
      `scratch/gallery-verify-noshim.mjs`).

### Phase 2 — Two-pane page in the site build

- [ ] Add the content/route: a markdown or build-driven page at `/examples/commerce/` with title +
      blurb, plus a placeholder the renderer fills (follow the gallery `renderGalleryPage` pattern in
      `build.mjs`, and section wiring near the `gallerySection`/SECTIONS concat).
- [ ] Implement the renderer: left pane sandboxed `<iframe>` pointing at the export base path; right
      pane a tabbed `.code-window` (reuse `md.mjs` Shiki + `.code-window` markup; tabs can be a small
      L1 island like the existing copy/search islands under `site/public/c/`, or CSS `:target`/details
      for zero-JS).
- [ ] Add styling for the side-by-side layout (Tailwind via `site/src/styles.css`); responsive
      stack on narrow screens (iframe above, source below).

### Phase 3 — Nav, links, and gates

- [ ] Add the page to site nav / sidebar (`chrome.mjs`) and any section index.
- [ ] `node scripts/check-links.mjs` passes (the iframe `src` and any source-file deep links resolve).
- [ ] Smoke build passes (`vp run smoke` / the `export` task) and `site` `vitest --run` stays green;
      add a smoke assertion that `dist/examples/commerce/app/index.html` exists and the page contains
      the iframe + a code-window for each of the three components.

### Phase 4 (stretch) — generalize

- [ ] Extract a reusable `{{example:<name>}}` embed helper so reference/gallery/future apps can opt
      in, with a per-example manifest (export command, base path, source-file list). Leave open until
      commerce ships.

## Risks / open questions

- **Asset path rewriting.** The commerce export emits root-relative hrefs (`/c/…`, `/assets/…`).
  Served under `/examples/commerce/app/` they will 404 unless the iframe document uses a `<base href>`
  or the export is re-rooted. Resolve in Phase 1 — check whether `exportJisoAppShellViteBuild…`
  supports a base prefix, else inject `<base href="/examples/commerce/app/">` into the copied
  `index.html`. **This is the highest-risk item.**
- **`sandbox` attribute scope.** `allow-scripts` is needed for the app's client modules; the commerce
  public export hits an in-memory/pglite DB — confirm the static export is fully client-runnable
  without a live server (it should be: it's a static replay). If any route needs a server, the iframe
  shows static HTML only and we note that on the page.
- **Build cost / ordering.** Running `vp build` for commerce inside the site build adds time and a
  cross-package dependency. Consider treating `examples/commerce/dist` as a prerequisite produced by
  CI before the site build, with the site step only copying if present (and a clear error if absent).
- **Source/compile drift.** Reading source from disk avoids drift, but if a component is renamed the
  page silently drops it — assert the three expected files exist at build time and fail loudly.

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
- `site/scripts/build.mjs` — page emission; gallery embed precedent (`loadGalleryData`, `renderGalleryPage`, SECTIONS).
- `site/scripts/md.mjs` — Shiki render + `.code-window` markup to reuse for the source pane.
- `site/scripts/chrome.mjs` — page templates / nav / sidebar.
- `site/public/c/` — L1 island precedent if tabs need JS (`code.js`, `search.js`).
- `scratch/gallery-verify-noshim.mjs` — no-shim export load check to mirror.

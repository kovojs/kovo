# Make the example apps interactive (real mutations round-trip in the static export)

Status: **active.** Created 2026-06-15. Worktree `agent/examples-interactivity`.
`SPEC.md` is the source of truth for framework behavior; this plan changes the **example apps**
(`examples/{commerce,crm,stackoverflow}`) and their **docs-site embeds** (`site/`). It does not change
framework behavior — it exercises the existing portable request handler + fragment wire in the browser.

## Problem

The docs site embeds `examples/{commerce,crm,stackoverflow}` as static-export iframes, and all three
are inert: commerce ships `{ readOnly: true }` (no add-to-cart forms), CRM/SO never registered their
mutations into an app at all (mutations + derived-optimism exist in `mutations.ts` /
`generated/optimistic/` but no `component()`/form renders them, and the app-shell registers zero
mutations). So browsing the examples shows dead UIs.

## Approach (REVISED 2026-06-16 with user — serve as regular Node apps)

The static-export-in-iframe framing was wrong. **Serve each example as a regular full-stack Node
server** (its existing `scripts/serve.mjs` running the interactive `createApp` handler over PGlite),
where mutations round-trip natively. The apps only _looked_ inert because the docs embedded them as
static exports. So the work is: (1) register each app's mutations into the served app + author the UI
as the framework's native `enhance` server-action forms (POST `/_m/*`, inline loader morphs the
fragment wire — NO islands, NO KV229, since the page is served dynamically), (2) make the Node server
deploy-ready (production serve + Dockerfile / host config). DB stays PGlite-in-Node (works perfectly).

### Superseded earlier exploration (do NOT resurrect)

- **In-browser PGlite backend / on:click islands / KV229 dodges / Vite-bundling PGlite** — abandoned.
  The Phase 0 work proved the mechanism but the user wants regular serving, not static-export hacks.
- **PGlite on Cloudflare Workers** — spiked and rejected: PGlite's universal build takes a Node path
  under `workerd` (nodejs_compat), where `import.meta.url` is undefined and cascades through fragile
  Emscripten-glue failures. Not production-clean. Node host chosen instead.

Key facts proven in research:

- `handleAppRequest(app, request: Request): Promise<Response>` / `createRequestHandler(app)` are
  Web-Fetch-portable (packages/server: app-request.ts, app-dispatch.ts, mutation.ts). Node bits
  (`toNodeHandler`, vite-\*, static-export CLI) are excluded from the browser bundle.
- PGlite + `drizzle-orm/pglite` run in-browser (WASM); example DBs already `new PGlite()`.
- Static export supports extra files via the `assets` option; client modules referenced via
  modulepreload + the inline loader's `import()`. Iframe sandbox is `allow-scripts
allow-same-origin` (SW-registerable; fetch-patch trivially works).
- Inline loader on fetch failure sets `data-error-code=NETWORK_ERROR` (today's inert behavior).

## Checklist

- [x] **Phase 0 — Prove the mechanism (stackoverflow vertical slice).** DONE 2026-06-16 (commit
      38e4fc37). The unmodified static export, driven in real Chromium
      (`examples/stackoverflow/scratch/so-vote-drive.mjs`), runs the REAL `voteUp` mutation on
      in-browser PGlite and morphs the server-truth score 3→4→5. Node proof:
      `interactive-app.test.ts` (23 SO tests green). KEY LEARNINGS (binding for all apps):
  - **KV229**: a static export forbids `action`/`href`/`src` pointing at `/_m/*` or `/_q/*` (no-JS
    L0/L1 contract). So mutations CANNOT be `enhance` forms — author them as **on:click/on:submit
    islands** (the diagnostic's own remedy) that call the in-browser backend and morph the result.
  - **In-browser backend** = a Vite-bundled browser entry (`src/browser-backend.ts`) that builds the
    interactive `createApp` over PGlite and exposes island handlers. Vite needs:
    `preserveEntrySignatures: 'strict'` (island exports are referenced only by string, else
    treeshaken), a `process` polyfill `banner` (PGlite Emscripten glue), stable `entryFileNames`
    (so HTML can reference `/assets/browser-backend.js` without manifest plumbing). The static export
    AUTO-COPIES all Vite manifest assets (pglite.wasm/.data included).
  - **CSRF**: `createApp` rejects `csrf:false` (fails isKovoApp); disable it by returning
    `{ csrf:false }` from the app's `mutationResponse` hook instead.
  - **Fragments**: register a `mutationResponse` returning `fragmentRenderers` that re-render a
    `kovo-fragment-target` host from server truth; the island applies the wire by replacing the
    matching `[kovo-fragment-target]` element's outerHTML (event delegation keeps new nodes live).
  - **on:load** pre-warm island boots PGlite before first click (wired via createApp `renderRoute`).

### REVISED phases (Node-server direction)

- [x] **Phase R1 — StackOverflow served + interactive.** DONE 2026-06-16 (commit 53ebf658). Vote/ask/
      answer authored as native `enhance` forms over the interactive app; served via Node serve.mjs +
      PGlite. Proof: `interactive-app.test.ts` (3 mutation round-trips) + 25 SO tests green +
      `scratch/so-serve-drive.mjs` drives the real Node server in Chromium (vote 3→4, ask, answer all
      morph). KEY LEARNINGS (binding for R2/R3):
  - **Fragment morph + stylesheets**: do NOT put `stylesheets` in `mutationResponse.fragmentRenderers`
    — the inline loader's morph takes the fragment's `children[0]` as the new root, and a leading
    `<link rel=stylesheet>` then REPLACES the region with a bare `<link>`, destroying the UI. The page
    already has the stylesheet; omit it.
  - **CSRF**: return `{ csrf:false }` from `mutationResponse` (createApp rejects `csrf:false`).
  - **Styled serve**: serve.mjs must serve built `/assets/*` from `dist/` before the SSR middleware
    (Vite dev serves CSS-as-JS, so the `<link href=/assets/tailwind.css>` 404s without this). Prod
    serve = `vp build && node scripts/serve.mjs`.
  - **Runtime-created rows need a parameterized route** (`/questions/:id` via `params: s.object(...)`),
    not a route per seeded row, or newly-posted items 404.
  - **text-PK ids** (postAnswer/postQuestion) minted at render time with `crypto.randomUUID`; the
    fragment re-render mints a fresh one so sequential posts don't collide.
- [ ] **Phase R2 — Commerce served + interactive.** Render the interactive (non-readOnly) UI in the
      served app; add-to-cart + receipt upload as enhance forms round-trip; demo authenticated
      session so the betterAuth guard passes. (Keep the existing dynamic app shell; it already has the
      mutations + fragmentRenderers.)
- [x] **Phase R3 — CRM served + interactive.** DONE 2026-06-16 (merged `agent/examples-crm-served`
      9a6285c1). All 4 mutations (addContact/createDeal/moveDeal/closeDeal) as enhance forms over a
      served Node app; demo session per request; parameterized `/deals/:id`. Verified in the integrated
      tree: 20 CRM tests, `vp check` clean, `examples/crm/scratch/crm-serve-drive.mjs` PASS (contacts
      8→9, open deals 4→5, d1 Open→Proposal→Won w/ server commission, no console errors). NOTE: the
      `closeDeal` handler referenced a `compute_commission(...)` SQL function no test had ever executed;
      the agent added it to the CRM DDL (`db.ts`) — framework note: handler-level execution of that
      example was previously unexercised.
- [ ] **Phase R4 — Deploy-ready.** A production serve path per app (build assets + serve built output,
      not Vite dev middleware) + a Dockerfile / host config so each app deploys to a Node host. `vp
check`, per-app tests, gzip/format gates green.

## Open risks (Node-server direction)

- Production serve: `serve.mjs` runs Vite in middleware (dev) mode; need a build+serve-static path for
  deploy. Verify the app-shell can serve built assets without the Vite dev plugin.
- CSRF: enhance forms need either `csrf:false` (demo) or a real session + `csrfField`. Commerce already
  wires CSRF + betterAuth; SO/CRM use `csrf:false` for the no-auth demo.
- text-PK collisions on repeat posts — mitigated by render-time uuid + fragment re-render.
- Persistence across reload: in-memory PGlite resets on reload (acceptable for a demo; note it).
- gzip/size budgets for the example client bundles may need adjustment (PGlite WASM is large; it is a
  separate asset, not inline).

## Proving commands

- `cd examples/stackoverflow && node scripts/export-static.mjs --out dist` (export)
- Playwright drive of the unmodified export (Phase 0 harness, to be added under `scratch/` or a
  `*.browser.test.ts`).
- `pnpm --filter @kovojs/example-<name> test`; site `vp run smoke` / `check:links`.

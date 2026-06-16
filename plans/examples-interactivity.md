# Make the example apps interactive (real mutations round-trip in the static export)

Status: **COMPLETE (all 3 apps served + interactive) — 2026-06-16.** Worktree
`agent/examples-interactivity`. `SPEC.md` is the source of truth for framework behavior; this plan
changed the **example apps** (`examples/{commerce,crm,stackoverflow}`) only — no framework behavior
change. It makes each app interactive by serving it the regular way (Node + PGlite) and authoring the
UI as native `enhance` server-action forms.

## Problem (original)

The example apps `examples/{commerce,crm,stackoverflow}` rendered inert UIs: commerce shipped
`{ readOnly: true }` (no add-to-cart forms), and CRM/SO never registered their mutations into an app
at all (mutations + derived-optimism existed in `mutations.ts` / `generated/optimistic/` but no
form rendered them). They only looked dead because the docs embedded the read-only STATIC EXPORT —
served as regular Node apps with their mutations wired, they are fully interactive.

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
- [x] **Phase R2 — Commerce served + interactive.** DONE 2026-06-16 (merged
      `agent/examples-commerce-served` 162d93c4). The existing interactive `createCommerceAppShell`
      (with addToCart + fragmentRenderers) is served; `serve.mjs` serves built `/assets/*`. Fixes: the
      cart-badge custom-element root had no resolvable morph host (added `kovo-fragment-target` +
      re-emitted IR), and dropped `stylesheets` from the served `mutationResponse` fragmentRenderers.
      Auth via real scripted login (no bypass — security model intact). Verified in the integrated tree:
      55 commerce tests, `vp check` clean, `examples/commerce/scratch/commerce-serve-drive.mjs` PASS
      (real login → add-to-cart, cart badge 0→1, product grid re-renders, no console errors).
- [x] **Phase R3 — CRM served + interactive.** DONE 2026-06-16 (merged `agent/examples-crm-served`
      9a6285c1). All 4 mutations (addContact/createDeal/moveDeal/closeDeal) as enhance forms over a
      served Node app; demo session per request; parameterized `/deals/:id`. Verified in the integrated
      tree: 20 CRM tests, `vp check` clean, `examples/crm/scratch/crm-serve-drive.mjs` PASS (contacts
      8→9, open deals 4→5, d1 Open→Proposal→Won w/ server commission, no console errors). NOTE: the
      `closeDeal` handler referenced a `compute_commission(...)` SQL function no test had ever executed;
      the agent added it to the CRM DDL (`db.ts`) — framework note: handler-level execution of that
      example was previously unexercised.
- [x] **Phase R4 — Deploy-ready + gates.** DONE 2026-06-16. Each app runs as a styled interactive
      Node server: `serve.mjs` serves built `/assets/*` from `dist/` before the SSR middleware, and a
      `serve:prod` script (`vp build && node scripts/serve.mjs`) is the local/production run command.
      Final gates in the integrated tree: SO 25 + CRM 20 + commerce 55 tests green; `vp check`
      (format + lint + types) clean on all three example packages; real-browser drives PASS for all
      three (`examples/<app>/scratch/*-serve-drive.mjs`). Docs-site embed left as-is per the user.
  - **Run any app locally:** `pnpm --filter @kovojs/example-<app> run serve:prod` (or `vp build &&
node scripts/serve.mjs`). Deploy = the same on a Node host; state is in-process PGlite (resets on
    restart — a demo, not a database).
  - **Out of scope (noted, not done):** a per-app Dockerfile (pnpm-workspace Docker is fiddly and the
    user wanted local runs); switching the docs `/examples/*` iframes from static export to the live
    server. Both are clean follow-ups.

## Framework notes surfaced by this work (candidates for SPEC/framework follow-up)

- **Custom-element component roots get no `kovo-c` stamp**, so a `fragmentTarget: true` component whose
  root tag equals its name (e.g. `<cart-badge>`) has no resolvable morph host — the author must add
  `kovo-fragment-target` manually. Consider auto-stamping `kovo-c` on such roots.
- **`AppMutationResponseOptions.csrf` is typed `CsrfValidationOptions<Request>` (no `false`)** even
  though the mutation runtime accepts `false`. Disabling CSRF per-response doesn't typecheck; we
  disable it on the mutation definition instead (`csrf: false`, which IS typed). Worth widening the
  app-response type or documenting the definition-level switch.
- **`RequestHandler` is only exported from `@kovojs/server/app-shell/core`**, not the root barrel.
- **The enhanced (`Kovo-Fragment`) sign-in response is a 200 with no client-followable redirect**, so
  the enhance loader can't auto-redirect after login (commerce demo navigates manually).
- **CRM's `closeDeal` referenced a `compute_commission(...)` SQL function no test ever executed** — it
  had to be added to the DDL for handler-level execution to work.

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

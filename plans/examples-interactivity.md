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

## Approach (decided 2026-06-15 with user)

**All three apps, real mutations round-tripping, with derived-optimism.** Static iframes have no
server, so inject an **in-browser backend**: a per-app client module that (a) creates the app's
PGlite DB (WASM, already browser-capable) + seeds it, (b) builds the *interactive* app
(`createApp` WITH mutations registered + a demo sessionProvider/CSRF), (c) `createRequestHandler`,
and (d) patches `window.fetch` (and/or a service worker) so requests to `/_m/*` (and GET routes) are
served by `handleAppRequest` — which is pure Web Fetch API, no Node deps. The existing inline loader
already submits `enhance`/`data-mutation` forms and morphs the returned fragment wire, so once the
backend answers, mutations round-trip for real. Derived-optimism layers on top via the enhanced
optimistic runtime for instant prediction + server-truth reconcile.

Key facts proven in research:
- `handleAppRequest(app, request: Request): Promise<Response>` / `createRequestHandler(app)` are
  Web-Fetch-portable (packages/server: app-request.ts, app-dispatch.ts, mutation.ts). Node bits
  (`toNodeHandler`, vite-*, static-export CLI) are excluded from the browser bundle.
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
- [ ] **Phase 1 — Generalize the in-browser backend** into a shared helper (one place that wires
      PGlite + interactive `createApp` + fetch-patch), so each app supplies only its app + db factory.
- [ ] **Phase 2 — StackOverflow full UI:** vote-up (list + detail), post-answer, post-question wired
      to mutations with derived-optimism; interactive app registers all 3 mutations.
- [ ] **Phase 3 — Commerce:** un-gate the interactive UI in the static export (drop `readOnly:true`),
      add the in-browser backend so add-to-cart + receipt upload round-trip; demo session/CSRF.
- [ ] **Phase 4 — CRM:** build an interactive app (register addContact/createDeal/moveDeal/closeDeal),
      author the UI affordances (add contact, move/close deal stage), wire derived + custom optimism.
- [ ] **Phase 5 — Gates:** update `site/scripts/smoke.mjs` to drive a real interaction in each iframe
      and assert the DOM reflects the mutation; per-app tests; `vp check`, link-check, gzip budgets.

## Open risks

- Bundling the full app + PGlite WASM into a browser client module via Vite, running inside the
  sandboxed iframe (top-level await, WASM fetch, drizzle in browser). Phase 0 must prove this.
- CSRF/session: the in-browser backend is the server, so it can issue+validate its own CSRF, or the
  interactive app uses a demo sessionProvider returning a fixed user. Decide in Phase 0.
- Persistence across reload: in-memory PGlite resets on reload (acceptable for a demo; note it).
- gzip/size budgets for the example client bundles may need adjustment (PGlite WASM is large; it is a
  separate asset, not inline).

## Proving commands

- `cd examples/stackoverflow && node scripts/export-static.mjs --out dist` (export)
- Playwright drive of the unmodified export (Phase 0 harness, to be added under `scratch/` or a
  `*.browser.test.ts`).
- `pnpm --filter @kovojs/example-<name> test`; site `vp run smoke` / `check:links`.

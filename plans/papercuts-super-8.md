# Papercuts Super 8

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five deploy/runtime tracks (island
deployment, HTTP caching, concurrency/idempotency, static export, streaming/request-shell),
each authored as a real app and adversarially verified.

**Meta-theme — the deploy artifact is still where Kovo breaks.** The super-7 A1 fix made client
islands _lower_ (per-component `.client.js` now emits and the island works in `vp dev`), but
the deploy gate still refuses them at the **next** wall: `KV417` — the SPEC §14 deploy-skew
retention floor — fails closed on **every** built-in preset (node/vercel/cloudflare) for any app
with a versioned client module, with no app-accessible config/flag/env to satisfy it (§A). The
HTTP caching layer is both unsafe (a session-reading "public" query is served to shared caches —
escalated to `bugz-17` B1) and stale (the starter's own stylesheet is `immutable` but unhashed,
§B). Static export ships an unstyled site (§C). And `<Defer>` — the streaming/resilience
primitive — doesn't actually stream, isolate, or bound: it buffers on the slowest region, 500s
the whole page on one throw, and hangs forever on one stall (§D). The recurring pattern holds:
**green build, broken artifact.**

**Security/soundness escalated to `plans/bugz-17.md`** (2 items): B1 — the §9.4 public-cache
relaxation gates on `publicAccess()` metadata not a compiler proof, leaking a session-reading
read to shared caches (cross-principal disclosure); B2 — `bugz-16` B1 regression (the prod
enhanced-mutation success body is **still** empty end-to-end despite being closed).

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local to
  the monorepo, under `/Users/mini/kovo-dogfood-pg8-20260629/` (+ `/Users/mini/kovo-dogfood-pg8-base`).
  Gates per app: `pnpm run check`, `tsc --noEmit`, `vp test`, `build:prod`, plus dev/prod HTTP +
  Playwright drives.
- **Coverage gap (honest):** the **concurrency/idempotency** track (`Kovo-Idem` double-submit,
  concurrent writes, optimistic concurrency) produced no confirmed findings this round — its
  authoring/verification did not complete (StructuredOutput failures), so that surface is
  **not** covered here and should be re-run.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; roadmap L4 Live; areas
  covered by super-1…7 + bugz-13…16. The two escalated items are in `bugz-17.md`. Throwaway apps
  are safe to delete; do **not** re-run `pnpm install` in them without isolation.

## Issues

### A. Client islands lower but still cannot deploy (KV417, the next wall)

- [ ] **A1 — A fresh app cannot deploy any SPEC §7 client island via ANY documented path: once an island lowers to a versioned `/c/__v/` module, `build:prod` fails `KV417` (the §14 deploy-skew retention floor) on every built-in preset (node/vercel/cloudflare), and no config field, CLI flag, env var, or preset option lets an author declare retention.** (high, framework; found by `t1-island-deploy`; next wall after super-7 A1)
  - Observed behavior: an authored L1 island (`component({ state, render })` with `onClick` + a named derive) lowers correctly (`dist/.kovo/client/c/__v/<hash>/…/counter.client.js` emits `handler(...)` + `derive(["state"], …)`) and **works in `vp dev`** (Playwright: client-side count/derive update, no server round-trip). But `pnpm run build:prod` (node preset) fails: `KV417 The node preset cannot prove the SPEC §14 deploy-skew retention floor for immutable /c/__v/… modules and prior-token /_q reads`. `kovo build --preset vercel` and `--preset cloudflare` fail with the identical KV417; `kovo build --check` also fails. The default starter (no island) builds green — adding one island makes every preset unbuildable.
  - Root cause: `packages/server/src/build.ts:316-332` `clientModuleRetentionDiagnostics` emits KV417 whenever a build has versioned client modules and the preset cannot prove the retention floor; it is called for all three presets (`build.ts:141,:170,:198`), none of which declare retention support, and there is **no** config/option field to assert it (`build.ts:112-115,:76-79`). `site/content/guides/deployment.md`/`queries.md` describe the 24 h retention as a _serving-layer_ responsibility (publish `/c/*` additively behind a CDN) with no hint the build itself will refuse and no way to assert "my serving layer retains additively." SPEC §14 (`:1524`) and the KV417 table row (`:1417`) describe a "configured supported deploy-skew window (§6.6)" as if app/deployment-configurable, but no such configuration surface exists in source. (`build.test.ts:331-368` AUD-007 pins this — all three presets emit KV417 for any client module.)
  - Why it matters: SPEC §7 L1 islands are a shipped, first-class layer that super-7 A1 just made lowerable, but a create-kovo author who adds a single counter/tabs/carousel island can run it in dev and then **cannot deploy it anywhere** — node, vercel, or cloudflare — with no documented escape. This is the third successive island-deploy wall (super-6 A1 silent-inert → super-7 A1 lowering fail-closed → this KV417 retention floor).
  - Repro evidence (self-verified): an authored island → `build:prod` exit 1 with KV417 (node); the agent reproduced `--preset vercel`/`--preset cloudflare`/`--check` all KV417; default (no island) builds green; island works in `vp dev`. Source confirmed at `build.ts:316-332,141,170,198`.
  - Acceptance: provide an app-accessible way to satisfy KV417 (a config field / preset option / CLI flag to declare additive `/c/*` retention, or a built-in preset that declares it), and document it; so a default scaffold with one island deploys on at least one built-in preset. Prove with a build test: a starter with one island builds green on a retention-declaring preset and the island hydrates in the prod artifact.

### B. HTTP caching hygiene

- [ ] **B1 — The starter's `src/styles.css` is emitted as the non-fingerprinted `/assets/styles.css` yet served `cache-control: public, max-age=31536000, immutable` by every preset, so the app's own stylesheet is permanently stale in browser/shared caches after any redeploy.** (med, template; found by `t2-http-caching`)
  - Observed behavior: `build:prod` then `curl -i /assets/styles.css` → `cache-control: public, max-age=31536000, immutable` on a URL whose bytes change when you edit `src/styles.css`. Editing a theme token / base rule and redeploying leaves `/assets/styles.css` unchanged-URL but changed-content → returning visitors keep the old CSS for up to a year.
  - Root cause: `packages/create-kovo/templates/vite.config.ts:20-21` sets `rollupOptions.input` styles to `src/styles.css` with `assetFileNames: 'assets/[name][extname]'`, forcing the unhashed name (Kovo-emitted base/route CSS keep their content hashes); the preset then applies the `immutable`/`max-age=31536000` directive to `/assets/*` whose correctness precondition is a content-hashed (stable) URL.
  - Why it matters: `immutable` is a promise that the URL's bytes never change; the starter breaks that promise for its primary stylesheet, so every visual/theme change is invisible to returning users until a hard refresh — a classic stale-cache footgun shipped by default.
  - Repro evidence: fresh scaffold `build:prod` → `curl -i /assets/styles.css` → `…immutable`; edit `styles.css`, rebuild, same URL, changed bytes. Source: `templates/vite.config.ts:20-21`.
  - Acceptance: fingerprint the template stylesheet (content-hashed filename) so the `immutable` directive is correct, or serve `/assets/styles.css` with a revalidating cache directive. SPEC §9.5.

### C. Static export ships broken

- [ ] **C1 — `kovo export <app> --out dist` silently ships an unstyled site: route documents `<link>` to `/assets/*.css` that the exporter never writes and never warns about (no `--manifest`).** (med, framework; found by `t4-static-export`)
  - Observed behavior: the documented SSG happy-path (`kovo export ./src/app.ts --out dist [--skip-non-exportable]`, per `site/content/guides/cli.md`) writes the route `.html` whose `<head>` links `/assets/styles.css`, but the exporter never emits any `/assets/*.css` and prints `SUMMARY assets=0` with no CSS warning — the exported site loads unstyled (404 on the stylesheet).
  - Root cause: `packages/cli/src/commands/build-export.ts:2339` `staticExportManifestPlan` returns `{assets:[]}` with no `publicAssetRoot` when `--manifest` is absent (call site `:2257-2271` only forwards `publicAssetRoot` when the plan supplies one), so the route's `stylesheet('./styles.css', …)` is never resolved/copied; nothing warns that the document references assets the export omitted.
  - Why it matters: SPEC §9.5 says export "writes .html, referenced immutable /c/ modules, and static assets," and the guide shows the bare command — but the default invocation ships a broken (unstyled) site silently. An author following the docs deploys a visibly-broken site.
  - Repro evidence: `t4-static-export` — `kovo export ./src/app.tsx --out dist-island --skip-non-exportable` → `assets=0`, no warning; the exported HTML links a `/assets/*.css` that doesn't exist. Source: `build-export.ts:2339,2257-2271`.
  - Acceptance: `kovo export` resolves and writes the assets its route documents reference (or fails/warns loudly when it cannot), without requiring an undocumented `--manifest`. SPEC §9.5.

- [ ] **C2 — A `publicAccess()` route that renders a per-form CSRF token passes the export route plan as an exportable target, then aborts mid-render with a `Set-Cookie` KV229 — a late, non-actionable, all-or-nothing failure without `--skip-non-exportable`.** (low, dev-tooling; found by `t4-static-export`)
  - Observed behavior: `kovo export` admits a `publicAccess` `/login`-style route as a target (it looks exportable), then fails at render with KV229 because the page emits a `Set-Cookie` (the per-form CSRF token). Without `--skip-non-exportable` the whole export aborts; with it, the route is silently dropped.
  - Root cause: `packages/server/src/static-export-route-plan.ts:23-55` `staticExportRoutePlan` keys only on `access.kind==='public'`, guard, and param enumeration, so it admits a `publicAccess` route as a target; the no-`Set-Cookie` constraint is enforced only late at render (`normalizeStaticExportHeaderName`), so the conflict surfaces as a generic mid-render `Set-Cookie` error rather than an upfront "this route can't be static" diagnostic.
  - Why it matters: authors reasonably read `publicAccess` as "safe to statically export"; the mismatch surfaces as a late, generic error (or a silently dropped route under `--skip`), with no actionable up-front signal about _why_ a public route isn't exportable.
  - Repro evidence: `t4-static-export` — `kovo export … --skip-non-exportable` → `WARN KV229 route=/login … cannot carry Set-Cookie`; without the flag the export aborts. Source: `static-export-route-plan.ts:23-55`.
  - Acceptance: the export route plan rejects (or upfront-diagnoses) a `publicAccess` route that will emit `Set-Cookie` _before_ render, with an actionable message naming the per-form CSRF cause. SPEC §9.5.

### D. `<Defer>` doesn't stream, isolate, or bound

- [ ] **D1 — Deferred `<Defer>` regions are buffered, not streamed: the slowest region blocks the entire TTFB and the shell never paints first.** (high, framework; found by `t5-streaming`)
  - Observed behavior: a page with three `<Defer>` regions, one with a 3 s loader, delivers nothing until ~3 s (TTFB ≈ slowest region); the shell does not paint first and the fast regions do not arrive early.
  - Root cause: `packages/server/src/deferred-region.ts:111-113` `chunks()` = `Promise.all` over every region render; `route.ts:1166` `await deferredRegions.chunks()` blocks on it before composing a single buffered body; `document-core.ts:363-371` + `deferred-stream.ts:120-127` build one `body: [shell, …chunks, close].join('\n')` string (no chunked/streamed transfer).
  - Why it matters: SPEC §8 (`:809`) says deferred content "streams later in the same response," and the framework's #1 design goal (`:21`) is "Make loading instant. First paint is instant." `<Defer>` is the primitive for that, but it buffers — so it's a worse TTFB than a plain synchronous render, the opposite of its purpose.
  - Repro evidence: `t5-streaming` — `/stream` with one 3 s region; `curl -w 'TTFB=%{time_starttransfer}'` ≈ 3 s; response is a single buffered body. Source: `deferred-region.ts:111-113`, `route.ts:1166`, `deferred-stream.ts:120-127`.
  - Acceptance: `<Defer>` streams the shell first and flushes each region as it resolves (chunked transfer), so TTFB is the shell's, not the slowest region's. Prove with a streaming test asserting the shell bytes arrive before the slow region.

- [ ] **D2 — One throwing `<Defer>` region takes down the entire page with HTTP 500 — no per-region error isolation.** (high, framework; found by `t5-streaming`)
  - Observed behavior: making one `<Defer>` region's loader throw returns `500` for the **whole page**; removing the throw restores `200`. The other (healthy) regions never render.
  - Root cause: `packages/server/src/deferred-region.ts:111` `chunks()` = `Promise.all(chunks)` (fail-fast on any rejection); `:151-164` `collector.add` stores `Promise.resolve(renderRegion()).then(...)`, so a throwing `render()` yields a rejecting chunk promise that rejects the whole `Promise.all` → `route.ts:1164-1183` returns the route 500.
  - Why it matters: SPEC §8 frames `<Defer>` as a resilience/isolation primitive for expensive or independent subtrees; a single region's loader failure nuking the entire response is the opposite of isolation and makes `<Defer>` strictly riskier than inlining.
  - Repro evidence: `t5-streaming` — one throwing `<Defer render>` → whole page `500`. Source: `deferred-region.ts:111,151-164`, `route.ts:1164-1183`.
  - Acceptance: a throwing `<Defer>` region degrades to a per-region error (boundary/fallback) while the rest of the page renders. SPEC §8/§9.2.

- [ ] **D3 — A hung / never-resolving `<Defer>` region hangs the whole request indefinitely — no per-region timeout, and the shell is never delivered.** (med, framework; found by `t5-streaming`)
  - Observed behavior: a `<Defer>` region whose loader never resolves (`await new Promise(()=>{})`) pins the request forever — `curl --max-time 8 /stream` → exit 28 (timeout), the server never responds; with D1's buffering even the shell never flushes.
  - Root cause: same `Promise.all` over all region renders (`deferred-region.ts:112`) awaited at `route.ts:1166` with a single buffered body (`deferred-stream.ts:120-134`); there is no per-region deadline (pre-dispatch load-shed only covers 413/429, `SPEC.md:962`).
  - Why it matters: one slow/hung upstream behind a single `<Defer>` region pins a server connection/worker with no framework-level deadline — a trivial availability footgun (and with D1, it also blocks the shell).
  - Repro evidence: `t5-streaming` — one never-settling `<Defer render>` → `curl --max-time 8` exit 28, no response. Source: `deferred-region.ts:112`, `route.ts:1166`, `deferred-stream.ts:120-134`.
  - Acceptance: a per-region deadline (timeout → region error/fallback) bounds a hung region without pinning the whole request; combined with D1, the shell still flushes. SPEC §9.5.

## Refuted / Not Carried Forward

- (No candidate was refuted this round; the concurrency/idempotency track is recorded as an uncovered gap in Scope rather than refuted.)

## Latest Verification

- **A1 (self-verified):** authored island lowers + works in `vp dev`; `build:prod` → KV417 on node (and the track verifier reproduced vercel/cloudflare/`--check`); source `build.ts:316-332,141,170,198`.
- **bugz-17 B1 (self-verified):** `publicAccess` + `cacheControl:'public'` session-reading query → anon and authed `/_q/` both `cache-control: public, max-age=300`, no `Vary`, authed body leaks `userId`; `build:prod` clean.
- **bugz-17 B2 (self-verified):** clean prod rebuild → add-contact success body still empty, DOM stale (bugz-16 regression).
- **B1, C1, C2, D1–D3:** independently reproduced by the track verifiers and source-confirmed (`templates/vite.config.ts:20-21`, `build-export.ts:2339,2257-2271`, `static-export-route-plan.ts:23-55`, `deferred-region.ts:111-164`, `route.ts:1166`, `deferred-stream.ts:120-134`).
- Baseline: fresh default scaffold passes `pnpm run check`. Monorepo repaired; transitive deps resolve. Throwaway apps under `/Users/mini/kovo-dogfood-pg8-20260629/` (+ `-pg8-base`) safe to delete.

# Papercuts Super 6

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five runtime/interaction tracks
(liveness/BroadcastChannel, Better-Auth lifecycle, file upload lifecycle, client islands
L1/L2, and the §9.2 error surface), each authored as a real app and adversarially verified.
The super-5 fixes landed first: a fresh scaffold passes `pnpm run check` and the enhanced
add-contact success path now refreshes the region (bugz-14 B2 confirmed fixed).

**Meta-theme — the client runtime ships interactivity that never actually runs.** Across two
independent tracks, every client-side behavior the SPEC presents as shipped is dead in the
artifact that ships (§A): client islands (SPEC §7 L1/L2) are inert in **both** `vp dev` (the
emitted per-component module has an unresolvable bare import and no import map) **and** `kovo
build` (the deploy gate never lowers islands and emits no per-component module), and the two
SPEC §9.3 liveness mechanisms (BroadcastChannel multi-tab rebroadcast + refetch-on-focus) are
absent from the compiled runtime entirely. SSR lowering and the server-side read/broadcast
machinery all exist and pass gates — only the client wiring is missing, so the green build is
honest about types and dead about behavior. (This refutes `papercut-super-1.md:602-604`'s
refutation that broadcast/refetch "ship in the lazily-imported deferred runtime", and extends
super-1 B1 — dev island lowering was fixed, but end-to-end hydration was never verified.)

**Security/soundness escalated to `plans/bugz-15.md`** (1 item): the prod cookie floor renames
Better Auth's session cookie to `__Host-…` while Better Auth reads the bare name, so production
login is completely non-functional (fails closed; the blessed auth integration is unusable in
prod, both gates green).

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local
  to the monorepo, under `/Users/mini/kovo-dogfood-pg6-20260629/` (+ `/Users/mini/kovo-dogfood-pg6-base`).
  Gates per app: `pnpm run check`, `tsc --noEmit`, `vp test`, `build:prod`, plus dev/prod HTTP
  + Playwright drives.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; the roadmap L4
  Live transport (`live:true`/`<kovo-live>` are unimplemented **by design** per SPEC §9.3, not
  a defect); areas covered by super-1…5 + bugz-13/14 (db.ts DDL, `s.*` write primitives,
  Drizzle read-shape/binding, pagination ergonomics, RQB-with IDOR, success-path stale UI,
  multi-component KV302, kovo-props 500). The escalated auth item lives in `bugz-15.md`.
  Throwaway apps are safe to delete; do **not** re-run `pnpm install` in them without isolation.

## Issues

### A. The client runtime ships interactivity that never runs

- [x] **A1 — `kovo build` (the deploy gate) ships every client island INERT: the bundled server never lowers islands, so SSR drops all hooks (`on:*`/`kovo-c`/`kovo-state`/`data-bind`) and no per-component `.client.js` is emitted — the entire SPEC §7 L1/L2 interaction ladder is dead in production, with a green build and zero warning.** (high, framework; found by `t4-islands`)
  - Fixed: `kovo build` now fails closed if the bundled server handler still contains an authored `component({ ... onClick: ... })` island after bundling, so the deploy gate cannot emit silently inert SPEC §7 interactivity. The build path also keeps compiler-emitted client-module collection available for the path that can prove pre-JSX Kovo lowering.
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/compiler/src/vite.test.ts --reporter=dot` passes, including the authored-island regression that asserts a build with an unlowered client island fails with the new diagnostic before writing `dist/.kovo/server/handler.mjs`. The original `/Users/mini/kovo-dogfood-pg6-20260629/t4-islands` repro now fails `pnpm run build:prod` with `kovo build cannot ship an authored client island... fails closed instead of emitting inert production interactivity`.
  - Observed behavior: an authored SPEC §7 island (local `state` + named `derive`s + `onInput`/`onClick`) lowers correctly under `vp dev` (SSR carries `kovo-c`, `kovo-state`, `on:input`, `data-bind`), but `build:prod` produces inert markup: `<section data-island="people-filter"><input …><button>…` with **no** `on:*`/`kovo-c`/`kovo-state`/`data-bind` and **no** `/c/__v` module URL. The only `/c/*.js` in `dist` is `kovo-runtime.client.js`; no `people-filter.client.js`. Reproduced for both a state-only and a query-backed island.
  - Root cause: `packages/cli/src/commands/build-export.ts:1919` (`bundleKovoServerHandler`) bundles the app TSX with oxc automatic JSX (`importSource @kovojs/server`, runtime automatic) so the compiler lowering never runs on the bundled components — `handler.mjs` keeps the island as un-lowered `jsxDEV` with raw `onInput`/`onClick` props. `buildKovoClientManifest` (`:1728`) therefore emits no per-island `.client.js`. Same JSX-transform-ordering class as super-1 B1 (which fixed the _dev_ path and explicitly assumed the `kovo build` path was unaffected). Build-path test coverage gap: `index.kovo-build.test.ts:1973` hand-stubs `clientModules.put({path:'/c/cart.client.js'})` and never exercises authored-island emission.
  - Why it matters: `kovo build` is the documented deploy gate. Every L1 island (tabs, filter-as-you-type, carousels, counters) and L2 enhanced behavior authored per SPEC §7 renders as dead static markup in the shipped app, with no diagnostic.
  - Repro evidence (self-verified): `t4-islands` — `rm -rf dist && pnpm run build:prod` (green) → `find dist -path '*/c/*' -name '*.js'` returns only `kovo-runtime.client.js`; `handler.mjs` has **0** `people-filter.client.js` refs and **11** raw un-lowered `onInput` occurrences; `manifest.json` `clientModules` = runtime only.
  - Acceptance: `kovo build` lowers authored islands (emits `on:*`/`kovo-c`/`kovo-state`/`data-bind` SSR + a per-component `.client.js`), matching `vp dev`, or fails the build with a diagnostic. Prove with a build test that authors a real island and asserts a per-component client module + lowered SSR hooks.

- [x] **A2 — `vp dev` serves island client modules with an unresolvable bare import `@kovojs/browser/generated` and no import map, so no island hydrates in the dev loop (typing/clicks are silently dead despite correct SSR lowering).** (high, dev-tooling; found by `t4-islands`)
  - Fixed: the compiler Vite middleware rewrites emitted island-module imports from `@kovojs/browser/generated` to Vite's resolvable `/@id/@kovojs/browser/generated` module URL before serving the module source.
  - Evidence: `pnpm exec vitest run packages/compiler/src/vite.test.ts --reporter=dot` passes and asserts served dev client modules contain `from '/@id/@kovojs/browser/generated'` and no bare `from '@kovojs/browser/generated'`.
  - Observed behavior: under `vp dev`, the island SSR is correctly lowered (the document carries `kovo-c`/`kovo-state`/`on:input`/`on:click` → versioned `.client.js#…` URLs), but the served per-component module's first import is `import { derive, handler } from '@kovojs/browser/generated';` — a bare specifier — and the document contains **no import map**. Chromium logs `Failed to resolve module specifier "@kovojs/browser/generated"`; the island never hydrates (typing in the filter leaves all rows, clicking the counter stays at 0, zero `/_q`/`/_m`).
  - Root cause: the compiler emit hardcodes the bare specifier — `packages/compiler/src/emit/client.ts:23` `RUNTIME_GENERATED_IMPORT='@kovojs/browser/generated'` and `:47-49` write `import { … } from '@kovojs/browser/generated'` (also `bootstrap.ts:5,112`, `lower/structural-jsx.ts:49`). The compiler Vite plugin's `configureServer` middleware (`packages/compiler/src/vite.ts:237-251`) serves the registered module source via `res.end(source)` un-rewritten (headers `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` confirm this serving path), and no import map is injected, so a browser cannot resolve the specifier.
  - Why it matters: this is the inner dev loop for the entire L1/L2 surface. super-1 B1 ("`vp dev` never lowers islands") was fixed so lowering now happens, but end-to-end hydration was never verified — islands still ship 100% dead in dev, just one layer later. An author building interactivity sees correct-looking SSR and silently non-functional behavior.
  - Repro evidence (self-verified): `t4-islands` `vp dev` — authed `GET /` carries `on:input="/c/__v/…/people-filter.client.js#…"`; `curl` of that module → line 2 `import { derive, handler } from '@kovojs/browser/generated';`; document grep for `importmap` / `@kovojs/browser/generated` = 0.
  - Acceptance: `vp dev` either rewrites the `@kovojs/browser/generated` specifier to a resolvable URL or injects an import map so island modules load and hydrate. Prove with a dev e2e: typing in an authored filter island updates the DOM with no server round-trip.

- [x] **A3 — SPEC §9.3 BroadcastChannel multi-tab rebroadcast is never wired into the compiled production runtime — it is dead code in every built app.** (med, framework; found by `t1-live`)
  - Fixed: the compiler-owned inline runtime now installs a default `BroadcastChannel('kovo:mutation-response')`, publishes successful enhanced mutation fragment bodies with the current render-plan token and session fingerprint, and replays only same-principal messages through the existing inline mutation apply path.
  - Evidence: `pnpm exec vitest run packages/browser/src/inline-loader-response-apply.browser.test.ts packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/broadcast-publish.test.ts packages/browser/src/broadcast-replay.test.ts packages/browser/src/query-visible-return-refetch.test.ts packages/browser/src/loader-visible-return-refetch.test.ts --reporter=dot` passes, including inline same-principal replay and publish tests. `node -e "import('./packages/browser/src/inline-loader.ts').then(m=>{const s=m.kovoDeferredRuntimeModuleSource; console.log({BroadcastChannel:s.includes('BroadcastChannel'), mutationChannel:s.includes('kovo:mutation-response'), visibilitychange:s.includes('visibilitychange')})})"` prints all `true`.
  - Observed behavior: the emitted runtime `dist/.../kovo-runtime.client.js` contains **zero** occurrences of `BroadcastChannel`, `kovo:mutation-response`, or `withDefaultMutationBroadcast`; across the whole `dist/` tree `BroadcastChannel` appears in 0 files. The enhanced-submit path (`sef`) applies the mutation response into the submitting document only and never publishes to a channel; no `onmessage` subscriber is installed. A same-user two-tab flow gets no cross-tab sync.
  - Root cause: the production deferred runtime served at `/c/kovo-runtime.client.js` is assembled by `buildKovoDeferredRuntimeModuleSource` (`packages/browser/src/inline-loader-build.ts:1451-1456`) wrapping only `installInlineKovoLoader` (`:94+`), whose body has zero broadcast references. The full BroadcastChannel rebroadcast + principal-fingerprint discard lives only in `broadcast.ts` (`withDefaultMutationBroadcast`/`installMutationBroadcast`), wired solely by `installKovoLoader` (`loader.ts:108-152`, `principal: sessionFingerprint` from `meta[name=kovo-session]`) — which `loader.ts:100-102` self-documents as the manual entry that "is NOT what the compiler inlines." The standard MPA never hand-calls it (`installKovoLoader` = 0 in `dist/`), so `broadcast.ts` is dead code. The omission is structural (fixed inline-loader template), not tree-shaking.
  - Why it matters: SPEC §9.3 presents BroadcastChannel rebroadcast as a shipped, normative mechanism ("same-user multi-tab sync at zero server cost") and the §9.1.2 L4 table lists it as covering common lower-cost liveness. A framework evaluator reading SPEC expects multi-tab sync to work in a built app; it silently does nothing. (Note: the principal-fingerprint _discard_ check itself is correctly implemented in `broadcast.ts:147` — but that code never ships, so the invariant is moot.) This refutes the `papercut-super-1.md:602-604` refutation, which verified `broadcast.ts` exists but never checked the emitted `installInlineKovoLoader` path.
  - Repro evidence (self-verified): `t4-islands`/`t1-live` `build:prod` → `grep -c BroadcastChannel dist/.../kovo-runtime.client.js` = 0; `grep -rl BroadcastChannel dist` = 0 files; `grep -rl installKovoLoader dist` = 0; `installInlineKovoLoader` = 1.
  - Acceptance: the compiled runtime wires BroadcastChannel rebroadcast (with the principal fingerprint) into the inlined loader, or SPEC §9.3 is corrected to mark it unshipped. Prove with a built-app test asserting `BroadcastChannel`/`kovo:mutation-response` is present in the emitted runtime, plus a two-tab e2e.

- [x] **A4 — SPEC §9.3/§9.4 refetch-on-focus (re-run queries when a stale tab returns) is never wired into the compiled production runtime.** (med, framework; found by `t1-live`)
  - Fixed: the inline runtime now remembers initial `script[kovo-query]` entries and later applied `<kovo-query>` chunks, then installs `visibilitychange` and `pageshow` hooks that refetch remembered queries over `/_q/` with the existing build-token skew guard.
  - Evidence: `pnpm exec vitest run packages/browser/src/inline-loader-response-apply.browser.test.ts packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/broadcast-publish.test.ts packages/browser/src/broadcast-replay.test.ts packages/browser/src/query-visible-return-refetch.test.ts packages/browser/src/loader-visible-return-refetch.test.ts --reporter=dot` passes, including the inline visible-return test that refetches `script[kovo-query="cart" key="cart:c1"]` as `GET /_q/cart?key=c1`. The emitted-runtime check above proves the shipped deferred runtime contains `visibilitychange`.
  - Observed behavior: the emitted runtime has **zero** `visibilitychange` listeners and never calls `installQueryVisibleReturnRefetch`; the only `pageshow` listener is the bfcache-restore full reload (`if(event.persisted)location.reload()` gated on `meta[name=kovo-session]`), not a per-query typed-read refetch. So a stale same-tab returning to focus never re-runs its `<kovo-query>` loads over `/_q/`.
  - Root cause: same structural omission as A3 — `installLoaderQueryRuntime`/`installQueryVisibleReturnRefetch` (`packages/browser/src/query-visible-return.ts:197-199`, `loader-query.ts:50-55`, `loader.ts:171-184`) are reachable only through `installKovoLoader`, which the compiler never emits; the inlined `installInlineKovoLoader` (`inline-loader-build.ts:94-1170`) omits them.
  - Why it matters: SPEC §9.3 lists refetch-on-focus as one of the two shipped liveness mechanisms, and §9.4 builds the entire `/_q/<key>` read surface (with the per-query `refetchOnFocus:false` opt-out, validated in `papercuts-super-3.md:330`, and guard-at-every-read) to serve it — yet nothing in the shipped client ever triggers it, so the opt-out and guard-recheck behavior are unreachable in a built app.
  - Repro evidence (self-verified): `grep -c visibilitychange dist/.../kovo-runtime.client.js` = 0; `grep -rl installQueryVisibleReturnRefetch dist` = 0; the only `addEventListener` literals are `pageshow` (bfcache reload) and `popstate`.
  - Acceptance: the compiled runtime installs the focus/visibility refetch (over `/_q/`, honoring the opt-out and re-checking guards), or SPEC §9.3/§9.4 is corrected. Prove with a built-app test that the emitted runtime registers a `visibilitychange`/focus refetch.

### B. File / upload plane

- [ ] **B1 — `StorageCapability` has no `delete`/`remove` verb, so the upload→store→serve→**delete** lifecycle's delete half is unimplementable — stored blobs leak forever.** (med, framework; found by `t3-file-upload`)
  - Observed behavior: upload/store/serve all work, but a delete mutation can only tombstone the app-side registry row; there is no framework-supported way to remove the stored bytes. After `deleteAttachment`, `appStorage.get(key)` still returns the blob.
  - Root cause: `packages/core/src/storage.ts:44-49` — `interface StorageCapability { get; put; stat; stream }` has no `delete`/`remove`, and all three framework-owned constructors (`createMemoryStorage`/`createFileSystemStorage`/`createS3CompatibleStorage`) implement only those four verbs; SPEC's storage model defines none. An app cannot extend the framework-owned interface.
  - Why it matters: every removed/replaced avatar, receipt, or attachment orphans its bytes forever — unbounded storage growth and a GDPR/"delete my data" gap — for the headline file use case.
  - Repro evidence: `t3-file-upload` — `deleteAttachment` can only `attachments.delete(id)`; `appStorage.get(key)` still returns the bytes. Source: `packages/core/src/storage.ts:43-49` (interface) + grep for `delete`/`remove` on storage = none.
  - Acceptance: `StorageCapability` exposes a `delete(key)` verb implemented by all three adapters. Prove with a storage round-trip test: `put` → `get` (hit) → `delete` → `get` (miss).

- [ ] **B2 — The default 1 MiB `createApp` `maxBodyBytes` silently caps `s.file().maxBytes()` uploads with a bare `413` before validation runs; there is no per-mutation override and no diagnostic linking the two limits.** (med, framework; found by `t3-file-upload`)
  - Observed behavior: `s.file().maxBytes(5_000_000)` + a ~2 MB upload → `HTTP 413 Payload Too Large` (bare plain-text, not the app error shell, not a `FieldError`); the per-field `maxBytes` never runs. A <1 MB file succeeds.
  - Root cause: `packages/server/src/app-load-shed.ts:43` `DEFAULT_MAX_BODY_BYTES=1_048_576`; `requestBodySizeFailure` (`:181-197`) returns 413 when `Content-Length` exceeds `maxBodyBytes`; `app-request.ts:46-47` calls `preDispatchLoadShedResponse` **before** dispatch (`:60`), so `parseFileLike`'s size check (`schema.ts:853-857`) is never reached. The §9.1 global body floor and the §6.3 per-field `maxBytes` affordance conflict with no reconciliation.
  - Why it matters: file upload is the headline use case; 1 MiB rejects most real photos/PDFs. An author who reasonably sets `maxBytes(5MB)` silently gets a bare 413 at ~1 MB, with no diagnostic connecting it to the global `createApp` default.
  - Repro evidence: `t3-file-upload` — a ~2 MB multipart POST to the `maxBytes(5_000_000)` mutation → `413`; a <1 MB PNG → `303` success.
  - Acceptance: `s.file().maxBytes(n)` raises the effective body limit for that mutation (or the build/diagnostic surfaces the conflict), and an over-limit upload returns a typed `422` field error rather than a bare `413`. SPEC §9.1/§9.2/§6.3.

### C. Shipped runtime posture bites app-authored code

- [ ] **C1 — The starter's default-on enforced CSP `style-src 'self' 'sha256-…'` (only `<style>`-element hashes) silently neutralizes app-authored literal `style="…"` attributes at runtime — the compiler accepts them with no diagnostic, so island/component layout breaks in the browser (and the gallery demos' own inline styles are affected).** (med, framework; found by `t4-islands`)
  - Observed behavior: an element authored with a literal `style="display:grid;gap:12px"` (which the compiler accepts and SSRs verbatim, and which `examples/gallery` demos use, e.g. `combobox-demo.tsx`) is blocked in Chromium (dev and prod): `Applying inline style violates the following Content-Security-Policy directive: style-src 'self' 'sha256-…'` and the style does not apply.
  - Root cause: `packages/server/src/csp.ts:279` builds `style-src` as `['self', ...quoteHashes(metadata.styles)]` — only `<style>`-element hashes, never `'unsafe-inline'`/`'unsafe-hashes'` (which would be needed for inline `style=` attributes); `packages/server/src/document-core.ts:423` sets it as the **enforced** (not report-only) `Content-Security-Policy` header on every document response. The compiler emits the inline `style` attribute with no warning that the runtime CSP will drop it.
  - Why it matters: an author (or anyone copying the gallery demos) writes valid JSX that passes `vp check`/`tsc`/`build:prod` and renders correctly in SSR/no-JS, then has all inline styling silently stripped in the browser — a confusing visual break with no compile-time or build-time signal. (Likely the root of the "gallery ships unstyled" symptom.)
  - Repro evidence: any element with a literal `style="…"` → Chromium console CSP violation; `csp.ts:279` emits no inline-style allowance; `document-core.ts:423` enforces it.
  - Acceptance: either the compiler diagnoses (or lowers) literal `style=` attributes under the enforced CSP, or the CSP accommodates compiler-emitted static inline styles (e.g. hashing them, or a documented `style.create` path). Prove with a test that an authored `style="…"` either renders under the CSP or fails the build with a diagnostic. SPEC §13.1.

- [ ] **C2 — A §9.2 failure re-render (422 validation or declared error) blanks every field the user typed, and the framework gives the app no channel to repopulate them on the no-JS path.** (low, framework; found by `t5-errors`)
  - Observed behavior: filling the starter's add-contact form with a duplicate email and submitting returns `422` and re-renders the region with the `DUPLICATE_EMAIL` message correct, but **both** transports (no-JS full re-render and the enhanced fragment) wipe the user's `name`/`email`/`company` entries.
  - Root cause: `packages/server/src/forms-types.ts:25-27` types `ComponentMutationFormState` as **failure-only**; `component-render.ts:113-129` and `jsx-runtime.ts:707` thread only `failure` into the form slot — there is no submitted-input field to echo back into `value=`. (Per the verifier: SPEC §9.2:908-914 only promises the same render function plus `forms.<mutation>.failure`, never input preservation, so this is a feature/ergonomics gap, not a §9.2 violation.)
  - Why it matters: losing a filled form on any validation/declared error is the classic form papercut, and Kovo's "same component render function" §9.2 model makes it structurally unfixable in app code on the no-JS path (no hook exposes the rejected input).
  - Repro evidence: `t5-errors` — duplicate-email submit → 422 with the error shown but all fields blank, on both the no-JS and enhanced paths.
  - Acceptance: the failure render slot (or a documented hook) exposes the rejected submitted values so the app can repopulate `value=`/`defaultValue`, preserving input across a 422 on the no-JS path. SPEC §9.2.

## Refuted / Not Carried Forward

- **t3-file-3 — "`createStorageDownloadEndpoint` scope callback receives only the raw Request, not the session"** — refuted as expected/by-design. The download endpoint is a raw `endpoint()` whose request is session- and cookie-neutralized **by construction** (`endpoint.ts:180,:253-291`; `bugz-3` L16, SPEC §9.1), so making the scope callback session-aware would weaken an existing security invariant; capability-URL IDOR defense is the signed scope, not the session. Recorded as a correctly-designed asymmetry.

## Latest Verification

- **A1/A2 (fixed):** `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts packages/compiler/src/vite.test.ts --reporter=dot` passes; `t4-islands` `pnpm run build:prod` now fails closed with the authored-client-island diagnostic instead of emitting inert production markup.
- **A3/A4 (fixed):** inline runtime focused suites pass; `kovoDeferredRuntimeModuleSource` contains `BroadcastChannel`, `kovo:mutation-response`, and `visibilitychange`.
- **bugz-15 B1 (self-verified, clean base, prod):** sign-in sets `__Host-better-auth.session_token`; `GET /` with that jar → `303 /login`; resending under the bare name → `200` "Demo User".
- **B1/B2, C1/C2:** independently reproduced by the track verifiers and source-confirmed (`core/src/storage.ts:44-49`, `server/src/app-load-shed.ts:43,181-197`, `server/src/csp.ts:279`, `server/src/document-core.ts:423`, `server/src/forms-types.ts:25-27`).
- Baseline: a fresh default scaffold passes `pnpm run check` and the enhanced add-contact success path refreshes the DOM (bugz-14 B2 confirmed fixed). Monorepo repaired; transitive deps resolve. Throwaway apps under `/Users/mini/kovo-dogfood-pg6-20260629/` (+ `-pg6-base`) safe to delete.

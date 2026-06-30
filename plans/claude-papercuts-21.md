# Breadth Surfaces Papercuts 21

Created 2026-06-30. Source of truth remains `SPEC.md`. Papercuts found while dogfooding the advanced
surfaces OTHER than durable tasks (L3 optimistic / L4 Live, MPA / `<Defer>` / typed reads, auth &
access, files / endpoints / webhooks). Confirmed security/soundness defects are in
`plans/claude-bugz-23.md` (B1 query-loader read-set erasure IDOR, B2 silent SSR truncation, B3 non-store
MIME bypass, B4 webhook write-audit under-report).

**Meta-theme:** these surfaces are now HEAVILY hardened — the great majority of prior ledger items
verified genuinely fixed (see "Verified fixed" below). The survivors are a single `<Defer>` streaming
regression, a multi-node liveness gap, and a few diagnostic/protocol edges. Highest-signal positive
result: **L4 Live is now implemented**, the **enhanced-mutation success body now renders** (the
bugz-14→16→17 recurring regression is closed), and **`<Defer>` streaming/isolation/timeout all work**.

## Scope

Seven fresh SQLite `create-kovo` starters linked to the local monorepo, on the production node-preset
artifact. Bar for a finding: a new edge, a REGRESSION of an `[x]`-fixed item, or a residual a prior fix
didn't close (each cites the prior id). Root causes confirmed first-hand in source; runtime symptoms
reproduced by an independent skeptical verifier with positive controls.

## Issues

### A. MPA / `<Defer>` streaming

- [ ] **A1 — Nested `<Defer>` (a `<Defer>` rendered inside another `<Defer>`'s deferred output) is stranded on its fallback forever in the prod streaming path — green build, infinite spinner, no fragment/error/timeout.** (med, framework; found by `mpa-defer`, verified independently; REGRESSION of `papercuts-super-10` A1)
  - Observed behavior: `GET /probe/nested` (outer ~300ms, inner `<Defer>` +~300ms) returns 200 but the stream CLOSES after only the outer settles (`total≈0.31s`, would be ~0.6s if the inner were awaited). The body ends with the inner placeholder `<kovo-defer target="inner-region" state="pending">` as the last word — no inner fragment, no error, no timeout. Single-`<Defer>` control works (`total≈2.0s`, delivered).
  - Root cause: `packages/server/src/document-core.ts:530` — `deferredChunkPromises` returns `chunks.map((chunk) => Promise.resolve(chunk))`. The `.map()` creates a NEW array that (a) no longer aliases the collector's **live** `chunks` array (`packages/server/src/deferred-region.ts:119-133`, where `add()` pushes nested regions and `pendingChunks()` returns that same live array) and (b) drops the `deferredStreamInitialChunkCount` symbol. `streamDeferredChunks` (`packages/server/src/deferred-stream.ts:170,182,194`) is built to drain newly-pushed nested chunks via `collectPending(options.chunks.length)` after each settle, but `options.chunks` is the frozen-length snapshot, so the drain never grows and the symbol-based initial count is lost. The buffered path is never taken for real `<Defer>` (chunks are promises → streaming path always selected), so every nested `<Defer>` strands.
  - Why it matters: nested `<Defer>` is a documented SPEC §8 primitive; the build is green but the inner region is a permanent spinner. The framework's own comments (`deferred-region.ts pendingChunks`, `deferred-stream.ts collectPending`) claim nested regions "are not stranded"; the `document-core.ts:530` snapshot defeats exactly that contract. The prior fix (commit `ba664a4cd`) only touched `deferred-region.ts`/`deferred-stream.ts` and its test awaits the outer render synchronously so the inner is pre-registered before the snapshot — it never exercises the real streaming path.
  - Repro evidence: `GET /probe/nested` → `INNER DONE`=0, `inner-region state="pending"`=1, stream terminates with the boundary right after the outer fragment; `/probe/stream` (single Defer) control delivers.
  - Acceptance: `document-core.ts:530` forwards the live collector array + the `deferredStreamInitialChunkCount` symbol (not a `.map()` snapshot), so a nested `<Defer>` resolves/streams; add a test that defers the OUTER render (real streaming path), not just a synchronously-awaited outer.

### B. Liveness (§9.3)

- [ ] **B1 — The `<meta name="kovo-session">` BroadcastChannel principal fingerprint is salted with a per-process `randomBytes(32)`, so same-user multi-tab sync silently no-ops across nodes / restarts.** (med, framework; found by `live-sse`, verified independently)
  - Observed behavior: the fingerprint that drives the §9.3 cross-principal discard is `HMAC(sessionId, perProcessRandomSecret)`. The SAME `demo@example.com` session produced different `kovo-session` meta values across a restart and across separate processes (confound-free: the same fixed session-id hashed in 3 node processes gave 3 distinct fingerprints). The client discards `data.principal !== sfp` (`broadcast.ts:147`), so same-user broadcasts are rejected across processes.
  - Root cause: `packages/server/src/app-document.ts:314` `const broadcastFingerprintSecret = randomBytes(32);` is a module-level (per-process) salt keying `hmacSessionFingerprint` (`316-318`), never derived from a stable deployment secret. The sibling §9.3 sink — the live-target attestation — was moved onto the stable CSRF signing secret (`mutation-wire.ts:526`, the `bugz-4` M8 fix), but the fingerprint was not — an internally inconsistent oversight.
  - Why it matters: SPEC §9.3 + the live-queries guide advertise "same-user multi-tab sync at zero server cost." In any horizontally-scaled deployment, or across a restart, that feature silently does nothing because the fingerprints never match. Fail-SAFE (only false-rejects, never a cross-principal accept → no disclosure) and works single-node, hence a liveness papercut not a security escalation.
  - Repro evidence: same demo login across a prod-server restart yields different `<meta name="kovo-session">` content; source `app-document.ts:314` (per-process `randomBytes`) vs `mutation-wire.ts:526` (stable CSRF secret for the sibling sink).
  - Acceptance: derive the fingerprint HMAC key from the stable CSRF/signing secret (like the live-target attestation), so it is principal-stable across the deployment while staying opaque.

### C. Files / capabilities

- [ ] **C1 — Route `ctx.signUrl` silently drops the download endpoint's `scope`, so a scoped (per-tenant) `createStorageDownloadEndpoint` + auto `ctx.signUrl` always 404s.** (med, framework; found by `files-capability`, verified independently)
  - Observed behavior: `createStorageDownloadEndpoint({ scope })` accepts a request-derived scope and the verify sink re-derives + checks it, but the captured `StorageDownloadEndpointInfo` is only `{ basePath, oneTimeReplayStore, secret }` — scope is not captured. The auto signer is built with no `defaultScope`, so `ctx.signUrl({key})` mints `scope=undefined`; `verifyCapability` requires `(claims.scope??'') === (expected.scope??'')`, so `'' vs tenant` → reason-free 404. Verified: scoped endpoint + auto signer → 404; explicit `scope` or unscoped endpoint → 200.
  - Root cause: `packages/server/src/capability-route.ts:381-389` omits `scope` from `StorageDownloadEndpointInfo`; `packages/server/src/app-document.ts:65-69` invokes `createSignUrl` with no `defaultScope`. The `app-document.ts:57-59` comment promises the route signer matches the verify sink "otherwise the documented pairing fails closed as an opaque 404" — yet it drops scope.
  - Why it matters: `scope` is the documented per-tenant binding that stops a leaked capability URL from being replayed cross-principal — the recommended multi-tenant IDOR defense. Every URL `ctx.signUrl` mints against a scoped endpoint is dead, with no diagnostic (the route is a deliberately reason-free 404 oracle). Fails CLOSED (over-restrictive), so not a bypass — but the documented pairing is broken by default. (Same `signUrl`-vs-verify-sink family as `papercuts-18` B1 / `papercuts-7` B, both now fixed; scope is the last unthreaded claim.)
  - Repro evidence: scoped `createStorageDownloadEndpoint` + auto `ctx.signUrl({key})` → 404; with explicit `scope` → 200; unscoped endpoint + same auto URL → 200.
  - Acceptance: capture `scope` into `StorageDownloadEndpointInfo` and thread it into `createSignUrl`'s `defaultScope`, so the auto `ctx.signUrl` for a scoped endpoint verifies; or diagnose the unthreaded-scope pairing.

### D. Endpoints

- [ ] **D1 — On the documented default config, a thrown route/endpoint/mutation/query handler produces a silent 500 — nothing on stdout/stderr.** (low, framework; found by `endpoints-webhooks`, verified independently; residual of `papercuts-super-10` D1)
  - Observed behavior: `endpoint('/api/boom', { handler: () => { throw new Error('boom') } })` returns `500 {"code":"SERVER_ERROR","payload":{}}` but the prod server log contains only the "listening" line — no error, no stack.
  - Root cause: handler exceptions are caught in `packages/server/src/app-request.ts:71-93` and routed through `reportServerError(app.onError, …)`; `packages/server/src/diagnostics.ts:42-47` begins `if (!onError) return;` with no default stderr fallback. The super-10 D1 fix only added `logUnhandledNodeError` at the node `createServer` boundary (`build.ts:931,945-953`) for errors that ESCAPE the framework handler — framework-caught handler throws never reach it. The create-kovo starter passes no `onError`.
  - Why it matters: the exact super-10 D1 symptom ("a deployed app emits nothing to stdout/stderr on a 500") still reproduces for the most common 500 cause (a thrown handler); the fix closed only the transport-boundary subset. The response body is correctly stable (SPEC §9.2 satisfied) — purely an observability completeness gap.
  - Repro evidence: throwing json endpoint → 500 `SERVER_ERROR`; server log shows only "listening". Source `app-request.ts:71-93` → `diagnostics.ts:42-47` (`if (!onError) return`); starter `createApp` wires no `onError`.
  - Acceptance: a default-config thrown handler logs to stderr (a framework default `onError`, or a `reportServerError` stderr fallback), so deployed apps are not silent on their most common 500.

- [ ] **D2 — `HEAD` on a GET `endpoint()` returns 405, though routes and `/_q/` auto-allow HEAD.** (low, framework; found by `endpoints-webhooks`, verified independently; variant beyond `papercuts-super-7` D1)
  - Observed behavior: `HEAD /api/health` → `405` with `allow: GET`, even though `GET /api/health` → 200. Routes (`HEAD /` works) and the query channel both serve HEAD.
  - Root cause: `packages/server/src/shell.ts:226-229` `endpointAllowedMethods` returns only `[endpoint.method]` (`['GET']`) with no HEAD synthesis, so `shell.ts:177-194` marks HEAD as method-not-allowed. Routes auto-include HEAD (`shell.ts:207`) and query dispatch auto-includes HEAD (`app-dispatch.ts:45-50`); endpoints do not, and the public `endpoint()` surface exposes no `allowedMethods` knob (only `method`).
  - Why it matters: RFC 9110 §9.3.2 — a GET-supporting resource SHOULD support HEAD; health checks / load balancers / uptime monitors routinely probe with HEAD and get 405 against a Kovo endpoint. Variant beyond super-7 D1 (which fixed wrong-method 404→405 — verified in place — but not HEAD synthesis). (Honest tension: §9.1 stresses "explicit method, no implicit any-method", so a maintainer could WONTFIX; but the universal HEAD support elsewhere + no author opt-in makes it an inconsistency.)
  - Repro evidence: `curl -I /api/health` → 405 `allow: GET`; `HEAD /` (route) allowed; `POST /api/health` → 405 (super-7 D1 fix verified present).
  - Acceptance: a GET `endpoint()` auto-allows HEAD (like routes / `/_q/` / the framework's own storage download endpoint), or exposes an `allowedMethods` opt-in.

## Refuted / Not Carried Forward

The encouraging part — most prior ledger items verified GENUINELY FIXED in the current prod artifact:

- **opt-derive-1 (refuted):** "prod ships no L3 optimism runtime" — `contacts-region` is a FRAGMENT target, and SPEC §8:442 mandates "fragment = 1 RTT, no optimistic update"; the query update is soundly covered by the fragment refresh (morph). The only residual (KV310 green-certifying the inert author transform without warning) is exactly `papercuts-super-5` C1 (already filed `[x]`, by-design no-op), not a new soundness gap.
- **files F3 (refuted):** array-of-files `schemaMaxUploadBytes` under-count — not reproduced / expected.
- **Verified FIXED (refutations of prior items):**
  - Enhanced-mutation SUCCESS body now ships a `<kovo-fragment>` rendering the new row — the recurring `bugz-14 B2 → bugz-16 B1 → bugz-17 B2` regression is CLOSED (with faithful `Kovo-Live-Targets` headers; the empty body only reproduces when that header is omitted — a curl artifact).
  - **L4 Live (SSE) is now implemented** (`super-1 D1` was "entirely unimplemented"); BroadcastChannel rebroadcast + refetch-on-focus now work (`super-6 A3/A4`, `super-7 B1`).
  - `<Defer>` is STREAMED not buffered, with per-region error ISOLATION and per-region TIMEOUT (`super-8 D1/D2/D3` all fixed); view transitions, scroll restoration, prefetch speculation rules (`super-7 C1/C2`, `super-1 F4`).
  - §9.4 cache relaxation now gates on a session-independence proof, not the `publicAccess()` assertion (`bugz-17 B1` / `super-1 F6` — no cross-principal disclosure reproduced); required `/_q` param missing → 422 not 500 (`super-1 F2`); query output/computed/aggregate/RQB-relation shapes (`super-5 A1/A2/A3/B2`).
  - Write-side owner-scope: owner INSERT/IDOR builds correctly gated (`super-4 C1`, `bugz-8/14`); prod `__Host-` cookie login works (`bugz-15`).
  - Storage: a `delete` verb exists (`super-6 B1`); download endpoint is buildable (`super-2 A1`); `ctx.signUrl` threads secret + basePath (`papercuts-18 B1`, `papercuts-7 B`); multipart enctype emitted (`super-2 A3`); storage path-traversal not reproduced.
  - Endpoints/webhooks: webhook build gate accepts correct webhooks + idempotency double-exec closed (`super-2 B`, `bugz H8/H9`); wrong-method → 405+Allow and thrown json endpoint → JSON 500 (`super-7 D1/D3`); endpoint CSRF posture (JSON-body token / exempt-rides-cookie) not reproduced.

## Latest Verification

- Fresh SQLite baseline `check` (11.7s) / `build:prod` (16s) green.
- First-hand: `auth-access-1` (bugz B1) isolation flip — inline `context!.db!` → green/no-KV414; `: Reader<AppDb>` annotation → `KV414 (IDOR)` + `KV407` RED.
- Source confirmations: `document-core.ts:530` (A1), `app-document.ts:314` vs `mutation-wire.ts:526` (B1), `capability-route.ts:381-389` + `app-document.ts:65-69` (C1), `app-request.ts:71-93` + `diagnostics.ts:42-47` (D1), `shell.ts:226-229` (D2). Runtime symptoms reproduced by independent verifiers with positive controls.
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md` ledgers; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-breadth/` — safe to delete (do not re-run `pnpm install` in them without isolation).

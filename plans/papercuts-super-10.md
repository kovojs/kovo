# Papercuts Super 10

Created 2026-06-30. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with six tracks (a prod-artifact regression
sweep, raw-SQL gating depth, `<Defer>` streaming, rate-limiting/abuse, the type-level-security
boundary, and transaction integrity), each authored as a real app and adversarially verified.
This run applied the updated playbook: drive the **deployed artifact** through a real browser,
cross every feature against the posture matrix, adversarially probe each gate on its alternate
constructions, and **report anything that still reproduces regardless of prior mention**.

**Meta-theme — the security/soundness floor is opt-in or bypassable**, escalated to `bugz-21`
(5 items): an SSR XSS via a substring-keyed validator gate (B1); the raw-SQL trust waiver
defeated by a local name-shadow (B2); mutations non-atomic by default (B3); a rate limiter that
collapses to one shared bucket → app-wide DoS (B4); and the raw-SQL `tables:` runtime
enforcement that never shipped to production (B5). The papercuts below are the lower-stakes
residue: nested `<Defer>` never streams (§A), the load-shed has no slowloris/concurrency bound
(§B), bulk inserts can't express per-row `serverValue()` (§C), and the prod server swallows all
errors with no logging (§D).

## Scope

- Apps: six fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local to
  the monorepo, under `/Users/mini/kovo-dogfood-pg10-20260629/` (+ `/Users/mini/kovo-dogfood-pg10-base`).
  Gates per app: `pnpm run check`, `tsc --noEmit`, `vp test`, `build:prod`, plus **prod-artifact**
  (`node dist/server/server.mjs`) HTTP + Playwright drives.
- Regression sweep result: the recent fixes mostly hold in the prod artifact — raw-SQL **static**
  gates (KV406/KV414/KV438) fire, island deploy via a retention preset works, prod success body /
  cache-leak / auth-cookie are fixed. Two recent fixes are **incomplete at the artifact layer** and
  filed in `bugz-21` (B2 static bypass, B5 runtime enforcement missing). Throwaway apps are safe to
  delete; do **not** re-run `pnpm install` in them without isolation.

## Issues

### A. `<Defer>` streaming

- [ ] **A1 — A nested `<Defer>` (a `<Defer>` rendered inside another `<Defer>`'s output) never streams: the inner region is stranded on its fallback placeholder forever — no fragment, no error, no timeout.** (med, framework; found by `t3-defer-streaming`)
  - Observed behavior: prod artifact, chunked `GET /defer`. An outer `<Defer priority="after-paint">` whose render returns JSX containing an inner `<Defer>` — the outer streams, but the inner region's placeholder is never replaced (its chunk never arrives), indefinitely.
  - Root cause: `packages/server/src/route.ts:1168-1169` snapshots `await render(result.value)` then collects `deferredRegions.pendingChunks()`, and `packages/server/src/deferred-region.ts:120-124` `pendingChunks()` returns `[...chunks]` — the chunk set captured at the top level only. A `<Defer>` discovered _while rendering_ a deferred region is registered after the snapshot, so its chunk is never collected or streamed.
  - Why it matters: SPEC §8:809 frames `<Defer>` as out-of-order streaming for expensive/independent subtrees; nesting them (a common composition — a deferred panel containing a deferred sub-list) silently strands the inner content. (Distinct from the `super-8` D1/D2/D3 top-level streaming/isolation/timeout items — this is the nesting case.)
  - Repro evidence: `t3-defer-streaming` — outer `<Defer>` containing an inner `<Defer>`; the inner placeholder never resolves in the streamed response. Source: `route.ts:1168-1169`, `deferred-region.ts:120-124`.
  - Acceptance: nested `<Defer>` regions discovered during a deferred render are collected and streamed (drain until no pending chunks remain). Prove with a streaming test asserting the inner region's content arrives. SPEC §8.

### B. Abuse / DoS hardening (pairs with `bugz-21` B4)

- [ ] **B1 — The §9.5 pre-dispatch load-shed covers only content-length `413` and post-header rate `429`; it imposes no bound on concurrent in-flight connections or slow body transfer, and the node preset sets no `maxConnections`/`headersTimeout`/`requestTimeout` — a slowloris-style trickle pins connections.** (med, framework; found by `t4-rate-limit`)
  - Observed behavior: 60 concurrent raw TCP connections each sending `POST /_m/add-contact … Content-Length: 1000000` then only 2 body bytes (and trickling nothing) — all 60 are accepted and held open indefinitely; the server pins those connections/workers with no timeout or connection cap.
  - Root cause: `packages/server/src/app-load-shed.ts:118-140` (load-shed = 413 + 429 only) reads `Content-Length` pre-body (`:200-206`) but never bounds slow/partial transfer; `packages/server/src/build.ts:759-776` / `dist/server/server.mjs` `createServer` sets no `maxConnections`, `headersTimeout`, or `requestTimeout`.
  - Why it matters: the request-shell load-shed is the framework's stated abuse defense, but it only guards declared-oversize and request-rate, leaving the classic slowloris / connection-exhaustion vector open by default. (The verifier kept this a hardening papercut rather than a `bugz`; it pairs with the `bugz-21` B4 rate-limit collapse.)
  - Repro evidence: `t4-rate-limit` — 60 trickling connections all held open. Source: `app-load-shed.ts:118-140,200-206`, `build.ts:759-776`.
  - Acceptance: the node preset sets sane `headersTimeout`/`requestTimeout` (and optionally `maxConnections`), and/or the load-shed bounds slow-transfer connections. SPEC §9.5.

### C. Write ergonomics

- [x] **C1 — KV438 does not see per-element `serverValue()` inside a bulk `insert().values([…])` array: a bulk insert of server-generated ids is blocked unless you wrap the WHOLE array, which over-broadly blesses every column of every row.** (med, framework; found by `t6-transactions`)
  - Observed behavior: a bulk `db.insert(contacts).values([{ id: serverValue(...), … }, …])` fails `build:prod` with `KV438 WRITE … column=id via=values provenance=unknown` — the per-element `serverValue()` provenance is not recognized; the only way to pass is to bless the entire `.values([...])` argument, which then over-broadly governs every column of every row.
  - Root cause: `packages/drizzle/src/static/derivation.ts:1374` `massAssignmentFactsForPayload` routes a non-`ObjectLiteral` `.values()` argument (an array literal) to `spreadMassAssignmentFacts` (`:1477`), which governs the whole spread rather than descending into each element's `serverValue()` provenance.
  - Why it matters: bulk inserts with server-generated ids/timestamps are a normal pattern; the author is forced to choose between a build error and an over-broad blanket bless that defeats the point of per-column mass-assignment governance.
  - Repro evidence: `t6-transactions` probe — bulk `insert().values([{id: serverValue()}])` → KV438; wrapping the whole array passes but over-governs. Source: `derivation.ts:1374,1477`.
  - Acceptance: KV438 descends into each element of a `.values([...])` array literal and honors per-element `serverValue()` provenance. SPEC §10.3:1215.
  - Evidence: `pnpm exec vitest --run packages/drizzle/src/index.mass-assignment.test.ts` passes with positive bulk-array `serverValue()` coverage and negative unsafe governed-field coverage.

### D. Observability

- [ ] **D1 — The production node server swallows ALL handler/transport errors in an empty `catch {}` with no logging, returning a bare `Internal Server Error` body — a deployed app emits nothing to stdout/stderr on a 500.** (low, framework; found by `t6-transactions`)
  - Observed behavior: every 500 from the prod artifact (e.g. a throwing handler) returns the bare text `Internal Server Error` and writes **nothing** to the server's stdout/stderr — the operator has no signal, stack, or correlation id.
  - Root cause: `packages/server/src/build.ts:767` — the node server source wraps dispatch in an empty `catch {` that writes the 500 response but never logs the error; emitted to `dist/server/server.mjs` in the prod artifact.
  - Why it matters: a production server that logs nothing on errors is operationally blind — every 500 (including the `bugz-21` B3 partial-write and any handler bug) is invisible to logs/APM, making incidents undiagnosable. (Compounds `super-7` B3, the dev render-error swallow; this is the prod path with zero logging.)
  - Repro evidence: `t6-transactions` — a 500 from the prod artifact produces no stderr output. Source: `build.ts:767`.
  - Acceptance: the prod node server logs unhandled errors (stack + request context) to stderr by default (and/or routes through a configurable `onError`/logger). SPEC §9.5.1.

## Refuted / Not Carried Forward

- **t6-2 — "a transaction whose callback throws is an unauthenticated DoS / production crash"** — refuted: not reproducible across ~1300 HTTP requests / ~390 transaction throws; the error path is handled (a 500), not a crash. (The genuine defect in this area is the _non-atomic default handler_, `bugz-21` B3.)
- **t6-5 — "empty-array bulk insert `insert().values([])` surfaces as an opaque error"** — expected behavior, not a framework defect: drizzle intentionally rejects `.values([])`, and the app calls drizzle directly.
- **rawsql-2 — "the raw-SQL gate collapses to an unvalidated `trustedSql` attestation (justification only checked non-empty)"** — recorded as by-design but weak (`runtime.ts:177-185` validates only `justification.trim()` non-empty; `static.ts:1954-1979` waives KV414/KV438 on trust). Not filed as a standalone defect, but it is the third leg of the `bugz-21` B2+B5 "raw-SQL gate has no sound floor" thread — a content-unvalidated attestation, name-shadow-bypassable static gate, and absent runtime enforcement together leave `trustedSql` writes unaudited.

## Latest Verification

- **bugz-21 B1 (self-verified, prod):** app `.ts` helper importing `@kovojs/server/internal/html` → green build (no KV235), served `/` HTML carries raw unescaped `<img onerror>` (1 hit, 0 escaped); `vite.ts:551` substring gate confirmed.
- **A1, B1, C1, D1:** independently reproduced by the track verifiers and source-confirmed (`route.ts:1168-1169`/`deferred-region.ts:120-124`; `app-load-shed.ts:118-140`/`build.ts:759-776`; `derivation.ts:1374,1477`; `build.ts:767`).
- Baseline: clean `main`, fresh scaffold passes `pnpm run check`. Monorepo repaired; transitive deps resolve. Throwaway apps under `/Users/mini/kovo-dogfood-pg10-20260629/` (+ `-pg10-base`) safe to delete.

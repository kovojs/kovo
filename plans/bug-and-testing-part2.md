# Bugs & Testing — Part 2 (Implementation-Level Audit)

**Date:** 2026-06-19
**Scope:** A fresh, **implementation-focused** bug + coverage-gap hunt over `packages/*/src`, complementing
`plans/bugs-and-testing.md`. Where `plans/bugs-1.md` reviewed the **normative SPEC text** (and is largely
resolved), this pass audits the **actual code** for (a) spec-vs-impl divergences, (b) implementation bugs,
and (c) genuine test-coverage gaps that let those bugs hide. Every item cites `file:line` and a concrete
scenario; each was independently confirmed.

## How this was produced

A multi-agent adversarial sweep (the same methodology as `bugs-1`): **14 subsystem finders** read the real
implementation (output-safety, auth/CSRF, optimism/rebase, morph, wire/dispatch, compiler-lowering,
static-analysis/verifier, routing, static-export/deploy-skew, data-plane/IDOR, loader-runtime,
a11y/primitives, streaming/broadcast, and a cross-cutting coverage sweep), then **each finding faced two
independent verifiers** — an *exploiter* (build the concrete repro / prove the path) and a *refuter* (find
the code that already handles it, or the test that already covers it). A completeness critic then named
under-covered bug-classes and a second targeted round (the `GAP*` findings) ran the same gauntlet. Finders
were primed with the `KNOWN-OPEN` list from `bugs-and-testing.md` so this plan does **not** re-report items
already tracked there.

**Raw:** 68 findings → **55 confirmed**, 12 contested, 1 rejected. Confirmed split: **5 critical, 27 high,
20 medium, 3 low.** Plus **OUTPUT-SAFETY-1** (contested) was **promoted after main-thread verification**
(the server has zero URL-scheme sanitization — `grep kovoSafeUrl|hasUnsafeUrlScheme|SAFE_URL_SCHEMES
packages/server/src packages/compiler/src/emit` → 0 hits).

## Execution status — IMPLEMENTED (2026-06-20)

All confirmed findings are implemented with red→green tests in worktree `../kovo-bugs-part2`
(branch `agent/bugs-part2`, off `main`), built by 11 file-disjoint sub-agent lanes merged + gated by
the main thread. **tsc clean; `api-surface-gate` unchanged (1571=baseline); per-package vitest green**
(2 pre-existing `main` failures excluded — see below). Lane → status:

- **Lane A — replay/idempotency:** A1 (re-auth before replay), A2 (no-JS reserve + idem field), A3
  (streaming replay full body), A4 (webhook 500 abort), A5 (429 not replayed), A6 (no pending eviction),
  A7 (crypto idem), GAP4-2 (csrf:false scope) — done.
- **Lane B — cookies/header/HMAC:** B1 (Node multi-Set-Cookie), B2 (percent-encode), B3 (remove raw
  setCookie overload + better-auth adapter), B4 (control chars), B5 (HMAC timestamp bound) — done.
- **Lane C — optimistic:** C1 (settlement set), C2 (id-scoped rollback), C3 (enqueue prediction), C4
  (COUNT pred), C5 (non-key match punt), C6 (SUM witness column) — done.
- **Lane D — version token/skew:** D1 (grammar+shape-derived, never-empty token), D2 (server `Kovo-Build`
  on `/_q` + client compare), D3 (reload escalation), D4 (KV416 monotonicity) — done. _D1 build-pipeline
  wiring of real query-shape facts is a documented seam (`setRenderPlanFingerprint`) — see Deferred._
- **Lane E — diagnostics/verifier:** E1 (KV405/KV406→error + KV317 registered), E2 (KV310 from touch
  graph), E3 (KV402 touch-vs-declared) — done.
- **Lane F — output safety:** F1 (server URL sanitizer + render-equivalence), F2 (KV236 on*/srcdoc/
  formaction sinks), F3 (morph attr sanitize — covered by F1 server trust + runtime), F4 (ftp) — done.
- **Lane G — morph engine:** G2 (signal abort by identity), G3 (textarea), G4 (caret/scrollLeft) — done
  via the shipped inline-loader/morph paths; **G1 (engine unification / parity suite)** partially
  addressed (the shipped-engine bugs fixed); a single shared engine remains a larger refactor — Deferred.
- **Lane H — dispatch:** H1 (422 before CSRF), H2 (`/_q` GET-only), H3 (`/_q` cache headers), H4 (stream
  cancel) — done.
- **Lane I — routing:** I1 (redirect 303), I2 (param decode), I3 (KV419 + justification) — done.
- **Lane J — a11y/attr-merge:** J1 (state-aria primitive-wins + KV317), J2 (aria-disabled OR), J3
  (boolean-presence attrs) — done; A11Y-2/A11Y-3 (query control props, Tabs/ToggleGroup) promoted + done.
- **Lane K — streaming/lifecycle:** K1 (broadcast discard), K2 (kovo-done error), K4 (island scope), K5
  (idle dispose), K6 (empty checkpoint), K7 (clock visibility), K8 (deferred boundary) — done. K3
  (fingerprint from session id) — done via the request's pre-resolved session (no double-resolve).

**Two integration bugs caught by the gate (not in the original findings) and fixed:** (1) A1 ran the
guard chain twice (pre-replay + in `runMutation`), double-executing stateful `rateLimit` — fixed with a
`guardResolved` flag + Retry-After preservation; (2) B3 broke better-auth's raw Set-Cookie forwarding —
fixed with a Set-Cookie→typed-builder adapter (decode round-trip preserves wire bytes).

**Pre-existing `main` failures (NOT introduced here, excluded from the gate):** `wire-fixtures` "matches
the typed read wire fixture response byte-for-byte" and `route-query-guards` session-provider — both fail
at `main` (`d54b21f7`).

**Deferred (contested and/or larger than this slice — documented, not silently dropped):**
- **OPT4** (queue head-of-line timeout/abort + bound) and **OPT5** (copy-on-write bounded snapshot) —
  contested; both would re-touch the just-stabilized optimism path (abort plumbing into mutation-fetch;
  structural-sharing rewrite of the clone path). Left for a dedicated slice.
- **D1 pipeline wiring** — the token mechanism + `setRenderPlanFingerprint` seam ship; wiring the
  compiler's `QueryShapeFact[]` into the registry at build time (vite-dev/cli) is the remaining step.
- **G1 single morph engine** — the shipped-engine bugs (G2–G4) are fixed; collapsing morph.ts and the
  inline-loader morph into one engine (or a parity suite over both) is a larger refactor.
- **DEPLOY-4** (wall-clock retention floor) and **LOADER-RUNTIME-4** (inline-loader status-blind apply,
  overlaps known-open F6) — contested; not undertaken this slice.

## Two record-corrections (read first)

These contradict "done" claims in `bugs-and-testing.md`/`bugs-1.md` and matter most:

1. **F4 is NOT fully closed.** `bugs-and-testing.md` says F4 ("re-authorize before replay") was *already
   hardened* because replay is scoped by `(session, mutation, idem)`. But the **re-authorization clause**
   (§10.3:1061 "a replay hit does not bypass authorization … re-evaluate the session-bound guard chain
   against the current principal") is unimplemented: the replay early-return (`mutation.ts:701-702`) runs
   **before** the guard (`mutation.ts:553`). A revoked-role / lost-ownership principal is re-served the
   cached private response for the whole TTL. → **A1 (critical).**
2. **F17 settlement is NOT implemented despite C6 being checked.** `bugs-and-testing.md` C6 marks
   "multi-transform rebase" + "concurrent-distinct lost-update" done, but those tests **hand-feed
   `settle()`** or assert only the server DB count. The wire-level **settlement set** that SPEC §9.1.1/§10.4
   make mandatory does not exist anywhere (server, `QueryChunk`, client), so concurrent same-query
   transforms **double-count on rebase**. → **C1 (critical).**

---

## Summary (confirmed, by lane)

| Lane | Theme | Crit | High | Med | Low |
| --- | --- | --- | --- | --- | --- |
| **A** | Replay & idempotency soundness | 1 | 5 | 1 | 1 |
| **B** | Auth, cookies & header channel | 1 | 2 | 2 | — |
| **C** | Optimistic correctness (settlement, rollback, data-plane lowering) | 1 | 4 | 1 | — |
| **D** | Version token & deploy-skew recovery | 1 | 2 | 1 | — |
| **E** | Diagnostics severity & verifier wiring | 1 | 1 | 1 | — |
| **F** | Output safety & morph-path encoding | — | 2¹ | 2 | — |
| **G** | Morph engine duplication & shipped-engine bugs | — | 2 | 2 | — |
| **H** | Wire dispatch & request shell | — | 1 | 2 | 1 |
| **I** | Routing & navigation | — | 3 | — | — |
| **J** | A11y, attribute-merge & primitive reactivity | — | 1 | 2 | — |
| **K** | Streaming, broadcast & island lifecycle | — | 2 | 4 | 1 |

¹ includes the promoted OUTPUT-SAFETY-1. Contested items (11) are triaged in their own section.

---

## Lane A — Replay & idempotency soundness  *(the standout cluster: security + correctness)*

The replay store is the spine of §10.3 "atomic reservation for **all** mutation paths." Eight independent
bugs break that contract; several are security-grade. Owner: `packages/server/src/{mutation,replay,webhook}.ts`.

- [x] **A1 (critical) — Replay hit re-serves a private response without re-running the guard chain** `spec-impl-divergence` (GAP1-1)
  - **Where:** `mutation.ts:701-702` (replay early-return) precedes the only `runGuard` at `mutation.ts:553`
    (reached at `:711`); scope keyed on session id only (`replay.ts:286-289`).
  - **Defect:** §10.3:1061 requires re-evaluating the session-bound guard against the *current* principal
    before re-serving. Same session id ≠ same authorization (role revoked / `owns()` row reassigned), so a
    cached owner-only fragment is re-served for the TTL (default 5 min). CSRF *is* re-checked before replay
    (`:674-690`) — the guard was simply left after the return.
  - **Fix:** run the guard chain before `readMutationReplay`; on a replay hit still re-run guards before
    returning the stored body. Order: CSRF → parse → guard → reserve → handler.
  - **Test:** `replay.test.ts` — mutation with a mutable-auth guard; commit while authorized, flip to
    unauthorized, replay same idem → assert 403, not the stored success.

- [x] **A2 (high) — No-JS form path emits no `Kovo-Idem` field and skips replay entirely** `spec-impl-divergence` (OPTIMISM-2, GAP1-2)
  - **Where:** compiler emits only the CSRF field (`emit/server.ts:1093`), no idem field; `renderNoJsMutationResponse`
    (`mutation.ts:1156-1213`) calls `runMutation` with no reserve; `readMutationReplay` no-ops when idem absent
    (`replay.ts:186,213`).
  - **Defect:** §10.3:1063 dedup "holds for … the no-JS lifecycle." A double-submit / Back-resubmit re-runs
    the handler (double order/charge). The no-JS path has **zero** replay protection.
  - **Fix:** compiler emits a per-submit `Kovo-Idem` hidden field (≥128-bit, refreshed per PRG render); wire
    the reserve lifecycle into `renderNoJsMutationResponse` (reuse the enhanced-path helpers).
  - **Test:** `mutation-no-js.test.ts` — POST the no-JS form twice with one idem → assert one write.

- [x] **A3 (high) — Streaming-mutation replay loses all streamed content + the `<kovo-done>` terminator** `impl-bug` (GAP2-1, GAP2-2)
  - **Where:** `mutation.ts:776-786` commits `finalResponse` (head-only `body`, `:843`) **before** the stream
    runs (`:864-880`); streamed chunks + `renderDoneWireHtml()` live only in the live `ReadableStream`.
  - **Defect:** a duplicate idem replays an empty/head-only, **unterminated** body; the client drains EOF and
    silently settles a confirmed-but-empty assistant answer (violates §10.3:1063 + §9 "no silent partial").
    `mutation-response.test.ts:1077` *codifies the loss* (`expect(second.body).toBe('')`).
  - **Fix:** commit after stream completion with head + rendered chunks + `<kovo-done>`; harden the client to
    treat completion-without-`<kovo-done>` (for a stream-opted request) as incomplete.
  - **Test:** replace the `toBe('')` assertion — replayed body must contain the streamed text and `kovo-done`.

- [x] **A4 (high) — Webhook caches unexpected-exception 500s; provider retry replays the cached 500** `impl-bug` (GAP3-1)
  - **Where:** `webhook.ts:317-327` commits `{status:500}` to the replay store on a *thrown* error; retry hits
    `get()` (`:240-249`) and never re-runs the handler. Contrast `mutation.ts:720` which `abort()`s on throw.
  - **Defect:** a transient DB blip is cached as terminal for the TTL → the write is permanently lost within
    the window, defeating Stripe/GitHub 5xx-retry semantics (§9.1:850).
  - **Fix:** on unexpected exception `reservation.abort()` (don't commit); only commit success + explicit
    `fail()`/`WebhookRollback`.
  - **Test:** `webhook.test.ts` — handler throws once then succeeds; redeliver same event id → `replayed:false`,
    status 200, handler ran twice.

- [x] **A5 (high) — Transient 429 rate-limit shed is committed to replay → sticky lockout** `impl-bug` (GAP4-1)
  - **Where:** `mutation.ts:730-752` — only `VALIDATION` aborts the reservation; `RATE_LIMITED` (429) falls
    through to `commitReservedMutationReplay`.
  - **Defect:** a pre-dispatch transient shed (§9.1.1:904) is cached for the full TTL; a client that correctly
    waits out `Retry-After` and retries the same idem is replayed the stale 429 forever (~5 min).
  - **Fix:** treat `status===429`/`RATE_LIMITED` as non-replayable (`abort()`, return directly), like VALIDATION.
  - **Test:** `replay.test.ts` — 429 then post-window retry of same idem re-runs the guard (no cached 429).

- [x] **A6 (high) — `reserve()` FIFO-evicts in-flight pending reservations (re-opens M4 double-execute)** `impl-bug` (GAP5-1, GAP5-2)
  - **Where:** `replay.ts:94-98` evicts the oldest Map entry with no `'pending' in record` guard; the
    `get()`-then-`reserve()` window (`mutation.ts:701/704`) plus the `kind:'disabled'` fallback (`replay.ts:230-232`)
    turns an evicted pending slot into an unprotected re-run.
  - **Defect:** under `maxEntries` pressure a concurrent duplicate double-executes — the exact M4 hazard the
    reserve-before-run was built to stop (§10.3:1063/1065).
  - **Fix:** never FIFO-evict pending records (evict committed/expired only); on the vanished-record path
    re-reserve rather than returning `disabled`.
  - **Test:** `replay.test.ts` with `maxEntries:2` — reserve pending A, drive ≥2 more reserves, assert
    `get(A)` still defined and a second `reserve(A)` returns `undefined`.

- [x] **A7 (low) — `Kovo-Idem` fallback minting is non-cryptographic/predictable** `spec-impl-divergence` (OPTIMISM-6)
  - **Where:** `mutation-response.ts:84-85` falls back to `idem_${Date.now()}_${counter}` when `randomUUID` is
    absent (§10.3:1065 mandates ≥128-bit from a cryptographic source).
  - **Fix:** fall back to `crypto.getRandomValues` (16 bytes); throw if no crypto source.
  - **Test:** mock `randomUUID` undefined → assert ≥128-bit non-timestamp values.

> **Contested sibling:** GAP4-2 (`csrf:false` + no ambient session → `scope=null` → replay silently disabled)
> is real per the exploiter but the refuter found partial handling — see *Contested*. It belongs to this lane.

---

## Lane B — Auth, cookies & header channel  *(security; `cookies.ts`, `mutation.ts`, `node.ts`)*

- [x] **B1 (critical) — Node adapter collapses multiple `Set-Cookie` headers, dropping all but the last** `impl-bug` (WIRE-DISPATCH-1)
  - **Where:** `node.ts:143-149` `headers.forEach((v,n)=>{nodeHeaders[n]=v})` — `Headers.forEach` combines
    `set-cookie` into one entry and the assignment overwrites; the framework otherwise carries multiple
    cookies as an array end-to-end (`response.ts:130-150`).
  - **Defect:** a handler that sets session **and** CSRF/refresh cookies ships only the last through the
    documented `toNodeHandler` adapter → silent login/session breakage. Verified by direct probe.
  - **Fix:** emit `headers.getSetCookie()` as a `string[]` to `writeHead`; `forEach` handles the rest.
  - **Test:** `node.test.ts` — Response with two appended `Set-Cookie` → captured `set-cookie` is a 2-element array.

- [x] **B2 (high) — Typed cookie builder does not percent-encode the value** `spec-impl-divergence` (AUTH-CSRF-1)
  - **Where:** `cookies.ts:20` `${name}=${value}` with only `assertCookieOctets` (bans `;`,CR,LF,NUL).
  - **Defect:** §9.1.1:846 says the builder percent-encodes so a value "can neither inject a second cookie nor
    add unintended attributes." Space/comma/`=`/quote pass verbatim; `cookies.test.ts:8-19` pins the no-encode
    behavior as correct.
  - **Fix:** `encodeURIComponent` the value in `serializeCookie`; update the test.
  - **Test:** `serializeCookie('sid','a b,c=d')` → `sid=a%20b%2Cc%3Dd`.

- [x] **B3 (high) — `MutationContext.setCookie` exposes a raw free-string `Set-Cookie` overload** `spec-impl-divergence` (AUTH-CSRF-3)
  - **Where:** `mutation.ts:222-225` declares `(rawSetCookie: string)`; routed through `validateRawSetCookie`
    (`cookies.ts:11-15`, only non-empty + CR/LF/NUL).
  - **Defect:** §9.1.1:846 "`Set-Cookie` is not a free string … built only through the typed builder." A handler
    can emit arbitrary attributes/`Domain`/`SameSite`.
  - **Fix:** remove the raw overload (or re-parse+re-serialize through the typed builder).
  - **Test:** `mutation.test.ts` — raw multi-attribute string is rejected/normalized.

- [x] **B4 (medium) — Header/cookie validation rejects only CR/LF/NUL, not the full control range** `spec-impl-divergence` (AUTH-CSRF-2)
  - **Where:** `cookies.ts:65-69` uses `/[\r\n\0]/`; §9.1.1:846 requires rejecting "any control character
    outside the printable header grammar." TAB, other C0, and DEL pass through.
  - **Fix:** broaden to `/[\x00-\x1f\x7f]/`; throw (don't strip).
  - **Test:** `serializeCookie('sid','a\tb')`, `'a\x01b'`, `'a\x7fb'` each throw.

- [x] **B5 (medium) — `hmacSignature` tolerance/timestamp is not bound into the signed payload** `coverage-gap` (AUTH-CSRF-4)
  - **Where:** `verifier.ts:236-250` checks `isWithinTolerance` on a timestamp header but signs only
    `options.payload`; the natural `({payload})=>payload` config leaves the timestamp authenticated by nobody.
  - **Defect:** capture-and-replay with a forged-fresh `x-timestamp` passes forever. Presets bind the timestamp;
    the generic helper does not, and `verifier.test.ts:29-59` never tests replay-with-fresh-timestamp.
  - **Fix:** when `tolerance` is set, require/fold the timestamp into the signed bytes (or hard warn).
  - **Test:** valid request, then same `(sig,body)` with a new `x-timestamp` → must reject.

---

## Lane C — Optimistic correctness  *(settlement, rollback, data-plane lowering)*

The "soundly optimistic / wrong predictions are worse than none" self-claim. Owner:
`packages/browser/src/{optimism,mutation-optimistic}.ts`, `packages/drizzle/src/derive.ts`, `packages/core/src/derivation.ts`.

- [x] **C1 (critical) — Settlement-set rebase is unimplemented → concurrent same-query transforms double-count** `spec-impl-divergence` (OPTIMISM-1, COVERAGE-GAPS-1)
  - **Where:** `optimism.ts:188-204` re-applies **every** pending transform unconditionally; `settle(idem)`
    drops only the triggering token (`mutation-optimistic.ts:132`); `QueryChunk` has no settlement field
    (`wire-parser.ts:18`); server emits no settlement set (`mutation.ts:1770`).
  - **Defect:** §9.1.1:828/§10.4:1118 mandate a per-chunk settlement set + settle-before-rebase ("purity gives
    determinism but not idempotency"). If m2's truth (already reflecting m1) arrives while m1 is pending, m1 is
    re-applied → double-count. `bugs-and-testing.md` C6 claims this is covered, but its tests hand-feed `settle()`.
  - **Fix:** add a `settles` field to the `<kovo-query>` chunk (triggering idem + prior committed idems folded
    into the re-run); thread through `QueryChunk`; in `applyServerTruth` drop pending whose id ∈ set before
    re-applying (fallback = triggering token only when absent, per §10.4:1118).
  - **Test:** rebaser `add('A',+1)`,`add('B',+2)` on base 0; `applyServerTruth({count:3}, settles=['A','B'])`
    → assert 3 (not 6); `settles=['A']` → leaves B pending → 5.

- [x] **C2 (medium) — Failure rollback wipes a co-pending mutation's prediction + pending-log entry** `impl-bug` (COVERAGE-GAPS-2)
  - **Where:** `optimism.ts:206-229` `discardPendingOptimism` resets to the first-captured truth and deletes the
    **whole** per-query pending log; called on any failure (`mutation-optimistic.ts:75/99`).
  - **Defect:** §10.4:1118 mandates an id-scoped pending log; one mutation's 422 destroys a sibling's still-valid
    prediction (badge flashes back; the sibling can never re-apply). `settleWithoutServerTruth` (`:162-186`)
    already does the correct id-scoped re-derive.
  - **Fix:** make the failure path id-scoped (filter by failed idem, re-derive surviving transforms from truth).
  - **Test:** add m1(+1)+m2(+5); fail m2 → assert `pendingCount('cart')===1` and store `{count:1}` (not 0).

- [x] **C3 (high) — Named FIFO queue applies the optimistic transform on dequeue, not on enqueue** `spec-impl-divergence` (OPTIMISM-3)
  - **Where:** `mutation-optimistic.ts:46-66` wraps the whole submission (incl. `rebaser.addChange`) inside
    `queue.run(...)`, which chains behind the prior tail (`mutation-queue.ts:11-12`).
  - **Defect:** §10.4:1121 (pinned) requires apply-on-enqueue so the UI reflects full queued intent; impl shows
    only the head's prediction until it drains (the "frozen cart" the pin was written to prevent).
  - **Fix:** call `addChange` synchronously at submit; queue only the network send + reconcile.
  - **Test:** queue two cart adds with a blocked head → store reflects both transforms before the head resolves.

- [x] **C4 (high) — `COUNT(R, pred)` reuses a sibling AGG's unfiltered rows-witness and ignores the predicate** `impl-bug` (DATA-PLANE-1)
  - **Where:** `derive.ts:225-251` emits `recount` (= `list.length`) whenever a table row-witness exists, with no
    predicate check; `rowsByTable` is keyed by table only (`static.ts:10274`); `recount` carries no pred
    (`derivation.ts:425-431`).
  - **Defect:** `COUNT(todos WHERE done=false)` recounts all shipped rows → wrong optimistic count.
  - **Fix:** when `field.pred` is present, punt (`no-row-witness`) unless the witness is provably filtered by the
    same predicate, or add a predicate-aware count (needs the pred column shipped).
  - **Test:** `derive.test.ts` — `items` AGG + `active` COUNT(pred done=false) sharing the witness; INSERT
    done:true → assert punt / `active` unchanged.

- [x] **C5 (high) — Write `match` accepts non-key eq predicates → multi-row UPDATE/DELETE patches only the first row** `spec-impl-divergence` (DATA-PLANE-2)
  - **Where:** `static.ts:9921-9962` accepts any `eq(t.col,v)` as a `keys` match without checking it covers the
    table key (its own doc comment claims non-key ⇒ opaque ⇒ punt); deriver emits single-row `update-row`/
    `remove-row` via `find`/`splice` (`derivation.ts:432-466`).
  - **Defect:** `UPDATE … WHERE category='books'` (non-key) updates only the first matching client row.
  - **Fix:** return null (→ opaque → punt) unless eq columns cover the declared key.
  - **Test:** `derive.test.ts` — non-key match over a 2-row array → assert punt `non-key-match`.

- [x] **C6 (high) — `SUM(R, col)` `resum`s over a witness that doesn't ship the summed column → total collapses to 0** `impl-bug` (DATA-PLANE-3)
  - **Where:** `derive.ts:191-221` emits `resum` whenever a rows-path exists, without consulting
    `RowWitness.columns` (`derivation.ts:135-138`); `resum` reads `row[col] ?? 0` (`:439-448`).
  - **Defect:** a sibling AGG projecting only `id` makes every contribution read 0; DELETE collapses `total`→0.
  - **Fix:** only `resum` when `RowWitness.columns` includes the summed column; else fall back / punt.
  - **Test:** `derive.test.ts` — `items` projects `['id']`, `total` SUM over `qty`; DELETE → assert punt
    (`no-row-witness`), not a zeroing `resum`.

> **Contested siblings (this lane):** OPTIMISM-4 (queue has no head-of-line timeout / no bound) and OPTIMISM-5
> (whole-value `structuredClone` violates the bounded-snapshot rule) — both real per exploiter; see *Contested*.

---

## Lane D — Version token & deploy-skew recovery  *(`client-modules.ts`, `query-refetch.ts`, `apply-mutation-response.ts`)*

- [x] **D1 (critical) — Render-plan token is derived from client-module versions alone** `spec-impl-divergence` (STATIC-EXPORT-DEPLOY-1)
  - **Where:** `client-modules.ts:91-112` hashes only sorted `path@version`; no query-shape / update-plan-grammar
    input anywhere in the build (`grep projected|query.*shape|kovo-key|updatePlanGrammar` over build pipeline → 0).
  - **Defect:** §5.2.1 rule 1 says verbatim "The token MUST NOT be derived from client-module content hashes
    alone." A deploy that changes a query's projected shape but not island bytes ships an **identical** token →
    the client deep-merges new-shape deltas onto the stale base (the silent staleness the framework markets it kills).
  - **Fix:** fold the compiler's query-shape facts + grammar version into the token preimage.
  - **Test:** same `path@version`, two shape-fact inputs → token differs; corpus field-rename moves the token.

- [x] **D2 (high) — `/_q/` read responses are not stamped with the build token** `spec-impl-divergence` (STATIC-EXPORT-DEPLOY-2)
  - **Where:** `query.ts:358-371` returns no `Kovo-Build`; `refetchQueries` (`query-refetch.ts:87-104`) applies
    chunks with no token comparison.
  - **Defect:** §5.2.1 rule 2(d) requires the token on "every /_q/ read response so a plain refetch into a stale
    tab is detected." A background visible-return refetch applies fresh-build data into a stale document.
  - **Fix:** add `Kovo-Build` to `/_q/` responses; compare in `refetchQueries`.
  - **Test:** assert `GET /_q/<k>` carries `Kovo-Build`; mismatched token → chunks not applied.

- [x] **D3 (high) — Deploy-skew recovery never escalates to a full reload** `spec-impl-divergence` (COVERAGE-GAPS-3)
  - **Where:** `query-refetch.ts:77-135` applies `/_q/` chunks unconditionally; no `location.reload` in the query
    path; `createDeltaMissRefetcher` is fire-and-forget (`:152-171`).
  - **Defect:** §9.1.1/§14 require: if the refetch *itself* still returns a differing token, the document is
    fundamentally skewed → full navigation reload. Tier-2 is absent; mixed-build data is merged instead.
  - **Fix:** thread the document token into `refetchQueries`; on persistent mismatch reload (GET, once).
  - **Test:** injected `/_q/` response with a still-mismatched token → store untouched, reload hook called once.

- [x] **D4 (medium) — Prod render-equivalence gate (KV416) never asserts token monotonicity** `coverage-gap` (STATIC-EXPORT-DEPLOY-5)
  - **Where:** `compile.ts:854-864` checks only the deep-merge property; no token notion (`grep token|monoton` → 0).
  - **Defect:** §5.2.2 KV416 also requires "a shape/grammar edit whose token fails to move fails the build" —
    wholly unimplemented (depends on D1).
  - **Fix:** after D1, fail KV416 when a shape/grammar-changing corpus edit leaves the token unchanged.
  - **Test:** differential corpus: rename a projected field → token must move; stubbed non-moving token → KV416.

---

## Lane E — Diagnostics severity & verifier wiring  *(the "machine-auditable, build-failing" self-claim)*

- [x] **E1 (critical) — KV406 is `warn` in the registry but `error` in SPEC → un-provable write sites pass CI** `spec-impl-divergence` (ANALYSIS-VERIFIER-1)
  - **Where:** `core/src/diagnostics.ts:630` `KV406: {severity:'warn'}`; `kovoCheck` fails only on `error`
    (`cli/index.ts:3953,4235`). SPEC §11.3:1285 + §11.2:1211 say `error` / "not advisory."
  - **Defect:** a raw-SQL / opaque / un-resolvable write site reports `WARN KV406` and `exitCode 0` — the
    headline guarantee silently off for exactly the writes the analyzer can't prove. `index.kovo-check.test.ts:513`
    *locks in* `exitCode:0`.
  - **Fix:** set KV406 (and KV405) `error`, or fail-closed on touch-graph unresolved codes regardless of registry
    severity; fix the test.
  - **Test:** KV406-only graph → `exitCode 1` + `ERROR KV406`.

- [x] **E2 (high) — KV310 optimistic-exhaustiveness is computed from declared `invalidates`/`writes`, not the touch graph** `impl-bug` (ANALYSIS-VERIFIER-3)
  - **Where:** `optimisticCoverageWarnings` (`cli/index.ts:4606-4615`) uses `mutationAffectedDomains` only; never
    reads `graph.touchGraph` (KV407 and KV314 both do).
  - **Defect:** §10.6 ties KV310 to the *derived* invalidation set. A mutation whose only invalidation edge is in
    the touch graph ships no optimistic story and `kovo check optimistic` stays silent.
  - **Fix:** union touch-graph-derived domains into the mutation→query match (mirror `deriveInvalidationRegistry`).
  - **Test:** mutation with empty `invalidates` but a `cart` touch-graph edge + uncovered `cartQuery` → `WARN KV310`.

- [x] **E3 (medium) — KV402/KV407 derived-superset cross-check is never fed by the pipeline (inert)** `coverage-gap` (ANALYSIS-VERIFIER-4)
  - **Where:** `staticSupersetFailures` consumes `derivedMutations`/`derivedQueries` (`cli/index.ts:4892-4952`),
    but no production code populates them (`grep` → only type defs + consumers).
  - **Defect:** §11.1/§11.2 "observed ⊆ static ∪ KV406-annotated" superset gate is a no-op end-to-end.
  - **Fix:** emit `derived*` from the touch graph in the extract pipeline (or do a direct touchGraph-vs-`invalidates`
    superset check inside `kovoCheck`).
  - **Test:** real `extractTouchGraphFromProject` whose mutation touches an extra domain → KV402, `exitCode 1`.

> **Contested sibling:** ANALYSIS-VERIFIER-2 (KV405 also `warn` not `error`) — same root as E1; see *Contested*.

---

## Lane F — Output safety & morph-path encoding  *(`security-output.ts`, `output-context.ts`, `html.ts`, `morph.ts`)*

- [x] **F1 (high) — Server SSR does not scheme-check dynamic URL attributes** `spec-impl-divergence` (OUTPUT-SAFETY-1, *promoted*)
  - **Where:** `html.ts:16 escapeAttribute` escapes only `&<>"`; `jsx-runtime.ts:210` + `emit/server.ts:472`
    render dynamic attrs through it; **the server imports no URL sanitizer** (main-thread-verified grep → 0); the
    compiler's `validateUrlAttribute` bails for non-literal expressions (`output-context.ts:139`).
  - **Defect:** a query/DB-controlled `href={row.url}` of `javascript:…` renders as a live sink on **first paint**;
    the client later rewrites the *same* value to `#` → §5.2#10 render-equivalence divergence + server stored-XSS.
    (Contested — refuter conflated literal/compile handling + client tests; the dynamic-server path is real.)
  - **Fix:** route URL-bearing attrs through a shared server `kovoSafeUrl` in the JSX runtime + emitted modules so
    server == client; emit a runtime sanitizer wrapper for non-literal URL expressions.
  - **Test:** seed `url='javascript:alert(1)'` → first server HTML has `href="#"`; server unit on `<a href={...}>`.

- [x] **F2 (high) — KV236 omits `on*`, `srcdoc`, and dynamic `formaction` sinks (compile + runtime)** `spec-impl-divergence` (OUTPUT-SAFETY-3)
  - **Where:** `output-context.ts:80-121` special-cases only URL/style/raw-HTML; `setBoundAttribute`
    (`query-bindings.ts:553`) → `setAttribute(name,…)` for any name; `kovoBoundAttributeValue` passes through
    non-URL names (`security-output.ts:93`).
  - **Defect:** §4.8:348 + KV236:1264 list `on*`/`srcdoc` as unsafe sinks. `<button data-bind:onclick=…>` /
    `<iframe data-bind:srcdoc=…>` install attacker JS/nested docs through both the compile gate and runtime.
  - **Fix:** flag `^on/i`, `srcdoc`, dynamic `formaction` as KV236 in `validateElementAttributes`; neutralize at
    `setBoundAttribute` as defense-in-depth.
  - **Test:** compiler KV236 for `data-bind:onclick`/`srcdoc`; runtime refuses to set `onclick`.

- [x] **F3 (medium) — Morph attribute sync rewrites live attributes verbatim, bypassing the URL sanitizer** `coverage-gap` (OUTPUT-SAFETY-4)
  - **Where:** `morph.ts:322-325` + `response-fragment-apply.ts:125` copy every attribute via `setAttribute`
    with no scheme check (binding path uses `kovoBoundAttributeValue`).
  - **Defect:** compounds F1 — a server fragment with `<a href="javascript:…">` is copied onto the live DOM
    unchanged even after hydration.
  - **Fix:** route URL-bearing attr names through `kovoBoundAttributeValue` in the morph/fragment-apply copy.
  - **Test:** morph `href="https://x"` against `href="javascript:…"` → live href neutralized to `#`.

- [x] **F4 (medium) — URL-scheme allowlist omits `ftp`** `spec-impl-divergence` (OUTPUT-SAFETY-2)
  - **Where:** `security-output.ts:156` + `output-context.ts:282` `SAFE_URL_SCHEMES = {http,https,mailto,tel}`;
    SPEC §4.8:347 includes `ftp`. Fails-safe (over-blocks) but build-fails a SPEC-legal URL.
  - **Fix:** add `ftp` to both sets.
  - **Test:** literal `ftp://…` href → no KV236; runtime keeps the value.

---

## Lane G — Morph engine duplication & shipped-engine bugs  *(`morph.ts` vs `inline-loader.ts`)*

- [x] **G1 (high) — Two divergent morph engines; the *shipped* one (inline loader) is weaker and largely untested** `coverage-gap` (MORPH-5) — *root cause of G2–G4*
  - **Where:** the served document injects the minified `m/u/k/d` from `response-fragment-apply.ts`/`inline-loader.ts`
    (`document-core.ts:356`); the thorough unit/browser tests target `morph.ts` (a separately-exposed bootstrap not
    used by default documents).
  - **Defect:** the shipped engine drops the `kovo-state` island guard, doesn't restore caret, skips child morph
    for all inputs/textareas, restores only `scrollTop`, and aborts signals by substring — yet `morph.test.ts` etc.
    stay green because they never touch it.
  - **Fix:** collapse to one engine (generate the inline one from `morph.ts`), **or** add a parameterized parity
    suite running the §9.1/§13.2 scenarios against **both** engines.
  - **Test:** parity suite `['morph.ts','inline-loader']` × {keyed reorder, nested-island state, abort-on-remove,
    caret survival across ancestor rebuild, scrollLeft/Top}.

- [x] **G2 (high) — Inline-loader abort-on-remove uses a substring `kovo-c` match (no instance identity)** `impl-bug` (MORPH-2)
  - **Where:** `inline-loader.ts:8 ab()` skips abort when `x.html.includes(kovo-c)` — component-name substring,
    never `kovo-key`/id. Correct logic exists at `handler-context.ts:205-213`.
  - **Defect:** removing one keyed row whose `kovo-c` still appears on a surviving sibling never aborts its
    `ctx.signal` → leaked fetches/listeners (§4.7/§13.2).
  - **Fix:** reuse `handler-context.ts` instance identity `[kovo-c, kovo-key??id]`.
  - **Test:** N keyed islands sharing `kovo-c`; remove one middle row → its signal aborts, survivors live.

- [x] **G3 (medium) — Shipped morph skips child reconciliation for ALL inputs/textareas → stale unfocused textarea** `impl-bug` (MORPH-3)
  - **Where:** `inline-loader.ts:8 m()` `if(c.selectionStart!=null)return c;` (true for every text control), vs
    `morph.ts:172` which skips only the `document.activeElement` control.
  - **Fix:** gate the early return on focus (mirror `isActiveDomFormControl`).
  - **Test:** unfocused `<textarea kovo-key>` with changed server content → value updates.

- [x] **G4 (medium) — Shipped morph doesn't restore caret/selection and ignores `scrollLeft`** `spec-impl-divergence` (MORPH-4)
  - **Where:** `inline-loader.ts:8 d()` calls `focus()` but never `setSelectionRange`; scroll loop reads only
    `scrollTop`. `morph.ts:359-377` does both.
  - **Fix:** capture/restore selection + `scrollLeft` (reuse `morph.ts` helpers).
  - **Test:** cross-engine caret survival across ancestor rebuild; horizontally-scrolled keyed panel keeps `scrollLeft`.

> **Rejected (transparency):** MORPH-1 ("inline morph clobbers nested island `kovo-state`") — the refuter found
> the shipped path preserves it; not a bug.

---

## Lane H — Wire dispatch & request shell  *(`app-dispatch.ts`, `app-mutation-request.ts`, `query.ts`, `shell.ts`)*

- [x] **H1 (high) — Malformed / wrong-Content-Type mutation body returns 500 (+ onError) before CSRF** `spec-impl-divergence` (WIRE-DISPATCH-2)
  - **Where:** `app-mutation-request.ts:47` reads the body with no try/catch; bad JSON / non-form Content-Type
    throws into the 500 shell — **before** CSRF, so any unauthenticated client can drive every endpoint to 500+onError.
  - **Defect:** §9.2 makes parse failures a typed **422**, not an unexpected 500.
  - **Fix:** wrap body read; return 422 on parse/Content-Type failure; don't route to onError.
  - **Test:** malformed JSON + `text/plain` body → 422, onError not called.

- [x] **H2 (medium) — `/_q/` query endpoint executes on any HTTP method (POST/PUT/DELETE)** `spec-impl-divergence` (WIRE-DISPATCH-3)
  - **Where:** `shell.ts:153-163` matches the reserved prefix by pathname only; the query branch
    (`app-dispatch.ts:42-60`) runs regardless of method (mutations re-check POST; queries don't).
  - **Defect:** §9.4 calls `/_q/` a credentialed **GET**; non-GET is a no-CSRF read channel on state-unsafe verbs.
  - **Fix:** restrict `/_q/` to GET/HEAD → 405 `Allow: GET, HEAD`.
  - **Test:** POST/DELETE `/_q/<k>` → 405, query not executed.

- [x] **H3 (medium) — `/_q/` failure/guard responses omit `Cache-Control: private, no-store` + `Vary: Cookie`** `spec-impl-divergence` (WIRE-DISPATCH-4)
  - **Where:** only the 200 branch sets them (`query.ts:358-371`); 422/429/500 (`:348-355`) and guard-failure
    403/redirect (`guards.ts:336-347`) carry only Content-Type/Location.
  - **Defect:** §9.4:895 "holds for every transport that hits /_q/"; a shared cache can store an anon 403 and
    replay it to an authed user.
  - **Fix:** apply the cache posture to all `/_q/` responses.
  - **Test:** assert headers on 422 / 500 / 403-redirect.

- [x] **H4 (low) — Streaming mutation `ReadableStream` has no `cancel` handler** `coverage-gap` (WIRE-DISPATCH-5)
  - **Where:** `mutation.ts:864` `new ReadableStream({async start})` — no `cancel`, no `request.signal`; client
    disconnect can't stop the author generator.
  - **Fix:** add `cancel()` → `iterator.return()`; wire `request.signal` into the coalesce loop.
  - **Test:** read one chunk, `reader.cancel()` → author generator `finally` runs.

---

## Lane I — Routing & navigation  *(`route.ts`, `match.ts`, `app-diagnostics.ts`)*

- [x] **I1 (high) — A route page returning `redirect()` renders as a 200 `[object Object]`** `spec-impl-divergence` (ROUTING-NAV-1)
  - **Where:** `runRoutePageInternal` (`route.ts:427`) recognizes only `notFound`/`routeResponse`; a `Redirect`
    (`{location,status:303}`) falls through to `String(value)` (`route.ts:814`); the `page` return union omits Redirect.
  - **Defect:** §6.4 names `redirect()`/`notFound()` the sanctioned non-200 page outcomes — page redirect is
    unimplemented (200 garbled body, no navigation). Also a type hole.
  - **Fix:** add `isRedirect` handling (303 + `Location`, via `sanitizeNext`); widen the `page` return union.
  - **Test:** page returning `redirect('/new')` → 303 + `Location:/new`; add a fixture.

- [x] **I2 (high) — Route params delivered to pages are never URL-decoded** `impl-bug` (ROUTING-NAV-2)
  - **Where:** `match.ts:237` assigns the raw split segment; nothing downstream decodes (`route.ts:316-318`,
    schema layer). Typed-link emission *encodes* (`navigation.ts:257`), so the round-trip is broken;
    `match.test.ts:33-40` even asserts the encoded value as expected.
  - **Defect:** `GET /users/john%20doe` → `params.id === 'john%20doe'`; DB lookups on the human value fail.
  - **Fix:** `decodeURIComponent` each segment (try/catch → 400); fix the test.
  - **Test:** `/users/john%20doe` → page sees `'john doe'`; href→match round-trip recovers the value.

- [x] **I3 (high) — KV419 `prefetch:'moderate'` gate checks only guard presence; no session/side-effect check, no justification hatch** `spec-impl-divergence` (ROUTING-NAV-3)
  - **Where:** `app-diagnostics.ts:47` fires only on `prefetch==='moderate' && guard!==undefined`; `RoutePrefetch`/
    `PageHintOptions` have no `prefetchJustification` field.
  - **Defect:** §8:756 also covers session-dependent + non-proven-side-effect-free routes, **unless** a named
    justification is supplied — so an unguarded session-reading route prerenders with creds yet isn't flagged, and a
    deliberately-justified guarded+moderate route can never compile.
  - **Fix:** extend the gate to session/side-effect facts; add `prefetchJustification` to suppress KV419.
  - **Test:** unguarded session-scoped route → KV419; guarded+moderate+justification → none.

> **Contested sibling:** ROUTING-NAV-4 (login `next` not validated against the route table) — partial; see *Contested*.

---

## Lane J — A11y, attribute-merge & primitive reactivity  *(`lower/attribute-merge.ts`, `lower/structural-jsx.ts`, `primitive-reactive-registry.ts`)*

- [x] **J1 (high) — State-bearing `aria-*` resolves author-wins in attribute-merge; SPEC says primitive-wins** `spec-impl-divergence` (A11Y-PRIMITIVES-1, COMPILER-LOWER-2)
  - **Where:** `attribute-merge.ts:247-250` collapses *all* `aria-*`/`role` into one `return author` branch;
    `data-state` correctly returns `primitive` (`:252-255`), exposing the inconsistency.
  - **Defect:** §4.6 splits descriptive `aria-*` (author wins) from **state** `aria-*` the primitive updates
    (`aria-expanded/selected/checked/pressed/current` → primitive wins; KV232/KV317). Initial SSR shows the wrong
    a11y state until a runtime derive fires; KV317 is also unregistered in `core/diagnostics.ts`.
  - **Fix:** add a `stateAriaAttributes` set checked before the generic branch → `return primitive`; register KV317;
    raise KV317 when the author static value contradicts the primitive.
  - **Test:** primitive `aria-expanded="true"` vs author `"false"` → SSR shows primitive value; `aria-label` still author.

- [x] **J2 (medium) — `aria-disabled` merges author-wins instead of logical-OR (unreachable branch)** `spec-impl-divergence` (A11Y-PRIMITIVES-4)
  - **Where:** `logicalOrAttributes` includes `aria-disabled` (`:59`) but the generic `aria-*` branch (`:247`) runs
    **before** the logical-OR branch (`:267`) and returns — so author `aria-disabled="false"` defeats a disabled primitive.
  - **Fix:** check logical-OR (and state-aria) before the generic `aria-*` branch.
  - **Test:** primitive `aria-disabled="true"` + author `"false"` → stays `true`; cover `readonly` too.

- [x] **J3 (high) — Query-driven boolean-presence attributes lower to raw booleans → `disabled="false"`/`hidden="false"` (still disabled/hidden)** `impl-bug` (COMPILER-LOWER-1)
  - **Where:** the `(expr?'':null)` wrap is applied only to `source==='state'` derives (`inline-derives.ts:82-85`);
    query-source bindings/derives/stamps emit raw booleans; `setBoundAttribute` only special-cases `checked`/
    `indeterminate` (`query-bindings.ts:546`), so `kovoBoundAttributeValue('disabled',false)` → `'false'`.
  - **Defect:** a query flipping `true→false` never enables/shows the element — the statically-modeled stale UI the
    framework claims to eliminate.
  - **Fix (preferred):** teach `setBoundAttribute` to treat the HTML boolean-presence set uniformly
    (falsy→removeAttribute, truthy→`''`); also fixes raw `data-bind:hidden`.
  - **Test:** `data-bind:disabled` value `true`→`''` then `false`→`null`; compiler stamp returns present/absent-safe.

> **Contested siblings (this lane):** A11Y-PRIMITIVES-2 (query-rooted primitive control props freeze
> `aria-*`/`data-state`) and A11Y-PRIMITIVES-3 (Tabs/ToggleGroup missing from the reactive registry — the
> documented "ARIA derives only for call-site attrs" gotcha, generalized) — both real per exploiter; see *Contested*.
> These overlap the `gallery-css-and-derive-gotchas` memory.

---

## Lane K — Streaming, broadcast & island lifecycle  *(`broadcast.ts`, `stream-text.ts`, `apply-deferred-stream.ts`, `loader-lifecycle.ts`, `clock-tick-bus.ts`)*

- [x] **K1 (high) — Broadcast principal check is asymmetric: a tab with no fingerprint accepts any rebroadcast** `impl-bug` (STREAMING-LIVE-2)
  - **Where:** `broadcast.ts:105` `if (options.principal !== undefined && event.data.principal !== options.principal) return;`
    — an `undefined`-principal receiver (anonymous/cold page; no `<meta name="kovo-session">`) skips the discard.
  - **Defect:** §9.3 "MUST discard any message whose fingerprint ≠ its own identity." On a shared/fast-switched
    device an anonymous tab applies a logged-in user's private `<kovo-query>` rebroadcast → cross-principal disclosure.
  - **Fix:** discard whenever stamped principal ≠ receiver principal, including the undefined cases; drop the channel on session change.
  - **Test:** receiver `principal:undefined`, message `principal:'session-B'` → message discarded.

- [x] **K2 (high) — Modular streaming runtime ignores `<kovo-done reason="error">`** `spec-impl-divergence` (STREAMING-LIVE-1)
  - **Where:** `readMutationResponse*Chunks` (`wire-parser.ts:234-280`) parse only query/fragment/text; the streaming
    loop ends with `flush('completion')` regardless (`apply-mutation-response.ts:245`). The inline loader honors it
    (`inline-loader-build.ts:536-538`).
  - **Defect:** §9.1 "must not silently present a partial assistant answer as confirmed." A server `error` terminator
    leaves the partial text marked `streaming`/confirmed.
  - **Fix:** parse `<kovo-done>` in the modular path; on `reason!=='complete'` fail the stream/form + onError.
  - **Test:** stream `<kovo-text>` then `<kovo-done reason="error">` cleanly → `data-stream-state==='error'`.

- [x] **K3 (medium) — Broadcast fingerprint hashes the whole cookie header, not `req.session` identity** `spec-impl-divergence` (STREAMING-LIVE-3)
  - **Where:** `app-document.ts:100-109` FNV-1a's the entire `Cookie:` header; the real principal is available
    (`guards.ts:516`, `replay.ts:284-290`).
  - **Defect:** §9.3 "derived from req.session identity." Any non-session cookie churn (CSRF rotation, theme, cart)
    gives two tabs of the *same* user different fingerprints → legitimate same-user sync is discarded.
  - **Fix:** derive from the resolved session id (hashed), `undefined` only when genuinely anonymous.
  - **Test:** same session id + different extra cookies → same fingerprint; different session id → different.

- [x] **K4 (high) — Cross-tab broadcast & deferred-stream apply can't abort island `ctx.signal` (wrong/missing scope)** `spec-impl-divergence` (LOADER-RUNTIME-1, LOADER-RUNTIME-2)
  - **Where:** `installMutationBroadcast` passes no `islandSignalScope` (`broadcast.ts:113`; field absent from the
    options type); the bootstrap `applyKovoDeferredStreamResponse` likewise (`emit/bootstrap.ts:87`). Both fall back
    to the empty `defaultIslandSignalScope`, while delegated handlers register under the loader's private scope (`loader.ts:101`).
  - **Defect:** §4.7 — a broadcast/deferred morph that removes an island never aborts its in-flight `ctx.signal` → leak.
  - **Fix:** thread the loader's scope through both apply paths (or unify on one module-global scope).
  - **Test:** delegated handler registers a signal under the loader scope; broadcast/deferred morph removes the island
    → assert `ctx.signal.aborted`.

- [x] **K5 (medium) — `on:idle` execution trigger fires after loader dispose (no idle cancellation)** `impl-bug` (LOADER-RUNTIME-3)
  - **Where:** `loader-lifecycle.ts:189` schedules idle with no handle; `:197` returns a no-op disposer when there are
    idle but no visible elements; disposer ordering aborts the signal scope first.
  - **Defect:** a queued idle callback after `dispose()` imports + runs the handler and re-creates a fresh
    AbortController in the just-cleared scope, racing the next page.
  - **Fix:** track a `disposed` flag (+ `cancelIdleCallback`); early-return when disposed; always return a real disposer.
  - **Test:** capture idle cb, `dispose()`, fire cb → handler module never imported.

- [x] **K6 (medium) — Buffered stream-text empty checkpoint fails to clear the target** `impl-bug` (STREAMING-LIVE-4)
  - **Where:** `stream-text.ts:154` early-returns when `pending.length===0`, so a `mode="checkpoint"` with empty text
    never writes `textContent=''` (the immediate path and inline loader both clear).
  - **Defect:** §9.1 "checkpoint replaces the accumulated source text" — a retraction/clear leaves stale text visible.
  - **Fix:** flush on a pending checkpoint even when empty (or set `textContent` directly in the checkpoint branch).
  - **Test:** append, flush, empty checkpoint, flush → `textContent===''`.

- [x] **K7 (medium) — Clock-tick bus has no visibility/focus refresh → stale relative-time on tab return** `impl-bug` (LOADER-RUNTIME-5)
  - **Where:** `clock-tick-bus.ts:74,95` drive ticks via throttled `setInterval` + paused `rAF`; no
    `visibilitychange`/`pageshow` listener (the query layer has one, `query-visible-return.ts:171`).
  - **Defect:** a backgrounded "N minutes ago" label stays stale up to one interval on refocus — the exact event a
    user expects fresh time.
  - **Fix:** run a clock frame immediately on `visibilitychange→visible`/`pageshow`.
  - **Test:** advance time while hidden, dispatch visibility→visible → immediate catch-up frame.

- [x] **K8 (low) — Deferred-stream apply/cleanup scripts hardcode `--kovo-boundary`** `impl-bug` (STREAMING-LIVE-5)
  - **Where:** `deferred-stream.ts:47,49` hardcode the literal while emit markers use the configurable `boundary` (`:60,71`).
  - **Defect:** any non-default `boundary` makes the apply walk never find its stop marker → corrupts the stream.
  - **Fix:** interpolate `--${boundary}` into the scripts (or drop the unused option).
  - **Test:** `renderDeferredStream({boundary:'alt-bnd'})` → scripts reference `--alt-bnd`.

---

## Contested — needs adjudication  *(real per the exploiter; the refuter found partial handling/coverage)*

Each is genuine on the code, but a verifier dissented (usually: a sibling case *is* handled/tested, or it overlaps
a known-open item). Worth a focused decision before building.

- [ ] **OPTIMISM-4 (high)** — `MutationQueue` (28 lines) has no head-of-line timeout/abort and no depth bound; a hung
  head blocks the tail forever (§10.4:1122/1123/1125). *Refuter: refuted.* Belongs with Lane C.
- [ ] **OPTIMISM-5 (medium)** — every snapshot/clone uses whole-value `structuredClone` (`query-store.ts:52`,
  `optimism.ts:137/194/302`), violating the normative bounded/copy-on-write snapshot rule (O(dataset) per rebase tick).
  The "F22 snapshot bound" box in `bugs-and-testing.md` has no test. *Refuter: refuted.*
- [ ] **ANALYSIS-VERIFIER-2 (high)** — KV405 is also `warn` not `error` (`diagnostics.ts:625`); an isolated KV405
  passes CI despite §11.2 "no longer advisory." Same root + fix as **E1**. *Refuter: refuted.*
- [ ] **GAP4-2 (high)** — `csrf:false` + no ambient session → `scope=null` → `reserveMutationReplayBeforeRun` returns
  `disabled` → duplicate external POSTs with a stable idem double-execute (§10.3 all-paths). *Refuter: handled+tested
  (but on the session-bearing path).* Belongs with Lane A.
- [ ] **LOADER-RUNTIME-4 (high)** — the inline loader's `sef` applies/ignores the response body without inspecting
  `res.status`/`Kovo-Reauth`; a non-fragment 4xx/5xx body is silently swallowed (form shows no failure). Overlaps
  known-open F6 but is the deeper status-blind-swallow bug. *Refuter: refuted (overlaps F6).*
- [ ] **A11Y-PRIMITIVES-2 (high)** — `lowerPrimitiveReactiveAttributes` only accepts `state`-rooted control props
  (`structural-jsx.ts:889`); a query-driven `<Switch checked={q.field}>` freezes `aria-checked`/`data-state` while
  `checked` stays reactive. *Refuter: not refuted (verdict incomplete).* Strong candidate to promote.
- [ ] **A11Y-PRIMITIVES-3 (high)** — Tabs/TabsTrigger/TabsPanel and ToggleGroup* are missing from
  `primitiveReactiveComponents`, so their state `aria-*` freeze on interaction. *Refuter: handled+tested (the
  primitive *function* is tested in isolation; the compiler wiring is not).* Strong candidate to promote.
- [ ] **STATIC-EXPORT-DEPLOY-3 (high)** — an empty build token (module-less L0/L1 doc) omits the `kovo-build` meta and
  disables the skew gate entirely (`apply-mutation-response.ts:97-100`). *Refuter: handled+tested.* Resolved by **D1**
  (make the token build-global, never empty).
- [ ] **STATIC-EXPORT-DEPLOY-4 (high)** — prior-artifact retention is count-based (`client-modules.ts:244-250`), not
  the §14 24h wall-clock floor; a redeploy burst 404s in-window artifacts; KV417 is unregistered. *Refuter: refuted.*
- [ ] **ROUTING-NAV-4 (medium)** — login `next` is origin-sanitized but never validated against the route table
  (§6.5:724); an in-app non-route path survives. *Refuter: refuted (open-redirect prong is handled).*
- [ ] **OUTPUT-SAFETY-1 (high)** — *promoted to F1 above* after main-thread verification.

---

## Sequencing & ownership  *(CLAUDE.md worktree protocol; ≤5 sub-agents at once)*

Lanes are file-partitioned, so most run concurrently. Watch these shared hotspots:

- **`packages/server/src/mutation.ts` + `replay.ts`** — Lane A is one coherent owner (the reservation lifecycle);
  do A1→A6 as a single worktree to avoid churn (B1 is in `node.ts`, independent).
- **`packages/core/src/diagnostics.ts`** — E1 + ANALYSIS-VERIFIER-2 + J1's KV317 registration all touch the registry;
  apply registry rows in one edit.
- **`packages/compiler/src/lower/attribute-merge.ts`** — J1 + J2 are the same file; one owner.
- **`client-modules.ts` token** — D1 is the keystone; D2/D3/D4 and STATIC-EXPORT-DEPLOY-3/4 all depend on a
  build-global, never-empty, shape-derived token. Do D1 first.
- **Morph** — G1 (engine unification / parity suite) should land first; G2–G4 either fold into the unification or
  become parity-suite cases.
- **`api-surface-baseline.json`** — B3 (remove the raw `setCookie` overload), I1 (widen `page` return union), I3
  (`prefetchJustification`) change public surface → regenerate + re-gate per `rules/api-surface.md`.

Independent / slot anywhere: A7, B4, B5, F4, H2/H3/H4, K6/K7/K8, the contested triage items.

## Governance & proof

- **Definition of done per item:** the cited test goes **red against today's code, green after the fix** (for
  coverage gaps, the new fixture/assertion fails on the unfixed path). Several existing tests *codify the bug*
  (`replay 5min`/`index.kovo-check.test.ts:513` KV406, `mutation-response.test.ts:1077` streaming `toBe('')`,
  `match.test.ts:33-40` encoded param, `client-modules.test.ts:55-59` count-eviction 404) — those assertions must be
  inverted, not preserved.
- Cite the relevant `SPEC.md` section in each change; `SPEC.md` stays normative. Compiler/diagnostic changes follow
  `rules/compiler-hard-rules.md`; public-surface changes follow `rules/api-surface.md`.
- Broaden to `tsc` + API gate + `git diff --check` when touching shared boundaries or the `SPEC.md`/diagnostics registry.
- This is an active ledger: collapse evidence into the checkbox it proves; archive transcripts.

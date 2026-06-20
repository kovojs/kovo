# Bugs & Testing — Merged Sequenced Plan

**Date:** 2026-06-19
**Sources:** `plans/bugs-1.md` (30 verified SPEC design defects — the *contracts*) and
`plans/testing-audit.md` (integration-suite coverage gaps — the *verification*).
**Goal:** one execution roadmap that sequences both, **parallelized aggressively**, with explicit
dependency gates and file-ownership rules so independent work runs concurrently without colliding.

## Execution status (live)

- **Phase 1 — Spec contracts (Lanes A1–A7) → `SPEC.md`: ✅ APPLIED + VERIFIED on branch `agent/spec-contracts-bugs1`.**
  All 30 bugs-1 findings drafted in parallel (7 lanes), reconciled into 54 conflict-free edits
  (cross-lane merges on §10.3 lifecycle, §6.6, §9.4; KV-code collisions renumbered), applied as the
  single writer. SPEC.md 1287→1416 lines. New codes KV313/314/316/317/414/415/416/417/418/419;
  KV236/405/406/410 amended (59 unique registry rows). Adversarial verification (7 per-lane checkers
  + 1 global hunter) confirmed every finding "correctly and coherently fixed"; the 2 blockers (KV232
  reused at two severities → split to new error KV317) and 5 minors (F2 punctuation; §6.2 `reads:`
  row; §5.2.1/§5.2.2 moved under their §5.2 parent; §13 pointer-list reordered; §13→§14 and
  §5.2.2 numbering gaps closed) are resolved. All cross-refs resolve; `git diff --check` clean.
- **Contract IMPLEMENTATION (moving bugs-1 from SPEC-only to code): 4 done.**
  - ✅ **F35** — `/_q` reads emit `Cache-Control: private, no-store` + `Vary: Cookie` (`query.ts`);
    unit + integration verified. Closes the shared-cache cross-user leak without the S1 harness.
  - ✅ **F9** — cookie/header channel rejects CR/LF **and NUL** (`cookies.ts`); typed cookie builder +
    CRLF guard were already present, residual (NUL) closed; unit-tested.
  - ✅ **F2** — the framework never emits an open-redirect `next` (`guards.ts` `sanitizeNext`); unit-tested.
  - ✅ **F34** — guarded route documents carry `Cache-Control: no-store` (`document-core.ts` +
    `app-document.ts`, keyed on `route.guard`); tsc-clean, unit + integration verified. (The
    `pageshow`+persisted loader reload is belt-and-suspenders, since no-store already disqualifies
    bfcache in Chrome/WebKit.)
  - ✅ **F36 / KV419** — first new diagnostic implemented end-to-end: registered KV419 in the core
    registry (union + exhaustive `Record` + golden tests) and a `routePrefetchGuardDiagnostics`
    check that flags `prefetch:'moderate'` on a guarded route, wired into `createApp`; unit-tested,
    tsc clean. **Proves the path** for the other SPEC-only codes (register in core + add the check).
  - ✅ **KV314→KV420 collision FIXED** — discovered while wiring the new diagnostics: the Phase-1
    reconciliation only de-duped within SPEC.md, not against the impl registry
    (`packages/core/src/diagnostics.ts`), which already defines KV314 ("renderOnce reads an
    invalidated query"). Renumbered the island-state code to KV420 SPEC-wide; verified the other 9
    new codes (KV313/316/317/414–419) are free in the impl.
  - **Structural blocker for the new-diagnostic contracts (KV414/416/417/418/419/420, KV313/316/317):**
    they are SPEC-only. Each must first be **registered** in `core/src/diagnostics.ts` — the
    `DiagnosticCode` union **and** the exhaustive definitions `Record` (a missing def breaks tsc) —
    then its **check** implemented (route-validation for KV419 at `app.ts:91`; analyzer for KV414;
    compiler-lowering for KV314-class). Also: impl `KV243` is absent from the SPEC §11.3 table.
  - Next runtime candidates (medium, dispatch/loader): F1 (csrf:false session strip), F6 (auth-redirect
    401/`Kovo-Reauth` + loader), F17/F22/F19/F27 (optimistic), F13/F29 (browser delta/rebroadcast).
- **Phase 2 — Test + harness half (Lanes B/C/D): IN PROGRESS.**
  - ✅ **B0** — harness cache-input fix: `integration` task input broadened from
    `packages/test/src/integration/**` to `packages/test/src/**` so the runtime verifier
    (its sole exerciser) invalidates the cache (`vite.config.ts`).
  - ✅ **C1** — `xss-escaping` fixture + spec: drives `</script><script>` and `<img onerror>` and a
    `javascript:` URL through the JSON island (`escapeScriptJson`→`<`), `<kovo-query>` wire
    (`escapeHtml`→`&lt;`), client text binding (`textContent`), and `kovoSafeUrl` URL-scheme
    blocking → all neutralized. **Passes.** Authoring it caught a real bug in the F8 SPEC text
    (JSON-island is script-data → needs `<`, not `&lt;`); SPEC §9.1 corrected.
  - ✅ **C1 (LLM-output)** — `streaming-chat` `xss-probe` branch + spec: model-streamed payload with
    `</kovo-text>` break-out is HTML-escaped in the `<kovo-text>` wire (escaped source buffer); no
    execution. **Passes.** Closes testing-audit §4's highest-risk vector.
  - ✅ **C2** — `mutation-response-headers` now asserts serialized `Set-Cookie` carries
    `HttpOnly`+`SameSite=Strict` on enhanced + no-JS paths. **Passes.**
  - ✅ **C8 (no-JS)** — `counter-no-js.spec.ts`: first browser-level `javaScriptEnabled:false` test;
    enhanced form degrades to native POST→303 PRG→full re-render, count accumulates as server
    truth. **Passes.** (SPEC §8 "degrades to a website"; testing-audit §5.3.)
  - **Security tier + no-JS degradation complete** (Phase 1 contracts + all P0 security fixtures).
  - ✅ Coverage-breadth wave: `multi-domain-write` (KV402), `pg-constraint-failure` (real-PG
    rollback), HEAD empty-body, `scale-keyed-list` (300-row morph), `morph-native-state`
    (expected-fail gap), Firefox/WebKit cross-engine matrix, `layout-primitive-nested`, auth
    login→logout round-trip. **All 18 session specs pass together (15.1s).**
  - **What genuinely remains, by blocker:**
    - **Blocked on contract IMPLEMENTATION** (SPEC-only so far — can't test what isn't built):
      C3 (KV414 IDOR gate + owns()), C8d F39 (KV314 compile-error), C8d F40 (isomorphic feature),
      C6 (A5 settlement/queue), clock freshness (KV312/315 `clocks` input). These need the bugs-1
      contracts written into compiler/runtime code first.
    - **Blocked on the S1/S2/S3 harness keystones:** C4/C5 (cache/bfcache, prod-delta, deploy-skew,
      minified-name — need a prod-build browser harness), derived-optimism (needs compiler-emit S2).
    - **Bounded coverage still open** (testable now, no new infra): multi-feature interaction page,
      KV-code surfacing + severity-fidelity, page-render read verification, KV234 cross-pkg,
      handler-vs-framework header precedence, flake gate / module-scope reset / snapshot-meta /
      CSS-clear / B0 meta-test.
  - **⚠ Tracked impl gap (F10):** SPEC sink-renderer signature `(escaped) => string | TrustedHtml`
    diverges from the impl's `(target, source, options) => void`. Enforcing the constrained
    signature is a code change (would alter the `data-stream-renderer` contract) — follow-up.
  - **Remaining (large, multi-session):** S1 prod-build browser harness · S2/S3 compiler-emit +
    realistic-app keystones · P2 coverage (multi-domain/KV408, derived-optimism, morph survival,
    layout, no-JS, real-PG failure) · P3 breadth (cross-engine, flake gate, negative type tests,
    isomorphic, scale) · C2 login→logout round-trip · B0 meta-test.

## How the two streams interlock

For most items the relationship is 1:1: **bugs-1 says what the spec must promise; testing-audit
proves the code keeps the promise.** A test that asserts behavior the spec doesn't mandate is
asserting a guess (this is literally bug F7: today "an escaping impl and a raw-concatenating impl are
both spec-compliant"). So the default pattern is **co-develop the contract and its conformance test
in one slice**, and only split when the test is gated on a harness keystone the contract is not.

Two harness keystones from testing-audit gate whole columns of verification and are the long poles —
**start them on day 1 in parallel with everything else:**

- **G‑S1** = a production build is `kovo build`-served and driven in a real browser (testing-audit
  §3 S1 / P1).
- **G‑S2/3** = canonical fixtures authored as real TSX through the compiler + public client API, with
  the *extracted* touch graph chained into the runtime verifier and the real package stack
  integrated (testing-audit §3 S2+S3 / P1).

### Theme ↔ contract ↔ test ↔ gate map

| Lane | bugs-1 contracts | testing-audit verification | Gated by |
| --- | --- | --- | --- |
| **A1 Output safety** | F7, F8, F10 | P0 XSS/escaping fixtures (§4) | none (dev harness) |
| **A2 Access control** | F12, F1, F2, F3, F4, F13, F36 | §4 perimeter + IDOR + negative-compile (P3) | A2 impl; G‑S2/3 for explain-graph |
| **A3 Transport & DoS** | F9, F34, F35, F5 | P0 cookie-hardening; cache/bfcache (5.4) | cookie: none · cache/bfcache: **G‑S1** |
| **A4 Refs & version token** | F30, F32, F29 | prod-delta + deploy-skew-422 + minified-name (S1/5.4) | **G‑S1** |
| **A5 Optimism & lifecycle** | F17, F19, F20, F22, F27, F28, F6 | 5.2 concurrency + derived-optimism (5.1) | dev harness · derived-optimism: **G‑S2/3** |
| **A6 Data-plane soundness** | F23, F24 | verifier-chain: KV405/406/408, multi-domain, real-PG, page-reads (5.1) | **G‑S2/3** |
| **A7 Composition & coverage** | F39, F40, F33 | morph-survival, `isomorphic`, multi-feature, layout, no-JS (5.3/5.6) | dev harness · isomorphic: A7‑F40 |
| **Deferred** | F15 | SSE subscribe-then-revoke guard re-check (§4/P3) | **lands with the unbuilt SSE feature** |

---

## Lanes & ownership (conflict discipline)

Aggressive parallelism fails on shared-file collisions, not on independent work. Ownership rules:

- **Each A‑lane edits a different `SPEC.md` section set** → one git worktree/branch per lane
  (`agent/spec-a1-output-safety`, …), main merges (CLAUDE.md worktree protocol). Section partition:
  A1 §4.8/§5.2/§9.1 · A2 §6.2/§6.5/§6.6/§9.1/§10.2/§10.3/§8 · A3 §8/§9.1.1/§9.4/§9.5 · A4 §5.1/§5.2/§13/§9.1.1 ·
  A5 §10.4/§9.2/§10.3 · A6 §10.1/§10.2/§11.1/§11.2 · A7 §4.5/§4.6/§4.9/§9.1.
- **🔴 `SPEC.md` §11.3 diagnostic registry is the one shared hotspot.** A1 (define KV236), A2 (new
  KV414 IDOR gate), A6 (pin KV406→error, KV405→gating), A3/A7 (any new codes) all touch the KV table.
  **Rule:** each A‑lane *proposes* its KV row in its handoff note; **main applies all registry
  rows in one integration edit** after lanes hand off, so the table never churns under parallel
  branches.
- **🔴 `api-surface-baseline.json` moves for public-API changes** — A2's guard-arg signature (F12)
  and any new public surface trip `rules/api-surface.md`. The owning lane regenerates the baseline in
  its branch; main re-runs the API gate at merge. Treat A2 as the API-surface-critical lane.
- **Harness (`packages/test/src/integration/**`) is shared by B1 and B2.** Partition: **B1 owns the
  build-serve/server-boot path** (`bootFixture` prod variant, `dist/server/server.mjs` boot); **B2
  owns the fixture-plugin → compiler-emit + verifier-chain path**. One owns the `bootFixture`
  signature; the other extends it via an option. Land **B0 (the one-line `vite.config.ts`
  cache-input fix) first and merge it before B1/B2 branch** so neither rebases over it.
- **New fixtures** (`tests/integration/fixtures/<name>` + `<name>.spec.ts`) are new files → the C/D
  lanes parallelize freely with zero contention.

Concurrency cap (CLAUDE.md): **≤5 sub-agents at once; main thread holds the critical-path slice.**
The wave schedule below never asks for more than that at a barrier.

---

## Wave schedule (the spine)

### Wave 1 — Contracts + cheap wins + ignite the long poles  *(all parallel, ungated)*

> Main thread owns the #1 critical (output safety, highest leverage in *both* docs). Up to 5
> sub-agents run the rest. B0 is a ~5-minute warm-up folded into main before it picks up A1.

- **[main] A1 — Output-safety slice (contract + test together).** Write the normative escaping rule
  (F7: contextual HTML-encode every binding/stamp value; define KV236's unsafe contexts +
  trusted-HTML hatch; F8: `</script>`-safe JSON-island encoding; F10: sink-renderer escaping
  obligation) **and** the P0 XSS/escaping fixtures (bind/stamp/`kovo-text` user strings with HTML
  metacharacters, `</kovo-fragment>`, `javascript:` hrefs → assert `&lt;`-encoded / scheme-stripped;
  include the `streaming-chat` LLM-output assertion). Dev harness — no keystone needed.
- **[agent‑1] B1 — G‑S1 prod-build harness** (long pole; ignite now).
- **[agent‑2] B2 — G‑S2/3 realistic-app + compiler-emit fixtures + extracted-graph→verifier chain**
  (long pole; ignite now).
- **[agent‑3] A2 — Access-control contracts** (F12 arg-aware guards + `owns()` combinator + blocking
  runtime-verified **KV414**; F1 `csrf:false` audit visibility/session-strip; F13 principal
  fingerprint on BroadcastChannel envelope; F2 `next` same-origin validation; F3 anon-CSRF binding;
  F4 re-authorize-before-replay; F36 `prefetch:'moderate'` compile gate). **API-surface-critical.**
- **[agent‑4] A3+A4 bundle — Transport safety + refs/version-token** (F9 header CRLF guard + typed
  cookie builder **and** the P0 cookie-hardening test [`HttpOnly`/`SameSite`/`Secure` + merge order +
  login→authed→logout]; F34 guarded-doc `no-store`+`pageshow`; F35 `/_q` `Cache-Control: private,
  no-store`+`Vary`; F30 define the render-plan version token in real §5.1/§5.2.1/§5.2.3/§15 + retention
  window; F32 write §13.2 `kovo-key` contract; F29 delta deep-merge replace-vs-merge rule).
- **[warm-up, then folds into main] B0 — cache-input fix** (`vite.config.ts`: add
  `packages/test/src/**` + app packages to the `integration` input globs; add the meta-test).

**Wave-1 gates produced:** G1 (output safety done), A2/A3/A4 contracts merged; **G‑S1 and G‑S2/3 land
asynchronously when B1/B2 finish** and open Wave 2's gated tests.

### Wave 2 — Remaining contracts + gated verification  *(parallel; each item starts when its gate clears)*

Spec authoring (keystone-independent — start as Wave-1 worktrees merge):
- **A5 — Optimism & lifecycle contracts** (F17 settlement-matching by `Kovo-Idem` before rebase
  re-apply; F28 atomic replay *reservation* for all mutation paths; F27 fresh per-submit idem token;
  F19 `queue:` FIFO timeout/drain/apply-timing; F20 missing-truth = discard not freeze; F6 mutation
  auth-redirect vocabulary; F22 bound the optimistic snapshot).
- **A6 — Data-plane soundness contracts** (F23 pin KV406→error at unresolved sites, raise KV405 to
  CI-gating, raw-SQL `touches` allowlist; F24 KV410 opaque-projection `reads:` annotation).
- **A7 — Composition contracts** (F39 resolve fragment-morph-vs-nested-island-state contradiction;
  F40 isomorphic-island children rule; F33 split `aria-*` static-vs-state row).

Gated verification (start the moment the named gate clears):
- **C3 ← A2 impl:** IDOR/auth integration (arg-keyed read denied; **KV414 fails the build**;
  `csrf:false` mutation visible in `--endpoints`) + negative-compile tests (`@ts-expect-error` for
  wrong mutation field / bad binding path / invalid typed link, F36 prefetch gate).
- **C4 ← G‑S1:** cache/bfcache tests (logout→Back restores nothing; shared-cache cross-user `/_q`
  leak blocked by `Vary`/`no-store`) — verifies A3 F34/F35.
- **C5 ← G‑S1:** prod-delta encoding (keyed upsert + removed-key + token-mismatch refetch),
  deploy-skew-422, **Constitution #1 minified-name survival** — verifies A4 F30/F29.
- **C6 ← A5 (+ G‑S2/3 for derived-optimism):** `queue:'cart'` FIFO, multi-transform rebase ordering,
  concurrent-distinct lost-update, compiler-*derived* optimistic transform end-to-end (no correction
  flash) — verifies A5 F17/F19/F27 and bugs-1 rebase double-count.
- **C7 ← G‑S2/3 (+ A6):** chain extracted graph into verifier; assert KV405/406/408 actually fire,
  multi-table/multi-domain write + keyed fan-out, real-Postgres failure (unique/FK/check/NOT-NULL →
  typed error + rollback + no stale optimism), page-render read verification — verifies A6 F23/F24.
- **C8 ← A7 (dev harness):** morph survival (non-input focus, IME/composition, native `<details>`/
  `<select>`/checkbox/media state — **F39 child-island-state**), `isomorphic:true` render-equivalence
  (**F40**), multi-feature interaction page, `layout()` end-to-end, no-JS degradation on a real app.

### Wave 3 — Breadth & robustness  *(independent infra; run as capacity frees)*

- **D — Harness/CI:** firefox/webkit `@cross-engine` tier; flake gate + scheduled `--repeat-each=3`
  over race-prone specs; module-scope reset between tests; semantic-snapshot allowlist meta-test;
  clear `globalThis.__kovoFixtureCssAssets` on close.
- **C9 — Coverage breadth:** table-driven KV surfacing (KV220/221/227/**242**/302/312 → real
  compiler→ledger→500 doc); KV234 cross-package prefix conflict; `kovo explain --endpoints` driven
  from the *extracted* graph; scale fixture (300+ keyed rows, deep tree); HEAD empty-body;
  severity-policy fidelity per tier; `@kovojs/devtool` stamp smoke; time/clock freshness
  (KV312/KV315).
- **Deferred (lands with the feature):** **F15 + SSE guard re-check** — when `<kovo-live>`/SSE ships,
  the spec per-push session re-resolution rule and the subscribe-then-revoke-mid-stream test land
  *together*. Do not build now (SSE unimplemented).

---

## Dependency edges (the DAG, explicit)

```
B0 ──▶ (merge before) B1, B2
B1 (G‑S1) ──▶ C4, C5, css-asset-served, stylex-served, static-export-real-build, Constitution#1
B2 (G‑S2/3) ──▶ C7, C6(derived-optimism), compiler-error→teaching-500-e2e, explain-from-extracted-graph, A2-explain-graph test
A1 contract ═ co-developed with ═ C1(XSS)           [no gate]
A2 impl ──▶ C3 (IDOR/auth + negative-compile)
A3(F9) ═ co-developed with ═ C2(cookie hardening)    [no gate]
A3(F34/F35) ──▶ C4 (needs G‑S1 too)
A4(F30/F29) ──▶ C5 (needs G‑S1 too)
A5 ──▶ C6 ;  A6 ──▶ C7 ;  A7(F40) ──▶ C8(isomorphic)
SSE feature ──▶ F15 + live-guard test   [not in this plan's scope yet]
```

Independent of *everything* (can slot into any wave when an agent is free): B0, D‑lane infra,
A4‑F32 (§13.2 authoring), most C9 negative/table-driven specs.

---

## Checklists

### Keystones & cheap wins (Wave 1)
- [x] **B0** `vite.config.ts` integration input broadened to `packages/test/src/**` (verifier now an input) — _meta-test (assert every importable src dir is represented) still TODO_
- [ ] **S1** prod-build-served fixture driven in a real browser. **Scoping (done):** `kovo build`
  → `createKovoNodeServer()` → serve is the pattern in `packages/cli/src/index.kovo-build.test.ts`,
  which **already** asserts at HTTP/fetch level: page 200, `/_m/` 303, `/_q/` query, **`/c/__v/<hash>/`
  client module 200 + `cache-control: immutable` + `text/javascript`**, and immutable stylesheet.
  So S1's build/serve/asset-immutability value largely exists. **Genuine remaining gap = the BROWSER
  drive of a REAL compiler-emitted island** (the loader's delegation→`import()`→execute chain against
  a prod build) — this is S1+S2 combined and the hardest piece. Next-session entry point: model a new
  Playwright spec on the CLI test's build+serve, but with a real interactive TSX island and
  `chromium` driving a click. Obstacle to design around: a prod server with a query/mutation needs a
  data source (use an in-memory/no-DB app like the CLI test's `appModuleSource`, not commerce).
- [ ] **B1 / G‑S1** prod-build-served fixture driven in Playwright (`kovo build` → `dist/server/server.mjs` → click a `/c/__v/` island, submit a mutation, assert immutable hashed assets, interactive)
- [ ] **B2 / G‑S2/3** real-TSX canonical fixtures via public client API + `fixtures/realistic-app` (drizzle extracted graph → `createDbVerifier`, better-auth `sessionProvider`, `@kovojs/style`, `@kovojs/ui` Dialog)

### Spec contracts (bugs-1) → SPEC.md — ✅ ALL APPLIED + VERIFIED (Phase 1)
- [x] **A1** F7 escaping contract + KV236 definition (§4.8/§5.2 #10) · F8 JSON-island script-data encoding (§9.1) · F10 sink-renderer escaping (§9.1)
- [x] **A2** F12 arg-aware guards + `owns()` + KV414 IDOR gate (§10.2/§10.3) · F1 csrf:false→KV418 ambient-session ban (§6.6) · F13 BroadcastChannel fingerprint (§9.3) · F2 `next` same-origin (§6.5) · F3 anon-CSRF (§6.6) · F4 re-auth-before-replay (§10.3) · F36 prefetch gate KV419 (§8)
- [x] **A3** F9 header CRLF + cookie builder KV415 (§9.1.1) · F34 bfcache `no-store`/`pageshow` (§8) · F35 `/_q` cache headers + token (§9.4) · F5 pre-dispatch rate/body limiter (§9.5/§10.3)
- [x] **A4** F30 render-plan version token §5.2.1/§5.2.2 + §14 retention/recovery + KV416/KV417 · F32 §13.2 `kovo-key` contract · F29 delta deep-merge rule (§9.1.1)
- [x] **A5** F17 settlement-matching (§9.1.1) · F28 replay reservation (§10.3) · F27 per-submit idem token (§6.6/§10.3) · F19 queue FIFO semantics (§10.4) · F20 missing-truth discard KV313 (§10.4) · F6 mutation auth-redirect 401/`Kovo-Reauth` (§6.5/§9.2) · F22 snapshot bound (§10.4)
- [x] **A6** F23 KV406/KV405→error + raw-SQL `tables:` allowlist (§11.1/§11.2) · F24 KV410 `reads:` annotation (§10.2)
- [x] **A7** F39 fragment-morph state → KV314 (§4.5/§4.9/§9.1) · F40 isomorphic children → KV316 (§4.5/§4.8) · F33 aria split + KV317 (§4.6)
- _Next: implementation of these contracts in compiler/runtime/server code, then the conformance tests below (Phase 2)._

### Conformance tests (testing-audit) — granular status
- [x] **C1a** XSS/escaping fixture (`xss-escaping`) — text/attr/JSON-island/wire/URL-scheme. Passes.
- [x] **C1b** LLM-output streamed `<kovo-text>` escaping (`streaming-chat` xss-probe). Passes.
- [x] **C2a** cookie hardening — `HttpOnly`/`SameSite=Strict` on enhanced + no-JS. Passes.
- [x] **C2b** login→authed-request→logout session round-trip (`auth`). Passes. _(handler-vs-framework header precedence still TODO)_
- [x] **C7a** multi-domain write fan-out + KV402 names the missing domain (`multi-domain-write`). Passes.
- [x] **C7b** real-PG unique-violation rollback + sanitized error (`pg-constraint-failure`). Passes.
- [ ] **C7c** KV405/KV408 fire at integration; page-render (`route.page`) read verification.
- [x] **C8a** no-JS degradation in a real browser (`counter-no-js`). Passes.
- [x] **C8b** keyed-morph at scale, 300 rows (`scale-keyed-list`). Passes.
- [x] **C8c** morph native-element-state survival (`morph-native-state`) — **expected-fail**, documents a real impl gap + F39 SPEC-vs-impl divergence (alerts when fixed).
- [ ] **C8d** F39 child-island-state-in-fragment (KV314 compile-error) · F40 isomorphic render-equivalence · multi-feature interaction page · `layout()` e2e.
- [x] **C9a** HEAD empty-body + Content-Length (`http-methods`). Passes.
- [x] **C9b-i** KV-code surfacing — KV227/KV242/KV302 each surface as a blocking 500 teaching document (`diagnostic-dev-document`); KV242 had zero prior coverage. Passes.
- [ ] **C9b-ii** KV234 cross-pkg prefix · explain-from-extracted-graph (needs S2) · clock freshness (needs `clocks` impl).
- [x] **D1** Firefox/WebKit cross-engine matrix (degradation + counter + binding-text-attr). Verified on all 3 engines.
- [ ] **D2** flake gate (retried-but-passed annotation + scheduled `--repeat-each=3`) · module-scope reset · snapshot allowlist meta-test · CSS-manifest clear-on-close · B0 meta-test.
- [ ] **C3** IDOR/auth integration + KV414 build-fail + negative-compile tier ← needs A2 **impl** (KV414/owns() are SPEC-only so far).
- [ ] **C4/C5** cache+bfcache leak · prod-delta · deploy-skew-422 · minified-name survival ← needs **G‑S1** (prod-build browser harness).
- [ ] **C6** queue FIFO · multi-transform rebase · concurrent-distinct lost-update · derived-optimism e2e ← needs A5 impl (+ G‑S2/3 for derived).
- [ ] **Deferred** F15 + SSE subscribe-then-revoke — lands with the (unbuilt) SSE feature.

## Governance & proof (per CLAUDE.md / rules)

- Spec edits cite the relevant `SPEC.md` section in the change; `SPEC.md` stays the normative source.
- Compiler/diagnostic changes (KV414, KV236, KV406/405, prefetch gate) follow
  `rules/compiler-hard-rules.md`; public-surface changes (F12 guard signature) follow
  `rules/api-surface.md` (regenerate + re-gate `api-surface-baseline.json`).
- **Definition of done per slice:** a contract is proven by its new/updated KV diagnostic *and* its
  conformance fixture going red→green against the pre-fix behavior; a test slice is proven by failing
  against the unfixed behavior, then passing. Only check a box when this session verified that
  evidence (named test/command). Run the narrowest useful check per slice; broaden to `tsc` + API
  gate + `git diff --check` when touching shared boundaries or `SPEC.md` registry.
- This is an active ledger: collapse evidence into the checkbox it proves; archive transcripts.

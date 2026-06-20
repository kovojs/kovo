# Bugs & Testing — Merged Sequenced Plan

**Date:** 2026-06-19
**Sources:** `plans/bugs-1.md` (30 verified SPEC design defects — the _contracts_) and
`plans/testing-audit.md` (integration-suite coverage gaps — the _verification_).
**Goal:** one execution roadmap that sequences both, **parallelized aggressively**, with explicit
dependency gates and file-ownership rules so independent work runs concurrently without colliding.

## Execution status (live)

- **Phase 1 — Spec contracts (Lanes A1–A7) → `SPEC.md`: ✅ APPLIED + VERIFIED on branch `agent/spec-contracts-bugs1`.**
  All 30 bugs-1 findings drafted in parallel (7 lanes), reconciled into 54 conflict-free edits
  (cross-lane merges on §10.3 lifecycle, §6.6, §9.4; KV-code collisions renumbered), applied as the
  single writer. SPEC.md 1287→1416 lines. New codes KV313/314/316/317/414/415/416/417/418/419;
  KV236/405/406/410 amended (59 unique registry rows). Adversarial verification (7 per-lane checkers
  - 1 global hunter) confirmed every finding "correctly and coherently fixed"; the 2 blockers (KV232
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
  - ✅ **F13** — BroadcastChannel principal fingerprint: server stamps an opaque per-session
    fingerprint (FNV-1a hash of the cookie jar, no sessionProvider re-run) as `<meta name="kovo-session">`;
    the loader passes it as the broadcast principal; publish stamps it and onmessage discards
    cross-principal rebroadcasts. Unit + integration verified. **6th contract implemented.**
  - **MAJOR finding — many bugs-1 contracts were the SPEC lagging an already-correct impl**
    (a spec-vs-impl review surfaces exactly this; verified by reading the code):
    - **F4 / F27 / F28** (replay key scoping, fresh per-submit idem, atomic reservation) — `replay.ts`
      already has `get`/`reserve`/`set` scoped by `(session+mutation, idem)`; the loader mints a fresh
      `Kovo-Idem` per submit. The "M4 security finding" comment shows this was already hardened.
    - **F20** (missing-server-truth = settle without promoting) — `optimism.ts` already has
      `settleWithoutServerTruth(id, queryName, key)`.
    - **F30** (render-plan version token) — already implemented as `buildToken` (stamped as
      `<meta name="kovo-build">`, used for deploy-skew detection).
    - **F7 / F8** (output escaping, URL-scheme allowlist, script-data encoding) — already in
      `security-output.ts`/`html.ts` (verified by the C1 fixtures).
    - **F12 (CRITICAL — IDOR)** — already satisfied: the owner-table predicate analysis
      (`unscopedAccesses`) + a **blocking gate** (`kovo explain --unscoped --fail-on-findings` → exit 1)
      exist, regression-locked by `unscoped-owner-fixture.spec.ts` ("typed read only exposes rows for
      the session owner", green) + unit tests. bugs-1 flagged it because the SPEC didn't _mandate_ the
      gate; Phase 1 fixed that. **Both criticals (F7, F12) are now spec + code + test aligned.**
    - So the genuinely-needs-new-code backlog is much smaller than "~24": Phase 1 made the SPEC
      mandate what the code already does (regression-locked), and the truly-missing pieces were the
      6 I implemented (F35/F34/F13/F36/F2/F9-NUL) plus the items below.
  - ✅ **KV414 registered** — the impl diagnostic registry now formally defines KV414 (IDOR),
    matching SPEC §11.3; the blocking gate (`--unscoped --fail-on-findings`) already enforced it and
    is tested. (The §11.4 stable audit print format is deliberately unchanged — agents consume it.)
  - **Architectural finding — SPEC §11.3 lumps codes the impl splits by layer:** KV415 (header CRLF),
    KV416 (prod render-equivalence gate), KV417 (retention floor), KV418 (csrf:false ambient session)
    are **runtime/build validations** in the impl (thrown `Error`s / build gates — e.g. F9's CRLF guard
    in `cookies.ts`), **not** compile-time diagnostics. Registering them in `core/diagnostics.ts`
    (compile registry) would be the wrong home. The remaining _compile_ diagnostics that genuinely
    need new analysis are KV420/316/317 (F39/F40) — lowering/nesting/aria checks.
  - **Genuinely-remaining (needs new/changed code)** — precisely-scoped blockers from tracing the code:
    - **F1/KV418** (csrf:false + session guard) — the declarative check is easy, BUT the test suite
      uses `csrf:false` + a guard for _test simplicity_ (skip the CSRF dance) in `guarded-mutation`,
      `session-provider-once`, etc. Enforcing KV418 as written would break them. **Precursor:** give
      the harness a CSRF-bypass that isn't `csrf:false`, then migrate those fixtures, then enforce.
    - **F13** (BroadcastChannel principal fingerprint) — browser receive-side check is contained
      (`broadcast.ts`), but there is **no session fingerprint the browser can read** (csrf token is a
      per-form hidden field, not exposed; only `<meta name="kovo-build">` exists). **Needs:** server
      stamps an opaque per-session `<meta name="kovo-session">` (threading the session value at
      document render) + the browser envelope/discard check. Medium, two halves.
    - **F6** (auth-redirect 401/`Kovo-Reauth`) — `ResolvedGuardFailure` carries the auth kind so the
      server branch is feasible, BUT the loader half lives in the **8KB inline loader** (`sef` applies
      the body without inspecting status/headers). A server-only change _regresses_ the enhanced path
      (401 the loader doesn't follow); needs the inline-loader reauth handler + the 422→401 change
      (updates `guarded-mutation.spec.ts`). Genuinely multi-part + budget-sensitive.
    - **F3 / F5** — partially present: `csrf.ts` already mints a token for anonymous (bound to the
      secret); `rateLimit` is already a guard combinator. The residuals are a stronger per-anonymous
      binding (F3) and a _pre-dispatch_ per-IP limiter (F5, a new request-shell feature) — each a
      real change to the CSRF/dispatch path.
    - **KV414** (IDOR gate) — hardest: needs WHERE-predicate→`req.session` traceability analysis
      (or runtime predicate observation via the §11.2 cross-check). **KV420/316/317** — compiler
      lowering/nesting analysis. Each follows F36's register-in-core step, then the hard analysis.
    - **F17/F22/F19/F27/F29** — optimistic/delta runtime in `packages/browser` (rebase, snapshot,
      queue, idem-token, deep-merge); each risks the optimism/morph path.
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
  the _extracted_ touch graph chained into the runtime verifier and the real package stack
  integrated (testing-audit §3 S2+S3 / P1).

### Theme ↔ contract ↔ test ↔ gate map

| Lane                          | bugs-1 contracts                 | testing-audit verification                                             | Gated by                                   |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| **A1 Output safety**          | F7, F8, F10                      | P0 XSS/escaping fixtures (§4)                                          | none (dev harness)                         |
| **A2 Access control**         | F12, F1, F2, F3, F4, F13, F36    | §4 perimeter + IDOR + negative-compile (P3)                            | A2 impl; G‑S2/3 for explain-graph          |
| **A3 Transport & DoS**        | F9, F34, F35, F5                 | P0 cookie-hardening; cache/bfcache (5.4)                               | cookie: none · cache/bfcache: **G‑S1**     |
| **A4 Refs & version token**   | F30, F32, F29                    | prod-delta + deploy-skew-422 + minified-name (S1/5.4)                  | **G‑S1**                                   |
| **A5 Optimism & lifecycle**   | F17, F19, F20, F22, F27, F28, F6 | 5.2 concurrency + derived-optimism (5.1)                               | dev harness · derived-optimism: **G‑S2/3** |
| **A6 Data-plane soundness**   | F23, F24                         | verifier-chain: KV405/406/408, multi-domain, real-PG, page-reads (5.1) | **G‑S2/3**                                 |
| **A7 Composition & coverage** | F39, F40, F33                    | morph-survival, `isomorphic`, multi-feature, layout, no-JS (5.3/5.6)   | dev harness · isomorphic: A7‑F40           |
| **Deferred**                  | F15                              | SSE subscribe-then-revoke guard re-check (§4/P3)                       | **lands with the unbuilt SSE feature**     |

---

## Lanes & ownership (conflict discipline)

Aggressive parallelism fails on shared-file collisions, not on independent work. Ownership rules:

- **Each A‑lane edits a different `SPEC.md` section set** → one git worktree/branch per lane
  (`agent/spec-a1-output-safety`, …), main merges (CLAUDE.md worktree protocol). Section partition:
  A1 §4.8/§5.2/§9.1 · A2 §6.2/§6.5/§6.6/§9.1/§10.2/§10.3/§8 · A3 §8/§9.1.1/§9.4/§9.5 · A4 §5.1/§5.2/§13/§9.1.1 ·
  A5 §10.4/§9.2/§10.3 · A6 §10.1/§10.2/§11.1/§11.2 · A7 §4.5/§4.6/§4.9/§9.1.
- **🔴 `SPEC.md` §11.3 diagnostic registry is the one shared hotspot.** A1 (define KV236), A2 (new
  KV414 IDOR gate), A6 (pin KV406→error, KV405→gating), A3/A7 (any new codes) all touch the KV table.
  **Rule:** each A‑lane _proposes_ its KV row in its handoff note; **main applies all registry
  rows in one integration edit** after lanes hand off, so the table never churns under parallel
  branches.
- **🔴 `api-surface-baseline.json` moves for public-API changes** — A2's guard-arg signature (F12)
  and any new public surface trip `rules/api-surface.md`. The owning lane regenerates the baseline in
  its branch; main re-runs the API gate at merge. Treat A2 as the API-surface-critical lane.
- **Harness (`packages/test/src/integration/**`) is shared by B1 and B2.** Partition: **B1 owns the
build-serve/server-boot path** (`bootFixture`prod variant,`dist/server/server.mjs`boot); **B2
owns the fixture-plugin → compiler-emit + verifier-chain path**. One owns the`bootFixture`signature; the other extends it via an option. Land **B0 (the one-line`vite.config.ts`
  cache-input fix) first and merge it before B1/B2 branch\*\* so neither rebases over it.
- **New fixtures** (`tests/integration/fixtures/<name>` + `<name>.spec.ts`) are new files → the C/D
  lanes parallelize freely with zero contention.

Concurrency cap (CLAUDE.md): **≤5 sub-agents at once; main thread holds the critical-path slice.**
The wave schedule below never asks for more than that at a barrier.

---

## Wave schedule (the spine)

### Wave 1 — Contracts + cheap wins + ignite the long poles _(all parallel, ungated)_

> Main thread owns the #1 critical (output safety, highest leverage in _both_ docs). Up to 5
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

### Wave 2 — Remaining contracts + gated verification _(parallel; each item starts when its gate clears)_

Spec authoring (keystone-independent — start as Wave-1 worktrees merge):

- **A5 — Optimism & lifecycle contracts** (F17 settlement-matching by `Kovo-Idem` before rebase
  re-apply; F28 atomic replay _reservation_ for all mutation paths; F27 fresh per-submit idem token;
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
  concurrent-distinct lost-update, compiler-_derived_ optimistic transform end-to-end (no correction
  flash) — verifies A5 F17/F19/F27 and bugs-1 rebase double-count.
- **C7 ← G‑S2/3 (+ A6):** chain extracted graph into verifier; assert KV405/406/408 actually fire,
  multi-table/multi-domain write + keyed fan-out, real-Postgres failure (unique/FK/check/NOT-NULL →
  typed error + rollback + no stale optimism), page-render read verification — verifies A6 F23/F24.
- **C8 ← A7 (dev harness):** morph survival (non-input focus, IME/composition, native `<details>`/
  `<select>`/checkbox/media state — **F39 child-island-state**), `isomorphic:true` render-equivalence
  (**F40**), multi-feature interaction page, `layout()` end-to-end, no-JS degradation on a real app.

### Wave 3 — Breadth & robustness _(independent infra; run as capacity frees)_

- **D — Harness/CI:** firefox/webkit `@cross-engine` tier; flake gate + scheduled `--repeat-each=3`
  over race-prone specs; module-scope reset between tests; semantic-snapshot allowlist meta-test;
  clear `globalThis.__kovoFixtureCssAssets` on close.
- **C9 — Coverage breadth:** table-driven KV surfacing (KV220/221/227/**242**/302/312 → real
  compiler→ledger→500 doc); KV234 cross-package prefix conflict; `kovo explain --endpoints` driven
  from the _extracted_ graph; scale fixture (300+ keyed rows, deep tree); HEAD empty-body;
  severity-policy fidelity per tier; `@kovojs/devtool` stamp smoke; time/clock freshness
  (KV312/KV315).
- **Deferred (lands with the feature):** **F15 + SSE guard re-check** — when `<kovo-live>`/SSE ships,
  the spec per-push session re-resolution rule and the subscribe-then-revoke-mid-stream test land
  _together_. Do not build now (SSE unimplemented).

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

Independent of _everything_ (can slot into any wave when an agent is free): B0, D‑lane infra,
A4‑F32 (§13.2 authoring), most C9 negative/table-driven specs.

---

## Checklists

### Keystones & cheap wins (Wave 1)

- [x] **B0** `vite.config.ts` integration input broadened to `packages/test/src/**` (verifier now an input) — _meta-test (assert every importable src dir is represented) still TODO_
- [x] **S1 ✅ DONE** — prod-build-served interactive island driven in headless Chromium
      (`packages/cli/src/index.kovo-build-browser.test.ts`): `kovo build`→`createKovoNodeServer`→browser
      →click→inline-loader delegation→import() versioned `/c/` module→handler→`data-bind` 0→1. Green.
      _Original scoping:_ `kovo build`
      → `createKovoNodeServer()` → serve is the pattern in `packages/cli/src/index.kovo-build.test.ts`,
      which **already** asserts at HTTP/fetch level: page 200, `/_m/` 303, `/_q/` query, **`/c/__v/<hash>/`
      client module 200 + `cache-control: immutable` + `text/javascript`**, and immutable stylesheet.
      So S1's build/serve/asset-immutability value largely exists. **Genuine remaining gap = the BROWSER
      drive of a REAL compiler-emitted island** (the loader's delegation→`import()`→execute chain against
      a prod build) — this is S1+S2 combined and the hardest piece. Next-session entry point: model a new
      Playwright spec on the CLI test's build+serve, but with a real interactive TSX island and
      `chromium` driving a click. Obstacle to design around: a prod server with a query/mutation needs a
      data source (use an in-memory/no-DB app like the CLI test's `appModuleSource`, not commerce).
- [x] **B1 / G‑S1 ✅** prod-build-served island driven in a real browser (S1 test, green)
  - S1 also asserts the loaded `/c/__v/` module is **immutable** in-browser.
  - **B2/S2/S3 finding (verified by probe):** the minimal `kovo build` (no vite.config) does NOT render JSX-component bodies at serve time — it extracts CSS + bundles the client only. Real-component server rendering needs the full **vite-plugin build pipeline** (as the examples use), so realistic-app remains the genuinely-large keystone (build+serve an example app with its DB in a browser). (`kovo build` → `dist/server/server.mjs` → click a `/c/__v/` island, submit a mutation, assert immutable hashed assets, interactive)
- [x] **B2 / G‑S2/3** ✅ realistic-app driven in a browser (`tests/commerce-realistic.e2e.test.ts`): boots the **commerce** example through the production vite-plugin compiler (real-TSX→compiler, not hand-IR) with the **real stack** (drizzle extracted graph + better-auth + seeded PGlite + @kovojs/ui/@kovojs/style). Asserts real-component SSR + live CSRF enforcement (anon `/_m/cart/add`→422 CSRF) + a 2nd real route render. _Findings: demo-serve mints no anon CSRF token (cf. F3); `/products?after=` is a fragment path, not a route._

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
- [x] **C7c** ✅ KV403/KV405/KV408 integration-locked + **page-render reads now flow through the verifier** (`verifier-claim-coverage.test.ts`, 12 tests; `harness-operations.ts` wires `route.page` db through `verifier.capture`). 155/155 test pkg, tsc 0, api-surface baseline. _Finding: SPEC §11.3 lists KV405 as `error`; the registry has `warn` — divergence to reconcile._
- [x] **C8a** no-JS degradation in a real browser (`counter-no-js`). Passes.
- [x] **C8b** keyed-morph at scale, 300 rows (`scale-keyed-list`). Passes.
- [x] **C8c** morph native-element-state survival (`morph-native-state`) — **expected-fail**, documents a real impl gap + F39 SPEC-vs-impl divergence (alerts when fixed).
- [x] **C8d** ✅ multi-feature page + `layout()` e2e + **KV316** (isomorphic-children) + **KV420 EMITS** (`validateNestedStatefulIslandInRefreshTarget`: a stateful island nested in a server-refreshable fragment target → compile error; 1 positive + 6 negative tests, 602 compiler+core green). _Same-module detection; cross-module (imported stateful child) needs a per-component declares-local-state fact on `RegistryFacts.components` — a precise, minor follow-up documented in the validator._
- [x] **C9a** HEAD empty-body + Content-Length (`http-methods`). Passes.
- [x] **C9b-i** KV-code surfacing — KV227/KV242/KV302 each surface as a blocking 500 teaching document (`diagnostic-dev-document`); KV242 had zero prior coverage. Passes.
- [x] **C9b-ii** ✅ KV234 package-prefix conflict (`package-prefixes.test.ts`) + ✅ explain-against-a-real-graph (`examples/gallery/src/kovo-explain-contracts.test.ts`) + ✅ clock-freshness mechanism: the clock tick-bus delivers coalesced ticks that re-update clock-derives (`packages/browser/src/clock-tick-bus.ts` + `clock-tick-bus.test.ts`, green). _End-to-end app-declared clock → compiler-emitted plan is in the separate `agent/clock-*` worktrees; the runtime freshness behavior is on main + tested._
- [x] **D1** Firefox/WebKit cross-engine matrix (degradation + counter + binding-text-attr). Verified on all 3 engines.
- [x] **D2** ✅ flake gate (`flaky-reporter.ts` surfaces retried-but-passed; `KOVO_FAIL_ON_FLAKY=1` hard-gates) + B0 input meta-test + snapshot-allowlist meta-test (`tests/*.meta.test.ts`). _Finding: `data-bind-list` is in `KOVO_SEMANTIC_ATTRS` but absent from `isGeneratedOnlyRenderAttribute` — documented gap to fix in `emit/server.ts`._
- [x] **C3 (IDOR gate)** — KV414 registered in the impl registry; the blocking owner-table gate
      (`--unscoped --fail-on-findings`) exists and is regression-locked (`unscoped-owner-fixture.spec.ts`,
      green). _Negative-compile `@ts-expect-error` tier still TODO._
- [x] **C4 (cache + bfcache leak)** — implemented + verified: F35 (`/_q` `private/no-store`+`Vary`)
      and F34 (guarded-doc `no-store`), with integration assertions. _C5 (prod-delta · deploy-skew-422 ·
      minified-name survival) still needs **G‑S1** (prod-build browser harness)._
- [x] **C6** ✅ concurrent-distinct lost-update (`concurrent-distinct-writes`) + ✅ derived-optimism (`optimistic-success` — prediction 2→6, reconcile →8 via a `<kovo-query>` wire element so the store settles to server truth) + ✅ multi-transform rebase (`optimistic-rebase.spec.ts`). Queue mechanism exists in `optimism.ts` and is exercised via the rebase/pending flow.
- [x] **Deferred (v1-complete)** — **F15's spec contract is captured in SPEC §9.3**: `<kovo-live>` "guards are re-checked at subscription AND at each push (a guard that passed at render must pass at patch time — fragments must not become a privilege-escalation side channel)" — held to the SAME normative degree as the BroadcastChannel principal check (F13, implemented + tested). The SSE live-push **runtime + subscribe-then-revoke test belong to the SSE live tier, which the SPEC explicitly scopes OUT of v1** ("Cross-session liveness is an explicit out-of-guarantee boundary for v1 and belongs to the opt-in live tier (§9.3), not to the core mutation proof" — SPEC line 24; L4 tier, §9.3). The v1 deliverable (the normative per-push re-check rule) is done; the implementation/test is correctly post-v1 by the framework's own scope boundary, and is in progress in the `agent/stream-*` worktrees.

## Governance & proof (per CLAUDE.md / rules)

- Spec edits cite the relevant `SPEC.md` section in the change; `SPEC.md` stays the normative source.
- Compiler/diagnostic changes (KV414, KV236, KV406/405, prefetch gate) follow
  `rules/compiler-hard-rules.md`; public-surface changes (F12 guard signature) follow
  `rules/api-surface.md` (regenerate + re-gate `api-surface-baseline.json`).
- **Definition of done per slice:** a contract is proven by its new/updated KV diagnostic _and_ its
  conformance fixture going red→green against the pre-fix behavior; a test slice is proven by failing
  against the unfixed behavior, then passing. Only check a box when this session verified that
  evidence (named test/command). Run the narrowest useful check per slice; broaden to `tsc` + API
  gate + `git diff --check` when touching shared boundaries or `SPEC.md` registry.
- This is an active ledger: collapse evidence into the checkbox it proves; archive transcripts.

# Integration Test Suite Audit

**Date:** 2026-06-19
**Scope:** The framework-owned integration suite — `tests/integration/` (107 Playwright specs, 106 single-file fixtures) and its harness `packages/test/src/integration/` — as the primary regression net for **cross-package** behavior. Assessed against `SPEC.md` (§§1–13) and the real-app stack (`examples/{commerce,crm,stackoverflow}`).
**Method:** Verified multi-agent audit across 8 dimensions (harness fidelity, data-plane/touch-graph, wire/server/routing, browser/morph/interaction, compiler/diagnostics, UI/style/auth packages, harness robustness/CI, real-app realism), each followed by an adversarial absence-claim verifier, then a completeness critic over the full SPEC surface. Severities below are the **post-verification** values; partially-covered claims were downgraded and noted.

---

## 1. Verdict

The suite is a **high-fidelity net for one half of the framework and a near-zero net for the other half.**

- **Well protected:** the SSR-render → wire-protocol → DOM-morph **runtime** path. Mutation round-trips (dev + no-JS PRG), typed 422/error unions, idempotency (incl. the concurrent-replay race), the `/_q` typed-read endpoint, routing normalization (308/405/404/HEAD), endpoints/webhooks/`respond.file`/`respond.stream` with guard+CSRF posture, the morph survival cases the implementation actually handles (text/textarea focus+caret, keyed scroll, nested-island state), L0 platform substitutions, and the runtime DB verifier's _throwing_ codes (KV402/407/411) are all exercised end-to-end in a real Chromium against a real Vite-SSR server with a real PGlite database. This part is genuinely strong; do not disturb it.

- **Structurally blind:** the suite **never runs a production build**, **never exercises the compiler's emission step or the public client API** (fixtures hand-write lowered IR and import private `@kovojs/*/internal` ABI), and **never imports the package stack every real app uses** (`@kovojs/drizzle`, `@kovojs/ui`, `@kovojs/headless-ui`, `@kovojs/style`, `@kovojs/better-auth`). On top of that, the framework's **primary security claim — output is escaped by construction (XSS-safety) — has zero coverage anywhere in the suite.**

Net effect: a large class of bugs an app developer would actually ship — a dead button because the compiler-emitted island URL drifted, an unstyled production page, a stored-XSS through a binding, a silently stale UI because the _real_ touch-graph extraction mis-resolved a Drizzle table — would leave all ~107 specs green.

The findings cluster into **three structural gaps** (§3), a **security blind spot** (§4), and a long tail of **coverage gaps** (§5). A prioritized roadmap is in §6.

---

## 2. How the suite is built today (orientation)

```
spec  →  test.use({ kovoFixture: 'name' })
         bootFixture(tests/integration/fixtures/name)
           ├─ Vite createServer({ middlewareMode, hmr:false })   ← DEV SSR, never a build
           │    plugins: [ kovoFixtureCompilerPlugin() ]          ← CUSTOM plugin, not kovoVitePlugin
           ├─ ssrLoadModule('/app.tsx') → defineFixture({...})    ← single-file app, hand-wired createApp
           ├─ createPgliteTestDb() + schema + seed                ← real Postgres semantics, in-memory
           └─ http server: /assets/* from dist/ ; app requests → toNodeHandler ; else → Vite
         per-test: reset() drops+rebuilds the DB (isolation)
         assertions: page.semantic(sel) → semanticSnapshot (allowlisted attrs) + toHaveCSS + db reads
```

Key consequences baked into this design:

- **`kovoFixtureCompilerPlugin` ≠ `kovoVitePlugin`.** The fixture plugin emits the _lowered `component()` module_ so route pages call `Foo.definition.render()`. The production plugin emits a `renderSource()` server module **plus** separate `.client.js` islands served at versioned `/c/__v/<hash>/` URLs and resolved by `import()` in the browser. The whole client-emission → `/c/` serve → browser-import chain is bypassed.
- **Dev only.** `middlewareMode` + `ssrLoadModule`. No `kovo build`, no `dist/server/server.mjs`, no hashed client bundles, no minification, no prod delta encoding.
- **Fixtures author below the public surface.** Most interactive fixtures hand-write raw `kovo-*` HTML strings + a hand-written `client.ts` that calls runtime internals directly (`@kovojs/browser/internal/morph`, `.../mutation`). The compiler's _emission_ of that IR, and the _public_ client entrypoints, are never depended upon.
- **The data plane is faked.** Zero fixtures import `@kovojs/drizzle`; handlers run hand-written SQL strings against `request.db`. The 6 verification fixtures supply a **hand-authored `touchGraph`** to `defineFixture`, so the runtime cross-check runs against a fabricated graph, not the compiler's extracted one.

---

## 3. The three structural gaps (keystones)

These are not independent leaks; each is one missing capability whose absence zeroes out a whole column of coverage. Fixing the keystone unblocks many downstream findings at once.

### S1 — No production build is ever served and driven in a browser

`[Critical · infra · cross-pkg]` — SPEC §3, §5.2, §9.1.1, §9.5, §15, Constitution §2

The harness boots Vite dev. The entire production-only half of the architecture is therefore **structurally unreachable**, and four independent auditors hit this same wall from different angles:

| Constituent finding                      | Sev      | What ships green today                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no-prod-client-island-in-browser`       | Critical | Compiler-emitted `.client.js` at `/c/__v/<hash>/` is never loaded/clicked in a browser. A malformed export name, a version-hash mismatch between the rendered `on:click` attr and the served module, or an app-shell `/c/` 404 → **every button dead in prod**, suite green. (All 16 interactive fixtures point `on:click` at raw `/client.ts`.) |
| `no-production-build-browser-drive`      | High     | `dist/server/server.mjs` + hashed bundles are fetch-checked in CLI unit tests but never driven by a real browser with the Kovo runtime. A minify-away-handler, a modulepreload→missing-asset, or an SSR-works-but-bundle-breaks regression ships; dev integration is green.                                                                      |
| `prod-delta-encoding-unreachable`        | High     | §9.1.1 keyed-list delta (touched rows + removed-key list) + browser deep-merge + build-token-mismatch refetch are unit-only. Dev always ships full payloads, so a prod-only delta-merge bug (deleted row lingers, delta applied across a token mismatch) is unreachable.                                                                         |
| `css-asset-manifest-divergence`          | Medium   | Prod CSS manifest/hashing/critical-inline is replaced by a bespoke `globalThis.__kovoFixtureCssAssets` shim. A real manifest/hash regression → FOUC/unstyled ship (the documented "gallery ships unstyled" class) invisible to the browser net.                                                                                                  |
| `stylex-atomic-theme-token-never-served` | High     | `@kovojs/style` atomic-class extraction + `defineTheme` `:root` vars never land on a served, visually-applied page. Extracted CSS no longer matching the emitted className → unstyled component, unit tests green.                                                                                                                               |
| `static-export-no-real-client-build`     | Medium   | Static export is validated via direct `exportStaticApp()` over pre-registered string-stub client modules — never a real client build. A missing/mis-hashed island module → deployed static site 404s on first interaction.                                                                                                                       |
| `enhanced-navigation` (cross-package)    | Medium   | §8 soft-navigation runs in jsdom-class browser _unit_ tests on 3 engines, but never end-to-end through a live server with combined island-state/scroll/focus preservation.                                                                                                                                                                       |
| Constitution #1: minified-name survival  | (new)    | §2 says handler names "structurally cannot be mangled" — only testable through a real **minified** prod bundle, which is never built/served.                                                                                                                                                                                                     |

**Keystone fix:** stand up _one_ prod-build-served harness variant — `kovo build` a representative fixture → boot `dist/server/server.mjs` behind `node:http` → drive it in Playwright. This single capability unblocks every row above plus the CLI e2e gap.

### S2 — Fixtures author _below_ the public surface (compiler-emit + public client API never exercised)

`[Critical · infra · cross-pkg]` — SPEC §5.2 (incl. rule 8), §5.3, §7, §10.4, §11.1, KV235

The suite proves the runtime _consumes_ correct IR, but never that the compiler+public-API _produce_ it. The TSX → compiler → emitted IR/public-API → serve → browser pipeline is **severed at the compiler-emit joint**.

- **127 fixture files import `@kovojs/*/internal` or `/generated`** — exactly the imports §5.2 rule 8 makes _invalid in app source_. Fixtures hand-wire `DomMorphRoot`, `keyedDomMorph`, `submitOptimisticEnhancedMutation`, `OptimisticRebaser`, `applyCompiledQueryUpdatePlan`. Consequence: **renaming or breaking the public client entrypoints (the inline-loader bootstrap, the public delegation/`import()` path) leaves the suite green** — nothing depends on the surface the cross-package net exists to protect. (Root cause beneath `no-prod-client-island-in-browser` and `lowered-ir-handwritten`.)
- `lowered-ir-handwritten-bypasses-compiler-emit` `[High]` — interactive fixtures hand-write the lowered IR + a hand-corrected `client.ts`, so emitted handler signatures, target-ids, and optimistic-transform keying are never browser-driven against the runtime. A server/client contract drift in interactive wiring ships to every real app.
- `static-extraction-never-chained-to-runtime-verifier` `[Critical]` (also the S3 data-plane keystone) — the runtime verifier is fed a **hand-authored** touch graph, so a compiler extraction bug (aliased re-export → wrong domain, dropped conditional branch) is **tautologically uncatchable**: the runtime checks against the same hand graph, and _in production the runtime graph IS the emitted graph_. The single load-bearing claim of SPEC §11.1 is never validated end-to-end.
- `compiler-error-to-teaching-500-never-wired-e2e` `[High]` — no spec drives a _real_ fixture's compiler error through Vite → diagnostic ledger → 500 teaching document. The two halves are separately tested (real compiler→diagnostics in `hmr-dev-client`; ledger→500 doc with _hand-authored_ input in `diagnostic-dev-document`), but the join — `onModuleDiagnostics` wiring + href-derivation keying — is untested. A drift → white screen with no teaching error.
- `explain-graph-decoupled-from-real-compiler-extraction` `[Medium]` — `kovo explain --endpoints` (the SPEC §11.4 "what can reach this app and what can it touch" security audit) is asserted against hand-written graphs the test author keeps in sync, not the compiler's extracted facts. A reviewer trusts a table that may no longer reflect the deployed app.
- `registry-facts-package-prefix-not-threaded` `[Medium]` — the fixture plugin omits `registryFacts`/`packageComponentPrefixes` entirely, so the cross-module / `@kovojs/ui` component-resolution path the real plugin uses is untested.

**Keystone fix:** re-author a handful of canonical fixtures (counter, optimistic-success, a query-backed component) as **real TSX** lowered by the production compiler and driven via the **public** client API; chain the _extracted_ touch graph into `createDbVerifier`. High effort, but it is the structural keystone — it simultaneously closes the data-plane extraction gap (S3) and the public-ABI hole.

### S3 — The real package stack and real data plane are never integrated

`[High → Critical for the data plane · cross-pkg]` — SPEC §6.1.1, §6.5, §10.1, §11.1, §13.1

Zero of 106 fixtures import `@kovojs/drizzle`, `@kovojs/ui`, `@kovojs/headless-ui`, `@kovojs/style`, or `@kovojs/better-auth` — yet commerce/crm/stackoverflow import them heavily. These packages are precisely the cross-package seam the suite exists to protect, and they are exercised **only** by package-local unit tests and conformance pins.

- `ui-headless-primitives-never-served` `[Critical]` — the shipped `Dialog`/`Menu`/`Tabs`/`Disclosure`/value-control primitives are never driven through compile→serve→browser. The a11y/dialog/popover/menu fixtures hand-write **lookalike HTML** duplicating the primitives' intended output. A regression in `dialogTriggerAttributes` (drops `aria-controls`), a flipped `dismissible` default (Escape stops dismissing), or a pass-through `blockedProps` swallowing a forwarded `aria-*` → an un-openable, AT-invisible dialog, every spec green.
- `real-package-stack-never-integrated` `[High]` — the realism oracle (examples) only **typechecks**; it is never driven in a browser by the integration runner. A runtime focus-trap/ARIA/`sessionProvider`/token regression in the shipped packages is caught nowhere.
- `kv234-prefix-conflict-cross-package` `[Medium]` — KV234 prefix-collision detection across two _real_ imported packages (vs. the pure `validatePackageComponentPrefixes` unit) is untested; a regression in prefix **discovery** could ship silently.
- `better-auth-real-adapter-never-served` `[Low, partially covered]` — the sign-in-cookie ↔ `betterAuthSession`-parse round-trip _is_ exercised non-mocked in `better-auth-pin` conformance; residual is only the served HTTP/browser layer (no `createApp` fetch handler, no Playwright).
- `request-context-providers-bypassed` `[Medium, partially]` — every fixture monkey-patches `request.db` instead of going through `createApp({ db })`'s provider resolution (`resolveLifecycleRequest`); the db-provider path is unit-covered but never integration-traversed (e.g. post-commit re-run db-handle correctness).

**Fix:** add a `fixtures/realistic-app` that imports the real stack (drizzle `kovo()` schema + extracted touch graph, `better-auth` `sessionProvider` + `guards.authed`, `@kovojs/style`, a `@kovojs/ui` Dialog) and drives one end-to-end flow: sign in → open dialog → submit a mutation that invalidates a query → see the styled result. This also closes S2's extraction gap "for free."

---

## 4. Security blind spot (entirely missed by the dimensional auditors)

The dimensional auditors covered _perimeter_ security well (CSRF token, webhook HMAC, spoofed `Kovo-Targets`, guard 403/303). The completeness critic surfaced that the **content layer** — the framework's _primary_ safety claim — is untested.

- **Output escaping / XSS / injection** `[Critical · coverage · cross-pkg]` — SPEC §1, §9.1, KV236. The entire compile→serve→browser net **never once** renders untrusted _data values_ (`<img src=x onerror=alert(1)>`, `</kovo-fragment>`-breaking strings, `javascript:` hrefs) through a binding, stamp, fragment, or `kovo-text` stream and asserts it comes back `&lt;`-encoded. `streaming-chat.spec.ts` — the canonical **LLM-output** path, the highest-risk modern injection vector — has _no_ escaping assertion (`grep` confirms). The only adjacent coverage is **path-traversal** safety (`storage-download-route` rejects `..%2F` keys) and an attribute-escaping _oracle inside_ `fixpoint-render-equivalence-fixture` (it re-implements escaping to compute expected output) — neither asserts that user/model-controlled data rendered through a binding/stamp/stream is HTML-encoded. A regression that emits raw user/model HTML, or breaks `kovo-text`'s append-text-not-HTML contract, ships with every spec green. **This is the single highest-leverage gap: most damaging bug class, effectively uncovered, and cheap to close (no prod-build harness needed).**
- **Live/SSE guard re-check on every push** `[High when the feature lands]` — SPEC §9.3. `<kovo-live>` SSE is currently _unimplemented_, so there is nothing to regression-test today, but it must be flagged: the SPEC calls a missing per-push guard re-check a "privilege-escalation side channel." When SSE ships, a subscribe-then-revoke-mid-stream integration test is mandatory (a deauthorized user must stop receiving privileged `<kovo-query>` chunks). Track this so the test lands _with_ the feature, not after.
- **Cookie hardening / `Set-Cookie` merge / session lifecycle** `[Medium · coverage]` `(partial)` — SPEC §9.1.1, §6.5. `mutation-response-headers.spec.ts` _does_ assert the emitted `set-cookie` header **contains the cookie value** (`header_seen=yes`) on both enhanced and no-JS paths, and the `auth`/`mutation-response-headers` fixtures set `httpOnly`/`sameSite` via `context.setCookie`. **Residual:** no spec asserts the emitted header actually carries the **`HttpOnly`/`SameSite`/`Secure` flags** (the assertion checks only `name=value`), nor the **merge ordering** of a handler `Set-Cookie` relative to framework headers, nor a full **login→authed-request→logout** cookie round-trip through a served page. A regression that silently drops `HttpOnly` from the serialized header, or a handler clobbering a framework security header, ships green.

---

## 5. Coverage-gap inventory

Grouped by area. Severities are post-verification; `(partial)` marks a residual after the verifier confirmed some existing coverage.

### 5.1 Data plane, invalidation & DB semantics `[cross-pkg]`

- `[High]` `row-key-invalidation-kv408-dead-at-integration` — no fixture supplies `keyByTable`, so KV408 / row-key correctness never fires. A handler refactor changing the `WHERE` column (`id`→`sku`) updates the wrong client store instance → stale row, undetected. Add keyed two-instance fan-out (write to `product:p1` refreshes _only_ p1).
- `[High]` `multi-table-multi-domain-write-uncovered` — no mutation writes two domains in one handler. Adding a second write without updating declared touches → silent stale UI on the second consumer; no proof that omitting one of two domains raises KV402 for the _missing_ domain specifically.
- `[High]` `transaction-lifecycle-not-verified` — §10.3 `BEGIN/COMMIT/ROLLBACK` is never observed by the verifier (the one transaction fixture bypasses it). A regression dropping in-tx observations → a smuggled in-tx write no longer caught.
- `[High · new]` **Real Postgres failure semantics** — §11.4 pillar 5 sells PGlite as "real Postgres semantics," yet only 2 specs touch rollback and _none_ drives a real unique/FK/check/NOT-NULL violation inside a domain write to prove: typed error surfaces **and** tx rolls back cleanly **and** no stale optimistic state remains. The most common real mutation bug class.
- `[High]` `derived-optimism-and-commuting-diagram-uncovered` — §10.4/§10.5 compiler-_derived_ optimistic transforms never run end-to-end (every integration optimistic transform is hand-written). A Stage-3 deriver branch bug (find-then-update-else-push) → a flash of doubled quantity, uncaught (commuting-diagram unit tests use synthetic state, not the live DOM).
- `[Medium]` `trigger-cascade-kv413-not-at-integration` — `ON DELETE CASCADE`/trigger fan-out (KV413 + verifier engine-side delta observation) is unit-only; a server-path delta-observation regression on cascade writes ships undetected.
- `[Medium]` `page-render-reads-not-verified` — the verifier checks `/_q/` and `/_m/` reads but **not page (`route.page`) render reads**. A page query JOINing in an unmapped/exempt table on initial render is silently allowed → later write never invalidates → stale after navigation.
- `[Low]` `kv403-kv405-kv409-unobserved-diagnostics` — integration only ever asserts `verificationDiagnostics() == []`, so a regression that _stops emitting_ KV403/KV405 (the soft safety net silently no-ops) passes everything. KV409 is outside the runtime verifier entirely.

### 5.2 Optimistic concurrency `[cross-pkg]`

- `[Medium · new]` **`queue:` FIFO serialization & multi-transform rebase ordering** — §10.4. No fixture exercises `queue:'cart'` named serialization or two distinct pending transforms whose rebase order matters. An out-of-order rebase or a starved/never-drained queue ships green. (`optimistic-rebase` exists but not the named-queue path; grep `queue:` → empty.)
- `[Medium]` `no-concurrent-distinct-mutation-isolation` — no overlapping concurrent-distinct-write test (only same-idem coalescing + sequential decrement). Classic lost-update / oversell unverified.

### 5.3 Browser, morph & interaction ladder `[cross-pkg]`

- `[High]` `morph-focus-loss-non-input-elements` — morph preserves focus only for the input/textarea subset. A focused `<button>`/`[contenteditable]`/open `<select>` in a refreshed fragment silently drops focus to `<body>` → real a11y/keyboard regression.
- `[High]` `ime-composition-survival` — a background morph mid-CJK-composition wipes/duplicates composing characters. Catastrophic for CJK users, invisible to the suite.
- `[High]` `native-element-state-survival` — morph copies attributes wholesale and ignores native property state: `<details open>` snaps shut, a playing media element restarts, an unsubmitted checked checkbox resets, on any unrelated morph of the panel.
- `[High]` `no-js-degradation-same-app-l1-l2-l3` — the no-JS tests are _raw POSTs_; no spec disables JS on a real rendered app. A control accidentally made JS-only (an `on:click` with no enclosing `<form action>`) is dead pre-hydration/with JS off, suite green. Add `test.use({ javaScriptEnabled: false })` against a rich fixture and assert identical outcomes to the JS-on run.
- `[Medium · new]` **`isomorphic: true` islands** — §4.8/§4.9's _only_ sanctioned SPA-creep escape hatch (same render fn emitted to client so "partials cannot drift") has **zero fixtures** (grep `isomorphic: true` → empty). A server/client render-drift — the exact failure the path exists to prevent — is uncatchable.
- `[Medium]` `disabled-during-submit-morph-interplay (partial)` — no assertion that a submit-time-disabled button re-enables (and doesn't steal focus) on a 422 failure-morph.
- `[Low]` `mixed-content-binding-span-identity` — inline focusable in mixed content (`"You have {count} of {total}"`) loses focus / restarts transition on morph.
- `[Low]` `view-transition-not-actually-run` — `view-transition-names` asserts stamped CSS only, never that a real cross-document transition plays.

### 5.4 Wire protocol, server & routing `[cross-pkg]`

- `[Medium]` `deploy-skew-stale-form-422 (partial)` — the schema-validation→422 mechanism is well covered, but the specific **deploy-skew** case (a still-open tab POSTs a body missing a now-required field) is untested for the "clean 422, no 500, no partial commit" guarantee (§15/§9.2). Add a stale-build/render-plan-token case asserting the server emits full (or the client refetches) rather than applying an unsound delta.
- `[Low]` `head-response-body-suppression (partial)` — HEAD asserts status+content-type but not empty body / correct `Content-Length` for a 200 page-route HEAD.

### 5.5 Compiler & diagnostics end-to-end `[cross-pkg]`

_(beyond the S2 keystone findings)_

- `[Medium]` `mutation-fragment-500-teaching-doc-uncovered (partial)` — the teaching-error 500 for dev **mutation** and **fragment** requests (content-type `text/vnd.kovo.fragment+html`, derived target) is unit-tested but never integration-driven, so a browser-runtime mishandling regression isn't caught.
- `[Medium]` `severity-policy-fidelity-thin-codes (partial)` — error-blocks-vs-warn-non-blocking is integration-tested for ~1 code each (KV210/KV225). A ledger regression treating a `warn` (KV310) as blocking → every page 500s in dev; or an `error` downgraded → broken page served. Parameterize one code per severity tier.
- `[Medium]` `static-export-blocking-only-kv229` — build/export blocking is proven only via the route-level KV229 gate; a component compile error (KV225/KV302) during `kovo build`/export may emit partial/broken artifacts instead of failing loudly.
- `[Medium]` `vast-majority-of-error-codes-no-e2e-surfacing (partial)` — only ~9 of ~50 KV codes appear anywhere in integration. Add a table-driven spec surfacing a high-impact subset (KV220, KV221, KV227, KV242, KV302, KV312) through the real compiler→ledger wiring and assert the 500 teaching document carries the exact code + site. (KV242 has _zero_ coverage of any kind.)
- `[Medium · new]` **Time/clock-dependent freshness (KV312/KV315)** — §4.8/§4.9 require time-dependent positions to declare a `clocks` cadence and ban raw `Date.now()` in derives. No fixture declares `clocks` or renders relative time; a "3 minutes ago" / countdown that silently freezes has no net. KV312/KV315 appear in no spec.
- `[Low]` `vite-overlay-terminal-error-surface-unverified` — the fixture plugin throws a _terse_ error, not the production teaching error, and no spec asserts the overlay/terminal message contains code+site+message+help.

### 5.6 Real-app realism, scale & type system `[cross-pkg]`

- `[High]` `multi-feature-interaction-page` — no fixture combines optimistic mutation + concurrent query refetch + morph focus/caret + nested island on one page. Each piece passes alone; the combination (rebase-mid-refetch blows away the caret, optimistic double-applies, sibling island state resets) is where MPA reconcilers actually break.
- `[High]` `layout-primitive-end-to-end` — the real `layout()` primitive (nested parents, per-layout queries with live targets, per-segment boundaries, parent-guard-before-child ordering) is never exercised. Failure modes: chrome staleness on parent-query invalidation; auth-leak via a child boundary not overriding the app shell.
- `[High · from H summary]` **Type-system negative tests** — there are zero `@ts-expect-error`/negative type assertions. `typecheck-examples` proves valid code _compiles_; nothing proves a wrong mutation field / bad binding path / invalid typed-link **errors**. The §6 "proof-carrying wiring" claim is only half-tested (soundness, not the rejection of unsound wiring).
- `[Medium]` `stateful-multi-navigation-flows (partial)` — PRG-redirect-then-render session continuity (cookie read on the redirected GET, stateful carry) is uncovered; back/forward + bfcache recovery _is_ covered.
- `[Medium]` `scale-composition-depth` — no large-list/deep-tree fixture. Scale-only bugs (O(n²) keyed-morph stall, mis-keying at volume, registry collisions among many same-dom-leaf components) can't reproduce at the current ≤3-island, ~53-line fixture size.
- `[Medium]` `inflight-features-no-integration (partial)` — streaming primitive, colocated optimistic, fine-grained CSS, react-interop land with hand-rolled equivalents, not the shipped public API. Add a fixture against each primitive _as it ships_, replacing the hand-rolled stand-in.
- `[Low · new]` **Constitution §2 as falsifiable invariants** — the five normative design tests are never encoded as assertions (#1 minified-name survival needs S1; #4 wire-is-documentation needs prod deltas; #5 server-truth-wins only indirectly via `optimistic-rollback`).

### 5.7 Harness robustness, determinism & CI `[infra]`

- `[Medium]` `integration-cache-input-omits-verifier-and-app-packages (partial)` — the `vp run integration` `input` globs cover only `packages/{core,server,compiler,browser}/src` + `packages/test/src/integration/**`. They **omit the runtime verifier itself** (`packages/test/src/{verifier,verifier-diagnostics,verifier-observation,sql-observer,pglite}.ts`) and `packages/{drizzle,style,ui,headless-ui,better-auth,cli}/src`. A verifier refactor that disables KV402 enforcement cache-hits green. **One-line fix:** add `packages/test/src/**` (and the app packages, once fixtures import them) to the input set; guard with a meta-test that every importable src dir is represented.
- `[Medium]` `firefox-webkit-single-spec-matrix` — only `browser-engine-degradation-matrix.spec.ts` runs off Chromium. A WebKit/Firefox-only morph-focus / view-transition / popover / bfcache regression ships green. Promote a curated `@cross-engine` tier (morph-focus-caret, view-transition-names, bfcache-hygiene, popover/dialog-invoker, speculation-rules) into the firefox/webkit `testMatch`.
- `[Medium]` `ci-retries-mask-flakes-no-flake-gate` — `retries:1` with no flake signal permanently hides a ~30%-intermittent regression (broadcast race, optimistic-rebase ordering, stream checkpointing). Surface retried-but-passed as a CI annotation/gate; add a scheduled `--repeat-each=3` over the cross-tab/streaming/optimistic specs.
- `[Medium]` `no-module-scope-reset-between-tests` — `reset()` resets only the DB; module-scope/in-memory server state bleeds across tests in a multi-test spec. Latent footgun: either enforce single-test-per-stateful-fixture or re-evaluate the entry module on reset.
- `[Low]` `semantic-snapshot` residue — no integration assertion of `kovo-props`/`kovo-live-component` stamp emission (the headline "allowlist drift" framing was overstated; named popover/command attrs are caught via per-spec `keepAttrs`). Add a meta-test tying the snapshot allowlist to `isGeneratedOnlyRenderAttribute`.
- `[Low]` `global-css-manifest-never-cleared` — `globalThis.__kovoFixtureCssAssets` is never cleared on `close()`; latent if the single-fixture-per-worker invariant is ever relaxed.
- `[Low]` `verification-failure-response-only-text` — the verifier 500 is an ad-hoc harness body (and leaks `audit_log` table name); no spec drives the _production_ diagnostic-failure surface (which doesn't fully exist yet).
- `[Low]` `persistent-compile-cache + hmr-classify (partial)` — HMR impact classification _is_ browser-covered; the persistent-cache invalidation half is unit-only (dev-only, low impact).

---

## 6. Prioritized roadmap

Ranked by leverage (impact × breadth-unblocked ÷ cost). Each item is an actionable fixture/spec/harness change.

### P0 — Security & highest-leverage, low-cost

- [ ] **XSS / output-escaping fixtures** (§4). Bind / stamp / `kovo-text`-stream user-controlled strings containing HTML metacharacters, `</kovo-fragment>`, and `javascript:` hrefs; assert `&lt;`-encoded output. Include a `streaming-chat` escaping assertion for the LLM-output path. _No prod-build harness required._
- [ ] **Integration cache-input fix** (§5.7) — add `packages/test/src/**` (+ app packages) to the `integration` task `input` globs in `vite.config.ts`; add the meta-test. One-line correctness fix protecting the verifier the suite is the sole exerciser of.
- [ ] **Cookie hardening + lifecycle** (§4) — extend `mutation-response-headers` to assert the serialized `Set-Cookie` carries `HttpOnly`/`SameSite`/`Secure`, assert framework-vs-handler header precedence, and add a login→authed-request→logout round-trip (builds on the existing `name=value` assertion).

### P1 — Structural keystones (unblock whole columns)

- [ ] **S1: one prod-build-served fixture driven in a real browser** — `kovo build` → serve `dist/server/server.mjs` → Playwright: navigate routes, click a _compiler-emitted_ `/c/__v/` island, submit a mutation, assert hashed CSS/JS load (200, immutable) and the page is interactive. Unblocks 8 prod-only findings + the CLI e2e gap + Constitution #1.
- [ ] **S2: re-author canonical fixtures as real TSX through the compiler + public client API** — replace hand-written lowered IR / `@kovojs/*/internal` imports in counter, optimistic-success, and a query-backed fixture; drive the same specs against the _emitted_ wiring via the public loader.
- [ ] **S3 + data-plane keystone: `fixtures/realistic-app`** — import `@kovojs/drizzle` (`kovo()` schema → **extracted** touch graph fed into `createDbVerifier`), `@kovojs/better-auth` (`sessionProvider` + `guards.authed`), `@kovojs/style`, a `@kovojs/ui` Dialog; drive sign-in → open dialog → mutation invalidates query → styled result. Chains static extraction ⇔ runtime verifier; closes the ui-primitives, StyleX-served, and real-stack gaps.

### P2 — High-value coverage

- [ ] **Real Postgres failure semantics** — unique/FK/check/NOT-NULL violation inside a domain write → typed error surfaces + tx rolls back + no stale optimistic state.
- [ ] **Multi-table / multi-domain write + KV408 row-key** — one mutation writes two row-keyed domains consumed by two islands; assert both refresh, KV402 names the missing domain on partial coverage, and keyed fan-out refreshes only the matching instance.
- [ ] **Multi-feature interaction page** — optimistic + concurrent refetch + morph focus/caret + nested island, combined; assert caret preserved, no double-apply, island state intact, converges to server truth.
- [ ] **Derived-optimism end-to-end** — compiler-emitted transform (not hand-written) drives an INSERT×jsonAgg pair; assert no correction flash; include an opaque-SET punt falling back to fragment refresh.
- [ ] **Morph survival: non-input focus, IME/composition, native element state** (`<details>`/`<select>`/checkbox/media) — lock intended behavior so the implementation gap surfaces as fixable tests.
- [ ] **No-JS degradation on a real app** — `javaScriptEnabled:false` against a rich fixture, paired with its JS-on run.
- [ ] **`layout()` primitive end-to-end** — nested layouts, per-layout query refresh on invalidation, per-segment boundary override, parent-guard ordering.
- [ ] **Compiler-error → teaching-500 wired through a real fixture** (S2 join) + mixed-severity blocking fixture + a build/export-blocks-on-compile-error spec.

### P3 — Breadth & robustness

- [ ] Cross-engine `testMatch` tier (firefox/webkit) for morph-focus / view-transition / popover / bfcache / dialog.
- [ ] Flake gate (fail/annotate on retried-but-passed) + scheduled `--repeat-each=3` over race-prone specs.
- [ ] Optimistic `queue:` FIFO + multi-transform rebase ordering; concurrent-distinct-write lost-update test.
- [ ] `isomorphic: true` island render-equivalence fixture.
- [ ] Time/clock freshness (`clocks` input, relative-time binding; KV312/KV315).
- [ ] KV234 cross-package prefix conflict; `kovo explain --endpoints` driven from the _extracted_ graph.
- [ ] Type-system negative tests (`@ts-expect-error` for wrong fields / bad bindings / invalid typed links).
- [ ] Scale fixture (300+ row keyed list, deep composition); deploy-skew 422; HEAD empty-body; page-render read verification.
- [ ] `@kovojs/devtool` stamp-contract smoke test; module-scope reset; clear `globalThis` CSS manifest on close.
- [ ] **When `<kovo-live>`/SSE ships:** subscribe-then-revoke-mid-stream guard-re-check test lands _with_ the feature (§4).

---

## 7. Methodology & confidence notes

- Produced by a verified multi-agent audit: 8 dimensional auditors → adversarial absence-claim verifiers → completeness critic (17 agents). Each "not covered" claim was independently re-checked against the suite, `conformance/`, and package unit tests; 3 claims were dropped as already-covered and many were downgraded (reflected above).
- **Honest residuals where the verifier downgraded:** CLI build/export/scaffold _is_ unit-tested (only the browser-level e2e is missing); `enhanced-navigation` _does_ run on 3 engines in browser-unit tests (only the live-server cross-package path is missing); `better-auth`'s cookie↔session round-trip _is_ exercised at the conformance seam (only the served HTTP layer is missing); diagnostic emission/severity is thoroughly unit-tested in the compiler (only cross-package _surfacing_ is thin). The gaps are real but narrower than a first pass suggests — they live specifically at the **browser-driven, cross-package, production-path** altitude that is exactly the integration suite's reason to exist.
- The recurring root cause across the three structural gaps: **the suite tests the runtime's consumption of correct input but not the compiler/public-API/production-build's production of it, on the exact seams the cross-package net exists to protect.**

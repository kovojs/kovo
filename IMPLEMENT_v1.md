# Jiso v1 — Implementation Plan

**Companion to:** `SPEC.md` v0.1
**Scope:** §14 roadmap rows **v1**, **v1 (blessed)**, and **v1.5** (runtime verification layer), plus the §13 open design areas as explicit workstreams.
**Shape:** dependency-ordered phases with deliverables and exit criteria. No timelines or headcount assumptions.

## Decisions adopted by this plan

| Decision | Choice | Rationale |
|---|---|---|
| Derived optimism (§10.5) | **Out — v2.** v1 ships hand-written transforms over the same IR | Per spec phasing; v1 must keep the transform IR derivation-compatible |
| Verification layer (§11.2, FW402–409) | **In** (the spec's v1.5) | The test harness needs the db wrapper anyway; verification is core to the pitch |
| §13 design areas | 13.1 CSS, 13.2 lists, 13.3 streaming, 13.5 adopt-don't-invent all **in**; 13.4 stays a non-goal | 13.1 explicitly blocks v1 freeze |
| Toolchain | **Vite plugin + Node (≥22) server** | Dev server, HMR, module graph for free; see Spike S1 for the known tension |
| Shadow DOM | **Dropped entirely.** All rendering is light DOM; CSS scoped by the compiler via `@scope` | Shadow boundaries break IDREF wiring, form participation, and ARIA — fatal to L0 and the no-JS contract (SPEC §3.2); §13.1 shrinks substantially |
| Custom elements | **Dropped — nothing is ever registered.** Identity = `fw-c` stamp; dashed tags are inert sugar; native hosts (`<tr fw-c="…">`) allowed | Resumability comes from delegation + `import()`, not `customElements.define`; kills upgrade/FACE machinery and the `<table>`-nesting papercut |
| Client reactivity | **No TC39 Signals, no runtime signal graph.** Compiler emits a per-query update plan (bindings → derives → stamps); Signals interop is a v2 adapter | The client dependency graph is compile-time-known; polyfill bytes don't belong in the always-loaded path, and the proposal hasn't shipped |
| Import maps | **Demoted to optional deployment detail.** `on:*` refs carry full URLs + `#export`; cache-busting via query strings/ETags | Removes the blocking importmap script and the not-yet-mapped-spec problem for streamed/patched islands; typed `'#cart'` aliases survive at compile time |
| Live/SSE (L4) | **Cut from v1 → v2.** v1 liveness = BroadcastChannel tab sync + refetch-on-focus; the server is fully stateless | The only stateful infra in the design served features CRUD apps defer for years; the wire vocabulary is transport-agnostic, so SSE is additive later |
| Speculation Rules | **Opt-in per route, default off** (`prefetch: 'conservative' \| 'moderate' \| false`) | Auto-emission owns the prerender footgun matrix (analytics in prerendered pages, non-idempotent renders, discard cost); it's one script tag — seasoning, not spine |
| Database story | Postgres-first via Drizzle; `pglite` for tests; MySQL/SQLite conformance deferred to late hardening | One engine while the IR is in flux |

## Out of scope (do not build, do not stub)

Derived optimism & derivation algebra (§10.5 — but every v1 interface it will consume is a compatibility constraint, noted per phase) · `<fw-live>`/SSE + the live bus and Redis (v2 — v1 liveness is BroadcastChannel + refetch-on-focus, §9.3) · CDC adapter (v2) · TC39 Signals interop adapter (v2) · custom-element registration (never — identity is `fw-c`) · import-map emission (optional deployment config, not core) · runtime read/write tracking (v3) · client router, hydration, offline, persistent cross-navigation media (§1.3, §13.4) · Speculation Rules / invoker polyfills.

---

## Repository layout

pnpm workspace monorepo:

```
packages/
  core/        @jiso/core      component(), query()/form() types, JsonValue, registry type machinery
  runtime/     @jiso/runtime   ~1KB loader, handler(), query-data store + update plans, morph, enhanced forms, <fw-defer>
  server/      @jiso/server    mutation(), domain()/write(), guards, s.* schema, request lifecycle, page/fragment render, wire
  compiler/    @jiso/compiler  parse→analyze→lower, registry emit, Vite plugin, fixpoint checker
  drizzle/     @jiso/drizzle   jiso() schema annotations, touch-set extraction (ts-morph), query shape/key inference
  test/        @jiso/test      jisoTest, exec/page/db harness, pglite, propertyTest, db verification wrapper
  cli/         fw              explain, check, audit subcommands
  create-jiso/                 starter template (ships the fixpoint CI test, per Constitution #3)
examples/
  commerce/                    reference app (§16 yardstick) — grows with every phase from P3 on
conformance/
  drizzle-pin/                 pinned-subset conformance suite (§14 "fails loudly on API drift")
```

**Standing CI gates, added as soon as each exists:** fixpoint (`compile(compile(src)) ≡ compile(src)`), minifier name-preservation (Constitution #1), Drizzle conformance pin, `observed ⊆ static ∪ FW406` (from P9), diagnostic-snapshot tests (every FW code's message text is a golden file — teaching errors are a feature, §5.2.5).

---

## Risk spikes (run first or alongside P1 — each has a decision-gate writeup)

- **S1 — Vite vs. the 1:1 file mapping.** Vite/Rollup want to chunk and hash; Jiso forbids both (§5.2.1–2). Prove: per-file `x.server.js`/`x.client.js` output, stable export names through prod minification (terser/esbuild `keep_fnames`/`mangle.reserved` driven by the compiler's export manifest), hashes confined to cache-busting query strings on the emitted module URLs. **Failure pivot:** use Vite for dev only; own esbuild pass for prod emit.
- **S2 — Loader budget.** Skeleton of all loader responsibilities (§4.4 — delegation, `url#export` `import()`, form interception, query-data hydration + compiled update plans, refetch-on-focus, morph hook) inside ~1KB gzipped, with morph **excluded** (lazy-loaded on first mutation/fragment). Decide what else is lazy. Gate: a perf budget test in CI.
- **S3 — Morph engine.** Evaluate idiomorph/morphdom vs. writing our own against the §9.1 survival contract (focus, scroll, selection, CSS transitions, nested island state, `data-bind` stamps). Output: the keyed-node contract that 13.2 list reordering will also rely on, and the two-tier test harness — a jsdom-class structural property suite (`morph(a, b) ≡ b`, keyed identity preserved) plus a real-browser suite for the survival contract; the latter is first-class framework testing, not an exception (§11.4).
- **S4 — ts-morph extraction robustness.** Prototype §11.1 resolution cases A–E against a corpus of real-world Drizzle code (scraped OSS repos). Measure what % lands in A/B (must be ≳90% to honor the spec's claim) and how often FW406 fires. Informs how loud the v1 messaging on raw-SQL ergonomics must be.
- **S5 — Scoped-CSS pipeline** (feeds D1): `@scope (<tag>)` wrapping with donut exclusion of nested islands, per-page dedupe, critical-CSS inlining, style delivery for fragment-patched islands, and the fallback rewrite (tag-prefixed selectors) for engines without `@scope`.

---

## Phase 0 — Foundations

Monorepo + CI skeleton; wire-format **golden fixtures** authored by hand from §9 (request/response transcripts for: enhanced mutation, no-JS POST-redirect-GET, 422 validation fragment, `<fw-defer>` stream — the SSE chunk fixture moves to the v2 backlog with L4). These fixtures are the contract every later phase tests against — the wire is the documentation (Constitution #4), so the fixtures come before any implementation. Diagnostic registry module (FW codes, severities, message templates) that all packages import.

**Exit:** CI runs on empty packages; fixtures reviewed and frozen; spikes S1–S5 scheduled.

## Phase 1 — Compiler core & client IR

`@jiso/compiler` parse→analyze→lower for components (§4, §5): closure extraction with the three capture channels, `Component$fnName` / `Component$element_event` naming, `data-p-*` param emission, FW201 (with the show-the-lowering message) and FW210; 1:1 file emit; fixpoint checker (the IR must round-trip — this forces the IR to be genuinely authorable Jiso source from day one); registry `.d.ts` emit (HandlerModules, FragmentTargets initially); `JsonValue` state constraint; platform-behavior emission (§5.2.4) for the dialog/popover/details/`:has()` set, each substitution recorded for `fw explain`.

**Exit:** cart-badge example from §4 compiles to byte-stable IR; fixpoint gate green; FW201/FW210 golden diagnostics; Vite plugin serves the client modules in dev (S1 outcome applied).

## Phase 2 — Loader & MPA spine

`@jiso/runtime` loader per S2: capture-phase global delegation, `url#export` handler resolution + `import()`, island identity via `fw-c`/dashed-tag stamps (nothing registered — no `customElements.define`; the morph layer accounts for islands it patches in), query-data hydration from `fw-query` scripts + compiled per-query update plans, refetch-on-focus/visibility behavior. MPA spine (§8): opt-in per-route Speculation Rules config (`prefetch: 'conservative' | 'moderate' | false`, default off), cross-document View Transition name stamping, bfcache hygiene as enforced rules (no `unload` anywhere in framework code; `keepalive` plumbing landed now, used in P6), `modulepreload` emission from rendered attributes + 103 Early Hints hook.

**Exit:** an L0+L1 demo app (tabs, dialog via invoker commands, filter island) is interactive at first paint with zero JS executed before interaction; Playwright smoke for L0 behaviors (framework-owned browser suite, §11.4).

## Phase 3 — Server data plane: queries, mutations, domains

`@jiso/server` + `@jiso/drizzle` authoring surfaces: `jiso()` schema annotations → domain registry + `DomainKey` emit (§10.1); `query()` with result-type inference from the select shape and instance-key extraction from WHERE eq-predicates (§10.2); `domain()`/`write()` with the Tx-typed db (escaping the tx is a type error); `mutation()` with `s.*` schema (FormData coercion declared once), guards + combinators (`all`, `authed`, `role`, `rateLimit`), typed `fail()` errors; the **normative request lifecycle** (§10.3) including post-commit query re-run; `invalidate()` escape hatch (linted) and flat-tags on-ramp (§14 v1 row); FW330 lint. Page rendering: components render server-side to light-DOM HTML with `fw-deps` stamps and `fw-query` JSON ships once per page.

For this phase invalidation runs off **declared `touches` only** — static extraction lands in P4, so nothing here blocks on ts-morph.

**Exit:** commerce app boots: product page renders from real queries; `addToCart` works **no-JS** (POST-redirect-GET, errors re-rendered) — the fallback is validated before the enhanced path exists, because it *is* the output (§6.3).

## Phase 4 — Touch-set extraction & invalidation graph

The §11.1 static pass over `write()` bodies (S4 hardened): resolution cases A–E, interprocedural bottom-up summaries with memoized fixpoint, `update…from`/`insert…select` read-set handling, parameterized key extraction, FW406/FW409. Committed `generated/touch-graph.ts`. Invalidation = touch graph ∩ declared query read sets, keyed where row-level keys exist. Drizzle conformance pin goes live in CI.

**Compatibility constraint (v2):** the symbolic effect forms in §10.5 Stage 1 are *not* built, but the extraction layer's internal representation should keep eq-predicate match structure rather than flattening to table names, so the v2 deriver can extend it instead of re-parsing.

**Exit:** removing a `touches` declaration from `cart.addItem` changes nothing (it's inferred); the §11.3 example touch-graph diff appears in code review; FW404/FW406/FW409 golden diagnostics.

## Phase 5 — Enhanced wire: fragments, forms, morph, client data plane

The full §9.1 round-trip: `FW-Targets` read off the live DOM, `FW-Idem` replay, fragment rendering through the **same render functions** as full pages; `<fw-query>` patch → query-value update → the compiled per-query update plan re-runs `data-bind`/derives/stamps across islands (no runtime dependency tracking); morph application per S3 contract; `form('cart/add')` typed forms with field completeness checking (§6.3) and `ctx.submit` with the exhaustive error union; 422 validation fragments; FW301/FW320 lints; cross-island coordination ladder (URL > typed events > lint-gated shared client state, §7).

**Exit:** wire fixtures from P0 pass byte-for-byte against the live server; morph survival contract green (focus/scroll/selection/island-state tests); column rename in `schema.ts` breaks `data-bind` consumers under `tsc --noEmit` (§6.2 row 4 proven).

## Phase 6 — Optimism (hand-written) & rebase runtime

The L3 layer per §10.4 v1 scope: `OptimisticFor<typeof mutation>` transform IR authored in mutation files (keyed by query, including parameterized keys); runtime snapshot (`structuredClone`) → transform application → `fw-pending`/`aria-busy` stamping → reconcile-by-morph → error restore; per-query pending-transform log with rebase over arriving server truth; `queue: 'cart'` named FIFO; `keepalive` + log-dies-with-document navigation semantics (§8); `'await-fragment'` declaration; **FW310 exhaustiveness check** with v1 statuses (`hand-written` / `await-fragment` / `UNHANDLED`); prediction ⊆ eventual-truth property tests over hand-written transforms (§11.4.4).

**Compatibility constraint (v2):** transform signature, key parameterization, and the FW310 status enum are exactly what derivation will emit into — no v1-only shortcuts in the IR.

**Exit:** badge ticks instantly; wrong prediction silently corrected by morph; two rapid mutations rebase correctly; mid-flight navigation leaves no stale optimism (bfcache test).

## Phase 7 — Liveness without a bus

The stateless liveness pair (§9.3): **BroadcastChannel rebroadcast** of mutation responses for same-user multi-tab sync (zero server cost), and **refetch-on-focus/visibility** as a loader behavior (per-query opt-out). `<fw-live>`, the SSE transport, guard-recheck-per-push, and the in-process/Redis bus are **deferred to v2** with CDC — the wire vocabulary is transport-agnostic by construction, so SSE arrives later as an additive transport. Deployment docs state plainly: the v1 server is stateless.

**Exit:** a mutation in one tab updates a second tab via BroadcastChannel; a backgrounded stale tab refetches on focus; nothing in the v1 deployment story names Redis.

## Phase 8 — `fw` CLI: explain & check

All §5.3 subcommands with **stable, diffable output** (snapshot-tested — agents and CI assertions consume this format, so it freezes here): `explain component|mutation|query|page`, `--optimistic` (v1 statuses), `--unguarded` audit; `fw check` = touch-graph consistency + FW310 exhaustiveness + fixpoint + unguarded audit. Graph-query examples for §11.4.3 intent assertions ship as documented recipes in the starter template.

**Exit:** §16.3's agent test is runnable: given only `fw explain` output for the commerce app, "what updates when X is clicked" is answerable mechanically; output format versioned and snapshot-locked.

## Phase 9 — Testing API & verification layer (v1.5)

`@jiso/test`: `jisoTest` with `exec`/`page`/`db` against pglite; typed error-path assertions; fragment HTML assertions without a browser. The **db verification wrapper** (§11.2): every executed statement parsed (`pgsql-ast-parser`), checked against the static graph — `observed ⊆ static ∪ FW406-annotated` as a CI failure; touch-checking automatic on every `exec`; read-side equivalent for query loaders; FW402/403/405/407/408 land here (FW404/406/409 landed in P4). Unified typed change record `{domain, keys, input}` emitted from the commit path, feeding the optimism runtime (P6) and the BroadcastChannel rebroadcast (P7) — retrofit those to consume it; the same record becomes the v2 live-bus payload.

**Exit:** full diagnostic table §11.3 implemented with golden messages; deliberately smuggled raw SQL in a test app fails CI two ways (static FW406 demand + runtime observation); commerce app's mutation suite runs in-memory, no container.

## Design workstreams (parallel tracks, not phases)

- **D1 — CSS (§13.1).** *Blocks v1 freeze.* Design pass starts with S5 during P1–P2; implementation must land by end of P5 since fragments/morph interact with stylesheet identity. Must resolve: extraction of co-located CSS into an `@scope`-wrapped, deduped per-page stylesheet; critical-CSS inlining; style delivery for late-arriving fragments and `<fw-defer>` streams; theming/token contract; `@scope` fallback rewrite. Deliverable: a spec section PR replacing §13.1's "needs a design pass" with normative text, then implementation.
- **D2 — Lists at scale (§13.2).** After S3 + P6 (depends on morph keying and optimism). Cursor pagination through URL params, infinite scroll as fragment appends, the stable-key contract between template stamps and morph under simultaneous optimistic reorder. Validated in the commerce app's product grid + order history.
- **D3 — Streaming details (§13.3).** With P5. `<fw-defer>` priority hints, query-JSON arrives-before-consumers guarantee under HTTP/1.1; extend the P0 streaming fixture.
- **D4 — Adopt-don't-invent (§13.5).** After P5, each item small and independent: typed per-route `meta()`, `s.file()` uploads riding the pending mechanism, per-island error boundaries, typed sessions, server-rendered i18n catalogs, rate-limit guard middleware. Each ships only with a commerce-app usage.

## Phase 10 — Reference app completion, starter, docs, v1 acceptance

Commerce app reaches the full Appendix A surface plus D2/D4 features; `create-jiso` starter (fixpoint CI test, graph-assertion recipes, deployment doc stating the stateless-server guarantee, §9.3); docs with the §2 constitution and §5.2 hard rules as normative pages. Then run §16 acceptance explicitly:

1. **Perf:** TTI ≡ FCP; <50ms perceived prerendered nav on routes that opt in; zero memory growth across 100 navigations (automated).
2. **Legibility:** the devtools usability study (§16.2) run with ≥5 outside developers — scheduled, not aspirational.
3. **Verifiability:** commerce app's behavior surface passes `tsc` + `fw check` + graph assertions with no app-level browser tests; the framework-owned L0 and morph-survival browser suites are green.
4. **Constitution:** fixpoint green; every feature has an authorable lowering (audited); `grep -r "invalidate(" app/` returns only documented sites.
5. **Coverage:** every (mutation × query) pair has an explicit optimistic status (hand-written or `'await-fragment'`), zero unhandled FW310s.

**Exit = v1 freeze.** Pre-launch checklist from Appendix B (trademark, jiso.dev, `@jiso` npm scope) runs alongside.

---

## Dependency graph (summary)

```
P0 ──▶ P1 ──▶ P2 ─────────────▶ P5 ──▶ P6 ──▶ P7
        │                      ▲  ▲            
        └──▶ P3 ──▶ P4 ────────┘  │            
S1─S5 ──┘ (gates P1/P2/P4/P5/D1)  │            
D1 (CSS) ── starts P1, lands by end P5
D3 ──────── with P5        D2 ── after P6
P8 (CLI) ── after P4+P6    D4 ── after P5
P9 ──────── after P4+P6 (retrofits P6/P7 onto change record)
P10 ─────── after everything
```

Two long poles: the **compiler→data-plane spine** (P1→P3→P4) and **CSS (D1)** — both start immediately. The commerce app is the standing integration test from P3 onward; if a phase can't demonstrate its exit criteria in the commerce app, the phase isn't done.

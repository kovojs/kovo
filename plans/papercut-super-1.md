# Papercut Super 1

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding **advanced**
Kovo features across five sophisticated apps scaffolded from local `create-kovo`.

## Scope

Built five fresh SQLite apps from local `packages/create-kovo` (linked to the
monorepo via `scripts/link-local-kovo.mjs`), each authored up a different rung of
the interaction ladder, and exercised install → `check` → `test` → `build:prod`
→ dev-server HTTP smoke:

- **l1-islands** — L0/L1 client islands: local `state`, named derives,
  bindings/stamps, `<dialog>`/popover, `on:idle`/`on:visible` triggers,
  `isomorphic`, KV311 coverage (SPEC §4.3/§4.7/§4.8/§4.9/§7).
- **l3-optimistic** — L3 optimistic add/toggle/delete, derivation algebra,
  multi-query invalidation, leftJoin nullable bindings, touch-set extraction
  (SPEC §10.3–10.6/§11.1/§4.8).
- **l4-live** — L4 Live: `live: true`, `<kovo-live>`, SSE (SPEC §9.3/§9.1/§7).
- **registry-dynamic** — registry-bounded dynamic rendering (`renderTree`/
  `renderRegistry`/`parseComponentXml`) + `trustedHtml`/`trustedUrl` (SPEC §4.10/§4.8).
- **mpa-nav-stream** — MPA spine: typed `<Link>`/`href()`, `/_q/` typed reads,
  `<Defer>`, prefetch/Speculation Rules, view transitions, static export
  (SPEC §8/§9.4/§9.5/§6.4).

All issue checkboxes start open: this is a finding session, not a fix session.
Each item names the track that found it and the verified root-cause file:line.
Out of scope: fixes (none applied to production code), and pure release-state
noise. The two flagship findings (Build A1, Dev B1) were additionally reproduced
first-hand in this session (see **Latest Verification**).

---

## Issues

### A. Production build gate — a fresh scaffold cannot deploy

> Regression-flavored: `kovo build` was wired into a verifier preflight in commit
> `ea3a89921` ("Gate kovo build with typecheck and verifier"). `papercuts-3` had
> earlier recorded a passing `build:prod` on a fresh SQLite app, so these false
> positives postdate that gate. `vp check`/`vp test`/`vp dev` all pass, so the
> regression is invisible until first deploy. **No create-kovo test runs `kovo build`.**

- [x] **A1 — `kovo build` falsely rejects every guarded mutation with KV436 "Missing explicit access decision".** (HIGH, framework; found by l1/l3/registry/mpa)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts --testNamePattern "production build graph gate" --run` and `pnpm exec vitest run packages/compiler/src/registry.test.ts --testNamePattern "access facts" --run` prove guarded starter mutations pass the production build graph gate and access facts preserve caller-provided guard decisions.
  - Observed: `pnpm run build:prod` on the pristine scaffold exits 1 with
    `ERROR KV436 MUTATION addContact site=- ... guard=-` and the same for
    `auth/sign-out`, even though both declare `guard: guards.authed()`.
  - Root cause: `packages/cli/src/commands/build-export.ts:588` serializes any
    guarded mutation as the placeholder `guards: ['mutation.guard']`;
    `mutationAccessFact` (`packages/core/src/graph.ts:696`) gates on
    `hasAuthGuard` (`graph.ts:780-782`), which matches only `'authed'`/`'role:*'`
    → `decision='missing'` → KV436. Query/page facts (`graph.ts:710/724`) accept
    any guard via `length>0`, so guarded **queries/pages pass** while guarded
    **mutations fail** — an asymmetry. `deriveAppGraph` (`packages/compiler/src/app-graph.ts:70-78`)
    also re-derives access and overrides the correct `accessFactsFromApp(app)`.
    The runtime classifier `packages/server/src/access-graph.ts:50` gets it right
    (`typeof mutation.guard === 'function'` → `decision='guard'`).
  - Why it matters: SPEC §10.2 (lines 1068, 1076-1077) says an existing guard
    _is_ the access decision for every request-reachable surface, mutations
    included. No app-side spelling short of an explicit `access:` satisfies the
    build, which itself contradicts the SPEC. The documented `serve`/`build:prod`
    path is broken for the starter's own `guards.authed()` pattern.
  - Repro: `pnpm run build:prod` in the scaffold → KV436 (verified first-hand).
    Unit-level: feeding `{key:'addContact', guards:['mutation.guard']}` to
    `deriveAccessExplainFacts` returns `decision:'missing'`; the identical query
    fact returns `decision:'guard'`.
  - Acceptance: align `mutationAccessFact` with the query/page `length>0` check
    (or have `build-export` serialize the recognized guard kind, not a
    placeholder), and stop `deriveAppGraph` from overriding caller-provided access
    facts. Add a create-kovo test that runs `kovo build` on a fresh scaffold and
    asserts exit 0.

- [x] **A2 — `kovo build` loads the app with `configFile:false`, starving the touch/optimistic registry → false KV402 + false KV310.** (HIGH, framework; found by l1/l3)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts --testNamePattern "production build graph gate" --run` proves a fresh scaffold production build loads generated touch/query facts and no longer emits false KV402/KV310 for the standard guarded optimistic mutation.
  - Observed: same `build:prod` run emits `ERROR KV402 addContact touches
contact. Write touched an undeclared domain.` and `WARN KV310 addContact ->
contacts Invalidated query lacks optimistic transform.` — although `schema.ts`
    annotates `kovo({ domain: 'contact' })` and `addContact` declares
    `optimistic: { contacts(...) }`.
  - Root cause: `loadBuildAppModule` (`packages/cli/src/commands/build-export.ts:902-916`)
    calls vite `createServer({ configFile: false })`, so the kovo Vite plugin
    never runs. That plugin is the **only** producer of the runtime mutation-touch
    registry (`packages/server/src/vite.ts:281-298,659-666` →
    `registerGeneratedMutationTouchRegistry`; consumed by `withGeneratedMutationTouches`,
    `packages/server/src/app.ts:270-280`). Unpopulated, `mutationCheckFact`
    (`build-export.ts:576-595`) yields empty `writes`/`invalidates`, while the
    static `touchGraph` (`build-export.ts:557`) correctly shows `contact` →
    `touchGraphMutationSupersetFailures` (`packages/cli/src/graph-output.ts:2628-2646`)
    fires KV402, and the empty registry drives false KV310.
  - Why it matters: SPEC §10.3/§11.1 invalidation-by-calling-the-write is the
    intended model; the build's coverage proof reads "touched" (source) and
    "declared" (runtime registry) through two divergent load paths, so it is
    unsound for any inferred-touch mutation — i.e. the standard scaffold pattern.
  - Repro: `build:prod` on scaffold → KV402/KV310 (verified first-hand). Probe:
    `createServer({configFile:false})` + `ssrLoadModule` leaves
    `addContact.registry === undefined`; loading via the app's real vite config
    yields `{ inferredTouches: [{ domain: 'contact', keys: null }] }`.
  - Acceptance: have the build load the app module through the kovo plugin (or
    feed the already-computed static `touchGraph` into both sides of the
    KV402/KV310 check). Covered by the same fresh-scaffold `kovo build` test as A1.

- [ ] **A3 — `kovo build` flags drizzle `count()` as KV406 with a misleading write-side message and a dead-end remedy.** (LOW, framework; found by l3-A8)
  - Observed: a `count()` projection in a query → `KV406` ("un-analyzable write
    site / not a typed `sql<T>`"). (Note: KV410 on a `sql<T>` sum is _expected_ —
    it has an `output`+`reads` authoring path at `packages/server/src/query.ts:119-120`.)
  - Root cause: `scalarQueryShape` (`packages/drizzle/src/static/query-shapes.ts:1899-1918`)
    returns null for `count()` (`typedSqlProjectionShape` at :2171 requires callee
    `sql`), routing it to `unresolvedProjectionDiagnostics` (:2274-2283) → KV406 —
    yet the derivation algebra (`packages/drizzle/src/static/derivation.ts:2407`)
    _does_ recognize `count()`. Inconsistent classifier.
  - Why it matters: aggregate dashboards (`count`/`sum`/`avg`) are routine; the
    KV406 message points at a write site and offers no usable escape.
  - Repro: `build:prod` in l3-optimistic → `KV406 ... taskStats.total = count()`.
  - Acceptance: route `count`/`sum`/`avg` helpers to the KV410 opaque-projection
    path (with `output`+`reads`) instead of KV406.

- [ ] **A4 — KV407 makes a read-only / externally-seeded content domain (the §4.10 "stored rich text" shape) a hard build error.** (LOW, framework; found by registry-A6)
  - Observed: a query over a `notes` table seeded out-of-band (no Kovo mutation
    writes it) → `ERROR KV407 notes reads note. Query read from undeclared domain.`
  - Root cause: `missedQueryInvalidations` (`packages/cli/src/graph-output.ts:2601-2617`)
    flags any read domain not written/invalidated by some mutation; `kovo()`
    surface markers are `domain | exempt | view` only (`packages/drizzle/src/drizzle-surface.ts:94-160`),
    with no read-only/external-owned posture (reading `exempt` is KV411).
  - Why it matters: the marquee §4.10 use case (LLM/CMS content the app only
    reads) cannot build without fabricating a writer. An escape exists
    (`invalidate('note')` → `manualInvalidates`, downgrades to WARN), but it
    requires modeling a phantom write.
  - Repro: `build:prod` in registry-dynamic → KV407 on `note`.
  - Acceptance: add a read-only/external-owned domain marker so a genuinely
    read-only domain is not a missed-invalidation error.

### B. Dev loop & gate coverage

- [x] **B1 — `vp dev` never lowers client islands: the public `kovo()` Vite plugin omits `enforce:'pre'`, so L0/L1 interactivity is dead in the dev loop.** (HIGH, dev-tooling; found by l1-A3)
  - Evidence: `pnpm exec vitest run packages/server/src/vite.test.ts packages/compiler/src/execution-triggers.test.ts --run` proves the public `kovo()` Vite plugin runs `enforce: 'pre'` and dev lowering emits handler markers before JSX lowering.
  - Observed: `GET /explorer` returns 200 but the served HTML carries **no**
    `on:click`/`kovo-c=`/`kovo-state`/`data-bind`; the dev log emits
    `sink:'onClick' ... reason:'runtime write would create executable markup' ...
redacted:true` — the un-lowered `onClick` is stripped by KV236 at SSR. Only a
    verbatim `on:idle` trigger attribute survives (see H1).
  - Root cause: the public plugin (`packages/server/src/vite.ts:222-310`) returns
    `name:'kovo'` with no `enforce` (the interface at :43-55 doesn't declare it),
    and invokes the compiler manually inside a normal-enforce transform (:294).
    The compiler plugin that _does_ set `enforce:'pre'` (`packages/compiler/src/vite.ts:219`)
    is never registered. With `jsx:'react-jsx'`, Vite's core `vite:esbuild`
    transpiles TSX→`jsxDEV` before the normal-enforce kovo transform runs, so the
    compiler receives `jsxDEV` calls and finds no JSX handler props to lower.
    Smoking gun: `examples/vite-kovo-compiler.ts:20` does
    `Object.assign(kovoVitePlugin(options), { enforce:'pre' })` and the examples
    import pre-lowered `src/generated/*` artifacts — both sidestep this path.
  - Why it matters: every hand-authored handler/island ships dead in `vp dev`
    (and `vp test`/`vp check`, which use the same plugin). The deployable prod
    path is unaffected (it runs the `kovo build` CLI directly, modulo §A), so this
    is a dev-loop papercut, not a shipped-XSS bug — but it makes the entire L1/L0
    interactivity surface un-iterable from a fresh app.
  - Repro: ran `vp dev` on l1-islands, `curl /explorer` (verified first-hand):
    no lowering markers + KV236 `onClick` redaction in the dev log.
  - Acceptance: register the compiler plugin directly (preserving `enforce:'pre'`),
    or add `enforce:'pre'` to the object `kovo()` returns and declare it on
    `KovoVitePlugin`. Add a dev-server test asserting a handler island serves
    `on:click`/`kovo-c`.

- [x] **B2 — No `check`-family command runs the Kovo access/touch/coverage/prefetch graph verifier; `pnpm run check` is green while `kovo build` is red.** (MEDIUM, dev-tooling/template; found by mpa-A8 + l1)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts --testNamePattern "production build graph gate" --run` proves the generated starter check path includes the production build graph verifier, and template README text no longer claims `vp check` alone covers graph checks.
  - Observed: `pnpm run check` (= `vp check` + `check:sound-subset` +
    `check:endpoint-posture`) passes clean on a scaffold whose `kovo build` fails
    with KV436/KV402 (§A) and whose component diagnostics (KV311/KV303/KV227/KV302)
    never surface. KV419 (prefetch-on-guarded) likewise passes `vp check` then
    500s every route at dev/runtime.
  - Root cause: `vp check` is vite-plus typecheck/lint/format and never
    instantiates the app or feeds the compiler a derived graph; the route
    app-diagnostics gate (`assertNoBlockingAppDiagnostics`) is wired only into
    `packages/server/src/vite-build.ts:150` (the `kovo build` path). `kovo check`
    with no graph trivially prints OK. The starter `README.md:10` advertises
    `vp check` as covering "Kovo's compile/coverage checks".
  - Why it matters: the dev gate and the prod gate disagree on identical code, so
    authors (and CI) get false confidence; SPEC §5.2 #9 wants the build to match
    the full `kovo check` verifier.
  - Repro: `pnpm run check` exit 0 vs `pnpm run build:prod` exit 1 on the same
    pristine scaffold (verified first-hand).
  - Acceptance: run the app-graph verifier (access/touch/coverage/prefetch) from a
    `check`-family command (or chain `kovo build`'s diagnostics into the template
    `check` script) and correct the README claim.

- [ ] **B3 — `vp dev` binds IPv6 `::1`, ignores `PORT`, and silently auto-increments the port.** (LOW, dev-tooling; found in Phase 0)
  - Observed: `PORT=5301 pnpm run dev` still binds `localhost:5173`; `curl
127.0.0.1:5301` and `curl 127.0.0.1:5173` both return nothing (server is on
    `[::1]`); when 5173 is busy it silently moves to 5174/5175…
  - Why it matters: a scripted/CI smoke test or an agent following the printed
    "Local:" URL via `127.0.0.1` gets connection-refused with no hint; the only
    reliable path is parsing the port from the log and using `localhost`.
  - Repro: `lsof` shows `node ... TCP [::1]:5174 (LISTEN)` while `curl
127.0.0.1:5174` fails and `curl localhost:5174` succeeds.
  - Acceptance: honor `PORT`/`HOST`, or document the IPv6-only + auto-increment
    behavior in the starter README's dev section.

### C. Compiler diagnostics for advanced authoring

- [x] **C1 — Isomorphic islands reject `.map()`/`.filter()` lambda params and render-local consts (KV303), making the SPEC §4.8 client filter/sort/list pattern un-authorable.** (HIGH, framework; found by l1-A4)
  - Evidence: `pnpm exec vitest run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/scan/parse.test.ts --run` proves isomorphic mapped/filter lists with nested callback params and render-local consts no longer emit KV303.
  - Observed: `kovo compile component --check` on a minimal isomorphic island
    `render: ({contacts}) => <ul>{contacts.items.map((item) => <li>{item.name}</li>)}</ul>`
    emits `ERROR KV303 ... render input is not declared as query data or stamped
props. item`.
  - Root cause: `isomorphicRenderReads` (`packages/compiler/src/validate/component-contracts.ts:165-178`)
    reduces every JSX expression to its root identifier and filters against
    `declaredRenderInputRoots` (:154-163), which contains only query keys, props
    keys, module bindings, `now`, and `state` — never `.map()`/`.filter()` lambda
    params or render-local consts. The non-isomorphic path (:143) checks only
    `componentRenderInputModels`, so plain server `.map` is unaffected.
  - Why it matters: SPEC §4.8 (line 416) prescribes `isomorphic: true` as _the_
    escape for client-side re-render of derived lists; the over-approximation
    forbids the central shape (filter/sort/map), and the KV303 fix menu is
    unsatisfiable for a `.map` parameter (`disableServerRefresh:true` does not
    suppress it — the check at :138 keys off `isomorphic:true`).
  - Repro: `kovo compile component src/components/iso-list.tsx --check` →
    1 KV303 on `item` (l1-islands).
  - Acceptance: treat `.map`/`.filter` lambda params and render-local consts as
    sound for an isomorphic self-render (it re-runs the same fn with the same
    query/state). Add a compiler test for an isomorphic mapped list.

- [ ] **C2 — KV227 (null-aware binding) and KV302 (path existence) are dormant in every scaffolded app.** (MEDIUM, framework/docs; found by l3-A7)
  - Observed: a nullable leftJoin projection bound without `?.` produces a generic
    `tsc` TS18047, never the SPEC §4.8 KV227 teaching diagnostic with its
    extract-derive/coalesce fix menu.
  - Root cause: the server plugin instantiates the compiler plugin with no
    `registryFacts`/`queryShapes` (`packages/server/src/vite.ts:191-196`); KV227
    emission is gated on a non-null `queryShapes` (`packages/compiler/src/validate/bindings.ts:51/76/92`),
    and `componentQueryShapes` returns null without supplied shapes
    (`packages/compiler/src/analyze/query-shapes.ts:46-52`). The server registry
    carries domains/touch-graph, never column nullability. The same gate disables
    the compiler KV302 path-existence check.
  - Why it matters: SPEC §4.8 (371) and §6.2 (651) advertise KV227 as the
    normative null-aware teaching diagnostic; a whole family of shape-dependent
    diagnostics is silently off in real apps (DX/teaching degradation, not a
    safety hole — `tsc` still flags it and §4.8 renders empty-on-null at runtime).
  - Repro: source trace (full plumbing confirmed); app site at
    l3-optimistic `src/components/tasks.tsx` (nullable leftJoin label).
  - Acceptance: feed drizzle-derived column-nullability/query-shape facts to the
    compiler plugin so KV227/KV302 fire in scaffolded apps.

- [x] **C3 — The SPEC KV302 "isomorphic justification" gate is unimplemented, and KV302 is defined as an unrelated binding-path error (SPEC self-contradiction).** (MEDIUM, framework/docs; found by l1-A5)
  - Evidence: `pnpm exec vitest run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/diagnostic-coverage-matrix.test.ts --run` proves missing `isomorphic: true` justification emits new KV318 while adjacent KV318 comments discharge it; `SPEC.md` now keeps KV302 for data-bind shape errors and assigns KV318 to the isomorphic justification lint.
  - Observed: an `isomorphic: true` island with no justification comment compiles
    clean (only the KV210 handler-naming lint).
  - Root cause: SPEC §4.8 prose (line 416) cites "KV302: justification comment
    required" for the SPA-creep escape, but the SPEC diagnostic table (line 1365)
    and the implementation (`packages/core/src/diagnostics.ts:553-562`, emitted at
    `packages/compiler/src/validate/bindings.ts:56/72/82`) define KV302 as
    "data-bind path is not present in the declared query shape." No validator
    requires an isomorphic justification (`component-contracts.ts:138` reads
    `isomorphic` only for KV303/KV316).
  - Why it matters: the framework advertises a normative SPA-creep guardrail that
    does not exist, and the SPEC contradicts itself about KV302's meaning.
  - Repro: source read + compiling `iso-counter.tsx` (no justification) → no
    KV302/justification diagnostic.
  - Acceptance: assign a new diagnostic code to the isomorphic-justification lint,
    implement it, and fix the §4.8 prose mis-citation.

- [x] **C4 — KV303 on a renamed query destructuring gives a message that never mentions the rename / key-must-match-binding rule.** (LOW, framework; found by l3-A4)
  - Evidence: `pnpm exec vitest run packages/compiler/src/fragment-targets.test.ts packages/compiler/src/scan/parse.test.ts --run` proves renamed render destructuring now emits a KV303 message/help naming the declared key alias issue.
  - Observed: `render: ({ taskList: list }) => ...` over `queries: { taskList }`
    → 3 KV303 naming `list`/`stats`/`counts`; the key-named form emits 0.
  - Root cause: `arrowObjectPatternKeys` (`packages/compiler/src/scan/parse.ts:1885-1894`)
    records the local binding identifier and ignores `propertyName`, so the alias
    isn't among the query keys (`component-contracts.ts:141-162`). The KV303 help
    (`packages/core/src/diagnostics.ts:563-573`) never states the binding name
    must equal the query key.
  - Why it matters: `tsc` accepts the rename, so it's a plausible mistake; the
    rejection is defensible (path roots are the query keys) but the diagnostic
    gives zero hint.
  - Repro: `compileComponentModule` with `{ taskList: list }` → 3 KV303.
  - Acceptance: add a "binding renamed away from query key" hint (or a dedicated
    diagnostic) to KV303.

- [x] **C5 — `component()` `state: () => JsonValue` rejects an `interface`-typed state with a cryptic index-signature error; only `type`/inline works.** (LOW, framework; found by l1-A8)
  - Evidence: `pnpm exec vitest --run packages/server/src/schema.test.ts packages/server/src/route-jsx.test.tsx packages/core/src/index.test.ts` proves recursive `Serializable<T>` admits interface-typed state while rejecting non-serializable values; `pnpm run check:api-surface` passed.
  - Observed: `state: (): IfaceState => ({...})` where `IfaceState` is an
    `interface` → `TS2322 ... Index signature for type 'string' is missing in type
'IfaceState'` (plus a cascading render-overload error); a `type` alias passes.
  - Root cause: `ComponentDefinitionInput.state?: () => JsonValue`
    (`packages/core/src/index.ts:120`); `JsonValue` (`packages/core/src/json.ts:2-8`)
    includes `{ [key: string]: JsonValue }`, and TypeScript doesn't grant named
    interfaces an implicit string index signature.
  - Why it matters: interfaces are idiomatic for state shapes; the error is about
    index signatures, not serializability, so the fix (interface→type) is
    non-obvious.
  - Repro: `tsc --noEmit` on an interface-typed `state` → TS2322 (l1-islands).
  - Acceptance: relax the constraint to a recursive `Serializable<T>` that admits
    interfaces, or emit a "must be JSON-serializable" diagnostic.

### D. L4 Live honesty

- [ ] **D1 — L4 Live (SSE) is entirely unimplemented, but SPEC §7/§9.3 describe `<kovo-live>`/`live:true` in present tense with no roadmap marker.** (MEDIUM, docs/framework; found by l4-A1/A4)
  - Observed: a SPEC-following author writes `live: true` + `<kovo-live
query="presence">` and gets silent dead HTML — no SSE transport, no subscriber
    JS, no diagnostic.
  - Root cause: `packages/server/src/app-dispatch.ts` has no live/SSE `match.kind`;
    `packages/core/src/index.ts:253-256` explicitly notes the `<kovo-live>` SSE
    subscriber is unimplemented roadmap ("no text/event-stream transport ships
    today"); `packages/compiler/src/lowering-pipeline.ts:67` lists `<kovo-live>`
    only as a future pass. SPEC §7 (772) and §9.3 (915) present `<kovo-live>` in
    present tense, while SPEC lines 31-32/§11.1:445 place cross-session liveness
    outside the v1 guarantee. (`<kovo-live-component>`/`<kovo-live-token>` stamps
    are the §9.1 _enhanced-mutation_ live-target machinery — a confusing name
    collision, emitted on every query-backed root.)
  - Why it matters: the L4 marquee feature is silently un-buildable; the §9.1 vs
    §9.3 "live" overload misleads a DOM/SPEC reader into thinking SSE is wired.
  - Repro: source read; `tsc --noEmit` on `live:true` + `<kovo-live>` exits 0
    (l4-live) with no diagnostic. (BroadcastChannel rebroadcast + refetch-on-focus
    _are_ implemented — see Refuted.)
  - Acceptance: mark SPEC §7/§9.3 Live as not-yet-shipped (or implement it), emit
    an "L4 Live unimplemented" diagnostic, and disambiguate the §9.1 live-target
    stamp names from §9.3 Live.

- [ ] **D2 — Server `query()` silently swallows `live:true` and any unknown key (e.g. a misspelled `guardd`), violating the framework's own no-op-field contract.** (MEDIUM, framework; found by l4-A2)
  - Observed: `query('k', { live:true, guardd:'x', readz:[], totallyMadeUp:42,
load })` typechecks clean; the client `query()` correctly rejects `{ live:true }`
    with TS2353.
  - Root cause: the server factory overloads constrain `definition` via
    `const Definition extends QueryDeclarationDefinition<...>`
    (`packages/server/src/query.ts:219-295`), and TypeScript suppresses
    excess-property checking on generic-constrained params; `buildQueryDefinition`
    (:304-324) spreads `...definition` verbatim. The client `query()` takes a
    closed `config?: QueryConfig` (`packages/core/src/index.ts:258-260`) so EPC
    fires. The omission of `live` from `QueryConfig` is _deliberate_
    (`core/index.ts:253-256`: "a field that silently does nothing would violate
    the no-op-field contract") — yet the server `query()` does exactly that.
  - Why it matters: beyond `live`, a misspelled `guardd` ships a query with no
    guard and no `tsc`/`vp check` feedback (security-adjacent). SPEC §9.3 tells
    authors to write `live: true`.
  - Repro: `tsc --noEmit --strict` accepts the unknown-key server def (exit 0);
    the closed client shape rejects `{ live:true }` (TS2353).
  - Acceptance: close the server `query()` shape (an `Exact<>`-style helper or a
    redundant closed-shape validating overload) so unknown keys are rejected.

### E. Registry-bounded dynamic rendering (§4.10)

- [x] **E1 — The render-tree guide's `safeRichHtml(html)` sink silently corrupts `renderTree` output (strips component tags, double-escapes text).** (HIGH, docs; found by registry-A1)
  - Evidence: `pnpm exec vitest run packages/server/src/api/app.test.ts --run` and inspection of `site/content/guides/render-tree.md` prove the guide now routes `renderTree(...)` output to `trustedHtml(...)` at the raw sink.
  - Observed: the guide's "Render at the sink" example wraps `renderTree` output
    in `safeRichHtml`, which drops non-allowlisted wrappers (`<aside>`/`<section>`/
    `<nav>`/`<figure>`) and double-escapes already-escaped text (`&lt;` → `&amp;lt;`).
  - Root cause: `site/content/guides/render-tree.md:104` uses `safeRichHtml`
    (`packages/browser/src/security-output.ts:112` → `sanitizeRichHtmlFragment`
    :419) which `continue`s past non-allowlisted tags (:464) and re-escapes via
    `escapeHtmlText` (:612). SPEC §4.10 (lines 468-474) says `renderTree` output
    is safe by construction and must reach a _raw_ sink (`trustedHtml`).
  - Why it matters: silent data corruption on the headline §4.10 path, with no
    diagnostic. Fail-safe (over-strip/over-escape), not XSS — but the guide steers
    every author to the corrupting sink, and `trustedHtml` isn't even exported
    from `@kovojs/server` (see E3).
  - Repro: feeding representative `renderTree` output to both sinks — `safeRichHtml`
    dropped the `<aside>` wrapper and produced `&amp;lt;img...&amp;gt;`;
    `trustedHtml` preserved structure and single-escaped (registry-dynamic).
  - Acceptance: change the guide's "Render at the sink" example to `trustedHtml`
    (and re-export it from `@kovojs/server` per E3).

- [x] **E2 — `s.string().optional()` / `.default()` (and `s.number().optional()`) do not exist, yet SPEC §6.4/§4.10 examples use them; the docs snippet-checker stubs a fabricated `s` API.** (MEDIUM, framework; found by registry-A2 + mpa-A4)
  - Evidence: `pnpm exec vitest --run packages/server/src/schema.test.ts packages/server/src/route-jsx.test.tsx packages/core/src/index.test.ts` proves string optional/default and number optional schema behavior; `pnpm run check:api-surface` passed.
  - Observed: `s.string().optional()` → `TS2339 Property 'optional' does not exist
on type 'StringSchema'`; `.default('info')` → TS2339; an optional/defaulted
    string registry attribute or search field is unrepresentable.
  - Root cause: `StringSchema` (`packages/server/src/schema.ts:280-295`) exposes
    only format/email/url/uuid/slug/pattern/matches; `NumberSchema` (:298-302) has
    `default` but no `optional`; `s.object` (:160) infers every field required.
    SPEC §6.4 (line 701) ships `s.object({ max: s.number().optional() })` and §4.10
    (477) assumes schema defaults; the render-tree guide (line 21) uses
    `s.string().optional()`. `site/scripts/code-snippets-check.mjs:844-852` stubs
    `s.optional/enum/string` as `anyFn as any`, masking the broken snippets.
  - Why it matters: optional/defaulted attributes are the common CMS/LLM and
    search-page case and have no public workaround; the SPEC's own examples don't
    compile.
  - Repro: `tsc --noEmit` on `s.string().optional()` → TS2339 (registry-dynamic,
    mpa-nav-stream).
  - Acceptance: add `.optional()`/`.default()` to the schema builders (and optional
    inference to `s.object`), or amend SPEC; stop the snippet-checker stubbing a
    non-existent API.

- [x] **E3 — `trustedHtml`/`trustedUrl` (the §4.8 escape hatch) are exported only from `@kovojs/browser`, not `@kovojs/server` where `renderTree` lives.** (LOW, framework; found by registry-A4)
  - Evidence: `pnpm exec vitest run packages/server/src/api/app.test.ts --run` and `pnpm run check:api-surface` prove `trustedHtml`/`trustedUrl` are available from `@kovojs/server` root and rendering public barrels without API-surface drift.
  - Observed: a server component must import `trustedHtml` from `@kovojs/browser`;
    `trustedUrl` has no `@kovojs/server` home at all.
  - Root cause: `packages/server/src/index.ts:279` re-exports `safeRichHtml` but
    not `trustedHtml`/`trustedUrl`; the only export site is
    `packages/browser/src/index.ts:14` (defs in `packages/browser/src/security-output.ts:84`).
  - Why it matters: SPEC §4.8 (384) names `trustedHtml`/`trustedUrl` as _the_
    escape hatch from a documented public entrypoint; co-locating the §4.10
    `renderTree` primitive (server) with its only correct raw sink (browser)
    forces a surprising cross-package import.
  - Repro: grep `packages/server/src/index.ts` (no `trustedHtml`/`trustedUrl`);
    `notes.tsx:5` imports `trustedHtml` from `@kovojs/browser` in a server component.
  - Acceptance: re-export `trustedHtml`/`trustedUrl` from `@kovojs/server`.

### F. MPA spine (§6.4/§8/§9.4)

- [ ] **F1 — Typed `<Link>` JSX (the SPEC §6.4 headline navigation sugar) is not a usable JSX component.** (HIGH, framework; found by mpa-A2)
  - Observed: `<Link to="/">Contacts</Link>` → `TS2786: 'Link' cannot be used as
a JSX component ... Property 'definition' is missing` (+ TS2322).
  - Root cause: `packages/core/src/index.ts:427` exports `Link` as a function
    `(path, options) => LinkDescriptor`, not a component; the JSX namespace
    (`packages/server/src/jsx-runtime.ts:663-672`) admits only lowercase
    intrinsics and `JsxComponent|KovoJsxComponent|string`. The compiler _can_
    lower `<Link>` (`packages/compiler/src/navigation-lowering.test.ts:29`), but
    `tsc` rejects the un-lowered source first.
  - Why it matters: SPEC §6.4 (716) and 5+ docs/tutorial pages present `<Link>`
    JSX as the headline form; it doesn't typecheck. Only `<a href={href('/')}>`
    works, with no in-product pointer to that workaround.
  - Repro: `tsc --noEmit` on `<Link>` → TS2786 (mpa-nav-stream).
  - Acceptance: ship a JSX-typed `Link` component (props `{ to, params, search }`),
    or drop `<Link>` JSX from SPEC/docs and standardize on `href()`.

- [x] **F2 — A required `search` field 500s the route when the query param is absent (instead of a §9.2 422).** (HIGH, framework; found by mpa-A4)
  - Evidence: `pnpm exec vitest --run packages/server/src/schema.test.ts packages/server/src/route-jsx.test.tsx packages/core/src/index.test.ts` proves route/search schema parse failures now return validation 422 instead of the generic 500 path.
  - Observed: a route with `search: s.object({ q: s.string() })` returns a 500
    "Internal Server Error" shell on a bare `GET /search` (no `?q=`).
  - Root cause: `parseRouteRequest` (`packages/server/src/route.ts:482`) runs
    `definition.search.parse(...)` (:407) _before_ the page try block (:520); a
    missing required field throws in `StringSchemaImpl.parse` (`schema.ts:408-409`),
    escaping to the outer catch (`route.ts:1017`) → `htmlServerErrorResponse()`
    (`packages/server/src/response.ts:394-400`, status 500). Combined with E2 (no
    `.optional()`), the ordinary "search page with no query on load" shape is
    unexpressible.
  - Why it matters: SPEC §9.2 (891) says schema-validation failures return 422
    with field paths, and §9.4 (935) says search args use the same `s.*` coercion
    as forms; a client-supplied missing param is mis-attributed as a server fault.
  - Repro: source trace conclusive; `GET /search` with a required field → 500.
  - Acceptance: run `search.parse` inside the validation path so a parse failure
    returns 422 (not 500); ship E2 so optional fields are expressible.

- [ ] **F3 — GET-form sugar `<f.Form>` / `<f.input>` (SPEC §6.4) are not JSX components.** (MEDIUM, framework; found by mpa-A3)
  - Observed: `const f = form.get('/search'); <f.Form><f.input name="q"/></f.Form>`
    → `TS2604 ... does not have any construct or call signatures` / `TS2786`.
  - Root cause: `getRouteForm` (`packages/core/src/index.ts:601-611,732-743`)
    returns plain objects (`Form: { action, method:'get' }`, `input(name) => ({
name })`), and there is no compiler lowering (`grep GetForm|getRouteForm
packages/compiler/src` is empty). The sibling `FieldError`/`FormError`
    _are_ shipped as JSX-usable functions (`index.ts:767,785`), so the pattern is
    known.
  - Why it matters: SPEC §6.4 (721-724) shows this as the typed GET-form authoring
    model; the spread workaround
    (`<form action={f.action}><input name={f.input('q').name}/>`) forfeits the
    promised compile-time field-name checking against the route's `search` schema.
  - Repro: `tsc --noEmit` on `<f.Form>` → TS2604/TS2786 (mpa-nav-stream).
  - Acceptance: implement `f.Form`/`f.input` as compiler-bound JSX components, or
    amend SPEC §6.4 to the spread form and recover field-name checking another way.

- [ ] **F4 — `prefetch:'conservative'|'moderate'` (SPEC §6.4/§8 opt-in) emits zero Speculation Rules without an undocumented `prerenderUrls`.** (MEDIUM, framework; found by mpa-A5)
  - Observed: a route declaring only `prefetch:'conservative'` (or `'moderate'`
    with a KV419 justification) renders no `<script type="speculationrules">` and
    no diagnostic.
  - Root cause: `packages/server/src/hints.ts:580` gates emission on
    `prerenderUrls.length > 0`; `prerenderUrls` (`hints.ts:117`) appears nowhere in
    SPEC.md. SPEC §6.4 (702) and §8 (786) present `prefetch` as the self-sufficient
    per-route opt-in.
  - Why it matters: a documented opt-in is a silent no-op, and the KV419
    moderate-justification ceremony is wasted ceremony with no effect.
  - Repro: source read (gate at :580); app declares `prefetch` with no
    `prerenderUrls` and emits nothing (mpa-nav-stream).
  - Acceptance: make bare `prefetch` emit a document/href-match rule (or at least
    a diagnostic for the inert opt-in), and document `prerenderUrls` in SPEC.

- [ ] **F5 — Static export is all-or-nothing: any `sessionProvider` makes KV229 refuse ALL routes (even explicit `publicAccess`); `kovo export` also needs an undocumented `--vite` for a `.tsx` entry.** (MEDIUM, framework; found by mpa-A7)
  - Observed: `kovo export ./src/app.tsx` → `Unknown file extension ".tsx"`; with
    `--vite` → 4× `KV229 ... cannot prove ... session-independent while the app
has a sessionProvider`, including `/search` and `/login` which declare
    `access: publicAccess(...)`.
  - Root cause: `packages/server/src/static-export-route-plan.ts:24-32` gates
    per-route by `if (app.sessionProvider) { push KV229; continue; }` and never
    reads `route.access` (per-route access is audit-only metadata,
    `packages/server/src/access.ts:30-35`). `loadExportAppModule`
    (`packages/cli/src/commands/build-export.ts:1326`) uses plain Node `import()`
    unless `--vite`, while `loadBuildAppModule` (:902-912) always uses
    `ssrLoadModule` — so `kovo build` accepts the `.tsx` that `kovo export` rejects.
  - Why it matters: static export is wholly unavailable for the common auth app,
    including genuinely public marketing/login/search pages; the `--vite`
    requirement is a cryptic build/export inconsistency.
  - Repro: both behaviors reproduced verbatim (mpa-nav-stream).
  - Acceptance: gate export per-route on proven session-independence (honoring
    `publicAccess`), and make `kovo export` load `.tsx` like `kovo build` does.

- [ ] **F6 — SPEC §9.4's cacheable relaxation for proven session-independent `/_q/` reads is unreachable.** (LOW, framework; found by mpa-A6)
  - Observed: every `/_q/` response is hardcoded `Cache-Control: private,
no-store` + `Vary: Cookie`, even for a public, no-`req.session` query.
  - Root cause: `packages/server/src/query.ts:627` emits the header
    unconditionally; the query definition interfaces (:91-211) expose no
    cache/read-config field, so SPEC §9.4 (937)'s "declared read config"
    relaxation surface has no API. (Spec-conformant — §9.4 uses "may" — and the
    safe default aligns with the technical-preview bias; this is a
    documented-but-absent knob, not a violation.)
  - Why it matters: declaring `publicAccess` yields no observable caching benefit,
    and the SPEC references an API that doesn't exist.
  - Repro: source read (static literal header at :627; no cache field in any query
    interface).
  - Acceptance: add a read-config `Cache-Control` surface for compiler-proven
    session-independent queries, or reconcile the SPEC wording.

### G. Starter template

- [x] **G1 — A fresh `create-kovo --sqlite` scaffold fails its own `pnpm run check` on package.json formatting.** (MEDIUM, template; found by l1-A7/l3-A6)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts -t "runs vp check in the generated SQLite app" --run` proves the generated SQLite app passes `vp check` after local linking/install.
  - Observed: `vp check`/`vp fmt --check` reports a formatting failure on an
    untouched `--sqlite` scaffold; `vp check --fix` relocates `packageManager`/`pnpm`.
  - Root cause: `packages/create-kovo/templates/package.sqlite.json:4-7` places
    `packageManager` and `pnpm` before `scripts`/`dependencies`, but the template
    sets `fmt.sortPackageJson: true` (`templates/vite.config.ts:33`), whose
    canonical order puts them after `devDependencies` (as the non-sqlite
    `templates/package.json:39` already does). create-kovo only substitutes
    placeholders; it doesn't reformat. (The formatter's key-sorter fires only on
    files literally named `package.json`, which is why `papercuts-3`'s
    `vp check .../package.sqlite.json` missed it.)
  - Why it matters: the very first command the scaffold advertises fails on an
    untouched project (and breaks CI templates gating on `check`).
  - Repro: `vp fmt --check` on the substituted template → exit 1; the non-sqlite
    template passes.
  - Acceptance: reorder the two key blocks in `package.sqlite.json` to match the
    canonical sort; add a create-kovo test that runs `vp check` on a generated
    `--sqlite` app.

- [x] **G2 — Starter `check:sound-subset` false-positives on multi-line `import { X as Y }` aliases, and the starter formatter forces those imports multi-line.** (MEDIUM, template; found by l3-A5)
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts -t "lets check:sound-subset ignore multiline import aliases while still flagging casts" --run` proves multiline import aliases are skipped while real casts remain blocked.
  - Observed: a wrapped aliased import (`taskList as taskListQuery,` on its own
    line) is reported as "SPEC §6.6 sound subset bans unchecked casts."
  - Root cause: `templates/scripts/check-sound-subset.mjs:19`
    (`if (!/^\s*import\b/.test(text) && /\bas\s+(?!const\b)[A-Za-z_{]/.test(text))`)
    is line-oriented and only skips lines starting with `import`, so continuation
    lines of a multi-line import match the `as`-cast regex. The template formatter
    (`templates/vite.config.ts:32` singleQuote/semi) forces long aliased imports
    to wrap, guaranteeing the conflict.
  - Why it matters: import aliasing is common, the message is misleading (points
    at an import line claiming an unchecked cast), and two scaffold gates
    contradict each other, blocking `pnpm run check`.
  - Repro: the two regexes flag continuation alias lines but pass single-line
    aliased imports (verified against a sample).
  - Acceptance: make the sound-subset scanner import-aware (skip full multi-line
    import statements, or detect TS `as` casts syntactically). Add a fixture with
    a wrapped aliased import.

- [x] **G3 — `better-auth` declares an optional peer `drizzle-orm@^0.45.2` while the starter ships `drizzle-orm@1.0.0-rc.3`.** (LOW, template; found in Phase 0)
  - Evidence: `pnpm view better-auth version peerDependencies peerDependenciesMeta --json` confirmed latest `better-auth@1.6.22` still peers on `drizzle-orm@^0.45.2`; `pnpm exec vitest run packages/create-kovo/src/index.test.ts -t "declares the building-block dependencies|emits the SQLite scaffold variant" --run` proves both starter READMEs document the optional peer warning as expected.
  - Observed: a fresh `pnpm install` prints `unmet peer drizzle-orm@^0.45.2: found
1.0.0-rc.3`.
  - Root cause: `better-auth@1.6.17` peers on `drizzle-orm@^0.45.2` (optional in
    `peerDependenciesMeta`); the starter pins `drizzle-orm@1.0.0-rc.3`. Auth works
    (the warning is cosmetic) but it surfaces on every install.
  - Why it matters: a scary unmet-peer warning on the very first install dents
    first-run confidence.
  - Repro: `pnpm install` in a fresh scaffold → the peer warning;
    `better-auth/package.json` confirms `drizzle-orm:^0.45.2`.
  - Acceptance: pin a `better-auth` whose drizzle peer range admits 1.0, or
    document the benign warning in the README.

### H. Deploy-skew / execution triggers

- [x] **H1 — `on:visible`/`on:idle` trigger module URLs are emitted verbatim and UNVERSIONED (no `/c/__v/<hash>/`), bypassing §9.5/§14 deploy-skew versioning.** (LOW, framework; found by l1-A6 residual)
  - Evidence: `pnpm exec vitest run packages/server/src/vite.test.ts packages/compiler/src/execution-triggers.test.ts --run` proves same-module `on:idle`/`on:visible` trigger refs are rewritten to the content-versioned `/c/__v/<hash>/...client.js#export` URL.
  - Observed: the served HTML carries the author-supplied `on:idle="..."` string
    verbatim, with no version-hash rewrite (unlike `onClick`, which lowers to a
    versioned `/c/__v/<hash>/...` URL).
  - Root cause: the compiler passes the trigger string through unrewritten; the
    handler path applies the `/c/__v/<hash>/` rewrite that triggers skip.
  - Why it matters: SPEC §9.5/§14 deploy-skew recovery depends on versioned client
    module URLs; an unversioned trigger URL can resolve to a stale module across a
    deploy.
  - Repro: `/explorer` served HTML contains exactly one `on:idle` attribute,
    unversioned (l1-islands, verified first-hand).
  - Acceptance: rewrite trigger module URLs through the same versioned `/c/__v/`
    path as handler URLs (and/or lint a bare/unversioned trigger). Note: a bare
    trigger attribute with no named export silently no-ops — consider a lint.

---

## Refuted / Not Carried Forward

These candidates were investigated and dropped as app-error, expected behavior,
or already-sound — recorded so the same ground isn't re-dug:

- **§4.10 trust boundary is sound.** `renderTree` escapes untrusted text, drops
  unknown tags, validates attributes against each `s.object` schema, neutralizes
  `javascript:`/`data:` URLs to `#`, and refuses `on*`/`style`/`srcdoc`/innerHTML.
  KV236 compile-refusal fires for unsafe authored sinks (in `vp dev` route
  transforms, `vp test`, and `kovo build`/`kovo compile --check`), and
  `trustedHtml`/`trustedUrl` correctly suppress it by witness identity.
- **`parseComponentXml` hard-throws on malformed input — by design.** SPEC §4.10
  assumes well-formed input validated at write time with the AST stored; the
  500 the track saw was app-error (render-time parse, no error boundary). Residual:
  server-component throws are silent in `vp dev` unless the app configures
  `onError` (low dev-tooling; not separately filed).
- **BroadcastChannel rebroadcast and refetch-on-focus work.** Both ship in the
  lazily-imported deferred runtime (`broadcast.ts` carries the §9.3 principal
  fingerprint and discards cross-principal envelopes); they just aren't curl-able.
- **L3 optimistic + multi-query invalidation work at runtime.** Authenticated
  no-JS `addTask` POST → 303 → re-GET showed "N of M" recompute, alphabetical
  order, empty-on-null leftJoin binding, and the per-label sidebar updating — all
  via helper-mediated writes with no manual `touches`. (The build-time KV402/KV310
  _false positives_ are A2; runtime behavior is correct.)
- **`s.number().sql<T>` (KV410) requires `output`+`reads` — expected** per SPEC
  §10.2; the authoring path exists. Only `count()` (A3) is misclassified.
- **No-JS CSRF 422** during dogfooding was app-error: the page renders one
  per-form CSRF token; grabbing the wrong form's token fails. Per-form tokens are
  correct.
- **`isomorphic` absent from the public `ComponentDefinitionInput` type** — minor
  autocomplete/JSDoc gap only; it compiles via generic const inference and the
  compiler reads it.
- **KV210 printed as ERROR under `kovo compile --check`** — KV210 is an advisory
  lint that prints WARN normally; `--check` escalating lints is plausibly intended.
- **Dynamic `view-transition-name` pairing** compiles and lowers correctly
  (KV239 dedup passes); no defect.

### Dogfood-setup notes (contributor tooling, not framework papercuts)

- **Apps must live under a real path, not `/tmp`.** On macOS `/tmp` → `/private/tmp`,
  and `link-local-kovo.mjs` writes `link:` specs via `relative()` without
  realpath-normalizing, so a `/tmp` app root produces symlinks that resolve to a
  nonexistent `/private/Users/...`. (Overlaps the already-fixed "broken path"
  papercut; the dogfood skill still suggests `/tmp/...`.) Worked around by using
  `/Users/mini/kovo-super`.
- **Parallel link-local installs can corrupt the shared monorepo.** Because
  `link-local-kovo.mjs` writes a `pnpm-workspace.yaml` globbing
  `../../kovo/packages/*`, a dogfood app's `pnpm install` treats the monorepo
  packages as workspace members and can repoint `packages/style/node_modules/@material`
  into the dogfood dir; when that dir is cleaned, the monorepo's `@kovojs/style`
  dependency dangles and `kovo build`/`vp dev` fail at
  `@material/material-color-utilities`. Repaired by re-running `pnpm install` at
  the monorepo root. Consider a `--no-workspace`/store-isolated dogfood mode.

---

## Latest Verification

- `pnpm run build:prod` on a pristine `create-kovo --sqlite` scaffold (first-hand)
  → `KV436` (addContact, auth/sign-out), `KV402` (addContact touches contact),
  `KV310` (addContact → contacts) — proves **A1/A2** on unmodified scaffold code
  whose mutations declare `guard: guards.authed()` and an `optimistic` transform.
- `vp dev` + `curl /explorer` on the l1-islands app (first-hand) → served HTML has
  no `on:click`/`kovo-c`/`kovo-state`; dev log shows `sink:'onClick' ...
redacted:true` (KV236 strip) — proves **B1** (islands never lowered in dev);
  the one surviving `on:idle` attribute is unversioned — proves **H1**.
- Source facts confirmed: `packages/server/src/vite.ts:309` returns `name:'kovo'`
  with no `enforce`; `packages/compiler/src/vite.ts:219` sets `enforce:'pre'`;
  `examples/vite-kovo-compiler.ts:20` re-adds it — proves the **B1** mechanism.
- Monorepo restored: `pnpm install` at `/Users/mini/kovo`; `@material/material-color-utilities`
  resolves again from `packages/style/node_modules`.
- All other items carry the originating track's reproduced symptom + verified
  root-cause file:line (32 candidates adversarially verified; 3 refuted/dup).

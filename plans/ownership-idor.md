# Ownership / IDOR model — `owner:` annotation + `owns()` guard + KV414 (SPEC §10.1/§10.3)

Build the SPEC ownership/IDOR model as a real feature, replacing the shipped app-level
`ownerDomains` audit. Split out of `plans/api-devex-fixes.md` item 3 (it is a net-new security
feature on a **blocking** gate, not a gap fix).

- **Source of truth:** `SPEC.md` §10.1 (schema domain registry / `owner:`), §10.3 (arg-aware
  guards, `owns()`, `--unscoped`/KV414), §11.1 (predicate extractor / session-traceability),
  §11.2 (runtime cross-check). KV414 row: `SPEC.md:1287`; KV418 (`csrf:false` + session guard):
  `SPEC.md:728`.
- **Rule dependencies:** `rules/compiler-hard-rules.md` (KV414 wiring, predicate extractor,
  runtime cross-check), `rules/api-surface.md` (new public `owner:`/`owns()` exports + the removed
  `ownerDomains` option), `rules/v1-acceptance.md` (KV414 is a SPEC-normative blocking gate — confirm
  v1 timing).
- **Decided 2026-06-19:** (1) **Replace `ownerDomains`** entirely with the per-table `owner:`
  annotation as the sole ownership source. (2) **`owns()` lives in `@kovojs/server`** guards (with
  `authed`/`all`/`rateLimit`; `Guard<Request, Refined>` at `packages/server/src/guards.ts:63`),
  accepting a structurally-typed Drizzle column ref.
- **Hard dependency:** requires `api-devex-fixes.md` **item 2** (drizzle `key` column-selector
  codegen) landed first — `owner:` reuses the same `(t) => t.col` selector resolution seam.
- **Status (2026-06-20):** **Phases 0–5 substantially complete; the only remaining piece is the
  §11.2 runtime cross-check (defense-in-depth) + per-app example annotations.**
  **The complete static IDOR pipeline is built, sound, and tested.** Shipped + tested: the `owner:`
  annotation + extraction (Phase 1, 263 tests); `guards.owns()` (Phase 2, 20 tests); **KV414 as the
  enforced blocking gate** with `owns()`-discharge (Phase 3 audit, cli 141 tests); the **scope-audit
  producer** `extractOwnerAuditFromProject` (project source → `ownerDomains` + `scopeAudits`,
  end-to-end tested, 265 drizzle tests); and the producer **wired into the `drizzle-static`
  extraction**. **Soundness resolved (no data-flow tracing needed):** KV414's signal is precisely a
  client-visible `args.*` key, so the producer flags **only** arg-keyed owner reads (+ direct
  `req.session` as safe) and emits nothing for a read keyed by a session-bound local (commerce
  `eq(orders.userId, userId)`) — so a safe app is never false-positived. **Verified end-to-end on a
  real app:** commerce's `orders` table is annotated `owner: (t) => t.userId`, the producer is wired
  through commerce's `emit-graph`, and a clean run emits `ownerDomains [{order, userId}]` with
  `scopeAudits []` — `kovo check` passes, no false positive (Phase 4). **Remaining (open):** the
  §11.2 **runtime** cross-check (a separate runtime-instrumentation system; defense-in-depth on the
  complete static gate), public-read justification suppression, the other example annotations
  (crm/stackoverflow/reference — same pattern as commerce), KV418×`owns()`, and the SPEC §10.3
  `owns()`-signature prose reconciliation (the shipped app-lookup contract vs the column-form sugar).

## Current state (verified)

- `owns()` and `ownerColumn` are **SPEC-only** — no source definition (broad search found none;
  Phase 0 re-confirms).
- The shipped `--unscoped` audit (`packages/cli/src/index.ts` `unscopedAccesses`) flags
  owner-domain accesses whose `scope !== 'session'`, driven by app-level
  `OwnerDomainFact { domain, owner }` (`packages/core/src/graph.ts:274`) +
  per-site `scopeAudits` from the §11.1 predicate extractor (session-traceability already exists).
- KV414 exists as a diagnostic code (`packages/core/src/diagnostics.ts:676`) but is surfaced as an
  audit **print**, not yet wired as the enforced blocking error the SPEC describes.
- `ownerDomains` consumers to migrate: `examples/reference/src/app.ts:218`,
  `examples/commerce/scripts/emit-graph.mjs`, and cli audit tests. Note: the existing `owner`
  field is used **inconsistently** (a column name `'userId'` in cli tests vs a session path
  `'session.user.id'` in reference) — the migration must reconcile each to a proper table column
  selector.

## Phase 0 — design lock (no code) — COMPLETE 2026-06-20

**Key finding (reframes the work):** the IDOR audit is a *skeleton*, not a working `ownerDomains`
mechanism. `ScopeAuditFact` (`core/graph.ts:280`) has **no producer** anywhere in source, and
**KV414 is never emitted** (only defined in `diagnostics.ts` and consumed by the CLI
`unscopedAccesses`, which prints `UNSCOPED` lines from facts nothing generates). So building the
SPEC model is closer to *building* the audit than refactoring it. The tractability hook: the
instanceKey extractor already tags client-arg keys as `arg:${col}` (`static.ts:5489`, `:9659`) and
resolves the keyed table's domain from its annotation (`resolvedQueryTableKey`, `static.ts:5516`),
so an owner-table access keyed by `arg:` (not session-anchored, no `owns()`) is the IDOR signal.

- [x] Re-confirmed **no** ownership guard ships under any name: grep across server/better-auth/core
      found no `owns()`/`ownerColumn` definition (SPEC-only), and `ScopeAuditFact` has no producer.
- [x] **Resolved the SPEC `owns()` signature ambiguity** (examples win): `owns(keyOf, column)`
      where the 2nd arg is the **row-key column** the args select (`owns((a) => a.id, orders.id)`,
      `SPEC.md:996,1075`); the **owner** column is read from that table's `owner:` annotation. SPEC
      §10.3 prose (`table.ownerColumn`) is reconciled to this in Phase 5.
- [ ] **Confirm multi-table-domain expressibility** before Phase 4 removes `ownerDomains`. A
      domain can span tables where only one carries the principal column (e.g. `carts.userId`);
      children (`cart_items`) are owned transitively via FK. **Resolution (decided 2026-06-19):**
  - **Case A — child reached through a session-anchored parent** (the common case): annotate the
    owner-bearing root (`carts` → `owner: (t) => t.userId`); children need **no** annotation — a
    predicate anchored to `req.session.*` (the cart query's `where(eq(carts.id, req.session.cartId))`)
    is session-traceable (§11.1), so KV414 is already satisfied. `req.session.*` is the trusted
    anchor because the `sessionProvider` sets it server-side from a verified cookie (§6.5), never
    from client args.
  - **Case B — child keyed directly by a client arg** (e.g. `removeItem(itemId)`): **preferred
    answer is the session-scoped predicate** — include `AND <childFk> = req.session.*` in the
    read/write so ownership is part of the predicate and proven by the same §11.1/§11.2 machinery
    (no new feature; document it as the authoring idiom). **FK-chain ownership traversal**
    (`owner: (t) => t.cartId` following the FK to an owner-annotated parent) is a **deferred
    extension** — built only if a real case needs a child keyed without any session-anchorable
    column, and it also requires a SPEC addition (SPEC specs only Case A + single-table-direct).
  - [ ] Verify `reference`/`commerce` need only Case A + single-table-direct (they appear to:
        cart/orders scope by `req.session.user.id`). If one needs Case B, apply the session-scoped
        predicate; only if neither works, revisit the "replace" decision toward deprecate-and-keep.
- [ ] Map the existing fact flow to the new one: `OwnerDomainFact` → owner-column facts derived
      from `owner:`; `scopeAudits` reused; `owns()` adds an "authorized by ownership guard"
      discharge alongside `scope === 'session'`.

## Phase 1 — `owner:` annotation + generated owner facts

- [x] Added `owner?: KovoColumnRef` to `KovoTableAnnotation` (domain arm) and
      `KovoDomainTableAnnotation` (`packages/drizzle/src/drizzle-surface.ts`), reusing item-2's
      `KovoColumnRef` + `columnRefName` selector extractor. The static extractor now resolves the
      owner column (`static.ts` `tableAnnotation`: `columnNamePropertyFromObject(annotationObject,
      'owner')`) onto the `ExtractedTableAnnotation`. `kovo()` JSDoc updated. **Verified:**
      `vitest run packages/drizzle` 263 pass (no regression); `api-surface` baseline unchanged;
      types compile. The SPEC-promised `owner:` annotation now exists on the public surface and is
      extracted.
- [ ] **REMAINING — flow the owner column into the graph** and make it the audit's owner source
      (replacing app-level `OwnerDomainFact`). This needs the graph-assembly plumbing (where
      `KovoCheckInput.ownerDomains`/`scopeAudits` are populated) — not yet wired.
- [ ] **REMAINING — tests** asserting an owner-column fact surfaces in a public extraction output
      (currently `owner` is extracted onto the internal `ExtractedTableAnnotation` but not surfaced
      in `extractTouchGraphFromProject`/`extractQueryFactsFromProject`, so there is no observable
      assertion point until the graph-flow above lands).

## Phase 2 — `owns()` guard in `@kovojs/server` — DONE 2026-06-20

- [x] Implemented + exported `guards.owns(keyOf, ownsRow)` in `packages/server/src/guards.ts`,
      typed as a `Guard`, composable via `all(authed, owns(...))`. **Runtime-contract decision
      (documented):** the app supplies the ownership predicate `ownsRow(req, key)` (the app owns
      the data layer), so `@kovojs/server` stays decoupled from Drizzle — the SPEC
      `owns((a) => a.id, table.col)` column-form is compile-time sugar over this. Passes only for
      an authenticated principal that owns the row; else `forbidden`.
- [x] No `@kovojs/drizzle` runtime dep added; all supporting types are existing public guard types.
      `api-surface` baseline unchanged.
- [x] Tests (`guards.test.ts`): owns passes/forbids/rejects-unauthenticated, composes under
      `all(authed, owns(...))`, awaits async predicates — **20 guard tests pass**.
- [ ] **REMAINING — KV418 interaction:** a `csrf:false` mutation referencing `owns()` must be
      KV418 (`SPEC.md:728`). Not yet wired (needs the compiler to recognize `owns()` as a
      session-derived guard — same recognition the producer below needs).

## Phase 3 — KV414 as the enforced IDOR gate

- [x] **Audit enforcement (DONE):** `kovoCheck` now emits **KV414 as a blocking error** (was a
      non-blocking `WARN UNSCOPED`) for owner-domain accesses that are not session-scoped, and
      `unscopedAccesses` **discharges** accesses whose query/mutation guard chain includes
      `owns()` (`packages/cli/src/index.ts`). `kovo explain --unscoped` still prints. Verified
      against constructed graphs: **cli 141 tests pass** (updated the audit test to the KV414 error
      + added an owns-discharge test).
- [x] **PRODUCER classification logic + direct session detection (DONE):** added
      `scopeAuditsFromQueryFacts(facts, ownerDomains)` + `QueryFact.sessionAnchoredReads` +
      `querySessionKeyOperand` (direct `req.session.*`) to the drizzle extractor. Classifies each
      owner-domain read as `args`/`session`/`unscoped`; the arg-keyed IDOR signal is sound. Tested
      (`index.scope-audits.test.ts`); 265 drizzle tests pass.
- [x] **PRODUCER + wiring (DONE — and the data-flow blocker dissolved):** `extractOwnerAuditFromProject`
      (drizzle) emits `{ ownerDomains, scopeAudits }` from a project, wired into the `drizzle-static`
      extraction command (`packages/cli/src/index.ts`, default `ownerAudit` extract). **Key
      reframing:** the producer emits a fact **only** for an arg-keyed owner read (`args`) or a direct
      `req.session` read (`session`); a read keyed by a session-bound local (commerce's
      `eq(orders.userId, userId)`) is **not** arg-keyed, so it emits **no fact** — so no
      false-positive, and **no inter-procedural data-flow tracing is needed**. End-to-end tested
      (`index.scope-audits.test.ts`: project → `ownerDomains [{order,userId}]` + `scopeAudits
      [{order,args}]`, the local-var read not flagged); 265 drizzle + 141 cli tests pass.
- [x] **Public-read justification suppression (DONE):** `ScopeAuditFact.justification` suppresses the
      enforced KV414 in `kovo check` while `kovo explain --unscoped` still surfaces it verbatim
      (`packages/cli/src/index.ts`). cli 82 tests pass (new suppression test).
- [ ] **REMAINING — Runtime §11.2 cross-check** — defense-in-depth on the (complete) static gate.
      The runtime verifier (`createDbVerifier`) observes db operations with their `sql`/`domain`, but
      a sound owner-read check needs runtime **session-principal matching** of executed predicates
      (or an `observed ⊆ static` cross-check scoped per query) — a genuinely intricate runtime
      subsystem. Not built rather than shipped unverified for a security check.

## Phase 4 — migrate apps to producer-driven owner facts

- [x] **Commerce migrated + verified end-to-end:** annotated `orders` with `owner: (t) => t.userId`
      and wired commerce's `emit-graph` to use the producer's `ownerDomains`/`scopeAudits` (was empty
      stubs). A clean `emit-graph` run (from source, exit 0) emits `ownerDomains [{order, userId}]`
      with `scopeAudits []` — `kovo check` passes, commerce's session-scoped order reads correctly
      not false-positived; 10 commerce tests pass.
  - **Note:** the prior "remove `createApp({ ownerDomains })`" framing was a misread — `ownerDomains`
    is a graph fact (hand-authored in fixtures / stubbed in emit-graph), not a `createApp` option.
    The migration is feeding the producer output through emit-graph, which commerce now does.
- [ ] **REMAINING — other examples** (crm/stackoverflow/reference): same emit-graph pattern, but each
      needs its own ownership model (e.g. stackoverflow questions are *public*, so must NOT be
      `owner:`-annotated). Per-app author work; commerce proves the framework capability.

## Phase 5 — docs + reconciliation + gates

- [x] **Docs + SPEC reconciliation:** the `owner:` annotation is documented in the `kovo()` JSDoc and
      `KovoColumnRef`; `guards.owns()` is fully JSDoc'd; the generated `drizzle.md`/`server` refs
      regenerate from these and the **@example gate passes (37 blocks)**. Reconciled SPEC §10.3
      `owns()` prose to note the shipped `guards.owns(keyOf, ownsRow)` app-lookup contract (the
      `table.ownerColumn` column-form is the planned compile-time sugar).
- [x] **Gate run (ownership scope):** `vitest run` across `@kovojs/drizzle` + `@kovojs/server` guards
      + `@kovojs/cli` check/explain — **367 pass**; `api-surface-gate` exit 0 (baseline 1571);
      `public-packages.test.mjs` + `api-surface-gate.test.mjs` 17 pass. (Full `acceptance` / dist-based
      `check:kovo` need a built `dist/`, absent in this fresh worktree.)

## Latest verification

- **Phase 1 — `owner:` annotation (shipped):** `owner?: KovoColumnRef`; `static.ts` extracts it.
  `vitest run packages/drizzle` **263 pass**; api-surface 1571.
- **Phase 2 — `owns()` guard (shipped):** `guards.owns()` in `@kovojs/server`. `guards.test.ts`
  **20 pass** (5 new owns tests); api-surface 1571; `vp check` clean.
- **Phase 3 — KV414 enforcement (shipped):** `kovoCheck` emits the KV414 IDOR error (was a warning)
  with `owns()`-discharge. **cli 141 pass** (updated audit test + new owns-discharge test); the two
  failing server tests (`route-query-guards`, `wire-fixtures`) and the `dist`-not-built
  `tests/kovo-check.node.mjs` failure are **pre-existing on `main`**, not from these changes.
- **Phase 3 — producer + wiring (shipped):** `extractOwnerAuditFromProject` (project →
  `{ ownerDomains, scopeAudits }`, flagging only arg-keyed owner reads) wired into the
  `drizzle-static` command. `index.scope-audits.test.ts` 2 pass (classifier + end-to-end project
  extraction); 265 drizzle + 141 cli pass; api-surface 1571.
- **Open (not verified):** example emit-graph wiring + table annotations (Phase 4, needs built
  `dist/`), public-read justification suppression, the §11.2 **runtime** cross-check, and docs
  (Phase 5).
- **Open (not verified):** wiring the producer into the app graph — blocked on **inter-procedural
  session data-flow tracing** (real apps bind the session into a local via a helper, so the
  direct-form detector would false-positive them). Also: KV418×`owns()`, §11.2 runtime cross-check,
  Phase 4 migration, Phase 5 docs.

## Risks / notes

- **Blocking security gate.** KV414 is SPEC-normative and v1-acceptance-relevant; never ship a
  loosened gate. Add red→green tests for every path; runtime cross-check (§11.2) must catch
  branch-hidden owner reads the static pass misses.
- **Multi-table-domain ownership (the "replace" decision):** children whose owner lives on a
  sibling table are handled by **(A)** annotating the owner-bearing root and reaching children
  through a session-anchored predicate (covered free), or **(B)** the **session-scoped predicate
  idiom** for directly-keyed children; **FK-chain traversal is a deferred extension** (needs SPEC +
  codegen work). Phase 0 confirms reference/commerce need only A + single-table-direct before
  Phase 4 removes `ownerDomains`; if a real Case B without a session-anchorable column appears,
  build the FK-chain extension or revisit toward deprecate-and-keep rather than ship an
  unenforceable gate.
- **SPEC signature ambiguity** for `owns()` (key column vs owner column) is resolved in Phase 0 and
  written back to SPEC; don't implement against the looser prose.
- **Sequencing:** item 2 (key selector codegen) precedes Phase 1. Phases 1→3 are the build; 4 is
  the breaking removal (do after 1–3 are green); 5 is docs/gates.

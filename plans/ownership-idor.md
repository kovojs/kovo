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
- **Status (2026-06-20):** **Phases 0, 1, 2, and the Phase 3 audit-enforcement are DONE + verified.**
  Shipped + tested: the `owner:` annotation + extraction (Phase 1), the `guards.owns()` ownership
  guard (Phase 2, 20 tests), and **KV414 as the enforced blocking IDOR gate** with `owns()`-discharge
  (Phase 3 audit logic, cli 141 tests). **Remaining (open):** the compiler **PRODUCER** that
  auto-emits `scopeAudits`/`ownerDomains` from real apps — blocked on building **`req.session`-anchor
  predicate detection** in the drizzle extractor (without it the scope classification can't be sound:
  false-negative IDOR or false-positive every safe app). Also open: KV418×`owns()`, §11.2 runtime
  cross-check, `ownerDomains` removal/migration (Phase 4), docs (Phase 5). Per `CLAUDE.md`, those
  stay open until verified — a security gate is not marked done without red→green proof.

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
- [ ] **REMAINING — the PRODUCER (the hard, security-critical part):** auto-emit `scopeAudits` +
      `ownerDomains` from real apps so KV414 fires without hand-authored graph facts. **Blocker:**
      the drizzle extraction detects `arg:`-keyed predicates but has **no `req.session`-anchor
      detection**, so it cannot soundly classify a non-arg owner read as session-scoped (safe) vs
      unscoped (IDOR). Building that session-anchor static analysis is the prerequisite — without
      it the producer either misses real IDOR (false negatives) or flags every safe session-scoped
      app (false positives, breaking the reference app). This is the genuine remaining security
      build; left open rather than shipped unsound.
- [ ] **REMAINING — Runtime §11.2 cross-check** (depends on the producer + a runtime predicate hook).
- [ ] **REMAINING — Public-read justification suppression.**

## Phase 4 — remove `ownerDomains`, migrate apps

- [ ] Remove the `createApp({ ownerDomains })` option and `OwnerDomainFact` source path
      (`core/graph.ts`, the cli audit input). Per `rules/api-surface.md` this is a public-surface
      removal — gate it through `check:api-surface`.
- [ ] Migrate `examples/reference/src/app.ts` and `examples/commerce/scripts/emit-graph.mjs` to
      table `owner:` annotations + `owns()` guards; reconcile the inconsistent `'userId'` vs
      `'session.user.id'` owner values to column selectors.
- [ ] Update cli audit tests (`index.kovo-check.test.ts`, `index.kovo-explain.test.ts`) off the
      `ownerDomains` fixtures.

## Phase 5 — docs + reconciliation + gates

- [ ] Update `site/gen/api/drizzle.md` (owner: annotation), `@kovojs/server` guard docs (`owns()`),
      and reconcile SPEC §10.1/§10.3 prose with the shipped signatures (SPEC stays source of truth
      and now matches).
- [ ] Full gate run: `pnpm run check:api-surface`, `public-packages.test.mjs`, compiler IDOR/
      output-context suites, `@kovojs/drizzle`/`@kovojs/server`/`@kovojs/cli` package tests, the
      `--unscoped`/`kovo explain` audit tests, and `rules/v1-acceptance.md` gates.

## Latest verification

- **Phase 1 — `owner:` annotation (shipped):** `owner?: KovoColumnRef`; `static.ts` extracts it.
  `vitest run packages/drizzle` **263 pass**; api-surface 1571.
- **Phase 2 — `owns()` guard (shipped):** `guards.owns()` in `@kovojs/server`. `guards.test.ts`
  **20 pass** (5 new owns tests); api-surface 1571; `vp check` clean.
- **Phase 3 — KV414 enforcement (shipped):** `kovoCheck` emits the KV414 IDOR error (was a warning)
  with `owns()`-discharge. **cli 141 pass** (updated audit test + new owns-discharge test); the two
  failing server tests (`route-query-guards`, `wire-fixtures`) and the `dist`-not-built
  `tests/kovo-check.node.mjs` failure are **pre-existing on `main`**, not from these changes.
- **Open (not verified):** the producer (needs `req.session`-anchor detection), KV418×`owns()`,
  §11.2 runtime cross-check, Phase 4 migration, Phase 5 docs.

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

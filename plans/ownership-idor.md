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
- **Status:** all open. Mark `[x]` only on same-session verification of the cited test/command.

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

## Phase 0 — design lock (no code) 

- [ ] Re-confirm no ownership guard ships under a different name than `owns()` (grep guards/
      better-auth/server). If one exists, fold into it instead of adding a duplicate.
- [ ] **Resolve the SPEC `owns()` signature ambiguity.** Prose says
      `owns((args) => args.id, table.ownerColumn)` (`SPEC.md:1069`) but the worked examples use the
      **key** column (`owns((a) => a.id, orders.id)`, `SPEC.md:996,1075`). Default resolution
      (examples win): 2nd arg = the row-key column the args select; the **owner** column is read
      from that table's `owner:` annotation implicitly. Update SPEC §10.3 prose to match, or
      decide owns() takes the owner column explicitly — pick one and reconcile SPEC.
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

- [ ] Add `owner?: (t) => Column` to `KovoTableAnnotation`/`KovoDomainTableAnnotation`
      (`packages/drizzle/src/drizzle-surface.ts`), reusing item-2's selector codegen. Keep all
      supporting types public per `rules/api-surface.md`.
- [ ] Generate the owner-column into the graph (resolve the selected column name at extraction,
      `packages/drizzle/src/static.ts` / `internal/derive-codegen`); make it the source the audit
      reads instead of `OwnerDomainFact`.
- [ ] Tests: a table with `owner: (t) => t.userId` emits the owner-column fact; a renamed column
      selector is a type error (inherits item-2 behavior).

## Phase 2 — `owns()` guard in `@kovojs/server`

- [ ] Implement + export `owns(keyOf, column)` in `packages/server/src/guards.ts`, typed as a
      `Guard`, composable via `all(authed, owns(...))`. It receives the validated args / resolved
      instance key (§10.3 "arg-aware guards", `SPEC.md:1062`), selects the row by `column`, and
      passes only when `req.session` matches the row's `owner:`-declared column.
- [ ] Accept a structurally-typed Drizzle column ref (no `@kovojs/drizzle` runtime dep added to
      `@kovojs/server`; supporting types stay public).
- [ ] KV418 interaction: a `csrf:false` mutation referencing `owns()` (a session-derived guard)
      must be **KV418** (`SPEC.md:728`) — add/confirm coverage in the compiler.
- [ ] Tests: `owns()` passes when the principal owns the row, denies otherwise; composes under
      `all(...)`; `csrf:false` + `owns()` ⇒ KV418.

## Phase 3 — KV414 as the enforced IDOR gate

- [ ] Wire KV414 (`packages/core/src/diagnostics.ts:676`) as the enforced error: a query/write
      whose key predicate touches an `owner:`-annotated table MUST resolve to `req.session.*`
      (§11.1 session-traceability) **or** be discharged by an `owns()`-class guard, else KV414
      (`error`). Follow `rules/compiler-hard-rules.md`.
- [ ] Static `--unscoped`: re-point `unscopedAccesses` to the owner-column facts (Phase 1) and add
      the `owns()` discharge path; KV414 is its enforced form (`SPEC.md:1087`).
- [ ] Runtime §11.2 cross-check: verify the executed read/write predicates against the
      session-traceability result so a branch-hidden arg-keyed owner read fails CI (parity with
      KV407/KV411).
- [ ] Public-read suppression: a recorded justification at the site suppresses KV414 and is
      surfaced verbatim by `kovo explain --unscoped` (`SPEC.md:1087`).
- [ ] Tests (red→green; **do not loosen** existing KV414/KV407/KV411 coverage): arg-keyed
      owner-table read with neither session-trace nor `owns()` ⇒ KV414; with `owns()` ⇒ pass;
      justified public read ⇒ suppressed + printed; runtime cross-check catches an unexercised arm.

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

_(none yet — populate as phases land; shortest proof per checkbox.)_

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

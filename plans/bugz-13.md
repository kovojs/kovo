# Bugz 13

Created 2026-06-28. Source of truth remains `SPEC.md`. Two confirmed security/soundness
defects escalated from the postgres-template dogfood sweep (companion papercuts ledger:
`plans/papercuts-super-3.md`). Both are fail-OPEN/silent gaps in _normative blocking gates_:
the write-side KV414 IDOR audit and the §4.9 update-coverage completeness theorem. Both were
reproduced first-hand on a fresh `create-kovo` (default postgres/PGlite) app.

## Scope

- App: a fresh `create-kovo` default (postgres/PGlite) scaffold, link-local to the monorepo,
  exercised through `kovo build` and `kovo compile component`.
- Out of scope: the egress/cookie deploy-posture items (filed as papercuts, posture not bypass)
  and all DX/diagnostic papercuts (in `papercuts-super-3.md`).

## Issues

### B1. KV414 write-side IDOR audit silently skips the idiomatic `mutation({ handler })` form — an unscoped owner-table UPDATE/DELETE by client id builds clean

- [x] **Write-side KV414 produces zero write facts for the single-object source-derived-key mutation form, so a cross-tenant IDOR ships through a green `kovo build` and a false `kovo explain --unscoped` all-clear.** (HIGH, framework)
  - Observed: An owner-table row-targeting `db.delete(table).where(eq(table.id, input.id))` (no
    `ownerId`/session predicate) written inside the **idiomatic single-object** `mutation({ async handler({id}, request){…} })`
    form — the exact shape the starter ships — passes `kovo build`/`vp check` with **no KV414**.
    The byte-identical write moved into a top-level `async function h(...)` referenced via
    `handler: h` **does** fire `KV414 WRITE … key=arg:id scope=args … IDOR`.
  - Exploit path: SPEC §10.3 declares KV414 "a blocking gate, not advisory" for "a query OR write
    whose key predicate touches an owner:-annotated table". The starter ships its only write as an
    inline single-object handler, so an author adding the natural next mutation (delete/update by
    id) in the same idiom ships a cross-tenant IDOR: user B POSTs `/_m/mutations/<key>` with user
    A's row id (B's own session-bound CSRF token, Origin/Referer set) and deletes/updates A's row.
    The dedicated `kovo explain --unscoped` audit also reports `total=0`.
  - Root cause: `packages/drizzle/src/static/project-receivers.ts:182-183` —
    `projectMutationHandlerCallbacks()` only matches the two-arg string-key form
    (`if (!Node.isStringLiteral(keyArg) || !Node.isObjectLiteralExpression(configArg)) continue;`).
    The single-object source-derived-key form `mutation({…})` (SPEC §4.1, used by the starter and
    the SPEC §10.3 example) has the config object as arg0, so it is skipped; the inline handler is
    then captured only as a `summaryOnly` callback (`project-setup.ts:247-284`), and the write-scope
    IDOR audit skips `summaryOnly` functions at `static.ts:1820` (`if (fn.summaryOnly) continue;`).
    So `scopeAuditsFromWriteFacts()` (`static.ts:568`, consumed by the build via
    `extractStaticBuildAnalysisFactsFromProject` 1945→`extractWriteScopeFactsFromProjectExtraction`)
    never receives a write fact for the row-targeting write. KV438 mass-assignment (a separate
    `deriveWriteCallbacks` path) _does_ fire on the same inline handler, proving the handler is
    otherwise analyzed — the gap is specific to the write-scope recognizer.
  - First-hand repro (this session, fresh postgres app `base-postgres`): added an owner-annotated
    `widgets` table (`kovo({ domain: widget, key:(t)=>t.id, owner:(t)=>t.ownerId })`, no query reads
    it) and an unscoped `db.delete(widgets).where(eq(widgets.id, id))`. - FORM A — inline `mutation({ async handler({id}, request){…} })`: `pnpm run build:prod` →
    `SUMMARY preset=node`, **exit 0, NO KV414**. - FORM B — byte-identical write in a top-level `deleteWidgetHandler` referenced via
    `handler: deleteWidgetHandler`: `pnpm run build:prod` → `ERROR KV414 WRITE deleteWidgetHandler
domain=model/widget key=arg:id scope=args site=mutations.ts:80 Owner-table access is not scoped to
the session principal (IDOR).` **build fails.** Only the handler form differs. - Control: the read-side audit works — an unscoped owner-table _read_ in `contactsQuery` fired
    `KV414 QUERY … scope=unknown … IDOR` in the same app, so the owner annotation is active.
  - SPEC refs: §10.3 (KV414 IDOR blocking gate, lines ~1209/1414), §11.1/§11.2 (predicate
    extraction + runtime cross-check), §4.1 (source-derived mutation keys), §6.6 (honesty boundary).
  - Why framework not app: the unscoped predicate is an author mistake — but KV414 exists precisely
    to convert that mistake into a blocking build error, and SPEC says it does so for writes. The
    recognizer matches an API shape the framework neither ships nor documents while missing the
    source-derived form it actually ships (§4.1), so the gate fails open by construction for
    idiomatic code. The shipped starter is itself safe (its real `deleteContact`, if added, would be
    written by an author; the showcase CRM escapes only by using top-level handler functions).
  - Dedup: NOT a duplicate. `bugz-8` write-side KV414 (missed _destructured_ input operand) is a
    different, already-fixed bug — FORM B here (destructured `{id}`, top-level) fires correctly,
    proving that fix landed. This gap is the recognizer never producing a write fact for the
    single-object mutation shape at all; it also refutes `bugz-3.md:202`'s claim that `mutation(...)`
    handlers are captured by alias-independent collectors so KV414/KV438 still fire.
  - Acceptance: teach `projectMutationHandlerCallbacks` (and/or the write-scope collector) the
    single-object source-derived-key form (mirror `staticQueryDeclarationFromCall`, `static.ts:1019`,
    which already handles an `ObjectLiteralExpression` arg0 for queries), or stop hard-skipping
    `summaryOnly` functions for the write-scope IDOR audit when they are real mutation handlers. A
    focused test must assert KV414 fires for an unscoped owner-table write in the inline
    `mutation({ handler })` form (FORM A above), not only the top-level form.
  - Fixed evidence (2026-06-29): `packages/drizzle/src/static/project-receivers.ts` now recognizes
    exported object-form mutation declarations through `staticMutationDeclarationFromCall`; `pnpm exec
vitest run packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.writes-receivers.test.ts
--reporter=dot` passed and includes the source-derived `mutation({ handler })` owner-write
    regression.

### B2. §4.9 update-coverage silently misses any island state/query value read through a render-local const — no derive, no KV311, ships frozen UI

- [x] **A state/query-dependent JSX position fed by a render-local `const` lowers as a static server expression with no client derive AND emits no KV311, so a green build ships permanently-stale UI.** (HIGH, framework — soundness/completeness)
  - Observed: In a non-isomorphic island, `const matches = items.filter(c => c.name.includes(needle))`
    then `<p>{matches.length} matching</p>` / `{matches.map(...)}` builds clean, `kovo check coverage`
    returns OK, and `pnpm run check` is GREEN — but the lowered render has **no `data-bind`/derive**
    for those positions, so they show the unfiltered SSR value forever. The sibling `<input value={state.query}>`
    (a _direct_ member read) _is_ lowered to `data-bind:value=…#derive`.
  - Impact: SPEC §4.9 is a normative completeness theorem (line ~434): "every query- or
    island-local-state-dependent position in rendered output must have a declared update status, or
    the page renders data it will never refresh — the silent-staleness bug §10.6 exists to kill." A
    one-line local `const` (the natural way to author an L1 filter/sort) defeats the proof with zero
    diagnostics: both the lowering pass (no derive emitted) and the KV311 detector are blind to it.
    Soundness gap, not a direct exploit.
  - Root cause: `packages/compiler/src/analyze/query-coverage.ts:73` (`jsxStateExpressionPaths`) and
    `:55` (`jsxQueryExpressionPaths`) build dependency paths only from `expression.propertyAccesses`
    whose root identifier is a state path / known query. A JSX expression that is a bare identifier
    aliasing a render-local `const` (`{upper}`, `{matches.length}`) has root `upper`/`matches`, not
    `state`/a query, so it yields zero paths. The KV311 UNHANDLED detector
    (`analyze/query-updates.ts:268-308`) iterates exactly those path sets, so an undetected path
    emits no fact; the lowering pass shares the same blind spot, so it emits no derive. Dataflow
    through a single intermediate render-local `const` drops the dependency from BOTH passes.
  - First-hand repro (this session, `kovo compile component` on a minimal island):
    `const upper = state.query.toUpperCase();` then `<p data-via="const">{upper}</p>` and
    `<p data-via="inline">{state.query.toUpperCase()}</p>` →
    `kovo compile component stale.tsx --emit-client-files` (only diagnostic: WARN KV210 anonymous
    handler; **no KV311**). Lowered IR: the inline `<p>` got
    `data-bind="…/stale.client.js#StaleProbe$p_text_derive">{escapeText(state.query.toUpperCase())}`;
    the const `<p data-via="const">{upper}` got **no data-bind**. `stale.client.js` exports a derive
    for the input and the inline `<p>` only — **none** for the const-aliased `<p>`.
  - SPEC refs: §4.9 (update coverage exhaustiveness / KV311), §4.8 (bindings/derives), §10.6
    (silent-staleness), §7 L1.
  - Why framework not app: the author wrote an ordinary typed expression in a bound position; §4.8
    says inline JSX expressions in bound positions lower to derives and §4.9 guarantees every
    state/query-dependent position is covered or flagged. The compiler chose to neither lower nor
    flag a const-aliased read. Distinct from super-1 C1 (the _isomorphic_ path LOUDLY rejecting
    consts via KV303, now fixed); this is the _non-isomorphic_ path SILENTLY accepting and dropping
    them. Dedup: none.
  - Acceptance: the const-aliased state/query-dependent position must either lower to a derive or be
    flagged (KV311 / guide to `isomorphic:true`). A focused compiler test must assert that
    `const x = state.q.f(); <p>{x}</p>` produces either a derive or a KV311 fact (today it produces
    neither). Note SPEC line ~1392 lists KV311 as `warn`, so the load-bearing fix is the lowering
    miss; the missing KV311 is the lost safety net.
  - Fixed evidence (2026-06-29): `packages/compiler/src/analyze/reactive-aliases.ts` makes §4.9
    coverage and text-derive lowering follow same-render-body `const` aliases; `pnpm exec vitest run
packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-coverage.test.ts --reporter=dot`
    passed and covers state aliases lowering to derives plus query aliases surfacing KV311.

## Latest Verification

- `pnpm exec vitest run packages/drizzle/src/index.scope-audits.test.ts packages/drizzle/src/index.writes-receivers.test.ts --reporter=dot`:
  passed (120 tests), proving B1's object-form mutation handler now emits a write-side owner audit.
- `pnpm exec vitest run packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-coverage.test.ts --reporter=dot`:
  passed (48 tests), proving B2's state alias lowers to a client derive and query aliases no longer
  disappear from KV311 coverage.
- `pnpm --filter @kovojs/compiler run build:dist`: passed, proving the compiler package still emits
  declarations with the alias helper.

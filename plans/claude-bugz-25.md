# Round-4 Soundness Bugz 25

Created 2026-07-01. Source of truth remains `SPEC.md`. Security/soundness defects found dogfooding AFTER
the user implemented `plans/fundamental-fixes.md` (the fail-closed verifier program). Papercuts from this
round are in `plans/claude-papercuts-23.md`.

**Meta-theme — the program's direction is right, and its shallow-layer fixes HOLD, but the deep layers
are still fail-open.** B (identity resolver) + A (fail-closed default) genuinely closed the _recognition_
and _closure/binding-erasure_ classes (verified: closure secret read → KV406; direct/aliased/`.map`-renamed
secret projection → KV435; resolver alias/namespace/assignment/shadow evasion → caught; brand-forge and the
`@kovojs/server` XSS import → caught; task/webhook/endpoint direct writes → fail closed). But the sinks the
program LEFT on source-AST tracing (KV426, KV435, KV311) have **value-flow** gaps, the runtime guards are
Postgres-shaped **denylists blind to SQLite**, the NEW resolver has **resolution-edge** gaps, and the B4
island fix is **incomplete + introduced a regression**. Every cluster below is exactly what the plan's own
thesis predicts is still open: the un-migrated-to-IR sinks (Workstream C) and the allowlist-not-denylist
lesson. Root causes confirmed first-hand in source; A1 and C1 self-verified (runtime flip / build flip);
the rest reproduced by independent skeptical verifiers via isolation flips (safe spelling RED, sibling GREEN).

## A. Denylist verb-sets are dialect-blind — the SQLite better-sqlite3 methods are ungated (one root, two gates)

The read-only and SQL-safety guards enumerate Postgres/pglite verb names and treat everything else as safe.
`better-sqlite3` drizzle's SQL sinks are `.run/.get/.all/.values` (+ `.transaction/.with`) and it has no
`.execute/.exec`, so the SQLite starter — the DEFAULT dialect this series dogfoods — has ungated write paths.

- [ ] **B1 — The read-only `Reader<Db>` handle (`readonlyAppDb`, the capability-narrowing's blessed read capability) executes writes via `.all`/`.get`/`.values`/`.transaction`/`.with`, defeating KV433 and the F capability-narrowing on a green build.** (HIGH, framework/security; found by `capability-write-deep`+`raw-sql-deep`, SELF-VERIFIED)
  - Observed: `readonlyAppDb.delete()` throws `KovoReadonlyHandleError` (the fix holds), but `readonlyAppDb.all(sql`DELETE FROM contacts WHERE id='c1' RETURNING id`)` and `readonlyAppDb.transaction(tx => tx.run(sql`DELETE …`))` **execute the writes** (row count 3→1), with `tsc --noEmit`, `build:prod`, and `check:sound-subset` all GREEN. End-to-end: a public GET endpoint running `readonlyAppDb.all('DELETE FROM contacts RETURNING id')` deleted every row and returned the ids.
  - Root cause: `packages/server/src/managed-db.ts:27` `WRITE_VERBS = {insert,update,delete,execute,run,batch}` is a **denylist**; the `readonlyDb()` proxy (`:74-87`) throws only for those and passes every other property straight through `Reflect.get` (`:84`). `Reader<Db>` (`:52-59`) `Omit`s only the same 6 verbs, so `.all/.get/.values/.transaction/.with` survive the type too. A read capability must mirror the read builder (allowlist), not deny 6 verbs.
  - Why it matters: the confused-deputy write on an idempotent GET (which the code's own comment `:24-25` names) is exactly what KV433 exists to prevent, and `readonlyAppDb` is the handle the F work blesses for endpoint reads — so the capability-narrowing is bypassable by any app author with no cast/`any`/`$client`.
  - Repro evidence (SELF-VERIFIED): `readonlyDb(db).all(sql`DELETE … RETURNING`)` → count 3→2; `.transaction(delete)` → 2→1; `.delete()` → throws. All under a green build/tsc.
  - Acceptance: the read-only handle is an **allowlist** of read builders (select/query/`$with`-read), so `.all/.get/.values/.transaction/.with/.run(<write>)` fail closed — dialect-independently. Add a metamorphic seed covering every drizzle SQL sink per dialect.

- [ ] **B2 — On SQLite, the managed mutation handle's raw-SQL cross-check (`parseSqlWriteTables` observed⊆declared) AND the KV422 raw-string floor are DEAD: a mutation writes any table outside its declared `tables:` with no throw.** (HIGH, framework/security; found by `raw-sql-deep`, verified independently)
  - Observed: `wrapManagedDbForSqlSafety(sqliteDb, …, {tables:['contacts']}).run(trustedSql(sql`UPDATE "user" SET name='pwned'`))` does NOT throw and `user.name` becomes `'pwned'`; same via `.get/.all` with `… RETURNING`; even a raw string via `.run` doesn't fire KV422. The pg-shaped `$client.exec("UPDATE 'user' …")` control DOES throw.
  - Root cause: `packages/server/src/sql-safe-handle.ts` `wrapDbAdapter` get-trap (`:98-128`) guards only `prop ∈ {sql,query,exec,execute,prepare,transaction}`; `better-sqlite3`'s sinks `.run/.get/.all/.values` fall through to the pass-through branch (`:126`), so `assertSqlWriteTablesAllowed` (`:382`) / `validateManagedSqlStatement` never run. The static KV406 gate trusts the declared `registry.tables` without parsing SQL, so the runtime cross-check is the _sole_ honesty check — and it is dead on SQLite (§11.2 `observed ⊆ declared` is unenforced).
  - Why it matters: the §11.2 runtime cross-check that makes the raw-SQL escape hatch safe (the "declare-and-verify" property) simply does not run on the default SQLite dialect — a mutation can smuggle a cross-table/owner write past its declared allowlist.
  - Repro evidence: `.run(trustedSql(sql`UPDATE "user" …`))` on a `tables:['contacts']` handle → no throw, `user` mutated; `$client.exec` control → KV422 throw.
  - Acceptance: the SQL-safety proxy intercepts every dialect's SQL sinks (`.run/.get/.all/.values` for better-sqlite3) and runs `assertSqlWriteTablesAllowed` on them; a SQLite mutation writing outside `tables:` fails closed (dev CI + prod). Metamorphic seed per dialect.

## B. KV426 trusted-HTML provenance is an incomplete source-AST tracer (residuals of `bugz-4` M3; the un-migrated XSS sink)

KV426 traces taint by re-walking source with hand-enumerated shapes; each unenumerated shape is an XSS
fail-open. This is the poster child for why Workstream C should migrate trusted-HTML off source-AST tracing.

- [ ] **B3 — KV426's request source is a NAME heuristic (`input`/`req`/`request`): renaming the render's request parameter silently disables the trusted-HTML XSS gate.** (HIGH, framework/security; found by `trusted-html-deep`, verified independently; residual of `bugz-4` M3)
  - Observed: `render: ({}, _s, { request: input }) => trustedHtml(input.body)` → KV426 RED; renaming to `render: ({}, _s, r) => trustedHtml(r.body)` → GREEN with the identical raw-HTML sink.
  - Root cause: `packages/compiler/src/validate/trusted-html-provenance.ts` matches the request root by literal identifier text — `REQUEST_INPUT_IDENTIFIER='input'` (`:82`), `REQUEST_ACCESSOR_ROOTS={'req','request'}` (`:84`), consumed at `:199`/`:221`. It never resolves the render signature's request parameter by position/symbol.
  - Acceptance: the render request parameter is identified by position/symbol (the render lowering knows arg 3 is the request), not by name; a renamed request param still fires KV426.

- [ ] **B4 — KV426 drops query-provenance when the render's data parameter is not destructured.** (HIGH, framework/security; found by `trusted-html-deep`, verified independently; residual of `bugz-4` M3)
  - Observed: `render: ({ contacts }) => trustedHtml(contacts.items[0].name)` → RED; `render: (data) => trustedHtml(data.contacts.items[0].name)` → GREEN, same sink.
  - Root cause: `trusted-html-provenance.ts:435-440` `collectRenderQueryBindings` bails when `render.parameters[0]` is not an `ObjectBindingPattern` (self-labeled "query-binding detection is residue (documented)"), so `classifyIdentifier` sees an empty query-binding set.
  - Acceptance: query bindings are collected from a non-destructured data param (member-access into `data.<query>`), so `trustedHtml(data.q…)` fires KV426.

- [ ] **B5 — KV426 misses `||`/`??`/`&&`/template-literal composition of a tainted root (the M3 fix added only the ternary).** (HIGH, framework/security; found by `trusted-html-deep`, verified independently; residual of `bugz-4` M3)
  - Observed: `trustedHtml(input.body)` → RED; `trustedHtml(input.body ?? '')` → GREEN (same for `|| ''`, `cond && input.body`, `` `${input.body}` ``).
  - Root cause: `trusted-html-provenance.ts:152-170` `classifyExpression` handles unwrap + PropertyAccess/ElementAccess/Identifier + `ConditionalExpression` (the M3 addition) but NOT `BinaryExpression` or `TemplateExpression` — both fall through to `return null` (treated clean).
  - Acceptance: `classifyExpression` propagates taint through binary logical/nullish operators and template expressions (any operand tainted ⇒ tainted).

## C. The new identity resolver has resolution-edge gaps (re-opens the whole B layer)

- [ ] **B6 — The framework-identity resolver ignores computed / element-access members (`ns['trustedHtml']`), so KV426 and every Drizzle B-gate fail open on computed access.** (HIGH, framework/security; found by `identity-resolver-deep`, SELF-VERIFIED source; new)
  - Observed: `import * as k from '@kovojs/browser'; k['trustedHtml'](taint)` → GREEN (no KV426); the property-access sibling `k.trustedHtml(taint)` → RED. Same runtime brand.
  - Root cause: `packages/core/src/internal/framework-identity.ts:262-294` `canonicalExpression` branches only on `ts.isIdentifier` (`:273`) and `ts.isPropertyAccessExpression` (`:281`), then `return undefined` (`:293`) — **no `ts.isElementAccessExpression` branch**. `packages/drizzle/src/static/framework-identity.ts:152,165` shares the gap, so owner-read/SQL/Reader recognizers are equally blind.
  - Why it matters: the resolver is the foundation of ALL B-hardened gates; a single missing resolution edge re-opens the entire fail-open-recognition class the program was built to close.
  - Acceptance: `canonicalExpression` resolves `ElementAccessExpression` with a literal/constant key (`ns['export']`), and fails closed on a non-literal computed key. Metamorphic seed covers `ns[key]`.

- [ ] **B7 — A cross-file local barrel re-export (`export { trustedHtml } from '@kovojs/browser'` or `export *`) launders past KV426, because the resolver's cross-file edge is populated only by conformance fixtures, never by the real build.** (HIGH, framework/security; found by `identity-resolver-deep`, verified independently)
  - Observed: a local `src/components/browser-barrel.ts` re-exporting `trustedHtml`, imported as `./browser-barrel.js`, → GREEN for query-derived `trustedHtml(taint)` that is RED via a direct `@kovojs/browser` import. `export *` also GREEN.
  - Root cause: the resolver's only cross-file edge, `localModuleExportIdentity → resolveProjectSourceFile` (`framework-identity.ts:682-771`), needs sibling files registered via `registerFrameworkIdentityProject`, fed from `options.extraFiles`. The ONLY producers of `extraFiles` are the conformance fixtures (`metamorphic-recognition-fixtures.ts`); the real Vite/compile transform reads one module via `readFileSync` and never populates it, so `resolveProjectSourceFile` always returns `undefined` in a real build. Separately, `exportedIdentity` (`:712-737`) only handles `isNamedExports`, so `export *` is unhandled even with `extraFiles`.
  - Why it matters: **the metamorphic harness passes because it populates `extraFiles`, but production is fail-open** — a test-vs-production divergence in the very harness (Workstream E) meant to prevent this class. A local re-export barrel is a one-file XSS-gate bypass.
  - Acceptance: the real build registers project sibling files with the resolver (or resolves re-exports via the TS program), and `export *` is followed; a local barrel re-export of `trustedHtml` fires KV426 in a real `kovo build`. The metamorphic harness must exercise the production `extraFiles`-population path, not a fixture-only one.

## D. The B4 island-derive fix is incomplete and introduced a regression (residuals of `claude-bugz-24` B4)

- [ ] **B8 — The B4 fix lowers destructured/chained/nested/computed state aliases to a client derive whose body references an UNBOUND render-local identifier → `ReferenceError` at hydration on a green build (it traded silent frozen-UI for a runtime crash).** (HIGH, framework/soundness; found by `island-derive-deep`, verified independently; residual/regression of `claude-bugz-24` B4)
  - Observed: green build, zero KV311; the emitted client derive for `const {count}=state; {count}` is `derive(["state"], (state) => count)` — `count` is render-local and absent from the client module, so `derive.run(state)` throws `ReferenceError: count is not defined`. Same for chained/nested/computed aliases. Control `{state.label}` is correctly reactive.
  - Root cause: `packages/compiler/src/analyze/reactive-aliases.ts:31` expands only aliases with `isExpressionAlias` (an identifier whose initializer has ≥1 property access). The B4-added destructured (`destructuredAliasesForExpression`) and chained bare-identifier aliases carry no `.expression`, so they COUNT for coverage (a derive is emitted at `lower/structural-jsx.ts:1508`) but are filtered out of the derive body, leaving the raw render-local identifier.
  - Acceptance: a destructured/chained state alias lowers to a derive body that references `state.<path>` (not the render-local binding), or fails closed with KV311 — never a green build over a derive that throws.

- [ ] **B9 — Array-destructured state reads (`const [x] = state.items`) emit neither a client derive nor KV311 → silent permanently-stale UI on a green build (B4 handled only `ObjectBindingPattern`).** (HIGH, framework/soundness; found by `island-derive-deep`, verified independently; sibling of `claude-bugz-24` B4)
  - Observed: `const [firstItem]=state.items; {firstItem}` → SSR `<p>` has no `data-bind`, client module has no derive, node renders the initial value and never updates. Object-destructure sibling IS handled.
  - Root cause: `reactive-aliases.ts:131-132` `destructuredAliasesForExpression` guards only `ts.isObjectBindingPattern`; `ts.isArrayBindingPattern` is never handled (`bindingPatternAliases` recursion at `:254` is object-only). No reactive alias ⇒ no derive AND no KV311.
  - Acceptance: array-binding-pattern state reads produce a reactive alias (derive) or fire KV311.
  - Note: `claude-bugz-24` B5 (a render-local alias calling a module-scope helper → unbundled → `ReferenceError`) is a DISTINCT, still-OPEN item (marked `[ ]`); `island-derive-deep` confirmed it still reproduces. Kept in `claude-bugz-24`, not re-filed here.

## E. KV435 value-flow laundering (cross-select)

- [ ] **B10 — A `secret:`-classified column read in a SECOND select and laundered onto the returned array (via `.find()`+assignment / `.push`) reaches the client wire on a green build.** (HIGH, framework/security; found by `read-audit-deep`, verified independently; new)
  - Observed: with `kovo({ …, secret:['company'] })`, the direct/aliased projection of `contacts.company` is RED (KV435), but reading it in a second select (`db.select({id, secret: contacts.company})`) and laundering onto the returned rows (`for (const sr of secretRows){ items.find(it=>it.id===sr.id).company = sr.secret }`) builds GREEN and the secret value ships over `/_q`.
  - Root cause: two-part enforcement, both trace only the returned SELECT projection. (1) `queryShapeContainsSecret` (`packages/drizzle/src/static/query-shapes.ts`) inspects only the projection that becomes the returned shape. (2) The read-provenance backstop `secretProjectionBackstopDiagnostics` (`packages/drizzle/src/static.ts:2801-2826`) whitelists resolved column projections at `:2812` (`if (column.projection==='column' && column.classification!=='unresolved') continue;`) — so a _resolved secret_ read is skipped and delegated to the shape check, which never models cross-select laundering. The read is recorded (it fires KV310 domain invalidation) — the framework knows a secret column was read but never connects it to the wire.
  - Why it matters: KV435's entire contract (§6.6/§10.2/§11.3) is that `secret:`-classified columns (password hashes, tokens, PII) never reach the JsonValue wire. This ships one on a green build with zero diagnostics.
  - Acceptance: KV435 tracks the read secret column through value flow onto the returned shape (or the backstop stops whitelisting resolved secret projections and requires the read to be proven off-wire); the two-select laundering fails closed. (This is a value-flow gap — a strong candidate for the Workstream C IR migration of the read/secret sink family.)

## Latest Verification

- Baseline: fresh SQLite scaffold on the plan-implemented framework — `check`/`build:prod` green (the fail-closed + capability-narrowed starter builds clean).
- B1 SELF-VERIFIED (runtime flip): `readonlyDb(db).all(sql`DELETE … RETURNING`)` + `.transaction(delete)` deleted 2/3 rows while `.delete()` threw. Source `managed-db.ts:27,52-59,74-87`.
- B6 SELF-VERIFIED (source): `framework-identity.ts:262-294` has no `ElementAccessExpression` branch.
- Other root causes confirmed first-hand in source (`sql-safe-handle.ts:98-128,382`; `trusted-html-provenance.ts:82,84,152-170,435-440`; `framework-identity.ts:682-771,712-737`; `reactive-aliases.ts:31,131-132`; `static.ts:2801-2826`); runtime symptoms reproduced by independent verifiers via isolation flips.
- Monorepo repaired (`pnpm install` at root); `git status` shows only the new `plans/claude-*.md`; stray servers killed. Throwaway apps under `/Users/mini/kovo-dogfood-round4/` — safe to delete.

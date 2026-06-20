# Bugs & Testing — Part 3 (Implementation-Level Audit, second sweep)

**Date:** 2026-06-20
**Scope:** A third, **implementation-focused** bug + coverage-gap hunt over `packages/*/src`, continuing
`plans/bug-and-testing-part2.md`. Part 2's lanes A–K concentrated on the headline mutation/optimism/output
paths; this pass deliberately targets the subsystems part 2 **under-covered** — touch-graph extraction &
IDOR predicate analysis, the build/compile cache, static-export, query-delta application, the node adapter
& request shell, CSP & security headers, routing/matcher normalization, the registry/type layer, the
better-auth adapter, headless-ui primitives, CSS/StyleX emission, and the object-storage capability. Every
item cites `file:line` and a concrete scenario; each was independently confirmed.

## How this was produced

A multi-agent adversarial sweep (the same methodology as parts 1–2): **14 subsystem finders** read the real
implementation, then **each candidate faced two independent verifiers** — an *exploiter* (build the concrete
repro / prove the path is reachable) and a *refuter* (find the code that already handles it, the test that
already covers it, or proof it duplicates a tracked item). A completeness critic then named under-covered
classes and a **second targeted round** (object-storage, mutation→query invalidation matching, route-matcher
normalization, document hints/speculation, deferred-stream ordering) ran the same gauntlet. All finders were
primed with the full **do-not-report set** — bugs-1 `F1–F40`, every part-2 lane A–K plus its contested and
deferred items, and the known-open list — so part 3 reports only **distinct** defects.

**Raw:** 55 candidate findings across two rounds → **26 confirmed** (both verifiers clean), **22 contested**
(one verifier dissented or down-scoped), 7+ rejected. Confirmed split: **4 critical, 14 high, 5 medium, 3
low.** Six contested items where the *exploiter confirmed* and the refuter only narrowed scope (not a
refutation) are **promoted into the lanes** below, marked `(promoted)`; the rest are triaged in their own
section.

## Two record-corrections (read first)

These contradict guarantees the framework markets and "done" claims in earlier ledgers:

1. **The KV414 IDOR gate does not exist for writes, and is bypassable for reads.** `bugs-and-testing.md`
   marks F12/KV414 "spec + code + test aligned." But the *only* producer of `ScopeAuditFact`,
   `scopeAuditsFromQueryFacts` (`drizzle/src/static.ts:180`), hard-codes `kind:'query'` (`:194`,`:199`) and
   never inspects writes — so an owner-table **mutation** keyed by a client arg emits **no KV414** (`kovo
   check` exit 0). The `ScopeAuditFact.kind` union literally includes `'write'` (`core/src/graph.ts:285`),
   proving the intent, yet nothing produces it. And the read side only recognizes a *direct* `eq()` callee
   (`static.ts:5583`), so wrapping the IDOR predicate in `and(...)` silently disarms the gate — while the
   write touch-extractor already unwraps `and()` via `eqPredicateConjuncts` (`:9736`). → **A1 (critical) +
   A2 (critical) + A3 (high).**
2. **A keyed change never reruns a list/aggregate query that reads the same domain — the canonical stale-UI
   bug Kovo exists to kill (SPEC §1.1:19 "a list that didn't reflect its own mutation").**
   `changeRecordTouchesQueryInstance` (`server/src/change-record.ts:78`) only reruns a query whose
   `instanceKey` is the row encoding `domain[:via]:key` or `startsWith(`${domain}:`)`. A list keyed
   `orders-page:1`, a per-user total `cartTotal:u7`, or a category list `productsByCat:electronics` fails the
   prefix test → excluded from the rerun set, ships no `<kovo-query>` chunk, renders pre-mutation data. → **A4
   (critical).**

---

## Execution status — NOT STARTED

This is a fresh audit ledger. No item below is implemented; every checkbox is open. Definition of done per
item (CLAUDE.md / `rules/`): the cited test goes **red against today's code, green after the fix**; several
existing tests *codify the bug* (`combobox.stylex.test.tsx.snap` dangling activedescendant; `match.test.ts`
encoded-param family; the `domain:via:key` assertions in `change-record.test.ts`/`mutation.test.ts`) and must
be inverted, not preserved.

## Summary (confirmed + promoted, by lane)

| Lane | Theme | Crit | High | Med | Low |
| --- | --- | --- | --- | --- | --- |
| **A** | Authorization & invalidation soundness (touch-graph) | 3 | 2¹ | — | — |
| **B** | Build/compile cache & generated-artifact determinism | 1 | 1¹ | — | 1 |
| **C** | Static-export pipeline | — | 2 | — | — |
| **D** | Query delta & client store | — | 2¹ | 1 | — |
| **E** | Node adapter, request shell & dispatch | — | 2 | 2¹ | — |
| **F** | Routing & matcher normalization | — | 2 | — | — |
| **G** | CSP & security headers | — | 2¹ | — | — |
| **H** | Registry & type-system soundness | — | 1 | — | — |
| **I** | better-auth adapter | — | 2¹ | — | 1 |
| **J** | headless-ui primitives | — | 1 | 1 | 1 |
| **K** | CSS / StyleX emission | — | 1 | 1 | — |
| **L** | Object-storage capability | — | 1 | 1 | — |

¹ includes one item promoted from *Contested* after exploiter confirmation. Contested items (16 remaining) +
a deferred-stream-ordering cluster are triaged in their own section.

---

## Lane A — Authorization & invalidation soundness  *(the standout cluster: 3 criticals; `drizzle/src/static.ts`, `server/src/change-record.ts`, `server/src/generated-query-registry.ts`)*

This lane decides whether the framework's two headline guarantees actually hold: **IDOR cannot pass CI** and
**no query stays stale after a mutation it reads**. Both are broken in distinct, independently-exploitable ways.

- [ ] **A1 (critical) — KV414 IDOR audit never runs on writes; owner-table mutations keyed by a client arg are unenforced** `spec-impl-divergence` (L4-1)
  - **Where:** `drizzle/src/static.ts:180-205` (`scopeAuditsFromQueryFacts` emits only `kind:'query'`, `:194`/`:199`); `:432-442` (`extractOwnerAuditFromProject` derives `scopeAudits` *solely* from query facts); CLI gate consumes only `output.scopeAudits` (`cli/src/index.ts:4771-4784`); `ScopeAuditFact.kind` union includes `'write'` (`core/src/graph.ts:285`) but nothing emits it.
  - **Defect:** §10.3/§11.1 KV414 covers "query **or write** reaches an `owner:`-annotated table" (SPEC.md:1094, table :1304). A handler `db.update(orders).set({…}).where(eq(orders.id, input.id))` against `owner:(t)=>t.userId` lets any authenticated principal mutate another user's rows; `kovo check` emits no KV414 and exits 0. The write predicates *are* extracted (`writeKey`/`eqPredicateConjuncts`, `:5728-5760`) but only feed the invalidation graph, never a `ScopeAuditFact`. The blocking gate SPEC calls "not advisory" simply does not exist for the write half.
  - **Fix:** add a write-side scope-audit producer paralleling `scopeAuditsFromQueryFacts`: per write touch on an owner domain, classify the predicate key as `args` (→ `kind:'write'`), `session`, or neither; wire into `extractOwnerAuditFromProject:436`. The existing CLI gate then enforces it unchanged.
  - **Test:** fixture `orders {key id, owner userId}` + mutation `update(orders).where(eq(orders.id, input.id))` → `extractOwnerAuditFromProject(...).scopeAudits` contains `{domain:'order', kind:'write', scope:'args'}` and the CLI emits `ERROR KV414`. (Existing `index.kovo-explain.test.ts:568` hand-builds a write audit; no producer test exists.)
  - **Verified:** exploiter+refuter both reproduced empty `scopeAudits` for the write; live grep confirms `kind:'query'` is the only emitted kind.

- [ ] **A2 (critical) — Query KV414 escapes via `and()`/`or()`-wrapped predicates (combinator-nested `eq` operands never extracted)** `impl-bug` (L4-2)
  - **Where:** `static.ts:5570-5595` — `queryInstanceKeyComparisons` rejects any `where()` whose top-level callee is not the literal identifier `eq` (`:5583 expression.getText() !== 'eq'`). Contrast the write side `eqPredicateConjuncts` (`:9736`) which recursively unwraps `and(...)`.
  - **Defect:** real owner queries combine predicates: `where(and(eq(orders.id, input.id), eq(orders.status,'open')))`. Because the callee is `and`, the function returns `[]` → no instance key → `argKeyed` false → **no KV414**, even though `input.id` keys an owner-table read. Wrapping the IDOR predicate in any combinator disarms the read-side gate the way part-1 KV414 was supposed to cover.
  - **Fix:** replace the direct-`eq` check with `eqPredicateConjuncts(predicate)` so each `and(...)` conjunct becomes a comparison; keep `or(...)` fail-closed (an arg-keyed owner operand anywhere in the tree is an `args`-scope *candidate*, while only top-level/`and` conjuncts may discharge a unique instance key).
  - **Test:** loader `where(and(eq(orders.id, input.id), eq(orders.status,'open')))` → `scopeAudits` has `{scope:'args'}` (→ KV414); sibling `where(and(eq(orders.userId, req.session.userId), …))` stays `scope:'session'` (no KV414).
  - **Verified:** both verifiers ran `extractOwnerAuditFromProject` on the `and()` form → `scopeAudits === []`; the direct-`eq` form yields `scope:'args'`. Live grep confirms `:5583` vs `:9736` asymmetry.

- [ ] **A3 (high) — Owner-column key predicate with a client arg escapes KV414 because detection only matches the declared `key` column** `impl-bug` (L4-3)
  - **Where:** `static.ts:5651-5683` (`queryInstanceKeyFromEqOperands`→`resolvedQueryTableKey` requires `annotation.key === key.key`); `:180-196` (`argKeyed` gated on the instance key existing).
  - **Defect:** owner tables usually have `key != owner` (`key:(t)=>t.id, owner:(t)=>t.userId`). A loader `where(eq(orders.userId, input.userId))` keys on the **owner** column with a client value — canonical IDOR — but because `userId != id`, `resolvedQueryTableKey` returns null → no instance key → `argKeyed` false → **no KV414**. The signal keys off the declared instance-key column instead of "any client-arg predicate selecting owner-table rows."
  - **Fix:** detect an `args`-scope candidate whenever any where-operand is `input.*` compared against a column of an owner-annotated table, independent of the declared key column; keep the declared-key match only for instanceKey/invalidation granularity.
  - **Test:** `where(eq(orders.userId, input.userId))` → `scopeAudits` has `{scope:'args'}` + KV414; `where(eq(orders.userId, req.session.userId))` stays `session`.
  - **Verified:** both verifiers reproduced empty `scopeAudits` for the owner-column arg; the declared-key column form fires correctly. Sibling of bugs-1 KV414 but a distinct mis-classification.

- [ ] **A4 (critical) — Keyed change-record never reruns a list/aggregate query reading the same domain → silent stale list** `impl-bug` (L2-invalidation-1)
  - **Where:** `server/src/change-record.ts:78-119` (`changeRecordTouchesQueryInstance` / `queryInstanceKeyReadsChangeDomain`, prefix test at `:113`); call path `mutation.ts:1574-1585` (`queryTouchedByChange`) + `:1556-1572` (`queriesToRerun`).
  - **Defect:** for a key-scoped change (`{domain:'order', keys:['o1'], via:'orders'}`), a query is rerun only if its `instanceKey` equals `domain[:via]:key` (`:83`) or `startsWith(`${domain}:`)` (`:113`). A list/aggregate keyed `orders-page:1` / `cartTotal:u7` / `productsByCat:electronics` fails both → because `instanceKey !== undefined`, it does **not** fall through to the unconditional-rerun branch → excluded from `queriesToRerun`, ships no `<kovo-query>`. After `addItem`/`reserve`, the list view renders pre-mutation data forever. §10.1 makes the domain the cache currency; key granularity may *narrow within a row reader*, never silently exclude a same-domain non-row reader.
  - **Fix:** only attempt key-narrowing when the `instanceKey` provably parses as a single-row identity of *this change's domain* (matching `change.keys`). For any non-row-identity reader, fall back to `invalidate=true` (the §10.1 over-invalidate-when-uncertain rule the same file already cites at `:115-118`).
  - **Test:** `change-record.test.ts` — `changeRecordTouchesQueryInstance({domain:'order',keys:['o1'],via:'orders'}, 'orders-page:1') === true`; integration via `runMutation` — a list query `reads:[order]` with `instanceKey:'orders-page:1'` appears in `rerunQueries` after an `order` touch (today `[]`).
  - **Verified:** both verifiers executed the three functions verbatim — `match(…,'orders-page:1') === false`, `match(…,'cartTotal:u7') === false`; row-identity control `'order:orders:o1' === true`. Distinct from part-2 C5/settlement (client optimism); this is server-side post-commit rerun selection.

- [ ] **A5 (high, promoted) — `queryWithGeneratedReads` overwrites author-declared `reads:` instead of folding → silent under-invalidation** `spec-impl-divergence` (L12-2)
  - **Where:** `server/src/generated-query-registry.ts:42-49` (`return { ...definition, reads }` *replaces*; docstring `:15-19` claims it only "populates omitted reads"); applied to every query at `app.ts:171-173`; feeds invalidation at `mutation.ts:1579`.
  - **Defect:** §10.2:1018 says a KV410 opaque projection's declared `reads:` is **folded into** (union) the read set. The impl replaces: if the compiler registered any non-empty reads, the author's `reads` is discarded. A query with a visible base read on `products` plus an opaque `sql<T>` over `inventory` (the exact case KV410 forces an author `reads:[product, inventory]`) gets its reads overwritten to just `[product]` → a mutation touching `inventory` no longer invalidates it. The opaque-projection contract is defeated at runtime.
  - **Fix:** union registered reads with `definition.reads` (dedupe by key); or only inject when `definition.reads` is empty (matches the docstring).
  - **Test:** query with `reads:[product, inventory]` + compiler-registered `[product]` → effective read set is the union; a mutation on `inventory` reruns it.
  - **Verified:** exploiter confirmed the overwrite path end-to-end; refuter agreed on the code (`:46-48`) and narrowed only the framing. Sibling of bugs-1 KV410 (distinct code path: runtime read-set merge, not compile-time emission).

> **Contested sibling (this lane):** keyed-narrowing is also *over*-eager for SPEC §10.2 canonical keys —
> the matcher hard-codes a non-canonical `domain:via:key` encoding while the wire/store/optimism currency is
> `name:keyValue` (`product:p1`), so every sibling instance's fragment ships on every keyed mutation. Same
> file as A4, opposite direction. See *Contested* (L2-invalidation-2).

---

## Lane B — Build/compile cache & generated-artifact determinism  *(`compiler/src/cache-identity.ts`, `persistent-compile-cache.ts`, `emit/bootstrap.ts`)*

- [ ] **B1 (critical) — Persistent compile cache survives any compiler upgrade: `compilerBuildId()` is a hardcoded constant** `impl-bug` (L8-1)
  - **Where:** `cache-identity.ts:5` (`compilerPackageVersion = '0.1.0'`), `:24-32` (`sourceFingerprints` defaults `{}`); both production call sites invoke `compilerBuildId()` with **no args** (`vite.ts:430-451`, `cli/src/index.ts:315-327`); read gate `persistent-compile-cache.ts:84` (`entry.compilerBuildId !== compilerBuildId()`).
  - **Defect:** with no args the build id is a build-invariant constant (`@kovojs/compiler@0.1.0/<hash of {}>`). The on-disk cache (`.kovo/cache/compiler`) is keyed by it and only rejected on mismatch — which never happens across releases. **Live proof:** the literal is `'0.1.0'` while `packages/compiler/package.json` is already `0.1.1`, so the namespace is *already* stale. Ship compiler v1 with a buggy/vulnerable lowering → build → upgrade to v2 that fixes it (without hand-editing the literal) → re-build in the same checkout → every unchanged-source component is a persistent **hit** serving the **old** emitted module. A silent un-applied-fix / wrong-output disaster, contradicting the file's own contract (`:17-22` "a compiler implementation change becomes a clean miss").
  - **Fix:** derive `compilerBuildId()` inputs from real artifacts at every call site — read the compiler's own `package.json` version at module load (not a copy-pasted literal) and fold a `dist/` content hash; thread through `compileCacheKey`/persistent read so an upgrade is a guaranteed miss.
  - **Test:** write a persistent entry, stub `compilerBuildId` to a new value (simulating upgrade) → `readPersistentCompileCacheEntry` returns null; `compilerBuildId()` differs after bumping the version source-of-truth.
  - **Verified:** both verifiers traced the no-arg call sites + constant; live grep confirms `'0.1.0'` literal vs `0.1.1` package.

- [ ] **B2 (high, promoted) — App client bootstrap collides query-update-plan exports across same-named components (duplicate import binding + plan clobber)** `impl-bug` (L3-1)
  - **Where:** `emit/bootstrap.ts:42-58` (per-input `import { <exportName> } from …` with no alias, then `...<exportName>` into one `queryPlans` object); export name `emit/client.ts:267` (`${componentName}$queryUpdatePlans`, no path/hash); `scan/parse.ts:443-457` (`inferComponentName` from local name / basename, no uniqueness).
  - **Defect:** two route/component files with the same component name (two `Demo`/`Page`, or basenames that lower to the same identifier) produce the **same** export name. Bootstrap then emits two `import { Demo$queryUpdatePlans } from 'a' | 'b'` lines = a duplicate lexical binding = a hard ES module **SyntaxError** that kills the entire client bootstrap (every island/handler/query dies). Even with distinct names, two components binding the same query key shallow-spread-clobber each other's plan. Generated artifacts must parse and preserve update coverage (§5.2, §4.8).
  - **Fix:** alias each import to a per-input-unique local (hash the import path) and spread the uniques; merge `queryPlans` entries per query name into a combined applier rather than shallow-spreading.
  - **Test:** bootstrap over two inputs sharing `exportName:'Demo$queryUpdatePlans'` from different paths → emitted module parses (no duplicate binding) and both plans run.
  - **Verified:** exploiter replicated the emission → duplicate-binding SyntaxError; refuter agreed on the no-alias/no-dedup code and single-input-only coverage.

- [ ] **B3 (low) — Persistent cache prune deletes content-addressed blobs shared by kept entries** `impl-bug` (L8-4)
  - **Where:** `persistent-compile-cache.ts:104` (`resultRef = blobs/${sha256(resultJson)}.json` — identical results share a blob), `:122-142` (`prunePersistentCompileCache` rm's each evicted entry's `result` blob with no refcount).
  - **Defect:** two cacheKeys that compile to identical output (shared leaf component, two trivial routes) reference the same blob. Pruning an evicted entry deletes the shared blob; a **kept** entry's later read hits the missing-file catch (`:86-90`) → null → spurious recompile. Correctness-neutral but defeats the cache (hence low).
  - **Fix:** refcount blobs — only rm a blob not referenced by any remaining kept entry.
  - **Test:** write two entries with identical results, prune `maxEntries:1`, read the kept entry → still returns the result (today null).
  - **Verified:** both verifiers reproduced the null-after-prune via a temp test.

> **Contested sibling:** the compile cache key folds source only via a **32-bit FNV-1a** (`compile-cache.ts:179`,`:416-424`) with no stored source preimage, so a collision yields a stale wrong-output hit; SPEC §5.2.1#1 mandates a collision-resistant hash. Cheap fix (swap to the already-imported `sha256`) regardless of adversarial reachability. See *Contested* (L8-2).

---

## Lane C — Static-export pipeline  *(`server/src/static-export-*.ts`)*

- [ ] **C1 (high) — `skip`-mode export silently drops every valid sibling page of a param route when one staticPath is non-exportable** `impl-bug` (L1-1)
  - **Where:** `static-export-replay.ts:49-68` (skip predicate `:50 diagnostics.some(d => d.routePath === routeTarget.routePath)`); all param staticPath targets share `routePath=route.path` and all staticPath diagnostics carry that same `routePath` (`static-export-route-plan.ts:94-165`).
  - **Defect:** for `/products/:id`, one bad staticPath (e.g. `/products/%2f`) poisons *all* siblings: every valid concrete page (`/products/p1`) is skipped, with no per-page diagnostic. `skip` mode exists to publish the exportable subset; instead it ships an incomplete site. A mid-loop replay failure pushing a `routePath='/products/:id'` diagnostic drops not-yet-replayed siblings too.
  - **Fix:** skip per concrete target identity, not per `routePath` — give staticPath diagnostics a concrete-path discriminator and suppress only the exact non-exportable URL.
  - **Test:** `route('/products/:id', { staticPaths:['/products/p1','/products/%2f'] })` + `onNonExportable:'skip'` → artifacts include `/products/p1/index.html` AND diagnostics contain exactly the `%2f` KV229 (today `artifacts=[]`).
  - **Verified:** both verifiers ran `replayStaticExportApp` live → `artifacts=[]`, one diagnostic.

- [ ] **C2 (high) — Static export never prunes prior artifacts: a removed route keeps serving stale 200 HTML across rebuilds** `coverage-gap` (L1-2)
  - **Where:** `static-export-output.ts:123-142` (`writeStaticExportOutput`) + `:318-327` (commit) — only mkdir+rename of new writes, no enumeration/removal of stale outputs; `vite-static-export-build.ts` has no clean step.
  - **Defect:** route documents live at a stable mutable path (`/route/index.html`). Export v1 `['/', '/old']` then v2 `['/']` to the same `outDir` leaves `/old/index.html` on disk with the old body → a static host keeps serving a removed page as a live 200 (stale-UI + information-disclosure: an intentionally-removed/unpublished page stays published). Orphaned client-module files accumulate too. (Atomicity via staging is fine; the gap is orphan **retention**.)
  - **Fix:** reconcile `outDir` — enumerate managed route-document & client-module files and remove any not in the current plan (or diff against a written build manifest), atomically with the rename commit. Preserve immutable `/c/__v/<version>/` modules per §14 retention; prune only mutable route-doc artifacts the export owns.
  - **Test:** export `['/', '/old']`, assert `/old/index.html` exists; re-export `['/']`, assert `/old/index.html` is gone and `/index.html` holds v2; assert a prior versioned `/c/__v/` module is retained.
  - **Verified:** both verifiers reproduced `/old/index.html` surviving the v2 export. Distinct from part-2 deferred DEPLOY-4 (that is min-retention in the dynamic serving layer; this is the export writer failing to prune).

---

## Lane D — Query delta & client store  *(`core/src/query-delta.ts`, `browser/src/{query-apply,broadcast,query-store}.ts`)*

- [ ] **D1 (high) — A dropped top-level non-collection field is silently retained; the KV416 round-trip fails** `spec-impl-divergence` (L2-query-delta-1)
  - **Where:** `core/src/query-delta.ts:123-132` (`buildQueryDelta` builds `set` from only the fields *present* in the re-run value), `:167-169` (`applyQueryDelta` per-field overwrite leaves absent fields unchanged); production caller `mutation.ts:1636-1646`.
  - **Defect:** a field the re-run **dropped** (e.g. `{count, coupon, items}` → `{count, items}`) is absent from `set`, so `applyQueryDelta` leaves the stale `coupon` on the client forever (§841: a delta leaves absent fields unchanged). The delta path is chosen exactly when it serializes smaller (large `items` list), so this fires in the realistic case → silent stale wrong output and a hard failure of the §848/KV416 gate `apply_delta(base, Δ) ≡ full`.
  - **Fix:** treat the top-level value as the "parent object sent whole" for non-collection fields — when `set` is present, delete base non-collection keys absent from `set` (i.e. `set` is the authoritative whole-object-minus-collections), or add an explicit removed-field list. Mirror the round-trip gate in tests.
  - **Test:** `core/src/query-delta.test.ts` — base `{count:2,coupon:'SAVE10',items:[…]}`, full `{count:2,items:[…]}` (coupon removed) → `applyQueryDelta(base, buildQueryDelta(full,…))` deep-equals `full` (today retains `coupon`).
  - **Verified:** both verifiers ran the build→apply round-trip → `coupon` survives, `toEqual(full)` fails.

- [ ] **D2 (medium) — A malformed/non-object delta envelope is silently treated as a no-op apply and counted applied, instead of a delta-miss refetch** `impl-bug` (L2-query-delta-3)
  - **Where:** `query-delta.ts:160-176` (`applyQueryDelta` guards only `base`, never the `delta` shape); consumed at `query-apply.ts:57-90` (delta branch, counts `applied`).
  - **Defect:** a delta chunk whose JSON body is `42`/`[…]`/`null`/`{set:"oops"}` makes `delta.set`/`delta.lists` undefined → returns `structuredClone(base)` unchanged, and `query-apply` re-sets base, notifies, and pushes the chunk onto `applied` as success. A corrupted/shape-skewed payload is swallowed as a successful no-op instead of throwing `QueryDeltaApplyError → onDeltaMiss → full refetch` (the §847 recovery contract); the client silently keeps stale data and reports success.
  - **Fix:** in `applyQueryDelta`, after the base guard, throw `QueryDeltaApplyError` when `delta` (or `delta.set`/`delta.lists`) is not a plain object → routes to `onDeltaMiss`/refetch.
  - **Test:** `query-apply.test.ts` — apply `[{delta:true,name:'cart',value:42}]` → `onDeltaMiss('cart', …)` called, `'cart'` not in `applied`, store untouched (today: no miss, `applied=['cart']`).
  - **Verified:** both verifiers ran `applyQueryDelta` against malformed envelopes — `42`/`[]`/`"oops"` → no-op clone; `{set:42}` → no-op; `{set:"oops"}` → corrupted spread of characters.

- [ ] **D3 (high, promoted) — BroadcastChannel rebroadcast applies delta chunks with NO build-token validation, defeating §9.1.1 base-version validation across a redeploy** `spec-impl-divergence` (L2-query-delta-2)
  - **Where:** `browser/src/broadcast.ts:111-143` (`onmessage` → `applyMutationResponseBodyToRuntime` with no `expectedBuildToken`/`responseBuildToken`), publish `:150-163` (envelope carries body/changes/principal but **no** build token); contrast the gate at `apply-mutation-response.ts:99-131`.
  - **Defect:** the mutation-response apply path correctly converts deltas to misses on build-token mismatch; the broadcast receive path bypasses it. Same device, Tab A on build N, Tab B reloaded onto N+1 after a deploy that moved a query's shape: Tab B submits, rebroadcasts the raw N+1 body, Tab A applies an N+1 delta onto its N base — exactly the long-open-tab skew §847/§14 base-version validation exists to catch. Part-2 D-series fixed the direct path; broadcast is a distinct code path with no token.
  - **Fix:** stamp the sender's `<meta name="kovo-build">` into the broadcast envelope in `publish()`, validate against the receiver's page token in `onmessage`, and thread `expectedBuildToken`/`responseBuildToken` through so delta chunks become misses on mismatch.
  - **Test:** receiver page-token N, message body stamped N+1 with a delta chunk → chunk becomes a miss (→ refetch), store base untouched.
  - **Verified:** exploiter traced the no-token apply across the redeploy; refuter agreed on the code and only noted SPEC §9.3 doesn't *enumerate* broadcast as a stamping point (a spec-coverage nuance, not a refutation). Sibling of part-2 D, distinct file.

> **Contested siblings:** the client `query-store` `values` Map grows unbounded across rotating
> server-controlled keys (no eviction/dispose; L7-2), and `subscribe()` leaks an empty Set per distinct
> `(name,key)` (L7-1) — both real but reachability hinges on whether a production caller of `subscribe()` /
> rotating-key bindings exists. See *Contested*.

---

## Lane E — Node adapter, request shell & dispatch  *(`server/src/{node,shell,app-request,replay}.ts`)*

- [ ] **E1 (high) — Mid-stream response error corrupts a 200 body with "Internal Server Error" instead of aborting the transfer** `impl-bug` (L11-1)
  - **Where:** `node.ts:91-105` (`writeWebResponseToNode` calls `writeHead(200)` then pipes; rejects on stream error) + `:37-52` (`toNodeHandler` catch: `headersSent` guard protects only `writeHead`, then runs `nodeResponse.end('Internal Server Error')`).
  - **Defect:** when a streaming page/`respond.stream()`/render generator throws **after** the first chunk, the rejection reaches the catch with `headersSent` already true, so it **appends** "Internal Server Error" onto the partial 200 body. Reproduced against `node:http`: a stream emitting `'partial-'` then throwing yields HTTP 200 body `"partial-Internal Server Error"`. The client treats corrupted/truncated output as success; on a chunked HTML document this injects literal error text into the page.
  - **Fix:** on the pipe error path `nodeResponse.destroy(err)` (tear the socket) rather than `.end()`; in the catch, `if (nodeResponse.headersSent) { nodeResponse.destroy(); return; }`.
  - **Test:** `node.test.ts` — handler returns `new Response(stream)` that enqueues `'partial-'` then throws in `pull()`; client sees a truncated/aborted read or non-200, never a 200 with appended error text.
  - **Verified:** both verifiers reproduced the corrupted 200 against a real `node:http` server. Distinct from part-2 H4/K2/A3.

- [ ] **E2 (high) — Node adapter throws on every HTTP/2 request: pseudo-headers (`:path`/`:method`/…) are copied into a web `Headers`** `impl-bug` (L11-2)
  - **Where:** `node.ts:128-141` (`nodeHeadersToWebHeaders` iterates `Object.entries(request.headers)` with no pseudo-header filter), reached via `nodeRequestToWebRequest:54-72` + `toNodeHandler:38-50`.
  - **Defect:** under Node's HTTP/2 compat API, `request.headers` contains `:path`/`:method`/`:authority`/`:scheme`. The web `Headers` constructor rejects names starting with `:` and throws synchronously → the throw lands in `toNodeHandler`'s catch → **every HTTP/2 request answered with 500**. Verified against `node:http2`: `req.headers` has those keys and the copy loop throws `":path" is an invalid header name`. SPEC §9.5 names `node:http` the documented edge adapter; it silently breaks the whole app under HTTP/2.
  - **Fix:** `if (name.startsWith(':')) continue;` before set/append; optionally map `:authority`→host fallback in `nodeRequestUrl`.
  - **Test:** `node.test.ts` — `node:http2.createServer` + `client.request({':path':'/'})` → 200 (today 500).
  - **Verified:** both verifiers confirmed `new Headers().set(':path', …)` throws on Node v24 and that a live http2 compat server hits the throw. Distinct from part-2 B1 (Set-Cookie egress).

- [ ] **E3 (medium) — Client disconnect is never propagated to the handler: `request.signal` is unset and there is no timeout** `coverage-gap` (L11-3)
  - **Where:** `node.ts:54-72` (`RequestInit` has no `signal`; no `AbortController` bridged from `'aborted'`/`'close'`); `:37-52` (no handler timeout).
  - **Defect:** handlers/queries/webhooks and any downstream `fetch(url, { signal: request.signal })` they make never abort on client disconnect. A client that opens an expensive request and disconnects leaves the handler + downstream DB/fetch work running against a dead socket — a cheap resource-exhaustion amplifier under an anonymous flood.
  - **Fix:** create an `AbortController` in `nodeRequestToWebRequest`, set `init.signal`, abort on `nodeRequest` `'aborted'`/early `'close'` and `nodeResponse` `'close'` before finish; optionally a configurable handler timeout.
  - **Test:** `node.test.ts` — handler awaits `request.signal`; destroy the client socket → `request.signal.aborted` becomes true within a tick (today undefined).
  - **Verified:** both verifiers confirmed `RequestInit` omits `signal` and no abort/timeout wiring exists. Sibling of known-open F5 (admission shed) but a distinct mechanism (releasing already-admitted compute).

- [ ] **E4 (medium, promoted) — In-flight pending replay reservations bypass `maxEntries` and persist for the full TTL → DoS** `impl-bug` (L7-3)
  - **Where:** `server/src/replay.ts:89-120` (`reserve` enforces `maxEntries` by evicting only committed/expired records, `:99 if (!('pending' in evictRecord))`); pending records reclaimed only by TTL (`:319-326`) or commit/abort after the handler resolves (`mutation.ts:746-796`).
  - **Defect:** part-2 A6 *correctly* stopped evicting pending slots (no double-execute). The new consequence: while N handlers are concurrently in-flight, the store holds N pending records **regardless of `maxEntries`** (default 1000). An authenticated attacker picks arbitrary client-controlled `Kovo-Idem` values and fires many concurrent slow mutations; each reserves a pending slot that bypasses the cap and lingers up to `ttlMs` (5 min). The documented `maxEntries` bound does not bound peak memory.
  - **Fix:** add a separate `maxPending` cap (when exceeded, `reserve()` returns undefined so the request runs unprotected rather than allocating unbounded) and/or a much shorter pending-reservation timeout independent of the committed `ttlMs`.
  - **Test:** `replay.test.ts` — with `maxEntries:2`, drive >2 concurrent pending reserves under a `maxPending` cap → the cap is enforced (excess returns undefined), not silent unbounded growth.
  - **Verified:** exploiter confirmed the unbounded pending accumulation; refuter agreed it is the intended A6 design and noted the DoS root overlaps known-open F5 — but this specific bypass-the-cap surface is A6-introduced and untracked.

---

## Lane F — Routing & matcher normalization  *(`server/src/{match,hints,document-core}.ts`)*

- [ ] **F1 (high) — Internal `//` runs are not collapsed: an empty path segment silently matches a param and changes the matched route** `impl-bug` (L2-route-matcher-1)
  - **Where:** `match.ts:86-89` (`normalizePathname` collapses only the leading `^[/\\]+` run + trims trailing slashes); `:297-300` (naive `.split('/')`); `:220-249` (empty segment accepted as a param value).
  - **Defect:** `/files//etc` normalizes unchanged → segments `['files','','etc']` → matches `/files/:a/:b` with `a=''`, `b='etc'`. So a route meant for two non-empty segments matches a URL with an empty middle, and an empty string is delivered as a param with no 308/404. An attacker can probe a different route arity than the canonical URL implies and feed empty params into ownership/key lookups (`/orders//items` → `/orders/:id/items` with `id=''`). Dispatch keys reserved prefixes off this un-collapsed pathname (`shell.ts:155`), propagating the smuggle.
  - **Fix:** collapse internal slash runs in `normalizePathname` (`replace(/[\\/]{2,}/g,'/')` across the whole path), emitting a 308 when the collapsed form differs; or reject empty interior segments as no-match.
  - **Test:** `matchRoute([route('/files/:a/:b')], '/files//etc')` returns undefined (no-match) or a 308 to `/files/etc`; `normalizePathname('/a//b').pathname === '/a/b'`.
  - **Verified:** both verifiers ran the matcher live → `{params:{a:'',b:'etc'}}`, no redirect.

- [ ] **F2 (high) — `resolveRouteMeta` throws on a missing query → hard 500 during head render; `document-core` never passes queries, so any `metaFromQuery` factory always throws** `impl-bug` (L2-early-hints-2)
  - **Where:** `hints.ts:325-339` (`resolveRouteMeta` throws `'Missing query data for route meta'`), `:300-323` (`renderRouteMeta`, no try/catch); `document-core.ts:183` calls `renderPageHints(options.hints ?? {})` with **no** context → `context.queries === undefined → {}`.
  - **Defect:** two failures: (1) in the real document path, `context.queries` is always `{}`, so **any** `RouteMetaFactory` from `metaFromQuery(query, derive)` unconditionally throws during head render → hard 500 for the whole page (head meta is supposed to be best-effort enrichment). (2) Even where queries are threaded, a routine data gap (product not found) becomes an unhandled exception instead of a page that omits the derived `<title>`/`og` tags.
  - **Fix:** make `resolveRouteMeta` tolerant (skip a factory whose query key is absent, returning no tags); fix `document-core.ts:183` to thread rendered queries into `renderPageHints`'s second arg; wrap `renderRouteMeta` in head assembly so a meta-derive failure drops only the affected tags.
  - **Test:** a document assemble with a `metaFromQuery` factory and a query that returned no row → no 500 (head omits the derived tags), rest of the document renders; when queries are present, tags resolve.
  - **Verified:** both verifiers traced the throw → `document-core.ts:183` single-arg call → `resolveRouteMeta` throw with `queries={}`. (Finder said medium; exploiter raised to high — it 500s any route using `metaFromQuery`.)

> **Contested siblings:** the matcher also accepts decoded `.`/`..` as literal param values (a traversal
> primitive if an app interpolates a param into a filesystem path; the static-export pipeline already rejects
> these — runtime/build divergence; L2-route-matcher-2), and `renderSpeculationRules` emits prerender URLs
> with no scheme/origin validation (credentialed off-origin prerender via `prefetch:'conservative'`, which
> KV419 never gates; L2-early-hints-1). See *Contested*.

---

## Lane G — CSP & security headers  *(`server/src/{csp,deferred-stream,document-core}.ts` — never audited by parts 1–2)*

- [ ] **G1 (high) — Deferred-stream inline apply/cleanup `<script>` blocks are unhashed and omitted from `document.csp`, so a strict hash-CSP breaks deferred hydration** `impl-bug` (CSP-1)
  - **Where:** `deferred-stream.ts:56-74` (apply/cleanup scripts emitted as raw `<script>…</script>`, body interpolates `--${boundary}`); `document-core.ts:163-190` (`renderDeferredDocument` returns `csp = assembled.csp` = hints+loader+queries only; never the deferred scripts).
  - **Defect:** under a CSP built from the framework's own hashes (`script-src 'self' <loader+query hashes>`), every deferred apply/cleanup script is blocked → deferred fragments/queries never apply (shell renders, `globalThis.__kovo_a?.(…)` never runs, boundary markers never cleaned). The framework's only CSP story is incompatible with its own deferred-streaming feature; a non-default `boundary` breaks it even harder (dynamic script body).
  - **Fix:** compute `cspSha256` of the apply + cleanup scripts for the actual boundary, stamp each `<script>` with the hash attribute, and surface the hashes so `renderDeferredDocument` merges them into the returned `csp`.
  - **Test:** `document.test.ts` — `renderDeferredDocument({…, boundary:'x-b'})` → `renderContentSecurityPolicy(response.csp)` `script-src` contains the `sha256` of both scripts, and the HTML carries matching `data-kovo-csp-hash` attrs.
  - **Verified:** both verifiers built the header from `response.csp` and showed the apply/cleanup hashes absent.

- [ ] **G2 (high, promoted) — `renderContentSecurityPolicy` omits `base-uri`/`object-src`/`frame-ancestors`/`form-action`, leaving the hash-locked `script-src` bypassable** `impl-bug` (CSP-2)
  - **Where:** `csp.ts:56-72` (directives are exactly `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`); grep for the four missing directives over `server/src` → 0 hits.
  - **Defect:** a hash-locked `script-src` without `base-uri` is a known bypass — an injected `<base href="//evil">` (markup injection, no script execution needed) reroutes every relative `/c/__v/.../module.js` modulepreload/`<script src>` to an attacker origin and executes attacker JS despite the hash CSP (`base-uri` has no `default-src` fallback). No `frame-ancestors` (clickjacking; X-Frame-Options also unset — see CSP-3) and no `form-action` (injected `<form action>` exfiltration). The CSP sold as the XSS-hardening posture is trivially bypassable.
  - **Fix:** emit non-overridable `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`, `frame-ancestors 'none'` (or expose with secure defaults); `base-uri`/`object-src` unconditionally.
  - **Test:** `document.test.ts` — the rendered CSP contains `base-uri 'self'` and `object-src 'none'`.
  - **Verified:** exploiter confirmed the omitted directives + the relative-module reroute sinks; refuter agreed on the directive list and snapshot.

> **Contested sibling:** HTML document responses carry **no** security headers at all (no `nosniff` —
> inconsistent with `response.ts:295` which adds it for file/stream — no `Referrer-Policy`, no frame
> defense), and `renderRouteDocumentResponse` **discards** the computed `document.csp` (the dispatch path
> can't set CSP even if it wanted to); `renderContentSecurityPolicy`/`cspSha256` aren't on the public API, so
> apps have no supported way to emit the CSP. Real and actionable but partly overlaps part-2 M1. See
> *Contested* (CSP-3).

---

## Lane H — Registry & type-system soundness  *(`compiler/src/internal-graph.ts`, `server/src/app.ts`)*

- [ ] **H1 (high) — Duplicate mutation keys have no uniqueness diagnostic; invalidation registry is last-write-wins, server dispatch is first-match-wins** `coverage-gap` (L12-1)
  - **Where:** `internal-graph.ts:582-600` (`deriveInvalidationFactsFromGraph` builds `invalidations[mutation.key]` in a plain Record — last-write-wins); `app.ts:85-96` (no key dedup on `options.mutations`); `app-mutation-request.ts:35` (`.find(c => c.key === mutationKey)` — first-match); no mutation analogue to KV240 (`core/src/diagnostics.ts:437-447`).
  - **Defect:** every other registry identity has a uniqueness diagnostic (routes KV228, components KV237, fragment targets KV238, view transitions KV239, query shapes KV240) — **mutations have none**. Two `mutation('cart/add', …)` declarations: (a) the second's invalidation set silently overwrites the first; (b) at runtime the **first**-declared handles every POST while the second is dead code. The two layers disagree (invalidation picks last, dispatch picks first) → invalidation can be computed for a mutation that never runs, and the wrong handler runs against attacker-shaped input with the wrong schema/guards.
  - **Fix:** add `mutationFactDiagnostics(graph)` (sibling of `routeFactDiagnostics`) emitting a duplicate-mutation-key error; independently, fail `createApp`/`app-mutation-request` closed on duplicate `app.mutations[].key`.
  - **Test:** `registry.test.ts` — two mutations sharing `key:'cart/add'` → a duplicate-key diagnostic (today none, `invalidations` keeps only the second); `app.test.ts` — `createApp` with two same-key mutations rejects at build or dispatches unambiguously.
  - **Verified:** both verifiers confirmed no dedup at all three sites and no covering test.

---

## Lane I — better-auth adapter  *(`packages/better-auth/src/{internal,session}.ts`)*

- [ ] **I1 (high) — Cookie re-emission silently drops `Partitioned` (CHIPS) and other unmodeled attributes, breaking embedded/cross-site login** `spec-impl-divergence` (L13-2)
  - **Where:** `better-auth/src/internal.ts:1104-1106` (`parseSetCookieHeader` default branch ignores unmodeled attributes); typed builder `server/src/cookies.ts:1-9` (`CookieOptions` has no `partitioned`/`priority`), `serializeCookie:17-55` cannot emit them. Better Auth emits `Partitioned` (`node_modules/better-auth/dist/cookies/cookie-utils.mjs:82-103` via `advanced.defaultCookieAttributes`).
  - **Defect:** an app serving login in a cross-site iframe configures `advanced.defaultCookieAttributes = { partitioned: true }` (the CHIPS requirement). Better Auth emits `Set-Cookie: …; SameSite=None; Partitioned`; `forwardBetterAuthSetCookie` → `parseSetCookieHeader` drops `Partitioned` → the re-emitted cookie lacks it → Chrome refuses/segregates it in the third-party context → session never sticks → login silently fails while the mutation returns ok+redirect. The typed-builder seam is structurally incapable of forwarding it (contradicts the B3 "identical wire bytes" claim).
  - **Fix:** extend `CookieOptions` with `partitioned?` (and `priority?`); have `serializeCookie` append `; Partitioned`/`; Priority=…`; map them in `parseSetCookieHeader` instead of dropping.
  - **Test:** `index.credential-mutations.test.ts` — sign-in returns `…; SameSite=None; Partitioned` → emitted `Set-Cookie` contains `; Partitioned`.
  - **Verified:** both verifiers traced the drop site and confirmed installed better-auth@1.6.17 emits `Partitioned`.

- [ ] **I2 (high, promoted) — `betterAuthSession` drops Better Auth's session-refresh / cookie-cache `Set-Cookie` headers, so rolling sessions never extend** `impl-bug` (L13-1)
  - **Where:** `better-auth/src/session.ts:40-46` (`auth.api.getSession({ headers })` without `asResponse:true`; returns only `{session,user}`); `SessionProvider` returns only `SessionValue`, no cookie channel (`server/src/guards.ts:115-117`). Better Auth emits fresh `Set-Cookie` on `updateAge` and `cookieCache` (`dist/api/routes/session.mjs:233-305`).
  - **Defect:** with default rolling sessions (`expiresIn=7d, updateAge=1d`) and/or `cookieCache.enabled`, every authenticated GET calls `betterAuthSession` which reads only the payload and never the response headers Better Auth wrote. Result: (1) rolling expiry never reaches the browser → a continuously-active user is hard-logged-out at the original 7d boundary (silent session-loss regression vs raw Better Auth); (2) the cookie cache never populates.
  - **Fix:** call `getSession` with `asResponse:true`, then `forwardBetterAuthSetCookie(response.headers, context)` against a per-GET cookie sink the framework provides to `sessionProvider` (requires extending the `SessionProvider` contract); or document the limitation and require disabling rolling/cookie-cache with this adapter.
  - **Test:** authenticated GET past `updateAge` → the framework response carries the extended session `Set-Cookie` (today none).
  - **Verified:** exploiter traced the dropped refresh headers end-to-end; refuter agreed on the mechanism and narrowed framing. Distinct from I1 (egress attribute loss).

- [ ] **I3 (low) — `isSessionEstablishingSetCookie` claims `Expires`-in-past counts as deletion but only checks `Max-Age`** `spec-impl-divergence` (L13-4)
  - **Where:** `internal.ts:1147-1163` — comment `:1147-1149` lists "Expires in the past" as a clear, but code only tests `value===''` (`:1156`) and two `Max-Age` regexes (`:1159-1160`); no `Expires` check.
  - **Defect:** a clearing cookie `sid=deleted; Expires=Thu, 01 Jan 1970 …` (non-empty value, no `Max-Age`) is classified **session-establishing** → a 2xx carrying only such a cookie would be treated as a successful sign-in and redirect into the protected area without a real session (the SECURITY_FINDINGS M2 positive-evidence gate the function exists to enforce). Stock Better Auth uses `Max-Age:0`+empty value, so the default path isn't hit today (hence low), but the security predicate violates its own contract.
  - **Fix:** parse `Expires` (`Date.parse`) and return false when it is a valid date `<= now`.
  - **Test:** `isSessionEstablishingSetCookie('sid=deleted; Expires=Thu, 01 Jan 1970 …')` is false (today true); a 200 + only an Expires-past cookie fails to sign in.
  - **Verified:** both verifiers reproduced `true` for the Expires-past cookie.

> **Contested sibling:** `getBetterAuthSetCookie`'s no-`getSetCookie()` fallback collapses a comma-folded
> multi-cookie header to one and corrupts cookies whose `Expires` contains a comma — real but unreachable on
> modern runtimes (`getSetCookie()` always present). See *Contested* (L13-3).

---

## Lane J — headless-ui primitives  *(`packages/headless-ui/src/primitives/*` — part 2 only touched compiler wiring)*

- [ ] **J1 (high) — Tabs / Accordion / ToggleGroup keyboard nav defaults to `'both'` axes, contradicting their own rendered orientation** `spec-impl-divergence` (L9-1)
  - **Where:** `tabs.ts:263-266`+`:339-343`, `accordion.ts:266-269`+`:314-318`, `toggle-group.ts:243-246`+`:310-312` — each passes `orientation` to `navigationIntentFromKey` only when explicitly set, so it falls back to `'both'` (`lib/keyboard-navigation.ts:30`). Correct peers: `toolbar.ts:147`/`menubar.ts:311` use `state.orientation ?? 'horizontal'`.
  - **Defect:** when the author omits `orientation` (common), both axes navigate while the rendered `data-/aria-orientation` defaults to a single axis. A default horizontal Tabs list responds to ArrowDown/Up — moving the tab AND `preventDefault`-ing the browser's page scroll — contradicting the announced `aria-orientation` and the WAI-ARIA APG (a horizontal tablist is Left/Right only). Same for vertical Accordion (Left/Right) and horizontal ToggleGroup (Up/Down). Breaks the `rules/accessibility-conformance.md` APG claim.
  - **Fix:** default the passed orientation to the rendered default — tabs/toggle-group `?? 'horizontal'`, accordion `?? 'vertical'` (mirror toolbar/menubar).
  - **Test:** `tabsKeyDown(ArrowDown, {items, value})` is ignored on a default tablist (today moves + `preventDefault`); ArrowRight still moves; symmetric cases for accordion/toggle-group.
  - **Verified:** both verifiers ran the handlers → off-axis arrow moved focus and set `defaultPrevented`, while attributes announced the single axis.

- [ ] **J2 (medium) — Combobox synthesized `aria-activedescendant` points at an id no option ever renders** `impl-bug` (L9-2)
  - **Where:** `combobox.ts:497-507` (`comboboxActiveDescendant` fallback id uses the **full**-list index) vs `:210-225` (`comboboxOptionAttributes` emits an `id` only when the caller passes one — never auto-generates the `<listboxId>-option-<n>` id); listbox renders `comboboxFilteredItems` (`:152-158`).
  - **Defect:** two compounding bugs: (1) the synthesized `aria-activedescendant` references an element id that does not exist in the DOM (options have no auto id); (2) even if mirrored, the full-list index ≠ the filtered render position, so after typing to filter, it points at the wrong slot. A screen reader announces nothing (dangling IDREF) or the wrong row. KV221 can't catch it (runtime id). The shipped snapshot `ui/src/__snapshots__/combobox.stylex.test.tsx.snap` already encodes the dangling `team-listbox-option-0` against an id-less option.
  - **Fix:** compute the fallback index against `comboboxFilteredItems` and auto-generate the matching id in `comboboxOptionAttributes` (or only emit `aria-activedescendant` when the highlighted item has an explicit id). The peer `command.ts:649` does this correctly (tested at `command.test.ts:217`).
  - **Test:** filter to one option, assert the rendered option carries exactly the id that `comboboxInputAttributes(...).['aria-activedescendant']` produces.
  - **Verified:** both verifiers cited the shipped dangling snapshot and the correct `command.ts` peer.

- [ ] **J3 (low) — Accordion silently degrades a multiple-select accordion to single-select when `type` is omitted and the initial value is empty** `coverage-gap` (L9-3)
  - **Where:** `accordion.ts:320-322` (`accordionType = state.type ?? (Array.isArray(state.value) ? 'multiple' : 'single')`) + `:81-87`/`:324-339`.
  - **Defect:** an author intending multi-open but omitting `type` and starting with no panels open (`value === undefined`) gets `'single'`; the first toggle stores a bare string, so it stays `'single'` forever — only one panel ever opens, silently contradicting intent, no diagnostic.
  - **Fix:** don't infer multiplicity from the runtime value shape — require `type` explicitly, or keep the author-declared type stable in the state contract rather than re-deriving from `value`.
  - **Test:** toggle two items on `{value:undefined}` with no `type` for an intended-multiple accordion → both open (today the second replaces the first).
  - **Verified:** both verifiers reproduced the single-mode collapse via `toggleAccordionItem`.

---

## Lane K — CSS / StyleX emission  *(`packages/style/src/{internal,engine}.ts`, `compiler/src/package-styles.ts`)*

- [ ] **K1 (high) — `cssLengthValue` appends spurious `px` to numeric CSS custom-property (`--var`) values** `impl-bug` (L14-1)
  - **Where:** `style/src/internal.ts:82-87` (`cssLengthValue` decides unitlessness only from `UNITLESS_CSS_PROPERTIES`, no `--` guard) called from `engine.ts:575`; every other engine path special-cases `startsWith('--')` (`engine.ts:532`,`:692`, `internal.ts:23`).
  - **Defect:** `style.create({ x: { '--gap': 3 } })` emits `--gap:3px`. Custom properties commonly hold unitless numbers (multipliers in `calc(var(--gap)*8px)`, z-index base, ratios, grid spans). `style.create({row:{'--cols':3, gridTemplateColumns:'repeat(var(--cols),1fr)'}})` ships `--cols:3px` → `repeat(3px,1fr)` invalid → grid silently collapses. Silent wrong output: the runtime class-name hashes the raw value (3) so the class applies, but the served declaration is wrong.
  - **Fix:** `if (cssProperty.startsWith('--')) return text;` before the bare-number branch (belt-and-suspenders: exclude `--` in `package-styles.ts` `normalizeNumericLengths`).
  - **Test:** `createAtomicStyles({ a: { '--gap': 3, '--cols': 4 } }).css` contains `--gap:3}`/`--cols:4}` and not `--gap:3px`.
  - **Verified:** both verifiers ran `createAtomicStyles` → emitted `--gap:3px`.

- [ ] **K2 (medium) — `defineVars` numeric token values are px-ified by the served-CSS normalizer (distinct code path from K1)** `impl-bug` (L14-2)
  - **Where:** `engine.ts:353` emits `:root{--kovo-ns-token:VALUE}` raw (no `cssLengthValue` — correct), but `compiler/src/package-styles.ts:376-384` `normalizeNumericLengths` regex `/([a-z-]+):(-?\d+…)([;}])/g` matches `--kovo-ns-token` and px-ifies it during `normalizeServedCss`.
  - **Defect:** `defineVars({ zBase: 3, ratio: 1.5 })` → served `--kovo-ns-ratio:1.5px`; components reading `var(--kovo-ns-ratio)` in `calc()` silently break. Distinct from K1 (bypasses `cssLengthValue` entirely — fixing K1 alone does not fix it).
  - **Fix:** in `normalizeNumericLengths`, skip declarations whose property begins with `--` (or tighten the capture to exclude a leading `--`).
  - **Test:** `package-styles.test.ts` — feed `:root{--kovo-t-ratio:1.5}` through the served-CSS path → output contains `--kovo-t-ratio:1.5}`, not `1.5px`.
  - **Verified:** both verifiers ran the normalizer → `:root{--kovo-ns-ratio:1.5px}`.

> **Contested sibling:** `componentHostSelector` (`compiler/src/css.ts:820`) builds a CSS selector with the
> **HTML**-attribute escaper (`escapeAttribute`), which entity-encodes `&`/`"` (wrong in CSS) and fails to
> escape `]`/`}`/backslash; a correct CSS escaper exists at `browser/src/fragment-targets.ts:35`. Unreachable
> today (component names are TS identifiers), so it's a defense-in-depth/correctness fix. See *Contested*.

---

## Lane L — Object-storage capability  *(`packages/core/src/storage.ts`)*

- [ ] **L1 (high) — A user key ending in the sidecar suffix `.kovo-storage.json` collides with another object's filesystem metadata sidecar (cross-object corruption + metadata disclosure)** `impl-bug` (L2-storage-1)
  - **Where:** `core/src/storage.ts:120` (`sidecarSuffix`), `:203-217` (FS put writes blob + `metadataFilePath`), `:385-410` (FS stat reads sidecar), `:412-425` (`storageFilePath`/`metadataFilePath` — no reserved-suffix guard), `:308-319` (`normalizeStorageKey` rejects only empty/`.`/`..`/absolute).
  - **Defect:** the FS adapter stores metadata at `<blobPath>.kovo-storage.json`. `put('a','SECRET')` writes `<root>/a` + `<root>/a.kovo-storage.json`. An attacker calling `put('a.kovo-storage.json', forgedJSON)` maps that key's **blob** onto object `a`'s metadata sidecar → overwrites it; subsequent `stat('a')`/`get('a')` `JSON.parse` attacker bytes and return forged `contentType`/`etag`/`metadata` (metadata spoofing; contentType confusion can drive a download route to serve `a.jpg` as `text/html`). Conversely `get('a.kovo-storage.json')` leaks `a`'s real metadata as that object's body. Memory/S3 have no sidecar, so the two keys are independent objects there — the adapters disagree on whether the keys can coexist.
  - **Fix:** reject (in `normalizeStorageKey` or an FS guard) any key whose final segment ends with `sidecarSuffix` (case-insensitive); apply the rejection **uniformly across all three adapters**. Or store metadata out-of-band in a forbidden `.kovo-meta/` namespace.
  - **Test:** `storage.test.ts` — `put('photo.png','IMG')` then `put('photo.png.kovo-storage.json','HACK')` → `get('photo.png')` still returns `IMG` + original metadata; `put('x.kovo-storage.json',…)` throws the reserved-suffix error identically on memory/FS/S3.
  - **Verified:** both verifiers ran the FS PoC — `stat('a')` returned attacker-forged metadata; `readdir` showed the attacker blob landed on `a`'s sidecar.

- [ ] **L2 (medium) — The S3 adapter silently drops a caller-provided `etag` (honored by memory + filesystem) → cross-backend parity divergence** `impl-bug` (L2-storage-2)
  - **Where:** `storage.ts:263-275` (S3 put passes `putOptions.etag` only as `fallbackEtag`), `:493-513` (`s3ObjectInfo` `etag = metadata.etag ?? fallbackEtag`); contrast `:357-373` (memory/FS honor `options.etag` at `:368-370`, FS persists it).
  - **Defect:** real S3/R2/MinIO always return a server ETag, so `metadata.etag` is defined and the caller's `etag` is discarded every time. `put('a.txt','a',{etag:'"caller"'})` returns `"caller"` on memory/FS but the server etag on S3 — same code, two answers. Any app relying on the returned etag (conditional requests, optimistic-concurrency tokens, dedup keys) is silently wrong on exactly the production backend while passing in dev.
  - **Fix:** pick one contract and enforce it across all three adapters — either honor the caller etag uniformly (override `s3ObjectInfo`'s etag with `putOptions.etag` when provided) or drop it everywhere (server-assigned only).
  - **Test:** extend the "passes caller-provided ETags" test (`storage.test.ts:126`, currently `[memory, filesystem]`) to include S3 with a `MockS3Client` → all three return the agreed value.
  - **Verified:** both verifiers confirmed the S3 `fallbackEtag`-only path vs memory/FS honoring `options.etag`.

> **Contested sibling:** S3 `stat()`/`stream()` report `size:0` when the client omits `contentLength`
> (memory/FS report the true byte length) — a silent under-report that can truncate a download or bypass a
> size guard; both verifiers agreed the divergence is real but narrow. See *Contested* (L2-storage-3).

---

## Contested — needs adjudication  *(real per the exploiter; a verifier dissented — usually scope/severity, or current-reachability)*

Strong promote candidates (exploiter confirmed; refuter only narrowed scope) have already been pulled into
the lanes above as `(promoted)`: A5, B2, D3, E4, G2, I2. The remainder:

- [ ] **L2-invalidation-2 (medium)** — keyed-narrowing is *defeated* for SPEC §10.2 canonical instance keys: the matcher hard-codes `domain:via:key` while the wire/store/optimism currency is `name:keyValue` (`product:p1`), so `changeRecordTouchesQueryInstance(change, 'product:p2') === true` — every sibling instance's fragment ships on every keyed mutation. Same file as **A4**, opposite direction (A4 under-invalidates, this over-invalidates). *Refuter: confirmed; exploiter: weaker (over-fetch, not stale).* `change-record.ts:100-119`; tests `mutation.test.ts:564-595`, `change-record.test.ts:46-129` pin the non-canonical form.
- [ ] **CSP-3 (medium)** — HTML document responses carry no security headers (no `nosniff`/`Referrer-Policy`/frame defense — inconsistent with `response.ts:295` for file/stream), `renderRouteDocumentResponse` discards `document.csp` (`document-core.ts:243-253`), and `renderContentSecurityPolicy`/`cspSha256` aren't on the public API — so apps cannot emit the framework's own CSP. *Exploiter: weaker (overlaps part-2 M1 for nosniff); refuter: confirmed.* Actionable: plumb `document.csp` through + baseline `nosniff` on documents.
- [ ] **L8-2 (medium)** — compile-cache key folds source via a **32-bit FNV-1a** with no stored preimage (`compile-cache.ts:179`,`:416-424`); a collision yields a stale wrong-output hit, contradicting SPEC §5.2.1#1 ("MUST be a collision-resistant hash"). *Both verifiers: weaker (adversarial reachability debatable).* Fix is a trivial swap to the already-imported `sha256`; recommend doing it regardless.
- [ ] **L10-1 (medium)** — a throwing `WebhookVerifier.verify()` / HMAC payload-builder is **not fail-closed**: the `verifyWebhook` call (`webhook.ts:206`) is outside the try (`:271`), so an app-authored callback that throws on a malformed signature header propagates an uncaught 500 instead of a 401. *Exploiter: weaker (needs an app callback that throws); refuter: confirmed (no handling).* Wrap the verify call → treat any throw as failure → 401.
- [ ] **L2-route-matcher-2 (medium)** — decoded `.`/`..` are accepted as literal param values (`match.ts:239-245`; `matchRoute([route('/files/:name')], '/files/..') → {name:'..'}`), a traversal primitive if an app interpolates a param into a filesystem path / cache key. The static-export pipeline already rejects these (`static-export-route-plan.ts:178-187`) — a runtime/build divergence. *Both verifiers: weaker (no framework fs sink takes params today).* Cheap to align runtime with the static-export safety check.
- [ ] **L2-early-hints-1 (medium)** — `renderSpeculationRules` (`hints.ts:275-298`) emits `prerenderUrls` with no scheme/origin validation; an absolute cross-origin URL prerenders/prefetches off-site with the user's credentials, via `prefetch:'conservative'` which KV419 never gates (SPEC §8:763). *Both verifiers: weaker (note `SAFE_URL_SCHEMES` includes https, so the allowlist alone wouldn't block cross-origin https — needs same-origin check).* Filter to same-origin paths before serializing.
- [ ] **L7-1 (low)** — `query-store.ts:79-81` `subscribe()`'s unsubscribe deletes the plan but never the now-empty Set, leaking one empty Set per distinct `(name,key)`. *Both verifiers: weaker (no production caller of `subscribe()` found).* One-line prune; add `dispose()/clear()` to `QueryStore`.
- [ ] **L7-2 (low)** — `query-store.ts:37-64` `values` Map is never evicted/cleared and keys flow from server-authored `<kovo-query key>`; rotating keys (search/pagination/per-row) grow the client heap without bound for the session. *Exploiter: weaker (within-document amplification only); refuter: confirmed (no bound/dispose).* Add a bounded policy or `delete/clear` wired to DOM removal.
- [ ] **L13-3 (low)** — `getBetterAuthSetCookie`'s no-`getSetCookie()` fallback (`internal.ts:1119-1131`) returns a single string; a comma-folded multi-cookie header drops the second cookie and an `Expires`-comma corrupts the next. *Both verifiers: weaker (unreachable on modern runtimes — `getSetCookie()` always present).* Mandate `getSetCookie()` or use an Expires-aware splitter.
- [ ] **L14-3 (low)** — `componentHostSelector` (`css.ts:820`) uses the HTML escaper `escapeAttribute` for a CSS selector (entity-encodes `&`/`"`, doesn't escape `]`/`}`/backslash); a correct CSS escaper exists at `fragment-targets.ts:35`. *Both verifiers: weaker (component names are TS identifiers, so unreachable).* Defense-in-depth/correctness.
- [ ] **L2-storage-3 (low)** — S3 `stat()`/`stream()` pass `fallbackSize=0` (`storage.ts:282`,`:293`), so `size` resolves to `metadata.contentLength ?? 0`; a backend omitting `contentLength` reports `size:0` for a non-empty object while memory/FS report the true length. *Both verifiers: weaker (depends on a content-length-blind client).* Don't fabricate 0 — leave size unknown or require it.
- [ ] **L10-3 (low)** — webhook idem truthiness is inconsistent: replay **lookup** gates on `idem` (truthy, `webhook.ts:242`) while **reserve**/set gate on `idem !== undefined` (`:254`,`:486`); an empty-string idem skips the fast-path lookup but still reserves — a latent double-execute window under load. *Both verifiers: weaker (reserve still protects).* Use one predicate (`idem !== undefined`) everywhere.

### Deferred-stream ordering cluster *(all contested; mechanisms real, reachability latent — priorities are only ever literals today)*

- [ ] **L2-deferred-1 (low)** — `priorityRank` returns a numeric priority verbatim including `NaN` (`deferred-stream.ts:122-123`); the comparator `right.priority - left.priority || index` (`:118`) becomes non-transitive on `NaN`, making chunk/fragment order implementation-defined. Fix: coerce non-finite to the normal floor + a `NaN`-safe compare.
- [ ] **L2-deferred-2 (low)** — `sortDeferredFragments` (`:62`) priority-sorts fragments **within a chunk**, but the client applies them in array order (`response-fragment-apply.ts:36-40`); two same-target `append` fragments (pagination) or an `append`+`replace` pair get reordered → rows out of order / append-before-cleanup. Fix: don't priority-sort fragments within a chunk (preserve author order).
- [ ] **L2-deferred-3 (low)** — `sortDeferredChunks` (`:58`) reorders whole chunks by priority, but query-before-consumer is only guaranteed *intra-chunk*; a query in a lower-priority chunk than a fragment consuming it can be emitted after its consumer (SPEC §9:769). Fix: require co-location or hoist all query chunks ahead of all fragment chunks.
- [ ] **L2-deferred-4 (low)** — `live-target-registry.ts:6-27` is a process-global Map with last-writer-wins `register`, while the `collect` path (`:52-58`) throws on a duplicate component id — asymmetric; two apps/tenants in one process silently cross-contaminate renderers. Fix: make `register` collision-aware (parity with `collect`) or namespace per app instance.

---

## Sequencing & ownership  *(CLAUDE.md worktree protocol; ≤5 sub-agents at once)*

Lanes are largely file-partitioned. Shared hotspots and ordering:

- **`drizzle/src/static.ts`** — A1 (write-side audit producer), A2 (query combinator unwrap), A3 (owner-column arg) are one coherent owner (the scope-audit/predicate extraction); do them as a single worktree. This is the **highest-leverage** lane (3 criticals; the framework's IDOR guarantee).
- **`server/src/change-record.ts`** — A4 (under-invalidate lists) and the contested L2-invalidation-2 (over-invalidate canonical keys) are the same matcher; one owner. Fold the §10.2 canonical-key currency decision into A4 since both stem from the `domain:via:key` vs `name:keyValue` mismatch.
- **`server/src/generated-query-registry.ts`** — A5 (fold vs overwrite reads) is independent; slot anywhere.
- **`compiler/src/cache-identity.ts` + `persistent-compile-cache.ts`** — B1 (build-id source-of-truth) is the keystone; B3 (blob refcount) and contested L8-2 (sha256) are the same files — one owner, B1 first.
- **`server/src/node.ts`** — E1 (mid-stream destroy), E2 (pseudo-header skip), E3 (abort wiring) are the same file; one owner.
- **`server/src/csp.ts` + `deferred-stream.ts` + `document-core.ts`** — G1, G2, and contested CSP-3 all touch the CSP assembly/plumbing; one owner.
- **`core/src/diagnostics.ts`** — H1 needs a new duplicate-mutation-key code (sibling of KV228/237/240); register the row in one edit per `rules/compiler-hard-rules.md`.
- **`api-surface-baseline.json`** — I1 (`CookieOptions.partitioned`), I2 (`SessionProvider` cookie channel), G2/CSP-3 (export `renderContentSecurityPolicy`), L7 (`QueryStore.dispose`), L1 (no surface change) may move public surface → regenerate + re-gate per `rules/api-surface.md`.
- **`packages/style/src` + `compiler/src/package-styles.ts`** — K1 (engine `cssLengthValue`) and K2 (compiler normalizer) are two files but one root concept (px-on-`--var`); fix together so neither path regresses.

Independent / slot anywhere: C1/C2 (static-export), D1/D2/D3 (query-delta/broadcast), F1/F2 (routing), J1/J2/J3 (headless-ui — all in `primitives/`), L1/L2 (storage), the deferred-stream cluster.

## Governance & proof

- **Definition of done per item:** the cited test goes **red against today's code, green after the fix**. Several existing tests *codify the bug* and must be inverted, not preserved: `ui/src/__snapshots__/combobox.stylex.test.tsx.snap` (dangling activedescendant, J2), the `domain:via:key` assertions in `change-record.test.ts`/`mutation.test.ts` (A4 / L2-invalidation-2), and the `[memory, filesystem]`-only etag loop in `storage.test.ts:126` (L2).
- Cite the relevant `SPEC.md` section in each change; `SPEC.md` stays normative. Compiler/diagnostic changes (A1–A5, B1–B3, H1) follow `rules/compiler-hard-rules.md`; public-surface changes (I1/I2, G2/CSP-3, L7) follow `rules/api-surface.md`; accessibility claims (J1–J3) follow `rules/accessibility-conformance.md`.
- Broaden to `tsc` + API gate + `git diff --check` when touching shared boundaries or the diagnostics registry.
- This is an active ledger: collapse evidence into the checkbox it proves; archive transcripts. Every finding above was confirmed by an independent exploiter **and** refuter; the three headline criticals (A1/A2 IDOR producers, B1 cache build-id) were additionally re-verified against live code by the main thread.

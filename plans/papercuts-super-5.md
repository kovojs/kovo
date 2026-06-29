# Papercuts Super 5

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding the **default
postgres (PGlite-backed) `create-kovo` template** with five advanced read/interaction tracks
(URL-driven pagination, aggregations/dashboards, the relational query API & joins, optimistic
L3 reconciliation, and multi-region request shells), each authored as a real app and
adversarially verified. The super-4 fixes landed first: a fresh scaffold now passes `pnpm run
check` (vp check + sound-subset + build:prod + endpoint-posture) out of the box.

**Meta-theme — the static read-shape / binding extractor for Drizzle queries is the hot
spot.** Just as super-3/super-4 found the _write_ side rough (read-shape extractor, DDL
emitter, `s.*` write primitives), the _read binding_ layer now diverges from the declared
`output` schema in three ways (§A): a query's declared `output` scalars are dropped from the
bindable shape for any Drizzle query (KV302 at build that dev/check accept), `min()/max()`
aggregates are KV406-unresolved with no escape, and RQB to-many relations are shaped as
singular objects. A secondary cluster (§B) is pagination/typed-args ergonomics. The
build-vs-dev/check divergence recurs: `build:prod` rejects bindings dev and `vp check` render.

**Security/soundness defects escalated to `plans/bugz-14.md`** (4 items): RQB `with` reads
bypass the KV414 IDOR gate on the pinned drizzle `defineRelations` API (reopens `bugz-4` H2);
the default starter's enhanced-mutation SUCCESS path ships an unconsumable query delta so a
committed row is invisible until reload (violates §10.6/KV311); the KV302 binding gate
validates only the first component of a multi-component module (fail-open); and the
`kovo-props` stamp emits unbound prop identifiers → a green-build production 500.

## Scope

- Apps: five fresh `create-kovo` **default postgres** scaffolds + a baseline app, link-local
  to the monorepo, under `/Users/mini/kovo-dogfood-pg5-20260629/` (+ `/Users/mini/kovo-dogfood-pg5-base`).
  Gates per app: `pnpm run check`, `pnpm exec tsc --noEmit`, `vp test`, `build:prod`, and
  dev/build HTTP + Playwright smokes.
- Out of scope: published-npm behavior; the non-default `--sqlite` template; areas covered by
  super-1…4 and bugz-13 (db.ts DDL emitter, `s.*` write primitives, KV414 owner-INSERT,
  read-shape pgEnum/jsonb/array, deploy artifact, webhooks/files/UI/nav, MPA spine, L4 Live).
  The 4 escalated items live in `bugz-14.md`. Throwaway apps are safe to delete; do **not**
  re-run `pnpm install` in them without isolation.

## Issues

### A. The Drizzle-query read-shape / binding pipeline diverges from the declared `output` schema

- [x] **A1 — `build:prod` rejects (KV302) `output`-schema-declared scalar/computed query fields on any Drizzle query — the declared-output escape that works for object-form queries silently does not apply, and `vp dev`/`vp check` accept what `build:prod` rejects.** (high, framework; found by `t5-multiregion` + `t1-pagination`)
  - Observed behavior: a Drizzle query that returns a column projection plus loader-computed scalars (`total`, `page`, `pageCount`) — or an aggregate stats panel — binds `{q.total}`/`{q.page}` fine under `vp dev` and `vp check`, but `pnpm run build:prod` fails `KV302 … data-bind path is not present in the declared query shape`. Adding a full `output: s.object({ … })` schema covering exactly those fields does **not** clear it. The only fix is to launder each value through a render-local `const`.
  - Root cause: `packages/server/src/vite.ts:736-741` (`collectCompilerQueryShapeFacts`) builds `drizzleFacts` from the statically-extracted projection, then `outputFacts = analysis.outputQueryShapeFacts.filter((fact) => !drizzleQueries.has(fact.query))` — any query with a Drizzle fact has its `output:` schema fact **deliberately dropped** from the bindable shape. `packages/compiler/src/validate/bindings.ts:50-58` then validates against the projection-only shape and emits KV302. The build-only divergence is the graph-derivation phase: `cli/src/commands/build-export.ts:373-377` SSR-loads the app under `KOVO_BUILD_GRAPH_DERIVATION=1` while `vite.ts:754-760` short-circuits differently than the dev/check path.
  - Why it matters: the most natural pager/dashboard render (`{q.total} results, page {q.page} of {q.pageCount}`, or `{stats.total}`) is unbindable for any paginated or aggregated Drizzle query — the dominant real-world read shape. Worse, the mandated workaround (funnel through a render-local `const`) is the exact silent-staleness pattern `bugz-13` flags as unsound (a render-local const drops the value from derive lowering and the KV311 detector), so the framework pushes read authors toward a known-unsound shape. And a green `vp check` does not predict a green deploy.
  - Repro evidence: `t5-multiregion` — `rm -rf .kovo/cache node_modules/.vite dist && pnpm run build:prod` → KV302 at `dashboard.tsx` for `flaky.total` (a field declared in `flakyQuery.output`); `t1-pagination` — `{contacts.total}` on a Drizzle pager query → KV302 at build while `output:` declares it; `const total = contacts.total; {total}` builds green.
  - Acceptance: a Drizzle query's declared `output` scalar/computed fields are bindable (KV302-clear) at `build:prod`, matching `vp dev`/`vp check`. Prove with a build test: a Drizzle query with `output: s.object({ items, total, page })` binds `{q.total}` without a local-const launder.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/vite-data-plane-gate.test.ts --reporter=dot` proves declared `output` fields merge into Drizzle query-shape facts and clear KV302 for `contacts.total`.

- [x] **A2 — Drizzle `min()`/`max()` (and `countDistinct`/`sumDistinct`/`avgDistinct`) aggregate projections are misclassified KV406-unresolved with NO escape, while `count`/`sum`/`avg` pass.** (med, framework; found by `t2-aggregation`)
  - Observed behavior: a dashboard query projecting `minScore: min(table.score)` (or `max`/`countDistinct`) fails `build:prod` with `KV406 … Statically un-analyzable write site; manual touches required. Query projection …minScore could not be resolved`. The KV406 "write site" headline is nonsensical for a read aggregate, and `count()`/`sum()`/`avg()` in the same query pass.
  - Root cause: `packages/drizzle/src/static/query-shapes.ts:2208-2210` — `isAggregateHelperName` returns true ONLY for `avg|count|sum`. It is the sole gate for `isDrizzleAggregateHelperProjection` (`:2167`), the only aggregate path into `isOpaqueProjection` (`:2151-2164`). A `min()`/`max()` call fails `scalarQueryShape` and falls through to KV406-unresolved with no `output`/`reads` escape (the `sql<T>` cast is the only workaround).
  - Why it matters: MIN/MAX are core SQL aggregates a dashboard/reporting read needs, first-class `drizzle-orm` exports with the same `.mapWith` runtime coercion as sum/avg. An author projecting `max(score)` hits a build-fatal error mislabeled as a write site, and the blessed `sql<number>\`…\``escape (used by`examples/crm/queries.ts:159`) is undiscoverable from the diagnostic.
  - Repro evidence: `t2-aggregation` — `min(contacts.score)` projection → `build:prod` `KV406 queries.ts:114 … minScore could not be resolved`; swapping to `count()` clears it.
  - Acceptance: extend `isAggregateHelperName` to the full drizzle aggregate set (`min`, `max`, `countDistinct`, `sumDistinct`, `avgDistinct`), or give the bare-aggregate case the same `output`/`reads` opaque-projection escape with a read-shaped diagnostic. Distinct from super-3 §A (enum/jsonb/array READ projection) — this is the aggregate-helper projection class.
  - Fixed evidence: `pnpm exec vitest run packages/drizzle/src/index.query-shapes.test.ts --reporter=dot` proves the full aggregate helper set routes through the declared-output/reads success path without KV406.

- [x] **A3 — The RQB shape extractor models a to-many (`many`) relation as a singular object, not an array, so the inferred query shape diverges from the runtime JSON wire shape.** (med, framework; found by `t3-relational`)
  - Observed behavior: a `db.query.contacts.findMany({ with: { notes: true } })` over a `many` relation infers the shape `{ …contact, notes: { id, body } }` (a singular object) while the runtime returns `notes: [{…}, …]` (an array). The static contract that drives `data-bind` paths, derive inputs, and the client JSON disagrees with the wire.
  - Root cause: `packages/drizzle/src/static/query-shapes.ts:185-201` (`appendRelationalProjectionShape`) always models a `with:` relation projection as an object (`shape[relation] = relationShape`); it has no relation-cardinality input (`relationTargetTableName` maps relation→table name, never `kind`), so `many` and `one` are indistinguishable and both render as a non-array object.
  - Why it matters: SPEC §10.2 makes the query result shape the binding contract. A to-many relation typed as a non-array object means a list-stamp `{contact.notes.map(...)}` or null-aware `?.` traversal type-checks against the wrong shape — either a false KV302/KV303 or, worse, a binding the gate "proves" against a shape the runtime never produces. (Pairs with `bugz-14` B1: the same RQB resolver gap also drops the relation from the read set.)
  - Repro evidence: `t3-relational` — `.kovo/cache/static-build-analysis/*.json` for `contacts-with-notes-query` shows `notes: { id:"string", body:"string" }` (object), while the runtime relational query returns `notes` as an array of rows.
  - Acceptance: the RQB shape extractor distinguishes `many` (array) from `one` (object/nullable object) using the relation cardinality. Prove with a shape-extraction test over a `defineRelations` `many` relation.
  - Fixed evidence: `pnpm exec vitest run packages/drizzle/src/index.query-shapes.test.ts --reporter=dot` proves `defineRelations` `many` relations infer array element shapes.

### B. Pagination & typed-args authoring ergonomics

- [x] **B1 — `query().args((props) => …)` types `props` as `any` (via a `Record<string, unknown>` constraint that rejects `interface` types), so the prop→args contract for paginated/search components is entirely unchecked at author time.** (low, framework; found by `t1-pagination`)
  - Observed behavior: the `.args()` mapper's `props` parameter is `any`; annotating it with an `interface` type fails `TS2345` (`Type 'Record<string, unknown>' is missing …`), so authors leave it untyped. A typo like `p.pageSiz` is uncaught and yields `undefined` args at runtime.
  - Root cause: `packages/server/src/query.ts:136-140` declares the binder `<Props extends Record<string, unknown> = any>(mapper: (props: Props) => Input)` (impl `:776`). The `Record<string, unknown>` constraint is the well-known TS quirk: an `interface` lacks an implicit index signature so it is rejected, and the `= any` default leaves `props` untyped when not annotated.
  - Why it matters: driving a paginated read from URL search params is exactly "args bind locally" (SPEC §10.2): props → query args. With `props: any`, the contract that connects a component's `props` to its query's `args` — the spine of this whole interaction — is silently unchecked, and it compounds `bugz-14` B4 (declared props that aren't destructured 500 at runtime).
  - Repro evidence: `t1-pagination` — `.args((p: BrowseProps) => …)` with `BrowseProps` an `interface` → `TS2345`; switching `interface`→`type` works but the default path leaves `props` `any`.
  - Acceptance: `.args()` infers `props` from the component's declared `props` (or accepts an `interface` without an index signature), so a mistyped prop key is a compile error.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/query-endpoint.test.ts --reporter=dot` proves `.args((props: InterfaceProps) => …)` accepts an interface without an index signature.

- [x] **B2 — `s.number()` has no `.max()`, so a typed search/args schema cannot cap `pageSize` declaratively; a pathological `LIMIT` must be clamped by hand in every loader.** (low, framework; found by `t1-pagination`)
  - Observed behavior: `NumberSchema` exposes `default()/int()/min()/optional()` but no `.max()`, so an upper bound on a numeric search/args field is inexpressible in the typed channel; every paginated loader must remember to `Math.min(pageSize, CAP)` by hand.
  - Root cause: `packages/server/src/schema.ts:388-393` (`NumberSchema` interface) and `:471-523` (`NumberSchemaImpl` tracks only `#minimum`). (The `:940` "`.max()` is a follow-up" note is about the unrelated `ShapeBudget` DoS input-size limits, not numeric bounds — do not conflate.)
  - Why it matters: page-size capping is basic pagination safety — an uncapped `LIMIT`/`OFFSET` over a large table is a cheap memory/DoS amplifier. Because it cannot be declared in the typed schema, the safety control is easy to forget and invisible to review.
  - Repro evidence: `t1-pagination` — calling `.max(100)` on an `s.number()` is a `TS2339`; `NumberSchemaImpl` has no maximum field.
  - Acceptance: `s.number().max(n)` (and a matching runtime clamp/validation-error) exists, symmetric with `.min()`.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/schema.test.ts --reporter=dot` proves `s.number().int().min(1).max(3)` parses in range and rejects values above the cap.

- [x] **B3 — Server-side component render exceptions are silently swallowed in dev (no terminal diagnostic); the dev `onError` wrapper only logs along one path, so a render-time `ReferenceError` yields a blank "Server Error" with an empty terminal.** (low, dev-tooling; found by `t1-pagination`)
  - Observed behavior: when a component render throws server-side (e.g. the `bugz-14` B4 `kovo-props` 500), dev serves a blank error shell and prints **nothing** to the terminal, leaving the author with no thread to pull. (Capturing it required wiring a temporary `createApp({ onError })`.)
  - Root cause: in dev, `packages/server/src/vite-dev.ts` `appWithDevDiagnostics` (~`:1186-1204`) installs an `onError` wrapper, but the render-exception path does not route through the call that reaches `reportServerError`, so the wrapper never fires for a component render throw. (super-2 F2's "surface by default" acceptance only covered endpoint-posture drift, not component render exceptions — distinct path.)
  - Why it matters: combined with `bugz-14` B4, a brand-new author hitting the `kovo-props` 500 gets a blank page **and** an empty terminal — undebuggable out of the box, against SPEC §9.5.1's "teaching document" promise.
  - Repro evidence: `t1-pagination` — the B4 render 500 produced an empty terminal under `vp dev`; the error only surfaced via an app-level `onError`. Source path `vite-dev.ts:1186-1204`.
  - Acceptance: a server-side component render exception in dev prints a diagnostic (component, route, stack) to the terminal by default. Prove with a dev harness test that a throwing render logs to stderr without app-configured `onError`.
  - Fixed evidence: `pnpm exec vitest run packages/server/src/vite-dev.test.ts --reporter=dot` proves the Vite dev middleware logs a throwing route render without app-configured `onError`.

### C. Optimistic coverage honesty

- [x] **C1 — KV310/§10.6 optimistic-exhaustiveness green-certifies a hand-written `optimistic` transform whose only query consumers are fragment-status positions — a provably-dead transform that can never run, with no diagnostic.** (low, framework; found by `t4-optimistic`)
  - Observed behavior: a `component()` declares a hand-written `optimistic: { [query.key](draft, $input) { … } }` over a query-backed list; `pnpm run check` is green and `graph.json` records `optimistic:[{status:"hand-written"}]`. But the region is an inferred fragment target, so the compiler serializes **no client query store** — the transform is keyed to a store that does not exist client-side and is never compiled into any client artifact (the prod client bundle contains zero occurrences of the transform body). It is dead at runtime, yet certified covered.
  - Root cause: `packages/compiler/src/scan/parse.ts:767` (`componentHasInferredFragmentTarget`) classifies any query-backed component without `disableServerRefresh:true` as a fragment target (no client store / data-bind island), which SPEC §8 line 442 documents as "1 RTT — no optimistic update". The genuine gap is that KV310/§10.6 still accepts the transform as covered instead of warning that it is provably dead (an author writing a §10.4 optimistic block on the canonical query-backed list gets false-green coverage). (The no-op itself is by-design per SPEC:442; this item is only the false-green signal. The _broken success-path refresh_ of that same region is the separate, severe `bugz-14` B2.)
  - Why it matters: an author following the marquee L3 optimistic story (SPEC §10.4) on the default starter shape (a query-backed list) writes a transform that silently never runs, and the coverage gate says it is fine — masking that the optimistic path is unreachable in that shape.
  - Repro evidence: `t4-optimistic` — `dist/.kovo/graph.json` `optimistic:[{status:"hand-written"}]` with `pages["/"].queries=[]`, `components=[]`; the client bundle contains no `contacts-query`/transform body; `pnpm run check` green.
  - Acceptance: KV310/§10.6 emits a diagnostic (or downgrades coverage) when an `optimistic` transform's only consumers are fragment-status positions with no client store, so "covered" implies "can actually run". SPEC §10.4/§10.6.
  - Fixed evidence: `pnpm exec vitest run packages/cli/src/index.kovo-check.test.ts --reporter=dot` proves a hand-written transform with no page/component query consumer no longer counts as KV310 coverage.

## Refuted / Not Carried Forward

- **F3 — "the default starter ships the Drizzle relational query API unreachable"** — refuted as a composite of by-design + dup. The atomic observations reproduce (a fresh starter's `appDb.query` is empty → `TS2339`; no example exercises RQB), but the empty `db.query` is the _deliberate_ super-4 §A1 decision (`drizzle({ client })` without the schema arg), and the security teeth belong to `bugz-4` H2 / `bugz-14` B1, not a standalone papercut. Recorded as a known, intentional starter posture.
- **L3-2 framing — "optimistic on a fragment query is a broken marquee feature"** — partially refuted: the runtime no-op is _by design_ (SPEC §8:442 fragment = no optimistic). The genuine residual (false-green KV310 coverage) is carried forward as §C1; the severe defect in that area (success-path fragment refresh) is `bugz-14` B2.

## Latest Verification

- `vp check --fix packages/core/src/graph.ts packages/server/src/vite.ts packages/server/src/vite-data-plane-gate.test.ts packages/drizzle/src/static/query-shapes.ts packages/drizzle/src/static/schema.ts packages/drizzle/src/static.ts packages/drizzle/src/index.query-shapes.test.ts packages/server/src/query.ts packages/server/src/schema.ts packages/server/src/schema.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/vite-dev.ts packages/server/src/vite-dev.test.ts packages/cli/src/graph-output.ts packages/cli/src/index.kovo-check.test.ts`
- `pnpm exec vitest run packages/server/src/vite-data-plane-gate.test.ts packages/server/src/schema.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/vite-dev.test.ts packages/drizzle/src/index.query-shapes.test.ts packages/cli/src/index.kovo-check.test.ts --reporter=dot`
- `git diff --check`

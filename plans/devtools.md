# Devtools: the dataflow graph as an agent-first, human-legible surface

Created 2026-06-17. Behavioral source of truth is `SPEC.md`. This ledger plans a
Kovo devtool whose **primary user is an agent (via MCP)** and whose **secondary
user is a human (via a visual graph UI)**. Both surfaces project the _same_
static dataflow graph the compiler already emits — the devtool builds no second
model.

## Thesis

Kovo is the one framework where this devtool is mostly already built. The whole
point of the architecture (`SPEC.md` §1.1, §1.2) is that an app's complete
dataflow — every component's queries-in, every mutation's writes-out, every
invalidation edge, every optimistic and update-coverage status — is a **static
compile-time artifact**, not something to reconstruct by instrumenting a running
browser. That artifact already exists as `KovoExplainInput` (`packages/core/src/graph.ts`)
and is serialized to `generated/graph.json`. React/Vue devtools have to spy on a
runtime signal graph; Kovo can hand an agent the proven graph directly.

The devtool's job is therefore narrow and high-leverage: **make that graph
navigable and source-anchored, for an agent first and a human second.** The user
story — "select a component, trace the queries that go into it and the mutations
that go out, with syntax-highlighted code previews" — is a _traversal_ over edges
that are already in the model, plus a _source slice_ for each node/edge.

## The load-bearing invariant: one graph, two renderers

`SPEC.md` §5.3 is normative and is the spine of this plan: **"agents consume the
same artifact humans read."** Constitution #4 ("the wire is the documentation")
generalizes it. So:

- There is exactly **one** dataflow graph model. The MCP tools and the visual UI
  are two renderers over it; neither may carry facts the other can't see.
- A conformance test asserts the visual UI's node/edge set ≡ the MCP graph ≡ the
  `kovo explain` text facts for the same app. Divergence is a CI failure, the
  same way fixpoint/render-equivalence gates work (§5.2).
- This is why the devtool is agent-first _without_ being agent-only: a single
  legible artifact serves both. An agent that traces a bug and a human watching
  the same trace are looking at identical edges.

## What already exists (do not rebuild)

- **Graph model** `KovoExplainInput` and its members: `ComponentExplain`
  (`.queries`, `.fragments`, `.handlers`, `.triggers`, `.derives`, `.mutationForms`),
  `QueryReadSet` (`.domains`, `.guards`), `MutationExplain` (`.writes`,
  `.invalidates`, `.inputFields`, `.guards`), `PageExplain`, `EndpointExplain`,
  `TouchGraph`/`TouchSite` (`.domain`, `.via`, `.keys`, `.site`),
  `OptimisticCoverage`, `UpdateCoverageFact`. (`packages/core/src/graph.ts`,
  `packages/core/src/internal/graph.ts`.)
- **Graph derivation** `deriveAppGraph()` / `deriveRegistryFactsFromGraph()`
  (`packages/compiler/src/graph.ts`, `internal-graph.ts`) and the committed JSON
  export `generated/graph.json` + `generated/touch-graph.ts`.
- **MCP server** `kovo mcp` with `kovo_explain`, `kovo_check`, `compile_component`,
  `list_diagnostics` on `@modelcontextprotocol/sdk` (`packages/cli/src/index.ts`).
- **Diagnostics registry** `diagnosticDefinitions` with severity/help/positions
  (`packages/core/src/diagnostics.ts`).
- **Dev server** Vite middleware mount points (`packages/server/src/vite-dev.ts`,
  `internal/app-shell-vite.ts`).
- **UI primitives** `@kovojs/ui` (43 styled) + `@kovojs/headless-ui`; **shiki v3**
  already a `site/` dependency for syntax highlighting.

## What is net-new

1. A **traversable graph** layer: stable node IDs, typed directional edges, and
   reverse indices (component → mutations-that-affect-it) over the existing facts.
2. **Source anchoring**: richer spans (start/end line:col) per node and edge, and
   a source-slice service that returns file + relevant lines + language + span.
3. **MCP navigation tools** designed for bounded _tracing_, not graph dumps.
4. A **visual graph UI** (select-and-trace, code-preview panels).
5. (Phase 2) a **live runtime overlay** that lights the static graph with real
   wire frames from a running dev server.

---

## Architecture (four layers, bottom-up)

### Layer 1 — `DataflowGraph`: the traversable model (`@kovojs/devtool-graph`)

A thin, pure derivation over `KovoExplainInput` + `TouchGraph` + coverage facts.
No new source analysis — it _indexes_ existing facts into a navigable shape.

- **Nodes** (each with a stable `id`, `kind`, `label`, and a `SourceAnchor`):
  `component`, `query`, `mutation`, `domain`, `page`, `endpoint`, plus optional
  finer nodes `handler`, `derive`, `binding-position`.
- **Edges** (typed, directional, each carrying its own `SourceAnchor` for the
  edge's declaration site):
  - `reads`: component → query (from `ComponentExplain.queries`).
  - `loads`: page → query; `renders`: page → component.
  - `writes`: mutation → domain (from `MutationExplain.writes` / touch-graph
    `TouchSite.domain`).
  - `invalidates`: mutation → query, **derived** by joining `writes`/touch-domains
    against `QueryReadSet.domains` (§11.1). This is the "mutations out" edge — the
    user's core ask. Carries optimistic status (§10.4/§10.6) and the touch `site`.
  - `optimistic`: mutation → query with `status` ∈ {derived, hand-written,
    await-fragment, UNHANDLED/KV310}.
  - `updates`: component-binding-position → query with `status` ∈ {plan,
    isomorphic, fragment, renderOnce, UNHANDLED/KV311} (§4.9).
  - `triggers`, `derives`, `guards`.
- **Reverse indices** (the traversal the user wants, precomputed):
  - `componentInflow(component)` → queries read + their read-sets/sources.
  - `componentOutflow(component)` → mutations whose `invalidates` reaches a query
    this component reads — i.e. "the mutations that go out", with the full
    write→domain→query→binding chain and per-edge optimistic/update status.
  - `queryConsumers(query)` / `queryInvalidators(query)`.
- **Provenance modes**: build the graph from committed `generated/graph.json`
  (static, zero-running-app) _or_ from a live `deriveAppGraph()` call in the dev
  server (fresh on edit). Same shape either way.

> Edge soundness rides on facts the SPEC already proves: the `invalidates` join is
> exactly the §11.1 touch-set → §10.2 read-set relation, so the graph inherits the
> framework's static guarantees instead of inventing new ones.

### Layer 2 — Source anchoring & code preview (`SourceSlice`)

- Extend graph facts to carry `SourceAnchor { file, start{line,col}, end{line,col} }`.
  Today touch-graph has `site: 'file:line'` and diagnostics have `start`; component
  handler/derive/binding facts need end spans added during emission (small compiler
  change — most positions are already computed, just not all surfaced).
- `sliceSource(anchor, { context })` → `{ file, language, lines, highlightSpan }`:
  the few lines around the anchor plus the precise span to emphasize.
- **For agents**: return raw code + span (token-cheap, exact). **For humans**:
  render with **shiki** (already vendored in `site/`) into highlighted HTML.
- Works against the real filesystem in dev and against committed sources for a
  static graph. No browser required (§11.4).

### Layer 3a — MCP: one retrieval tool, BM25-ranked (the agent surface)

Design rule: **one tool, shaped like `kovo_explain`, not a traversal API.** An
agent should not have to learn `overview → find → neighbors → trace`; it asks one
question and gets the relevant slice of the graph already assembled and ranked.

- **The tool**: `kovo_explain(query: string, { k?, kind? })` — extend the existing
  `kovo_explain` to accept a free-text query (a name, a domain, a question, an
  error code). It returns the top-`k` graph **cards** (default small), each as the
  same stable text a human reads (§5.3) plus structured facts.
- **The corpus = the graph, as retrievable cards.** Each node is rendered to one
  card that _already bundles its traced neighborhood_: a component card carries its
  queries-in (read-sets + source), mutations-out (the write→domain→query→binding
  chain with optimistic/update-coverage status), handlers, and a Layer-2 source
  slice; a mutation card carries writes-out and every query/component it reaches; a
  query card carries consumers + invalidators. So one retrieval returns the whole
  "select a component, see queries-in and mutations-out" answer — no follow-up call.
- **Why BM25**: lexical terms from a card's edges index _into_ that card, so a query
  for `cart` or `addToCart` or `KV310` surfaces the cards that touch it. BM25 is
  **deterministic and explainable** (return the matched terms / score), which fits
  Kovo's stable-diffable-legible ethos far better than an embedding model — no model
  dependency, reproducible ranking, auditable matches. The index builds once over
  the Phase-0 graph.
- Exact-name lookups still resolve precisely (a card keyed by node id), with BM25
  handling fuzzy/topic/question queries. Keep `kovo_check`/`list_diagnostics` as-is.

### Layer 3b — Visual graph UI: the secondary (human) surface

A web app mounted by the dev server at `/__kovo` (recommend building it **as a
Kovo app** — dogfooding the framework on its own devtool is the strongest possible
conformance test, and §11.4 says app wiring is proof-carrying so it stays small).

- **Canvas**: layered DAG (mutation → domain → query → component → page), since
  dataflow is inherently directional. Node color by kind; edge color by kind
  (reads / invalidates / optimistic / updates).
- **Select-and-trace** (the core interaction): click a component → its
  queries-in edges (incoming `reads`) and mutations-out edges (outgoing
  `invalidates`) highlight, everything else dims. Toggle to follow the chain
  deeper (query → other consumers; mutation → other affected queries).
- **Inspector panel**: selected node/edge details + **code preview** (shiki-
  highlighted source slice with file path) + diagnostics + coverage badges
  (KV310/KV311 gaps shown inline, since those are the actionable holes).
- **Layout/render**: keep dependencies light and legible (SPEC value). Use a
  small layered-layout lib (elk/dagre-class) for positioning; render with SVG.
  Decision deferred to Phase 3 spike.

### Layer 4 — Live runtime overlay (Phase 2+)

Bridges "what _can_ flow" (static graph) with "what _did_ flow" (runtime). The
SPEC makes this unusually cheap because the wire is already self-describing
(§9.1): a dev-only debug SSE endpoint streams each enhanced round-trip's
`Kovo-Changes`, `Kovo-Targets`, and `<kovo-query>` frames. The UI replays them by
lighting the corresponding static edges and showing live query values + pending
optimistic state (`kovo-pending`, §10.3). No client instrumentation — it reads the
frames the framework already emits. MCP gets a parallel `kovo_graph_recent_frames`
tool so an agent can correlate a static edge with the last real traffic over it.

---

## Phasing (checklist)

Delivery order is **UI-first** (see Decisions). The shared graph model (Phases 0–1)
is still bedrock — the visual UI depends on it — so it leads regardless; the human
surface ships before the MCP tools, which then drop onto the same model.

### Phase 0 — Graph model foundation (shared bedrock)

- [ ] Add `@kovojs/devtool-graph`: `DataflowGraph` types + `buildGraph(KovoExplainInput, TouchGraph, coverage)` pure derivation with stable node IDs and typed edges.
- [ ] Implement the `invalidates` edge join (mutation writes/touch-domains × query read-sets, §11.1) and the `componentInflow`/`componentOutflow` reverse indices.
- [ ] Unit tests over the commerce example fixtures (`examples/commerce/src/generated/graph.json`): assert known component → queries-in / mutations-out traces.

### Phase 1 — Source anchoring & previews (shared bedrock)

- [ ] Add `SourceAnchor` (start/end line:col) to component handler/derive/binding and edge facts during graph emission (`packages/compiler`); backfill where only `site:line` exists today.
- [ ] Implement `SourceSlice.sliceSource(anchor)` (raw) + a shiki renderer (human-facing) reusing `site/`'s shiki setup.

### Phase 2 — Visual graph UI (the lead surface)

- [ ] Stand up the devtool as a **Kovo app mounted at `/__kovo`** via dev-server middleware (`packages/server` Vite mount), reading the Phase-0 graph; dogfoods the framework on its own tooling and reuses `@kovojs/ui`.
- [ ] Spike the layered-graph render (layout lib choice — elk/dagre-class; SVG) over the static graph.
- [ ] Build select-and-trace + inspector with shiki code previews; show KV310/KV311 coverage gaps inline.
- [ ] Browser suite for the render/interaction (the only browser-bound part, §11.4).

### Phase 3 — MCP: BM25 retrieval over graph cards (agent parity over the same model)

- [ ] Render each Phase-0 node to a self-contained "card" (traced neighborhood + source slice) as stable text + structured facts.
- [ ] Build a deterministic BM25 index over the cards; extend `kovo_explain` to accept a free-text query returning top-`k` cards (exact node-id lookup still precise).
- [ ] Return matched terms / scores so the ranking is auditable (legibility ethos).
- [ ] Conformance test: UI node/edge set ≡ MCP card facts ≡ `kovo explain` text facts for the same app (the same-artifact invariant, three ways).
- [ ] Document the single tool + an agent-usage example tracing one mutation→UI chain.

### Phase 4 — Live runtime overlay

- [ ] Dev-only SSE debug endpoint streaming `Kovo-Changes`/`Kovo-Targets`/`<kovo-query>` frames (§9.1); never present in prod/export.
- [ ] UI replay (light edges, show live values + `kovo-pending`); MCP `kovo_graph_recent_frames`.

---

## Decisions (confirmed 2026-06-17)

- **UI-first delivery**: the visual graph (Phase 2) ships before the MCP tools
  (Phase 3). Agent-primacy is a _long-term_ property, not a delivery order — the
  same-artifact invariant means both surfaces read one model, so leading with the
  human surface costs no architectural debt and yields the soonest-validating
  artifact. The shared graph model (Phases 0–1) still leads, since the UI needs it.
- **Dogfood the UI as a Kovo app** mounted at `/__kovo` (not an external React
  app) — strongest conformance signal and one styling/primitive stack (`@kovojs/ui`).
- **Static-graph MVP**: Phases 0–2 need no running app; live overlay (Phase 4) is
  a later additive transport, mirroring how SSE is additive in §9.3.

## Risks / open questions

- **Span backfill cost**: some binding/handler positions may not be retained
  through emission; Phase 1 must confirm they're recoverable without re-analysis.
- **Edge explosion on large apps**: the visual layout needs collapse/focus modes;
  the MCP side avoids this by being navigational (neighbors, not dumps).
- **Live overlay & deploy skew**: frames carry the render-plan version token
  (§5.1); the overlay must show skew rather than mislabel edges.

## Verification surface

Per §11.4, the whole devtool is checkable without a browser: the graph derivation,
source slices, and MCP tools are pure functions over committed facts, tested over
the example fixtures; only the Phase 4 live overlay and Phase 3 render are
browser-bound and get a small named browser suite.

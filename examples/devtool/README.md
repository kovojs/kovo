# Kovo Dataflow Devtools

A devtool that visualizes a Kovo app's **dataflow graph** — select any node and
trace the **queries that go into it** and the **mutations that go out**, with
syntax-highlighted source previews. It is **itself a Kovo app**, dogfooding the
framework on its own tooling.

The agent-facing surface (MCP) and this human-facing UI are designed to render the
**same graph cards** — SPEC §5.3: _"agents consume the same artifact humans read."_

## Run

```bash
pnpm --filter @kovojs/example-devtool dev   # builds the data bundle, then `vp dev`
# open http://localhost:5173/?app=commerce
```

## What it shows

Data flows left → right across swimlanes:

```
mutation  →  domain  →  query  →  component  →  page
(writes)     (invalidation unit)  (typed read)  (render)   (route)
```

…and the violet under-arc is a component **emitting** a mutation (the feedback
loop). State lives entirely in the URL (`?app`, `?sel`, `?q`), so the whole thing
is server-rendered and works with JS off — the Kovo MPA thesis (SPEC §8).

- **Select a node** (`?sel=`) → its connected dataflow lights up, everything else
  dims. The inspector shows queries-in, mutations-out, refresh coverage with
  optimistic status badges (SPEC §10.6: `derived` / `hand-written` /
  `await-fragment` / `punted`), touch-graph write sites with `file:line`, and the
  real source slice.
- **Search** (`?q=`) → **BM25** ranking over the graph cards — the same
  deterministic, explainable retrieval the MCP `kovo_explain` tool uses (no
  embedding model; reproducible, matched-terms auditable).
- **App switcher** — Commerce / CRM / Stack Overflow, each read from that
  example's committed `generated/graph.json`.

## Architecture

| Layer | File | Role |
| --- | --- | --- |
| Graph model (Phase 0) | `src/graph-model.mjs` | Pure derivation over `KovoExplainInput` → nodes, typed edges, reverse indices, BM25. Host-agnostic; shared by the bundle script and the app. |
| Source slices (Phase 1) | `scripts/build-bundle.mjs` | Resolves each node's real source (`file`, lines, code) and emits `data/<app>.json`. |
| Renderer | `src/render.ts` | Swimlane layout (barycenter ordering), trace highlighting, BM25 results, the inspector. |
| Highlighter | `src/highlight.ts` | Dependency-free TS/TSX tokenizer → themed HTML. |
| App shell | `src/app-shell.ts` | `createApp()` + a URL-driven `route('/')`. |

The graph edges are not invented: the `invalidates` relation is the SPEC §11.1
touch-set ⋈ §10.2 read-set join the compiler already proves.

## Status / next

Core "select → trace → preview" is fully server-rendered (works JS-off). The
planned follow-ons (see `plans/devtools.md`):

- A progressive-enhancement island for smooth pan/zoom + hover (the sanctioned
  `isomorphic`/L1 escape hatch, SPEC §4.8) — interaction polish only; the graph is
  already complete without it.
- Wiring the matching MCP `kovo_explain` query mode over the same cards.
- Mounting at `/__kovo` on an existing app's dev server (vs. its own server here).

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

## Interactivity

Core "select → trace → preview" is fully **server-rendered** (works JS-off —
selection is real `<a href>` navigation). On top of that, a **pan / zoom / hover
enhancement island** (`src/devtool-pz.client.js`) loads via `on:visible` (SPEC
§4.7) as a versioned `/c/` client module:

- scroll to zoom (toward cursor), drag the background to pan, fit/＋/－ controls;
- hover a node to peek its 1-hop neighborhood (connected nodes + edges glow);
- arrow keys pan, `+`/`-` zoom, `0` fits; listeners clean up on `ctx.signal`.

It is pure progressive enhancement: with the island absent, the graph is fully
usable and selection still works.

## MCP server (the agent surface)

The same graph cards are served to agents over MCP — SPEC §5.3, _"agents consume
the same artifact humans read."_ One tool, `kovo_explain`:

```bash
pnpm --filter @kovojs/example-devtool mcp      # stdio MCP server
pnpm --filter @kovojs/example-devtool test:mcp # stdio round-trip smoke test
```

Connect from an MCP client (e.g. Claude Code) by pointing it at
`node scripts/mcp-server.mjs` (stdio). `kovo_explain({ query, app?, limit? })`
takes a free-text query — an exact node name resolves precisely, otherwise
**BM25** ranks the graph cards (deterministic, with matched terms + scores, not
an embedding model). Each result is the same card the inspector shows, as stable
`kovo-explain/v1` text **and** `structuredContent`.

`src/cards.mjs` is the single source of card facts; the visual inspector and the
MCP tool both render it, and `scripts/conformance.mjs` asserts the MCP cards equal
the graph edges the UI draws from — the two surfaces can't drift.

## Mounting in a host app at `/__kovo`

The devtool is base-path aware. Run it under a prefix on its own server:

```bash
pnpm --filter @kovojs/example-devtool dev:mounted   # serves at http://localhost:5173/__kovo
```

To embed it in *your* app's dev server (so you open your app and visit `/__kovo`
to inspect it), copy `devtoolMountPlugin` from `vite.config.ts` into your config
and set `KOVO_DEVTOOL_BASE=/__kovo`. The plugin strips the prefix and dispatches
to the devtool's `nodeHandler`; everything else falls through to your app. The
devtool prefixes its own absolute URLs (client module, stylesheet) with the base,
and selection links are query-only so they ride any prefix. Styles come from
inlined `criticalCss`, so the devtool renders even where the host doesn't serve
the devtool's `/src/styles.css`.

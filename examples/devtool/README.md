# Kovo Dataflow Devtools (example)

A thin consumer of [`@kovojs/devtool`](../../packages/devtool). It wires three
sibling example apps' own committed graphs (commerce, crm, stackoverflow) into the
reusable devtool — select any node and trace the **queries that go into it** and
the **mutations that go out**, with syntax-highlighted source previews. All the
logic (graph derivation, rendering, MCP, mount) lives in the package; this example
just reads each app's `generated/graph.json` and hands it to `createDevtoolApp`.

## Run

```bash
pnpm --filter @kovojs/example-devtool dev          # http://localhost:5173/?app=commerce
pnpm --filter @kovojs/example-devtool dev:mounted   # http://localhost:5173/__kovo (prefix mount)
pnpm --filter @kovojs/example-devtool mcp           # stdio MCP server (kovo_explain)
pnpm --filter @kovojs/example-devtool test:mcp      # stdio round-trip smoke test
pnpm --filter @kovojs/example-devtool conformance   # MCP cards ≡ graph edges (same-artifact)
```

The graph state lives in the URL (`?app`, `?sel`, `?q`), so the core is
server-rendered and works with JS off (the Kovo MPA thesis, SPEC §8). Pan / zoom /
hover is a progressive-enhancement island the package loads via `on:visible`.

See the package README for the API and for mounting the devtool in your own app.

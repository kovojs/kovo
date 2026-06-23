---
title: Dataflow devtool
description: Generate Kovo dataflow graphs, mount the visual devtool, and query the same cards through MCP.
order: 6.2
---

# Dataflow devtool

`@kovojs/devtool` turns a Kovo graph into two surfaces: a visual dataflow app and an MCP tool named
`kovo_explain`. Both render the same graph cards, so the page a developer reads and the artifact an
agent consumes stay aligned. SPEC section 5.3

## Generate graphs

Example apps emit their own graph artifacts before the devtool consumes them:

```sh
pnpm --filter @kovojs/example-commerce run build:demo
pnpm --filter @kovojs/example-crm run emit-graph
pnpm --filter @kovojs/example-stackoverflow run emit-graph
```

The devtool example wires those outputs into one multi-app bundle:

```sh
pnpm --filter @kovojs/example-devtool dev
```

Open `http://localhost:5173/?app=commerce` and switch apps from the URL/query controls.

## Mount under an app prefix

Use the Vite plugin when the devtool should live under an existing dev server path such as
`/__kovo`:

```ts
import { devtoolMountPlugin } from '@kovojs/devtool/vite';

export default {
  plugins: [devtoolMountPlugin('/__kovo', { handlerModuleId: '/src/app-shell.ts' })],
};
```

Set `KOVO_DEVTOOL_BASE=/__kovo` so emitted links match the mount path, then run:

```sh
pnpm --filter @kovojs/example-devtool dev:mounted
```

## Build a bundle directly

For a host app, provide the graph JSON and source root:

```ts
import { readFileSync } from 'node:fs';
import { buildBundle } from '@kovojs/devtool';
import { createDevtoolApp } from '@kovojs/devtool/app';

const bundle = buildBundle({
  app: 'my-app',
  label: 'My App',
  graph: JSON.parse(readFileSync('./src/generated/graph.json', 'utf8')),
  srcRoot: './src',
});

export const { app, nodeHandler } = createDevtoolApp({ bundles: [bundle] });
export default app;
```

The package is data-free: the host provides app graph and source root; the devtool derives node
cards, lanes, source previews, and edges from that input.

## MCP surface

Run the MCP server over the same graph:

```sh
kovo-devtool mcp --graph ./src/generated/graph.json --src ./src --label "My App"
pnpm --filter @kovojs/example-devtool mcp
pnpm --filter @kovojs/example-devtool test:mcp
```

`kovo_explain({ query, app?, limit? })` resolves exact node names when possible, then falls back to
deterministic BM25-ranked cards. Results include stable `kovo-explain/v1` text and structured
content for agents.

## Conformance

Use the example conformance check to prove the MCP cards and graph edges are the same artifact:

```sh
pnpm --filter @kovojs/example-devtool conformance
```

When a graph assertion fails, fix the app facts first: route, query, mutation, domain, or generated
graph emission. The devtool should explain the graph you built, not patch around it.

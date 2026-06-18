# @kovojs/devtool

A reusable **dataflow devtool** for Kovo apps: a visual graph (select a node →
trace its queries-in and mutations-out, with syntax-highlighted source previews)
and an **MCP agent surface**, both rendering the *same* graph cards (SPEC §5.3 —
"agents consume the same artifact humans read").

The package is **data-free**. A host provides its own `KovoExplainInput` graph
(`generated/graph.json`) plus its source root; the package derives the dataflow
graph, renders the UI, serves the MCP tool, and mounts at a path.

## Use it in a host app

```ts
// app-shell.ts — give it your app's own graph
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

Mount it under a prefix on your dev server:

```ts
// vite.config.ts
import { devtoolMountPlugin } from '@kovojs/devtool/vite';
export default { plugins: [devtoolMountPlugin('/__kovo', { handlerModuleId: '/src/app-shell.ts' })] };
// set KOVO_DEVTOOL_BASE=/__kovo so emitted URLs match, then open /__kovo
```

The agent surface (MCP) over the same cards:

```bash
kovo-devtool mcp --graph ./src/generated/graph.json --src ./src --label "My App"
```

`kovo_explain({ query, app?, limit? })` resolves exact node names precisely, else
**BM25**-ranks the cards (deterministic, matched-terms auditable — no embedding
model). Each result is a card as stable `kovo-explain/v1` text + `structuredContent`.

## Exports

| Entry | Loads `@kovojs/server`? | Provides |
| --- | --- | --- |
| `@kovojs/devtool` | no (plain-Node safe) | `buildBundle`, `buildDataflowGraph`, `buildCard`, `cardToText`, `renderPage`, `createMcpServer`, `buildBm25`, `KIND_META`, `LANES` |
| `@kovojs/devtool/app` | yes | `createDevtoolApp` |
| `@kovojs/devtool/vite` | no | `devtoolMountPlugin` |

The root is server-free on purpose, so scripts, the MCP bin, and CI checks load it
in plain Node; only `createDevtoolApp` pulls in the Kovo server.

The package is self-contained: the stylesheet and the two web fonts are inlined
(base64) into the page and the pan/zoom island is registered as a `/c/` client
module, so a host serves nothing but the handler.

See `examples/devtool` for a working consumer that wires three example apps.

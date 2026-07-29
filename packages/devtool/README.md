# @kovojs/devtool

A reusable **dataflow devtool** for Kovo apps: a visual graph (select a node →
trace its queries-in and mutations-out, with syntax-highlighted source previews)
and an **MCP agent surface**, both rendering the _same_ graph cards (SPEC §5.3 —
"agents consume the same artifact humans read").

The package is **data-free**. A host provides its own `KovoExplainInput` graph plus
its source root; the package derives the dataflow graph, renders the UI, serves the
MCP tool, and mounts at a path.

## Use it in a host app

```ts
// app-shell.ts — give it your app's own graph
import '@kovojs/server/runtime-bootstrap';

import { readFileSync } from 'node:fs';
import { buildBundle } from '@kovojs/devtool';
import { createDevtoolApp } from '@kovojs/devtool/app';

const bundle = buildBundle({
  app: 'my-app',
  label: 'My App',
  graph: JSON.parse(readFileSync('./graph.json', 'utf8')),
  srcRoot: './src',
});
export const { app, nodeHandler } = createDevtoolApp({ bundles: [bundle] });
export default app;
```

Mount it under a prefix on your dev server:

```ts
// vite.config.ts
import { devtoolMountPlugin } from '@kovojs/devtool/vite';
export default {
  plugins: [devtoolMountPlugin('/__kovo', { handlerModuleId: '/src/app-shell.ts' })],
};
// set KOVO_DEVTOOL_BASE=/__kovo so emitted URLs match, then open /__kovo
```

In development, export the returned `manifest` and `runtimeFrames` beside
`nodeHandler`. The mount plugin then observes enhanced round trips before it
dispatches the prefixed devtool route:

```ts
const devtool = createDevtoolApp({ bundles: [bundle] });
export const { app, manifest, nodeHandler, runtimeFrames } = devtool;
```

The runtime overlay records a pending and settled summary for each enhanced
round trip. It keeps mutation/query/domain names, status, counts, and byte sizes.
Mutation inputs, query values, change keys, target identities, dependency keys,
cookies, headers, and response bodies are never retained. History and SSE
subscribers are bounded; a blocked stream coalesces to the latest frame. The
capture hook is Vite-development-only. The app defaults to production outside an
explicit development process, a production process rejects a live-mode override,
and production emits no runtime module, markup, history, or SSE endpoint.

The agent surface (MCP) over the same cards:

```bash
kovo-devtool mcp --graph ./graph.json --src ./src --label "My App"
```

`kovo_explain({ query, app?, limit? })` resolves exact node names precisely, else
**BM25**-ranks the cards (deterministic, matched-terms auditable — no embedding
model). Each result is a card as stable `kovo-explain/v1` text + `structuredContent`.

`kovo_graph_recent_frames({ app?, limit? })` returns the same immutable redacted
frames the visual overlay replays. A same-process host passes the devtool's store
to the MCP renderer:

```ts
const mcp = createMcpServer({
  bundles: [bundle],
  runtimeFrames: devtool.runtimeFrames,
});
```

The standalone `kovo-devtool mcp` process has its own empty bounded store until a
host explicitly couples it to live development capture; it never invents runtime
evidence from the static graph.

## Exports

| Entry                  | Loads `@kovojs/server`? | Provides                                                       |
| ---------------------- | ----------------------- | -------------------------------------------------------------- |
| `@kovojs/devtool`      | no (plain-Node safe)    | Graph/card renderers, MCP, and the bounded runtime frame store |
| `@kovojs/devtool/app`  | yes                     | `createDevtoolApp`                                             |
| `@kovojs/devtool/vite` | no                      | `devtoolMountPlugin`                                           |

The root is server-free on purpose, so scripts, the MCP bin, and CI checks load it
in plain Node; only `createDevtoolApp` pulls in the Kovo server.

The package is self-contained: the stylesheet and the two web fonts are inlined
(base64) into the page and the pan/zoom island is registered as a `/c/` client
module, so a host serves nothing but the handler.

See `examples/devtool` for a minimal consumer.

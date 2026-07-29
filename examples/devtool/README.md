# Kovo Dataflow Devtools (example)

A thin consumer of [`@kovojs/devtool`](../../packages/devtool). It wires app graph
JSON into the reusable devtool — select any node and trace the **queries that go
into it** and the **mutations that go out**, with syntax-highlighted source
previews. All the logic (graph derivation, rendering, MCP, mount) lives in the
package; this example no longer generates sibling app graphs as a setup step.
It uses committed graph bundles on a clean checkout and prefers fresh generated
graphs when they exist.

## Run

```bash
pnpm --filter @kovojs/example-devtool test
```

The graph state lives in the URL (`?app`, `?sel`, `?q`), so the core is
server-rendered and works with JS off (the Kovo MPA thesis, SPEC §8). Pan / zoom /
hover is a progressive-enhancement island the package loads via `on:visible`.
Development mode also shows the bounded redacted runtime replay. The Vite mount
captures `Kovo-Targets`, `Kovo-Changes`, and `<kovo-query>` routing facts without
retaining values or identities; production mode omits the stream and its client
module entirely.

See the package README for the API and for mounting the devtool in your own app.

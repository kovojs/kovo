// @kovojs/devtool — a reusable dataflow devtool for Kovo apps.
// The host provides its own graph (KovoExplainInput) + source root; this package
// derives the graph, renders the visual UI, and serves the agent (MCP) surface.
export { buildDataflowGraph, buildBm25, KIND_META, LANES } from './graph-model.mjs';
export { buildBundle, resolveSource } from './source-slice.mjs';
export { buildCard, cardToText } from './cards.mjs';
export { renderPage } from './render.mjs';
export { createMcpServer } from './mcp.mjs';
// createDevtoolApp lives at '@kovojs/devtool/app' (it imports @kovojs/server, so
// the root stays loadable in plain Node — scripts, the MCP bin, conformance).
// devtoolMountPlugin lives at '@kovojs/devtool/vite'.

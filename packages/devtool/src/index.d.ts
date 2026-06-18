// Public type surface for @kovojs/devtool. The graph payloads are intentionally
// loose (host-provided KovoExplainInput-shaped data), so node/edge/card shapes
// are modelled as records rather than exhaustive types.

export type GraphJson = Record<string, unknown>;

export interface DataflowNode {
  id: string;
  kind: 'mutation' | 'domain' | 'query' | 'component' | 'page';
  name: string;
  label: string;
  data: Record<string, unknown>;
  source?: SourceSlice | null;
  x?: number;
  y?: number;
  lane?: number;
}
export interface DataflowEdge {
  id: string;
  from: string;
  to: string;
  kind: 'writes' | 'backs' | 'feeds' | 'emits' | 'renders';
  data: Record<string, unknown>;
}
export interface SourceSlice {
  file: string;
  startLine: number;
  anchorLine: number;
  endLine: number;
  code: string;
  lang: string;
  touches?: Array<Record<string, unknown>>;
}
export interface DataflowBundle {
  app: string;
  label: string;
  blurb: string;
  nodes: DataflowNode[];
  edges: DataflowEdge[];
  counts: Record<string, number>;
}
export interface DataflowGraph {
  nodes: DataflowNode[];
  edges: DataflowEdge[];
  byId: Record<string, DataflowNode>;
  index: Record<string, unknown>;
}
export interface AppManifestEntry {
  id: string;
  label: string;
  blurb: string;
}
export interface Bm25Hit {
  id: string;
  score: number;
  matched: string[];
}
export interface KindMeta {
  label: string;
  accent: string;
  glyph: string;
  blurb: string;
}

export function buildDataflowGraph(graph: GraphJson): DataflowGraph;
export function buildBm25(
  nodes: DataflowNode[],
  byId: Record<string, DataflowNode>,
  index: unknown,
): (query: string, limit?: number) => Bm25Hit[];
export const KIND_META: Record<string, KindMeta>;
export const LANES: string[];

export function buildBundle(opts: {
  app: string;
  label?: string;
  blurb?: string;
  graph: GraphJson;
  srcRoot: string;
}): DataflowBundle;
export function resolveSource(
  node: DataflowNode,
  srcRoot: string,
  files: string[],
): SourceSlice | null;

export function buildCard(node: DataflowNode, bundle: DataflowBundle): Record<string, unknown>;
export function cardToText(card: Record<string, unknown>): string;

export function renderPage(opts: {
  manifest: AppManifestEntry[];
  bundle: DataflowBundle;
  app: string;
  sel?: string;
  q?: string;
  pzHref: string;
  css?: string;
}): string;

// createDevtoolApp is declared in './app' (it imports @kovojs/server);
// devtoolMountPlugin is declared in './vite'.

export function createMcpServer(opts: { bundles: DataflowBundle[] }): {
  server: unknown;
  explain: (args: { query: string; app?: string; limit?: number }) => unknown;
  TOOL: unknown;
  appIds: string[];
  serveStdio: () => Promise<void>;
};

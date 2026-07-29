// Public type surface for @kovojs/devtool. The graph payloads are intentionally
// loose (host-provided KovoExplainInput-shaped data), so node/edge/card shapes
// are modelled as records rather than exhaustive types.

export type GraphJson = Record<string, unknown>;

export interface SourceAnchor {
  file: string;
  start: number;
  end: number;
}

export interface DataflowNode {
  anchor?: SourceAnchor;
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
  anchor?: SourceAnchor;
  id: string;
  from: string;
  to: string;
  kind: 'writes' | 'backs' | 'feeds' | 'emits' | 'renders';
  data: Record<string, unknown>;
}
export interface SourceSlice {
  file: string;
  start?: number;
  startLine: number;
  anchorLine: number;
  end?: number;
  endLine: number;
  code: string;
  lang: string;
  highlight?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  touches?: Array<Record<string, unknown>>;
}
export interface DataflowBundle {
  app: string;
  label: string;
  blurb: string;
  limitations?: string[];
  provenance?: string;
  view?: 'source-graph' | 'runtime-registry';
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
export function buildBm25(nodes: DataflowNode[]): (query: string, limit?: number) => Bm25Hit[];
export const KIND_META: Readonly<Record<string, Readonly<KindMeta>>>;
export const LANES: readonly string[];

export function buildBundle(opts: {
  app: string;
  label?: string;
  blurb?: string;
  graph: GraphJson;
  limitations?: string[];
  provenance?: string;
  srcRoot: string;
  view?: 'source-graph' | 'runtime-registry';
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
}): string;

// createDevtoolApp is declared in './app' (it imports @kovojs/server);
// devtoolMountPlugin is declared in './vite'.

export function createMcpServer(opts: { bundles: DataflowBundle[] }): {
  server: unknown;
  explain: (args: { query: string; app?: string; limit?: number }) => unknown;
  TOOL: unknown;
  appIds: string[];
  serveStdio: (
    input?: AsyncIterable<string | Uint8Array>,
    output?: { write(chunk: string): unknown },
    errorOutput?: { write(chunk: string): unknown },
  ) => Promise<void>;
};

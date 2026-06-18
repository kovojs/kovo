#!/usr/bin/env node
// Kovo Dataflow MCP server — the agent surface.
//
// One tool, kovo_explain, shaped like the CLI's: a free-text query, BM25-ranked
// over the SAME graph cards the visual devtool renders (src/cards.mjs), returning
// each as stable text + structuredContent. Deterministic, explainable retrieval
// (matched terms + scores) — no embedding model — per SPEC §5.3 / the legibility
// constitution. Run: `node scripts/mcp-server.mjs` (stdio).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { buildBm25 } from '../src/graph-model.mjs';
import { buildCard, cardToText } from '../src/cards.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

// load every app bundle + a per-app BM25 index over its cards
const apps = new Map();
for (const f of readdirSync(DATA)) {
  if (!f.endsWith('.json') || f === 'manifest.json') continue;
  const bundle = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  const byId = Object.fromEntries(bundle.nodes.map((n) => [n.id, n]));
  apps.set(bundle.app, { bundle, byId, search: buildBm25(bundle.nodes, byId, null) });
}
const appIds = [...apps.keys()];
const DEFAULT_APP = appIds[0];

function explain({ query, app = DEFAULT_APP, limit = 5 }) {
  const entry = apps.get(app);
  if (!entry) throw new Error(`unknown app "${app}". available: ${appIds.join(', ')}`);
  const { bundle, byId, search } = entry;

  // exact id / name / label match wins (precise lookup), then BM25 fills the rest
  const q = String(query).trim();
  const lc = q.toLowerCase();
  const exact = bundle.nodes.find((n) => n.id === q || n.name.toLowerCase() === lc || n.label.toLowerCase() === lc);
  const ranked = search(q, limit + (exact ? 1 : 0));

  const ordered = [];
  const seen = new Set();
  if (exact) { ordered.push({ id: exact.id, score: Infinity, matched: ['exact'] }); seen.add(exact.id); }
  for (const r of ranked) { if (!seen.has(r.id)) { ordered.push(r); seen.add(r.id); } }

  const results = ordered.slice(0, limit).map((r) => {
    const node = byId[r.id];
    const card = buildCard(node, bundle);
    return { id: r.id, kind: node.kind, label: node.label, score: r.score === Infinity ? null : Number(r.score.toFixed(3)), matched: r.matched, card, text: cardToText(card) };
  });
  return { app, query: q, count: results.length, results };
}

const TOOL = {
  name: 'kovo_explain',
  description:
    `Trace dataflow in a Kovo app: pass a free-text query (a component, query, mutation, domain, ` +
    `or topic) and get the most relevant graph cards, BM25-ranked. Each card shows queries-in, ` +
    `mutations-out, invalidation + optimistic status, touch-graph write sites, and a source slice — ` +
    `the same artifact the visual devtool renders (SPEC §5.3). Apps: ${appIds.join(', ')}.`,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'a node name/label, or a topic — exact names resolve precisely, else BM25.' },
      app: { type: 'string', enum: appIds, description: `which app graph (default: ${DEFAULT_APP}).` },
      limit: { type: 'number', description: 'max cards (default 5).' },
    },
    required: ['query'],
  },
};

const server = new Server({ name: 'kovo-dataflow', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== TOOL.name) throw new Error(`unknown tool ${request.params.name}`);
  try {
    const out = explain(request.params.arguments ?? {});
    const text = out.results.length
      ? out.results.map((r, i) => `### ${i + 1}. ${r.label} (${r.kind})  score=${r.score ?? 'exact'}  matched=[${r.matched.join(' ')}]\n${r.text}`).join('\n\n')
      : `No graph cards matched "${out.query}" in ${out.app}.`;
    return { content: [{ type: 'text', text }], structuredContent: out };
  } catch (err) {
    return { content: [{ type: 'text', text: `error: ${err.message}` }], isError: true };
  }
});

// Exported for in-process tests (avoids stdio plumbing).
export { explain, TOOL };

if (process.argv[1] && process.argv[1].endsWith('mcp-server.mjs')) {
  await server.connect(new StdioServerTransport());
  process.stderr.write(`kovo-dataflow MCP server ready (apps: ${appIds.join(', ')})\n`);
}

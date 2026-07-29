// Finite MCP stdio server (agent surface), parameterized by bundles and the
// optional process-local runtime store. kovo_explain is BM25-ranked over the same
// cards the UI renders; kovo_graph_recent_frames projects the exact immutable
// summaries that light the visual graph (SPEC §5.3 / §11.5).
import { createFiniteMcpStdioServer } from '@kovojs/core/internal/mcp-stdio';

import { buildBm25 } from './graph-model.mjs';
import { buildCard, cardToText } from './cards.mjs';
import { createRuntimeFrameStore, RUNTIME_FRAME_MAX_LIMIT } from './runtime-frames.mjs';

const MCP_MAX_LINE_BYTES = 4 * 1024 * 1024;
const MCP_MAX_RESULTS = 20;

/** @param {{ bundles: any[], runtimeFrames?: ReturnType<typeof createRuntimeFrameStore> }} options */
export function createMcpServer({ bundles, runtimeFrames = createRuntimeFrameStore() }) {
  const apps = new Map();
  for (const bundle of bundles) {
    const byId = Object.fromEntries(bundle.nodes.map((n) => [n.id, n]));
    apps.set(bundle.app, { bundle, byId, search: buildBm25(bundle.nodes) });
  }
  const appIds = [...apps.keys()];
  const DEFAULT_APP = appIds[0];

  function explain(options) {
    if (!isRecord(options)) throw new Error('kovo_explain arguments must be an object');
    const keys = Object.keys(options);
    if (keys.some((key) => key !== 'app' && key !== 'limit' && key !== 'query')) {
      throw new Error('kovo_explain arguments contain unsupported fields');
    }
    const { app = DEFAULT_APP, limit = 5, query } = options;
    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('kovo_explain query must be a nonempty string');
    }
    if (typeof app !== 'string') throw new Error('kovo_explain app must be a string');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MCP_MAX_RESULTS) {
      throw new Error(`kovo_explain limit must be an integer from 1 to ${MCP_MAX_RESULTS}`);
    }
    const entry = apps.get(app);
    if (!entry) throw new Error(`unknown app "${app}". available: ${appIds.join(', ')}`);
    const { bundle, byId, search } = entry;
    const q = query.trim();
    const lc = q.toLowerCase();
    const exact = bundle.nodes.find(
      (n) => n.id === q || n.name.toLowerCase() === lc || n.label.toLowerCase() === lc,
    );
    const ranked = search(q, limit + (exact ? 1 : 0));
    const ordered = [];
    const seen = new Set();
    if (exact) {
      ordered.push({ id: exact.id, score: Infinity, matched: ['exact'] });
      seen.add(exact.id);
    }
    for (const r of ranked)
      if (!seen.has(r.id)) {
        ordered.push(r);
        seen.add(r.id);
      }
    const results = ordered.slice(0, limit).map((r) => {
      const node = byId[r.id];
      const card = buildCard(node, bundle);
      return {
        id: r.id,
        kind: node.kind,
        label: node.label,
        score: r.score === Infinity ? null : Number(r.score.toFixed(3)),
        matched: r.matched,
        card,
        text: cardToText(card),
      };
    });
    return { app, query: q, count: results.length, results };
  }

  function recentFrames(options) {
    if (!isRecord(options)) {
      throw new Error('kovo_graph_recent_frames arguments must be an object');
    }
    const keys = Object.keys(options);
    if (keys.some((key) => key !== 'app' && key !== 'limit')) {
      throw new Error('kovo_graph_recent_frames arguments contain unsupported fields');
    }
    const { app = DEFAULT_APP, limit = 8 } = options;
    if (typeof app !== 'string') {
      throw new Error('kovo_graph_recent_frames app must be a string');
    }
    if (!apps.has(app)) throw new Error(`unknown app "${app}". available: ${appIds.join(', ')}`);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > runtimeFrames.limit) {
      throw new Error(
        `kovo_graph_recent_frames limit must be an integer from 1 to ${runtimeFrames.limit}`,
      );
    }
    const frames = runtimeFrames.recent({ app, limit });
    return {
      app,
      count: frames.length,
      frames,
      schema: 'kovo-devtool-runtime-frames/v1',
    };
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
        query: {
          type: 'string',
          description: 'a node name/label, or a topic — exact names resolve precisely, else BM25.',
        },
        app: {
          type: 'string',
          enum: [...appIds],
          description: `which app graph (default: ${DEFAULT_APP}).`,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MCP_MAX_RESULTS,
          description: 'max cards (default 5).',
        },
      },
      required: ['query'],
    },
  };
  const RECENT_FRAMES_TOOL = {
    name: 'kovo_graph_recent_frames',
    description:
      'Return the most recent bounded, redacted development wire summaries from the same store ' +
      'that lights the visual graph. Values, keys, target identities, inputs, cookies, headers, ' +
      'and response bodies are never returned.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        app: {
          type: 'string',
          enum: [...appIds],
          description: `which app runtime stream (default: ${DEFAULT_APP}).`,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: Math.min(runtimeFrames.limit, RUNTIME_FRAME_MAX_LIMIT),
          description: `max recent frames (default 8; store bound ${runtimeFrames.limit}).`,
        },
      },
    },
  };

  const server = createFiniteMcpStdioServer({
    async callTool(name, args) {
      if (name === TOOL.name) {
        const out = explain(args);
        const text = out.results.length
          ? out.results
              .map(
                (r, i) =>
                  `### ${i + 1}. ${r.label} (${r.kind})  score=${r.score ?? 'exact'}  matched=[${r.matched.join(' ')}]\n${r.text}`,
              )
              .join('\n\n')
          : `No graph cards matched "${out.query}" in ${out.app}.`;
        return { content: [{ type: 'text', text }], structuredContent: out };
      }
      if (name === RECENT_FRAMES_TOOL.name) {
        const out = recentFrames(args);
        const text = out.frames.length
          ? [
              out.schema,
              `APP ${out.app} frames=${out.count}`,
              ...out.frames.map(
                (frame) =>
                  `FRAME #${frame.sequence} phase=${frame.phase} mutation=${frame.mutation ?? '-'} ` +
                  `changes=${frame.changes.map((change) => change.domain).join(',') || '-'} ` +
                  `queries=${
                    [
                      ...new Set([
                        ...frame.targets.queryNames,
                        ...frame.queries.map((query) => query.name),
                      ]),
                    ].join(',') || '-'
                  } values=redacted`,
              ),
            ].join('\n')
          : `${out.schema}\nAPP ${out.app} frames=0`;
        return { content: [{ type: 'text', text }], structuredContent: out };
      }
      throw new Error(`unknown tool ${name}`);
    },
    maxLineBytes: MCP_MAX_LINE_BYTES,
    serverInfo: { name: 'kovo-dataflow', version: '0.1.0' },
    tools: [TOOL, RECENT_FRAMES_TOOL],
  });

  return {
    server,
    explain,
    recentFrames,
    RECENT_FRAMES_TOOL,
    TOOL,
    appIds,
    async serveStdio(input = process.stdin, output = process.stdout, errorOutput = process.stderr) {
      errorOutput.write(`kovo-dataflow MCP server ready (apps: ${appIds.join(', ')})\n`);
      await server.serveStdio(input, output);
    },
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { describe, expect, it } from 'vitest';

import { buildBm25, KIND_META, LANES, traceGraph } from './graph-model.mjs';
import { createMcpServer } from './mcp.mjs';
import { arraySort } from './output-security.mjs';

function retrievalBundle() {
  return {
    app: 'demo',
    blurb: 'Retrieval fixture',
    counts: { domain: 1, query: 1 },
    edges: [
      {
        data: {},
        from: 'domain:orders',
        id: 'domain:orders->query:orderHistoryQuery:backs',
        kind: 'backs',
        to: 'query:orderHistoryQuery',
      },
    ],
    label: 'Demo',
    nodes: [
      {
        data: {},
        id: 'domain:orders',
        kind: 'domain',
        label: 'Orders',
        name: 'orders',
        source: null,
      },
      {
        data: { domains: ['orders'], guards: [] },
        id: 'query:orderHistoryQuery',
        kind: 'query',
        label: 'Order history',
        name: 'orderHistoryQuery',
        source: null,
      },
    ],
  };
}

describe('devtool BM25 retrieval', () => {
  it('preserves camel-case token ranking for the shared UI and MCP search surface', () => {
    const bundle = retrievalBundle();
    const hits = buildBm25(bundle.nodes)('order history');

    expect(hits[0]).toMatchObject({
      id: 'query:orderHistoryQuery',
      matched: ['order', 'history'],
    });

    const explanation = createMcpServer({ bundles: [bundle] }).explain({
      app: 'demo',
      limit: 1,
      query: 'order history records',
    });
    expect(explanation).toMatchObject({
      app: 'demo',
      count: 1,
      query: 'order history records',
      results: [
        {
          id: 'query:orderHistoryQuery',
          kind: 'query',
          matched: ['order', 'history'],
        },
      ],
    });
  });

  it('keeps the renderer vocabulary immutable after module initialization', () => {
    expect(() => {
      KIND_META.domain.accent = 'red; background-image: url(https://attacker.invalid/leak)';
    }).toThrow(TypeError);
    expect(() => {
      LANES[0] = '<img src=x onerror=alert(1)>';
    }).toThrow(TypeError);

    expect(KIND_META.domain.accent).toBe('#34d399');
    expect(LANES[0]).toBe('mutation');
  });

  it('keeps adversarial graph sorting subquadratic without using Array.prototype.sort', () => {
    const size = 4_096;
    const values = [];
    for (let value = size - 1; value >= 0; value -= 1) values.push(value);
    let comparisons = 0;

    const sorted = arraySort(values, (left, right) => {
      comparisons += 1;
      return left - right;
    });

    expect(sorted[0]).toBe(0);
    expect(sorted[size - 1]).toBe(size - 1);
    expect(comparisons).toBeLessThan(size * 16);
  });

  it('traces a graph deeper than the JavaScript call stack with an iterative worklist', () => {
    const size = 20_000;
    const nodes = [];
    const edges = [];
    for (let index = 0; index < size; index += 1) {
      nodes.push({ id: `node:${index}` });
      if (index > 0) {
        edges.push({
          from: `node:${index - 1}`,
          id: `edge:${index - 1}`,
          to: `node:${index}`,
        });
      }
    }

    const traced = traceGraph(nodes, edges, 'node:0');

    expect(traced.nodes.size).toBe(size);
    expect(traced.edges.size).toBe(size - 1);
  });
});

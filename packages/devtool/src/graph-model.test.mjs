import { describe, expect, it } from 'vitest';

import { buildBm25, KIND_META, LANES } from './graph-model.mjs';
import { createMcpServer } from './mcp.mjs';

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
});

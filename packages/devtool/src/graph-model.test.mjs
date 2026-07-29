import { describe, expect, it } from 'vitest';

import {
  buildBm25,
  buildDataflowGraph,
  KIND_META,
  LANES,
  laneForKind,
  traceGraph,
} from './graph-model.mjs';
import { createMcpServer } from './mcp.mjs';
import { buildCard, cardToText } from './cards.mjs';
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
  it('carries compiler-owned declaration anchors onto every derived node and edge', () => {
    const mutationSource = { end: 52, file: 'src/mutations.ts', start: 8 };
    const querySource = { end: 94, file: 'src/queries.ts', start: 21 };
    const domainSource = { end: 36, file: 'src/domains.ts', start: 7 };
    const componentSource = { end: 130, file: 'src/card.tsx', start: 12 };
    const formSource = { end: 117, file: 'src/card.tsx', start: 80 };
    const handlerSource = { end: 76, file: 'src/card.tsx', start: 52 };
    const triggerSource = { end: 105, file: 'src/card.tsx', start: 78 };
    const deriveSource = { end: 48, file: 'src/card.tsx', start: 20 };
    const deriveUseSource = { end: 126, file: 'src/card.tsx', start: 106 };
    const bindingSource = { end: 129, file: 'src/card.tsx', start: 118 };
    const pageSource = { end: 84, file: 'src/routes.tsx', start: 9 };
    const agentSource = { end: 90, file: 'src/agents.ts', start: 44 };
    const toolSource = { end: 41, file: 'src/agents.ts', start: 8 };
    const toolBindingSource = { end: 76, file: 'src/agents.ts', start: 68 };
    const toolMutationSource = { end: 38, file: 'src/agents.ts', start: 30 };
    const taskSource = { end: 180, file: 'src/tasks.ts', start: 12 };
    const taskMutationSource = { end: 92, file: 'src/tasks.ts', start: 81 };
    const taskQuerySource = { end: 126, file: 'src/tasks.ts', start: 113 };
    const taskScheduleSource = { end: 168, file: 'src/tasks.ts', start: 153 };
    const graph = buildDataflowGraph({
      agents: [
        {
          modelOperations: [{ kind: 'server.egress.request' }],
          name: 'cart-assistant',
          source: agentSource,
          tools: [
            {
              bindingSource: toolBindingSource,
              minimumIntegrity: 'principal',
              mutation: 'cart/add',
              mutationSource: toolMutationSource,
              name: 'add-item',
              operations: [{ kind: 'server.state.write' }],
              resultIntegrity: 'principal',
              source: toolSource,
            },
          ],
        },
      ],
      components: [
        {
          derives: [
            {
              generatedFrom: deriveUseSource,
              inputs: ['cart'],
              name: 'cartLabel',
              ref: '/c/card.client.js#cartLabel',
              source: deriveSource,
              target: '[data-derive="cart.cartLabel"]',
            },
          ],
          exportName: 'Card',
          handlers: [
            {
              event: 'click',
              exportName: 'Card$click',
              generatedFrom: handlerSource,
              ref: '/c/card.client.js#Card$click',
              source: handlerSource,
            },
          ],
          mutationForms: [{ mutation: 'cart/add', slot: 'add', source: formSource }],
          name: 'components/card',
          queries: ['cart'],
          source: componentSource,
          triggers: [
            {
              exportName: 'Card$visible',
              generatedFrom: triggerSource,
              ref: '/c/card.client.js#Card$visible',
              source: triggerSource,
              trigger: 'visible',
            },
          ],
        },
      ],
      domains: [{ name: 'cart', source: domainSource }],
      mutations: [{ key: 'cart/add', source: mutationSource, writes: ['cart'] }],
      pages: [
        {
          navigationSegments: [{ components: ['Card'], id: 'page:/', kind: 'page' }],
          route: '/',
          source: pageSource,
        },
      ],
      queries: [{ domains: ['cart'], query: 'cart', source: querySource }],
      tasks: [
        {
          composition: [
            { kind: 'run-mutation', source: taskMutationSource, target: 'cart/add' },
            { kind: 'run-query', source: taskQuerySource, target: 'cart' },
            { kind: 'schedule', source: taskScheduleSource, target: 'cart/reconcile' },
          ],
          key: 'cart/reconcile',
          runMutations: ['cart/add'],
          runQueries: ['cart'],
          schedules: ['cart/reconcile'],
          source: taskSource,
        },
      ],
      updateCoverage: [
        {
          component: 'Card',
          position: 'binding',
          query: 'cart.count',
          sourceAnchor: bindingSource,
          status: 'plan',
        },
      ],
    });

    expect(
      Object.fromEntries(
        graph.nodes.filter((node) => node.anchor).map((node) => [node.id, node.anchor]),
      ),
    ).toEqual({
      'component:components/card': componentSource,
      'derive:components/card:cartLabel:[data-derive="cart.cartLabel"]': deriveSource,
      'domain:cart': domainSource,
      'agent:cart-assistant': agentSource,
      'handler:components/card:Card$click': handlerSource,
      'binding-position:components/card:src/card.tsx:118:0': bindingSource,
      'mutation:cart/add': mutationSource,
      'page:/': pageSource,
      'query:cart': querySource,
      'task:cart/reconcile': taskSource,
      'tool:cart-assistant:add-item': toolSource,
      'trigger:components/card:Card$visible': triggerSource,
    });
    expect(Object.fromEntries(graph.edges.map((edge) => [edge.kind, edge.anchor]))).toEqual({
      backs: querySource,
      derives: deriveUseSource,
      dispatches: taskMutationSource,
      emits: formSource,
      feeds: componentSource,
      handles: handlerSource,
      invokes: toolMutationSource,
      owns: bindingSource,
      reads: taskQuerySource,
      renders: pageSource,
      schedules: taskScheduleSource,
      triggers: triggerSource,
      updates: bindingSource,
      uses: toolBindingSource,
      writes: mutationSource,
    });
    expect(graph.edges.find((edge) => edge.kind === 'updates')).toMatchObject({
      from: 'query:cart',
      to: 'binding-position:components/card:src/card.tsx:118:0',
    });
    expect(buildCard(graph.byId['agent:cart-assistant'], graph).sections.tools).toEqual([
      expect.objectContaining({
        minimumIntegrity: 'principal',
        mutation: 'cart/add',
        resultIntegrity: 'principal',
      }),
    ]);
    expect(cardToText(buildCard(graph.byId['tool:cart-assistant:add-item'], graph))).toContain(
      'INVOKES MUTATIONS (1)',
    );
    expect(buildCard(graph.byId['task:cart/reconcile'], graph).sections.composition).toEqual([
      expect.objectContaining({ edge: 'dispatches', name: 'cart/add' }),
      expect.objectContaining({ edge: 'reads', name: 'cart' }),
      expect.objectContaining({ edge: 'schedules', name: 'cart/reconcile' }),
    ]);
    expect(laneForKind('handler')).toBe('component');
    expect(laneForKind('binding-position')).toBe('component');
  });

  it('keeps repeated exact task composition occurrences as distinct stable edges', () => {
    const first = { end: 40, file: 'src/tasks.ts', start: 32 };
    const second = { end: 72, file: 'src/tasks.ts', start: 64 };
    const graph = buildDataflowGraph({
      mutations: [{ key: 'refresh', source: first }],
      tasks: [
        {
          composition: [
            { kind: 'run-mutation', source: first, target: 'refresh' },
            { kind: 'run-mutation', source: second, target: 'refresh' },
          ],
          key: 'twice',
          runMutations: ['refresh'],
          source: { end: 80, file: 'src/tasks.ts', start: 0 },
        },
      ],
    });
    const dispatches = graph.edges.filter((edge) => edge.kind === 'dispatches');

    expect(dispatches.map((edge) => edge.anchor)).toEqual([first, second]);
    expect(new Set(dispatches.map((edge) => edge.id)).size).toBe(2);
  });

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
    expect(LANES[0]).toBe('agent');
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

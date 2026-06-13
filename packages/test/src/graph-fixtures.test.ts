import { describe, expect, it } from 'vitest';

import {
  generatedGraphArtifactAcceptanceChecklistFact,
  generatedGraphArtifactHonestyFact,
  generatedGraphArtifactHonestySummaryFact,
  generatedGraphArtifactAcceptanceFact,
  generatedGraphArtifactAcceptanceEvidenceFact,
  graphFixtureFile,
  graphComponentTargetFacts,
  graphDomainFacts,
  graphFragmentTargetForQuery,
  graphInvalidationFacts,
  graphInvalidatedByQueries,
  graphInvalidatedQueries,
  graphMutationFact,
  graphMutationKeys,
  graphMutationUpdateConsumers,
  graphOptimisticFacts,
  graphOptimisticStatusMatrix,
  graphPageFact,
  graphQueryConsumers,
  graphRouteFacts,
  graphStaticBehaviorFact,
  graphTouchGraphKeys,
} from './graph-fixtures.js';

const graph = {
  components: [
    { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
    { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
  ],
  mutations: [
    { invalidates: ['cart', 'product'], key: 'cart/add' },
    { invalidates: ['attachment'], key: 'order/receipt' },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
  ],
  pages: [
    { queries: ['cart', 'productGrid'], route: '/cart' },
    { queries: [], route: '/admin' },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  touchGraph: {
    'cart.addItem': {},
    'order.receipt': {},
  },
};

describe('@jiso/test graph fixture seam', () => {
  it('looks up graph facts by public graph keys', () => {
    expect(graphPageFact(graph, '/cart')).toEqual({
      queries: ['cart', 'productGrid'],
      route: '/cart',
    });
    expect(graphMutationFact(graph, 'cart/add')).toEqual({
      invalidates: ['cart', 'product'],
      key: 'cart/add',
    });
    expect(graphFragmentTargetForQuery(graph, 'productGrid')).toBe('product-grid');
  });

  it('derives query consumers from component and page graph facts', () => {
    expect(graphQueryConsumers(graph)).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
      { consumers: [], query: 'orderHistory' },
    ]);
    expect(graphMutationUpdateConsumers(graph, 'cart/add')).toEqual([
      { consumers: ['component:CartBadge', 'page:/cart'], query: 'cart' },
      { consumers: ['component:ProductGrid', 'page:/cart'], query: 'productGrid' },
    ]);
  });

  it('derives invalidation and optimistic matrices without fw-explain text parsing', () => {
    expect(graphInvalidatedQueries(graph, 'cart/add')).toEqual(['cart', 'productGrid']);
    expect(Object.fromEntries(graphInvalidatedByQueries(graph))).toEqual({
      cart: ['cart/add'],
      orderHistory: [],
      productGrid: ['cart/add'],
    });
    expect(graphOptimisticStatusMatrix(graph)).toEqual({
      'cart/add': {
        cart: 'hand-written',
        orderHistory: 'no-invalidation',
        productGrid: 'await-fragment',
      },
      'order/receipt': {
        cart: 'no-invalidation',
        orderHistory: 'no-invalidation',
        productGrid: 'no-invalidation',
      },
    });
  });

  it('projects stable graph behavior summaries for monolith and commerce tests', () => {
    expect(graphComponentTargetFacts(graph)).toEqual([
      { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
      { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
    ]);
    expect(graphDomainFacts(graph)).toEqual(['attachment', 'cart', 'order', 'product']);
    expect(graphInvalidationFacts(graph)).toEqual({
      'cart/add': ['cart', 'productGrid'],
    });
    expect(graphMutationKeys(graph)).toEqual(['cart/add', 'order/receipt']);
    expect(graphOptimisticFacts(graph)).toEqual([
      { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
      { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    ]);
    expect(graphRouteFacts(graph)).toEqual(['/admin', '/cart']);
    expect(graphTouchGraphKeys(graph)).toEqual(['cart.addItem', 'order.receipt']);
    expect(graphTouchGraphKeys(graph, ['cart.addItem'])).toEqual(['cart.addItem']);
    expect(graphStaticBehaviorFact(graph)).toEqual({
      components: [
        { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
        { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
      ],
      domains: ['attachment', 'cart', 'order', 'product'],
      invalidations: {
        'cart/add': ['cart', 'productGrid'],
      },
      mutations: ['cart/add', 'order/receipt'],
      optimistic: [
        { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
        { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
      ],
      routes: ['/admin', '/cart'],
      touchGraphKeys: ['cart.addItem', 'order.receipt'],
    });
  });

  it('projects generated graph artifact honesty from emit checks and provenance', () => {
    const provenance = {
      entries: {
        'cart.addItem': {
          reads: [],
          touches: [
            {
              domain: 'cart',
              keys: null,
              predicate: undefined,
              sitePath: 'src/app.ts',
              via: 'cart_items',
            },
          ],
          unresolved: [],
        },
      },
      siteSummary: {
        count: 1,
        linesArePositive: true,
        paths: ['src/app.ts'],
      },
      sourceLineMismatches: [],
      unresolvedMutations: [],
    };

    expect(
      generatedGraphArtifactHonestyFact({
        emitCheck: { stderr: '', stdout: '' },
        graph,
        provenance,
      }),
    ).toEqual({
      emitCheck: {
        clean: true,
        stderr: '',
        stdout: '',
      },
      invalidations: {
        'cart/add': ['cart', 'productGrid'],
      },
      touchGraph: {
        entries: {
          'cart.addItem': {
            reads: [],
            touches: [
              {
                domain: 'cart',
                keys: null,
                predicate: undefined,
                sitePath: 'src/app.ts',
                via: 'cart_items',
              },
            ],
            unresolved: [],
          },
        },
        honesty: {
          entryKeys: ['cart.addItem'],
          sourceLineMismatches: [],
          sourceSites: {
            count: 1,
            linesArePositive: true,
            paths: ['src/app.ts'],
          },
          touchCountsByMutation: {
            'cart.addItem': 1,
          },
          unresolvedMutations: [],
        },
      },
    });
    expect(
      generatedGraphArtifactHonestySummaryFact({
        emitCheck: { stderr: '', stdout: '' },
        graph,
        provenance,
      }),
    ).toEqual({
      emitCheck: {
        clean: true,
      },
      invalidations: {
        'cart/add': ['cart', 'productGrid'],
      },
      touchGraph: {
        entries: {
          'cart.addItem': {
            reads: 0,
            touches: [
              {
                domain: 'cart',
                keys: null,
                sitePath: 'src/app.ts',
                via: 'cart_items',
              },
            ],
            unresolved: 0,
          },
        },
        honesty: {
          entryKeys: ['cart.addItem'],
          sourceLineMismatches: [],
          sourceSites: {
            count: 1,
            linesArePositive: true,
            paths: ['src/app.ts'],
          },
          touchCountsByMutation: {
            'cart.addItem': 1,
          },
          unresolvedMutations: [],
        },
      },
    });
    expect(
      generatedGraphArtifactAcceptanceEvidenceFact(
        generatedGraphArtifactAcceptanceFact({
          artifactGraph: graph,
          authoredGraph: {
            mutations: graph.mutations,
            optimistic: graph.optimistic,
            pages: graph.pages,
            queries: graph.queries,
            touchGraph: graph.touchGraph,
            components: graph.components,
          },
          emitCheck: { stderr: '', stdout: '' },
          fwCheck: {
            exitCode: 0,
            issueCount: 0,
            status: 'ok',
            version: 'fw-check/v1',
          },
          provenance,
        }),
      ),
    ).toEqual({
      authoredGraphMatchesArtifact: true,
      emitCheck: {
        clean: true,
      },
      fwCheck: {
        exitCode: 0,
        issueCount: 0,
        status: 'ok',
        version: 'fw-check/v1',
      },
      invalidations: {
        'cart/add': ['cart', 'productGrid'],
      },
      staticBehavior: {
        components: [
          { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
          { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
        ],
        domains: ['attachment', 'cart', 'order', 'product'],
        invalidations: {
          'cart/add': ['cart', 'productGrid'],
        },
        mutations: ['cart/add', 'order/receipt'],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
        ],
        routes: ['/admin', '/cart'],
        touchGraphKeys: ['cart.addItem', 'order.receipt'],
      },
      touchGraph: {
        entryKeys: ['cart.addItem'],
        sourceLineMismatches: [],
        sourceSites: {
          count: 1,
          linesArePositive: true,
          paths: ['src/app.ts'],
        },
        touchCountsByMutation: {
          'cart.addItem': 1,
        },
        touchesByMutation: {
          'cart.addItem': [
            {
              domain: 'cart',
              keys: null,
              sitePath: 'src/app.ts',
              via: 'cart_items',
            },
          ],
        },
        unresolvedMutations: [],
      },
    });
    expect(
      generatedGraphArtifactAcceptanceChecklistFact(
        generatedGraphArtifactAcceptanceFact({
          artifactGraph: graph,
          authoredGraph: {
            mutations: graph.mutations,
            optimistic: graph.optimistic,
            pages: graph.pages,
            queries: graph.queries,
            touchGraph: graph.touchGraph,
            components: graph.components,
          },
          emitCheck: { stderr: '', stdout: '' },
          fwCheck: {
            exitCode: 0,
            issueCount: 0,
            status: 'ok',
            version: 'fw-check/v1',
          },
          provenance,
        }),
      ),
    ).toEqual({
      authoredGraphMatchesArtifact: true,
      emitCheckClean: true,
      fwCheckOk: true,
      invalidationKeys: ['cart/add'],
      staticBehavior: {
        components: [
          { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
          { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
        ],
        domains: ['attachment', 'cart', 'order', 'product'],
        invalidations: {
          'cart/add': ['cart', 'productGrid'],
        },
        mutations: ['cart/add', 'order/receipt'],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
        ],
        routes: ['/admin', '/cart'],
        touchGraphKeys: ['cart.addItem', 'order.receipt'],
      },
      touchGraph: {
        entryKeys: ['cart.addItem'],
        sourceLineMismatchCount: 0,
        sourceSitePaths: ['src/app.ts'],
        sourceSitesHavePositiveLines: true,
        touchCountsByMutation: {
          'cart.addItem': 1,
        },
        unresolvedMutations: [],
      },
    });
    expect(
      generatedGraphArtifactAcceptanceFact({
        artifactGraph: graph,
        authoredGraph: {
          mutations: graph.mutations,
          optimistic: graph.optimistic,
          pages: graph.pages,
          queries: graph.queries,
          touchGraph: graph.touchGraph,
          components: graph.components,
        },
        emitCheck: { stderr: '', stdout: '' },
        fwCheck: {
          exitCode: 0,
          issueCount: 0,
          status: 'ok',
          version: 'fw-check/v1',
        },
        provenance,
      }),
    ).toEqual({
      authoredGraphMatchesArtifact: true,
      fwCheck: {
        exitCode: 0,
        issueCount: 0,
        status: 'ok',
        version: 'fw-check/v1',
      },
      staticBehavior: {
        components: [
          { fragments: ['cart-badge'], name: 'CartBadge', queries: ['cart'] },
          { fragments: ['product-grid'], name: 'ProductGrid', queries: ['productGrid'] },
        ],
        domains: ['attachment', 'cart', 'order', 'product'],
        invalidations: {
          'cart/add': ['cart', 'productGrid'],
        },
        mutations: ['cart/add', 'order/receipt'],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
        ],
        routes: ['/admin', '/cart'],
        touchGraphKeys: ['cart.addItem', 'order.receipt'],
      },
      summary: {
        emitCheck: {
          clean: true,
        },
        invalidations: {
          'cart/add': ['cart', 'productGrid'],
        },
        touchGraph: {
          entries: {
            'cart.addItem': {
              reads: 0,
              touches: [
                {
                  domain: 'cart',
                  keys: null,
                  sitePath: 'src/app.ts',
                  via: 'cart_items',
                },
              ],
              unresolved: 0,
            },
          },
          honesty: {
            entryKeys: ['cart.addItem'],
            sourceLineMismatches: [],
            sourceSites: {
              count: 1,
              linesArePositive: true,
              paths: ['src/app.ts'],
            },
            touchCountsByMutation: {
              'cart.addItem': 1,
            },
            unresolvedMutations: [],
          },
        },
      },
    });
    expect(
      generatedGraphArtifactAcceptanceFact({
        artifactGraph: graph,
        authoredGraph: { ...graph, pages: [] },
        emitCheck: { stderr: '', stdout: '' },
        fwCheck: {
          exitCode: 0,
          issueCount: 0,
          status: 'ok',
          version: 'fw-check/v1',
        },
        provenance,
      }).authoredGraphMatchesArtifact,
    ).toBe(false);
  });

  it('loads checked-in graph artifacts through the graph fixture seam', async () => {
    await expect(
      graphFixtureFile(process.cwd(), 'examples/commerce/src/generated/graph.json'),
    ).resolves.toMatchObject({
      pages: expect.arrayContaining([expect.objectContaining({ route: '/cart' })]),
      queries: expect.arrayContaining([expect.objectContaining({ query: 'cart' })]),
    });
  });

  it('fails loudly when required graph facts are absent', () => {
    expect(() => graphPageFact(graph, '/missing')).toThrow('Graph includes page route /missing');
    expect(() => graphMutationFact(graph, 'missing')).toThrow('Graph includes mutation missing');
    expect(() => graphFragmentTargetForQuery(graph, 'orderHistory')).toThrow(
      'Graph includes a fragment target for query orderHistory',
    );
  });
});

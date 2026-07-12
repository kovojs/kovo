import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { registerGeneratedMutationTouchRegistry } from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { mutation } from './mutation.js';
import {
  mutationWithRuntimeRegistryFacts,
  runtimeLiveTargetQueryBindings,
  runtimeRegistryFacts,
} from './registry-facts.js';
import {
  runtimeRegistryWireFactsFromGraph,
  serializeRuntimeRegistryWireModule,
} from './internal/runtime-registry-wire.js';
import { query } from './query.js';
import { s } from './schema.js';

describe('runtimeRegistryFacts', () => {
  it('resolves live-target query facts without mutable Array find/map/flatMap dispatch', () => {
    const publicQuery = query('registryFactsPublic', {
      load: () => ({ public: true }),
      reads: [],
    });
    const protectedQuery = query('registryFactsProtected', {
      guard: () => false,
      load: () => ({ protected: true }),
      reads: [],
    });
    const facts = { liveTargetRenderers: [], queries: [publicQuery, protectedQuery] };
    const renderer = {
      component: 'components/registry-facts/protected',
      queries: ['registryFactsProtected'],
      render: () => '<protected-panel></protected-panel>',
    };
    const definitionRenderer = {
      component: 'components/registry-facts/protected-definition',
      queryDefinitions: [protectedQuery],
      render: () => '<protected-definition></protected-definition>',
    };
    const originalFind = Array.prototype.find;
    const originalFlatMap = Array.prototype.flatMap;
    const originalMap = Array.prototype.map;
    Array.prototype.find = function (predicate, thisArg) {
      if (this === facts.queries) return publicQuery;
      return originalFind.call(this, predicate, thisArg);
    } as typeof Array.prototype.find;
    Array.prototype.flatMap = function (callback, thisArg) {
      if (this === renderer.queries) return [{ query: publicQuery }];
      return originalFlatMap.call(this, callback, thisArg);
    } as typeof Array.prototype.flatMap;
    Array.prototype.map = function (callback, thisArg) {
      if (this === definitionRenderer.queryDefinitions) return [{ query: publicQuery }];
      return originalMap.call(this, callback, thisArg);
    } as typeof Array.prototype.map;
    try {
      expect(runtimeLiveTargetQueryBindings(renderer, facts)).toEqual([{ query: protectedQuery }]);
      expect(runtimeLiveTargetQueryBindings(definitionRenderer, facts)).toEqual([
        { query: protectedQuery },
      ]);
    } finally {
      Array.prototype.find = originalFind;
      Array.prototype.flatMap = originalFlatMap;
      Array.prototype.map = originalMap;
    }
  });

  it('constructs live-target and mutation facts through dense own traversal', () => {
    const catalogQuery = query('registryFactsDenseCatalog', {
      load: () => ({ rows: [] as string[] }),
      reads: [],
    });
    const renderers = [
      {
        component: 'components/registry-facts/dense-catalog',
        queryDefinitions: [catalogQuery],
        render: () => '<dense-catalog></dense-catalog>',
      },
    ];
    const mutations = [
      mutation('registry-facts/dense-write', {
        csrf: false,
        handler: (input) => input,
        input: s.object({ value: s.string() }),
      }),
    ];
    const originalFlatMap = Array.prototype.flatMap;
    const originalMap = Array.prototype.map;
    Array.prototype.flatMap = function (callback, thisArg) {
      if (this === renderers) return [];
      return originalFlatMap.call(this, callback, thisArg);
    } as typeof Array.prototype.flatMap;
    Array.prototype.map = function (callback, thisArg) {
      if (this === mutations) return [];
      return originalMap.call(this, callback, thisArg);
    } as typeof Array.prototype.map;
    try {
      const facts = runtimeRegistryFacts({
        liveTargetRenderers: renderers,
        mutations,
        queries: [],
      });
      expect(facts.queries).toEqual([catalogQuery]);
      expect(facts.mutations).toHaveLength(1);
      expect(facts.mutations[0]?.key).toBe('registry-facts/dense-write');
    } finally {
      Array.prototype.flatMap = originalFlatMap;
      Array.prototype.map = originalMap;
    }
  });

  it('folds generated query reads into app and live-target queries once', () => {
    const fallback = domain('registry-facts-fallback');
    const catalogQuery = query('registryFactsCatalog', {
      load: () => ({ rows: [] as string[] }),
      reads: [fallback],
    });
    registerGeneratedQueryReadRegistry([
      { domains: ['registry-facts-catalog'], query: 'registryFactsCatalog' },
    ]);

    const facts = runtimeRegistryFacts({
      liveTargetRenderers: [
        {
          component: 'components/registry-facts/catalog',
          queryDefinitions: [catalogQuery],
          queries: ['registryFactsCatalog'],
          render: () => '<catalog-panel></catalog-panel>',
        },
      ],
      mutations: [],
      queries: [catalogQuery],
    });

    expect(facts.queries).toHaveLength(1);
    expect(facts.queries[0]?.reads?.map((read) => read.key).sort()).toEqual([
      'registry-facts-catalog',
      'registry-facts-fallback',
    ]);
  });

  it('merges same-load query facts when generated live targets carry a read superset', () => {
    const declared = domain('registry-facts-declared-read');
    const generated = domain('registry-facts-generated-read');
    const scoreQuery = query('registryFactsScore', {
      load: () => ({ score: 1 }),
      reads: [declared],
    });

    const facts = runtimeRegistryFacts({
      liveTargetRenderers: [
        {
          component: 'components/registry-facts/score-card',
          queryDefinitions: [{ ...scoreQuery, reads: [declared, generated] }],
          queries: ['registryFactsScore'],
          render: () => '<score-card></score-card>',
        },
      ],
      mutations: [],
      queries: [scoreQuery],
    });

    expect(facts.queries).toHaveLength(1);
    expect(facts.queries[0]?.reads?.map((read) => read.key).sort()).toEqual([
      'registry-facts-declared-read',
      'registry-facts-generated-read',
    ]);
  });

  it('rejects conflicting duplicate app query keys but preserves mutation query instances', () => {
    const product = domain('registry-facts-product');
    const productP1 = query('registryFactsProduct', {
      instanceKey: 'registry-facts-product:p1',
      load: () => ({ id: 'p1' }),
      reads: [product],
    });
    const productP2 = query('registryFactsProduct', {
      instanceKey: 'registry-facts-product:p2',
      load: () => ({ id: 'p2' }),
      reads: [product],
    });
    const conflictingProduct = query('registryFactsProduct', {
      load: () => ({ id: 'other' }),
      reads: [product],
    });

    expect(() =>
      runtimeRegistryFacts({
        liveTargetRenderers: [],
        mutations: [],
        queries: [productP1, conflictingProduct],
      }),
    ).toThrow(/two queries with the same key "registryFactsProduct"/);

    registerGeneratedMutationTouchRegistry({
      'registry-facts/reserve': [{ domain: 'registry-facts-product', keys: 'arg:id' }],
    });
    const reserve = mutation('registry-facts/reserve', {
      input: s.object({ id: s.string() }),
      registry: { queries: [productP1, productP2] },
      handler: (input) => input,
    });

    const normalized = mutationWithRuntimeRegistryFacts(reserve, {
      liveTargetRenderers: [],
      queries: [],
    });

    expect(normalized.registry?.queries?.map((candidate) => candidate.instanceKey)).toEqual([
      'registry-facts-product:p1',
      'registry-facts-product:p2',
    ]);
    expect(normalized.registry?.inferredTouches).toEqual([
      { domain: 'registry-facts-product', keys: 'arg:id' },
    ]);
  });

  it('serializes dev/prod runtime registry facts through one wire projection', () => {
    const graph = {
      queries: [
        { domains: ['contact', 'account'], query: 'queries/contact-detail-query' },
        { domains: [], query: 'queries/empty-query' },
      ],
      touchGraph: {
        'mutations/update-contact': {
          touches: [
            { domain: 'contact', keys: 'arg:id' },
            { domain: 'contact', keys: 'arg:id' },
            { crossTable: true as const, domain: 'account', keys: null },
          ],
        },
      },
    };

    const facts = runtimeRegistryWireFactsFromGraph(graph);

    expect(facts).toEqual({
      mutationTouches: {
        'mutations/update-contact': [
          { crossTable: true, domain: 'account', keys: null },
          { domain: 'contact', keys: 'arg:id' },
        ],
      },
      queryReads: [{ domains: ['account', 'contact'], query: 'queries/contact-detail-query' }],
    });
    expect(serializeRuntimeRegistryWireModule(facts)).toContain(
      'registerGeneratedQueryReadRegistry([{"domains":["account","contact"],"query":"queries/contact-detail-query"}]);',
    );
  });
});

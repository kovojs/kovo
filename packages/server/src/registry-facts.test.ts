import { describe, expect, it } from 'vitest';

import { domain } from './domain.js';
import { registerGeneratedMutationTouchRegistry } from './generated-mutation-registry.js';
import { registerGeneratedQueryReadRegistry } from './generated-query-registry.js';
import { mutation } from './mutation.js';
import { mutationWithRuntimeRegistryFacts, runtimeRegistryFacts } from './registry-facts.js';
import {
  runtimeRegistryWireFactsFromGraph,
  serializeRuntimeRegistryWireModule,
} from './internal/runtime-registry-wire.js';
import { query } from './query.js';
import { s } from './schema.js';

describe('runtimeRegistryFacts', () => {
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

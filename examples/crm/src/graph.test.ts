import '../../../tests/example-generated-graphs.setup.js';

import type { KovoExplainInput } from '@kovojs/core/internal/graph';
import { kovoCheck, kovoExplain } from '@kovojs/cli';
import { describe, expect, it } from 'vitest';

import { createCrmGraph } from './graph.js';

const graph = createCrmGraph(
  {
    addContact: touch('contact'),
    closeDeal: touch('deal'),
    createDeal: touch('contact', 'deal'),
    moveDeal: touch('deal'),
  },
  [
    optimistic('createDeal', 'contactDealCount', 'hand-written'),
    optimistic('createDeal', 'contactList', 'hand-written'),
    optimistic('createDeal', 'dealList', 'hand-written'),
    optimistic('createDeal', 'openDeals', 'hand-written'),
    optimistic('createDeal', 'pipelineByStage', 'hand-written'),
    optimistic('addContact', 'contactDealCount', 'await-fragment'),
    optimistic('addContact', 'contactList', 'await-fragment'),
    optimistic('closeDeal', 'dealList', 'await-fragment'),
    optimistic('closeDeal', 'openDeals', 'await-fragment'),
    optimistic('closeDeal', 'pipelineByStage', 'await-fragment'),
    optimistic('moveDeal', 'dealList', 'await-fragment'),
    optimistic('moveDeal', 'openDeals', 'await-fragment'),
    optimistic('moveDeal', 'pipelineByStage', 'await-fragment'),
  ],
  [
    { domains: ['contact'], query: 'contactDealCount' },
    { domains: ['contact'], query: 'contactList' },
    { domains: ['deal'], query: 'dealList' },
    { domains: ['deal'], query: 'openDeals' },
    { domains: ['deal'], query: 'pipelineByStage' },
  ],
) as KovoExplainInput;

describe('CRM generated graph', () => {
  it('passes kovo check', () => {
    const result = kovoCheck(graph);
    expect(result.exitCode).toBe(0);
  });

  it('keeps the intentional optimistic mix visible', () => {
    expect(statusesFor('createDeal')).toEqual({
      contactDealCount: 'hand-written',
      contactList: 'hand-written',
      dealList: 'hand-written',
      openDeals: 'hand-written',
      pipelineByStage: 'hand-written',
    });
    expect(statusesFor('moveDeal')).toMatchObject({
      openDeals: 'await-fragment',
      pipelineByStage: 'await-fragment',
    });

    const moveExplain = kovoExplain(graph, {
      kind: 'mutation',
      optimistic: true,
      target: 'moveDeal',
    });
    expect(moveExplain.output).toContain('OPTIMISTIC openDeals await-fragment');
    expect(moveExplain.output).toContain('OPTIMISTIC pipelineByStage await-fragment');
  });
});

function statusesFor(mutation: string): Record<string, string> {
  return Object.fromEntries(
    (graph.optimistic ?? [])
      .filter((entry) => entry.mutation === mutation)
      .map((entry) => [entry.query, entry.status]),
  );
}

function optimistic(mutation: string, query: string, status: 'await-fragment' | 'hand-written') {
  return { mutation, query, status };
}

function touch(...domains: string[]) {
  return {
    reads: [],
    touches: domains.map((domain) => ({
      domain,
      keys: null,
      site: `examples/crm/src/mutations.ts:1`,
      via: domain,
    })),
    unresolved: [],
  };
}

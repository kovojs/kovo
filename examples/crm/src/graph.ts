import type { KovoExplainInput, OptimisticCoverage, TouchGraph } from '@kovojs/core/internal/graph';

// Static graph declarations for the CRM demo. Tests provide source-owned touch
// graph and optimistic coverage fixtures without committing generated artifacts.
interface InvalidationQueryInput {
  domains: readonly string[];
  query: string;
}

export function crmGraphDeclarations(queries: readonly InvalidationQueryInput[]) {
  return {
    mutations: [
      {
        guards: ['authed'],
        inputFields: ['id', 'name', 'email'],
        invalidates: ['contact'],
        key: 'addContact',
        session: 'crmSession',
        writes: ['contact'],
      },
      {
        guards: ['authed'],
        inputFields: ['id', 'contactId', 'stage', 'amount'],
        invalidates: ['contact', 'deal'],
        key: 'createDeal',
        session: 'crmSession',
        writes: ['contact', 'deal'],
      },
      {
        guards: ['authed'],
        inputFields: ['dealId', 'stage'],
        invalidates: ['deal'],
        key: 'moveDeal',
        session: 'crmSession',
        writes: ['deal'],
      },
      {
        guards: ['authed'],
        inputFields: ['dealId'],
        invalidates: ['deal'],
        key: 'closeDeal',
        session: 'crmSession',
        writes: ['deal'],
      },
    ],
    queries,
  } satisfies Omit<KovoExplainInput, 'touchGraph' | 'optimistic'>;
}

export function createCrmGraph(
  touchGraph: TouchGraph,
  optimistic: readonly OptimisticCoverage[],
  queries: readonly InvalidationQueryInput[],
) {
  const graph = {
    ...crmGraphDeclarations(queries),
    optimistic: [...optimistic],
    touchGraph,
  };

  return graph satisfies KovoExplainInput;
}

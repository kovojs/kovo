import type {
  AccessExplainFact,
  KovoExplainInput,
  OptimisticCoverage,
  TouchGraph,
} from '@kovojs/core/internal/graph';

// Static graph declarations for the CRM demo. scripts/emit-graph.mjs adds the
// extracted touch graph and optimistic coverage from the source files.
interface InvalidationQueryInput {
  domains: readonly string[];
  query: string;
}

const CRM_ACCESS_FACTS = [
  ...['addContact', 'createDeal', 'moveDeal', 'closeDeal'].map(
    (name) =>
      ({
        decision: 'guard',
        detail: 'access=guard-chain guards=authed',
        kind: 'mutation',
        name,
        source: 'access',
      }) satisfies AccessExplainFact,
  ),
  ...[
    { justification: 'public CRM demo contact list', name: 'contactList' },
    { justification: 'public CRM demo pipeline list', name: 'dealList' },
    { justification: 'public CRM demo deal count', name: 'contactDealCount' },
    { justification: 'public CRM demo open-deal list', name: 'openDeals' },
    { justification: 'public CRM demo pipeline summary', name: 'pipelineByStage' },
    { justification: 'public CRM demo activity timeline', name: 'activityList' },
  ].map(
    ({ justification, name }) =>
      ({
        decision: 'public',
        detail: 'access=public',
        justification,
        kind: 'query',
        name,
        source: 'access',
      }) satisfies AccessExplainFact,
  ),
] satisfies AccessExplainFact[];

export function crmGraphDeclarations(queries: readonly InvalidationQueryInput[]) {
  return {
    access: CRM_ACCESS_FACTS,
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

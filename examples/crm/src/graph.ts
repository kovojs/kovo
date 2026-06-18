import type { KovoExplainInput, OptimisticCoverage, TouchGraph } from '@kovojs/core/internal/graph';
import type { InvalidationQueryInput } from '@kovojs/drizzle/static';

// SPEC.md §10.2/§10.5/§11.2: the CRM graph facts. The static declarations
// (mutations, queries, endpoints) are authored once; the touch graph and the
// optimistic[] coverage matrix are produced by scripts/emit-graph.mjs from the
// real Drizzle source and passed in here. The optimistic[] matrix is the MIX:
// `derived` pairs carry `derivation:{status:'derived'}`, hand-written pairs carry
// `status:'hand-written'`, await-fragment pairs `status:'await-fragment'`, and the
// punted-but-overridden pairs carry the named PUNTED derivation reason that
// `kovo explain --optimistic` renders inline. Every invalidated pair is covered, so
// `kovo check` reports zero unhandled KV310.

export function crmGraphDeclarations(queries: readonly InvalidationQueryInput[]) {
  return {
    mutations: [
      {
        guards: ['authed'],
        inputFields: ['id', 'name', 'email', 'ownerId'],
        invalidates: ['contact'],
        key: 'addContact',
        session: 'crmSession',
        writes: ['contact'],
      },
      {
        guards: ['authed'],
        inputFields: ['id', 'contactId', 'stage', 'amount', 'ownerId'],
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

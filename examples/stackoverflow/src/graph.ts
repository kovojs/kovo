import type { KovoExplainInput, TouchGraph } from '@kovojs/core';

// SPEC.md §10.2 / §11.2: the Stack Overflow graph facts consumed by `kovo check`
// and `kovo explain`. The optimistic[] coverage is entirely compiler-DERIVED
// (generated/optimistic/*.ts): every (mutation × invalidated-query) pair carries
// status 'derived' with derivation metadata { status: 'derived' } — zero
// UNHANDLED (KV310), zero punts. The touchGraph is EXTRACTED from src by
// scripts/emit-graph.mjs (extractTouchGraphFromProject), not hand-authored.

// SPEC.md §10.5: each pair is proven derivable by deriveOptimistic (see the
// commuting-diagram suite) — postQuestion×questionList push-row, postAnswer
// guarded update-row + push-row, voteUp guarded update-row + scalar inc.
const DERIVED_OPTIMISTIC = [
  { mutation: 'postQuestion', query: 'questionList' },
  { mutation: 'postAnswer', query: 'answerList' },
  { mutation: 'postAnswer', query: 'questionList' },
  { mutation: 'voteUp', query: 'questionList' },
  { mutation: 'voteUp', query: 'questionScore' },
] as const;

export function soGraphDeclarations() {
  return {
    mutations: [
      {
        guards: ['authed'],
        invalidates: ['question'],
        inputFields: ['id', 'title', 'body', 'authorId'],
        key: 'postQuestion',
        session: 'soSession',
        writes: ['question'],
      },
      {
        guards: ['authed'],
        invalidates: ['answer', 'question'],
        inputFields: ['id', 'questionId', 'body', 'authorId'],
        key: 'postAnswer',
        session: 'soSession',
        writes: ['answer', 'question'],
      },
      {
        guards: ['authed'],
        invalidates: ['vote', 'question'],
        inputFields: ['id', 'targetId', 'userId'],
        key: 'voteUp',
        session: 'soSession',
        writes: ['vote', 'question'],
      },
    ],
    optimistic: DERIVED_OPTIMISTIC.map((pair) => ({
      derivation: { status: 'derived' as const },
      mutation: pair.mutation,
      query: pair.query,
      status: 'derived' as const,
    })),
    queries: [
      { domains: ['question'], query: 'questionList' },
      { domains: ['answer'], query: 'answerList' },
      { domains: ['vote'], query: 'questionScore' },
    ],
  } satisfies Omit<KovoExplainInput, 'touchGraph'>;
}

export function createSoGraph(touchGraph: TouchGraph) {
  const graph = {
    ...soGraphDeclarations(),
    touchGraph,
  };

  return graph satisfies KovoExplainInput;
}

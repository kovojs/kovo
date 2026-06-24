import type { KovoExplainInput, TouchGraph } from '@kovojs/core/internal/graph';

// Demo graph facts consumed by `kovo check`. Collection queries use generated
// optimistic updates; detail queries wait for the refreshed server fragment.
interface InvalidationQueryInput {
  domains: readonly string[];
  query: string;
}

const DERIVED_OPTIMISTIC = [
  { mutation: 'postQuestion', query: 'questionList' },
  { mutation: 'postAnswer', query: 'answerList' },
  { mutation: 'postAnswer', query: 'questionList' },
  { mutation: 'voteUp', query: 'questionList' },
  { mutation: 'voteUp', query: 'questionScore' },
] as const;

const AWAIT_FRAGMENT_OPTIMISTIC = [
  { mutation: 'postQuestion', query: 'questionDetail' },
  { mutation: 'postQuestion', query: 'questionScore' },
  { mutation: 'postAnswer', query: 'questionAnswers' },
  { mutation: 'postAnswer', query: 'questionDetail' },
  { mutation: 'postAnswer', query: 'questionScore' },
  { mutation: 'voteUp', query: 'questionDetail' },
] as const;

export function soGraphDeclarations(queries: readonly InvalidationQueryInput[]) {
  return {
    mutations: [
      {
        guards: ['authed'],
        invalidates: ['question'],
        inputFields: ['id', 'title', 'body'],
        key: 'postQuestion',
        session: 'soSession',
        writes: ['question'],
      },
      {
        guards: ['authed'],
        invalidates: ['answer', 'question'],
        inputFields: ['id', 'questionId', 'body'],
        key: 'postAnswer',
        session: 'soSession',
        writes: ['answer', 'question'],
      },
      {
        guards: ['authed'],
        invalidates: ['vote', 'question'],
        inputFields: ['id', 'targetId'],
        key: 'voteUp',
        session: 'soSession',
        writes: ['vote', 'question'],
      },
    ],
    optimistic: [
      ...DERIVED_OPTIMISTIC.map((pair) => ({
        derivation: { status: 'derived' as const },
        mutation: pair.mutation,
        query: pair.query,
        status: 'derived' as const,
      })),
      ...AWAIT_FRAGMENT_OPTIMISTIC.map((pair) => ({
        mutation: pair.mutation,
        query: pair.query,
        status: 'await-fragment' as const,
      })),
    ],
    queries,
  } satisfies Omit<KovoExplainInput, 'touchGraph'>;
}

export function createSoGraph(touchGraph: TouchGraph, queries: readonly InvalidationQueryInput[]) {
  const graph = {
    ...soGraphDeclarations(queries),
    touchGraph,
  };

  return graph satisfies KovoExplainInput;
}

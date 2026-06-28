import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  exampleOptimisticDerivationFacts,
  type ExampleOptimisticDerivationFact,
} from '../../drizzle-registry-runtime.js';

// SPEC.md §10.5/§10.6 (capability-gaps §1) — end-to-end proof that the §10.5 deriver runs over the
// REAL StackOverflow source: the Stage-1 write→effect extractor + Stage-2 query→shape classifier +
// Stage-3 deriver decide, per (mutation × invalidated query) pair, whether the optimistic transform
// is COMPILER-DERIVED (folded into `OptimisticDerivationSets`, so the author omits it) or stays
// hand-written / `'await-fragment'` with a NAMED punt reason (coverage is never silently dropped).

const sourceRoot = dirname(fileURLToPath(import.meta.url));
let cachedFacts: ExampleOptimisticDerivationFact[] | undefined;

function facts(): ExampleOptimisticDerivationFact[] {
  cachedFacts ??= exampleOptimisticDerivationFacts({
    mutationTouchGraphKeys: {
      'mutations/post-answer-mutation': 'postAnswer',
      'mutations/post-question-mutation': 'postQuestion',
      'mutations/vote-up-mutation': 'voteUp',
    },
    queries: [
      { query: 'queries/question-list', exportName: 'questionList', domains: ['model/question'] },
      { query: 'queries/answer-list', exportName: 'answerList', domains: ['model/answer'] },
      {
        query: 'queries/question-detail',
        exportName: 'questionDetail',
        domains: ['model/question'],
      },
      {
        query: 'queries/question-answers',
        exportName: 'questionAnswers',
        domains: ['model/answer'],
      },
      { query: 'queries/question-score', exportName: 'questionScore', domains: ['model/vote'] },
    ],
    queryModule: '../queries.js',
    sourceRoot,
  });
  return cachedFacts;
}

function factFor(
  all: readonly ExampleOptimisticDerivationFact[],
  mutation: string,
  query: string,
): ExampleOptimisticDerivationFact | undefined {
  return all.find((fact) => fact.mutation === mutation && fact.query === query);
}

describe('voteUp optimistic derivation (SPEC §10.5)', () => {
  it('COMPILER-DERIVES questionScore (INSERT × SUM) and questionList (UPDATE × AGG)', () => {
    const all = facts();
    expect(factFor(all, 'mutations/vote-up-mutation', 'queries/question-score')?.status).toBe(
      'derived',
    );
    expect(factFor(all, 'mutations/vote-up-mutation', 'queries/question-list')?.status).toBe(
      'derived',
    );
  }, 120_000);

  it('NAMES the questionDetail punt (keyed whole-row return) instead of silently dropping it', () => {
    const all = facts();
    const detail = factFor(all, 'mutations/vote-up-mutation', 'queries/question-detail');
    expect(detail?.status).toBe('hand-written');
    // The punt is named with its reason for `kovo explain --optimistic` (§10.5/§10.6).
    expect(detail?.reason).toMatch(/no in-grammar §10\.5 query shape/);
  });
});

import '../../../tests/example-generated-graphs.setup.js';

import type { KovoExplainInput } from '@kovojs/core/internal/graph';
import { kovoCheck } from '@kovojs/cli';
import { describe, expect, it } from 'vitest';

import { createSoGraph } from './graph.js';

const soGraph = createSoGraph(
  {
    postAnswer: touch('answer', 'question'),
    postQuestion: touch('question'),
    voteUp: touch('vote', 'question'),
  },
  [
    { domains: ['question'], query: 'questionList' },
    { domains: ['answer'], query: 'answerList' },
    { domains: ['question'], query: 'questionDetail' },
    { domains: ['answer'], query: 'questionAnswers' },
    { domains: ['vote', 'question'], query: 'questionScore' },
  ],
) as KovoExplainInput;

describe('stackoverflow graph', () => {
  it('connects the demo mutations to the queries they refresh', () => {
    expect((soGraph.mutations ?? []).map((mutation) => mutation.key)).toEqual([
      'postQuestion',
      'postAnswer',
      'voteUp',
    ]);
    expect((soGraph.queries ?? []).map((query) => query.query)).toEqual([
      'questionList',
      'answerList',
      'questionDetail',
      'questionAnswers',
      'questionScore',
    ]);

    const result = kovoCheck(soGraph);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('kovo-check/v1\nOK\n');
  });
});

function touch(...domains: string[]) {
  return {
    reads: [],
    touches: domains.map((domain) => ({
      domain,
      keys: null,
      site: `examples/stackoverflow/src/mutations.ts:1`,
      via: domain,
    })),
    unresolved: [],
  };
}

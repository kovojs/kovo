import { kovoCheck } from '@kovojs/cli';
import { describe, expect, it } from 'vitest';

import { createSoGraph } from './graph.js';
import { soQueryDomains, soTouchGraph } from './generated/touch-graph.js';

describe('stackoverflow graph', () => {
  it('connects the demo mutations to the queries they refresh', () => {
    const soGraph = createSoGraph(soTouchGraph, soQueryDomains);

    expect(soGraph.mutations.map((mutation) => mutation.key)).toEqual([
      'postQuestion',
      'postAnswer',
      'voteUp',
    ]);
    expect(soGraph.queries.map((query) => query.query)).toEqual([
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

import { kovoCheckOkAssertionFact } from '@kovojs/conformance-fixtures/kovo-check-fixtures';
import { kovoExplainMutationAssertionFact } from '@kovojs/conformance-fixtures/kovo-explain-fixtures';
import { kovoCheck, kovoExplain } from 'kovo';
import { describe, expect, it } from 'vitest';

import { soGraph } from './app.js';

// SPEC.md §10.4/§10.5 and rules/v1-acceptance.md: the static graph proves every
// mutation × invalidated query pair is covered. Algebraic collection queries are
// compiler-derived; prop-backed detail queries intentionally await the server
// fragment. `kovo check` remains OK: zero KV310, zero PUNTED, zero UNHANDLED.

describe('stackoverflow kovo graph acceptance', () => {
  it('kovo check is OK with zero optimistic-coverage gaps (no KV310)', () => {
    const result = kovoCheck(soGraph);
    expect(kovoCheckOkAssertionFact(result)).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'kovo-check/v1',
    });
    expect(result.output).not.toContain('KV310');
  });

  it('kovo explain reports covered optimism for postQuestion', () => {
    const fact = kovoExplainMutationAssertionFact(
      kovoExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'postQuestion' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({
      questionDetail: 'await-fragment',
      questionList: 'derived',
    });
    expect(fact.optimisticSummary).toMatchObject({
      'await-fragment': '1',
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '1',
      'hand-written': '0',
      total: '2',
    });
  });

  it('kovo explain reports covered optimism for postAnswer', () => {
    const fact = kovoExplainMutationAssertionFact(
      kovoExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'postAnswer' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({
      answerList: 'derived',
      questionAnswers: 'await-fragment',
      questionDetail: 'await-fragment',
      questionList: 'derived',
    });
    expect(fact.optimisticSummary).toMatchObject({
      'await-fragment': '2',
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '2',
      total: '4',
    });
  });

  it('kovo explain reports covered optimism for voteUp', () => {
    const fact = kovoExplainMutationAssertionFact(
      kovoExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'voteUp' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({
      questionDetail: 'await-fragment',
      questionList: 'derived',
      questionScore: 'derived',
    });
    expect(fact.optimisticSummary).toMatchObject({
      'await-fragment': '1',
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '2',
      total: '3',
    });
  });
});

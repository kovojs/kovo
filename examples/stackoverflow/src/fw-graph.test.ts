import { fwCheckOkAssertionFact } from '@jiso/test/fw-check-fixtures';
import { fwExplainMutationAssertionFact } from '@jiso/test/fw-explain-fixtures';
import { fwCheck, fwExplain } from 'fw';
import { describe, expect, it } from 'vitest';

import { soGraph } from './app.js';

// SPEC.md §10.4/§10.5/§16.5: the static graph proves every (mutation × invalidated
// query) pair is compiler-DERIVED. `fw check` is OK (zero FW310 — no invalidated
// query lacks an optimistic transform), and `fw explain` reports `derived`
// statuses with zero PUNTED / zero UNHANDLED for each mutation.

describe('stackoverflow fw graph acceptance', () => {
  it('fw check is OK with zero optimistic-coverage gaps (no FW310)', () => {
    const result = fwCheck(soGraph);
    expect(fwCheckOkAssertionFact(result)).toEqual({
      exitCode: 0,
      issueCount: 0,
      status: 'ok',
      version: 'fw-check/v1',
    });
    expect(result.output).not.toContain('FW310');
  });

  it('fw explain reports fully-derived optimism for postQuestion', () => {
    const fact = fwExplainMutationAssertionFact(
      fwExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'postQuestion' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({ questionList: 'derived' });
    expect(fact.optimisticSummary).toMatchObject({
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '1',
      'hand-written': '0',
      total: '1',
    });
  });

  it('fw explain reports fully-derived optimism for postAnswer', () => {
    const fact = fwExplainMutationAssertionFact(
      fwExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'postAnswer' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({
      answerList: 'derived',
      questionList: 'derived',
    });
    expect(fact.optimisticSummary).toMatchObject({
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '2',
      total: '2',
    });
  });

  it('fw explain reports fully-derived optimism for voteUp', () => {
    const fact = fwExplainMutationAssertionFact(
      fwExplain(soGraph, { kind: 'mutation', optimistic: true, target: 'voteUp' }),
    );
    expect(fact.exitCode).toBe(0);
    expect(fact.optimisticStatuses).toEqual({
      questionList: 'derived',
      questionScore: 'derived',
    });
    expect(fact.optimisticSummary).toMatchObject({
      PUNTED: '0',
      UNHANDLED: '0',
      derived: '2',
      total: '2',
    });
  });
});

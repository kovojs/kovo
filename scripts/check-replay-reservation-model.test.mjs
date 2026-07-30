import { describe, expect, it } from 'vitest';

import {
  loadReplayModelInputs,
  normalizeTlcCounterexample,
  replayCounterexampleSchema,
  validateReplayModelContract,
} from './check-replay-reservation-model.mjs';

function inputs() {
  return structuredClone(loadReplayModelInputs());
}

describe('ReplayReservation bounded-model faithfulness gate (Plan 3 §6)', () => {
  it('accepts the exact model, protocol alphabet, source anchors, toolchain, and CI wiring', () => {
    expect(validateReplayModelContract(inputs())).toEqual({ findings: [], ok: true });
  });

  it('rejects a model action omitted from the protocol/action complement', () => {
    const candidate = inputs();
    candidate.modelText = candidate.modelText.replace(
      '\\* @kovo-model-action replay.reserve',
      '\\* replay.reserve marker removed',
    );

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('markers must exactly equal')]),
    );
  });

  it('rejects a positive config that silently enables either historical mutant', () => {
    const candidate = inputs();
    candidate.positiveConfigText = candidate.positiveConfigText
      .replace('AllowPendingEviction = FALSE', 'AllowPendingEviction = TRUE')
      .replace('NaiveWatermark = FALSE', 'NaiveWatermark = TRUE');

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('positive config must set AllowPendingEviction = FALSE'),
        expect.stringContaining('positive config must set NaiveWatermark = FALSE'),
      ]),
    );
  });

  it('rejects collapsing the exact two-replica/two-slot/two-identity bound', () => {
    const candidate = inputs();
    candidate.positiveConfigText = candidate.positiveConfigText.replace(
      'Replica2 = replica_2',
      'Replica2 = replica_1',
    );

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('positive config must set Replica2')]),
    );
  });

  it('requires each broken config to flip exactly its intended historical semantic', () => {
    const candidate = inputs();
    candidate.evictConfigText = candidate.evictConfigText.replace(
      'NaiveWatermark = FALSE',
      'NaiveWatermark = TRUE',
    );
    candidate.naiveConfigText = candidate.naiveConfigText.replace(
      'AllowPendingEviction = FALSE',
      'AllowPendingEviction = TRUE',
    );

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('evict-pending config must set NaiveWatermark = FALSE'),
        expect.stringContaining('naive-watermark config must set AllowPendingEviction = FALSE'),
      ]),
    );
  });

  it('fails closed when the production GREATEST/refusal anchors drift', () => {
    const candidate = inputs();
    candidate.postgresReplayText = candidate.postgresReplayText.replace(
      'SET reclaimed_through = GREATEST(',
      'SET reclaimed_through = LEAST(',
    );
    candidate.replayText = candidate.replayText.replace('REFUSES', 'accepts');

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('GREATEST'),
        expect.stringContaining('refuse-never-evict anchor'),
      ]),
    );
  });

  it('requires exact tool digests, Java builds, and offline CI execution', () => {
    const candidate = inputs();
    candidate.toolchain.tlc.sha256 = 'unpinned';
    candidate.toolchain.java.version = '21';
    candidate.toolchain.java.ciVersion = '21';
    candidate.ciText = candidate.ciText.replace("KOVO_TLA_OFFLINE: '1'", '');

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exact sha256'),
        expect.stringContaining('exact-pinned including its build number'),
        expect.stringContaining('CI selector'),
        expect.stringContaining('tool download disabled'),
      ]),
    );
  });

  it('rejects a committed broken trace whose killing action disappears', () => {
    const candidate = inputs();
    candidate.counterexamples['evict-pending'].actions = [
      'Init',
      'Reserve',
      'Execute',
      'Reserve',
      'Execute',
    ];

    expect(validateReplayModelContract(candidate).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('counterexample identity/action contract')]),
    );
  });

  it('normalizes a TLC diff trace without volatile line numbers or timestamps', () => {
    const output = `
Starting... (volatile)
Error: Invariant NoDoubleExecute is violated.
Error: The behavior up to this point is:
State 1: <Initial predicate>
/\\ executions = (identity_1 :> 0 @@ identity_2 :> 0)

State 2: <Execute line 123, col 1 to line 140, col 2 of module ReplayReservation>
/\\ executions = (identity_1 :> 2 @@ identity_2 :> 0)

42 states generated, 12 distinct states found, 2 states left on queue.
`;
    const normalized = normalizeTlcCounterexample(output, {
      actions: ['Init', 'Execute'],
      invariant: 'NoDoubleExecute',
      variables: ['executions'],
      variant: 'fixture',
    });

    expect(normalized).toEqual({
      schema: replayCounterexampleSchema,
      actions: ['Init', 'Execute'],
      invariant: 'NoDoubleExecute',
      model: 'formal/ReplayReservation.tla',
      states: [
        {
          action: 'Init',
          changes: { executions: '(identity_1 :> 0 @@ identity_2 :> 0)' },
          step: 1,
        },
        {
          action: 'Execute',
          changes: { executions: '(identity_1 :> 2 @@ identity_2 :> 0)' },
          step: 2,
        },
      ],
      variant: 'fixture',
    });
  });
});

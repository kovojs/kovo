import { describe, expect, it } from 'vitest';

import {
  MODEL_CTES,
  MODEL_JOB_STATUSES,
  MODEL_REPLAY_STATES,
  collectProtocolAlphabetFromSources,
  protocolAlphabetSchema,
  renderProtocolAlphabet,
  validateProtocolAlphabet,
} from './check-protocol-alphabet.mjs';

const fixtureSources = Object.freeze({
  'packages/server/src/postgres-replay.ts': `
export type PostgresReplaySurface = 'capability' | 'mutation' | 'webhook';
const statements = {
  reserve: {
    text: 'WITH locked_watermark AS MATERIALIZED (' +
      'SELECT reclaimed_through FROM public._kovo_replay_reclaimed FOR UPDATE) ' +
      "INSERT INTO public._kovo_replay (state) SELECT 'pending' FROM locked_watermark",
  },
  commit: {
    text: "UPDATE public._kovo_replay SET state = 'committed' WHERE state = 'pending'",
  },
};
`,
  'packages/server/src/task-observability.ts': `
export type DurableTaskObservedStatus =
  | 'ready' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled';
export function buildStatusQuery() {
  return { text: 'select status from _kovo_jobs', values: [] };
}
`,
  'packages/server/src/task-queue.ts': `
export type DurableTaskJobStatus =
  | 'ready' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled';
const taskQueueSql = {
  claimDue: \`with claimed as (
    select id from _kovo_jobs where status = 'ready'
  ) update _kovo_jobs set status = 'running' where id in (select id from claimed)\`,
  markFailed: \`update _kovo_jobs
    set status = case when attempts > 2 then 'dead' else 'ready' end
    where status = 'running'\`,
};
`,
});

const fixtureActions = Object.freeze({
  'packages/server/src/postgres-replay.ts#<module>/text[1]': 'replay.reserve',
  'packages/server/src/postgres-replay.ts#<module>/text[2]': 'replay.commit',
  'packages/server/src/task-observability.ts#buildStatusQuery/text[1]': 'jobs.observe',
  'packages/server/src/task-queue.ts#<module>/taskQueueSql.claimDue': 'jobs.claimDue',
  'packages/server/src/task-queue.ts#<module>/taskQueueSql.markFailed': 'jobs.markFailed',
});

function collect(sources = fixtureSources) {
  return collectProtocolAlphabetFromSources(sources);
}

describe('protocol alphabet gate (C13 anchor)', () => {
  it('derives exact protected SQL roots, CTEs, and status vocabularies', () => {
    const observed = collect();

    expect(MODEL_CTES).toEqual(['advanced', 'claimed', 'deleted', 'expired', 'locked_watermark']);
    expect(MODEL_JOB_STATUSES).toEqual([
      'cancelled',
      'dead',
      'failed',
      'ready',
      'running',
      'succeeded',
    ]);
    expect(MODEL_REPLAY_STATES).toEqual(['committed', 'pending']);
    expect(observed.statements.map((statement) => statement.site)).toEqual(
      Object.keys(fixtureActions).sort(),
    );
    expect(observed.ctes).toEqual(['claimed', 'locked_watermark']);
    expect(observed.jobStatuses).toEqual(MODEL_JOB_STATUSES);
    expect(observed.replayStates).toEqual(MODEL_REPLAY_STATES);
  });

  it('accepts only the exact versioned source-derived statement/action relation', () => {
    const observed = collect();
    const artifact = renderProtocolAlphabet(observed, fixtureActions);

    expect(artifact.schema).toBe(protocolAlphabetSchema);
    expect(artifact.summary.statementCount).toBe(5);
    expect(validateProtocolAlphabet({ artifact, observed })).toEqual({ findings: [], ok: true });
  });

  it('fails closed on an added SQL root or stale statement body', () => {
    const observed = collect();
    const artifact = renderProtocolAlphabet(observed, fixtureActions);
    const added = collect({
      ...fixtureSources,
      'packages/server/src/task-observability.ts': `${fixtureSources['packages/server/src/task-observability.ts']}
export const extraSql = "delete from _kovo_jobs where status = 'ready'";
`,
    });
    const changed = collect({
      ...fixtureSources,
      'packages/server/src/task-queue.ts': fixtureSources[
        'packages/server/src/task-queue.ts'
      ].replace('attempts > 2', 'attempts > 3'),
    });

    expect(validateProtocolAlphabet({ artifact, observed: added }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('unclassified protected SQL statement')]),
    );
    expect(validateProtocolAlphabet({ artifact, observed: changed }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('stale sqlSha256')]),
    );
  });

  it('kills a sixth CTE and a new persisted job status', () => {
    const observed = collect();
    const artifact = renderProtocolAlphabet(observed, fixtureActions);
    const sixthCte = collect({
      ...fixtureSources,
      'packages/server/src/task-queue.ts': fixtureSources[
        'packages/server/src/task-queue.ts'
      ].replace('with claimed as (', 'with surprise as (select 1), claimed as ('),
    });
    const newStatus = collect({
      ...fixtureSources,
      'packages/server/src/task-queue.ts': fixtureSources[
        'packages/server/src/task-queue.ts'
      ].replace(
        "| 'ready' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled'",
        "| 'ready' | 'running' | 'succeeded' | 'failed' | 'dead' | 'cancelled' | 'paused'",
      ),
    });

    expect(validateProtocolAlphabet({ artifact, observed: sixthCte }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('CTE alphabet')]),
    );
    expect(validateProtocolAlphabet({ artifact, observed: newStatus }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('DurableTaskJobStatus')]),
    );
  });

  it('rejects an unknown model action and closed-constant drift', () => {
    const observed = collect();
    const artifact = renderProtocolAlphabet(observed, fixtureActions);
    const unknownAction = structuredClone(artifact);
    unknownAction.statements[0].action = 'replay.unreviewed';
    const changedConstants = structuredClone(artifact);
    changedConstants.constants.jobStatuses = changedConstants.constants.jobStatuses.slice(1);

    expect(validateProtocolAlphabet({ artifact: unknownAction, observed }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown model action')]),
    );
    expect(validateProtocolAlphabet({ artifact: changedConstants, observed }).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('job status constants')]),
    );
  });
});

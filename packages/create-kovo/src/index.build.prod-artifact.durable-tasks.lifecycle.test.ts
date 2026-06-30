import { describe, expect, it } from 'vitest';

import {
  expectCountForDuration,
  expectEventuallyCount,
  postScheduleMode,
  sleep,
  taskProofCount,
  uniqueProofId,
  withDurableTaskArtifactServer,
} from './index.build.prod-artifact.durable-tasks.test-support.js';

describe('create-kovo starter (build integration: production durable task lifecycle artifacts)', () => {
  it('runs committed, delayed, cancelled, and replaced durable tasks from the production build artifact', async () => {
    await withDurableTaskArtifactServer(
      {
        name: 'Prod Durable Task Lifecycle Proof',
        tempPrefix: 'create-kovo-prod-durable-tasks-lifecycle-',
      },
      async ({ origin }) => {
        const rollbackId = uniqueProofId('rollback');
        const rollback = await postScheduleMode(origin, rollbackId, 'throw');
        await rollback.text();
        expect(rollback.status).toBe(500);
        await expectCountForDuration(origin, rollbackId, 0, 800);

        const immediateId = uniqueProofId('immediate');
        const immediate = await postScheduleMode(origin, immediateId, 'immediate');
        await immediate.text();
        expect([200, 303]).toContain(immediate.status);
        await expectEventuallyCount(origin, immediateId, 1);
        await sleep(500);
        expect(await taskProofCount(origin, immediateId)).toBe(1);

        const delayedId = uniqueProofId('delayed');
        const delayed = await postScheduleMode(origin, delayedId, 'delay');
        await delayed.text();
        expect([200, 303]).toContain(delayed.status);
        await sleep(350);
        expect(await taskProofCount(origin, delayedId)).toBe(0);
        await expectEventuallyCount(origin, delayedId, 1);

        const cancelledId = uniqueProofId('cancelled');
        const cancelled = await postScheduleMode(origin, cancelledId, 'cancel');
        await cancelled.text();
        expect([200, 303]).toContain(cancelled.status);
        await expectCountForDuration(origin, cancelledId, 0, 900);

        const replacedId = uniqueProofId('replace');
        const replaced = await postScheduleMode(origin, replacedId, 'replace');
        await replaced.text();
        expect([200, 303]).toContain(replaced.status);
        await expectEventuallyCount(origin, `${replacedId}-new`, 1);
        await expectCountForDuration(origin, `${replacedId}-old`, 0, 900);
      },
    );
  }, 180_000);
});

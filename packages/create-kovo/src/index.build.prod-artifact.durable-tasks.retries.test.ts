import { describe, expect, it } from 'vitest';

import {
  expectEventuallyCount,
  postScheduleMode,
  sleep,
  taskProofCount,
  uniqueProofId,
  withDurableTaskArtifactServer,
} from './index.build.prod-artifact.durable-tasks.test-support.js';

describe('create-kovo starter (build integration: production durable task retry artifacts)', () => {
  it('retries flaky durable tasks to one committed effect from the production build artifact', async () => {
    await withDurableTaskArtifactServer(
      {
        name: 'Prod Durable Task Retry Proof',
        tempPrefix: 'create-kovo-prod-durable-tasks-retry-',
      },
      async ({ origin }) => {
        const flakyId = uniqueProofId('flaky');
        const flaky = await postScheduleMode(origin, flakyId, 'flaky');
        await flaky.text();
        expect([200, 303]).toContain(flaky.status);
        await expectEventuallyCount(origin, flakyId, 1);
        await sleep(500);
        expect(await taskProofCount(origin, flakyId)).toBe(1);
      },
    );
  }, 180_000);
});

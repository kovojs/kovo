import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  addDurableTaskProofs,
  buildProductionArtifact,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production durable task artifacts)', () => {
  it('runs durable scheduled tasks from the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-durable-tasks-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Durable Task Proof' });
      linkStarterBuildDependencies(root);
      addDurableTaskProofs(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      await fetchTextWhenReady(`${origin}/api/task-proof-count`, output);

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
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

async function postScheduleMode(origin: string, proofId: string, mode: string): Promise<Response> {
  return fetch(`${origin}/_m/durable-task-proofs/schedule-task-proof`, {
    body: new URLSearchParams({
      mode,
      proofId,
      'Kovo-Idem': uniqueProofId(`idem-${mode}`),
    }),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
    },
    method: 'POST',
    redirect: 'manual',
  });
}

async function expectEventuallyCount(origin: string, id: string, expected: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  let actual = await taskProofCount(origin, id);
  while (actual !== expected && Date.now() < deadline) {
    await sleep(100);
    actual = await taskProofCount(origin, id);
  }
  expect(actual).toBe(expected);
}

async function expectCountForDuration(
  origin: string,
  id: string,
  expected: number,
  durationMs: number,
): Promise<void> {
  const deadline = Date.now() + durationMs;
  do {
    expect(await taskProofCount(origin, id)).toBe(expected);
    await sleep(100);
  } while (Date.now() < deadline);
}

async function taskProofCount(origin: string, id: string): Promise<number> {
  const response = await fetch(`${origin}/api/task-proof-count?id=${encodeURIComponent(id)}`);
  const payload = (await response.json()) as { count: number };
  return payload.count;
}

function uniqueProofId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

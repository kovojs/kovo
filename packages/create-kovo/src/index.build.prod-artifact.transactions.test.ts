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
  addRuntimeMutationSafetyProofs,
  buildProductionArtifact,
} from './index.build.test-support.js';

interface ReadonlyAttemptResponse {
  blocked: boolean;
  message?: string;
  results?: Array<{ blocked: boolean; message: string; method: string }>;
}

async function expectReadonlyAttemptBlocked(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/readonly-mutation-attempt`);
  expect(response.status).toBe(200);
  const readonlyAttempt = (await response.json()) as ReadonlyAttemptResponse;

  expect(readonlyAttempt).toMatchObject({ blocked: true });
  expect(readonlyAttempt.message).toMatch(/read-only|readonly|KV433|loader cannot access/iu);
  expect(readonlyAttempt.results).toEqual([
    expect.objectContaining({ blocked: true, method: 'all' }),
    expect.objectContaining({ blocked: true, method: 'get' }),
    expect.objectContaining({ blocked: true, method: 'values' }),
    expect.objectContaining({ blocked: true, method: 'transaction' }),
  ]);
}

describe('create-kovo starter (build integration: production transaction artifacts)', () => {
  it('rolls back default mutation transactions in the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-default-tx-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Default Transaction Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root, { includeReadonlyMutationAttempt: true });

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

      await fetchTextWhenReady(`${origin}/api/tx-proof-count`, output);
      const before = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(before.count).toBe(0);

      await expectReadonlyAttemptBlocked(origin);
      const afterReadonlyAttempt = (await (
        await fetch(`${origin}/api/raw-runtime-drift-count`)
      ).json()) as {
        count: number;
      };
      expect(afterReadonlyAttempt.count).toBe(0);

      const response = await fetch(`${origin}/_m/runtime-safety-proofs/fail-after-write`, {
        body: new URLSearchParams({
          id: `partial-${Date.now()}`,
          'Kovo-Idem': `idem-tx-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      await response.text();
      expect(response.status).toBe(500);

      const after = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(after.count).toBe(0);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('keeps SQLite public GET readonly handles from mutating the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-sqlite-readonly-handle-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod SQLite Readonly Handle Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root, { includeReadonlyMutationAttempt: true });

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

      await fetchTextWhenReady(`${origin}/api/tx-proof-count`, output);
      const positiveRead = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(positiveRead.count).toBe(0);

      await expectReadonlyAttemptBlocked(origin);

      const afterReadonlyAttempt = (await (
        await fetch(`${origin}/api/raw-runtime-drift-count`)
      ).json()) as {
        count: number;
      };
      expect(afterReadonlyAttempt.count).toBe(0);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  buildReusableProductionArtifact,
  execFileSyncErrorOutput,
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
  expect(readonlyAttempt.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ blocked: true, method: expect.stringMatching(/^(execute|run)$/u) }),
      expect.objectContaining({ blocked: true, method: 'all' }),
      expect.objectContaining({ blocked: true, method: 'get' }),
      expect.objectContaining({ blocked: true, method: 'values' }),
      expect.objectContaining({ blocked: true, method: 'transaction' }),
      expect.objectContaining({ blocked: true, method: '$client' }),
      expect.objectContaining({ blocked: true, method: 'session' }),
      expect.objectContaining({ blocked: true, method: 'futureStatement' }),
    ]),
  );
  expect(readonlyAttempt.results).toHaveLength(8);
}

describe('create-kovo starter (build integration: production transaction artifacts)', () => {
  // @kovo-security-certifies KV433 readonly-managed-handle-prod-artifact
  it('rolls back default mutation transactions and executes webhooks in the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-default-tx-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Default Transaction Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root, {
        includeReadonlyMutationAttempt: true,
        includeWebhookTransactionProof: true,
      });
      const proofSource = readFileSync(join(root, 'src/runtime-safety-proofs.ts'), 'utf8');
      expect(proofSource).toContain('txProofWebhook');

      buildReusableProductionArtifact(root);

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

      const writeId = `success-${Date.now()}`;
      const success = await fetch(`${origin}/_m/runtime-safety-proofs/write-tx-proof`, {
        body: new URLSearchParams({
          id: writeId,
          'Kovo-Idem': `idem-success-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      await success.text();
      expect(success.status).toBe(303);
      const afterSuccess = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterSuccess.count).toBe(1);

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
      expect(after.count).toBe(1);

      const webhookId = `webhook-default-${Date.now()}`;
      const firstWebhook = await fetch(`${origin}/webhooks/tx-proof`, {
        body: JSON.stringify({ id: webhookId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await expect(firstWebhook.text()).resolves.toBe('ok');
      expect(firstWebhook.status).toBe(200);
      expect(firstWebhook.headers.get('kovo-changes')).toBe('[{"domain":"tx_proof"}]');

      const afterFirstWebhook = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterFirstWebhook.count).toBe(2);

      const replayWebhook = await fetch(`${origin}/webhooks/tx-proof`, {
        body: JSON.stringify({ id: webhookId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await expect(replayWebhook.text()).resolves.toBe('ok');
      expect(replayWebhook.status).toBe(200);
      expect(replayWebhook.headers.get('kovo-idem')).toBe(webhookId);

      const afterReplayWebhook = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterReplayWebhook.count).toBe(2);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('keeps SQLite readonly handles isolated and executes webhook transactions in the production artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-sqlite-readonly-handle-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod SQLite Readonly Handle Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root, {
        includeReadonlyMutationAttempt: true,
        includeSqliteAuthorizerTriggerDrift: true,
        includeWebhookTransactionProof: true,
      });
      const proofSource = readFileSync(join(root, 'src/runtime-safety-proofs.ts'), 'utf8');
      expect(proofSource).toContain('txProofWebhook');
      expect(proofSource).toContain('sqliteAuthorizerTriggerDrift');

      buildReusableProductionArtifact(root);

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
      const beforeTriggerDrift = (await (
        await fetch(`${origin}/api/sqlite-authorizer-side-effect-count`)
      ).json()) as {
        count: number;
      };
      expect(beforeTriggerDrift.count).toBe(0);

      const triggerDrift = await fetch(
        `${origin}/_m/runtime-safety-proofs/sqlite-authorizer-trigger-drift`,
        {
          body: new URLSearchParams({
            id: 'c1',
            'Kovo-Idem': `idem-sqlite-authorizer-${Date.now()}`,
            label: `authorizer-${Date.now()}`,
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            origin,
          },
          method: 'POST',
          redirect: 'manual',
        },
      );
      const triggerDriftBody = await triggerDrift.text();
      expect(triggerDrift.status, triggerDriftBody).toBe(422);
      expect(triggerDriftBody).toContain('RUNTIME_TABLE_DRIFT');
      expect(triggerDriftBody).toContain('KV406');

      const afterTriggerDrift = (await (
        await fetch(`${origin}/api/sqlite-authorizer-side-effect-count`)
      ).json()) as {
        count: number;
      };
      expect(afterTriggerDrift.count).toBe(0);

      const success = await fetch(`${origin}/_m/runtime-safety-proofs/write-tx-proof`, {
        body: new URLSearchParams({
          id: `sqlite-success-${Date.now()}`,
          'Kovo-Idem': `idem-sqlite-success-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      await success.text();
      expect(success.status).toBe(303);
      const afterSuccess = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterSuccess.count).toBe(1);

      const webhookId = `webhook-sqlite-${Date.now()}`;
      const firstWebhook = await fetch(`${origin}/webhooks/tx-proof`, {
        body: JSON.stringify({ id: webhookId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await expect(firstWebhook.text()).resolves.toBe('ok');
      expect(firstWebhook.status).toBe(200);
      expect(firstWebhook.headers.get('kovo-changes')).toBe('[{"domain":"tx_proof"}]');

      const afterFirstWebhook = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterFirstWebhook.count).toBe(2);

      const replayWebhook = await fetch(`${origin}/webhooks/tx-proof`, {
        body: JSON.stringify({ id: webhookId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await expect(replayWebhook.text()).resolves.toBe('ok');
      expect(replayWebhook.status).toBe(200);
      expect(replayWebhook.headers.get('kovo-idem')).toBe(webhookId);

      const afterReplayWebhook = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterReplayWebhook.count).toBe(2);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  // @kovo-security-certifies KV422 managed-write-raw-driver-escape-prod-artifact
  it.each([
    { dialect: undefined, label: 'default' },
    { dialect: 'sqlite' as const, label: 'SQLite' },
  ])(
    'blocks managed write raw-driver escapes before $label artifact emission',
    ({ dialect }) => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-prod-managed-write-escape-'));

      try {
        writeKovoProject(root, {
          ...(dialect === undefined ? {} : { dialect }),
          name: 'Prod Managed Write Escape Proof',
        });
        linkStarterBuildDependencies(root);
        addRuntimeMutationSafetyProofs(root, { includeManagedWriteEscapeAttempt: true });

        try {
          buildProductionArtifact(root);
          throw new Error('Expected kovo build --no-cache to fail for managed raw-driver escape.');
        } catch (error) {
          const output = execFileSyncErrorOutput(error);
          expect(output).toContain('kovo build check preflight failed');
          expect(output).toContain('KV406');
          expect(output).toContain('runtime-safety-proofs.ts');
        }
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  // @kovo-security-certifies KV330 webhook-transaction-raw-driver-escape-prod-artifact
  it.each([
    { dialect: undefined, label: 'default' },
    { dialect: 'sqlite' as const, label: 'SQLite' },
  ])(
    'blocks $label webhook transaction raw-driver escapes before artifact emission',
    ({ dialect }) => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-prod-webhook-escape-'));

      try {
        writeKovoProject(root, {
          ...(dialect === undefined ? {} : { dialect }),
          name: 'Prod Webhook Tx Escape Proof',
        });
        linkStarterBuildDependencies(root);
        addRuntimeMutationSafetyProofs(root, { includeWebhookTxEscapeAttempt: true });
        const proofSource = readFileSync(join(root, 'src/runtime-safety-proofs.ts'), 'utf8');
        expect(proofSource).toContain('context.tx as unknown as { $client: unknown }');
        expect(proofSource).toContain('context.tx as unknown as { session: unknown }');

        try {
          buildProductionArtifact(root);
          throw new Error(
            'Expected kovo build --no-cache to fail for webhook tx raw-driver escape.',
          );
        } catch (error) {
          const output = execFileSyncErrorOutput(error);
          expect(output).toContain('kovo build check preflight failed');
          expect(output).toContain('KV330');
          expect(output).toContain('Direct db access in a webhook handler');
          expect(output).toContain('runtime-safety-proofs.ts');
        }
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );
});

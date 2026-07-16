import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  cookieHeader,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  mergeCookies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import {
  addRuntimeMutationSafetyProofs,
  buildParanoidProductionArtifact,
  buildProductionArtifact,
  execFileSyncErrorOutput,
  fieldValue,
  formHtmlByAction,
} from './index.build.test-support.js';

interface ReadonlyAttemptResponse {
  blocked: boolean;
  message?: string;
  results?: Array<{ blocked: boolean; message: string; method: string }>;
}

function captureProductionBuildFailure(build: () => void): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }
  throw new Error('Expected production build to fail.');
}

async function csrfProofSession(
  origin: string,
  action: string,
): Promise<{ cookie: string; token: string }> {
  const jar = new Map<string, string>();
  const page = await fetch(`${origin}/runtime-safety-proof-forms`);
  mergeCookies(jar, page.headers.getSetCookie());
  const form = formHtmlByAction(await page.text(), action);
  return { cookie: cookieHeader(jar), token: fieldValue(form, 'csrf') };
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
  it('rolls back default mutation transactions and executes webhook mutation composition in the production build artifact', async () => {
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

      // SPEC §6.6/§10.3: paranoid artifacts keep static findings advisory so this proof can
      // exercise the independent runtime readonly membrane instead of weakening the default gate.
      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
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
      const writeCsrf = await csrfProofSession(origin, '/_m/runtime-safety-proofs/write-tx-proof');
      const success = await fetch(`${origin}/_m/runtime-safety-proofs/write-tx-proof`, {
        body: new URLSearchParams({
          csrf: writeCsrf.token,
          id: writeId,
          'Kovo-Idem': `idem-success-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: writeCsrf.cookie,
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      const successBody = await success.text();
      expect(success.status, `${successBody}\n${output()}`).toBe(303);
      const afterSuccess = (await (await fetch(`${origin}/api/tx-proof-count`)).json()) as {
        count: number;
      };
      expect(afterSuccess.count).toBe(1);

      const rollbackCsrf = await csrfProofSession(
        origin,
        '/_m/runtime-safety-proofs/fail-after-write',
      );
      const response = await fetch(`${origin}/_m/runtime-safety-proofs/fail-after-write`, {
        body: new URLSearchParams({
          csrf: rollbackCsrf.token,
          id: `partial-${Date.now()}`,
          'Kovo-Idem': `idem-tx-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: rollbackCsrf.cookie,
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      const responseBody = await response.text();
      expect(response.status, `${responseBody}\n${output()}`).toBe(500);

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

  it('keeps SQLite readonly handles isolated and executes webhook mutation composition in the production artifact', async () => {
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
      const runtimeDbSource = readFileSync(join(root, 'src/_kovo/app-runtime-db.ts'), 'utf8');
      expect(runtimeDbSource).toContain('schema.sqliteAuthorizerDeclared');
      expect(runtimeDbSource).toContain('schema.sqliteAuthorizerSideEffects');

      // SPEC §6.6/§10.3: preserve the runtime SQLite-authorizer proof behind the explicit
      // paranoid test posture while ordinary production builds remain fail closed below.
      buildParanoidProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'test',
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

      const triggerCsrf = await csrfProofSession(
        origin,
        '/_m/runtime-safety-proofs/sqlite-authorizer-trigger-drift',
      );
      const triggerDrift = await fetch(
        `${origin}/_m/runtime-safety-proofs/sqlite-authorizer-trigger-drift`,
        {
          body: new URLSearchParams({
            csrf: triggerCsrf.token,
            id: 'c1',
            'Kovo-Idem': `idem-sqlite-authorizer-${Date.now()}`,
            label: `authorizer-${Date.now()}`,
          }),
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            cookie: triggerCsrf.cookie,
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

      const writeCsrf = await csrfProofSession(origin, '/_m/runtime-safety-proofs/write-tx-proof');
      const success = await fetch(`${origin}/_m/runtime-safety-proofs/write-tx-proof`, {
        body: new URLSearchParams({
          csrf: writeCsrf.token,
          id: `sqlite-success-${Date.now()}`,
          'Kovo-Idem': `idem-sqlite-success-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: writeCsrf.cookie,
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

  it.each([
    { dialect: undefined, label: 'default' },
    { dialect: 'sqlite' as const, label: 'SQLite' },
  ])(
    'blocks $label readonly DB computed-method escapes before artifact emission',
    ({ dialect }) => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-prod-readonly-method-escape-'));

      try {
        writeKovoProject(root, {
          ...(dialect === undefined ? {} : { dialect }),
          name: 'Prod Readonly Method Escape Proof',
        });
        linkStarterBuildDependencies(root);
        addRuntimeMutationSafetyProofs(root, { includeReadonlyMutationAttempt: true });

        const output = execFileSyncErrorOutput(
          captureProductionBuildFailure(() => buildProductionArtifact(root)),
        );
        expect(output).toContain('kovo build check preflight failed');
        expect(output).toContain('KV424');
        expect(output).toContain('sink=request-handler.opaque-call');
        expect(output).toContain('source=sqlMethod');
        expect(output).toContain('runtime-safety-proofs.ts');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  // @kovo-security-certifies KV424 managed-write-raw-driver-escape-prod-artifact
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

        const output = execFileSyncErrorOutput(
          captureProductionBuildFailure(() => buildProductionArtifact(root)),
        );
        expect(output).toContain('kovo build check preflight failed');
        expect(output).toContain('KV424');
        expect(output).toContain('sink=request-handler.opaque-call');
        expect(output).toContain('source=closeRawClient');
        expect(output).toContain('sink=request-handler.opaque-protocol');
        expect(output).toContain('runtime-safety-proofs.ts');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );

  // @kovo-security-certifies KV330 webhook-context-tx-raw-driver-escape-prod-artifact
  it.each([
    { dialect: undefined, label: 'default' },
    { dialect: 'sqlite' as const, label: 'SQLite' },
  ])(
    'blocks $label webhook context.tx raw-driver escapes before artifact emission',
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

        const output = execFileSyncErrorOutput(
          captureProductionBuildFailure(() => buildProductionArtifact(root)),
        );
        expect(output).toContain('kovo build check preflight failed');
        expect(output).toContain('KV330');
        expect(output).toContain('Direct db access in a webhook handler');
        expect(output).toContain('runtime-safety-proofs.ts');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    120_000,
  );
});

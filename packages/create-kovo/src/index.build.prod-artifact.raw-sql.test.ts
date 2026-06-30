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
  addRawSqlOwnerWriteProof,
  addRuntimeMutationSafetyProofs,
  buildProductionArtifact,
  execFileSyncErrorOutput,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production raw-SQL artifacts)', () => {
  it('blocks raw owner-table db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-write-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Write Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail for raw owner-table write.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV414');
        expect(output).toContain('KV438');
        expect(output).toContain('WRITE');
        expect(output).toContain('domain=raw-owner');
        expect(output).toContain('via=raw-sql');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('blocks undeclared raw db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-undeclared-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Undeclared Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root, { declareTables: false });

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail for undeclared raw write.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('KV406');
        expect(output).toContain('mutations.ts');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('accepts trusted raw owner-table db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-trusted-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Trusted Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root, { trusted: true });

      buildProductionArtifact(root);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('rejects trusted raw-SQL table drift in the production build artifact', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-runtime-sql-allowlist-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { name: 'Prod Runtime SQL Allowlist Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root);

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

      await fetchTextWhenReady(`${origin}/api/raw-runtime-drift-count`, output);
      const before = (await (await fetch(`${origin}/api/raw-runtime-drift-count`)).json()) as {
        count: number;
      };
      expect(before.count).toBe(0);

      const response = await fetch(`${origin}/_m/runtime-safety-proofs/raw-table-drift`, {
        body: new URLSearchParams({
          id: `drift-${Date.now()}`,
          label: 'should-not-insert',
          'Kovo-Idem': `idem-sql-${Date.now()}`,
        }),
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        method: 'POST',
        redirect: 'manual',
      });
      const body = await response.text();

      expect(response.status).toBe(422);
      expect(body).toContain('data-error-code="RUNTIME_TABLE_DRIFT"');
      expect(body).toContain('KV406');

      const after = (await (await fetch(`${origin}/api/raw-runtime-drift-count`)).json()) as {
        count: number;
      };
      expect(after.count).toBe(0);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

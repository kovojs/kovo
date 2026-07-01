import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { linkStarterBuildDependencies } from './index.test-support.js';
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
        expect(output).toContain('WRITE');
        expect(output).toContain('domain=raw-owner');
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

  it('blocks trusted raw-SQL table drift before production artifact emission', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-runtime-sql-allowlist-'));

    try {
      writeKovoProject(root, { name: 'Prod Runtime SQL Allowlist Proof' });
      linkStarterBuildDependencies(root);
      addRuntimeMutationSafetyProofs(root);

      try {
        buildProductionArtifact(root);
        throw new Error('Expected kovo build --no-cache to fail for raw table drift.');
      } catch (error) {
        const output = execFileSyncErrorOutput(error);
        expect(output).toContain('kovo build check preflight failed');
        expect(output).toContain('KV406');
        expect(output).toContain('KV438');
        expect(output).toContain('runtime-safety-proofs/raw-table-drift');
        expect(output).toContain('raw SQL statement cannot prove governed value provenance');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

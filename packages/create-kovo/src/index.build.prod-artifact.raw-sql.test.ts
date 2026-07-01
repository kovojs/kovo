import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import { linkStarterBuildDependencies } from './index.test-support.js';
import {
  addRawSqlOwnerWriteProof,
  buildProductionArtifact,
  execFileSyncErrorOutput,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: production raw-SQL artifacts)', () => {
  // @kovo-security-certifies KV414 raw-sql-owner-write-prod-artifact
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
});

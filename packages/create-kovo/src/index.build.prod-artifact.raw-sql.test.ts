import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function captureProductionBuildFailure(root: string): unknown {
  try {
    buildProductionArtifact(root);
  } catch (error) {
    return error;
  }
  throw new Error('Expected production build to fail.');
}

describe('create-kovo starter (build integration: production raw-SQL artifacts)', () => {
  it('patches raw owner-table proof into multiline mutation registries', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-multiline-registry-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Multiline Registry Proof' });
      linkStarterBuildDependencies(root);
      const mutationsPath = join(root, 'src/mutations.ts');
      const mutations = readFileSync(mutationsPath, 'utf8');
      writeFileSync(
        mutationsPath,
        mutations.replace(
          "  registry: { tables: ['contacts'], touches: [contact] },",
          [
            '  registry: {',
            "    tables: ['contacts'],",
            '    queries: [contactsQuery],',
            '    touches: [contact],',
            '  },',
          ].join('\n'),
        ),
        'utf8',
      );

      addRawSqlOwnerWriteProof(root);

      const patchedMutations = readFileSync(mutationsPath, 'utf8');
      expect(patchedMutations).toContain("const rawOwner = domain('raw-owner');");
      expect(patchedMutations).toContain("tables: ['contacts', 'raw_owners']");
      expect(patchedMutations).toContain('touches: [contact, rawOwner]');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  // @kovo-security-certifies KV414 raw-sql-owner-write-prod-artifact
  it('blocks raw owner-table db.execute writes from the production build artifact', () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-raw-sql-write-'));

    try {
      writeKovoProject(root, { name: 'Prod Raw SQL Write Proof' });
      linkStarterBuildDependencies(root);
      addRawSqlOwnerWriteProof(root);

      const output = execFileSyncErrorOutput(captureProductionBuildFailure(root));
      expect(output).toContain('KV414');
      expect(output).toContain('WRITE');
      expect(output).toContain('domain=raw-owner');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject, type CreateKovoDialect } from './index.js';
import { linkStarterBuildDependencies } from './index.test-support.js';
import {
  addEscapedAttackerTextProof,
  addRawSqlOwnerWriteProof,
  addStorageQueryWriteProof,
  addTrustedOutputProvenanceBuildProof,
  buildProductionArtifact,
  execFileSyncErrorOutput,
} from './index.build.test-support.js';

describe('create-kovo starter (build integration: adversarial production artifact sweep)', () => {
  it.each([
    ['postgres', undefined],
    ['sqlite', 'sqlite'],
  ] as const)(
    'tracks storage write gates from current %s production source, not stale cache',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-storage-${_label}-red-`, dialect, (root) => {
        addStorageQueryWriteProof(root);
        expectBuildFailure(root, ['KV433', 'storage-write-query', 'operation=put']);
      });

      withProject(`create-kovo-m1-storage-${_label}-flip-`, dialect, (root) => {
        buildProductionArtifact(root);
        addStorageQueryWriteProof(root);
        expectBuildFailure(root, ['KV433', 'storage-write-query', 'operation=put']);
      });
    },
    240_000,
  );

  it('tracks trusted output provenance gates from current production source, not stale cache', () => {
    withProject('create-kovo-m1-trusted-output-red-', undefined, (root) => {
      addTrustedOutputProvenanceBuildProof(root);
      expectBuildFailure(root, [
        'KV426',
        'trustedUrl() sends query-derived data',
        'trustedHtml() sends request-derived data',
      ]);
    });

    withProject('create-kovo-m1-trusted-output-green-', undefined, (root) => {
      addEscapedAttackerTextProof(root);
      buildProductionArtifact(root);
    });

    withProject('create-kovo-m1-trusted-output-flip-', undefined, (root) => {
      buildProductionArtifact(root);
      addTrustedOutputProvenanceBuildProof(root);
      expectBuildFailure(root, [
        'KV426',
        'trustedUrl() sends query-derived data',
        'trustedHtml() sends request-derived data',
      ]);
    });
  }, 240_000);

  it.each([
    ['postgres', undefined],
    ['sqlite', 'sqlite'],
  ] as const)(
    'covers raw SQL owner-write unsafe and trusted %s production siblings',
    (_label: string, dialect: CreateKovoDialect | undefined) => {
      withProject(`create-kovo-m1-raw-sql-${_label}-red-`, dialect, (root) => {
        addRawSqlOwnerWriteProof(root);
        expectBuildFailure(root, ['KV414', 'WRITE', 'domain=raw-owner']);
      });

      withProject(`create-kovo-m1-raw-sql-${_label}-green-`, dialect, (root) => {
        addRawSqlOwnerWriteProof(root, { trusted: true });
        buildProductionArtifact(root);
      });
    },
    240_000,
  );
});

function withProject(
  prefix: string,
  dialect: CreateKovoDialect | undefined,
  run: (root: string) => void,
): void {
  const tempParent = tmpdir();
  mkdirSync(tempParent, { recursive: true });
  const root = mkdtempSync(join(tempParent, prefix));

  try {
    writeKovoProject(root, {
      ...(dialect === undefined ? {} : { dialect }),
      name: 'M1 Adversarial Production Artifact Proof',
    });
    linkStarterBuildDependencies(root);
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function expectBuildFailure(root: string, expectedOutput: readonly string[]): void {
  try {
    buildProductionArtifact(root);
    throw new Error(`Expected production build to fail with ${expectedOutput.join(', ')}.`);
  } catch (error) {
    const output = execFileSyncErrorOutput(error);
    for (const expected of expectedOutput) {
      expect(output).toContain(expected);
    }
  }
}

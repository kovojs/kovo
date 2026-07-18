import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultAuthorizationMatrixPath,
  validateAuthorizationMatrix,
  validateAuthorizationMatrixDocument,
} from './check-authorization-matrix.mjs';
import { repoRoot } from './lib/repo-root.mjs';

const checkedInMatrix = JSON.parse(
  readFileSync(path.join(repoRoot(), defaultAuthorizationMatrixPath), 'utf8'),
);

describe('authorization matrix forcing gate', () => {
  it('accepts the checked-in deterministic served-artifact matrix', () => {
    expect(validateAuthorizationMatrix()).toMatchObject({
      findings: [],
      ok: true,
      summary: { canaryCount: 5, caseCount: 28, dimensionObligations: 34 },
    });
  });

  it('rejects a declared dimension that no executed cell covers', () => {
    const matrix = cloneMatrix();
    for (const testCase of matrix.cases) {
      testCase.queryFamily = testCase.queryFamily.filter((family) => family !== 'function');
      if (testCase.queryFamily.length === 0) testCase.queryFamily = ['none'];
    }
    expect(validateAuthorizationMatrixDocument(matrix).findings).toContain(
      'security/authorization-matrix.json: matrix does not execute queryFamily values: function',
    );
  });

  it('kills a canary when its cross-owner denial verdict is weakened', () => {
    const matrix = cloneMatrix();
    matrix.cases.find((testCase) => testCase.id === 'mutation-raw-cross-owner').expected = 'allow';
    expect(validateAuthorizationMatrixDocument(matrix).findings).toContain(
      'security/authorization-matrix.json: canary case mutation-raw-cross-owner must expect deny',
    );
  });

  it('requires each major guarantee to retain a persisted minimized replay seed', () => {
    const matrix = cloneMatrix();
    matrix.regressionSeeds = matrix.regressionSeeds.filter(
      (seed) => seed.id !== 'least-privilege-role',
    );
    expect(validateAuthorizationMatrixDocument(matrix).findings).toContain(
      'security/authorization-matrix.json: canary least-privilege-role needs a persisted seed and minimized repro',
    );
  });

  it('pins replay failures below the ignored Kovo security-failure directory', () => {
    const matrix = cloneMatrix();
    matrix.replay.failureDirectory = '../outside';
    expect(validateAuthorizationMatrixDocument(matrix).findings).toContain(
      'security/authorization-matrix.json: replay.failureDirectory must stay below .kovo/security-failures',
    );
  });

  it('rejects duplicate case identities before execution can collapse a cell', () => {
    const matrix = cloneMatrix();
    matrix.cases[1].id = matrix.cases[0].id;
    expect(validateAuthorizationMatrixDocument(matrix).findings).toContain(
      `security/authorization-matrix.json: cases[1].id duplicates ${matrix.cases[0].id}`,
    );
  });
});

function cloneMatrix() {
  return structuredClone(checkedInMatrix);
}

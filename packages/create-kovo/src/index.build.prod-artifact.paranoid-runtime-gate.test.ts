import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertParanoidPostgresCasesExecuted,
  requireParanoidPostgresToolchain,
  runParanoidAuthorizationMatrix,
  seededAuthorizationMatrixOrder,
  type ParanoidAuthorizationMatrixCase,
} from './index.build.prod-artifact.paranoid-runtime-gate.js';

describe('paranoid authorization acceptance gate', () => {
  it('fails closed when the dedicated gate cannot find the local Postgres toolchain', () => {
    expect(() =>
      requireParanoidPostgresToolchain(
        { available: false, reason: 'missing local Postgres binaries: initdb, postgres' },
        true,
      ),
    ).toThrow(
      'test:authz-paranoid requires a local Postgres toolchain: missing local Postgres binaries: initdb, postgres',
    );
  });

  it('allows an ordinary non-paranoid run to skip unavailable real-Postgres cases', () => {
    expect(
      requireParanoidPostgresToolchain(
        { available: false, reason: 'missing local Postgres binaries: initdb, postgres' },
        false,
      ),
    ).toBe(false);
  });

  it('fails when any required real-Postgres acceptance case did not execute', () => {
    expect(() =>
      assertParanoidPostgresCasesExecuted(
        ['phase5-dogfood', 'provision-check-boot', 'leak-refusal'],
        new Set(['phase5-dogfood', 'leak-refusal']),
        true,
      ),
    ).toThrow(
      'test:authz-paranoid did not execute every required real-Postgres case; missing: provision-check-boot',
    );

    expect(() =>
      assertParanoidPostgresCasesExecuted(
        ['phase5-dogfood', 'provision-check-boot', 'leak-refusal'],
        new Set(['phase5-dogfood', 'provision-check-boot', 'leak-refusal']),
        true,
      ),
    ).not.toThrow();
  });

  it('replays every authorization cell in a deterministic seed-dependent order', async () => {
    const cases = [matrixCase('builder'), matrixCase('raw'), matrixCase('view')];
    const firstOrder = seededAuthorizationMatrixOrder(cases, 'authz-seed-v1').map(
      (testCase) => testCase.id,
    );
    const replayedOrder = seededAuthorizationMatrixOrder(cases, 'authz-seed-v1').map(
      (testCase) => testCase.id,
    );
    expect(replayedOrder).toEqual(firstOrder);
    expect(new Set(firstOrder)).toEqual(new Set(['builder', 'raw', 'view']));

    const executed: string[] = [];
    await runParanoidAuthorizationMatrix({
      cases,
      executors: Object.fromEntries(cases.map((testCase) => [testCase.id, async () => undefined])),
      failureDirectory: await mkdtemp(join(tmpdir(), 'kovo-authz-matrix-success-')),
      onExecuted: (caseId) => executed.push(caseId),
      replayCommand: 'pnpm run test:authz-paranoid',
      seed: 'authz-seed-v1',
    });
    expect(executed).toEqual(firstOrder);
  });

  it('persists a one-cell minimized repro with the exact seed and replay command', async () => {
    const failureDirectory = await mkdtemp(join(tmpdir(), 'kovo-authz-matrix-failure-'));
    const testCase = matrixCase('cross-owner-raw-write');

    await expect(
      runParanoidAuthorizationMatrix({
        cases: [testCase],
        executors: {
          [testCase.id]: async () => {
            throw new Error('cross-owner row became visible');
          },
        },
        failureDirectory,
        replayCommand: 'KOVO_AUTHZ_MATRIX_SEED=authz-seed-v1 pnpm run test:authz-paranoid',
        seed: 'authz-seed-v1',
      }),
    ).rejects.toThrow(/minimized replay saved/u);

    const artifact = JSON.parse(
      readFileSync(join(failureDirectory, 'dc615ba76075ca52.json'), 'utf8'),
    ) as {
      minimizedRepro: ParanoidAuthorizationMatrixCase;
      replayCommand: string;
      schema: string;
      seed: string;
    };
    expect(artifact).toEqual({
      error: 'cross-owner row became visible',
      minimizedRepro: testCase,
      replayCommand: 'KOVO_AUTHZ_MATRIX_SEED=authz-seed-v1 pnpm run test:authz-paranoid',
      schema: 'kovo.authorization-matrix-failure/v1',
      seed: 'authz-seed-v1',
    });
  });

  it('fails before execution when a declared matrix cell has no executor', async () => {
    await expect(
      runParanoidAuthorizationMatrix({
        cases: [matrixCase('missing')],
        executors: {},
        failureDirectory: await mkdtemp(join(tmpdir(), 'kovo-authz-matrix-missing-')),
        replayCommand: 'pnpm run test:authz-paranoid',
        seed: 'authz-seed-v1',
      }),
    ).rejects.toThrow('authorization matrix has no executor for: missing');
  });
});

function matrixCase(id: string): ParanoidAuthorizationMatrixCase {
  return {
    expected: 'deny',
    id,
    operation: 'read',
    ownership: ['other'],
    principal: ['session'],
    queryFamily: ['raw-sql'],
    surface: 'query',
  };
}

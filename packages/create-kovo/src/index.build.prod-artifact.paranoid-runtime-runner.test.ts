import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  formatParanoidGateFailures,
  PARANOID_GATE_CASES,
  PARANOID_RUNTIME_CASES,
  paranoidRuntimeWorkerRequirements,
  runIsolatedProcess,
  runParanoidRuntimeGate,
  selectedParanoidRuntimeCaseId,
  type IsolatedProcessOutcome,
} from './index.build.prod-artifact.paranoid-runtime-runner.js';

describe('paranoid runtime process isolation', () => {
  it('keeps every supervisor outside the child timeout and every required worker explicit', () => {
    expect(PARANOID_RUNTIME_CASES.map((testCase) => testCase.id)).toEqual([
      'phase5-postgres-paranoid-dogfood',
      'phase5-sqlite-paranoid-dogfood',
      'paranoid-external-provision-check-boot',
      'paranoid-external-leak-refusal',
    ]);
    for (const testCase of PARANOID_RUNTIME_CASES) {
      expect(testCase.workerCaseId).toBe(testCase.id);
    }
    for (const testCase of PARANOID_GATE_CASES) {
      expect(testCase.supervisorTimeoutMs, testCase.id).toBeGreaterThan(testCase.testTimeoutMs);
    }

    const externalBoot = PARANOID_RUNTIME_CASES.find(
      (testCase) => testCase.id === 'paranoid-external-provision-check-boot',
    );
    // This proof serially contains the production 300s static-trust deadline and the hosted 180s
    // server-readiness deadline. Vitest must be outside both before the process supervisor applies.
    expect(externalBoot?.testTimeoutMs).toBeGreaterThan(300_000 + 180_000);

    expect(paranoidRuntimeWorkerRequirements('phase5-sqlite-paranoid-dogfood')).toEqual({
      authorizationMatrixCases: [],
      postgresCases: [],
    });
    expect(paranoidRuntimeWorkerRequirements('paranoid-external-provision-check-boot')).toEqual({
      authorizationMatrixCases: ['closure-safe-boot'],
      postgresCases: ['paranoid-external-provision-check-boot'],
    });
    expect(paranoidRuntimeWorkerRequirements('paranoid-external-leak-refusal')).toEqual({
      authorizationMatrixCases: [
        'closure-cross-schema-definer-function-refusal',
        'closure-definer-view-refusal',
        'closure-matview-refusal',
        'closure-public-table-refusal',
      ],
      postgresCases: ['paranoid-external-leak-refusal'],
    });
  });

  it('rejects an unknown worker selector before Vitest can silently filter the gate', () => {
    expect(selectedParanoidRuntimeCaseId(undefined)).toBeUndefined();
    expect(() => selectedParanoidRuntimeCaseId('not-a-real-case')).toThrow(
      /KOVO_PARANOID_RUNTIME_CASE must name one isolated paranoid runtime case/u,
    );
  });

  it('attempts every case and reports all failures instead of stopping at the first one', async () => {
    const attempted: string[] = [];
    const progress: string[] = [];
    const firstId = PARANOID_GATE_CASES[0].id;
    const secondId = PARANOID_GATE_CASES[1].id;
    const run = await runParanoidRuntimeGate({
      executeCase: async (testCase) => {
        attempted.push(testCase.id);
        if (testCase.id === firstId) {
          return isolatedOutcome({
            exitCode: null,
            signal: 'SIGKILL',
            stderr: 'first isolated failure',
            timedOut: true,
          });
        }
        if (testCase.id === secondId) throw new Error('second child could not start');
        return isolatedOutcome();
      },
      onProgress: (message) => progress.push(message),
    });

    expect(attempted).toEqual(PARANOID_GATE_CASES.map((testCase) => testCase.id));
    expect(run.failures.map((failure) => failure.id)).toEqual([firstId, secondId]);
    expect(progress.join('')).toContain(`[paranoid:${PARANOID_GATE_CASES.at(-1)?.id}] PASS`);
    expect(formatParanoidGateFailures(run)).toContain(
      `attempted all ${String(PARANOID_GATE_CASES.length)} isolated cases; 2 failed`,
    );
    expect(formatParanoidGateFailures(run)).toContain('first isolated failure');
    expect(formatParanoidGateFailures(run)).toContain('second child could not start');
  });

  it('refuses to start another proof when process-tree cleanup cannot be proven', async () => {
    const attempted: string[] = [];
    await expect(
      runParanoidRuntimeGate({
        executeCase: async (testCase) => {
          attempted.push(testCase.id);
          return isolatedOutcome({
            cleanupError: 'process group survived SIGKILL',
            timedOut: true,
          });
        },
        onProgress: () => undefined,
      }),
    ).rejects.toThrow(/refusing to overlap a later proof/u);
    expect(attempted).toEqual([PARANOID_GATE_CASES[0].id]);
  });

  const itIfPosix = process.platform === 'win32' ? it.skip : it;
  itIfPosix(
    'kills and reaps a timed-out descendant tree before returning bounded diagnostics',
    async () => {
      const descendantSource = [
        "process.on('SIGTERM', () => undefined);",
        'setInterval(() => undefined, 1_000);',
      ].join('');
      const supervisorSource = [
        "const { spawn } = require('node:child_process');",
        `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
        'process.stderr.write(`descendant:${descendant.pid}\\n`);',
        "process.on('SIGTERM', () => undefined);",
        "for (let index = 0; index < 256; index += 1) process.stdout.write('x'.repeat(1024));",
        'setInterval(() => undefined, 1_000);',
      ].join('');

      const outcome = await runIsolatedProcess({
        args: ['-e', supervisorSource],
        command: process.execPath,
        cwd: resolve('.'),
        env: process.env,
        maxOutputBytes: 1_024,
        reapTimeoutMs: 2_000,
        supervisorTimeoutMs: 500,
        terminationGraceMs: 50,
      });

      expect(outcome.timedOut).toBe(true);
      expect(outcome.cleanupError).toBeNull();
      expect(outcome.signal).toBe('SIGKILL');
      expect(outcome.stdout).toMatch(/earlier output bytes truncated/u);
      expect(Buffer.byteLength(outcome.stdout)).toBeLessThan(1_100);
      const match = /descendant:(\d+)/u.exec(outcome.stderr);
      expect(match).not.toBeNull();
      const descendantPid = Number(match?.[1]);
      expect(await processStopsWithin(descendantPid, 1_000)).toBe(true);
    },
  );
});

function isolatedOutcome(overrides: Partial<IsolatedProcessOutcome> = {}): IsolatedProcessOutcome {
  return {
    cleanupError: null,
    durationMs: 1,
    error: null,
    exitCode: 0,
    signal: null,
    stderr: '',
    stdout: '',
    timedOut: false,
    ...overrides,
  };
}

async function processStopsWithin(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      throw error;
    }
    if (Date.now() >= deadline) return false;
    await delay(20);
  }
}

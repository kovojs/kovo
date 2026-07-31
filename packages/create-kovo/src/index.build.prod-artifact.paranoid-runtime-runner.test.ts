import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  assertSupportedTestProcessPlatform,
  runBoundedTestProcessForTest,
  type BoundedTestProcessRecordForTest,
} from './index.test-process-supervisor.mjs';

import {
  assertParanoidRuntimeCasesExecuted,
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

    expect(paranoidRuntimeWorkerRequirements('phase5-sqlite-paranoid-dogfood', false)).toEqual({
      authorizationMatrixCases: [],
      postgresCases: [],
      runtimeCases: ['phase5-sqlite-paranoid-dogfood'],
    });
    expect(
      paranoidRuntimeWorkerRequirements('paranoid-external-provision-check-boot', true),
    ).toEqual({
      authorizationMatrixCases: ['closure-safe-boot'],
      postgresCases: ['paranoid-external-provision-check-boot'],
      runtimeCases: ['paranoid-external-provision-check-boot'],
    });
    expect(paranoidRuntimeWorkerRequirements('paranoid-external-leak-refusal', true)).toEqual({
      authorizationMatrixCases: [
        'closure-cross-schema-definer-function-refusal',
        'closure-definer-view-refusal',
        'closure-matview-refusal',
        'closure-public-table-refusal',
      ],
      postgresCases: ['paranoid-external-leak-refusal'],
      runtimeCases: ['paranoid-external-leak-refusal'],
    });
    expect(paranoidRuntimeWorkerRequirements(undefined, false)).toEqual({
      authorizationMatrixCases: [],
      postgresCases: [],
      runtimeCases: [],
    });
    expect(paranoidRuntimeWorkerRequirements(undefined, true)).toEqual({
      authorizationMatrixCases: [],
      postgresCases: [],
      runtimeCases: [],
    });
    for (const testCase of PARANOID_RUNTIME_CASES) {
      expect(paranoidRuntimeWorkerRequirements(testCase.id, true).runtimeCases).toEqual([
        testCase.id,
      ]);
    }
  });

  it('fails closed when the selected SQLite runtime case has no executed marker', () => {
    expect(() =>
      assertParanoidRuntimeCasesExecuted(['phase5-sqlite-paranoid-dogfood'], new Set()),
    ).toThrow(
      /did not execute every selected runtime case; missing: phase5-sqlite-paranoid-dogfood/u,
    );
    expect(() =>
      assertParanoidRuntimeCasesExecuted(
        ['phase5-sqlite-paranoid-dogfood'],
        new Set(['phase5-sqlite-paranoid-dogfood']),
      ),
    ).not.toThrow();
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

  it('fails closed on native Windows instead of using identity-blind taskkill fallback', () => {
    expect(() => assertSupportedTestProcessPlatform('win32')).toThrow(
      /supports only the repository's Linux and macOS test hosts/u,
    );
  });

  it('does not signal a reused PID or a PGID whose revalidated membership is unmarked', async () => {
    const signaledGroups: number[] = [];
    const signaledProcesses: number[] = [];
    let census = 0;
    const outcome = await runBoundedTestProcessForTest(
      {
        args: ['-e', ''],
        command: process.execPath,
        cwd: resolve('.'),
        censusIntervalMs: 1,
        killGraceMs: 100,
        rootExitTimeoutMs: 100,
        streamCloseTimeoutMs: 100,
        supervisorTimeoutMs: 1_000,
        terminationGraceMs: 100,
      },
      {
        signalProcess: (pid) => signaledProcesses.push(pid),
        signalProcessGroup: (pgid) => signaledGroups.push(pgid),
        snapshotProcessTable: async () => {
          census += 1;
          if (census === 1) return processTable(markedProcess(410, 700));
          if (census === 2) return processTable(unmarkedProcess(999, 700));
          if (census === 3) return processTable(unmarkedProcess(410, 701));
          return new Map();
        },
      },
    );

    expect(outcome.cleanupError).toBeNull();
    expect(signaledGroups).toEqual([]);
    expect(signaledProcesses).toEqual([]);
  });

  it('settles deterministically when the marker census times out', async () => {
    const startedAt = Date.now();
    const outcome = await runBoundedTestProcessForTest(
      {
        args: ['-e', ''],
        command: process.execPath,
        cwd: resolve('.'),
        killGraceMs: 50,
        rootExitTimeoutMs: 50,
        streamCloseTimeoutMs: 50,
        supervisorTimeoutMs: 1_000,
        terminationGraceMs: 50,
      },
      {
        snapshotProcessTable: async () => {
          throw new Error('synthetic process census timeout');
        },
      },
    );

    expect(outcome.cleanupError).toMatch(/synthetic process census timeout/u);
    expect(outcome.exitCode).toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('bounds cleanup even when identity-checked signals cannot make progress', async () => {
    const startedAt = Date.now();
    const outcome = await runBoundedTestProcessForTest(
      {
        args: ['-e', ''],
        command: process.execPath,
        cwd: resolve('.'),
        censusIntervalMs: 1,
        killGraceMs: 20,
        rootExitTimeoutMs: 20,
        streamCloseTimeoutMs: 20,
        supervisorTimeoutMs: 1_000,
        terminationGraceMs: 20,
      },
      {
        delay: async () => undefined,
        signalProcess: () => undefined,
        signalProcessGroup: () => undefined,
        snapshotProcessTable: async () => processTable(markedProcess(410, 700)),
      },
    );

    expect(outcome.cleanupError).toMatch(/marked process-tree cleanup/u);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  const itIfPosix = process.platform === 'win32' ? it.skip : it;
  itIfPosix('kills a detached grandchild after its intermediate parent exits', async () => {
    const grandchildSource = [
      "process.on('SIGTERM', () => undefined);",
      'setInterval(() => undefined, 1_000);',
    ].join('');
    const intermediateSource = [
      "const { spawn } = require('node:child_process');",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { detached: true, stdio: 'ignore' });`,
      'grandchild.unref();',
      'process.stderr.write(`grandchild:${grandchild.pid}\\n`);',
    ].join('');
    const supervisorSource = [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', ${JSON.stringify(intermediateSource)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
      "process.on('SIGTERM', () => undefined);",
      'setInterval(() => undefined, 1_000);',
    ].join('');

    const outcome = await runIsolatedProcess({
      args: ['-e', supervisorSource],
      command: process.execPath,
      cwd: resolve('.'),
      env: process.env,
      killGraceMs: 2_000,
      maxOutputBytes: 1_024,
      rootExitTimeoutMs: 2_000,
      streamCloseTimeoutMs: 2_000,
      supervisorTimeoutMs: 500,
      terminationGraceMs: 50,
    });

    expect(outcome.timedOut).toBe(true);
    expect(outcome.outputOverflowed).toBe(false);
    expect(outcome.cleanupError).toBeNull();
    expect(outcome.signal).toBe('SIGKILL');
    const match = /grandchild:(\d+)/u.exec(outcome.stderr);
    expect(match).not.toBeNull();
    const grandchildPid = Number(match?.[1]);
    expect(await processStopsWithin(grandchildPid, 1_000)).toBe(true);
  });

  itIfPosix('reaps a fast-success detached grandchild that inherited the root pipe', async () => {
    const grandchildSource = [
      "process.on('SIGTERM', () => undefined);",
      'setInterval(() => undefined, 1_000);',
    ].join('');
    const intermediateSource = [
      "const { spawn } = require('node:child_process');",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });`,
      'grandchild.unref();',
      'process.send(String(grandchild.pid), () => process.exit(0));',
    ].join('');
    const rootSource = [
      "const { spawn } = require('node:child_process');",
      `const intermediate = spawn(process.execPath, ['-e', ${JSON.stringify(intermediateSource)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });`,
      "intermediate.on('message', (pid) => process.stdout.write(`grandchild:${pid}\\n`));",
    ].join('');

    const outcome = await runIsolatedProcess({
      args: ['-e', rootSource],
      command: process.execPath,
      cwd: resolve('.'),
      env: process.env,
      killGraceMs: 2_000,
      rootExitTimeoutMs: 2_000,
      streamCloseTimeoutMs: 2_000,
      supervisorTimeoutMs: 5_000,
      terminationGraceMs: 50,
    });

    expect(outcome).toMatchObject({
      cleanupError: null,
      exitCode: 0,
      outputOverflowed: false,
      signal: null,
      timedOut: false,
    });
    const match = /grandchild:(\d+)/u.exec(outcome.stdout);
    expect(match).not.toBeNull();
    expect(await processStopsWithin(Number(match?.[1]), 1_000)).toBe(true);
  });

  itIfPosix('terminates on a deterministic combined-output overflow', async () => {
    const source = [
      "process.on('SIGTERM', () => undefined);",
      "process.stdout.write('o'.repeat(800));",
      "process.stderr.write('e'.repeat(800));",
      'setInterval(() => undefined, 1_000);',
    ].join('');
    const outcome = await runIsolatedProcess({
      args: ['-e', source],
      command: process.execPath,
      cwd: resolve('.'),
      env: process.env,
      killGraceMs: 2_000,
      maxOutputBytes: 1_024,
      rootExitTimeoutMs: 2_000,
      streamCloseTimeoutMs: 2_000,
      supervisorTimeoutMs: 5_000,
      terminationGraceMs: 50,
    });

    expect(outcome.timedOut).toBe(false);
    expect(outcome.outputOverflowed).toBe(true);
    expect(outcome.cleanupError).toBeNull();
    expect(
      Buffer.byteLength(outcome.stdout) + Buffer.byteLength(outcome.stderr),
    ).toBeLessThanOrEqual(1_024);
  });
});

function isolatedOutcome(overrides: Partial<IsolatedProcessOutcome> = {}): IsolatedProcessOutcome {
  return {
    cleanupError: null,
    durationMs: 1,
    error: null,
    exitCode: 0,
    outputOverflowed: false,
    signal: null,
    stderr: '',
    stdout: '',
    timedOut: false,
    ...overrides,
  };
}

function markedProcess(pid: number, pgid: number): BoundedTestProcessRecordForTest {
  return { marked: true, pgid, pid, ppid: 1, state: 'S' };
}

function unmarkedProcess(pid: number, pgid: number): BoundedTestProcessRecordForTest {
  return { marked: false, pgid, pid, ppid: 1, state: 'S' };
}

function processTable(
  ...records: readonly BoundedTestProcessRecordForTest[]
): Map<number, BoundedTestProcessRecordForTest> {
  return new Map(records.map((record) => [record.pid, record]));
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

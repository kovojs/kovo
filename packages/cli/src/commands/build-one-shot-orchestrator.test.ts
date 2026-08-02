import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import {
  encodeKovoBuildOneShotHandoff,
  KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
  type KovoBuildOneShotIdentity,
} from './build-one-shot-handoff.js';
import {
  KOVO_BUILD_ONE_SHOT_ORCHESTRATION_HEADROOM_MS,
  KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES,
  KOVO_BUILD_ONE_SHOT_WORKER_TIMEOUT_MS,
  STATIC_TRUST_WORKER_TIMEOUT_MS,
} from './build-security-deadlines.js';
import { boundedKovoBuildOneShotWorkerForTesting } from './build-one-shot-orchestrator.js';

const itIfPosix = process.platform === 'win32' ? it.skip : it;

function identity(): KovoBuildOneShotIdentity {
  const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
  return {
    appModulePath: 'src/app.tsx',
    compilerProvenanceDigest: digest('compiler'),
    configSourceDigest: digest('config'),
    invocationRoot: process.cwd(),
    optionsDigest: digest('options'),
    sourceSetDigest: digest('sources'),
  };
}

function wire(sourceBytes = 2 * 1024 * 1024): Buffer {
  const expectedIdentity = identity();
  return encodeKovoBuildOneShotHandoff({
    analysis: { source: 'x'.repeat(sourceBytes) },
    identity: expectedIdentity,
    schema: 'kovo-build-one-shot-analysis/v1',
  });
}

describe('one-shot build worker orchestration', () => {
  it('contains both static-trust preflights plus explicit orchestration headroom', () => {
    expect(KOVO_BUILD_ONE_SHOT_WORKER_TIMEOUT_MS).toBe(
      STATIC_TRUST_WORKER_TIMEOUT_MS * KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES.length +
        KOVO_BUILD_ONE_SHOT_ORCHESTRATION_HEADROOM_MS,
    );
    expect(KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES).toEqual(['config', 'app']);
    expect(KOVO_BUILD_ONE_SHOT_ORCHESTRATION_HEADROOM_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('pins, authenticates, flushes, and explicitly closes a multi-MiB worker input', async () => {
    const input = wire();
    const script = [
      "const { readSync, writeFileSync } = require('node:fs');",
      'const chunk = Buffer.allocUnsafe(64 * 1024);',
      'let total = 0;',
      'for (;;) {',
      '  const count = readSync(3, chunk, 0, chunk.byteLength, null);',
      '  if (count === 0) break;',
      '  total += count;',
      '}',
      "writeFileSync(4, String(total), 'utf8');",
    ].join('\n');

    const result = await boundedKovoBuildOneShotWorkerForTesting(
      process.execPath,
      ['-e', script],
      5_000,
      input,
    );
    expect(result.status).toBe(0);
    expect(Buffer.isBuffer(result.control)).toBe(true);
    expect(String(result.control)).toBe(String(input.byteLength));
  });

  it('rejects trailing and oversized input before a fake worker can run', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-one-shot-parent-rejection-'));
    const marker = join(root, 'worker-ran');
    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`;
    try {
      expect(() =>
        boundedKovoBuildOneShotWorkerForTesting(
          process.execPath,
          ['-e', script],
          1_000,
          Buffer.concat([wire(16), Buffer.from('trailing')]),
        ),
      ).toThrow(/payload length/u);
      expect(() =>
        boundedKovoBuildOneShotWorkerForTesting(
          process.execPath,
          ['-e', script],
          1_000,
          Buffer.allocUnsafe(KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES + 1),
        ),
      ).toThrow(/byte limit/u);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  itIfPosix(
    'kills the complete process group and awaits close at the phase deadline',
    async () => {
      const script = [
        "const { spawn } = require('node:child_process');",
        "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "  stdio: ['ignore', 'ignore', 'ignore', 'ignore', 'inherit'],",
        '});',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const startedAt = performance.now();

      await expect(
        boundedKovoBuildOneShotWorkerForTesting(process.execPath, ['-e', script], 100),
      ).rejects.toThrow(/test worker exceeded its 100ms deadline/u);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    },
    5_000,
  );

  itIfPosix(
    'settles the deadline when an escaped descendant retains the private output fd',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-one-shot-escaped-descendant-'));
      const pidPath = join(root, 'pid');
      const script = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const escaped = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        '  detached: true,',
        "  stdio: ['ignore', 'ignore', 'ignore', 'ignore', 'inherit'],",
        '});',
        `writeFileSync(${JSON.stringify(pidPath)}, String(escaped.pid));`,
        'escaped.unref();',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const startedAt = performance.now();
      try {
        await expect(
          boundedKovoBuildOneShotWorkerForTesting(process.execPath, ['-e', script], 500),
        ).rejects.toThrow(/test worker exceeded its 500ms deadline/u);
        expect(performance.now() - startedAt).toBeLessThan(2_000);
        expect(existsSync(pidPath)).toBe(true);
      } finally {
        if (existsSync(pidPath)) {
          const pid = Number(readFileSync(pidPath, 'utf8'));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {
              // The escaped fixture may race its explicit cleanup.
            }
          }
        }
        rmSync(root, { force: true, recursive: true });
      }
    },
    5_000,
  );

  itIfPosix(
    'reaps the active worker group when the thin parent receives SIGTERM',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-one-shot-parent-signal-'));
      const pidPath = join(root, 'worker-pid');
      const moduleUrl = new URL('./build-one-shot-orchestrator.ts', import.meta.url).href;
      const hookUrl = new URL('./build-static-trust-source-hook.mjs', import.meta.url).href;
      const workerScript = [
        "const { writeFileSync } = require('node:fs');",
        `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const parentScript =
        `import { boundedKovoBuildOneShotWorkerForTesting } from ${JSON.stringify(moduleUrl)};\n` +
        `await boundedKovoBuildOneShotWorkerForTesting(` +
        `${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(workerScript)}], 60_000);`;
      const parent = spawn(
        process.execPath,
        [
          '--disable-warning=ExperimentalWarning',
          '--experimental-transform-types',
          '--import',
          hookUrl,
          '--input-type=module',
          '--eval',
          parentScript,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let workerPid: number | undefined;
      let parentStderr = '';
      parent.stderr.on('data', (chunk: Buffer) => {
        parentStderr += chunk.toString('utf8');
      });
      try {
        await waitFor(() => existsSync(pidPath), 5_000, 'one-shot worker PID');
        workerPid = Number(readFileSync(pidPath, 'utf8'));
        expect(Number.isSafeInteger(workerPid) && workerPid > 0).toBe(true);
        parent.kill('SIGTERM');
        const result = await waitForChildClose(parent, 5_000);
        expect(result).toEqual({ code: null, signal: 'SIGTERM' });
        await waitFor(
          () => !processIsAlive(workerPid!),
          5_000,
          `one-shot worker ${String(workerPid)} exit`,
        );
      } catch (error) {
        throw new TypeError(
          `${error instanceof Error ? error.message : String(error)}\n${parentStderr}`,
        );
      } finally {
        parent.kill('SIGKILL');
        if (workerPid !== undefined && processIsAlive(workerPid)) {
          try {
            process.kill(-workerPid, 'SIGKILL');
          } catch {
            try {
              process.kill(workerPid, 'SIGKILL');
            } catch {
              // The fixture worker may race its explicit cleanup.
            }
          }
        }
        rmSync(root, { force: true, recursive: true });
      }
    },
    10_000,
  );

  itIfPosix(
    'leaves final output untouched while identifying unpromoted staging as timeout residue',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-one-shot-timeout-transaction-'));
      const finalOutDir = join(root, 'dist');
      writeFileSync(finalOutDir, 'last-good', 'utf8');
      const script = [
        "const { mkdtempSync, writeFileSync } = require('node:fs');",
        "const { join } = require('node:path');",
        `const stage = mkdtempSync(join(${JSON.stringify(root)}, '.kovo-build-stage-'));`,
        "writeFileSync(join(stage, 'partial'), 'not-deploy');",
        'setInterval(() => {}, 1000);',
      ].join('\n');
      try {
        await expect(
          boundedKovoBuildOneShotWorkerForTesting(process.execPath, ['-e', script], 500),
        ).rejects.toThrow(/test worker exceeded its 500ms deadline/u);
        expect(readFileSync(finalOutDir, 'utf8')).toBe('last-good');
        expect(
          readdirSync(root).filter((entry) => entry.startsWith('.kovo-build-stage-')),
        ).toHaveLength(1);
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    5_000,
  );

  itIfPosix(
    'kills the complete process group after bounded control output is exceeded',
    async () => {
      const script = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
        "  stdio: ['ignore', 'ignore', 'ignore', 'ignore', 'inherit'],",
        '});',
        'writeFileSync(4, Buffer.alloc(128 * 1024));',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const startedAt = performance.now();

      await expect(
        boundedKovoBuildOneShotWorkerForTesting(
          process.execPath,
          ['-e', script],
          5_000,
          undefined,
          64 * 1024,
        ),
      ).rejects.toThrow(/handoff exceeded its byte limit/u);
      expect(performance.now() - startedAt).toBeLessThan(2_000);
    },
    5_000,
  );
});

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new TypeError(`Timed out waiting for ${label}.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function waitForChildClose(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TypeError('Timed out waiting for thin parent exit.')),
      timeoutMs,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

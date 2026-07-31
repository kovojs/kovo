import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { runBoundedProcessForTesting } from './bounded-cli.js';

describe('bounded CLI test process', () => {
  it('captures bounded stdout and stderr without treating nonzero status as transport failure', async () => {
    const result = await runBoundedProcessForTesting({
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err'); process.exit(7);"],
      cwd: process.cwd(),
      deadlineMs: 5_000,
      executable: process.execPath,
    });

    expect(result).toEqual({ exitCode: 7, stderr: 'err', stdout: 'out' });
  });

  it('fails closed when the combined output capture limit is exceeded', async () => {
    await expect(
      runBoundedProcessForTesting({
        args: ['-e', 'process.stdout.write(Buffer.alloc(2048)); setInterval(() => {}, 1000);'],
        cwd: process.cwd(),
        deadlineMs: 5_000,
        executable: process.execPath,
        maxCapturedOutputBytes: 1_024,
      }),
    ).rejects.toThrow(/exceeded its 1024-byte output capture limit/u);
  });

  it.skipIf(process.platform === 'win32')(
    'terminates a detached grandchild after its intermediate parent exits and releases inherited pipes',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'kovo-bounded-cli-tree-'));
      const grandchildPidPath = join(root, 'grandchild-pid');
      const grandchildSource = [
        "process.on('SIGTERM', () => undefined);",
        'setInterval(() => {}, 1000);',
      ].join('');
      const intermediateSource = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], {`,
        '  detached: true,',
        "  stdio: ['ignore', 'inherit', 'inherit'],",
        '});',
        `writeFileSync(${JSON.stringify(grandchildPidPath)}, String(grandchild.pid));`,
        'grandchild.unref();',
      ].join('\n');
      const source = [
        "const { spawn } = require('node:child_process');",
        `spawn(process.execPath, ['-e', ${JSON.stringify(intermediateSource)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const startedAt = performance.now();
      let grandchildPid: number | undefined;

      try {
        await expect(
          runBoundedProcessForTesting({
            args: ['-e', source],
            cwd: root,
            deadlineMs: 250,
            executable: process.execPath,
          }),
        ).rejects.toThrow(/exceeded its 250ms deadline and was terminated/u);
        expect(performance.now() - startedAt).toBeLessThan(3_000);
        expect(existsSync(grandchildPidPath)).toBe(true);
        grandchildPid = Number(readFileSync(grandchildPidPath, 'utf8'));
        await expectProcessToExit(grandchildPid, 2_000);
      } finally {
        if (grandchildPid !== undefined && processIsAlive(grandchildPid)) {
          try {
            process.kill(grandchildPid, 'SIGKILL');
          } catch {
            // The fixture grandchild may race its explicit cleanup.
          }
        }
        rmSync(root, { force: true, recursive: true });
      }
    },
    5_000,
  );
});

async function expectProcessToExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (processIsAlive(pid)) {
    if (performance.now() >= deadline) throw new TypeError(`Process ${String(pid)} did not exit.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

  it('terminates detached descendants and awaits root close at the child deadline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-bounded-cli-tree-'));
    const descendantPidPath = join(root, 'descendant-pid');
    const descendantSource = 'setInterval(() => {}, 1000);';
    const source = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], {`,
      '  detached: true,',
      "  stdio: 'ignore',",
      '});',
      `writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));`,
      'descendant.unref();',
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const startedAt = performance.now();
    let descendantPid: number | undefined;

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
      expect(existsSync(descendantPidPath)).toBe(true);
      descendantPid = Number(readFileSync(descendantPidPath, 'utf8'));
      await expectProcessToExit(descendantPid, 2_000);
    } finally {
      if (descendantPid !== undefined && processIsAlive(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The fixture descendant may race its explicit cleanup.
        }
      }
      rmSync(root, { force: true, recursive: true });
    }
  }, 5_000);
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

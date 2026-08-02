import { describe, expect, it, vi } from 'vitest';

import { knownFailurePackedRuntimeEnvironment } from './known-failure-packed-release.mjs';
import { runKnownFailureProbeCommand } from './known-failure-probe-process.mjs';

const invocation = Object.freeze({
  args: ['build', './src/app.tsx'],
  command: '/usr/bin/node',
  cwd: '/tmp/packed-app',
  env: { PATH: '/bin' },
  label: 'initial packed build',
  timeoutMs: 180_000,
});

describe('known-failure packed command supervision', () => {
  it('removes repository-only Node source transforms from packed public executables', () => {
    const prior = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS =
      '--experimental-transform-types --disable-warning=ExperimentalWarning';
    try {
      const environment = knownFailurePackedRuntimeEnvironment(
        { nodeModules: '/tmp/known-failure-packed/node_modules' },
        { NODE_ENV: 'development' },
      );
      expect(environment).not.toHaveProperty('NODE_OPTIONS');
      expect(environment.NODE_ENV).toBe('development');
      expect(environment.PATH).toMatch(/^\/tmp\/known-failure-packed\/node_modules\/\.bin/u);
    } finally {
      if (prior === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = prior;
    }
  });

  it('binds the command deadline and every cleanup phase to the owned invocation', async () => {
    const runProcess = vi.fn(async () => ordinaryResult());

    await expect(runKnownFailureProbeCommand(invocation, { runProcess })).resolves.toMatchObject({
      error: null,
      signal: null,
      status: 0,
    });
    expect(runProcess).toHaveBeenCalledWith({
      args: invocation.args,
      captureOutput: true,
      censusTimeoutMs: 3_000,
      command: invocation.command,
      cwd: invocation.cwd,
      env: invocation.env,
      forwardOutput: false,
      killGraceMs: 3_000,
      maxOutputBytes: 32 * 1024 * 1024,
      rootExitTimeoutMs: 3_000,
      streamCloseTimeoutMs: 3_000,
      supervisorTimeoutMs: invocation.timeoutMs,
      terminationGraceMs: 3_000,
    });
  });

  it('reports the exact phase, deadline, elapsed time, and bounded output on timeout', async () => {
    const runProcess = async () => ({
      ...ordinaryResult(),
      durationMs: 180_042.2,
      exitCode: null,
      signal: 'SIGKILL',
      stderr: 'build stderr sentinel',
      stdout: 'build stdout sentinel',
      timedOut: true,
    });

    await expect(runKnownFailureProbeCommand(invocation, { runProcess })).rejects.toThrow(
      /initial packed build exceeded its 180000ms deadline; ended with signal SIGKILL; did not return an integer exit status \(elapsed=180043ms\)[\s\S]*build stdout sentinel[\s\S]*build stderr sentinel/u,
    );
  });

  it('keeps a truncated command diagnostic inside the 32 KiB output allowance', async () => {
    const runProcess = async () => ({
      ...ordinaryResult(),
      exitCode: null,
      stdout: 'x'.repeat(64 * 1024),
      timedOut: true,
    });

    const error = await runKnownFailureProbeCommand(invocation, { runProcess }).catch(
      (failure) => failure,
    );
    expect(error).toBeInstanceOf(Error);
    const diagnostic = error.message.slice(error.message.indexOf('\n--- stdout ---'));
    expect(diagnostic).toContain('... packed command output truncated ...');
    expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(32 * 1024);
  });

  it('returns an ordinary non-zero exit for the defect classifier to interpret', async () => {
    const runProcess = async () => ({ ...ordinaryResult(), exitCode: 1, stderr: 'ERROR KV417' });

    await expect(runKnownFailureProbeCommand(invocation, { runProcess })).resolves.toMatchObject({
      status: 1,
      stderr: 'ERROR KV417',
    });
  });

  it('fails closed when an ordinary root exit cannot prove descendant cleanup', async () => {
    const runProcess = async () => ({
      ...ordinaryResult(),
      cleanupError: 'marker descendant survived SIGKILL',
    });

    await expect(runKnownFailureProbeCommand(invocation, { runProcess })).rejects.toThrow(
      'initial packed build could not prove process-tree cleanup: marker descendant survived SIGKILL',
    );
  });
});

function ordinaryResult() {
  return {
    cleanupError: null,
    durationMs: 42,
    error: null,
    exitCode: 0,
    outputOverflowed: false,
    signal: null,
    stderr: '',
    stdout: '',
    timedOut: false,
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { commandRequestToArgv, parseKovoCommandInvocation } from './commands-manifest.js';
import { testCommandShell } from './commands/test.js';
import { mainAsync } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('kovo test', () => {
  it('derives test selection from the semantic schema and delegates to the bundled runner', async () => {
    expect(
      parseKovoCommandInvocation('test', [
        'src/app.test.ts',
        '--coverage',
        '--update',
        '--reporter',
        'dot',
        '-t',
        'authenticated round trip',
      ]),
    ).toEqual({
      ok: true,
      value: {
        arguments: { files: ['src/app.test.ts'] },
        command: 'test',
        form: 'test',
        options: {
          coverage: true,
          passWithNoTests: false,
          reporter: 'dot',
          testNamePattern: 'authenticated round trip',
          update: true,
        },
      },
    });
    expect(
      commandRequestToArgv({
        arguments: { files: ['src/app.test.ts'] },
        command: 'test',
        form: 'test',
        options: { coverage: true, reporter: 'dot' },
      }),
    ).toEqual(['test', 'src/app.test.ts', '--coverage', '--reporter', 'dot']);

    const spawn = vi.spyOn(testCommandShell, 'spawnSync').mockReturnValue({
      output: [],
      pid: 10,
      signal: null,
      status: 0,
      stderr: null,
      stdout: null,
    });
    const output = await capture([
      'test',
      'src/app.test.ts',
      '--coverage',
      '--reporter=dot',
      '--pass-with-no-tests',
    ]);

    expect(output).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'kovo-test/v1\nPASS\n',
    });
    expect(spawn).toHaveBeenCalledOnce();
    const [command, args, options] = spawn.mock.calls[0]!;
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      expect.stringMatching(/node_modules[/\\]vite-plus[/\\]bin[/\\]vp$/u),
      'test',
      '--run',
      '--config',
      expect.stringMatching(/packages[/\\]cli[/\\]src[/\\]test-runner-config\.ts$/u),
      'src/app.test.ts',
      '--coverage',
      '--passWithNoTests',
      '--reporter',
      'dot',
    ]);
    expect(options).toMatchObject({
      cwd: '/app',
      env: expect.not.objectContaining({ KOVO_CLI_TRANSFORM_TYPES: expect.anything() }),
      stdio: 'inherit',
    });
    expect(options?.env).toMatchObject({ BETTER_AUTH_URL: 'http://127.0.0.1:4173' });
  });

  it('maps test findings to exit 1 and runner failures to exit 2', async () => {
    const spawn = vi.spyOn(testCommandShell, 'spawnSync');
    spawn.mockReturnValueOnce({
      output: [],
      pid: 10,
      signal: null,
      status: 1,
      stderr: null,
      stdout: null,
    });
    const finding = await capture(['test']);
    expect(finding.exitCode).toBe(1);
    expect(finding.stderr).toBe('kovo-test/v1\nFAIL tests\n');

    spawn.mockReturnValueOnce({
      output: [],
      pid: 11,
      signal: null,
      status: 2,
      stderr: null,
      stdout: null,
    });
    const runnerError = await capture(['test']);
    expect(runnerError.exitCode).toBe(2);
    expect(runnerError.stderr).toBe('kovo-test/v1\nERROR runner status=2\n');
  });

  it('rejects unsupported runner flags through generated usage', async () => {
    const spawn = vi.spyOn(testCommandShell, 'spawnSync');
    const output = await capture(['test', '--pool', 'forks']);
    expect(output.exitCode).toBe(2);
    expect(output.stderr).toContain('KOVO_USAGE');
    expect(output.stderr).toContain('unknown test option "--pool"');
    expect(spawn).not.toHaveBeenCalled();
  });
});

async function capture(
  args: readonly string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let stdout = '';
  let stderr = '';
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write);
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write);
  try {
    const exitCode = await mainAsync(args, {
      invocationCwd: '/app',
      invocationEnv: { KOVO_CLI_TRANSFORM_TYPES: '1' },
      paranoidStaticAdvisory: false,
    });
    return { exitCode, stderr, stdout };
  } finally {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  }
}

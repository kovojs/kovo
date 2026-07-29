import type { ExecFileException } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { projectQualityCommandShell, runProjectQualityCheck } from './project-quality.js';

afterEach(() => vi.restoreAllMocks());

describe('framework-owned project quality check', () => {
  it('bounds formatter and linter threads and preserves producer-owned source anchors', async () => {
    const root = fixtureRoot();
    try {
      const source = realpathSync(join(root, 'src/app.ts'));
      const execute = vi.spyOn(projectQualityCommandShell, 'execFile').mockImplementation(((
        _command,
        args,
        _options,
        callback,
      ) => {
        const toolArgs = args as readonly string[];
        if (toolArgs.includes('fmt')) {
          callback(exit(1), 'src/app.ts\n', '');
        } else {
          callback(
            exit(1),
            JSON.stringify({
              diagnostics: [
                {
                  code: 'typescript/no-explicit-any',
                  filename: source,
                  labels: [{ span: { length: 3, offset: 15 } }],
                  message: 'Unexpected any.',
                },
              ],
            }),
            '',
          );
        }
        return {} as ReturnType<typeof projectQualityCommandShell.execFile>;
      }) as typeof projectQualityCommandShell.execFile);

      const result = await runProjectQualityCheck(root, {}, 'kovo-check/v1');

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute.mock.calls.map((call) => call[1]?.slice(1))).toEqual([
        ['fmt', '--list-different', '--threads=1'],
        ['lint', '--format=json', '--threads=1'],
      ]);
      expect(result).toMatchObject({ exitCode: 1 });
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'KOVO_PROJECT_QUALITY',
          source: { end: 1, file: source, start: 0 },
        }),
        expect.objectContaining({
          code: 'KOVO_PROJECT_QUALITY',
          source: { end: 18, file: source, start: 15 },
        }),
      ]);
      expect(result.output).toContain('ERROR PROJECT-QUALITY src/app.ts:15-18');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('returns a clean versioned fact only when both tools agree', async () => {
    const root = fixtureRoot();
    try {
      vi.spyOn(projectQualityCommandShell, 'execFile').mockImplementation(((
        _command,
        args,
        _options,
        callback,
      ) => {
        callback(
          null,
          (args as readonly string[]).includes('lint') ? JSON.stringify({ diagnostics: [] }) : '',
          '',
        );
        return {} as ReturnType<typeof projectQualityCommandShell.execFile>;
      }) as typeof projectQualityCommandShell.execFile);

      await expect(runProjectQualityCheck(root, {}, 'kovo-build/v1')).resolves.toEqual({
        exitCode: 0,
        output: 'kovo-build/v1\nOK PROJECT-QUALITY format=clean lint=clean\n',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('fails closed when a report escapes the enrolled project root', async () => {
    const root = fixtureRoot();
    try {
      vi.spyOn(projectQualityCommandShell, 'execFile').mockImplementation(((
        _command,
        args,
        _options,
        callback,
      ) => {
        const isLint = (args as readonly string[]).includes('lint');
        callback(
          isLint ? exit(1) : null,
          isLint
            ? JSON.stringify({
                diagnostics: [{ filename: '/tmp/outside.ts', message: 'outside' }],
              })
            : '',
          '',
        );
        return {} as ReturnType<typeof projectQualityCommandShell.execFile>;
      }) as typeof projectQualityCommandShell.execFile);

      const result = await runProjectQualityCheck(root, {}, 'kovo-check/v1');
      expect(result).toMatchObject({
        diagnostics: [expect.objectContaining({ code: 'KOVO_PROJECT_QUALITY' })],
        exitCode: 2,
      });
      expect(result.error).toContain('linter diagnostic 0 escapes root');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kovo-project-quality-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'src/app.ts'), 'export const value: any = 1;\n');
  return root;
}

function exit(code: number): ExecFileException {
  return Object.assign(new Error(`exit ${String(code)}`), { code });
}

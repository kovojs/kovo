import type { ExecFileException } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
        if (toolArgs.includes('--eval')) {
          callback(
            null,
            JSON.stringify({
              fmt: { semi: true, singleQuote: true },
              lint: {},
              schema: 'kovo-project-quality-config/v1',
            }),
            '',
          );
        } else if (toolArgs[0]?.endsWith('/oxfmt') || toolArgs[0]?.endsWith('\\oxfmt')) {
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

      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[0]?.[1]).toEqual([
        '--input-type=module',
        '--eval',
        expect.stringContaining('loadConfigFromFile'),
        expect.stringMatching(/[/\\]vite-plus[/\\]dist[/\\]index\.(?:c?js)$/u),
      ]);
      expect(execute.mock.calls[1]?.[1]).toEqual([
        expect.stringMatching(/[/\\]oxfmt[/\\]bin[/\\]oxfmt$/u),
        '--config',
        expect.stringMatching(/[/\\]\.kovo-project-quality-[\w-]+\.oxfmtrc\.json$/u),
        '--list-different',
        '--threads=1',
      ]);
      expect(execute.mock.calls[1]?.[2]?.env).toMatchObject({
        JS_RUNTIME_NAME: process.release.name,
        JS_RUNTIME_VERSION: process.versions.node,
        NODE_PACKAGE_MANAGER: 'vite-plus',
      });
      expect(execute.mock.calls[2]?.[1]).toEqual([
        expect.stringMatching(/[/\\]oxlint[/\\]bin[/\\]oxlint$/u),
        '--config',
        expect.stringMatching(/[/\\]\.kovo-project-quality-[\w-]+\.oxlintrc\.json$/u),
        '--format=json',
        '--threads=1',
      ]);
      expect(execute.mock.calls[2]?.[2]?.env?.OXLINT_TSGOLINT_PATH).toMatch(
        /[/\\]oxlint-tsgolint[/\\]bin[/\\]tsgolint(?:\.js)?$/u,
      );
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
        const toolArgs = args as readonly string[];
        callback(
          null,
          toolArgs.includes('--eval')
            ? JSON.stringify({
                fmt: {},
                lint: {},
                schema: 'kovo-project-quality-config/v1',
              })
            : toolArgs[0]?.endsWith('/oxlint') || toolArgs[0]?.endsWith('\\oxlint')
              ? JSON.stringify({ diagnostics: [] })
              : '',
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

  it('checks unimported copied source through whole-project formatter semantics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-project-quality-copy-in-'));
    try {
      mkdirSync(join(root, 'src/components/ui'), { recursive: true });
      writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
      writeFileSync(
        join(root, 'vite.config.mjs'),
        `export default {
  fmt: { semi: true, singleQuote: true },
  lint: {},
  plugins: [{ name: 'must-not-run-for-project-quality', configResolved() {
    throw new Error('project-quality invoked unrelated Vite plugin hooks');
  } }],
};\n`,
      );
      writeFileSync(join(root, 'src/app.ts'), 'export const value = 1;\n');
      writeFileSync(
        join(root, 'src/components/ui/unimported-card.tsx'),
        'export const card={label:"Card"}\n',
      );

      const result = await runProjectQualityCheck(root, process.env, 'kovo-check/v1');

      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ exitCode: 1 });
      expect(result.output).toContain(
        'ERROR PROJECT-QUALITY src/components/ui/unimported-card.tsx:0-1',
      );
      expect(result.output).not.toContain('.kovo-project-quality-');
      expect(readdirSync(root).some((name) => name.startsWith('.kovo-project-quality-'))).toBe(
        false,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 30_000);

  it('fails closed before formatter or lint when resolved formatter policy is malformed', async () => {
    const root = fixtureRoot();
    try {
      const execute = vi.spyOn(projectQualityCommandShell, 'execFile').mockImplementation(((
        _command,
        _args,
        _options,
        callback,
      ) => {
        callback(null, '{"schema":"unexpected","config":{}}', '');
        return {} as ReturnType<typeof projectQualityCommandShell.execFile>;
      }) as typeof projectQualityCommandShell.execFile);

      const result = await runProjectQualityCheck(root, {}, 'kovo-check/v1');

      expect(execute).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        diagnostics: [expect.objectContaining({ code: 'KOVO_PROJECT_QUALITY' })],
        exitCode: 2,
      });
      expect(result.error).toContain('formatter config resolver report is invalid');
      expect(readdirSync(root).some((name) => name.startsWith('.kovo-project-quality-'))).toBe(
        false,
      );
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
        const toolArgs = args as readonly string[];
        const isProbe = toolArgs.includes('--eval');
        const isLint = toolArgs[0]?.endsWith('/oxlint') || toolArgs[0]?.endsWith('\\oxlint');
        callback(
          isLint ? exit(1) : null,
          isProbe
            ? JSON.stringify({
                fmt: {},
                lint: {},
                schema: 'kovo-project-quality-config/v1',
              })
            : isLint
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

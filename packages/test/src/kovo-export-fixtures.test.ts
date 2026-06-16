import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  kovoExportCliResultFact,
  kovoExportStaticBehaviorFact,
  parseKovoExportOutput,
  type KovoExportStaticDiagnosticLike,
} from './kovo-export-fixtures.js';

describe('@kovojs/test kovo export fixture seam', () => {
  it('turns successful kovo export CLI output into structured artifact facts', () => {
    expect(
      parseKovoExportOutput(
        [
          'kovo-export/v1',
          'HTML /index.html status=200 bytes=42',
          'SUMMARY html=1 clientModules=0 diagnostics=0 outDir="/tmp/kovo export"',
          '',
        ].join('\n'),
      ),
    ).toEqual({
      errors: [],
      html: [{ bytes: 42, path: '/index.html', status: 200 }],
      summary: {
        clientModules: '0',
        diagnostics: '0',
        html: '1',
        outDir: '"/tmp/kovo export"',
      },
      version: 'kovo-export/v1',
    });
  });

  it('keeps error output structured without making kovo-check parse line text', () => {
    expect(
      parseKovoExportOutput(
        [
          'kovo-export/v1',
          'ERROR KV201 route=src/cart.tsx Component must be statically renderable.',
          'Use server-only values behind queries.',
        ].join('\n'),
      ),
    ).toMatchObject({
      errors: [
        {
          code: 'KV201',
          message:
            'Component must be statically renderable.\nUse server-only values behind queries.',
          route: 'src/cart.tsx',
        },
      ],
      html: [],
    });
  });

  it('projects CLI result facts without local stream or byte checks', () => {
    expect(
      kovoExportCliResultFact({
        exitCode: 0,
        stderr: '',
        stdout: [
          'kovo-export/v1',
          'HTML /index.html status=200 bytes=42',
          'SUMMARY html=1 clientModules=0 diagnostics=0 outDir="/tmp/kovo export"',
          '',
        ].join('\n'),
      }),
    ).toEqual({
      errors: [],
      exitCode: 0,
      html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
      outputStream: 'stdout',
      summary: {
        clientModules: '0',
        diagnostics: '0',
        html: '1',
        outDir: '"/tmp/kovo export"',
      },
      version: 'kovo-export/v1',
    });

    expect(
      kovoExportCliResultFact({
        exitCode: 1,
        stderr: [
          'kovo-export/v1',
          'ERROR KV201 route=src/cart.tsx Component must be statically renderable.',
          '',
        ].join('\n'),
        stdout: '',
      }),
    ).toMatchObject({
      errors: [
        {
          code: 'KV201',
          route: 'src/cart.tsx',
        },
      ],
      exitCode: 1,
      html: [],
      outputStream: 'stderr',
    });
  });

  it('runs red/green static export behavior through reusable fixture mechanics', async () => {
    const errorDiagnostic: KovoExportStaticDiagnosticLike = {
      code: 'KV201',
      fileName: 'routes/cart.tsx',
      message: 'Component must be statically renderable.',
    };
    const lintDiagnostic: KovoExportStaticDiagnosticLike = {
      code: 'KV210',
      fileName: 'routes/cart.tsx',
      message: 'Event handler should be lowered.',
    };
    const expectedError = 'Static export blocked by KV201.';
    const expectedCliError = 'Static export blocked by KV201.';
    const createApp = (options: { routes: unknown[] }) => ({ routes: options.routes });
    const serverRoute = (path: string, options: { page: () => string }) => ({ options, path });
    const exportStaticApp = async (
      app: unknown,
      options: { diagnostics: KovoExportStaticDiagnosticLike[]; outDir: string },
    ) => {
      if (options.diagnostics.some((diagnostic) => diagnostic.code === 'KV201')) {
        const error = new Error(expectedError) as Error & {
          code: string;
          diagnostics: KovoExportStaticDiagnosticLike[];
        };
        error.name = 'StaticExportError';
        error.code = 'KV201';
        error.diagnostics = options.diagnostics;
        throw error;
      }

      await mkdir(options.outDir, { recursive: true });
      const html = (
        app as { routes: Array<{ options: { page: () => string } }> }
      ).routes[0]!.options.page();
      await writeFile(join(options.outDir, 'index.html'), html, 'utf8');
      return { artifacts: [{ body: html, path: '/index.html' }], diagnostics: [] };
    };
    const runCliCommand = async (args: string[]) => {
      const modulePath = args[1]!;
      const outDir = args[3]!;
      const moduleSource = await readFile(modulePath, 'utf8');
      if (moduleSource.includes('"KV201"')) {
        return {
          exitCode: 1,
          stderr: [
            'kovo-export/v1',
            `ERROR KV201 route=routes/cart.tsx ${expectedCliError}`,
            '',
          ].join('\n'),
          stdout: '',
        };
      }

      await mkdir(outDir, { recursive: true });
      await writeFile(
        join(outDir, 'index.html'),
        '<main data-kovo-check-export="cli"></main>',
        'utf8',
      );
      return {
        exitCode: 0,
        stderr: '',
        stdout: [
          'kovo-export/v1',
          'HTML /index.html status=200 bytes=42',
          `SUMMARY html=1 clientModules=0 diagnostics=0 outDir=${JSON.stringify(outDir)}`,
          '',
        ].join('\n'),
      };
    };

    await expect(
      kovoExportStaticBehaviorFact({
        appCoreModuleUrl: 'file:///tmp/app-shell.mjs',
        createApp,
        errorDiagnostic,
        expectedStaticExportCliError: expectedCliError,
        expectedStaticExportError: expectedError,
        exportStaticApp,
        fixturePrefix: 'kovo-kovo-export-test-',
        lintDiagnostic,
        runCliCommand,
        serverModuleUrl: 'file:///tmp/server.mjs',
        serverRoute,
      }),
    ).resolves.toEqual({
      api: {
        greenArtifactBodyMatchesDisk: true,
        greenArtifactDiagnostics: 0,
        greenArtifactPath: '/index.html',
        greenMarker: {
          attribute: 'data-kovo-check-export',
          mainCount: 1,
          marker: 'api',
        },
        redArtifactWritten: false,
        redError: {
          code: 'KV201',
          diagnosticCodes: ['KV201'],
          message: expectedError,
          name: 'StaticExportError',
        },
      },
      cli: {
        green: {
          errors: [],
          exitCode: 0,
          html: [{ bytesArePositive: true, path: '/index.html', status: 200 }],
          outputStream: 'stdout',
          summary: {
            clientModules: '0',
            diagnostics: '0',
            html: '1',
            outDir: expect.any(String),
          },
          version: 'kovo-export/v1',
        },
        greenMarker: {
          attribute: 'data-kovo-check-export',
          mainCount: 1,
          marker: 'cli',
        },
        red: {
          errors: [
            {
              code: 'KV201',
              message: expectedCliError,
              route: 'routes/cart.tsx',
            },
          ],
          exitCode: 1,
          html: [],
          outputStream: 'stderr',
          version: 'kovo-export/v1',
        },
        redArtifactWritten: false,
      },
    });
  });

  it('rejects malformed kovo export output at the fixture seam', () => {
    expect(() => parseKovoExportOutput('kovo-check/v1\nOK')).toThrow(
      'kovo export output starts with kovo-export/v1: kovo-check/v1',
    );
    expect(() => parseKovoExportOutput('kovo-export/v1\nHTML /index.html status=ok')).toThrow(
      'Malformed kovo export HTML line',
    );
    expect(() => parseKovoExportOutput('kovo-export/v1\nSUMMARY html')).toThrow(
      'Malformed kovo export summary field',
    );
    expect(() =>
      kovoExportCliResultFact({
        exitCode: 1,
        stderr: 'kovo-export/v1\nERROR KV201 route=src/cart.tsx',
        stdout: 'kovo-export/v1\nSUMMARY html=0',
      }),
    ).toThrow('kovo export CLI result writes structured output to exactly one stream');
    expect(() => kovoExportCliResultFact({ exitCode: 1, stderr: '', stdout: '' })).toThrow(
      'kovo export CLI result includes structured output',
    );
  });
});

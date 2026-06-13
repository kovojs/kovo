import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fwExportCliResultFact,
  fwExportStaticBehaviorFact,
  parseFwExportOutput,
  type FwExportStaticDiagnosticLike,
} from './fw-export-fixtures.js';

describe('@jiso/test fw export fixture seam', () => {
  it('turns successful fw export CLI output into structured artifact facts', () => {
    expect(
      parseFwExportOutput(
        [
          'fw-export/v1',
          'HTML /index.html status=200 bytes=42',
          'SUMMARY html=1 clientModules=0 diagnostics=0 outDir="/tmp/jiso export"',
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
        outDir: '"/tmp/jiso export"',
      },
      version: 'fw-export/v1',
    });
  });

  it('keeps error output structured without making fw-check parse line text', () => {
    expect(
      parseFwExportOutput(
        [
          'fw-export/v1',
          'ERROR FW201 route=src/cart.tsx Component must be statically renderable.',
          'Use server-only values behind queries.',
        ].join('\n'),
      ),
    ).toMatchObject({
      errors: [
        {
          code: 'FW201',
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
      fwExportCliResultFact({
        exitCode: 0,
        stderr: '',
        stdout: [
          'fw-export/v1',
          'HTML /index.html status=200 bytes=42',
          'SUMMARY html=1 clientModules=0 diagnostics=0 outDir="/tmp/jiso export"',
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
        outDir: '"/tmp/jiso export"',
      },
      version: 'fw-export/v1',
    });

    expect(
      fwExportCliResultFact({
        exitCode: 1,
        stderr: [
          'fw-export/v1',
          'ERROR FW201 route=src/cart.tsx Component must be statically renderable.',
          '',
        ].join('\n'),
        stdout: '',
      }),
    ).toMatchObject({
      errors: [
        {
          code: 'FW201',
          route: 'src/cart.tsx',
        },
      ],
      exitCode: 1,
      html: [],
      outputStream: 'stderr',
    });
  });

  it('runs red/green static export behavior through reusable fixture mechanics', async () => {
    const errorDiagnostic: FwExportStaticDiagnosticLike = {
      code: 'FW201',
      fileName: 'routes/cart.tsx',
      message: 'Component must be statically renderable.',
    };
    const lintDiagnostic: FwExportStaticDiagnosticLike = {
      code: 'FW210',
      fileName: 'routes/cart.tsx',
      message: 'Event handler should be lowered.',
    };
    const expectedError = 'Static export blocked by FW201.';
    const expectedCliError = 'Static export blocked by FW201.';
    const createApp = (options: { routes: unknown[] }) => ({ routes: options.routes });
    const serverRoute = (path: string, options: { page: () => string }) => ({ options, path });
    const exportStaticApp = async (
      app: unknown,
      options: { diagnostics: FwExportStaticDiagnosticLike[]; outDir: string },
    ) => {
      if (options.diagnostics.some((diagnostic) => diagnostic.code === 'FW201')) {
        const error = new Error(expectedError) as Error & {
          code: string;
          diagnostics: FwExportStaticDiagnosticLike[];
        };
        error.name = 'StaticExportError';
        error.code = 'FW201';
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
      if (moduleSource.includes('"FW201"')) {
        return {
          exitCode: 1,
          stderr: [
            'fw-export/v1',
            `ERROR FW201 route=routes/cart.tsx ${expectedCliError}`,
            '',
          ].join('\n'),
          stdout: '',
        };
      }

      await mkdir(outDir, { recursive: true });
      await writeFile(
        join(outDir, 'index.html'),
        '<main data-fw-check-export="cli"></main>',
        'utf8',
      );
      return {
        exitCode: 0,
        stderr: '',
        stdout: [
          'fw-export/v1',
          'HTML /index.html status=200 bytes=42',
          `SUMMARY html=1 clientModules=0 diagnostics=0 outDir=${JSON.stringify(outDir)}`,
          '',
        ].join('\n'),
      };
    };

    await expect(
      fwExportStaticBehaviorFact({
        appCoreModuleUrl: 'file:///tmp/app-shell.mjs',
        createApp,
        errorDiagnostic,
        expectedStaticExportCliError: expectedCliError,
        expectedStaticExportError: expectedError,
        exportStaticApp,
        fixturePrefix: 'jiso-fw-export-test-',
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
          attribute: 'data-fw-check-export',
          mainCount: 1,
          marker: 'api',
        },
        redArtifactWritten: false,
        redError: {
          code: 'FW201',
          diagnosticCodes: ['FW201'],
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
          version: 'fw-export/v1',
        },
        greenMarker: {
          attribute: 'data-fw-check-export',
          mainCount: 1,
          marker: 'cli',
        },
        red: {
          errors: [
            {
              code: 'FW201',
              message: expectedCliError,
              route: 'routes/cart.tsx',
            },
          ],
          exitCode: 1,
          html: [],
          outputStream: 'stderr',
          version: 'fw-export/v1',
        },
        redArtifactWritten: false,
      },
    });
  });

  it('rejects malformed fw export output at the fixture seam', () => {
    expect(() => parseFwExportOutput('fw-check/v1\nOK')).toThrow(
      'fw export output starts with fw-export/v1: fw-check/v1',
    );
    expect(() => parseFwExportOutput('fw-export/v1\nHTML /index.html status=ok')).toThrow(
      'Malformed fw export HTML line',
    );
    expect(() => parseFwExportOutput('fw-export/v1\nSUMMARY html')).toThrow(
      'Malformed fw export summary field',
    );
    expect(() =>
      fwExportCliResultFact({
        exitCode: 1,
        stderr: 'fw-export/v1\nERROR FW201 route=src/cart.tsx',
        stdout: 'fw-export/v1\nSUMMARY html=0',
      }),
    ).toThrow('fw export CLI result writes structured output to exactly one stream');
    expect(() => fwExportCliResultFact({ exitCode: 1, stderr: '', stdout: '' })).toThrow(
      'fw export CLI result includes structured output',
    );
  });
});

import { describe, expect, it } from 'vitest';

import { fwExportCliResultFact, parseFwExportOutput } from './fw-export-fixtures.js';

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

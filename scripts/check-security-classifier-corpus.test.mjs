import { describe, expect, it } from 'vitest';

import { evaluateSecurityClassifierCorpus } from './check-security-classifier-corpus.mjs';

describe('check-security-classifier-corpus gate', () => {
  it('requires a marker for every configured security classifier corpus', () => {
    const result = evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts', 'redos-pattern.test.ts'],
        },
        {
          id: 'egress-ip',
          marker: '@kovo-security-classifier-corpus egress-ip',
          testFiles: ['egress.test.ts'],
        },
      ],
      readText: (file) =>
        file === 'redos.test.ts'
          ? '// @kovo-security-classifier-corpus redos\n'
          : 'no corpus marker\n',
      run: () => ({ ok: true, output: '' }),
    });

    expect(result).toMatchObject({
      corpora: 2,
      ok: false,
      findings: [
        'egress-ip: no test file contains marker "@kovo-security-classifier-corpus egress-ip"',
      ],
    });
  });

  it('runs the required corpus tests after all markers are present', () => {
    const result = evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts', 'redos-pattern.test.ts'],
        },
      ],
      readText: () => '// @kovo-security-classifier-corpus redos\n',
      run: (testFiles) => ({
        ok: true,
        output: testFiles.join(','),
      }),
    });

    expect(result).toEqual({
      corpora: 1,
      findings: [],
      ok: true,
      testFiles: ['redos.test.ts', 'redos-pattern.test.ts'],
    });
  });

  it('fails when the corpus test runner fails', () => {
    const result = evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
        },
      ],
      readText: () => '// @kovo-security-classifier-corpus redos\n',
      run: () => ({ ok: false, output: 'KV434 corpus regression' }),
    });

    expect(result).toEqual({
      corpora: 1,
      findings: ['KV434 corpus regression'],
      ok: false,
      testFiles: ['redos.test.ts'],
    });
  });
});

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

  it('fails when a configured verdict anchor disappears from a corpus test', () => {
    const result = evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'round-18-nested-quantifier',
              file: 'redos.test.ts',
              snippets: ['([\\w)]+)+', 'toThrow(RedosPatternError)'],
            },
          ],
        },
      ],
      readText: () =>
        '// @kovo-security-classifier-corpus redos\nit("no nested regression here")\n',
      run: () => ({ ok: true, output: '' }),
    });

    expect(result).toMatchObject({
      corpora: 1,
      ok: false,
      findings: ['redos: missing verdict anchor "round-18-nested-quantifier" in redos.test.ts'],
    });
  });

  it('returns red when known regression anchors are conceptually mutated away', () => {
    const cases = [
      {
        corpus: {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'round-18-nested-quantifier',
              file: 'redos.test.ts',
              snippets: ['([\\w)]+)+', 'toThrow(RedosPatternError)'],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus redos\nexpect(() => assertLinearSafePattern("safe"));\n',
        finding: 'redos: missing verdict anchor "round-18-nested-quantifier" in redos.test.ts',
      },
      {
        corpus: {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'round-19-overlapping-alt',
              file: 'redos.test.ts',
              snippets: ['^(a|aa)+$', 'overlapping alternatives'],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus redos\nexpect(() => assertLinearSafePattern("(a+)+"));\n',
        finding: 'redos: missing verdict anchor "round-19-overlapping-alt" in redos.test.ts',
      },
      {
        corpus: {
          id: 'egress-ip',
          marker: '@kovo-security-classifier-corpus egress-ip',
          testFiles: ['egress.test.ts'],
          verdictAnchors: [
            {
              id: 'round-19-octal-literal',
              file: 'egress.test.ts',
              snippets: ["normalizeIpLiteral('0177.0.0.1')", "'127.0.0.1'"],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus egress-ip\nexpect(classifyIp("127.0.0.1")).toBe("loopback");\n',
        finding: 'egress-ip: missing verdict anchor "round-19-octal-literal" in egress.test.ts',
      },
    ];

    for (const { corpus, finding, text } of cases) {
      const result = evaluateSecurityClassifierCorpus({
        corpora: [corpus],
        readText: () => text,
        run: () => ({ ok: true, output: '' }),
      });
      expect(result.ok, finding).toBe(false);
      expect(result.findings, finding).toContain(finding);
    }
  });

  it('runs the required corpus tests after all markers are present', () => {
    const result = evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts', 'redos-pattern.test.ts'],
          verdictAnchors: [
            {
              id: 'runtime-regression',
              file: 'redos.test.ts',
              snippets: ['([\\w)]+)+'],
            },
            {
              id: 'compile-regression',
              file: 'redos-pattern.test.ts',
              snippets: ["toContain('KV434')"],
            },
          ],
        },
      ],
      readText: (file) =>
        file === 'redos.test.ts'
          ? '// @kovo-security-classifier-corpus redos\n([\\w)]+)+\n'
          : "// @kovo-security-classifier-corpus redos\ntoContain('KV434')\n",
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
          verdictAnchors: [
            {
              id: 'runtime-regression',
              file: 'redos.test.ts',
              snippets: ['([\\w)]+)+'],
            },
          ],
        },
      ],
      readText: () => '// @kovo-security-classifier-corpus redos\n([\\w)]+)+\n',
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

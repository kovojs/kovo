import { describe, expect, it } from 'vitest';

import {
  evaluateRequestSafeRuntimeInventoryAlignment,
  evaluateSecurityClassifierCorpus,
} from './check-security-classifier-corpus.mjs';

describe('check-security-classifier-corpus gate', () => {
  it('rejects classifier-safe globals that are absent from the locked runtime inventory', () => {
    const files = {
      'packages/core/src/internal/request-safe-runtime-inventory.ts': `
        export const requestSafeGlobalCallables = Object.freeze(['String']);
        export const requestSafeGlobalNamespaces = Object.freeze(['JSON']);
        export const requestSafeGlobalConstructors = Object.freeze(['Response']);
        export const requestSafeCallbackGlobals = Object.freeze(['setTimeout']);
        export const requestSafeNodeBuiltinModules = Object.freeze(['util']);
        appendUniqueNames(requestSafeGlobalCallables);
        appendUniqueNames(requestSafeGlobalNamespaces);
        appendUniqueNames(requestSafeGlobalConstructors);
        appendUniqueNames(requestSafeCallbackGlobals);
      `,
      'packages/drizzle/src/trust-escapes-static.ts': `
        const REQUEST_SAFE_GLOBAL_CALLABLES = new Set(['String', 'evil']);
        const REQUEST_SAFE_GLOBAL_NAMESPACES = new Set(['JSON']);
        const REQUEST_SAFE_GLOBAL_CONSTRUCTORS = new Set(['Response']);
        const REQUEST_SAFE_BUILTIN_MODULES = new Set(['util', 'child_process']);
        for (const callbackGlobal of ['setTimeout', 'setImmediate']) {}
      `,
    };
    const findings = evaluateRequestSafeRuntimeInventoryAlignment((file) => files[file]);

    expect(findings).toEqual([
      'request-safe-runtime: REQUEST_SAFE_GLOBAL_CALLABLES exceeds requestSafeGlobalCallables: evil',
      'request-safe-runtime: REQUEST_SAFE_BUILTIN_MODULES exceeds requestSafeNodeBuiltinModules: child_process',
      'request-safe-runtime: callback globals exceed requestSafeCallbackGlobals: setImmediate',
    ]);
  });

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
      {
        corpus: {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'followup-17-b1-dollar-line-terminator-regression',
              file: 'redos.test.ts',
              snippets: ['B1 trailing line terminator', "compileLinearPattern('a$')", "'a\\n'"],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus redos\nexpect(testLinearPattern(compileLinearPattern("a$"), "a")).toBe(true);\n',
        finding:
          'redos: missing verdict anchor "followup-17-b1-dollar-line-terminator-regression" in redos.test.ts',
      },
      {
        corpus: {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'followup-17-b3-in-class-legacy-numeric-regression',
              file: 'redos.test.ts',
              snippets: [
                'B3 in-class legacy numeric escape',
                "compileLinearPattern('^[^\\\\1-\\\\37]+$')",
              ],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus redos\nexpect(() => compileLinearPattern("[^0-9]+")).not.toThrow();\n',
        finding:
          'redos: missing verdict anchor "followup-17-b3-in-class-legacy-numeric-regression" in redos.test.ts',
      },
      {
        corpus: {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
          verdictAnchors: [
            {
              id: 'followup-17-p2-case-gap-range-regression',
              file: 'redos.test.ts',
              snippets: ['P2 i-flag case-gap range', "'[A-_]'", "'[Z-a]'"],
            },
          ],
        },
        text: '// @kovo-security-classifier-corpus redos\nexpect(new RegExp("[A-Z]", "i").test("a")).toBe(true);\n',
        finding:
          'redos: missing verdict anchor "followup-17-p2-case-gap-range-regression" in redos.test.ts',
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

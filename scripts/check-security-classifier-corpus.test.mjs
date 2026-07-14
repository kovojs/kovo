import { describe, expect, it } from 'vitest';

import {
  evaluateCustomRunnerBootstrapOrdering,
  evaluateRequestSafeRuntimeInventoryAlignment,
  evaluateSecurityClassifierCorpus,
} from './check-security-classifier-corpus.mjs';

describe('check-security-classifier-corpus gate', () => {
  it('rejects request and Vite runners that load dependencies before compiler/server lockdown', () => {
    const files = {
      'examples/commerce/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/commerce/scripts/measure-style-size.mjs': `createRequestHandler; createSecurityLockedViteServer`,
      'examples/crm/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/crm/src/app-shell.ts': `createRequestHandler`,
      'examples/gallery/src/app-shell.ts': `createRequestHandler`,
      'examples/reference/src/app-shell.ts': `createRequestHandler`,
      'examples/stackoverflow/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/stackoverflow/src/app-shell.ts': `createRequestHandler`,
      'packages/devtool/src/mount.mjs': `createRequestHandler`,
      'site/src/aux.ts': `createRequestHandler`,
      'tests/p10-perf.node.mjs': `
        import assert from 'node:assert/strict';
        import { chromium } from 'playwright';
        createRequestHandler;
        new Worker(new URL('./p10-perf-browser-worker.mjs', import.meta.url));
      `,
      'tests/kovo-check.export-static-worker.mjs': `
        import assert from 'node:assert/strict';
        kovoExportStaticBehaviorFact;
      `,
      'vite.config.ts': `pack entry packages/server/src/index.ts`,
      'examples/gallery/scripts/export-static.mjs': `createSecurityLockedViteServer`,
      'examples/reference/scripts/export-static.mjs': `createSecurityLockedViteServer`,
      'scripts/demo-session/serve.mjs': `createSecurityLockedViteServer`,
      'site/scripts/capture.mjs': `createSecurityLockedViteServer`,
      'site/scripts/export-static.mjs': `
        createSecurityLockedViteServer;
        await import('../../packages/cli/src/commands/build-export.js');
        await securityLockedViteRuntime();
      `,
      'site/scripts/measure-route-style-size.mjs': `createSecurityLockedViteServer`,
      'tests/compiler-determinism-worker.mjs': `
        createSecurityLockedViteServer();
        server.ssrLoadModule('/tests/compiler-perf-corpora.ts');
        server.ssrLoadModule('/packages/compiler/src/index.ts');
        const { createServer } = await import('vite');
      `,
      'scripts/lib/secure-vite-runtime.mjs': `
        import { createServer } from 'vite-plus';
        const compilerBootstrap = await import('../../packages/compiler/src/security-bootstrap.ts');
        await import('../../packages/server/src/runtime-bootstrap.ts');
        compilerBootstrap.lockCompilerSecurityRealm();
        return import('vite-plus');
      `,
      'packages/create-kovo/templates/src/app.tsx': `export default app`,
      'examples/commerce/src/app.tsx': `export default app`,
      'examples/crm/src/interactive-app.tsx': `export default app`,
      'examples/stackoverflow/src/interactive-app.tsx': `export default app`,
      'site/src/app.tsx': `export default app`,
      'site/content/guides/deployment.md':
        "```ts\nimport '@kovojs/server/runtime-bootstrap';\ncreateRequestHandler\n```",
      'site/content/guides/request-shell.md':
        "```ts\nimport '@kovojs/server/runtime-bootstrap';\ncreateRequestHandler\n```",
    };

    expect(evaluateCustomRunnerBootstrapOrdering((file) => files[file])).toEqual([
      "request-safe-runtime: tests/p10-perf.node.mjs must start imports with import '../dist/server/src/runtime-bootstrap.mjs';",
      'request-safe-runtime: tests/p10-perf.node.mjs must isolate Playwright from the locked request-serving realm',
      'request-safe-runtime: tests/kovo-check.export-static-worker.mjs must keep the public guarded static exporter behind its supported runner',
      "request-safe-runtime: tests/kovo-check.export-static-worker.mjs must start imports with import '../dist/server/src/runtime-bootstrap.mjs';",
      'request-safe-runtime: vite.config.ts root pack must emit packages/server/src/runtime-bootstrap.ts',
      'request-safe-runtime: tests/compiler-determinism-worker.mjs must not construct Vite outside the compiler-first locked runner',
      'request-safe-runtime: scripts/lib/secure-vite-runtime.mjs must lock compiler then server before importing Vite',
      'request-safe-runtime: scripts/lib/secure-vite-runtime.mjs must not statically import Vite',
      'request-safe-runtime: site/scripts/export-static.mjs must lock the runtime before importing the CLI/Vite graph',
    ]);
  });

  it('rejects classifier-safe globals that are absent from the locked runtime inventory', () => {
    const files = {
      'packages/core/src/internal/request-safe-runtime-inventory.ts': `
        export const requestSafeGlobalCallables = Object.freeze(['String']);
        export const requestSafeGlobalNamespaces = Object.freeze(['JSON']);
        export const requestSafeGlobalConstructors = Object.freeze(['Response']);
        export const requestSafeCallbackGlobals = Object.freeze(['setTimeout']);
        export const requestSafeGlobalNamespaceMemberPaths = Object.freeze(['JSON.stringify']);
        export const requestGovernedGlobalBindings = Object.freeze(['fetch']);
        appendUniqueNames(inventory.globalCallables);
        appendUniqueNames(inventory.globalNamespaces);
        appendUniqueNames(inventory.globalConstructors);
        appendUniqueNames(inventory.callbackGlobals);
        appendUniqueNames(inventory.governedGlobals);
        inventory.globalNamespaceMemberPaths;
      `,
      'packages/cli/src/commands/build-export.ts': `
        createRequestHandler, deriveClosedKovoApp, runWithGeneratedLiveTargetRegistry;
        runWithGeneratedLiveTargetRegistry;
      `,
      'packages/compiler/src/security-bootstrap.ts': `
        lockRequestSafeRuntimeRealm();
      `,
      'packages/drizzle/src/trust-escapes-static.ts': `
        const REQUEST_SAFE_GLOBAL_CALLABLES = new Set(['String', 'evil']);
        const REQUEST_SAFE_GLOBAL_NAMESPACES = new Set(['JSON']);
        const REQUEST_SAFE_GLOBAL_CONSTRUCTORS = new Set(['Response']);
        const REQUEST_SAFE_BUILTIN_MODULES = new Set(['util', 'child_process']);
        const REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS = new Map([
          ['JSON', new Set(['parse', 'stringify'])],
        ]);
        for (const callbackGlobal of ['setTimeout', 'setImmediate']) {}
        if (expressionResolvesToGlobalCallable(node, 'fetch', new Set(), 0)) return true;
      `,
      'packages/server/src/build.ts': `
        lockRequestSafeRuntimeRealmWithInventory;
        lockRequestSafeRuntimeRealm(\${generatedRequestSafeRuntimeInventorySource});
      `,
      'packages/server/src/request-handler.ts': `assertServerRequestSafeRuntimeRealmLocked();`,
      'packages/server/src/runtime-bootstrap.ts': `lockServerRequestSafeRuntimeRealm();`,
      'examples/commerce/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/commerce/scripts/measure-style-size.mjs': `createRequestHandler; createSecurityLockedViteServer`,
      'examples/crm/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/crm/src/app-shell.ts': `createRequestHandler`,
      'examples/gallery/src/app-shell.ts': `import { createRequestHandler } from '@kovojs/server';`,
      'examples/reference/src/app-shell.ts': `import { createRequestHandler } from '@kovojs/server';`,
      'examples/stackoverflow/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/stackoverflow/src/app-shell.ts': `createRequestHandler`,
      'packages/devtool/src/mount.mjs': `import { createRequestHandler } from '@kovojs/server';`,
      'site/src/aux.ts': `import { createRequestHandler } from '@kovojs/server';`,
      'tests/p10-perf.node.mjs': `
        import '../dist/server/src/runtime-bootstrap.mjs';
        import { createRequestHandler } from '../dist/server/src/index.mjs';
        new Worker(new URL('./p10-perf-browser-worker.mjs', import.meta.url));
      `,
      'tests/kovo-check.export-static-worker.mjs': `
        import '../dist/server/src/runtime-bootstrap.mjs';
        import { exportStaticApp } from '../dist/server/src/index.mjs';
      `,
      'vite.config.ts': `pack entry 'packages/server/src/runtime-bootstrap.ts'`,
      'examples/gallery/scripts/export-static.mjs': `createSecurityLockedViteServer`,
      'examples/reference/scripts/export-static.mjs': `createSecurityLockedViteServer`,
      'scripts/demo-session/serve.mjs': `createSecurityLockedViteServer`,
      'site/scripts/capture.mjs': `createSecurityLockedViteServer`,
      'site/scripts/measure-route-style-size.mjs': `createSecurityLockedViteServer`,
      'tests/compiler-determinism-worker.mjs': `
        createSecurityLockedViteServer();
        server.ssrLoadModule('/tests/compiler-perf-corpora.ts');
        server.ssrLoadModule('/packages/compiler/src/index.ts');
      `,
      'scripts/lib/secure-vite-runtime.mjs': `
        const compilerBootstrap = await import('../../packages/compiler/src/security-bootstrap.ts');
        compilerBootstrap.lockCompilerSecurityRealm();
        await import('../../packages/server/src/runtime-bootstrap.ts');
        return import('vite-plus');
      `,
      'site/scripts/export-static.mjs': `
        createSecurityLockedViteServer;
        await securityLockedViteRuntime();
        await import('../../packages/cli/src/commands/build-export.js');
      `,
      'packages/create-kovo/templates/src/app.tsx': `export default app;`,
      'examples/commerce/src/app.tsx': `export default app;`,
      'examples/crm/src/interactive-app.tsx': `export default app;`,
      'examples/stackoverflow/src/interactive-app.tsx': `export default app;`,
      'site/src/app.tsx': `export default siteStaticExportApp;`,
      'site/content/guides/deployment.md':
        "```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { createRequestHandler } from '@kovojs/server';\n```",
      'site/content/guides/request-shell.md':
        "```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { createRequestHandler } from '@kovojs/server';\n```",
    };
    const findings = evaluateRequestSafeRuntimeInventoryAlignment((file) => files[file]);

    expect(findings).toEqual([
      'request-safe-runtime: REQUEST_SAFE_GLOBAL_CALLABLES exceeds requestSafeGlobalCallables: evil',
      'request-safe-runtime: REQUEST_SAFE_BUILTIN_MODULES must remain empty: child_process, util',
      'request-safe-runtime: REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS exceeds requestSafeGlobalNamespaceMemberPaths: JSON.parse',
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

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_CORPUS_BROWSER_BATCH_TIMEOUT_MS,
  CLASSIFIER_CORPUS_BROWSER_CONFIG,
  CLASSIFIER_CORPUS_BROWSER_NAME,
  CLASSIFIER_CORPUS_CI_JOB_TIMEOUT_MINUTES,
  CLASSIFIER_CORPUS_GATE_TIMEOUT_MS,
  CLASSIFIER_CORPUS_ISOLATED_BATCH_TIMEOUT_MS,
  CLASSIFIER_CORPUS_MAX_OUTPUT_BYTES,
  CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS,
  CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
  evaluateCustomRunnerBootstrapOrdering,
  evaluateRequestSafeRuntimeInventoryAlignment,
  evaluateSecurityClassifierCorpus,
  runVitest,
  evaluateSiteStaticExportRuntimeOrdering,
} from './check-security-classifier-corpus.mjs';
import {
  buildSecurityCoverageCells,
  generatedCarrierGrammarDocument,
  securityCarrierProductions,
} from './security-coverage.mjs';

describe('check-security-classifier-corpus gate', () => {
  it('rejects request and Vite runners that load dependencies before compiler/server lockdown', () => {
    const files = {
      'examples/commerce/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/commerce/scripts/measure-style-size.mjs': `createRequestHandler; createSecurityLockedViteServer`,
      'examples/commerce/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'examples/crm/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/crm/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'examples/crm/src/app-shell.ts': `createRequestHandler`,
      'examples/gallery/src/app-shell.ts': `createRequestHandler`,
      'examples/reference/src/app-shell.ts': `createRequestHandler`,
      'examples/stackoverflow/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/stackoverflow/scripts/serve.mjs': `createSecurityLockedViteServer`,
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
      'examples/reference/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'scripts/demo-session/serve.mjs': `createSecurityLockedViteServer`,
      'site/scripts/capture.mjs': `createSecurityLockedViteServer`,
      'site/scripts/export-static.mjs': `
        createSecurityLockedViteServer;
        const viteServer = await createViteServer({});
        viteServer.ssrLoadModule('/src/app.tsx');
        viteServer.ssrLoadModule('@kovojs/server/runtime-bootstrap');
        viteServer.ssrLoadModule('@kovojs/server/static-export');
        (await import('./content-pipeline.mjs')).runContentPipeline;
        await securityLockedViteRuntime();
        if (!skipPipeline) await runContentPipeline();
        await buildWithSecurityLockedVite({ root: siteRoot });
      `,
      'site/scripts/measure-route-style-size.mjs': `createSecurityLockedViteServer; buildWithSecurityLockedVite`,
      'site/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'site/src/gallery.ts': `import { createServer as createViteServer } from 'vite-plus';
        await ensureGalleryInteractiveServerArtifacts();
        await createViteServer({});`,
      'scripts/lib/secure-vite-build.mjs': `buildWithSecurityLockedVite`,
      'examples/stackoverflow/scripts/materialize-demo-css.mjs': `
        await securityLockedCompilerRuntime();
        await import('@kovojs/compiler');
      `,
      'examples/commerce/package.json': `"build:demo": "node ../../scripts/lib/secure-vite-build.mjs"`,
      'examples/crm/package.json': `"build": "node ../../scripts/lib/secure-vite-build.mjs"`,
      'examples/stackoverflow/package.json': `"build": "node ../../scripts/lib/secure-vite-build.mjs && node scripts/materialize-demo-css.mjs"`,
      'site/package.json': `"build:css": "node ../scripts/lib/secure-vite-build.mjs"`,
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
        "```ts\nimport { createRequestHandler } from '@kovojs/server/custom-adapters';\nimport app from './app.js';\nexport const handler = createRequestHandler(app);\n```\n```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { toNodeHandler } from '@kovojs/server/node';\nimport { handler } from './handler.js';\ntoNodeHandler(handler);\n```",
      'site/content/guides/request-shell.md':
        "```ts\nimport { createRequestHandler } from '@kovojs/server/custom-adapters';\nimport app from './app.js';\nexport const handler = createRequestHandler(app);\n```\n```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { toNodeHandler } from '@kovojs/server/node';\nimport { handler } from './handler.js';\ntoNodeHandler(handler);\n```",
    };

    expect(evaluateCustomRunnerBootstrapOrdering((file) => files[file])).toEqual([
      "request-safe-runtime: tests/p10-perf.node.mjs must start imports with import '../dist/server/src/runtime-bootstrap.mjs';",
      'request-safe-runtime: tests/p10-perf.node.mjs must isolate Playwright from the locked request-serving realm',
      'request-safe-runtime: tests/kovo-check.export-static-worker.mjs must keep the public guarded static exporter behind its supported runner',
      "request-safe-runtime: tests/kovo-check.export-static-worker.mjs must start imports with import '../dist/server/src/runtime-bootstrap.mjs';",
      'request-safe-runtime: vite.config.ts root pack must emit packages/server/src/runtime-bootstrap.ts',
      'request-safe-runtime: tests/compiler-determinism-worker.mjs must not construct Vite outside the compiler-first locked runner',
      'request-safe-runtime: site/src/gallery.ts must assert the established runtime lock before compiler work and nested Vite creation',
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
        createRequestHandler, deriveClosedKovoApp, resolveKovoAppToken, runWithGeneratedLiveTargetRegistry;
        runWithGeneratedLiveTargetRegistry;
        export default createRequestHandler(appWithBuildStylesheetAssets(app, stylesheetAssets));
        return deriveClosedKovoApp(app, {
      `,
      'packages/compiler/src/security-bootstrap.ts': `
        lockRequestSafeRuntimeRealm();
      `,
      'packages/drizzle/src/trust-escapes-static.ts': `
        if (REQUEST_SAFE_GLOBAL_CALLABLES.has(name) || REQUEST_SAFE_GLOBAL_NAMESPACES.has(name)) {
          const unrelatedRuntimeNames = ['fetch', 'globalThis', 'setTimeout'];
        }
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
      'examples/commerce/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'examples/crm/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/crm/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'examples/crm/src/app-shell.ts': `createRequestHandler`,
      'examples/gallery/src/app-shell.ts': `import { createRequestHandler } from '@kovojs/server/custom-adapters';`,
      'examples/reference/src/app-shell.ts': `import { createRequestHandler } from '@kovojs/server/custom-adapters';`,
      'examples/stackoverflow/scripts/demo-serve.mjs': `createRequestHandler`,
      'examples/stackoverflow/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'examples/stackoverflow/src/app-shell.ts': `createRequestHandler`,
      'packages/devtool/src/mount.mjs': `import { createRequestHandler } from '@kovojs/server/custom-adapters';`,
      'site/src/aux.ts': `import { createRequestHandler } from '@kovojs/server/custom-adapters';`,
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
      'examples/reference/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'scripts/demo-session/serve.mjs': `createSecurityLockedViteServer`,
      'site/scripts/capture.mjs': `createSecurityLockedViteServer`,
      'site/scripts/measure-route-style-size.mjs': `createSecurityLockedViteServer; buildWithSecurityLockedVite`,
      'site/scripts/serve.mjs': `createSecurityLockedViteServer`,
      'site/src/gallery.ts': `import { createServer as createViteServer } from 'vite-plus';
        assertRequestSafeRuntimeRealmLocked();
        await ensureGalleryInteractiveServerArtifacts();
        await createViteServer({});`,
      'scripts/lib/secure-vite-build.mjs': `buildWithSecurityLockedVite`,
      'examples/stackoverflow/scripts/materialize-demo-css.mjs': `
        await securityLockedCompilerRuntime();
        await import('@kovojs/compiler');
      `,
      'examples/commerce/package.json': `"build:demo": "node ../../scripts/lib/secure-vite-build.mjs"`,
      'examples/crm/package.json': `"build": "node ../../scripts/lib/secure-vite-build.mjs"`,
      'examples/stackoverflow/package.json': `"build": "node ../../scripts/lib/secure-vite-build.mjs && node scripts/materialize-demo-css.mjs"`,
      'site/package.json': `"build:css": "node ../scripts/lib/secure-vite-build.mjs"`,
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
        (await import('./content-pipeline.mjs')).runContentPipeline;
        if (!skipPipeline) await runContentPipeline();
        await buildWithSecurityLockedVite({ root: siteRoot });
        const viteServer = await createViteServer({ root: siteRoot });
        await viteServer.ssrLoadModule('@kovojs/server/runtime-bootstrap');
        await viteServer.ssrLoadModule('/src/app.tsx');
        await viteServer.ssrLoadModule('@kovojs/server/static-export');
      `,
      'packages/create-kovo/templates/src/app.tsx': `export default app;`,
      'examples/commerce/src/app.tsx': `export default app;`,
      'examples/crm/src/interactive-app.tsx': `export default app;`,
      'examples/stackoverflow/src/interactive-app.tsx': `export default app;`,
      'site/src/app.tsx': `export default siteStaticExportApp;`,
      'site/content/guides/deployment.md':
        "```ts\nimport { createRequestHandler } from '@kovojs/server/custom-adapters';\nimport app from './app.js';\nexport const handler = createRequestHandler(app);\n```\n```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { toNodeHandler } from '@kovojs/server/node';\nimport { handler } from './handler.js';\ntoNodeHandler(handler);\n```",
      'site/content/guides/request-shell.md':
        "```ts\nimport { createRequestHandler } from '@kovojs/server/custom-adapters';\nimport app from './app.js';\nexport const handler = createRequestHandler(app);\n```\n```ts\nimport '@kovojs/server/runtime-bootstrap';\nimport { toNodeHandler } from '@kovojs/server/node';\nimport { handler } from './handler.js';\ntoNodeHandler(handler);\n```",
    };
    const findings = evaluateRequestSafeRuntimeInventoryAlignment((file) => files[file]);

    expect(findings).toEqual([
      'request-safe-runtime: REQUEST_SAFE_GLOBAL_CALLABLES exceeds requestSafeGlobalCallables: evil',
      'request-safe-runtime: REQUEST_SAFE_BUILTIN_MODULES must remain empty: child_process, util',
      'request-safe-runtime: REQUEST_REVIEWED_GLOBAL_NAMESPACE_MEMBERS exceeds requestSafeGlobalNamespaceMemberPaths: JSON.parse',
      'request-safe-runtime: callback globals exceed requestSafeCallbackGlobals: setImmediate',
    ]);
  });

  it('requires host lock and SSR bootstrap before either static-export graph sibling', () => {
    const lockedPrelude = `
      await securityLockedViteRuntime();
      (await import('./content-pipeline.mjs')).runContentPipeline;
      if (!skipPipeline) await runContentPipeline();
      await buildWithSecurityLockedVite({ root: siteRoot });
      const viteServer = await createViteServer({
      await viteServer.ssrLoadModule('@kovojs/server/runtime-bootstrap');
    `;
    const appLoad = "viteServer.ssrLoadModule('/src/app.tsx');";
    const staticExportLoad = "viteServer.ssrLoadModule('@kovojs/server/static-export');";

    expect(
      evaluateSiteStaticExportRuntimeOrdering(`${lockedPrelude}\n${staticExportLoad}\n${appLoad}`),
    ).toEqual([]);
    for (const source of [
      `${lockedPrelude.replace(
        "await viteServer.ssrLoadModule('@kovojs/server/runtime-bootstrap');",
        '',
      )}\n${appLoad}\n${staticExportLoad}`,
      `${appLoad}\n${lockedPrelude}\n${staticExportLoad}`,
      `${staticExportLoad}\n${lockedPrelude}\n${appLoad}`,
      `${lockedPrelude.replace(
        'await securityLockedViteRuntime();',
        '',
      )}\n${appLoad}\n${staticExportLoad}\nawait securityLockedViteRuntime();`,
    ]) {
      expect(evaluateSiteStaticExportRuntimeOrdering(source)).toEqual([
        'request-safe-runtime: site/scripts/export-static.mjs must lock the runtime before importing the CLI/Vite graph',
      ]);
    }
  });

  it('requires a marker for every configured security classifier corpus', async () => {
    const result = await evaluateSecurityClassifierCorpus({
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

  it('fails when a configured verdict anchor disappears from a corpus test', async () => {
    const result = await evaluateSecurityClassifierCorpus({
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

  it.each([
    ['browser operation', 'browserOperationKinds', 'browser.scratch', 'browser-operation'],
    ['root', 'rootKinds', 'scratch-root', 'root'],
    ['closed verdict', 'closedVerdicts', 'scratch-closed', 'closed-verdict'],
  ])(
    'blocks a newly added uncovered %s before running the corpus',
    async (_label, field, value, surface) => {
      const corpus = {
        id: 'finite-security-operation-ir',
        marker: '@kovo-security-classifier-corpus finite-security-operation-ir',
        testFiles: ['finite.test.ts'],
        verdictAnchors: [
          {
            file: 'finite.test.ts',
            id: 'reviewed-anchor',
            snippets: ['reviewed closed decision'],
          },
        ],
      };
      const vocabulary = {
        browserOperationKinds: ['browser.state.read'],
        closedVerdicts: ['unknown-operation'],
        rootKinds: ['route'],
        serverOperationKinds: ['server.database.read'],
      };
      const coverage = {
        cells: buildSecurityCoverageCells(vocabulary).map((cell) => ({
          ...cell,
          disposition: 'witness',
          reason: null,
          review: null,
          witnesses: [{ anchor: 'reviewed-anchor', corpus: corpus.id }],
        })),
        schema: 'kovo-security-coverage/v1',
        summary: { cells: 4, inapplicable: 0, witnessed: 4 },
      };
      const grammar = generatedCarrierGrammarDocument({
        corpora: [corpus],
        existing: undefined,
        productions: securityCarrierProductions,
      });
      grammar.mappings[0] = {
        ...grammar.mappings[0],
        production: 'exact-operation',
        reason: 'This direct finite operation reaches its reviewed closed decision.',
      };
      let ran = false;
      const result = await evaluateSecurityClassifierCorpus({
        corpora: [corpus],
        coverageInputs: {
          coverage,
          grammar,
          vocabulary: { ...vocabulary, [field]: [...vocabulary[field], value] },
        },
        enforceCoverage: true,
        readText: () => `${corpus.marker}\nreviewed closed decision\n`,
        run: () => {
          ran = true;
          return { ok: true, output: '' };
        },
      });

      expect(ran).toBe(false);
      expect(result.findings).toContain(`missing coverage cell ${surface}:${value}`);
    },
  );

  it('returns red when known regression anchors are conceptually mutated away', async () => {
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
      const result = await evaluateSecurityClassifierCorpus({
        corpora: [corpus],
        readText: () => text,
        run: () => ({ ok: true, output: '' }),
      });
      expect(result.ok, finding).toBe(false);
      expect(result.findings, finding).toContain(finding);
    }
  });

  it('runs the required corpus tests after all markers are present', async () => {
    const result = await evaluateSecurityClassifierCorpus({
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

  it('runs load-sensitive corpus files in fresh serial batches without dropping coverage', async () => {
    const browserFiles = [
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/browser/src/security-operation-workflows.browser.test.ts',
    ];
    const staticClassifierFile = 'packages/drizzle/src/trust-escapes-static.test.ts';
    const factoryAliasTestName =
      'resolves bounded framework-factory member aliases and fails closed beyond the budget';
    const betterAuthEnvironmentTestName =
      'accepts only exact Better Auth environment binding option records';
    const ordinarySupervisorTimeoutMs =
      CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS - CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS;
    const isolatedSupervisorTimeoutMs =
      CLASSIFIER_CORPUS_ISOLATED_BATCH_TIMEOUT_MS - CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS;
    const browserSupervisorTimeoutMs =
      CLASSIFIER_CORPUS_BROWSER_BATCH_TIMEOUT_MS - CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS;
    const runs = [];
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: [
            'ordinary.test.ts',
            ...browserFiles,
            staticClassifierFile,
            'packed-runtime.test.ts',
          ],
        },
      ],
      loadIsolatedTestConfigs: [
        {
          file: staticClassifierFile,
          freshTestNames: [factoryAliasTestName, betterAuthEnvironmentTestName],
        },
        {
          file: 'packed-runtime.test.ts',
          freshTestNames: ['shares one packed witness'],
        },
      ],
      readText: (file) =>
        file === staticClassifierFile
          ? `// @kovo-security-classifier-corpus redos\n${factoryAliasTestName}\n${betterAuthEnvironmentTestName}\n`
          : file === 'packed-runtime.test.ts'
            ? '// @kovo-security-classifier-corpus redos\nshares one packed witness\n'
            : '// @kovo-security-classifier-corpus redos\n',
      run: (testFiles, runOptions) => {
        runs.push({ testFiles, runOptions });
        return { ok: true, output: '' };
      },
    });

    expect(runs).toEqual([
      {
        testFiles: ['ordinary.test.ts'],
        runOptions: {
          batchId: 'ordinary',
          noFileParallelism: false,
          runtime: 'node',
          testNamePattern: undefined,
          timeoutMs: ordinarySupervisorTimeoutMs,
        },
      },
      {
        testFiles: browserFiles,
        runOptions: {
          batchId: `browser:${CLASSIFIER_CORPUS_BROWSER_NAME}`,
          noFileParallelism: false,
          runtime: 'browser',
          testNamePattern: undefined,
          timeoutMs: browserSupervisorTimeoutMs,
        },
      },
      {
        testFiles: [staticClassifierFile],
        runOptions: {
          batchId: `isolated:${staticClassifierFile}:complement`,
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: `^(?!.*(?:${factoryAliasTestName}|${betterAuthEnvironmentTestName})).*$`,
          timeoutMs: isolatedSupervisorTimeoutMs,
        },
      },
      {
        testFiles: [staticClassifierFile],
        runOptions: {
          batchId: `isolated:${staticClassifierFile}:named-1`,
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: factoryAliasTestName,
          timeoutMs: isolatedSupervisorTimeoutMs,
        },
      },
      {
        testFiles: [staticClassifierFile],
        runOptions: {
          batchId: `isolated:${staticClassifierFile}:named-2`,
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: betterAuthEnvironmentTestName,
          timeoutMs: isolatedSupervisorTimeoutMs,
        },
      },
      {
        testFiles: ['packed-runtime.test.ts'],
        runOptions: {
          batchId: 'isolated:packed-runtime.test.ts:complement',
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: '^(?!.*(?:shares one packed witness)).*$',
          timeoutMs: isolatedSupervisorTimeoutMs,
        },
      },
      {
        testFiles: ['packed-runtime.test.ts'],
        runOptions: {
          batchId: 'isolated:packed-runtime.test.ts:named-1',
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: 'shares one packed witness',
          timeoutMs: isolatedSupervisorTimeoutMs,
        },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      testFiles: [
        'ordinary.test.ts',
        ...browserFiles,
        staticClassifierFile,
        'packed-runtime.test.ts',
      ],
    });
  });

  it('keeps every inner deadline below the dedicated CI envelope with semantic headroom', () => {
    const isolatedSupervisorTimeoutMs =
      CLASSIFIER_CORPUS_ISOLATED_BATCH_TIMEOUT_MS - CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS;

    expect(CLASSIFIER_CORPUS_GATE_TIMEOUT_MS).toBeLessThan(
      CLASSIFIER_CORPUS_CI_JOB_TIMEOUT_MINUTES * 60_000,
    );
    expect(CLASSIFIER_CORPUS_ISOLATED_BATCH_TIMEOUT_MS - 540_670).toBeGreaterThanOrEqual(
      3 * 60_000,
    );
    expect(isolatedSupervisorTimeoutMs).toBeGreaterThanOrEqual(600_000 + 60_000);
    expect(CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS).toBeLessThan(
      CLASSIFIER_CORPUS_GATE_TIMEOUT_MS,
    );
    expect(CLASSIFIER_CORPUS_BROWSER_BATCH_TIMEOUT_MS).toBeLessThan(
      CLASSIFIER_CORPUS_GATE_TIMEOUT_MS,
    );
  });

  it('runs browser corpora only through the exact Chromium project and fails closed on no files', async () => {
    const browserFiles = [
      'packages/browser/src/response-fragment-apply.browser.test.ts',
      'packages/browser/src/security-operation-workflows.browser.test.ts',
    ];
    const invocations = [];
    const result = await runVitest(browserFiles, '/repo', {
      batchId: `browser:${CLASSIFIER_CORPUS_BROWSER_NAME}`,
      runProcess: async (invocation) => {
        invocations.push(invocation);
        return {
          durationMs: 9,
          exitCode: 1,
          signal: null,
          stderr: '',
          stdout: 'No test files found',
        };
      },
      runtime: 'browser',
      timeoutMs: 1_234,
    });

    expect(invocations).toEqual([
      {
        args: [
          'exec',
          'vitest',
          '--config',
          CLASSIFIER_CORPUS_BROWSER_CONFIG,
          '--browser.name',
          CLASSIFIER_CORPUS_BROWSER_NAME,
          '--run',
          '--testTimeout=60000',
          ...browserFiles,
        ],
        captureOutput: true,
        command: 'vp',
        cwd: '/repo',
        env: undefined,
        forwardOutput: true,
        maxOutputBytes: CLASSIFIER_CORPUS_MAX_OUTPUT_BYTES,
        supervisorTimeoutMs: 1_234,
      },
    ]);
    expect(result).toMatchObject({ durationMs: 9, ok: false });
    expect(result.output).toContain('exited with status 1');
    expect(result.output).toContain('No test files found');
  });

  it.each([
    [
      'browser files in a Node batch',
      ['proof.browser.test.ts'],
      'node',
      'browser tests require the browser batch',
    ],
    [
      'Node files in a browser batch',
      ['proof.test.ts'],
      'browser',
      'browser batch must contain only browser tests',
    ],
    [
      'mixed files in one batch',
      ['proof.test.ts', 'proof.browser.test.ts'],
      'browser',
      'must not mix browser and Node test files',
    ],
  ])(
    'rejects the %s coverage mutation before process launch',
    async (_label, files, runtime, error) => {
      let ran = false;
      await expect(
        runVitest(files, '/repo', {
          batchId: 'mutated-batch',
          runProcess: async () => {
            ran = true;
            return { exitCode: 0 };
          },
          runtime,
          timeoutMs: 1_234,
        }),
      ).rejects.toThrow(error);
      expect(ran).toBe(false);
    },
  );

  it('fails closed instead of dropping fresh-process isolation from a browser corpus', async () => {
    let ran = false;
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'browser-proof',
          marker: '@kovo-security-classifier-corpus browser-proof',
          testFiles: ['proof.browser.test.ts'],
        },
      ],
      loadIsolatedTestConfigs: [
        {
          file: 'proof.browser.test.ts',
          freshTestNames: ['requires a fresh browser'],
        },
      ],
      readText: () =>
        '// @kovo-security-classifier-corpus browser-proof\nrequires a fresh browser\n',
      run: async () => {
        ran = true;
        return { ok: true, output: '' };
      },
    });

    expect(ran).toBe(false);
    expect(result).toMatchObject({
      findings: [
        'load-isolated browser corpus file requires an explicit browser-isolation design: proof.browser.test.ts',
      ],
      ok: false,
    });
  });

  it('flushes an attributed START phase before launching the marker-bounded process tree', async () => {
    const events = [];
    const invocations = [];
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
        },
      ],
      onPhase: async (phase) => {
        events.push(phase);
        if (phase.state === 'start') {
          await Promise.resolve();
          events.push({ state: 'start-hook-settled' });
        }
      },
      readText: () => '// @kovo-security-classifier-corpus redos\n',
      runProcess: async (invocation) => {
        events.push({ state: 'launch' });
        invocations.push(invocation);
        return { durationMs: 37, exitCode: 0, signal: null, stderr: '', stdout: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual([
      {
        batch: 1,
        batches: 1,
        budgetMs: CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        files: ['redos.test.ts'],
        id: 'ordinary',
        state: 'start',
        supervisorTimeoutMs:
          CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS -
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      },
      { state: 'start-hook-settled' },
      { state: 'launch' },
      {
        batch: 1,
        batches: 1,
        budgetMs: CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        durationMs: 37,
        files: ['redos.test.ts'],
        id: 'ordinary',
        state: 'pass',
        supervisorTimeoutMs:
          CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS -
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      },
    ]);
    expect(invocations).toEqual([
      {
        args: ['exec', 'vitest', '--run', '--testTimeout=60000', 'redos.test.ts'],
        captureOutput: true,
        command: 'vp',
        cwd: expect.any(String),
        env: undefined,
        forwardOutput: true,
        maxOutputBytes: CLASSIFIER_CORPUS_MAX_OUTPUT_BYTES,
        supervisorTimeoutMs:
          CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS -
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      },
    ]);
  });

  it('reserves the shared cleanup allowance before starting a batch', async () => {
    let ran = false;
    const ticks = [0, 1];
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['redos.test.ts'],
        },
      ],
      gateTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      now: () => ticks.shift() ?? 1,
      readText: () => '// @kovo-security-classifier-corpus redos\n',
      run: () => {
        ran = true;
        return { ok: true, output: '' };
      },
    });

    expect(ran).toBe(false);
    expect(result.findings).toEqual([
      expect.stringContaining(
        `does not preserve the ${String(
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        )}ms process-tree cleanup allowance`,
      ),
    ]);
  });

  it('charges cleanup to the gate deadline and refuses to launch later batches', async () => {
    const phases = [];
    const runs = [];
    const gateTimeoutMs = CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS + 1_000;
    const ticks = [0, 0, 0, gateTimeoutMs];
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['cpu-budget.test.ts'],
        },
      ],
      gateTimeoutMs,
      loadIsolatedTestConfigs: [
        {
          file: 'cpu-budget.test.ts',
          freshTestNames: ['keeps safe misses bounded'],
        },
      ],
      now: () => ticks.shift() ?? gateTimeoutMs,
      onPhase: (phase) => phases.push(phase),
      readText: () => '// @kovo-security-classifier-corpus redos\nkeeps safe misses bounded\n',
      run: async (testFiles, runOptions) => {
        runs.push({ runOptions, testFiles });
        return { durationMs: 1_000, ok: true, output: '' };
      },
    });

    expect(runs).toEqual([
      {
        runOptions: {
          batchId: 'isolated:cpu-budget.test.ts:complement',
          noFileParallelism: true,
          runtime: 'node',
          testNamePattern: '^(?!.*(?:keeps safe misses bounded)).*$',
          timeoutMs: 1_000,
        },
        testFiles: ['cpu-budget.test.ts'],
      },
    ]);
    expect(phases).toEqual([
      {
        batch: 1,
        batches: 2,
        budgetMs: gateTimeoutMs,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        files: ['cpu-budget.test.ts'],
        id: 'isolated:cpu-budget.test.ts:complement',
        state: 'start',
        supervisorTimeoutMs: 1_000,
      },
      {
        batch: 1,
        batches: 2,
        budgetMs: gateTimeoutMs,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        durationMs: 1_000,
        files: ['cpu-budget.test.ts'],
        id: 'isolated:cpu-budget.test.ts:complement',
        state: 'pass',
        supervisorTimeoutMs: 1_000,
      },
    ]);
    expect(result).toMatchObject({
      findings: [
        `security classifier corpus exceeded its ${String(
          gateTimeoutMs,
        )}ms gate deadline before batch isolated:cpu-budget.test.ts:named-1`,
      ],
      ok: false,
    });
  });

  it.each([
    ['timeout', { exitCode: 0, timedOut: true }, 'timed out after 1234ms'],
    [
      'output overflow',
      { exitCode: 0, outputOverflowed: true },
      `exceeded its ${String(CLASSIFIER_CORPUS_MAX_OUTPUT_BYTES)}-byte output ceiling`,
    ],
    [
      'cleanup failure',
      { cleanupError: 'marker survived', exitCode: 0 },
      'could not prove process-tree cleanup: marker survived',
    ],
    ['signal', { exitCode: null, signal: 'SIGKILL' }, 'ended with signal SIGKILL'],
    ['launch failure', { error: 'spawn ENOENT', exitCode: null }, 'could not start: spawn ENOENT'],
    ['noninteger exit', { exitCode: '0' }, 'did not return an integer exit status'],
    ['nonzero exit', { exitCode: 7 }, 'exited with status 7'],
  ])('classifies a bounded-process %s distinctly', async (_label, outcome, diagnostic) => {
    const result = await runVitest(['redos.test.ts'], '/repo', {
      batchId: 'ordinary',
      runProcess: async () => ({ durationMs: 1, signal: null, stderr: '', stdout: '', ...outcome }),
      runtime: 'node',
      timeoutMs: 1_234,
    });

    expect(result.ok).toBe(false);
    expect(result.output).toContain(diagnostic);
  });

  it.skipIf(process.platform === 'win32')(
    'kills a timed-out detached descendant through the corpus runner with no survivor',
    async () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), 'kovo-classifier-corpus-supervisor-'));
      const fakeVp = join(fixtureRoot, 'vp');
      const fixtureToken = `kovo-classifier-corpus-${randomUUID()}`;
      const pidFile = join(fixtureRoot, 'descendant.pid');
      const rootPidFile = join(fixtureRoot, 'root.pid');
      const descendantSource = [
        "process.on('SIGTERM', () => undefined);",
        'setInterval(() => undefined, 1_000);',
      ].join('');
      const intermediateSource = [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(
          descendantSource,
        )}, ${JSON.stringify(fixtureToken)}], { detached: true, stdio: 'ignore' });`,
        'descendant.unref();',
        `writeFileSync(${JSON.stringify(pidFile)}, String(descendant.pid), 'utf8');`,
        'process.stdout.write(`grandchild:${descendant.pid}\\n`);',
      ].join('');
      const fakeVpSource = [
        '#!/usr/bin/env node',
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        `writeFileSync(${JSON.stringify(rootPidFile)}, String(process.pid), 'utf8');`,
        `spawn(process.execPath, ['-e', ${JSON.stringify(intermediateSource)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
        "process.on('SIGTERM', () => undefined);",
        'setInterval(() => undefined, 1_000);',
      ].join('\n');
      let descendantPid;
      let failure;
      let rootPid;

      try {
        writeFileSync(fakeVp, fakeVpSource, 'utf8');
        chmodSync(fakeVp, 0o755);
        const result = await runVitest([`${fixtureToken}.test.ts`], fixtureRoot, {
          batchId: 'detached-descendant-proof',
          env: {
            ...process.env,
            PATH: `${fixtureRoot}${delimiter}${process.env.PATH ?? ''}`,
          },
          runtime: 'node',
          timeoutMs: 2_000,
        });

        descendantPid = Number(readFileSync(pidFile, 'utf8'));
        rootPid = Number(readFileSync(rootPidFile, 'utf8'));
        expect(result.ok).toBe(false);
        expect(result.output).toContain('timed out after 2000ms');
        expect(result.output).not.toContain('could not prove process-tree cleanup');
        expect(result.output).toContain(`grandchild:${String(descendantPid)}`);
        expect(Number.isSafeInteger(descendantPid)).toBe(true);
        expect(Number.isSafeInteger(rootPid)).toBe(true);
        expect(await processStopsWithin(rootPid, 1_000)).toBe(true);
        expect(await processStopsWithin(descendantPid, 1_000)).toBe(true);
      } catch (error) {
        failure = error;
      }
      try {
        rootPid ??= readFixturePid(rootPidFile);
        descendantPid ??= readFixturePid(pidFile);
        for (const pid of [rootPid, descendantPid]) {
          if (pid === undefined || !processIsAlive(pid)) continue;
          if (!processCommandContains(pid, fixtureToken)) {
            throw new Error(
              `refusing emergency cleanup for process ${String(pid)} without the fixture identity`,
            );
          }
          process.kill(pid, 'SIGKILL');
          if (!(await processStopsWithin(pid, 1_000))) {
            throw new Error(`fixture-owned process ${String(pid)} survived emergency SIGKILL`);
          }
        }
      } catch (cleanupError) {
        failure =
          failure === undefined
            ? cleanupError
            : new AggregateError([failure, cleanupError], 'fixture assertion and cleanup failed');
      } finally {
        rmSync(fixtureRoot, { force: true, recursive: true });
      }
      if (failure !== undefined) throw failure;
    },
    CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS + 10_000,
  );

  it('fails closed when a configured fresh-process proof is no longer enrolled by name', async () => {
    let ran = false;
    const result = await evaluateSecurityClassifierCorpus({
      corpora: [
        {
          id: 'redos',
          marker: '@kovo-security-classifier-corpus redos',
          testFiles: ['cpu-budget.test.ts'],
        },
      ],
      loadIsolatedTestConfigs: [
        {
          file: 'cpu-budget.test.ts',
          freshTestNames: ['keeps safe misses bounded'],
        },
      ],
      readText: () => '// @kovo-security-classifier-corpus redos\nrenamed budget proof\n',
      run: () => {
        ran = true;
        return { ok: true, output: '' };
      },
    });

    expect(ran).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      findings: [
        'load-isolated corpus test is missing from cpu-budget.test.ts: keeps safe misses bounded',
      ],
    });
  });

  it('fails when the corpus test runner fails', async () => {
    const phases = [];
    const result = await evaluateSecurityClassifierCorpus({
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
      onPhase: (phase) => phases.push(phase),
      readText: () => '// @kovo-security-classifier-corpus redos\n([\\w)]+)+\n',
      run: () => ({ ok: false, output: 'KV434 corpus regression' }),
    });

    expect(result).toEqual({
      corpora: 1,
      findings: ['KV434 corpus regression'],
      ok: false,
      testFiles: ['redos.test.ts'],
    });
    expect(phases).toEqual([
      {
        batch: 1,
        batches: 1,
        budgetMs: CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        files: ['redos.test.ts'],
        id: 'ordinary',
        state: 'start',
        supervisorTimeoutMs:
          CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS -
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      },
      {
        batch: 1,
        batches: 1,
        budgetMs: CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS,
        cleanupTimeoutMs: CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
        durationMs: expect.any(Number),
        files: ['redos.test.ts'],
        id: 'ordinary',
        state: 'fail',
        supervisorTimeoutMs:
          CLASSIFIER_CORPUS_ORDINARY_BATCH_TIMEOUT_MS -
          CLASSIFIER_CORPUS_PROCESS_CLEANUP_TIMEOUT_MS,
      },
    ]);
  });
});

async function processStopsWithin(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await delay(20);
  }
  return !processIsAlive(pid);
}

function readFixturePid(file) {
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, 'utf8'));
  return Number.isSafeInteger(pid) ? pid : undefined;
}

function processCommandContains(pid, identity) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).includes(identity);
  } catch (error) {
    if (error?.status === 1) return false;
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assertOrderedItems,
  browserSuiteAcceptanceGateFact,
  browserSuiteAcceptanceModulePath,
  browserSuiteAcceptanceProjectFact,
  commandOutputLines,
  commandSequence,
  commandSequenceWithoutLast,
  conformanceGateFacts,
  loadVitePlusConfig,
  nodeTaskCommand,
  pnpmFilterTestCommands,
  pnpmRunScriptName,
  pnpmRunScriptNames,
  p10PerfAcceptanceGateFact,
  p10PerfAcceptanceModulePath,
  p10PerfAcceptanceProjectFact,
  requiredVpRunTaskName,
  runCapturedCliCommand,
  vitePlusAcceptanceTaskFacts,
  vitePlusTaskInputFacts,
  vitePlusTaskInputPatternEndingWith,
  vitestTaskCommand,
  vpRunTaskName,
  workflowVpRunTaskNames,
  workflowStepCommands,
} from './command-fixtures.js';

describe('@kovojs/test command fixtures', () => {
  it('turns shell-free command sequences into argv facts', () => {
    expect(
      commandSequence('vp run kovo-check && pnpm --filter @kovojs/conformance-auth-spike test'),
    ).toEqual([
      {
        args: ['run', 'kovo-check'],
        argv: ['vp', 'run', 'kovo-check'],
        executable: 'vp',
        raw: 'vp run kovo-check',
      },
      {
        args: ['--filter', '@kovojs/conformance-auth-spike', 'test'],
        argv: ['pnpm', '--filter', '@kovojs/conformance-auth-spike', 'test'],
        executable: 'pnpm',
        raw: 'pnpm --filter @kovojs/conformance-auth-spike test',
      },
    ]);
  });

  it('derives command prefixes through parsed command facts', () => {
    expect(
      commandSequenceWithoutLast(
        'pnpm --filter @kovojs/one test && pnpm --filter @kovojs/two test && pnpm --filter @kovojs/three test',
      ),
    ).toBe('pnpm --filter @kovojs/one test && pnpm --filter @kovojs/two test');
    expect(() => commandSequenceWithoutLast('pnpm --filter @kovojs/one test')).toThrow(
      'task command has more than one entry',
    );
  });

  it('rejects command strings that need shell parsing', () => {
    expect(() => commandSequence('node script.mjs > out.txt')).toThrow(
      'task command avoids shell syntax: node script.mjs > out.txt',
    );
  });

  it('extracts package script and Vite+ task names from structured command forms', () => {
    expect(pnpmRunScriptName('pnpm run test:conformance')).toBe('test:conformance');
    expect(pnpmRunScriptNames('pnpm run check:build && pnpm run test:conformance')).toEqual([
      'check:build',
      'test:conformance',
    ]);
    expect(vpRunTaskName('vp run kovo-check')).toBe('kovo-check');
    expect(
      requiredVpRunTaskName('check:kovo', { scripts: { 'check:kovo': 'vp run kovo-check' } }),
    ).toBe('kovo-check');
    expect(() => requiredVpRunTaskName('missing', { scripts: {} })).toThrow(
      'missing script exists',
    );
  });

  it('asserts required task ordering without keeping local kovo-check helpers', () => {
    expect(() =>
      assertOrderedItems(['build', 'perf', 'kovo-check'], 'build', 'kovo-check'),
    ).not.toThrow();
    expect(() => assertOrderedItems(['kovo-check', 'perf'], 'perf', 'kovo-check')).toThrow(
      'perf precedes kovo-check',
    );
    expect(() => assertOrderedItems(['build'], 'build', 'kovo-check')).toThrow(
      'kovo-check is present',
    );
  });

  it('normalizes line-oriented command output without local stdout parsers', () => {
    expect(commandOutputLines('prod-emit-check/v1\r\nOK\r\n')).toEqual([
      'prod-emit-check/v1',
      'OK',
    ]);
    expect(commandOutputLines('')).toEqual([]);
  });

  it('captures CLI main stdout and stderr with stream restoration', async () => {
    const originalStdoutWrite = Reflect.get(process.stdout, 'write');
    const originalStderrWrite = Reflect.get(process.stderr, 'write');

    await expect(
      runCapturedCliCommand(
        async (args) => {
          process.stdout.write(`args=${args.join(',')}\n`);
          process.stderr.write('diagnostic\n');
          return 7;
        },
        ['check', 'fixture'],
      ),
    ).resolves.toEqual({
      exitCode: 7,
      stderr: 'diagnostic\n',
      stdout: 'args=check,fixture\n',
    });

    expect(Reflect.get(process.stdout, 'write')).toBe(originalStdoutWrite);
    expect(Reflect.get(process.stderr, 'write')).toBe(originalStderrWrite);
  });

  it('restores CLI streams when the injected main throws', async () => {
    const originalStdoutWrite = Reflect.get(process.stdout, 'write');
    const originalStderrWrite = Reflect.get(process.stderr, 'write');

    await expect(
      runCapturedCliCommand(async () => {
        process.stdout.write('before throw\n');
        throw new Error('boom');
      }, []),
    ).rejects.toThrow('boom');

    expect(Reflect.get(process.stdout, 'write')).toBe(originalStdoutWrite);
    expect(Reflect.get(process.stderr, 'write')).toBe(originalStderrWrite);
  });

  it('extracts task-specific command facts used by framework gates', () => {
    expect(vitestTaskCommand('vitest --run --config vitest.browser.config.ts')).toEqual({
      configPath: 'vitest.browser.config.ts',
    });
    expect(nodeTaskCommand('node scripts/p10-perf.mjs')).toEqual({
      modulePath: 'scripts/p10-perf.mjs',
    });
    expect(pnpmFilterTestCommands('pnpm --filter @kovojs/conformance-auth-spike test')).toEqual([
      {
        argv: ['pnpm', '--filter', '@kovojs/conformance-auth-spike', 'test'],
        packageName: '@kovojs/conformance-auth-spike',
        script: 'test',
      },
    ]);
  });

  it('collects workflow run and uses commands without exposing kovo-check to YAML text scans', () => {
    const workflow = [
      'name: CI',
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - run: vp install',
      '      - run: vp run build',
    ].join('\n');

    expect(workflowStepCommands(workflow)).toEqual([
      { uses: 'actions/checkout@v4' },
      { run: 'vp install' },
      { run: 'vp run build' },
    ]);
    expect(workflowVpRunTaskNames(workflow)).toEqual(['build']);
  });

  it('loads Vite+ task configs through the fixture seam', async () => {
    const config = await loadVitePlusConfig(
      [
        "import { defineConfig } from 'vite-plus';",
        "import fixturePlugin from 'fixture-vite-plugin';",
        'export default defineConfig({',
        '  plugins: [fixturePlugin()],',
        '  run: {',
        '    tasks: {',
        "      'kovo-check': {",
        "        command: 'kovo check graph.json',",
        "        input: [{ pattern: 'src/**/*', base: 'workspace' }],",
        "        output: ['graph.json'],",
        '      },',
        '    },',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(config.run?.tasks?.['kovo-check']).toEqual({
      command: 'kovo check graph.json',
      input: [{ pattern: 'src/**/*', base: 'workspace' }],
      output: ['graph.json'],
    });
  });

  it('collects acceptance task facts from package scripts, CI, and Vite+ config', () => {
    const packageJson = {
      scripts: {
        acceptance: 'pnpm run check:build && pnpm run test:browser && pnpm run check:kovo',
        'test:browser': 'vp run browser',
      },
    };
    const ciWorkflowSource = [
      'steps:',
      '  - run: vp run build',
      '  - run: vp run browser',
      '  - run: vp run kovo-check',
    ].join('\n');
    const viteConfig = {
      run: {
        tasks: {
          browser: {
            command: 'vitest --run --config vitest.browser.config.ts',
            input: [
              { auto: true },
              { base: 'workspace', pattern: 'vitest.browser.config.ts' },
              { base: 'workspace', pattern: 'scripts/browser-acceptance.mjs' },
            ],
          },
        },
      },
    };

    const facts = vitePlusAcceptanceTaskFacts({
      ciWorkflowSource,
      packageJson,
      scriptName: 'test:browser',
      viteConfig,
    });

    expect(facts).toMatchObject({
      acceptanceScripts: ['check:build', 'test:browser', 'check:kovo'],
      ciTaskNames: ['build', 'browser', 'kovo-check'],
      presentInAcceptance: true,
      presentInCi: true,
      scriptName: 'test:browser',
      taskName: 'browser',
    });
    expect(vitePlusTaskInputFacts(facts.task)).toEqual([
      { auto: true },
      { base: 'workspace', pattern: 'vitest.browser.config.ts' },
      { base: 'workspace', pattern: 'scripts/browser-acceptance.mjs' },
    ]);
    expect(vitePlusTaskInputPatternEndingWith(facts.task, '/browser-acceptance.mjs')).toBe(
      'scripts/browser-acceptance.mjs',
    );
  });

  it('projects browser suite acceptance wiring as a reusable gate fact', () => {
    const fact = browserSuiteAcceptanceGateFact({
      acceptance: {
        browsers: ['chromium', 'firefox', 'webkit'],
        headless: true,
        include: ['packages/browser/src/**/*.browser.test.ts'],
        providerPackage: '@vitest/browser-playwright',
      },
      ciWorkflowSource: [
        'steps:',
        '  - run: vp run build',
        '  - run: vp run browser',
        '  - run: vp run kovo-check',
      ].join('\n'),
      packageJson: {
        scripts: {
          acceptance: 'pnpm run check:build && pnpm run test:browser && pnpm run check:kovo',
          'test:browser': 'vp run browser',
        },
      },
      viteConfig: {
        run: {
          tasks: {
            browser: {
              command: 'vitest --run --config vitest.browser.config.ts',
              input: [
                { auto: true },
                { base: 'workspace', pattern: 'vitest.browser.config.ts' },
                { base: 'workspace', pattern: 'scripts/browser-acceptance.mjs' },
              ],
            },
          },
        },
      },
    });

    expect(fact).toEqual({
      acceptance: {
        browsers: ['chromium', 'firefox', 'webkit'],
        headless: true,
        include: ['packages/browser/src/**/*.browser.test.ts'],
        providerPackage: '@vitest/browser-playwright',
      },
      inputFacts: [
        { auto: true },
        { base: 'workspace', pattern: 'vitest.browser.config.ts' },
        { base: 'workspace', pattern: 'scripts/browser-acceptance.mjs' },
        { base: 'workspace', pattern: 'packages/browser/src/**/*.browser.test.ts' },
      ],
      presentInAcceptance: true,
      presentInCi: true,
      scriptName: 'test:browser',
      taskName: 'browser',
    });
    expect(
      browserSuiteAcceptanceModulePath({
        packageJson: {
          scripts: {
            'test:browser': 'vp run browser',
          },
        },
        viteConfig: {
          run: {
            tasks: {
              browser: {
                command: 'vitest --run --config vitest.browser.config.ts',
                input: [{ base: 'workspace', pattern: 'scripts/browser-acceptance.mjs' }],
              },
            },
          },
        },
      }),
    ).toBe('scripts/browser-acceptance.mjs');
  });

  it('loads browser suite acceptance wiring from a project root fixture', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'kovo-browser-acceptance-'));

    try {
      await mkdir(join(rootPath, '.github/workflows'), { recursive: true });
      await mkdir(join(rootPath, 'tests'), { recursive: true });
      await writeFile(
        join(rootPath, 'package.json'),
        JSON.stringify({
          scripts: {
            acceptance: 'pnpm run check:build && pnpm run test:browser && pnpm run check:kovo',
            'test:browser': 'vp run browser',
          },
        }),
      );
      await writeFile(
        join(rootPath, '.github/workflows/ci.yml'),
        ['steps:', '  - run: vp run build', '  - run: vp run browser'].join('\n'),
      );
      await writeFile(
        join(rootPath, 'vite.config.ts'),
        [
          "import { defineConfig } from 'vite-plus';",
          'export default defineConfig({',
          '  run: {',
          '    tasks: {',
          '      browser: {',
          "        command: 'vitest --run --config vitest.browser.config.ts',",
          '        input: [',
          '          { auto: true },',
          "          { base: 'workspace', pattern: 'vitest.browser.config.ts' },",
          "          { base: 'workspace', pattern: 'tests/browser-acceptance.mjs' },",
          '        ],',
          '      },',
          '    },',
          '  },',
          '});',
        ].join('\n'),
      );
      await writeFile(
        join(rootPath, 'tests/browser-acceptance.mjs'),
        [
          'export const browserSuiteAcceptance = {',
          "  browsers: ['chromium', 'firefox', 'webkit'],",
          '  headless: true,',
          "  include: ['packages/browser/src/**/*.browser.test.ts'],",
          "  providerPackage: '@vitest/browser-playwright',",
          '};',
        ].join('\n'),
      );

      await expect(browserSuiteAcceptanceProjectFact({ rootPath })).resolves.toEqual({
        acceptance: {
          browsers: ['chromium', 'firefox', 'webkit'],
          headless: true,
          include: ['packages/browser/src/**/*.browser.test.ts'],
          providerPackage: '@vitest/browser-playwright',
        },
        inputFacts: [
          { auto: true },
          { base: 'workspace', pattern: 'vitest.browser.config.ts' },
          { base: 'workspace', pattern: 'tests/browser-acceptance.mjs' },
          { base: 'workspace', pattern: 'packages/browser/src/**/*.browser.test.ts' },
        ],
        presentInAcceptance: true,
        presentInCi: true,
        scriptName: 'test:browser',
        taskName: 'browser',
      });
    } finally {
      await rm(rootPath, { force: true, recursive: true });
    }
  });

  it('projects P10 perf acceptance wiring and ordering as a reusable gate fact', () => {
    const fact = p10PerfAcceptanceGateFact({
      acceptance: {
        browser: 'chromium',
        cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
        heapNoiseBudget: 65536,
        navigationCount: 100,
        paintEntry: 'first-contentful-paint',
        prerenderTimingField: 'activationStart',
        ttiMetric: 'ttiMinusFcpMs',
      },
      ciWorkflowSource: [
        'steps:',
        '  - run: vp run build',
        '  - run: vp run p10-perf',
        '  - run: vp run kovo-check',
      ].join('\n'),
      packageJson: {
        scripts: {
          acceptance: 'pnpm run check:build && pnpm run test:p10-perf && pnpm run check:kovo',
          'test:p10-perf': 'vp run p10-perf',
        },
      },
      runFunction: () => undefined,
      viteConfig: {
        run: {
          tasks: {
            'p10-perf': {
              command: 'node scripts/p10-perf.mjs',
              input: [
                { auto: true },
                { base: 'workspace', pattern: 'scripts/p10-perf.mjs' },
                { base: 'workspace', pattern: 'dist/**' },
              ],
            },
          },
        },
      },
    });

    expect(fact).toEqual({
      acceptance: {
        browser: 'chromium',
        cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
        heapNoiseBudget: 65536,
        navigationCount: 100,
        paintEntry: 'first-contentful-paint',
        prerenderTimingField: 'activationStart',
        ttiMetric: 'ttiMinusFcpMs',
      },
      inputFacts: [
        { auto: true },
        { base: 'workspace', pattern: 'scripts/p10-perf.mjs' },
        { base: 'workspace', pattern: 'dist/**' },
      ],
      ordering: {
        acceptanceAfterBuild: true,
        acceptanceBeforeKovoCheck: true,
        ciAfterBuild: true,
        ciBeforeKovoCheck: true,
      },
      presentInAcceptance: true,
      presentInCi: true,
      runFunction: true,
      scriptName: 'test:p10-perf',
      taskName: 'p10-perf',
    });
    expect(
      p10PerfAcceptanceModulePath({
        packageJson: {
          scripts: {
            'test:p10-perf': 'vp run p10-perf',
          },
        },
        viteConfig: {
          run: {
            tasks: {
              'p10-perf': {
                command: 'node scripts/p10-perf.mjs',
                input: [{ base: 'workspace', pattern: 'scripts/p10-perf.mjs' }],
              },
            },
          },
        },
      }),
    ).toBe('scripts/p10-perf.mjs');
  });

  it('loads P10 perf acceptance wiring from a project root fixture', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'kovo-p10-perf-acceptance-'));

    try {
      await mkdir(join(rootPath, '.github/workflows'), { recursive: true });
      await mkdir(join(rootPath, 'scripts'), { recursive: true });
      await writeFile(
        join(rootPath, 'package.json'),
        JSON.stringify({
          scripts: {
            acceptance: 'pnpm run check:build && pnpm run test:p10-perf && pnpm run check:kovo',
            'test:p10-perf': 'vp run p10-perf',
          },
        }),
      );
      await writeFile(
        join(rootPath, '.github/workflows/ci.yml'),
        [
          'steps:',
          '  - run: vp run build',
          '  - run: vp run p10-perf',
          '  - run: vp run kovo-check',
        ].join('\n'),
      );
      await writeFile(
        join(rootPath, 'vite.config.ts'),
        [
          "import { defineConfig } from 'vite-plus';",
          'export default defineConfig({',
          '  run: {',
          '    tasks: {',
          "      'p10-perf': {",
          "        command: 'node scripts/p10-perf.mjs',",
          '        input: [',
          '          { auto: true },',
          "          { base: 'workspace', pattern: 'scripts/p10-perf.mjs' },",
          "          { base: 'workspace', pattern: 'dist/**' },",
          '        ],',
          '      },',
          '    },',
          '  },',
          '});',
        ].join('\n'),
      );
      await writeFile(
        join(rootPath, 'scripts/p10-perf.mjs'),
        [
          'export const p10PerfAcceptance = {',
          "  browser: 'chromium',",
          "  cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],",
          '  heapNoiseBudget: 65536,',
          '  navigationCount: 100,',
          "  paintEntry: 'first-contentful-paint',",
          "  prerenderTimingField: 'activationStart',",
          "  ttiMetric: 'ttiMinusFcpMs',",
          '};',
          'export function runP10PerfAcceptance() {}',
        ].join('\n'),
      );

      await expect(p10PerfAcceptanceProjectFact({ rootPath })).resolves.toEqual({
        acceptance: {
          browser: 'chromium',
          cdpMethods: ['HeapProfiler.collectGarbage', 'Runtime.getHeapUsage'],
          heapNoiseBudget: 65536,
          navigationCount: 100,
          paintEntry: 'first-contentful-paint',
          prerenderTimingField: 'activationStart',
          ttiMetric: 'ttiMinusFcpMs',
        },
        inputFacts: [
          { auto: true },
          { base: 'workspace', pattern: 'scripts/p10-perf.mjs' },
          { base: 'workspace', pattern: 'dist/**' },
        ],
        ordering: {
          acceptanceAfterBuild: true,
          acceptanceBeforeKovoCheck: true,
          ciAfterBuild: true,
          ciBeforeKovoCheck: true,
        },
        presentInAcceptance: true,
        presentInCi: true,
        runFunction: true,
        scriptName: 'test:p10-perf',
        taskName: 'p10-perf',
      });
    } finally {
      await rm(rootPath, { force: true, recursive: true });
    }
  });

  it('collects conformance gate facts without local kovo-check package parsers', () => {
    const facts = conformanceGateFacts({
      expectedPackages: {
        'auth-spike': '@kovojs/conformance-auth-spike',
        'webhook-spike': '@kovojs/conformance-webhook-spike',
      },
      packageJson: {
        scripts: {
          acceptance: 'pnpm run test:conformance && pnpm run check:kovo',
          'test:conformance': 'vp run conformance',
        },
      },
      packages: [
        {
          directory: 'auth-spike',
          manifest: { name: '@kovojs/conformance-auth-spike', scripts: { test: 'vitest --run' } },
        },
        {
          directory: 'webhook-spike',
          manifest: {
            name: '@kovojs/conformance-webhook-spike',
            scripts: { test: 'vitest --run' },
          },
        },
      ],
      scriptName: 'test:conformance',
      viteConfig: {
        run: {
          tasks: {
            conformance: {
              command:
                'pnpm --filter @kovojs/conformance-auth-spike test && pnpm --filter @kovojs/conformance-webhook-spike test',
              input: [
                { auto: true },
                { pattern: 'conformance/**/package.json', base: 'workspace' },
              ],
            },
          },
        },
      },
    });

    expect(facts).toMatchObject({
      everyCommandRunsTest: true,
      everyPackageHasTestScript: true,
      packageEntries: [
        ['auth-spike', '@kovojs/conformance-auth-spike'],
        ['webhook-spike', '@kovojs/conformance-webhook-spike'],
      ],
      packageNames: ['@kovojs/conformance-auth-spike', '@kovojs/conformance-webhook-spike'],
      presentInAcceptance: true,
      taskName: 'conformance',
    });
    expect(facts.commands.map(({ packageName }) => packageName)).toEqual([
      '@kovojs/conformance-auth-spike',
      '@kovojs/conformance-webhook-spike',
    ]);
    expect(facts.inputFacts).toEqual([
      { auto: true },
      { base: 'workspace', pattern: 'conformance/**/package.json' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  assertOrderedItems,
  commandSequence,
  loadVitePlusConfig,
  nodeTaskCommand,
  pnpmFilterTestCommands,
  pnpmRunScriptName,
  pnpmRunScriptNames,
  requiredVpRunTaskName,
  vitestTaskCommand,
  vpRunTaskName,
  workflowVpRunTaskNames,
  workflowStepCommands,
} from './command-fixtures.js';

describe('@jiso/test command fixtures', () => {
  it('turns shell-free command sequences into argv facts', () => {
    expect(
      commandSequence('vp run fw-check && pnpm --filter @jiso/conformance-auth-spike test'),
    ).toEqual([
      {
        args: ['run', 'fw-check'],
        argv: ['vp', 'run', 'fw-check'],
        executable: 'vp',
        raw: 'vp run fw-check',
      },
      {
        args: ['--filter', '@jiso/conformance-auth-spike', 'test'],
        argv: ['pnpm', '--filter', '@jiso/conformance-auth-spike', 'test'],
        executable: 'pnpm',
        raw: 'pnpm --filter @jiso/conformance-auth-spike test',
      },
    ]);
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
    expect(vpRunTaskName('vp run fw-check')).toBe('fw-check');
    expect(requiredVpRunTaskName('check:fw', { scripts: { 'check:fw': 'vp run fw-check' } })).toBe(
      'fw-check',
    );
    expect(() => requiredVpRunTaskName('missing', { scripts: {} })).toThrow(
      'missing script exists',
    );
  });

  it('asserts required task ordering without keeping local fw-check helpers', () => {
    expect(() =>
      assertOrderedItems(['build', 'perf', 'fw-check'], 'build', 'fw-check'),
    ).not.toThrow();
    expect(() => assertOrderedItems(['fw-check', 'perf'], 'perf', 'fw-check')).toThrow(
      'perf precedes fw-check',
    );
    expect(() => assertOrderedItems(['build'], 'build', 'fw-check')).toThrow('fw-check is present');
  });

  it('extracts task-specific command facts used by framework gates', () => {
    expect(vitestTaskCommand('vitest --run --config vitest.browser.config.ts')).toEqual({
      configPath: 'vitest.browser.config.ts',
    });
    expect(nodeTaskCommand('node scripts/p10-perf.mjs')).toEqual({
      modulePath: 'scripts/p10-perf.mjs',
    });
    expect(pnpmFilterTestCommands('pnpm --filter @jiso/conformance-auth-spike test')).toEqual([
      {
        argv: ['pnpm', '--filter', '@jiso/conformance-auth-spike', 'test'],
        packageName: '@jiso/conformance-auth-spike',
        script: 'test',
      },
    ]);
  });

  it('collects workflow run and uses commands without exposing fw-check to YAML text scans', () => {
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
        "import tailwindcss from '@tailwindcss/vite';",
        'export default defineConfig({',
        '  plugins: [tailwindcss()],',
        '  run: {',
        '    tasks: {',
        "      'fw-check': {",
        "        command: 'fw check graph.json',",
        "        input: [{ pattern: 'src/**/*', base: 'workspace' }],",
        "        output: ['graph.json'],",
        '      },',
        '    },',
        '  },',
        '});',
      ].join('\n'),
    );

    expect(config.run?.tasks?.['fw-check']).toEqual({
      command: 'fw check graph.json',
      input: [{ pattern: 'src/**/*', base: 'workspace' }],
      output: ['graph.json'],
    });
  });
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPackedKovoResolutions,
  extractKovoInvocations,
  loadCodeSamplePolicy,
  scanMarkdownSamples,
  tokenizeShell,
  validateKovoInvocations,
} from './packed-doc-samples.mjs';

const policy = loadCodeSamplePolicy();

describe('packed documentation sample inventory', () => {
  it('classifies executable, expected-error, output, and reviewed illustrative fences', () => {
    const samples = scanMarkdownSamples(
      [
        '```ts',
        "import { component } from '@kovojs/core';",
        'export const Card = component(() => null);',
        '```',
        '',
        '<!-- kovo-sample: type-error -->',
        '',
        '```ts',
        "import { missing } from '@kovojs/core';",
        '```',
        '',
        '```text',
        'OK',
        '```',
        '',
        '<!-- kovo-sample: illustrative reason="Requires an app-owned schema." -->',
        '',
        '```sql',
        'select * from app_table;',
        '```',
      ].join('\n'),
      { origin: 'authored-guide', policy, sourcePath: 'guide.md' },
    );

    expect(samples.map((sample) => sample.class)).toEqual([
      'executable',
      'type-error',
      'output',
      'illustrative',
    ]);
    expect(samples[3].reason).toBe('Requires an app-owned schema.');
  });

  it.each([
    {
      message: 'unclosed code fence',
      source: ['```ts', 'const value = 1;'].join('\n'),
    },
    {
      message: 'unclassified code-fence language',
      source: ['```wat', 'thing', '```'].join('\n'),
    },
    {
      message: 'illustrative sample directive requires reason',
      source: ['<!-- kovo-sample: illustrative -->', '```ts', 'const value = 1;', '```'].join('\n'),
    },
    {
      message: 'orphan or malformed sample directive',
      source: [
        '<!-- kovo-sample: output -->',
        '',
        'This prose breaks ownership.',
        '```text',
        'OK',
        '```',
      ].join('\n'),
    },
    {
      message: 'sample directive must be the first code line',
      source: ['```ts', 'const value = 1;', '// kovo-sample: output', '```'].join('\n'),
    },
  ])('fails closed on $message', ({ message, source }) => {
    expect(() =>
      scanMarkdownSamples(source, {
        origin: 'authored-guide',
        policy,
        sourcePath: 'bad.md',
      }),
    ).toThrow(message);
  });

  it('marks source-attributed partial excerpts with the reviewed provenance reason', () => {
    const [sample] = scanMarkdownSamples(
      ['```tsx', '// Source: examples/app/src/page.tsx', 'return <main />;', '```'].join('\n'),
      { origin: 'authored-guide', policy, sourcePath: 'guide.md' },
    );
    expect(sample).toMatchObject({
      class: 'illustrative',
      reason: policy.reviewedSkips['source-provenance'].reason,
    });
  });
});

describe('documented CLI schema parsing', () => {
  it('tokenizes quotes, comments, environment assignments, and pipelines without executing', () => {
    expect(
      tokenizeShell('KOVO_MODE=dev kovo explain query "cart items" graph.json # note'),
    ).toEqual(['KOVO_MODE=dev', 'kovo', 'explain', 'query', 'cart items', 'graph.json']);
    expect(
      extractKovoInvocations(
        [
          'pnpm create kovo my-app',
          'pnpm exec kovo check graph.json',
          'KOVO_MODE=dev kovo explain query cart graph.json | grep consumers',
        ].join('\n'),
      ).map((entry) => entry.argv),
    ).toEqual([
      ['check', 'graph.json'],
      ['explain', 'query', 'cart', 'graph.json'],
    ]);
  });

  it('accepts real command forms and rejects synopsis notation through the owning schema', async () => {
    const valid = [
      {
        class: 'executable',
        code: 'kovo explain query cart graph.json',
        language: 'sh',
        sourcePath: 'cli.md',
        startLine: 1,
      },
    ];
    await expect(validateKovoInvocations(valid)).resolves.toBe(1);

    await expect(
      validateKovoInvocations([
        {
          ...valid[0],
          code: 'kovo audit [--fail-on-findings] [graph.json]',
        },
      ]),
    ).rejects.toThrow('contradicts command schema');
  });
});

describe('packed module resolution proof', () => {
  it('accepts a materialized packed declaration and rejects workspace/source fallback', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-packed-resolution-'));
    try {
      const packageDir = path.join(root, 'node_modules/@kovojs/core');
      const sampleFile = path.join(root, 'sample.ts');
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        path.join(packageDir, 'package.json'),
        `${JSON.stringify({
          exports: { '.': { types: './index.d.ts', default: './index.js' } },
          name: '@kovojs/core',
          type: 'module',
        })}\n`,
      );
      await writeFile(path.join(packageDir, 'index.d.ts'), 'export declare const component: {};\n');
      await writeFile(sampleFile, "import { component } from '@kovojs/core';\nvoid component;\n");
      const sample = {
        file: sampleFile,
        sourcePath: 'guide.md',
        startLine: 1,
      };
      const compilerOptions = {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2024',
      };

      expect(
        assertPackedKovoResolutions(
          [sample],
          root,
          path.join(root, 'node_modules'),
          compilerOptions,
        ),
      ).toBe(1);
      expect(() =>
        assertPackedKovoResolutions(
          [sample],
          root,
          path.join(root, 'different-node-modules'),
          compilerOptions,
        ),
      ).toThrow('resolved outside its packed package');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

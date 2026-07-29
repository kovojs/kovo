import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertPackedKovoResolutions,
  expectedTypeErrorDiagnostic,
  extractCreateKovoInvocations,
  extractKovoInvocations,
  loadCodeSamplePolicy,
  scanMarkdownSamples,
  tokenizeShell,
  validateKovoInvocations,
  validateAuxiliarySamples,
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

  it('extracts an optional diagnostic witness from expected-error samples', () => {
    expect(
      expectedTypeErrorDiagnostic({
        class: 'type-error',
        code: ["// kovo-expected-error: Property 'oldName' does not exist", 'value.oldName;'].join(
          '\n',
        ),
      }),
    ).toBe("Property 'oldName' does not exist");
    expect(
      expectedTypeErrorDiagnostic({ class: 'type-error', code: 'value.oldName;' }),
    ).toBeUndefined();
    expect(
      expectedTypeErrorDiagnostic({
        class: 'executable',
        code: '// kovo-expected-error: ignored',
      }),
    ).toBeUndefined();
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

  it('distinguishes generated API examples from declaration signatures', () => {
    const samples = scanMarkdownSamples(
      [
        '**Copyable example**',
        '',
        '```ts',
        "import { component } from '@kovojs/core';",
        'void component;',
        '```',
        '',
        '```ts',
        'export declare const component: unknown;',
        '```',
      ].join('\n'),
      { origin: 'generated-api', policy, sourcePath: 'generated-api/core.md' },
    );

    expect(samples[0]).toMatchObject({
      class: 'executable',
      origin: 'generated-api/jsdoc',
    });
    expect(samples[1]).toMatchObject({
      class: 'illustrative',
      origin: 'generated-api',
      reason: policy.reviewedSkips['generated-signature'].reason,
    });
  });

  it('supports tilde fences and rejects source code disguised as text output', () => {
    const [sample] = scanMarkdownSamples(
      ['~~~ts', "import { component } from '@kovojs/core';", 'void component;', '~~~'].join('\n'),
      { origin: 'authored-guide', policy, sourcePath: 'guide.md' },
    );
    expect(sample).toMatchObject({ class: 'executable', language: 'ts' });

    expect(() =>
      scanMarkdownSamples(
        ['```text', "import { component } from '@kovojs/core';", '```'].join('\n'),
        { origin: 'authored-guide', policy, sourcePath: 'bad.md' },
      ),
    ).toThrow('code-shaped text fence requires its real language');
  });

  it('requires reviewed source-provenance skips to name a tracked repository file', () => {
    const samples = scanMarkdownSamples(
      ['```ts', '// Source: examples/does-not-exist.ts', 'void example;', '```'].join('\n'),
      { origin: 'authored-guide', policy, sourcePath: 'guide.md' },
    );
    expect(() => validateAuxiliarySamples(samples, policy)).toThrow(
      'reviewed source path does not exist',
    );
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
    expect(
      extractCreateKovoInvocations(
        [
          'pnpm create kovo my-app -- --dialect sqlite --experimental-sqlite',
          'pnpm dlx create-kovo@0.2.0 another-app --disable-git',
          'npx create-kovo third-app',
        ].join('\n'),
      ).map((entry) => entry.argv),
    ).toEqual([
      ['my-app', '--dialect', 'sqlite', '--experimental-sqlite'],
      ['another-app', '--disable-git'],
      ['third-app'],
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

    await expect(
      validateKovoInvocations([
        {
          ...valid[0],
          code: 'pnpm create kovo my-app -- --template app',
        },
      ]),
    ).rejects.toThrow('documented create-kovo invocation contradicts command schema');
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

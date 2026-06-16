import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectApiExamples, extractExampleBlocks } from './api-examples-check.mjs';
import { generateApiReference } from './api-ref.mjs';

/**
 * The `@example` gate must extract only the example blocks the generator marks
 * with `**Example**`, never the type-signature fences — otherwise the gate would
 * try to compile signatures (which are not standalone programs) and fail, or
 * silently miss examples.
 */

const SAMPLE = [
  '### `component`',
  '',
  'Declare a component.',
  '',
  '| Parameter | Description |',
  '| --- | --- |',
  '| `name` | The name. |',
  '',
  '```ts',
  'function component(name: string): unknown;',
  '```',
  '',
  '**Example**',
  '',
  '```ts',
  "import { component } from '@kovojs/core';",
  "const c = component('x', { render: () => null });",
  '```',
].join('\n');

describe('api-examples extractor', () => {
  it('extracts only the example fence, never the signature fence', () => {
    const blocks = extractExampleBlocks(SAMPLE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("import { component } from '@kovojs/core';");
    expect(blocks[0]).not.toContain('function component(name: string)');
  });

  it('ignores a ```ts fence that is not preceded by an Example marker', () => {
    const onlySignature = ['### `x`', '', 'Doc.', '', '```ts', 'const x = 1;', '```'].join('\n');
    expect(extractExampleBlocks(onlySignature)).toHaveLength(0);
  });

  it('collects examples from the generated pages with stable ids', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'kovo-api-examples-'));

    try {
      await generateApiReference({ outDir });
      const examples = collectApiExamples(outDir);
      expect(examples.length).toBeGreaterThan(0);
      // Every example is a non-empty TS block keyed by `<slug>__<heading>__<n>`.
      for (const example of examples) {
        expect(example.id).toMatch(/^[\w-]+__[\w-]+__\d+$/);
        expect(example.code.trim().length).toBeGreaterThan(0);
      }
      // The `component` export's example is present and imports the real export.
      const component = examples.find((example) => example.id.startsWith('core__component__'));
      expect(component?.code).toContain("from '@kovojs/core'");
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});

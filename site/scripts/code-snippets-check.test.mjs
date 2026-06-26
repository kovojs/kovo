import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectCodeSnippets, extractCodeSnippets } from './code-snippets-check.mjs';

describe('authored code snippet extractor', () => {
  it('extracts ts and tsx fences with stable source metadata', () => {
    const markdown = [
      '# Page',
      '',
      '```ts',
      'const count = 1;',
      '```',
      '',
      '```tsx',
      'export function View() {',
      '  return <span />;',
      '}',
      '```',
    ].join('\n');

    const snippets = extractCodeSnippets(markdown, 'guides/example.md');
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toMatchObject({
      id: 'guides-example__L3',
      lang: 'ts',
      sourcePath: 'guides/example.md',
      startLine: 3,
    });
    expect(snippets[1]).toMatchObject({
      id: 'guides-example__L7',
      lang: 'tsx',
      sourcePath: 'guides/example.md',
      startLine: 7,
    });
  });

  it('treats ts fences containing JSX as tsx snippets', () => {
    const snippets = extractCodeSnippets(
      ['```ts', 'export function View() {', '  return <Button />;', '}', '```'].join('\n'),
      'page.md',
    );
    expect(snippets).toHaveLength(1);
    expect(snippets[0].lang).toBe('tsx');
  });

  it('ignores non-TypeScript fences', () => {
    const markdown = ['```sh', 'pnpm run check', '```', '', '```json', '{"ok":true}', '```'].join(
      '\n',
    );
    expect(extractCodeSnippets(markdown, 'page.md')).toHaveLength(0);
  });

  it('collects markdown files recursively in deterministic order', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-code-snippets-'));
    try {
      await writeFile(path.join(root, 'b.md'), ['```ts', 'const b = 1;', '```'].join('\n'), 'utf8');
      await writeFile(
        path.join(root, 'a.md'),
        ['```tsx', 'const a = <div />;', '```'].join('\n'),
        'utf8',
      );

      const snippets = await collectCodeSnippets(root);
      expect(snippets.map((snippet) => snippet.id)).toEqual(['a__L1', 'b__L1']);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

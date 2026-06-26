import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  checkAuthoredDocStyle,
  collectCodeSnippets,
  extractCodeSnippets,
} from './code-snippets-check.mjs';

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

  it('rejects a large first TypeScript block', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '```ts',
          'const a = 1;',
          'const b = 2;',
          'const c = 3;',
          'const d = 4;',
          'const e = 5;',
          'const f = 6;',
          'const g = 7;',
          'const h = 8;',
          'const i = 9;',
          'const j = 10;',
          'const k = 11;',
          'const l = 12;',
          'const m = 13;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('allows SPEC citations inside collapsed details only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first.',
          '',
          '```ts',
          'const count = 1;',
          '```',
          '',
          '<details>',
          '<summary>Spec & diagnostics</summary>',
          '',
          'SPEC §9.1 and KV310 live here.',
          '',
          '</details>',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).resolves.toBeUndefined();

      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'A cart page should show the useful path first. SPEC §9.1 explains why.',
          '',
          '```ts',
          'const count = 1;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('rejects framework-noun openers without an app noun', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kovo-doc-style-'));
    try {
      await writeFile(
        path.join(root, 'page.md'),
        [
          '# Page',
          '',
          'The invalidation graph derives from framework internals.',
          '',
          '```ts',
          'const count = 1;',
          '```',
        ].join('\n'),
        'utf8',
      );

      await expect(checkAuthoredDocStyle({ dir: root })).rejects.toThrow('doc-style');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

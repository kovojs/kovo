import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { kovoDocsMirrorRemotes } from '@kovojs/core/internal/agent-docs';
import { describe, expect, it } from 'vitest';

import { runUpdateDocsCommand } from './index.js';

describe('kovo update-docs', () => {
  it('fetches docs, refreshes the marked AGENTS.md block, and mirrors docs locally', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-update-docs-'));

    try {
      writeFileSync(
        join(root, 'AGENTS.md'),
        [
          '# App Agents',
          '',
          'Before.',
          '',
          '<!-- BEGIN:kovo-rules -->',
          '# stale',
          '<!-- END:kovo-rules -->',
          '',
          'After.',
          '',
        ].join('\n'),
      );

      const result = await runUpdateDocsCommand({
        cwd: root,
        fetchImpl: async (input) => {
          const url = String(input);
          const remote = kovoDocsMirrorRemotes.find((candidate) => candidate.url === url);
          return new Response(`# fetched ${remote?.path ?? url}\n`, { status: 200 });
        },
        version: '9.8.7',
      });

      expect(result).toEqual({
        exitCode: 0,
        output: 'kovo-update-docs/v1\nOK source=fetched files=14\nOK fetched latest docs\n',
      });

      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('Before.');
      expect(agents).toContain('After.');
      expect(agents).toContain('<!-- kovo-rules-version: 9.8.7 -->');
      expect(agents).toContain('# fetched kovo-rules.md');
      expect(agents).not.toContain('# stale');

      expect(readFileSync(join(root, '.kovo/docs/llms.txt'), 'utf8')).toBe('# fetched llms.txt\n');
      expect(readFileSync(join(root, '.kovo/docs/guides/cli.md'), 'utf8')).toBe(
        '# fetched guides/cli.md\n',
      );
      const metadata = JSON.parse(readFileSync(join(root, '.kovo/docs/metadata.json'), 'utf8')) as {
        source?: string;
        version?: string;
      };
      expect(metadata).toMatchObject({ source: 'fetched', version: '9.8.7' });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('falls back to bundled docs when fetching fails and inserts AGENTS.md markers if missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-update-docs-fallback-'));

    try {
      writeFileSync(join(root, 'AGENTS.md'), '# App Agents\n\nLocal instructions.\n');

      const result = await runUpdateDocsCommand({
        cwd: root,
        fetchImpl: async () => new Response('missing', { status: 404 }),
        version: '1.0.0',
      });

      expect(result).toEqual({
        exitCode: 0,
        output:
          'kovo-update-docs/v1\nOK source=bundled files=14\nWARN fetch failed; used bundled docs snapshot\n',
      });

      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('Local instructions.');
      expect(agents).toContain('<!-- BEGIN:kovo-rules -->');
      expect(agents).toContain('`kovo check`');
      expect(agents).toContain('- Spec: `./.kovo/docs/spec.md`');
      expect(readFileSync(join(root, '.kovo/docs/kovo-rules.md'), 'utf8')).toContain('## Commands');
      expect(existsSync(join(root, '.kovo/docs/reference/diagnostics.md'))).toBe(true);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reports malformed AGENTS.md markers without writing docs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-update-docs-error-'));

    try {
      writeFileSync(join(root, 'AGENTS.md'), '<!-- BEGIN:kovo-rules -->\n');

      const result = await runUpdateDocsCommand({
        cwd: root,
        fetchImpl: async () => new Response('# ok\n', { status: 200 }),
        version: '1.0.0',
      });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Expected exactly one');
      expect(existsSync(join(root, '.kovo/docs/llms.txt'))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

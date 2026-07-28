import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAgentDocsSnapshot } from '../../../../scripts/agent-docs-snapshot.mjs';
import { decodeInstalledAgentDocsSnapshot } from '../docs-snapshot.js';
import { installAgentDocsSnapshot } from '../docs-store.js';
import { runDocsCommand } from './docs.js';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo docs', () => {
  it('renders human and JSON results from the same authenticated snapshot facts', async () => {
    const root = fixtureRoot();
    const snapshot = fixtureSnapshot(root);
    await installAgentDocsSnapshot({ cwd: root, snapshot });

    const human = await runDocsCommand({
      cwd: root,
      task: 'quickstart route',
      version: '1.2.3',
    });
    const json = await runDocsCommand({
      cwd: root,
      format: 'json',
      task: 'quickstart route',
      version: '1.2.3',
    });

    expect(human.exitCode).toBe(0);
    expect(human.output).toContain('kovo-docs/v1');
    expect(human.output).toContain('## guides/quickstart.md');
    expect(human.output).toContain(snapshot.snapshotDigest);
    expect(json.exitCode).toBe(0);
    const record = JSON.parse(json.output) as {
      results: Array<{ path: string; snapshotDigest: string; version: string }>;
      schema: string;
    };
    expect(record.schema).toBe('kovo-docs/v1');
    expect(record.results[0]).toMatchObject({
      path: 'guides/quickstart.md',
      snapshotDigest: snapshot.snapshotDigest,
      version: '1.2.3',
    });
  });

  it('reports missing, stale, and invalid requests as usage/config failures', async () => {
    const root = fixtureRoot();
    const missing = await runDocsCommand({
      cwd: root,
      task: 'quickstart',
      version: '1.2.3',
    });
    expect(missing.exitCode).toBe(2);
    expect(missing.output).toContain('run `kovo update-docs`');

    await installAgentDocsSnapshot({ cwd: root, snapshot: fixtureSnapshot(root) });
    const stale = await runDocsCommand({
      cwd: root,
      format: 'json',
      task: 'quickstart',
      version: '9.9.9',
    });
    expect(stale.exitCode).toBe(2);
    expect(JSON.parse(stale.output)).toMatchObject({
      error: { message: expect.stringContaining('does not match CLI') },
      schema: 'kovo-docs/v1',
    });

    const invalid = await runDocsCommand({
      cwd: root,
      limit: 9,
      task: 'quickstart',
      version: '1.2.3',
    });
    expect(invalid.exitCode).toBe(2);
    expect(invalid.output).toContain('result limit');
  });
});

function fixtureSnapshot(root: string) {
  return decodeInstalledAgentDocsSnapshot(
    buildAgentDocsSnapshot({
      root,
      sourceCommit: SOURCE_COMMIT,
      version: '1.2.3',
    }).compressed,
    { expectedVersion: '1.2.3' },
  );
}

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kovo-cli-docs-command-'));
  roots.push(root);
  write(root, 'SPEC.md', '# Kovo fixture spec\n');
  write(root, 'spec/01-overview.md', '# Overview\n');
  write(
    root,
    'site/content/guides/quickstart.md',
    '# Quickstart\n\nBuild the first page with a route.\n',
  );
  write(root, 'site/gen/api/core.md', '# Core API\n\nUse `route()`.\n');
  write(
    root,
    'public-packages.json',
    `${JSON.stringify({
      packages: [
        {
          apiBoundary: { generated: [], internal: [], public: ['.'] },
          dir: 'core',
          kind: 'library',
          name: '@kovojs/core',
          visibility: 'public',
        },
      ],
    })}\n`,
  );
  write(
    root,
    'packages/core/package.json',
    `${JSON.stringify({
      exports: { '.': './src/index.ts' },
      name: '@kovojs/core',
      version: '1.2.3',
    })}\n`,
  );
  write(
    root,
    'packages/cli/package.json',
    `${JSON.stringify({ name: '@kovojs/cli', version: '1.2.3' })}\n`,
  );
  return root;
}

function write(root: string, relativePath: string, source: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}

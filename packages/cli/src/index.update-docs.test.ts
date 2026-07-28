import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAgentDocsSnapshot } from '../../../scripts/agent-docs-snapshot.mjs';
import {
  decodeInstalledAgentDocsSnapshot,
  type InstalledAgentDocsSnapshot,
} from './docs-snapshot.js';
import { runUpdateDocsCommand } from './index.js';

const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];
const snapshotState = vi.hoisted(() => ({
  error: undefined as unknown,
  snapshot: undefined as unknown,
}));

vi.mock('./docs-snapshot.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./docs-snapshot.js')>();
  return {
    ...actual,
    readInstalledAgentDocsSnapshot({ expectedVersion }: { expectedVersion: string }) {
      if (snapshotState.error !== undefined) throw snapshotState.error;
      const snapshot = snapshotState.snapshot as InstalledAgentDocsSnapshot | undefined;
      if (snapshot === undefined) throw new Error('test snapshot was not configured');
      if (snapshot.version !== expectedVersion) {
        throw new TypeError(
          `agent docs snapshot version ${JSON.stringify(snapshot.version)} does not match installed CLI ${JSON.stringify(expectedVersion)}`,
        );
      }
      return snapshot;
    },
  };
});

afterEach(() => {
  snapshotState.error = undefined;
  snapshotState.snapshot = undefined;
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('kovo update-docs', () => {
  it('authenticates and selects only the installed package snapshot without a live fetch', async () => {
    const root = temporaryRoot('install');
    const snapshot = useFixtureSnapshot('9.8.7');
    writeFileSync(
      path.join(root, 'AGENTS.md'),
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
    const fetchSpy = vi.fn(async () => {
      throw new Error('mutable network docs must not be fetched');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runUpdateDocsCommand({ cwd: root, version: '9.8.7' });

    expect(result).toEqual({
      exitCode: 0,
      output: [
        'kovo-update-docs/v1',
        `OK source=installed-package version=9.8.7 files=${snapshot.files.length}`,
        `OK snapshot=${snapshot.snapshotDigest} current=.kovo/docs/current.json`,
        '',
      ].join('\n'),
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    const digest = snapshot.snapshotDigest.slice('sha256:'.length);
    const directory = path.join(root, '.kovo/docs/snapshots', digest);
    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Before.');
    expect(agents).toContain('After.');
    expect(agents).toContain('<!-- kovo-rules-version: 9.8.7 -->');
    expect(agents).toContain(
      `<!-- kovo-rules-source: ./.kovo/docs/snapshots/${digest}/kovo-rules.md -->`,
    );
    expect(agents).toContain('# Kovo Docs');
    expect(agents).not.toContain('# stale');
    expect(readFileSync(path.join(directory, 'llms.txt'), 'utf8')).toContain('Version: 9.8.7');
    expect(readFileSync(path.join(directory, 'guides/quickstart.md'), 'utf8')).toContain(
      'Build the first page',
    );
    expect(
      JSON.parse(readFileSync(path.join(root, '.kovo/docs/current.json'), 'utf8')),
    ).toMatchObject({
      snapshotDigest: snapshot.snapshotDigest,
      version: '9.8.7',
    });
  });

  it('inserts AGENTS.md markers from the authenticated rules file when missing', async () => {
    const root = temporaryRoot('fallback');
    const snapshot = useFixtureSnapshot('1.0.0');
    writeFileSync(path.join(root, 'AGENTS.md'), '# App Agents\n\nLocal instructions.\n');

    const result = await runUpdateDocsCommand({ cwd: root, version: '1.0.0' });

    expect(result.exitCode).toBe(0);
    const digest = snapshot.snapshotDigest.slice('sha256:'.length);
    const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('Local instructions.');
    expect(agents).toContain('<!-- BEGIN:kovo-rules -->');
    expect(agents).toContain('`kovo check`');
    expect(agents).toContain('`kovo docs <task>`');
    expect(
      readFileSync(path.join(root, '.kovo/docs/snapshots', digest, 'kovo-rules.md'), 'utf8'),
    ).toContain('## Commands');
  });

  it('rejects malformed AGENTS.md markers before staging or selecting docs', async () => {
    const root = temporaryRoot('markers');
    useFixtureSnapshot('1.0.0');
    writeFileSync(path.join(root, 'AGENTS.md'), '<!-- BEGIN:kovo-rules -->\n');

    const result = await runUpdateDocsCommand({ cwd: root, version: '1.0.0' });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Expected exactly one');
    expect(existsSync(path.join(root, '.kovo/docs'))).toBe(false);
  });

  it('rejects an oversized AGENTS.md before allocating or staging the snapshot', async () => {
    const root = temporaryRoot('oversized-agents');
    useFixtureSnapshot('1.0.0');
    writeFileSync(path.join(root, 'AGENTS.md'), 'x'.repeat(1024 * 1024 + 1));

    const result = await runUpdateDocsCommand({ cwd: root, version: '1.0.0' });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('exceeds its byte limit');
    expect(existsSync(path.join(root, '.kovo/docs'))).toBe(false);
  });

  it('does not select or write a snapshot through project output symlinks', async () => {
    const root = temporaryRoot('alias');
    const outside = temporaryRoot('outside');
    useFixtureSnapshot('1.0.0');
    const outsideAgents = path.join(outside, 'AGENTS.md');
    writeFileSync(outsideAgents, 'outside agents\n');
    symlinkSync(outsideAgents, path.join(root, 'AGENTS.md'));
    mkdirSync(path.join(root, '.kovo'));
    symlinkSync(outside, path.join(root, '.kovo/docs'), 'dir');

    const result = await runUpdateDocsCommand({ cwd: root, version: '1.0.0' });

    expect(result.exitCode).toBe(2);
    expect(readFileSync(outsideAgents, 'utf8')).toBe('outside agents\n');
    expect(existsSync(path.join(outside, 'current.json'))).toBe(false);
    expect(lstatSync(path.join(root, 'AGENTS.md')).isSymbolicLink()).toBe(true);
  });

  it('never reports success when the bundled snapshot decoder rejects the payload', async () => {
    const root = temporaryRoot('rejected');
    snapshotState.error = new TypeError(
      'guides/quickstart.md: placeholder content cannot enter a complete snapshot',
    );

    const result = await runUpdateDocsCommand({ cwd: root, version: '1.0.0' });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('placeholder content cannot enter');
    expect(existsSync(path.join(root, '.kovo/docs/current.json'))).toBe(false);
  });
});

function useFixtureSnapshot(version: string): InstalledAgentDocsSnapshot {
  const sourceRoot = docsSourceRoot(version);
  const snapshot = decodeInstalledAgentDocsSnapshot(
    buildAgentDocsSnapshot({
      root: sourceRoot,
      sourceCommit: SOURCE_COMMIT,
      version,
    }).compressed,
    { expectedVersion: version },
  );
  snapshotState.snapshot = snapshot;
  return snapshot;
}

function docsSourceRoot(version: string): string {
  const root = temporaryRoot('source');
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
      version,
    })}\n`,
  );
  write(root, 'packages/cli/package.json', `${JSON.stringify({ name: '@kovojs/cli', version })}\n`);
  return root;
}

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `kovo-update-docs-${label}-`));
  roots.push(root);
  return root;
}

function write(root: string, relativePath: string, source: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
}

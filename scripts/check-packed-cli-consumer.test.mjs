import { describe, expect, it } from 'vitest';

import {
  assertPackedCliDependencyClosure,
  assertPackedDocsJourney,
  assertPackedMcpLifecycle,
  productionDependencyNamesFromLockfile,
} from './check-packed-cli-consumer.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function lockfile(...packages) {
  return `lockfileVersion: '9.0'

snapshots:
${packages.map((name) => `  '${name}@1.0.0': {}`).join('\n')}
`;
}

describe('packed CLI consumer proof', () => {
  it('reads the finite production graph and rejects every removed SDK subtree family', () => {
    expect(productionDependencyNamesFromLockfile(lockfile('@kovojs/cli', 'esbuild'))).toEqual([
      '@kovojs/cli',
      'esbuild',
    ]);
    expect(() =>
      assertPackedCliDependencyClosure(
        lockfile(
          '@modelcontextprotocol/sdk',
          '@hono/node-server',
          'hono',
          'express',
          'body-parser',
          'ajv',
          'fast-uri',
        ),
      ),
    ).toThrow(
      '@hono/node-server, @modelcontextprotocol/sdk, ajv, body-parser, express, fast-uri, hono',
    );
  });

  it('accepts only the exact finite packed MCP lifecycle and tool vocabulary', () => {
    const initialize = {
      id: 1,
      jsonrpc: '2.0',
      result: { protocolVersion: '2025-11-25' },
    };
    const list = {
      id: 2,
      jsonrpc: '2.0',
      result: {
        tools: [
          { name: 'list_diagnostics' },
          { name: 'kovo_explain' },
          { name: 'compile_component' },
          { name: 'kovo_check' },
          { name: 'kovo_docs' },
        ],
      },
    };
    expect(() =>
      assertPackedMcpLifecycle(`${JSON.stringify(initialize)}\n${JSON.stringify(list)}\n`),
    ).not.toThrow();
    expect(() =>
      assertPackedMcpLifecycle(
        `${JSON.stringify(initialize)}\n${JSON.stringify({ ...list, result: { tools: [] } })}\n`,
      ),
    ).toThrow('tool vocabulary drifted');
  });

  it('accepts only authenticated bounded docs output tied to the selected packed snapshot', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-docs-proof-'));
    const digest = `sha256:${'a'.repeat(64)}`;
    try {
      mkdirSync(path.join(root, '.kovo', 'docs'), { recursive: true });
      writeFileSync(
        path.join(root, '.kovo', 'docs', 'current.json'),
        `${JSON.stringify({ snapshotDigest: digest })}\n`,
      );
      writeFileSync(
        path.join(root, 'AGENTS.md'),
        `source=./.kovo/docs/snapshots/${digest.slice('sha256:'.length)}/kovo-rules.md\n`,
      );
      const update = [
        'kovo-update-docs/v1',
        'OK source=installed-package version=0.2.0 files=77',
        `OK snapshot=${digest} current=.kovo/docs/current.json`,
        '',
      ].join('\n');
      const docs = `${JSON.stringify({
        results: [
          {
            excerpt: 'Create an app and run its first check.',
            path: 'guides/quickstart.md',
            sha256: `sha256:${'b'.repeat(64)}`,
            snapshotDigest: digest,
            version: '0.2.0',
          },
        ],
        version: 'kovo-docs/v1',
      })}\n`;

      expect(() => assertPackedDocsJourney(update, docs, root)).not.toThrow();
      expect(() =>
        assertPackedDocsJourney(
          update,
          docs.replace('Create an app', 'Bundled starter placeholder'),
          root,
        ),
      ).toThrow('malformed, unsafe, or placeholder');
      expect(() =>
        assertPackedDocsJourney(update, docs.replace(digest, `sha256:${'c'.repeat(64)}`), root),
      ).toThrow('does not match the selected snapshot');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

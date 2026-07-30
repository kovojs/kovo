import { describe, expect, it } from 'vitest';

import {
  assertPackedApiV1Result,
  assertPackedCliDependencyClosure,
  assertPackedComponentCatalogJourney,
  assertPackedCliProcessContract,
  assertPackedDocsJourney,
  assertPackedMcpLifecycle,
  assertPackedSemanticApiBoundary,
  PACKED_DEV_READY_HARNESS_TIMEOUT_MS,
  productionDependencyNamesFromLockfile,
  sourceImportsPackage,
} from './check-packed-cli-consumer.mjs';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function lockfile(...packages) {
  return `lockfileVersion: '9.0'

snapshots:
${packages.map((name) => `  '${name}@1.0.0': {}`).join('\n')}
`;
}

describe('packed CLI consumer proof', () => {
  it('keeps readiness observation grace separate from the cold-start performance target', () => {
    const budgets = JSON.parse(
      readFileSync(new URL('../devex-budgets.json', import.meta.url), 'utf8'),
    );
    expect(PACKED_DEV_READY_HARNESS_TIMEOUT_MS).toBe(60_000);
    expect(budgets.metrics['dev.ready.cold.durationMs'].provisionalTarget).toBe(15_000);
  });

  it('binds its authored app fixture to one literal receiver identity', () => {
    const source = readFileSync(
      new URL('./check-packed-cli-consumer.mjs', import.meta.url),
      'utf8',
    );
    expect(source).toContain("defineKovo({ appId: '00000000-0000-4000-8000-000000000001' })");
    expect(source).not.toContain('defineKovo({})');
  });

  it('requires the exact cumulative api-v1 protocol and file-count summary', () => {
    const result = {
      batch: 'api-v1',
      files: [
        { batches: ['style-opaque-handles'], path: 'style.ts', state: 'rewritten' },
        { path: 'current.ts', state: 'unchanged' },
      ],
      migrationBatches: [
        'core-task-topology-v1',
        'style-opaque-handles',
        'ui-headless-icons-v1',
        'browser-client-installer-v1',
        'browser-authoring-v1',
        'browser-inline-optimism-v1',
        'server-task-topology-v1',
        'test-harness-v2',
        'drizzle-typed-annotations-v1',
        'better-auth-generated-assembly-v1',
      ],
      schema: 'kovo-api-migration-result/v1',
      summary: { refused: 0, rewritten: 1, unchanged: 1 },
    };
    expect(() =>
      assertPackedApiV1Result(result, { refused: 0, rewritten: 1, unchanged: 1 }),
    ).not.toThrow();
    expect(() =>
      assertPackedApiV1Result(
        { ...result, migrationBatches: result.migrationBatches.slice(1) },
        { refused: 0, rewritten: 1, unchanged: 1 },
      ),
    ).toThrow('drifted from the checked cumulative protocol');
    expect(() =>
      assertPackedApiV1Result(
        { ...result, summary: { refused: 0, rewritten: 2, unchanged: 0 } },
        { refused: 0, rewritten: 1, unchanged: 1 },
      ),
    ).toThrow('drifted from the checked cumulative protocol');
  });

  it('enforces informational, usage/config, and finding process contracts', () => {
    const result = (status, stdout = '', stderr = '') => ({
      error: undefined,
      signal: null,
      status,
      stderr,
      stdout,
    });
    const rootHelp = 'Kovo 0.2.0\n\nUsage:\n  kovo <command> [options]\n';
    const observations = {
      buildHelp: result(
        0,
        'kovo build — Prove and build\n\nUsage:\n  kovo build <app-module>\n\nExit codes: 0 success/help/version; 1 proof or build findings; 2 usage/config error\n',
      ),
      compileConfig: result(2, '', 'kovo: missing registry facts\n'),
      config: result(2, '', 'kovo: missing schema\n'),
      finding: result(1, '', 'kovo: input file not found\n'),
      help: result(0, rootHelp),
      root: result(0, rootHelp),
      rootHelp: result(0, rootHelp),
      usage: result(2, '', 'kovo: unknown command\n'),
      version: result(0, 'kovo 0.2.0\n'),
    };

    expect(() => assertPackedCliProcessContract(observations)).not.toThrow();
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        rootHelp: result(1, '', rootHelp),
      }),
    ).toThrow('must exit 0 with stdout only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        config: result(1, '', 'kovo: missing schema\n'),
      }),
    ).toThrow('must exit 2 with stderr only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        compileConfig: result(1, '', 'kovo: missing registry facts\n'),
      }),
    ).toThrow('must exit 2 with stderr only');
    expect(() =>
      assertPackedCliProcessContract({
        ...observations,
        finding: result(0, 'OK\n', ''),
      }),
    ).toThrow('must exit 1 with stderr only');
  });

  it('requires the packed public semantic API to close its bootstrap boundary', () => {
    expect(() =>
      assertPackedSemanticApiBoundary('packed-semantic-api-boundary/v1 OK\n'),
    ).not.toThrow();
    expect(() => assertPackedSemanticApiBoundary('intercepted=true\n')).toThrow(
      'did not reject caller execution before lockdown',
    );
  });

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

  it('requires packed catalogs and copies the complete direct-subpath Card anatomy', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-catalog-proof-'));
    const uiRoot = path.join(root, 'node_modules', '@kovojs', 'ui');
    const iconsRoot = path.join(root, 'node_modules', '@kovojs', 'icons');
    const names = ['card', ...Array.from({ length: 43 }, (_, index) => `fixture-${index}`)];
    try {
      mkdirSync(uiRoot, { recursive: true });
      mkdirSync(iconsRoot, { recursive: true });
      writeFileSync(
        path.join(uiRoot, 'package.json'),
        `${JSON.stringify({ exports: { './card': './dist/card.mjs' } })}\n`,
      );
      writeFileSync(
        path.join(uiRoot, 'catalog.json'),
        `${JSON.stringify({
          schema: 'kovo-component-catalog/v1',
          entries: names.map((name) => ({ name })),
        })}\n`,
      );
      writeFileSync(
        path.join(uiRoot, 'registry.json'),
        `${JSON.stringify({ components: names.map((name) => ({ name })) })}\n`,
      );
      writeFileSync(
        path.join(iconsRoot, 'catalog.json'),
        `${JSON.stringify({
          schema: 'kovo-component-catalog/v1',
          entries: Array.from({ length: 1_737 }, (_, index) => ({ name: `icon-${index}` })),
        })}\n`,
      );

      expect(() =>
        assertPackedComponentCatalogJourney(root, {
          run(_command, args, cwd) {
            const outIndex = args.indexOf('--out');
            const outDir = args[outIndex + 1];
            mkdirSync(outDir, { recursive: true });
            for (const name of names) {
              writeFileSync(
                path.join(outDir, `${name}.tsx`),
                name === 'card'
                  ? [
                      'Card',
                      'CardHeader',
                      'CardTitle',
                      'CardDescription',
                      'CardContent',
                      'CardFooter',
                    ]
                      .map((symbol) => `export const ${symbol} = component({`)
                      .join('\n')
                  : 'export const Fixture = component({',
              );
            }
            expect(cwd).toBe(root);
            return { stdout: 'SUMMARY total=44\n' };
          },
        }),
      ).not.toThrow();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('distinguishes executable package imports from documentation examples', () => {
    expect(
      sourceImportsPackage(
        `/** @example import { Accordion } from '@kovojs/ui/accordion'; */\nexport const Accordion = {};\n`,
        '@kovojs/ui',
      ),
    ).toBe(false);
    expect(
      sourceImportsPackage(
        `import type { AccordionProps } from '@kovojs/ui/accordion';\nexport type Props = AccordionProps;\n`,
        '@kovojs/ui',
      ),
    ).toBe(true);
  });
});

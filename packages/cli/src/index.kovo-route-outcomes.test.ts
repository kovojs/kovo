import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  kovoCliTestTimeoutMs,
  KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
  KOVO_EXPLAIN_TEST_PROCESS_DEADLINE_MS,
  runBoundedKovoCli,
} from '../test/bounded-cli.js';

const repoRoot = process.cwd();
const ROUTE_OUTCOME_TEST_TIMEOUT_MS = kovoCliTestTimeoutMs(
  KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
  KOVO_EXPLAIN_TEST_PROCESS_DEADLINE_MS,
);

describe('kovo route outcome graph facts', () => {
  it(
    'serializes response and rooted-file route outcomes into endpoint explain output',
    async () => {
      const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-route-outcomes-'));
      const appPath = join(root, 'src/app.mjs');
      const docsRoot = join(root, 'docs');
      const outDir = join(root, 'dist');

      try {
        mkdirSync(join(root, 'src'), { recursive: true });
        mkdirSync(docsRoot, { recursive: true });
        mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
        symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
        symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
        writeFileSync(join(docsRoot, 'readme.txt'), 'hello from rooted files\n', 'utf8');
        writeFileSync(
          join(root, 'index.html'),
          '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
          'utf8',
        );
        writeFileSync(
          join(root, 'src/client.ts'),
          'export function Client(){ return null; }\n',
          'utf8',
        );
        writeFileSync(
          join(root, 'kovo.config.ts'),
          `import { defineConfig, node } from '@kovojs/server/build';
export default defineConfig({ preset: node({ retention: {
  hours: 24,
  immutableClientModules: 'retained',
  priorTokenQueryReads: 'retained',
} }) });
`,
          'utf8',
        );
        writeFileSync(
          appPath,
          `
import { defineKovo, respond as response } from '@kovojs/server';
import { rootedFiles as openRootedFiles } from '@kovojs/server/files';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });
const docs = await openRootedFiles(${JSON.stringify(docsRoot)});
const downloadRoute = app.route('/download/report.txt', {
  access: app.publicAccess('public report download'),
  page: () => response.file('report', {
    contentType: 'text/plain; charset=utf-8',
    filename: 'report.txt',
  }),
});
const streamRoute = app.route('/stream/events.ndjson', {
  access: app.publicAccess('public event stream'),
  page: () => response.stream('event: ready\\n\\n', {
    contentType: 'application/x-ndjson',
  }),
});
const docsRoute = app.route('/docs/readme.txt', {
  access: app.publicAccess('public rooted docs download'),
  page: () =>
    docs.serve('readme.txt', {
      contentType: 'text/plain; charset=utf-8',
      filename: 'readme.txt',
    }),
});

export default app.assemble({ routes: [downloadRoute, streamRoute, docsRoute] });
`,
          'utf8',
        );

        const build = await runBoundedKovoCli({
          args: ['build', appPath, '--out', outDir],
          cwd: root,
          deadlineMs: KOVO_BUILD_TEST_PROCESS_DEADLINE_MS,
        });
        expect(build.exitCode, build.stderr).toBe(0);
        const graphPath = join(outDir, '.kovo/graph.json');
        const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as {
          endpoints?: { path?: string; surface?: string }[];
        };
        expect(graph.endpoints).toContainEqual(
          expect.objectContaining({ path: '/download/report.txt', surface: 'route-file' }),
        );
        expect(graph.endpoints).toContainEqual(
          expect.objectContaining({ path: '/stream/events.ndjson', surface: 'route-stream' }),
        );
        expect(graph.endpoints).toContainEqual(
          expect.objectContaining({ path: '/docs/readme.txt', surface: 'route-stream' }),
        );

        const explain = await runBoundedKovoCli({
          args: ['explain', 'endpoints', '--artifact', graphPath],
          cwd: root,
          deadlineMs: KOVO_EXPLAIN_TEST_PROCESS_DEADLINE_MS,
        });
        expect(explain.exitCode, explain.stderr).toBe(0);
        expect(explain.stdout).toContain(
          'ENDPOINT /download/report.txt surface=route-file method=GET path=/download/report.txt',
        );
        expect(explain.stdout).toContain(
          'ENDPOINT /stream/events.ndjson surface=route-stream method=GET path=/stream/events.ndjson',
        );
        expect(explain.stdout).toContain(
          'ENDPOINT /docs/readme.txt surface=route-stream method=GET path=/docs/readme.txt',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    ROUTE_OUTCOME_TEST_TIMEOUT_MS,
  );
});

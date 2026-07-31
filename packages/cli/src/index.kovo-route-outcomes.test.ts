import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { main, mainAsync } from './index.js';

const repoRoot = process.cwd();

describe('kovo route outcome graph facts', () => {
  it('serializes route respond.file/respond.stream facts into endpoint explain output', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-route-outcomes-'));
    const appPath = join(root, 'src/app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
      symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
      symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
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

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });
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

export default app.assemble({ routes: [downloadRoute, streamRoute] });
`,
        'utf8',
      );

      const previousCwd = process.cwd();
      process.chdir(root);
      const exitCode = await mainAsync(['build', appPath, '--out', outDir]).finally(() => {
        process.chdir(previousCwd);
      });
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
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

      stdout.mockClear();
      expect(
        main(['explain', 'endpoints', '--artifact', graphPath]),
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
      ).toBe(0);
      const explainOutput = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(explainOutput).toContain(
        'ENDPOINT /download/report.txt surface=route-file method=GET path=/download/report.txt',
      );
      expect(explainOutput).toContain(
        'ENDPOINT /stream/events.ndjson surface=route-stream method=GET path=/stream/events.ndjson',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('serializes rootedFiles().serve route outcomes into endpoint explain output', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-rooted-route-outcomes-'));
    const appPath = join(root, 'src/app.mjs');
    const docsRoot = join(root, 'docs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

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
import { defineKovo } from '@kovojs/server';
import { rootedFiles as openRootedFiles } from '@kovojs/server/files';

const app = defineKovo({ appId: '00000000-0000-4000-8000-000000000001' });
const docs = await openRootedFiles(${JSON.stringify(docsRoot)});
const docsRoute = app.route('/docs/readme.txt', {
  access: app.publicAccess('public rooted docs download'),
  page: () =>
    docs.serve('readme.txt', {
      contentType: 'text/plain; charset=utf-8',
      filename: 'readme.txt',
    }),
});

export default app.assemble({ routes: [docsRoute] });
`,
        'utf8',
      );

      const previousCwd = process.cwd();
      process.chdir(root);
      const exitCode = await mainAsync(['build', appPath, '--out', outDir]).finally(() => {
        process.chdir(previousCwd);
      });
      const errorOutput = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(exitCode, errorOutput).toBe(0);
      const graphPath = join(outDir, '.kovo/graph.json');
      const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as {
        endpoints?: { path?: string; surface?: string }[];
      };
      expect(graph.endpoints).toContainEqual(
        expect.objectContaining({ path: '/docs/readme.txt', surface: 'route-stream' }),
      );

      stdout.mockClear();
      expect(
        main(['explain', 'endpoints', '--artifact', graphPath]),
        stderr.mock.calls.map(([chunk]) => String(chunk)).join(''),
      ).toBe(0);
      const explainOutput = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(explainOutput).toContain(
        'ENDPOINT /docs/readme.txt surface=route-stream method=GET path=/docs/readme.txt',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

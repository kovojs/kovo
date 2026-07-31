import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
// Each build takes about 16s alone but crossed Vitest's 30s default on a saturated CI shard.
// Three times that hosted ceiling leaves measured headroom without masking a multi-minute regression.
// The outer timeout includes both child deadlines plus 10s for process-tree cleanup.
const BUILD_DEADLINE_MS = 90_000;
const EXPLAIN_DEADLINE_MS = 30_000;
const MAX_CAPTURED_OUTPUT_CHARACTERS = 16 * 1024 * 1024;
const ROUTE_OUTCOME_TEST_TIMEOUT_MS = BUILD_DEADLINE_MS + EXPLAIN_DEADLINE_MS + 10_000;

interface CliResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

async function runCli(
  root: string,
  args: readonly string[],
  deadlineMs: number,
): Promise<CliResult> {
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      join(repoRoot, 'packages/cli/src/bin.ts'),
      ...args,
    ],
    {
      cwd: root,
      detached: process.platform !== 'win32',
      env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1' },
    },
  );
  let stderr = '';
  let stdout = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = appendCliOutput(stderr, chunk);
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout = appendCliOutput(stdout, chunk);
  });

  return await new Promise<CliResult>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killChildProcessGroup(child);
    }, deadlineMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `Kovo CLI exceeded its ${deadlineMs}ms deadline and was terminated.\n${stderr}`,
          ),
        );
        return;
      }
      if (exitCode === null) {
        reject(new Error(`Kovo CLI exited via signal ${String(signal)}.\n${stderr}`));
        return;
      }
      resolve({ exitCode, stderr, stdout });
    });
  });
}

function appendCliOutput(output: string, chunk: string): string {
  return output.length >= MAX_CAPTURED_OUTPUT_CHARACTERS
    ? output
    : output + chunk.slice(0, MAX_CAPTURED_OUTPUT_CHARACTERS - output.length);
}

function killChildProcessGroup(child: ChildProcessWithoutNullStreams): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // The process may have exited between the deadline firing and the kill.
    }
  }
  child.kill('SIGKILL');
}

describe('kovo route outcome graph facts', () => {
  it(
    'serializes route respond.file/respond.stream facts into endpoint explain output',
    async () => {
      const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-route-outcomes-'));
      const appPath = join(root, 'src/app.mjs');
      const outDir = join(root, 'dist');

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

        const build = await runCli(root, ['build', appPath, '--out', outDir], BUILD_DEADLINE_MS);
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

        const explain = await runCli(
          root,
          ['explain', 'endpoints', '--artifact', graphPath],
          EXPLAIN_DEADLINE_MS,
        );
        expect(explain.exitCode, explain.stderr).toBe(0);
        expect(explain.stdout).toContain(
          'ENDPOINT /download/report.txt surface=route-file method=GET path=/download/report.txt',
        );
        expect(explain.stdout).toContain(
          'ENDPOINT /stream/events.ndjson surface=route-stream method=GET path=/stream/events.ndjson',
        );
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    ROUTE_OUTCOME_TEST_TIMEOUT_MS,
  );

  it(
    'serializes rootedFiles().serve route outcomes into endpoint explain output',
    async () => {
      const root = mkdtempSync(join(repoRoot, '.tmp-kovo-build-rooted-route-outcomes-'));
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

        const build = await runCli(root, ['build', appPath, '--out', outDir], BUILD_DEADLINE_MS);
        expect(build.exitCode, build.stderr).toBe(0);
        const graphPath = join(outDir, '.kovo/graph.json');
        const graph = JSON.parse(readFileSync(graphPath, 'utf8')) as {
          endpoints?: { path?: string; surface?: string }[];
        };
        expect(graph.endpoints).toContainEqual(
          expect.objectContaining({ path: '/docs/readme.txt', surface: 'route-stream' }),
        );

        const explain = await runCli(
          root,
          ['explain', 'endpoints', '--artifact', graphPath],
          EXPLAIN_DEADLINE_MS,
        );
        expect(explain.exitCode, explain.stderr).toBe(0);
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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { main } from './index.js';

const repoRoot = process.cwd();

describe('kovo check current-source proof', () => {
  it('rejects a focused graph family when no graph exists instead of returning vacuous OK', () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-required-check-graph-'));
    let stderr = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write);

    try {
      const exitCode = main(['check', 'coverage'], {
        invocationCwd: root,
        invocationEnv: {},
        paranoidStaticAdvisory: false,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain(
        'kovo: check coverage requires a graph input; pass graph.json or run bare kovo check to derive current source proof.',
      );
      expect(stderr).not.toContain('\nOK\n');
    } finally {
      stderrWrite.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('publishes an exact census of every source-check phase against the requested source', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-source-check-census-'));
    const source = sourceCheckCensusApp();

    try {
      writeSourceCheckFixture(root, source);
      rmSync(join(root, 'tsconfig.json'));
      const result = await runCli(root, ['check', '--no-cache'], {
        KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: 'src/app.tsx',
      });

      expect(result.exitCode, result.stderr).toBe(0);
      const census = sourceCheckPhaseCensus(result.stdout);
      const expectedPhases = [
        { name: 'lifecycle-policy', status: 'not-applicable' },
        { name: 'config-trust', status: 'executed' },
        { name: 'typescript', status: 'not-applicable' },
        { name: 'project-quality', status: 'not-applicable' },
        { name: 'sound-subset', status: 'not-applicable' },
        { name: 'session-authority', status: 'executed' },
        { name: 'app-source-trust', status: 'executed' },
        { name: 'app-evaluation', status: 'executed' },
        { name: 'stylesheet', status: 'executed' },
        { name: 'build-check-graph', status: 'executed' },
        { name: 'graph-diagnostics', status: 'executed' },
      ] as const;
      expect(census).toMatchObject({
        checkGraphDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        schema: 'kovo-check-phase-census/v1',
        source: {
          codeUnitLength: source.length,
          contentHash: sourceDigest(source),
          encoding: 'utf16le',
          path: 'src/app.tsx',
        },
      });
      expect(census.phases.map(({ name, status }) => ({ name, status }))).toEqual(expectedPhases);
      for (const [index, phase] of census.phases.entries()) {
        expect(phase.durationMs, phase.name).toBeGreaterThanOrEqual(0);
        if (expectedPhases[index]!.status === 'not-applicable') {
          expect(phase.durationMs, phase.name).toBe(0);
        }
      }

      const revisedSource = sourceCheckCensusApp('revised source-check phase census fixture');
      writeFileSync(appPath(root), revisedSource, 'utf8');
      const revisedResult = await runCli(root, ['check', '--no-cache'], {
        KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: 'src/app.tsx',
      });
      expect(revisedResult.exitCode, revisedResult.stderr).toBe(0);
      const revisedCensus = sourceCheckPhaseCensus(revisedResult.stdout);
      expect(revisedCensus.source.contentHash).toBe(sourceDigest(revisedSource));
      expect(revisedCensus.checkGraphDigest).not.toBe(census.checkGraphDigest);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);

  it('re-derives warm source proof, catches type/compiler changes, and leaves KV417 to build', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-source-check-'));
    const appPath = join(root, 'src/app.tsx');

    try {
      writeSourceCheckFixture(root, sourceCheckApp());

      const first = await runCli(root, ['check', '--no-cache']);
      expect(first.exitCode, first.stderr).toBe(0);
      expect(first.stdout).toMatch(/^kovo-check\/v1\n/u);
      expect(first.stdout).not.toContain('\nERROR ');
      expect(existsSync(join(root, 'dist'))).toBe(false);

      writeFileSync(
        appPath,
        sourceCheckApp().replace("const proof: string = 'ok';", 'const proof: string = 1;'),
      );
      const typeFailure = await runCli(root, ['check']);
      expect(typeFailure.exitCode).toBe(1);
      expect(typeFailure.stderr).toContain(
        'kovo-check/v1\nERROR kovo check TypeScript preflight failed:',
      );
      expect(typeFailure.stderr).toContain("Type 'number' is not assignable to type 'string'");
      expect(existsSync(join(root, 'dist'))).toBe(false);

      writeFileSync(appPath, sourceCheckApp(false));
      const compilerFailure = await runCli(root, ['check', '--no-cache'], {
        KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: 'src/app.tsx',
      });
      expect(compilerFailure.exitCode, `${compilerFailure.stdout}\n${compilerFailure.stderr}`).toBe(
        1,
      );
      expect(compilerFailure.stderr).toContain('kovo-check/v1\nERROR KV436 QUERY ');
      expect(compilerFailure.stderr).toContain('Missing explicit access decision.');
      expect(sourceCheckPhaseCensus(compilerFailure.stderr).phases.at(-1)).toMatchObject({
        name: 'graph-diagnostics',
        status: 'executed',
      });
      expect(existsSync(join(root, 'dist'))).toBe(false);

      writeFileSync(appPath, sourceCheckApp());
      const buildFailure = await runCli(root, ['build', './src/app.tsx', '--out', './dist']);
      expect(buildFailure.exitCode).toBe(1);
      expect(buildFailure.stderr).toContain(
        'kovo-build/v1\nERROR kovo build preset inspection failed:',
      );
      expect(buildFailure.stderr).toContain('ERROR KV417');
      expect(buildFailure.stderr).toContain('SPEC §14 deploy-skew retention floor');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

async function runCli(
  root: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-transform-types',
      join(repoRoot, 'packages/cli/src/bin.ts'),
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

interface SourceCheckPhaseCensusEvidence {
  readonly checkGraphDigest: string;
  readonly phases: readonly {
    readonly durationMs: number;
    readonly name: string;
    readonly status: 'executed' | 'not-applicable';
  }[];
  readonly schema: 'kovo-check-phase-census/v1';
  readonly source: {
    readonly codeUnitLength: number;
    readonly contentHash: string;
    readonly encoding: 'utf16le';
    readonly path: string;
  };
}

function sourceCheckPhaseCensus(stdout: string): SourceCheckPhaseCensusEvidence {
  const line = stdout
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith('kovo-check-phase-census/v1 '));
  if (line === undefined) throw new Error('kovo check did not emit its requested phase census');
  return JSON.parse(
    line.slice('kovo-check-phase-census/v1 '.length),
  ) as SourceCheckPhaseCensusEvidence;
}

function sourceDigest(source: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(source, 'utf16le')).digest('hex')}`;
}

function writeSourceCheckFixture(root: string, appSource: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  writeFileSync(appPath(root), appSource, 'utf8');
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2024',
        types: ['node'],
      },
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    }),
    'utf8',
  );
  writeFileSync(
    join(root, 'kovo.config.ts'),
    [
      "import { defineConfig, node } from '@kovojs/server/build';",
      '',
      'export default defineConfig({ preset: node() });',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/client.ts"></script></body></html>',
    'utf8',
  );
  writeFileSync(join(root, 'src/client.ts'), 'export const client = true;\n', 'utf8');
}

function appPath(root: string): string {
  return join(root, 'src/app.tsx');
}

function sourceCheckApp(withAccess = true): string {
  return `
import { trustedHtml } from '@kovojs/browser';
import { defineKovo } from '@kovojs/server';

const proof: string = 'ok';
export const app = defineKovo({
  appId: '11111111-1111-4111-8111-111111111111',
});
${withAccess ? '' : '// @ts-expect-error -- compiler proof must independently reject missing access\\n'}
export const currentSourceQuery = app.query({
${withAccess ? "  access: { kind: 'public', reason: 'current-source proof fixture' },\n" : ''}
  load: () => ({ proof }),
});
const currentSourceRoute = app.route('/', {
  access: app.publicAccess('current-source route fixture'),
  page: () =>
    trustedHtml('<main>Current source</main>', {
      reason: 'current-source CLI fixture',
      source: 'src/app.tsx',
    }),
});

export default app.assemble({
  queries: [currentSourceQuery],
  routes: [currentSourceRoute],
});
`;
}

function sourceCheckCensusApp(reason = 'source-check phase census fixture'): string {
  return `
import { defineKovo } from '@kovojs/server';

export const app = defineKovo({
  appId: '22222222-2222-4222-8222-222222222222',
});
export const censusQuery = app.query({
  access: { kind: 'public', reason: ${JSON.stringify(reason)} },
  load: () => ({ ready: true }),
});

export default app.assemble({
  queries: [censusQuery],
  routes: [],
});
`;
}

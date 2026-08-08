import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

// plans/good-perf.md O17: the phase census used to be reachable only on the success path, so the
// instrument that diagnoses check cost was unavailable on exactly the apps that are slowest — the
// failing ones. A failing run now publishes an explicitly incomplete census under its own schema.
describe('kovo check phase census on a failing run', () => {
  it('publishes an incomplete census naming the in-flight phase when a phase throws', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-failing-check-census-'));

    try {
      writeFailingCheckFixture(root);
      const result = await runCli(root, ['check', '--no-cache'], {
        KOVO_DEVEX_CHECK_PHASE_CENSUS_SOURCE: 'src/app.tsx',
      });

      expect(result.exitCode, `${result.stdout}\n${result.stderr}`).toBe(1);
      expect(result.stderr).toContain('kovo-check/v1\nERROR kovo check TypeScript preflight failed');

      const census = incompleteCensus(result.stderr);
      // The failing census must be distinguishable from the authenticated success census by schema
      // alone: it carries no check-graph digest and no source content hash, because on this path
      // neither was ever derived.
      expect(census.schema).toBe('kovo-check-phase-census-incomplete/v1');
      expect(census.complete).toBe(false);
      expect(census.outcome).toBe('threw');
      expect(census).not.toHaveProperty('checkGraphDigest');
      expect(census.source).toEqual({ path: 'src/app.tsx' });
      expect(result.stderr).not.toContain('kovo-check-phase-census/v1 ');

      expect(census.failedPhase?.name).toBe('typescript');
      expect(census.failedPhase?.elapsedMs).toBeGreaterThan(0);
      expect(census.totalPhases).toBe(11);
      expect(census.recordedPhases).toBe(census.phases.length);
      expect(census.phases.map(({ name, status }) => ({ name, status }))).toEqual([
        { name: 'lifecycle-policy', status: 'not-applicable' },
        { name: 'config-trust', status: 'executed' },
      ]);
      for (const phase of census.phases) {
        expect(phase.durationMs, phase.name).toBeGreaterThanOrEqual(0);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);

  it('emits no census at all when the run did not request one', async () => {
    const root = mkdtempSync(join(repoRoot, '.tmp-kovo-failing-check-uncensused-'));

    try {
      writeFailingCheckFixture(root);
      const result = await runCli(root, ['check', '--no-cache']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain('kovo-check-phase-census');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 180_000);
});

interface IncompleteCensusEvidence {
  readonly complete: false;
  readonly failedPhase: { readonly elapsedMs: number; readonly name: string } | null;
  readonly outcome: 'refused' | 'threw';
  readonly phases: readonly {
    readonly durationMs: number;
    readonly name: string;
    readonly status: 'executed' | 'not-applicable';
  }[];
  readonly recordedPhases: number;
  readonly schema: string;
  readonly source: { readonly path: string };
  readonly totalPhases: number;
}

function incompleteCensus(output: string): IncompleteCensusEvidence {
  const prefix = 'kovo-check-phase-census-incomplete/v1 ';
  const line = output.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    throw new Error(`kovo check did not emit an incomplete phase census:\n${output}`);
  }
  return JSON.parse(line.slice(prefix.length)) as IncompleteCensusEvidence;
}

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
  return { exitCode: result.status ?? 1, stderr: result.stderr, stdout: result.stdout };
}

function writeFailingCheckFixture(root: string): void {
  mkdirSync(join(root, 'node_modules/@kovojs'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages/browser'), join(root, 'node_modules/@kovojs/browser'));
  symlinkSync(join(repoRoot, 'packages/server'), join(root, 'node_modules/@kovojs/server'));
  writeFileSync(
    join(root, 'src/app.tsx'),
    `
import { defineKovo } from '@kovojs/server';

// The TypeScript preflight throws here, so the run never reaches graph-diagnostics.
const proof: string = 1;
export const app = defineKovo({
  appId: '33333333-3333-4333-8333-333333333333',
});
export const censusQuery = app.query({
  access: { kind: 'public', reason: 'failing source-check phase census fixture' },
  load: () => ({ proof }),
});

export default app.assemble({
  queries: [censusQuery],
  routes: [],
});
`,
    'utf8',
  );
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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  planKovoSourceCheckSessionReuse,
  revalidateKovoCheckTypeScriptPreflight,
} from './check-session-reuse.js';
import {
  KOVO_SOURCE_CHECK_PHASES,
  type KovoSourceCheckSessionContinuity,
  type KovoSourceCheckWatchSnapshot,
} from './source-check-session.js';

const roots: string[] = [];
const repoRoot = process.cwd();
const digestOf = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function snapshot(
  entries: readonly (readonly [string, string])[],
  symlinks: readonly string[] = [],
): KovoSourceCheckWatchSnapshot {
  return Object.freeze({
    digest: digestOf('f'),
    fileDigests: new Map(entries),
    files: entries.length,
    symlinks: Object.freeze([...symlinks]),
  });
}

function continuity(
  overrides: Partial<{
    closureSourceText: string;
    exitCode: 0 | 1 | 2;
    files: readonly (readonly [string, string])[];
    lifecycleExecuted: boolean;
    symlinks: readonly string[];
  }> = {},
): KovoSourceCheckSessionContinuity {
  const files = overrides.files ?? [
    ['NOTES.md', digestOf('a')],
    ['src/app.tsx', digestOf('b')],
  ];
  const notApplicable = new Set(overrides.lifecycleExecuted ? [3, 4] : [0, 3, 4]);
  return Object.freeze({
    census: Object.freeze({
      checkGraphDigest: digestOf('c'),
      phases: Object.freeze(
        KOVO_SOURCE_CHECK_PHASES.map((name, index) =>
          Object.freeze({
            durationMs: 0,
            inputDigest: digestOf('d'),
            name,
            status: notApplicable.has(index) ? ('not-applicable' as const) : ('executed' as const),
          }),
        ),
      ),
      schema: 'kovo-check-phase-census/v2' as const,
    }),
    closureSources: Object.freeze([
      Object.freeze({
        fileName: 'src/app.tsx',
        source: overrides.closureSourceText ?? 'export const app = 1;\n',
      }),
    ]),
    graphDigest: digestOf('c'),
    identity: Object.freeze({
      appModulePath: 'src/app.tsx',
      compilerProvenanceDigest: digestOf('e'),
      configSourceDigest: null,
      invocationRoot: '/tmp/project',
      optionsDigest: digestOf('1'),
      sourceSetDigest: digestOf('2'),
    }),
    input: Object.freeze({
      closure: Object.freeze([
        Object.freeze({ bytes: 21, digest: digestOf('b'), path: 'src/app.tsx' }),
      ]),
      closureDigest: digestOf('3'),
      configClosureDigest: null,
      entry: Object.freeze({ bytes: 21, digest: digestOf('b'), path: 'src/app.tsx' }),
      projectDigest: digestOf('4'),
      schema: 'kovo-check-input-proof/v1' as const,
      status: 'accepted' as const,
    }),
    result: Object.freeze({ exitCode: overrides.exitCode ?? (0 as const), output: 'OK\n' }),
    trigger: snapshot(files, overrides.symlinks ?? []),
  });
}

describe('source-check session reuse planning', () => {
  it('accepts a modified documentation file outside the closure', () => {
    const plan = planKovoSourceCheckSessionReuse(
      continuity(),
      snapshot([
        ['NOTES.md', digestOf('9')],
        ['src/app.tsx', digestOf('b')],
      ]),
    );
    expect(plan).toEqual({ changedPaths: ['NOTES.md'], eligible: true });
  });

  it('refuses without a previous accepted revision or per-file digests', () => {
    expect(planKovoSourceCheckSessionReuse(undefined, snapshot([]))).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('no accepted previous revision'),
    });
    const digestless = Object.freeze({
      digest: digestOf('f'),
      files: 0,
      symlinks: Object.freeze([]),
    });
    expect(planKovoSourceCheckSessionReuse(continuity(), digestless)).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('per-file digest evidence'),
    });
  });

  it('refuses when files are added, removed, or symlinked', () => {
    expect(
      planKovoSourceCheckSessionReuse(
        continuity(),
        snapshot([
          ['NOTES.md', digestOf('a')],
          ['helper.md', digestOf('7')],
          ['src/app.tsx', digestOf('b')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('added or removed') });
    expect(
      planKovoSourceCheckSessionReuse(continuity(), snapshot([['src/app.tsx', digestOf('b')]])),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('added or removed') });
    expect(
      planKovoSourceCheckSessionReuse(
        continuity(),
        snapshot(
          [
            ['NOTES.md', digestOf('9')],
            ['src/app.tsx', digestOf('b')],
          ],
          ['link.md'],
        ),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('symlinks') });
  });

  it('refuses closure edits and every non-documentation shape', () => {
    // In-closure change: the exact case the full pipeline must own.
    expect(
      planKovoSourceCheckSessionReuse(
        continuity(),
        snapshot([
          ['NOTES.md', digestOf('a')],
          ['src/app.tsx', digestOf('9')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('closure input changed') });
    // Config, manifest, env, html, css, json, and source shapes all refuse.
    for (const name of [
      'package.json',
      'tsconfig.json',
      'kovo.config.ts',
      'vite.config.ts',
      'index.html',
      '.env',
      'styles.css',
      'data.json',
      'src/extra.ts',
      'pnpm-lock.yaml',
    ]) {
      const files: (readonly [string, string])[] = [
        ['NOTES.md', digestOf('a')],
        ['src/app.tsx', digestOf('b')],
        [name, digestOf('a')],
      ];
      const previous = continuity({ files });
      const changed: (readonly [string, string])[] = [
        ['NOTES.md', digestOf('a')],
        ['src/app.tsx', digestOf('b')],
        [name, digestOf('9')],
      ];
      expect(planKovoSourceCheckSessionReuse(previous, snapshot(changed)), name).toMatchObject({
        eligible: false,
        reason: expect.stringContaining('may be a check input'),
      });
    }
  });

  it('refuses when a closure source references the changed file or uses import.meta.glob', () => {
    const referencing = continuity({
      closureSourceText: "import notes from './NOTES.md?raw';\n",
    });
    expect(
      planKovoSourceCheckSessionReuse(
        referencing,
        snapshot([
          ['NOTES.md', digestOf('9')],
          ['src/app.tsx', digestOf('b')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('references changed file') });
    const globbing = continuity({
      closureSourceText: "const docs = import.meta.glob('./docs/*');\n",
    });
    expect(
      planKovoSourceCheckSessionReuse(
        globbing,
        snapshot([
          ['NOTES.md', digestOf('9')],
          ['src/app.tsx', digestOf('b')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('import.meta.glob') });
  });

  it('refuses strict-lifecycle projects and incomplete previous revisions', () => {
    expect(
      planKovoSourceCheckSessionReuse(
        continuity({ lifecycleExecuted: true }),
        snapshot([
          ['NOTES.md', digestOf('9')],
          ['src/app.tsx', digestOf('b')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('strict lifecycle') });
    expect(
      planKovoSourceCheckSessionReuse(
        continuity({ exitCode: 2 }),
        snapshot([
          ['NOTES.md', digestOf('9')],
          ['src/app.tsx', digestOf('b')],
        ]),
      ),
    ).toMatchObject({ eligible: false, reason: expect.stringContaining('did not complete') });
  });
});

describe('source-check typescript revalidation', () => {
  it('reports not-applicable without a tsconfig and re-executes tsc against a real project', async () => {
    const root = fixtureProject();
    expect(
      await revalidateKovoCheckTypeScriptPreflight(join(root, 'src/app.ts'), root, process.env),
    ).toEqual({ durationMs: 0, executed: false });

    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          strict: true,
          target: 'es2022',
        },
        include: ['src'],
      }),
      'utf8',
    );
    const passed = await revalidateKovoCheckTypeScriptPreflight(
      join(root, 'src/app.ts'),
      root,
      process.env,
    );
    expect(passed).toMatchObject({ executed: true });
    expect(passed!.durationMs).toBeGreaterThan(0);
    // The same SPEC §10.6-confined incremental cache the producer maintains.
    expect(existsSync(join(root, '.kovo/cache/tsc-preflight.tsbuildinfo'))).toBe(true);

    writeFileSync(join(root, 'src/app.ts'), 'export const broken: number = "text";\n', 'utf8');
    expect(
      await revalidateKovoCheckTypeScriptPreflight(join(root, 'src/app.ts'), root, process.env),
    ).toBeUndefined();
  }, 120_000);
});

function fixtureProject(): string {
  const root = mkdtempSync(join(repoRoot, '.tmp-check-session-reuse-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules/typescript'), join(root, 'node_modules/typescript'));
  writeFileSync(join(root, 'src/app.ts'), 'export const value: number = 1;\n', 'utf8');
  return root;
}

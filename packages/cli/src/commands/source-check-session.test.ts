import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createKovoSourceCheckInputProof,
  formatKovoSourceCheckWatchRecord,
  KOVO_SOURCE_CHECK_PHASES,
  runKovoSourceCheckWatchSession,
  snapshotKovoSourceCheckProject,
  type KovoSourceCheckRevisionResult,
} from './source-check-session.js';

const roots: string[] = [];
const digest = `sha256:${'a'.repeat(64)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('foreground source-check session', () => {
  it('binds source, config, and closure bytes into deterministic exact digests', () => {
    const baseline = createKovoSourceCheckInputProof(
      'src/app.tsx',
      [
        { fileName: 'src/helper.ts', source: 'export const value = 1;\n' },
        { fileName: 'src/app.tsx', source: "import './helper.js';\n" },
      ],
      [{ fileName: 'kovo.config.ts', source: 'export default {};\n' }],
    );
    const reordered = createKovoSourceCheckInputProof(
      'src/app.tsx',
      [
        { fileName: 'src/app.tsx', source: "import './helper.js';\n" },
        { fileName: 'src/helper.ts', source: 'export const value = 1;\n' },
      ],
      [{ fileName: 'kovo.config.ts', source: 'export default {};\n' }],
    );
    expect(reordered).toEqual(baseline);
    expect(baseline).toMatchObject({
      closure: [{ path: 'kovo.config.ts' }, { path: 'src/app.tsx' }, { path: 'src/helper.ts' }],
      closureDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      configClosureDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      entry: {
        digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        path: 'src/app.tsx',
      },
      projectDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      schema: 'kovo-check-input-proof/v1',
    });

    const revised = createKovoSourceCheckInputProof(
      'src/app.tsx',
      [
        { fileName: 'src/app.tsx', source: "import './helper.js';\n" },
        { fileName: 'src/helper.ts', source: 'export const value = 2;\n' },
      ],
      [{ fileName: 'kovo.config.ts', source: 'export default {};\n' }],
    );
    expect(revised.entry.digest).toBe(baseline.entry.digest);
    expect(revised.closureDigest).not.toBe(baseline.closureDigest);
    expect(revised.projectDigest).not.toBe(baseline.projectDigest);

    expect(() =>
      createKovoSourceCheckInputProof('src/app.tsx', [
        { fileName: 'src/app.tsx', source: 'first' },
        { fileName: 'src/app.tsx', source: 'second' },
      ]),
    ).toThrow(/conflicting duplicate/u);
    expect(() =>
      createKovoSourceCheckInputProof('../app.tsx', [
        { fileName: '../app.tsx', source: 'export default {};' },
      ]),
    ).toThrow(/project-relative|ambiguous path/u);
  });

  it('detects edits, deletes, renames, and symlinks while excluding generated trees', () => {
    const root = fixtureRoot();
    const source = join(root, 'src/app.tsx');
    writeFileSync(source, 'export const revision = 0;\n');
    mkdirSync(join(root, 'node_modules/poison'), { recursive: true });
    writeFileSync(join(root, 'node_modules/poison/index.ts'), 'export const poison = 0;\n');

    const baseline = snapshotKovoSourceCheckProject(root);
    writeFileSync(join(root, 'node_modules/poison/index.ts'), 'export const poison = 1;\n');
    expect(snapshotKovoSourceCheckProject(root).digest).toBe(baseline.digest);

    writeFileSync(source, 'export const revision = 1;\n');
    const edited = snapshotKovoSourceCheckProject(root);
    expect(edited.digest).not.toBe(baseline.digest);

    const renamed = join(root, 'src/renamed.tsx');
    renameSync(source, renamed);
    const rename = snapshotKovoSourceCheckProject(root);
    expect(rename.digest).not.toBe(edited.digest);

    rmSync(renamed);
    const deleted = snapshotKovoSourceCheckProject(root);
    expect(deleted.digest).not.toBe(rename.digest);

    symlinkSync(join(root, 'outside.ts'), source);
    const symlink = snapshotKovoSourceCheckProject(root);
    expect(symlink.digest).not.toBe(deleted.digest);
    expect(symlink.symlinks).toEqual(['src/app.tsx']);
  });

  it('serializes revisions and collapses edit bursts into one bounded pending state', async () => {
    const root = fixtureRoot();
    const source = join(root, 'src/app.tsx');
    writeFileSync(source, 'export const revision = 0;\n');
    const lines: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const seen: number[] = [];

    const exit = await runKovoSourceCheckWatchSession({
      appModulePath: 'src/app.tsx',
      invocationRoot: root,
      maxRevisions: 3,
      pollIntervalMs: 25,
      async runRevision(revision) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seen.push(revision);
        if (revision === 0) {
          writeFileSync(source, 'export const revision = 1;\n');
          writeFileSync(source, 'export const revision = 2;\n');
        } else if (revision === 1) {
          writeFileSync(source, 'export const revision = 3;\n');
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        active -= 1;
        return revisionResult();
      },
      write(line) {
        lines.push(line);
      },
    });

    expect(exit).toBe(0);
    expect(maximumActive).toBe(1);
    expect(seen).toEqual([0, 1, 2]);
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line).revision)).toEqual([0, 1, 2]);
  });

  it('emits one versioned JSON object with the exact one-shot result and full phase census', () => {
    const line = formatKovoSourceCheckWatchRecord(7, revisionResult());
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    const record = JSON.parse(line);
    expect(record).toMatchObject({
      check: {
        diagnostics: [],
        result: {
          command: 'check',
          exitCode: 0,
          protocol: 'kovo-check/v1',
          text: 'kovo-check/v1\nOK\n',
        },
        version: 'kovo-diagnostic/v1',
      },
      event: 'revision',
      input: { schema: 'kovo-check-input-proof/v1' },
      phaseCensus: { schema: 'kovo-check-phase-census/v2' },
      revision: 7,
      version: 'kovo-check-watch/v1',
    });
    expect(record.phaseCensus.phases.map((phase: { name: string }) => phase.name)).toEqual(
      KOVO_SOURCE_CHECK_PHASES,
    );
  });

  it('rejects a dropped phase or an unauthenticated digest before writing JSONL', () => {
    const valid = revisionResult();
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        census: { ...valid.census, phases: valid.census.phases.slice(1) },
      }),
    ).toThrow(/invalid phase census/u);
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        census: { ...valid.census, checkGraphDigest: 'sha256:forged' },
      }),
    ).toThrow(/invalid phase census/u);
  });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(process.cwd(), '.tmp-source-check-session-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function revisionResult(): KovoSourceCheckRevisionResult {
  const input = createKovoSourceCheckInputProof('src/app.tsx', [
    { fileName: 'src/app.tsx', source: 'export default {};\n' },
  ]);
  return {
    census: {
      checkGraphDigest: digest,
      phases: KOVO_SOURCE_CHECK_PHASES.map((name) => ({
        durationMs: 1,
        inputDigest: input.projectDigest,
        name,
        status: 'executed',
      })),
      schema: 'kovo-check-phase-census/v2',
    },
    input,
    result: { exitCode: 0, output: 'kovo-check/v1\nOK\n' },
  };
}

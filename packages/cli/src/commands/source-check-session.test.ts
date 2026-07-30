import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commandFindingDiagnostic, formatKovoDiagnosticCommandResult } from '../diagnostic.js';
import { normalizeCommandResultDiagnostics } from '../shared.js';
import {
  createKovoSourceCheckInputProof,
  createRejectedKovoSourceCheckInputProof,
  formatKovoSourceCheckWatchRecord,
  KovoSourceCheckSnapshotRaceError,
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
      status: 'accepted',
    });
    expect(Object.isFrozen(baseline.closure[0])).toBe(true);

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

  it('detects every regular-file edit, delete, rename, and symlink outside generated trees', () => {
    const root = fixtureRoot();
    const source = join(root, 'src/app.tsx');
    writeFileSync(source, 'export const revision = 0;\n');
    mkdirSync(join(root, 'node_modules/poison'), { recursive: true });
    writeFileSync(join(root, 'node_modules/poison/index.ts'), 'export const poison = 0;\n');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist/generated.js'), 'export const generated = 0;\n');

    const baseline = snapshotKovoSourceCheckProject(root);
    writeFileSync(join(root, 'node_modules/poison/index.ts'), 'export const poison = 1;\n');
    writeFileSync(join(root, 'dist/generated.js'), 'export const generated = 1;\n');
    expect(snapshotKovoSourceCheckProject(root).digest).toBe(baseline.digest);

    writeFileSync(source, 'export const revision = 1;\n');
    const edited = snapshotKovoSourceCheckProject(root);
    expect(edited.digest).not.toBe(baseline.digest);

    writeFileSync(join(root, 'tooling.uncommon-config'), 'revision=1\n');
    const uncommon = snapshotKovoSourceCheckProject(root);
    expect(uncommon.digest).not.toBe(edited.digest);

    mkdirSync(join(root, 'build'), { recursive: true });
    writeFileSync(join(root, 'build/authored-input.custom'), 'revision=1\n');
    const authoredBuildTree = snapshotKovoSourceCheckProject(root);
    expect(authoredBuildTree.digest).not.toBe(uncommon.digest);

    const renamed = join(root, 'src/renamed.tsx');
    renameSync(source, renamed);
    const rename = snapshotKovoSourceCheckProject(root);
    expect(rename.digest).not.toBe(authoredBuildTree.digest);

    rmSync(renamed);
    const deleted = snapshotKovoSourceCheckProject(root);
    expect(deleted.digest).not.toBe(rename.digest);

    symlinkSync(join(root, 'outside.ts'), source);
    const symlink = snapshotKovoSourceCheckProject(root);
    expect(symlink.digest).not.toBe(deleted.digest);
    expect(symlink.symlinks).toEqual(['src/app.tsx']);
  });

  it('bounds directories, depth, symlinks, and each file before reading bytes', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'src/app.tsx'), '12345');

    expect(() => snapshotKovoSourceCheckProject(root, { fileBytes: 4 })).toThrow(
      /file exceeds its byte bound/u,
    );
    expect(() => snapshotKovoSourceCheckProject(root, { bytes: 4 })).toThrow(/resource bounds/u);
    expect(() => snapshotKovoSourceCheckProject(root, { directories: 1 })).toThrow(
      /directory bound/u,
    );
    expect(() => snapshotKovoSourceCheckProject(root, { entries: 1 })).toThrow(/entry bound/u);

    writeFileSync(join(root, 'second.input'), 'x');
    expect(() => snapshotKovoSourceCheckProject(root, { files: 1 })).toThrow(/resource bounds/u);

    mkdirSync(join(root, 'a/b'), { recursive: true });
    expect(() => snapshotKovoSourceCheckProject(root, { depth: 1 })).toThrow(/depth bound/u);

    symlinkSync(join(root, 'src/app.tsx'), join(root, 'link.ts'));
    expect(() => snapshotKovoSourceCheckProject(root, { symlinks: 0 })).toThrow(/symlink bound/u);
  });

  it('turns a readdir-to-lstat rename into typed retry evidence', async () => {
    const root = fixtureRoot();
    const source = join(root, 'src/app.tsx');
    const renamed = join(root, 'src/renamed.tsx');
    writeFileSync(source, 'export default {};\n');
    let moved = false;
    expect(() =>
      snapshotKovoSourceCheckProject(
        root,
        {},
        {
          beforeEntryLstat(relativePath) {
            if (relativePath !== 'src/app.tsx' || moved) return;
            moved = true;
            renameSync(source, renamed);
          },
        },
      ),
    ).toThrow(KovoSourceCheckSnapshotRaceError);

    renameSync(renamed, source);
    let attempts = 0;
    const exit = await runKovoSourceCheckWatchSession({
      appModulePath: 'src/app.tsx',
      invocationRoot: root,
      maxRevisions: 1,
      pollIntervalMs: 25,
      async runRevision() {
        return revisionResult();
      },
      snapshotProject(snapshotRoot) {
        attempts += 1;
        if (attempts === 1) throw new KovoSourceCheckSnapshotRaceError('src/app.tsx');
        return snapshotKovoSourceCheckProject(snapshotRoot);
      },
      write() {},
    });
    expect(exit).toBe(0);
    expect(attempts).toBe(2);
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

  it('embeds byte-equivalent fresh one-shot diagnostic envelopes for findings', () => {
    const diagnostic = commandFindingDiagnostic('proof', 'A compiler proof failed.');
    const result = {
      diagnostics: [diagnostic],
      exitCode: 1,
      output: 'kovo-check/v1\nERROR KV235 authored lowered IR is forbidden\n',
    } as const;
    const normalized = normalizeCommandResultDiagnostics(result, 'proof');
    const oneShotText = formatKovoDiagnosticCommandResult(
      normalized.diagnostics ?? [],
      {
        command: 'check',
        exitCode: normalized.exitCode,
        protocol: 'kovo-check/v1',
        text: normalized.output,
      },
      'json',
    );
    const oneShot = JSON.parse(oneShotText);
    const record = JSON.parse(
      formatKovoSourceCheckWatchRecord(0, {
        ...revisionResult(),
        result,
      }),
    );
    expect(record.check).toEqual(oneShot);
    expect(`${JSON.stringify(record.check)}\n`).toBe(oneShotText);
  });

  it('rejects structurally forged diagnostic records without local registry authority', () => {
    const valid = revisionResult();
    const diagnostic = commandFindingDiagnostic('proof', 'A compiler proof failed.');
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        result: {
          diagnostics: [{ ...diagnostic }],
          exitCode: 1,
          output: 'kovo-check/v1\nERROR forged diagnostic\n',
        },
      }),
    ).toThrow(/registry identity/u);
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

  it('represents a rejected symlink state without fabricating unavailable byte digests', () => {
    const rejected = createRejectedKovoSourceCheckInputProof('src/app.tsx', digest, 'symlink');
    const valid = revisionResult();
    const line = formatKovoSourceCheckWatchRecord(1, {
      ...valid,
      census: {
        ...valid.census,
        checkGraphDigest: null,
        phases: KOVO_SOURCE_CHECK_PHASES.map((name, index) => ({
          durationMs: index === 0 ? 1 : 0,
          inputDigest: rejected.projectDigest,
          name,
          status: index === 0 ? 'executed' : 'not-reached',
        })),
      },
      input: rejected,
      result: { error: 'kovo-check/v1\nERROR source symlink refused\n', exitCode: 1 },
    });
    const record = JSON.parse(line);
    expect(record.input).toEqual({
      closure: null,
      closureDigest: null,
      configClosureDigest: null,
      entry: { bytes: null, digest: null, path: 'src/app.tsx' },
      projectDigest: digest,
      reason: 'symlink',
      schema: 'kovo-check-input-proof/v1',
      status: 'rejected',
    });
    expect(record.phaseCensus.checkGraphDigest).toBeNull();
    expect(
      record.phaseCensus.phases
        .slice(1)
        .every((phase: { status: string }) => phase.status === 'not-reached'),
    ).toBe(true);
  });

  it('rejects resumed, nonzero reused, or passing rejected phase evidence', () => {
    const valid = revisionResult();
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        census: {
          ...valid.census,
          phases: valid.census.phases.map((phase, index) =>
            index === 2
              ? { ...phase, durationMs: 0, status: 'not-reached' }
              : index === 3
                ? { ...phase, durationMs: 0, status: 'executed' }
                : phase,
          ),
        },
      }),
    ).toThrow(/resumed/u);
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        census: {
          ...valid.census,
          phases: valid.census.phases.map((phase, index) =>
            index === 1 ? { ...phase, durationMs: 1, status: 'reused-authenticated' } : phase,
          ),
        },
      }),
    ).toThrow(/nonzero skipped phase/u);

    const rejected = createRejectedKovoSourceCheckInputProof('src/app.tsx', digest, 'missing');
    expect(() =>
      formatKovoSourceCheckWatchRecord(0, {
        ...valid,
        input: rejected,
      }),
    ).toThrow(/cannot publish a passing graph proof/u);
  });

  it('rejects project escapes and symlink roots before starting a revision callback', async () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'src/app.tsx'), 'export default {};\n');
    let ran = false;
    await expect(
      runKovoSourceCheckWatchSession({
        appModulePath: '../outside.tsx',
        invocationRoot: root,
        maxRevisions: 1,
        async runRevision() {
          ran = true;
          return revisionResult();
        },
      }),
    ).rejects.toThrow(/escapes the invocation project/u);
    expect(ran).toBe(false);

    const link = `${root}-link`;
    roots.push(link);
    symlinkSync(root, link);
    expect(() => snapshotKovoSourceCheckProject(link)).toThrow(/non-symlink directory/u);
  });

  it('keeps proof, scheduling, and JSONL serialization on boot-captured intrinsics', () => {
    const root = fixtureRoot();
    writeFileSync(join(root, 'src/app.tsx'), 'export default {};\n');
    const checked = revisionResult();
    const poisoned: Array<readonly [object, PropertyKey, PropertyDescriptor | undefined]> = [];
    const poison = (target: object, key: PropertyKey): void => {
      poisoned.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
      Object.defineProperty(target, key, {
        configurable: true,
        value() {
          throw new Error(`poisoned ${String(key)}`);
        },
        writable: true,
      });
    };
    let proof: ReturnType<typeof createKovoSourceCheckInputProof> | undefined;
    let snapshot: ReturnType<typeof snapshotKovoSourceCheckProject> | undefined;
    let record = '';
    try {
      for (const key of ['entries', 'includes', 'join', 'map', 'sort', 'values']) {
        poison(Array.prototype, key);
      }
      for (const key of ['get', 'set', 'values']) poison(Map.prototype, key);
      for (const key of ['add', 'has']) poison(Set.prototype, key);
      for (const key of ['endsWith', 'includes', 'split', 'startsWith']) {
        poison(String.prototype, key);
      }
      poison(JSON, 'stringify');
      poison(Object, 'freeze');
      poison(Number, 'isFinite');
      poison(Number, 'isSafeInteger');

      proof = createKovoSourceCheckInputProof('src/app.tsx', [
        { fileName: 'src/app.tsx', source: 'export default {};\n' },
      ]);
      snapshot = snapshotKovoSourceCheckProject(root);
      record = formatKovoSourceCheckWatchRecord(0, checked);
    } finally {
      for (let index = poisoned.length - 1; index >= 0; index -= 1) {
        const [target, key, descriptor] = poisoned[index]!;
        if (descriptor === undefined) delete (target as Record<PropertyKey, unknown>)[key];
        else Object.defineProperty(target, key, descriptor);
      }
    }

    expect(proof?.status).toBe('accepted');
    expect(snapshot?.files).toBe(1);
    expect(JSON.parse(record)).toMatchObject({ revision: 0, version: 'kovo-check-watch/v1' });
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

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyHmrImpact, compileComponentModule } from '../../packages/compiler/src/index.ts';

import {
  CORPUS_SCHEMA,
  DEV_PORT_ALLOCATION_POSTURE,
  EDIT_REFRESH_SURFACES,
  EDIT_SAVE_POSTURE,
  EDIT_STATE_POSTURE,
  generateCorpus,
  generateCorpora,
} from './generate.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('equal-shape developer corpus generator', () => {
  it.each([24, 216])('emits matched Kovo and Next.js N=%i workload identities', async (size) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-test-'));
    roots.push(root);
    const manifests = await generateCorpora({ outDir: root, sizes: [size] });
    expect(manifests).toHaveLength(2);
    const [kovo, next] = await Promise.all(
      manifests.map(async (manifestPath) => JSON.parse(await readFile(manifestPath, 'utf8'))),
    );

    expect(kovo.schema).toBe(CORPUS_SCHEMA);
    expect(next.schema).toBe(CORPUS_SCHEMA);
    expect(kovo.modules).toBe(size);
    expect(next.modules).toBe(size);
    expect(kovo.routes).toBe(4);
    expect(next.routes).toBe(4);
    expect(kovo.shapeDigest).toBe(next.shapeDigest);
    expect(kovo.shapeDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(kovo.workload).toEqual(next.workload);
    expect(kovo.workload.buildOutputContract).toBe('required-nonempty-and-cleanup-absent/v1');
    expect(kovo.workload.devPortAllocationPosture).toBe(DEV_PORT_ALLOCATION_POSTURE);
    expect(kovo.workload.editRefreshSurfaces).toEqual(EDIT_REFRESH_SURFACES);
    expect(kovo.workload.editSavePosture).toBe(EDIT_SAVE_POSTURE);
    expect(kovo.workload.editStatePosture).toBe(EDIT_STATE_POSTURE);
    expect(kovo.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(next.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(kovo.sourceFiles).toHaveLength(size + 10);
    expect(next.sourceFiles).toHaveLength(size + 11);
    expect(kovo.sourceFiles).toContainEqual(
      expect.objectContaining({ bytes: expect.any(Number), file: 'package.json' }),
    );
    expect(kovo.sourceFiles.every((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry.sha256))).toBe(
      true,
    );
    expect(Math.abs(kovo.approximateLoc - next.approximateLoc) / kovo.approximateLoc).toBeLessThan(
      0.1,
    );
    expect(kovo.dev.edits).toEqual(next.dev.edits);
    for (const [editClass, surface] of Object.entries(EDIT_REFRESH_SURFACES)) {
      expect(kovo.dev.edits[editClass]).toMatchObject({
        evidence: { selector: surface.selector },
        file: surface.file,
      });
    }
    expect(kovo.build.edit).toEqual(next.build.edit);
    expect(kovo.build.command.argv).toContain('build');
    expect(next.build.command.argv).toContain('build');
    expect(kovo.build.outputs).toEqual({
      absent: ['.kovo-build-stage-*'],
      requiredNonempty: ['.kovo', 'dist'],
    });
    expect(next.build.outputs).toEqual({ absent: [], requiredNonempty: ['.next'] });
    expect(kovo.dev.command.argv).toContain('localhost');
    expect(next.dev.command.argv).toContain('localhost');
    expect(kovo.dev.command.argv).not.toContain('127.0.0.1');
    expect(next.dev.command.argv).not.toContain('127.0.0.1');
    expect(path.isAbsolute(kovo.dev.command.argv[0])).toBe(false);
    expect(path.isAbsolute(next.dev.command.argv[0])).toBe(false);
    expect(kovo.dev.command.cwd).toBe('.');
    expect(next.dev.command.cwd).toBe('.');
    expect(
      await readFile(path.join(path.dirname(manifests[1]), 'next-env.d.ts'), 'utf8'),
    ).toContain('import "./.next/types/routes.d.ts";');

    const kovoRoot = path.dirname(manifests[0]);
    const kovoEntry = await readFile(path.join(kovoRoot, 'index.html'), 'utf8');
    const kovoConfig = await readFile(path.join(kovoRoot, 'kovo.config.ts'), 'utf8');
    expect(kovoEntry).toContain('<!doctype html>');
    expect(kovoEntry).toContain('<body></body>');
    expect(kovoConfig).toContain("from '@kovojs/server/build'");
    expect(kovoConfig).toContain("immutableClientModules: 'retained'");
    expect(kovoConfig).toContain("priorTokenQueryReads: 'retained'");
    expect(kovo.sourceFiles.map(({ file }) => file)).toEqual(
      expect.arrayContaining(['index.html', 'kovo.config.ts']),
    );
    for (const relativePath of ['index.html', 'kovo.config.ts']) {
      const source = await readFile(path.join(kovoRoot, relativePath));
      expect(kovo.sourceFiles).toContainEqual({
        bytes: source.byteLength,
        file: relativePath,
        sha256: `sha256:${createHash('sha256').update(source).digest('hex')}`,
      });
    }

    const [kovoShell, nextShell] = await Promise.all(
      manifests.map((manifestPath) =>
        readFile(path.join(path.dirname(manifestPath), 'src/shell.tsx'), 'utf8'),
      ),
    );
    expect(observableShellMarkup(kovoShell)).toBe(observableShellMarkup(nextShell));
    const expectedSiblings = [
      'EntryRefreshSurface',
      'DataRefreshSurface',
      ...Array.from(
        { length: size },
        (_, index) => `CorpusComponent${String(index).padStart(3, '0')}`,
      ),
      'CounterIsland',
    ];
    expect(directComponentChildren(kovoShell)).toEqual(expectedSiblings);
    expect(directComponentChildren(nextShell)).toEqual(expectedSiblings);

    for (const relativePath of Object.values(EDIT_REFRESH_SURFACES).map(({ file }) => file)) {
      const [kovoSurface, nextSurface] = await Promise.all(
        manifests.map((manifestPath) =>
          readFile(path.join(path.dirname(manifestPath), relativePath), 'utf8'),
        ),
      );
      expect(kovoSurface).toContain('queries: { refresh: benchmarkRefreshQuery }');
      expect(kovoSurface).not.toContain('<CounterIsland');
      expect(nextSurface).not.toContain('<CounterIsland');
    }
    expect(kovoShell.match(/<CounterIsland \/>/gu)).toHaveLength(1);
    expect(nextShell.match(/<CounterIsland \/>/gu)).toHaveLength(1);
  });

  it('proves every Kovo edit root is a component-refresh HMR target', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-hmr-target-test-'));
    roots.push(root);
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const appRoot = path.dirname(manifestPath);

    for (const editClass of ['leaf', 'entry', 'data']) {
      const edit = manifest.dev.edits[editClass];
      const source = await readFile(path.join(appRoot, edit.file), 'utf8');
      const changed = source.replace(
        edit.search,
        edit.replacementTemplate.replace('{revision}', `${editClass}-proof`),
      );
      const before = compileComponentModule({ fileName: edit.file, source });
      const after = compileComponentModule({ fileName: edit.file, source: changed });

      expect(before.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
      expect(after.diagnostics.filter(({ severity }) => severity === 'error')).toEqual([]);
      expect(before.hmrImpact?.liveTargetFacts.length, editClass).toBeGreaterThan(0);
      expect(after.hmrImpact?.liveTargetFactsHash, editClass).toBe(
        before.hmrImpact?.liveTargetFactsHash,
      );
      expect(classifyHmrImpact(before.hmrImpact, after.hmrImpact), editClass).toMatchObject({
        impact: 'componentRefresh',
      });
    }
  });

  it('uses entrant-local default roots so Turbopack dependency resolution stays inside its tree', async () => {
    const manifests = await generateCorpora({ sizes: [24] });
    const corpusRoot = path.dirname(fileURLToPath(import.meta.url));
    expect(manifests).toEqual([
      path.join(corpusRoot, '..', 'kovo', '.corpora', 'kovo', 'n24', 'manifest.json'),
      path.join(corpusRoot, '..', 'nextjs', '.corpora', 'nextjs', 'n24', 'manifest.json'),
    ]);
  });

  it('can defer dependency binding for an externally isolated packed-product corpus', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-deferred-dependencies-'));
    roots.push(root);
    const manifestPath = await generateCorpus({
      dependencyMode: 'deferred',
      framework: 'kovo',
      outDir: root,
      size: 24,
    });
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.build.command.argv[0]).toBe('node_modules/.bin/kovo');
    expect(manifest.dev.command.argv[0]).toBe('node_modules/.bin/kovo');
    await expect(
      lstat(path.join(path.dirname(manifestPath), 'node_modules')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses to recursively replace an output directory it did not generate', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-adversarial-'));
    roots.push(root);
    const unrelated = path.join(root, 'kovo', 'n24');
    const evidence = path.join(unrelated, 'do-not-delete.txt');
    await mkdir(unrelated, { recursive: true });
    await writeFile(evidence, 'owned by the caller\n');

    await expect(generateCorpora({ outDir: root, sizes: [24] })).rejects.toThrow(
      'Refusing to replace unowned corpus directory',
    );
    expect(await readFile(evidence, 'utf8')).toBe('owned by the caller\n');
  });

  it('refuses unsupported sizes instead of publishing a silently different workload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-test-'));
    roots.push(root);
    await expect(generateCorpora({ outDir: root, sizes: [25] })).rejects.toThrow(
      'Corpus size must be one of 24, 216',
    );
  });
});

function observableShellMarkup(source) {
  const match = /<main\b[\s\S]*?<\/main>/u.exec(source);
  if (!match) throw new TypeError('Generated shell has no main element.');
  return match[0]
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function directComponentChildren(source) {
  return [...source.matchAll(/^ {6}<([A-Z][A-Za-z0-9]+) \/>$/gmu)].map((match) => match[1]);
}

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { CORPUS_SCHEMA, generateCorpora } from './generate.mjs';

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
    expect(kovo.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(next.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(kovo.sourceFiles).toHaveLength(size + 6);
    expect(next.sourceFiles).toHaveLength(size + 10);
    expect(kovo.sourceFiles[0]).toEqual(
      expect.objectContaining({ bytes: expect.any(Number), file: 'package.json' }),
    );
    expect(kovo.sourceFiles.every((entry) => /^sha256:[0-9a-f]{64}$/u.test(entry.sha256))).toBe(
      true,
    );
    expect(Math.abs(kovo.approximateLoc - next.approximateLoc) / kovo.approximateLoc).toBeLessThan(
      0.1,
    );
    expect(kovo.dev.edits).toEqual(next.dev.edits);
    expect(kovo.build.edit).toEqual(next.build.edit);
    expect(kovo.build.command.argv).toContain('build');
    expect(next.build.command.argv).toContain('build');
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
  });

  it('uses entrant-local default roots so Turbopack dependency resolution stays inside its tree', async () => {
    const manifests = await generateCorpora({ sizes: [24] });
    const corpusRoot = path.dirname(fileURLToPath(import.meta.url));
    expect(manifests).toEqual([
      path.join(corpusRoot, '..', 'kovo', '.corpora', 'kovo', 'n24', 'manifest.json'),
      path.join(corpusRoot, '..', 'nextjs', '.corpora', 'nextjs', 'n24', 'manifest.json'),
    ]);
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

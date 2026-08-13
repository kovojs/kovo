import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
    expect(kovo.workload).toEqual(next.workload);
    expect(Math.abs(kovo.approximateLoc - next.approximateLoc) / kovo.approximateLoc).toBeLessThan(
      0.1,
    );
    expect(kovo.dev.edits).toEqual(next.dev.edits);
    expect(kovo.build.edit).toEqual(next.build.edit);
    expect(kovo.build.command.argv).toContain('build');
    expect(next.build.command.argv).toContain('build');
  });

  it('refuses unsupported sizes instead of publishing a silently different workload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-corpus-test-'));
    roots.push(root);
    await expect(generateCorpora({ outDir: root, sizes: [25] })).rejects.toThrow(
      'Corpus size must be one of 24, 216',
    );
  });
});

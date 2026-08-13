import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEV_LOOP_REPORT_SCHEMA,
  loadCorpusManifest,
  profileEditToPaint,
  runDevLoopBenchmark,
  summarizeNumbers,
  verifyCorpusSources,
} from './dev-loop.mjs';
import { generateCorpora } from './generate.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('single-entrant developer-loop adapter', () => {
  it('authenticates every generated source byte and rejects changed or additional sources', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    const evidence = await loadCorpusManifest(manifestPath);

    await expect(verifyCorpusSources(evidence)).resolves.toBeUndefined();
    expect(evidence.manifest.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(evidence.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

    const target = path.join(evidence.appRoot, 'src/data.ts');
    const original = await readFile(target, 'utf8');
    await writeFile(target, `${original}// changed\n`);
    await expect(verifyCorpusSources(evidence)).rejects.toThrow(
      'Corpus source integrity mismatch for src/data.ts',
    );
    await writeFile(target, original);

    await writeFile(path.join(evidence.appRoot, 'src/unmanifested.ts'), 'export {};\n');
    await expect(verifyCorpusSources(evidence)).rejects.toThrow(
      'Corpus contains unmanifested source files: src/unmanifested.ts',
    );
  });

  it('rejects a report path inside the measured corpus before launching a browser', async () => {
    const root = await temporaryRoot();
    const [manifestPath] = await generateCorpora({ outDir: root, sizes: [24] });
    await expect(
      runDevLoopBenchmark({
        iterations: 1,
        manifestPath,
        outPath: path.join(path.dirname(manifestPath), 'result.json'),
        port: 49_120,
        warmups: 0,
      }),
    ).rejects.toThrow('--out must be outside the generated corpus root');
  });

  it('summarizes raw cells and ranks only observed edit-to-paint spans', () => {
    expect(summarizeNumbers([4, 1, null, 3, 2])).toEqual({
      mad: 1,
      median: 2,
      p95: 4,
      samples: 4,
    });
    const profile = profileEditToPaint([
      {
        dataMs: 30,
        dataPaintFenceMs: 3,
        dataServerGenerationMs: null,
        dataWriteMs: 1,
        entryMs: 40,
        entryPaintFenceMs: 3,
        entryServerGenerationMs: 25,
        entryWriteMs: 2,
        leafMs: 20,
        leafPaintFenceMs: 4,
        leafServerGenerationMs: 10,
        leafWriteMs: 1,
        recoveryMs: 60,
        recoveryPaintFenceMs: 5,
        recoveryServerGenerationMs: 50,
        recoveryWriteMs: 2,
        syntaxErrorMs: 70,
        syntaxErrorPaintFenceMs: 4,
        syntaxErrorServerGenerationMs: null,
        syntaxErrorWriteMs: 1,
      },
    ]);
    expect(profile.topFive.map(({ editClass, id }) => `${editClass}:${id}`)).toEqual([
      'syntaxError:edit-to-paint',
      'recovery:edit-to-paint',
      'recovery:server-generation',
      'entry:edit-to-paint',
      'data:edit-to-paint',
    ]);
  });

  it('writes a fail-closed report and exits nonzero when the manifest is unavailable', async () => {
    const root = await temporaryRoot();
    const outPath = path.join(root, 'failure.json');
    const script = fileURLToPath(new URL('./dev-loop.mjs', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--manifest',
        path.join(root, 'missing.json'),
        '--iterations',
        '1',
        '--warmups',
        '0',
        '--port',
        '49121',
        '--out',
        outPath,
      ],
      { encoding: 'utf8' },
    );
    const report = JSON.parse(await readFile(outPath, 'utf8'));

    expect(result.status).toBe(1);
    expect(report.schema).toBe(DEV_LOOP_REPORT_SCHEMA);
    expect(report.integrity.complete).toBe(false);
    expect(report.integrity.errors[0]).toMatch(/ENOENT/u);
    expect(report.verdict.status).toBe('unproven');
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-loop-test-'));
  roots.push(root);
  return root;
}

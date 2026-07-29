import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runSoundSubsetCheck } from './sound-subset.js';

describe('framework sound-subset source inventory', () => {
  it('anchors a missing strict-scaffold declaration to the exact package config key', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sound-subset-config-'));
    const manifest = `${JSON.stringify(
      {
        kovo: { lifecyclePolicy: 'strict-v1' },
        name: 'missing-security-surface',
        private: true,
      },
      null,
      2,
    )}\n`;
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), manifest);

    try {
      const result = await runSoundSubsetCheck(root, process.env, 'kovo-check/v1');
      const start = manifest.indexOf('"lifecyclePolicy"');
      expect(result).toMatchObject({
        diagnostics: [
          {
            category: 'proof',
            source: {
              end: start + '"lifecyclePolicy"'.length,
              file: join(realpathSync(root), 'package.json'),
              start,
            },
          },
        ],
        exitCode: 1,
      });
      expect(result.output).toContain('kovo.soundSubset.securitySurface');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('scans the exact declared JavaScript and TypeScript surface without starter-name guesses', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sound-subset-declared-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          kovo: {
            lifecyclePolicy: 'strict-v1',
            soundSubset: { securitySurface: ['src/app.jsx', 'src/model.ts'] },
          },
          name: 'declared-security-surface',
          private: true,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(root, 'src/app.jsx'), 'export const App = () => <main />;\n');
    writeFileSync(join(root, 'src/model.ts'), 'export const model = Object.freeze({});\n');

    try {
      await expect(runSoundSubsetCheck(root, process.env, 'kovo-check/v1')).resolves.toEqual({
        exitCode: 0,
        output: 'kovo-check/v1\nOK SOUND-SUBSET files=src\n',
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

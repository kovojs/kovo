import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  packedTarballPath,
  parseGoldenJourneyArgs,
  validateExternalPackedJourneyManifest,
} from './golden-journey.mjs';
import { offlineAgentScenario } from './golden-journey/offline-agent.mjs';
import { packedAppsScenario } from './golden-journey/packed-app.mjs';
import { manifestPath, repoRoot } from './release-packages.mjs';

describe('golden journey command', () => {
  it('selects the packed offline-agent scenario and repo-owned manifest by default', () => {
    expect(parseGoldenJourneyArgs(['--scenario', offlineAgentScenario])).toEqual({
      packedManifest: manifestPath,
      scenario: offlineAgentScenario,
    });
  });

  it('resolves explicit manifest/report paths and rejects unknown or missing scenarios', () => {
    expect(
      parseGoldenJourneyArgs([
        '--scenario',
        offlineAgentScenario,
        '--packed-manifest',
        '.release/packed-packages.json',
        '--report',
        '.artifacts/offline-agent.json',
      ]),
    ).toEqual({
      packedManifest: path.join(repoRoot, '.release/packed-packages.json'),
      report: path.join(repoRoot, '.artifacts/offline-agent.json'),
      scenario: offlineAgentScenario,
    });
    expect(() => parseGoldenJourneyArgs([])).toThrow(/--scenario/);
    expect(() => parseGoldenJourneyArgs(['--scenario', 'live-agent'])).toThrow(/offline-agent/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--fetch-docs']),
    ).toThrow(/Unknown/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--keep-temp']),
    ).toThrow(/Unknown/);
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', offlineAgentScenario, '--dialect', 'sqlite']),
    ).toThrow(/apply only to packed-apps/u);
  });

  it('selects one or both packed starter dialects with bounded statistical samples', () => {
    expect(
      parseGoldenJourneyArgs([
        '--scenario',
        packedAppsScenario,
        '--dialect',
        'sqlite',
        '--samples',
        '5',
        '--artifacts',
        '.release/devex/journey-artifacts',
        '--report',
        '.release/devex/journey.json',
      ]),
    ).toEqual({
      artifactRoot: path.join(repoRoot, '.release/devex/journey-artifacts'),
      dialects: ['sqlite'],
      packedManifest: manifestPath,
      report: path.join(repoRoot, '.release/devex/journey.json'),
      samples: 5,
      scenario: packedAppsScenario,
    });
    expect(parseGoldenJourneyArgs(['--scenario', packedAppsScenario])).toMatchObject({
      dialects: ['postgres', 'sqlite'],
      samples: 1,
    });
    expect(() =>
      parseGoldenJourneyArgs(['--scenario', packedAppsScenario, '--samples', '0']),
    ).toThrow(/integer from 1 through 20/u);
  });

  it('authenticates an external manifest against its own release tarball root', () => {
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'kovo-external-packed-manifest-'));
    try {
      const tarballRoot = path.join(externalRoot, '.release', 'tarballs');
      mkdirSync(tarballRoot, { recursive: true });
      const tarball = path.join(tarballRoot, 'package.tgz');
      writeFileSync(tarball, 'fixture');

      expect(
        packedTarballPath(
          path.join(externalRoot, '.release', 'packed-packages.json'),
          '.release/tarballs/package.tgz',
        ),
      ).toBe(realpathSync(tarball));
      expect(() =>
        packedTarballPath(
          path.join(externalRoot, '.release', 'packed-packages.json'),
          '../outside.tgz',
        ),
      ).toThrow(/must stay inside/u);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it('keeps external manifest admission bound to the exact release inventory', () => {
    const expected = [{ name: '@kovojs/ui', version: '0.2.0' }];
    const manifest = {
      schema: 'kovo.packed-public-packages/v2',
      packages: [
        {
          files: ['package/package.json'],
          manifest: { name: '@kovojs/ui', version: '0.2.0' },
          name: '@kovojs/ui',
          sha512: 'sha512-YQ==',
          tarball: '.release/tarballs/kovojs-ui-0.2.0.tgz',
          version: '0.2.0',
        },
      ],
    };

    expect(validateExternalPackedJourneyManifest(manifest, expected)).toBe(manifest.packages);
    const substituted = structuredClone(manifest);
    substituted.packages[0].name = '@kovojs/icons';
    expect(() => validateExternalPackedJourneyManifest(substituted, expected)).toThrow(
      /package 0 is invalid/u,
    );
  });
});

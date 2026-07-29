import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGoldenJourneyArgs } from './golden-journey.mjs';
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
});

import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseGoldenJourneyArgs } from './golden-journey.mjs';
import { offlineAgentScenario } from './golden-journey/offline-agent.mjs';
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
  });
});

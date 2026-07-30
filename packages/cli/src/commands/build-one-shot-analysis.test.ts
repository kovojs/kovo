import { describe, expect, it } from 'vitest';

import { runBuildCommandFromOneShotAnalysis, type KovoBuildOptions } from './build-export.js';
import { kovoBuildOneShotDigest, type KovoBuildOneShotIdentity } from './build-one-shot-handoff.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';

describe('one-shot build analysis boundary', () => {
  it('fails closed before evaluation when the authenticated payload omits analysis fields', async () => {
    const options: KovoBuildOptions = {
      appModulePath: 'missing-app.tsx',
      cache: true,
      check: true,
      outDir: 'missing-dist',
      preset: 'node',
    };
    const identity: KovoBuildOneShotIdentity = {
      appModulePath: options.appModulePath,
      compilerProvenanceDigest: kovoBuildOneShotDigest({ compiler: 'test' }),
      configSourceDigest: null,
      invocationRoot: process.cwd(),
      optionsDigest: kovoBuildOneShotDigest(options),
      sourceSetDigest: kovoBuildOneShotDigest([]),
    };

    await expect(
      runBuildCommandFromOneShotAnalysis(
        options,
        {},
        identity,
        captureKovoCommandSecurityDisposition(),
      ),
    ).resolves.toEqual({
      error: expect.stringMatching(/handoff analysis omitted approvedSourceFiles/u),
      exitCode: 1,
    });
  });
});

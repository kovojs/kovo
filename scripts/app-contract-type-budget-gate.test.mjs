import { describe, expect, it } from 'vitest';

import {
  deriveRatifiedTypeBudgets,
  evaluateAppContractTypeBudgets,
  exactRatifiedRunnerMatches,
  loadAppContractTypeBudgetManifest,
  validateAppContractTypeBudgetManifest,
} from './app-contract-type-budget-gate.mjs';

describe('app-contract TypeScript budget policy', () => {
  it('derives concrete timing and declaration ceilings from D1 v6 Arm A', () => {
    const manifest = loadAppContractTypeBudgetManifest();
    expect(deriveRatifiedTypeBudgets(manifest)).toEqual({
      coldCompletionP50Ms: 150,
      coldTscP50Ms: 400,
      completionCandidateCount: 10,
      completionCandidateDigest: '7a3824b477b68558af819b2d70b9af1fb4940c43e814dd1fcbc55420d71b9958',
      declarationBytesMaximum: 17_500,
      diagnosticMessageCharactersMaximum: 240,
      diagnosticSpanCharacters: 3,
      instantiationsMaximum: null,
      warmCompletionP95Ms: 5,
      warmTscP50Ms: 300,
    });
    expect(validateAppContractTypeBudgetManifest(manifest)).toEqual([]);
  });

  it('rejects ceiling, runner, derivation, and ratification drift', () => {
    const manifest = loadAppContractTypeBudgetManifest();
    const widened = structuredClone(manifest);
    widened.budgets.coldTscP50Ms += 1;
    expect(validateAppContractTypeBudgetManifest(widened).join('\n')).toContain(
      'budgets.coldTscP50Ms must equal derived value 400',
    );

    const movedRunner = structuredClone(manifest);
    movedRunner.baseline.runner.cpuModel = 'unreviewed';
    expect(validateAppContractTypeBudgetManifest(movedRunner).join('\n')).toContain(
      'exact D1 v6 Apple M4 identity',
    );

    const hiddenHeadroom = structuredClone(manifest);
    hiddenHeadroom.derivation.timingHeadroomPercent = 31;
    expect(validateAppContractTypeBudgetManifest(hiddenHeadroom).join('\n')).toContain(
      'derivation.timingHeadroomPercent must equal 30',
    );

    const falseRatification = structuredClone(manifest);
    falseRatification.ratification.instantiations = 'ratified';
    expect(validateAppContractTypeBudgetManifest(falseRatification).join('\n')).toContain(
      'ratified baseline instantiations must be a safe integer',
    );
  });

  it('enforces timings only on the exact ratified runner and never waives type-shape metrics', () => {
    const manifest = loadAppContractTypeBudgetManifest();
    const exactRunner = manifest.baseline.runner;
    expect(exactRatifiedRunnerMatches(manifest, exactRunner)).toBe(true);
    expect(
      exactRatifiedRunnerMatches(manifest, {
        ...exactRunner,
        nodeVersion: 'v24.18.2',
      }),
    ).toBe(false);

    const measurement = {
      coldCompletionP50Ms: 151,
      coldTscP50Ms: 401,
      completionCandidateCount: 10,
      completionCandidateDigest: manifest.budgets.completionCandidateDigest,
      declarationBytes: 17_500,
      diagnosticMessageCharacters: 240,
      diagnosticSpanCharacters: 3,
      instantiations: 1,
      warmCompletionP95Ms: 6,
      warmTscP50Ms: 301,
    };
    const nonRatifiedRunner = evaluateAppContractTypeBudgets(manifest, measurement, {
      enforceTimings: false,
    });
    expect(nonRatifiedRunner.findings).toEqual([
      'extendedDiagnostics instantiation ceiling is not ratified',
    ]);

    const exactRunnerVerdict = evaluateAppContractTypeBudgets(manifest, measurement, {
      enforceTimings: true,
    });
    expect(exactRunnerVerdict.findings).toEqual([
      'coldTscP50Ms 401 exceeds 400',
      'warmTscP50Ms 301 exceeds 300',
      'coldCompletionP50Ms 151 exceeds 150',
      'warmCompletionP95Ms 6 exceeds 5',
      'extendedDiagnostics instantiation ceiling is not ratified',
    ]);
  });
});

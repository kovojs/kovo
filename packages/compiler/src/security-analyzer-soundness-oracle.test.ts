// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies finite-analyzer-differential-soundness
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzerOracleProductionIds,
  analyzerOracleWitnessedLatticeElements,
  analyzerSoundnessCounterexampleSchema,
  generateAnalyzerOracleLatticeWitnesses,
  generateAnalyzerOracleTransferWitnesses,
  runAnalyzerSoundnessOracle,
} from './security-analyzer-soundness-oracle.js';
import {
  securityAbstractInterpreterCensus,
  securityAbstractTransferIds,
} from './scan/security-abstract-interpreter.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('SPEC §11.2 finite analyzer soundness-falsification oracle', () => {
  it('derives one generator production per transfer and witnesses every lattice element', () => {
    const witnesses = generateAnalyzerOracleTransferWitnesses();
    expect(analyzerOracleProductionIds).toEqual(securityAbstractTransferIds);
    expect(witnesses.map((witness) => witness.id)).toEqual(securityAbstractTransferIds);
    expect(witnesses.map((witness) => witness.production)).toEqual(
      securityAbstractInterpreterCensus.transfers.map((transfer) => transfer.production),
    );
    expect(witnesses.every((witness) => witness.source.length > 0)).toBe(true);
    expect(new Set(witnesses.map((witness) => witness.source)).size).toBe(witnesses.length);
    expect(generateAnalyzerOracleLatticeWitnesses()).toEqual(
      securityAbstractInterpreterCensus.lattice.elements.map((element) => ({
        element,
        production: 'lattice-element',
      })),
    );
    expect(analyzerOracleWitnessedLatticeElements()).toEqual(
      securityAbstractInterpreterCensus.lattice.elements,
    );

    const sourceFor = (id: (typeof securityAbstractTransferIds)[number]): string =>
      witnesses.find((witness) => witness.id === id)!.source;
    expect(sourceFor('budget.call-depth-close').match(/function helper/gu)?.length).toBeGreaterThan(
      securityAbstractInterpreterCensus.resourceBounds.callDepth,
    );
    expect(sourceFor('budget.node-count-close').match(/;/gu)?.length).toBeGreaterThan(
      securityAbstractInterpreterCensus.resourceBounds.nodes,
    );
    expect(
      sourceFor('budget.operation-count-close').match(/ctx\.db\.select/gu)?.length,
    ).toBeGreaterThan(securityAbstractInterpreterCensus.resourceBounds.operations);
    expect(
      sourceFor('budget.summary-count-close').match(/function helper/gu)?.length,
    ).toBeGreaterThan(securityAbstractInterpreterCensus.resourceBounds.summaries);
  });

  it('keeps instrumented emitted effects inside abstract predictions for the seeded finite language', async () => {
    const nightly = process.env.KOVO_SECURITY_FUZZ_PROFILE === 'nightly';
    const result = await runAnalyzerSoundnessOracle({
      programBudget: nightly
        ? securityAbstractInterpreterCensus.language.generatedProgramBudget
        : 18,
      seed: 0x4b56_4149,
    });

    expect(result.seed).toBe('0x4b564149');
    expect(result.witnessedDoors).toEqual(securityAbstractInterpreterCensus.language.effectDoors);
  }, 120_000);

  it('persists and fails on a missed abstract transfer canary', async () => {
    const directory = temporaryDirectory();
    await expect(
      runAnalyzerSoundnessOracle({
        artifactDirectory: directory,
        canary: { dropAbstractKind: 'server.egress.request' },
        programBudget: 9,
        seed: 0x4b56_4149,
      }),
    ).rejects.toThrow('observed is not a subset of abstract-predicted');

    expect(counterexample(directory)).toMatchObject({
      schema: analyzerSoundnessCounterexampleSchema,
      classification: 'normative-property-violation',
      counterexample: {
        detail: expect.stringContaining('observed is not a subset'),
        program: { aliasDepth: 0, door: 'ctx.fetch', helperDepth: 0 },
      },
      safetyVerdict: 'unsafe',
    });
  }, 120_000);

  it('persists and fails on a missing effect-door observation canary', async () => {
    const directory = temporaryDirectory();
    await expect(
      runAnalyzerSoundnessOracle({
        artifactDirectory: directory,
        canary: { dropObservedDoor: 'ctx.fetch' },
        programBudget: 9,
        seed: 0x4b56_4149,
      }),
    ).rejects.toThrow('independent concrete semantics differ');

    expect(counterexample(directory)).toMatchObject({
      schema: analyzerSoundnessCounterexampleSchema,
      counterexample: {
        concreteExpected: [{ door: 'ctx.fetch', kind: 'server.egress.request' }],
        detail: expect.stringContaining('instrumented emitted effect doors'),
        emittedObserved: [],
      },
    });
  }, 120_000);
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'kovo-analyzer-oracle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function counterexample(directory: string): unknown {
  return JSON.parse(
    readFileSync(path.join(directory, 'analyzer-minimized-counterexample.json'), 'utf8'),
  );
}

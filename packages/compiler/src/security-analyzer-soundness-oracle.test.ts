// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies finite-analyzer-differential-soundness
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzerOracleProductionIds,
  analyzerOracleWitnessedLatticeElements,
  analyzerSoundnessCounterexampleSchema,
  digestAnalyzerOracleReplayInput,
  evaluateAnalyzerOracleLatticeWitness,
  generateAnalyzerOracleLatticeWitnesses,
  generateAnalyzerOraclePrograms,
  generateAnalyzerOracleTransferWitnesses,
  persistAnalyzerOracleNonCanaryReplayProbeForTest,
  replayAnalyzerSoundnessCounterexample,
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
  it.skipIf(process.env.KOVO_ANALYZER_ORACLE_REPLAY_FILE === undefined)(
    'replays persisted analyzer counterexample from KOVO_ANALYZER_ORACLE_REPLAY_FILE',
    async () => {
      const artifactPath = process.env.KOVO_ANALYZER_ORACLE_REPLAY_FILE!;
      const artifact = readCounterexampleRecord(artifactPath);
      expect(artifact.replay.environment.KOVO_SECURITY_FUZZ_SEED).toBe(
        process.env.KOVO_SECURITY_FUZZ_SEED,
      );
      await expect(replayAnalyzerSoundnessCounterexample(artifactPath)).resolves.toMatchObject({
        detail: artifact.replay.input.expectedDetail,
      });
    },
  );

  it('derives one generator production per transfer and witnesses every lattice element', () => {
    const witnesses = generateAnalyzerOracleTransferWitnesses();
    expect(analyzerOracleProductionIds).toEqual(securityAbstractTransferIds);
    expect(witnesses.map((witness) => witness.id)).toEqual(securityAbstractTransferIds);
    expect(witnesses.map((witness) => witness.production)).toEqual(
      securityAbstractInterpreterCensus.transfers.map((transfer) => transfer.production),
    );
    expect(witnesses.map((witness) => witness.program.transferId)).toEqual(
      securityAbstractTransferIds,
    );
    expect(witnesses.every((witness) => witness.source.length > 0)).toBe(true);
    expect(new Set(witnesses.map((witness) => witness.source)).size).toBe(witnesses.length);
    expect(
      generateAnalyzerOraclePrograms({
        budget:
          securityAbstractTransferIds.length +
          securityAbstractInterpreterCensus.language.effectDoors.length,
      })
        .slice(0, securityAbstractTransferIds.length)
        .map((program) => program.transferId),
    ).toEqual(securityAbstractTransferIds);
    expect(() =>
      generateAnalyzerOraclePrograms({
        budget:
          securityAbstractTransferIds.length +
          securityAbstractInterpreterCensus.language.effectDoors.length -
          1,
      }),
    ).toThrow('so every transfer and effect door is witnessed');
    const latticeWitnesses = generateAnalyzerOracleLatticeWitnesses();
    expect(latticeWitnesses.map((witness) => witness.element)).toEqual(
      securityAbstractInterpreterCensus.lattice.elements,
    );
    expect(
      latticeWitnesses.map((witness) => evaluateAnalyzerOracleLatticeWitness(witness)),
    ).toEqual(latticeWitnesses.map((witness) => witness.expected));
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
        : securityAbstractTransferIds.length + 9,
      seed: 0x4b56_4149,
    });

    expect(result.seed).toBe('0x4b564149');
    expect(result.witnessedDoors).toEqual(securityAbstractInterpreterCensus.language.effectDoors);
    expect(result.witnessedLatticeElements).toEqual(
      securityAbstractInterpreterCensus.lattice.elements,
    );
    expect(result.witnessedTransfers).toEqual(securityAbstractTransferIds);
  }, 120_000);

  it('persists and fails on a missed abstract transfer canary', async () => {
    const directory = temporaryDirectory();
    await expect(
      runAnalyzerSoundnessOracle({
        artifactDirectory: directory,
        canary: { weakenTransferId: 'effect.invoke' },
        programBudget:
          securityAbstractTransferIds.length +
          securityAbstractInterpreterCensus.language.effectDoors.length,
        seed: 0x4b56_4149,
      }),
    ).rejects.toThrow('observed is not a subset of abstract-predicted');

    expect(counterexample(directory)).toMatchObject({
      schema: analyzerSoundnessCounterexampleSchema,
      classification: 'normative-property-violation',
      counterexample: {
        detail: expect.stringContaining('observed is not a subset'),
        program: {
          noise: false,
          transferId: 'effect.invoke',
          variant: 'transfer',
        },
        witnessedTransfers: expect.arrayContaining(['effect.invoke']),
      },
      safetyVerdict: 'unsafe',
    });

    const artifactPath = counterexamplePath(directory);
    const artifact = readCounterexampleRecord(artifactPath);
    expect(artifact.replayVerified).toBe(true);
    expect(artifact.replay.command).toContain('KOVO_ANALYZER_ORACLE_REPLAY_FILE=');
    await expect(replayAnalyzerSoundnessCounterexample(artifactPath)).resolves.toMatchObject({
      detail: expect.stringContaining('observed is not a subset'),
    });
    const [replayCommand, ...replayArguments] = artifact.replay.argv;
    const replay = spawnSync(replayCommand!, replayArguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...artifact.replay.environment },
    });
    expect(
      { signal: replay.signal, status: replay.status, stderr: replay.stderr },
      `${replay.stdout}\n${replay.stderr}`,
    ).toEqual({ signal: null, status: 0, stderr: '' });

    const programTamperedPath = path.join(directory, 'program-tampered.json');
    const programTampered = structuredClone(artifact);
    programTampered.replay.input.program.transferId = 'alias.const-preserve';
    programTampered.replay.inputDigest = digestAnalyzerOracleReplayInput(
      programTampered.replay.input,
    );
    writeFileSync(programTamperedPath, `${JSON.stringify(programTampered, null, 2)}\n`, 'utf8');
    await expect(replayAnalyzerSoundnessCounterexample(programTamperedPath)).rejects.toThrow(
      'program differs',
    );

    const weakeningTamperedPath = path.join(directory, 'weakening-tampered.json');
    const weakeningTampered = structuredClone(artifact);
    weakeningTampered.replay.input.canary = {};
    weakeningTampered.replay.inputDigest = digestAnalyzerOracleReplayInput(
      weakeningTampered.replay.input,
    );
    writeFileSync(weakeningTamperedPath, `${JSON.stringify(weakeningTampered, null, 2)}\n`, 'utf8');
    await expect(replayAnalyzerSoundnessCounterexample(weakeningTamperedPath)).rejects.toThrow(
      'did not reproduce the unsafe verdict',
    );
  }, 120_000);

  it('persists and fails on a missing effect-door observation canary', async () => {
    const directory = temporaryDirectory();
    await expect(
      runAnalyzerSoundnessOracle({
        artifactDirectory: directory,
        canary: { dropObservedDoor: 'ctx.fetch' },
        programBudget:
          securityAbstractTransferIds.length +
          securityAbstractInterpreterCensus.language.effectDoors.length,
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

  it('keeps an organic no-canary failure unconfirmed when strict replay does not reproduce', async () => {
    const directory = temporaryDirectory();
    await expect(persistAnalyzerOracleNonCanaryReplayProbeForTest(directory)).rejects.toThrow(
      'did not reproduce the unsafe verdict',
    );

    const artifactPath = counterexamplePath(directory);
    const artifact = readCounterexampleRecord(artifactPath);
    expect(artifact).toMatchObject({
      classification: 'unconfirmed-failure',
      replay: { input: { canary: {} } },
      replayVerified: false,
      safetyVerdict: 'undetermined',
    });
    await expect(replayAnalyzerSoundnessCounterexample(artifactPath)).rejects.toThrow(
      'did not reproduce the unsafe verdict',
    );
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'kovo-analyzer-oracle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function counterexample(directory: string): unknown {
  return readCounterexampleRecord(counterexamplePath(directory));
}

interface MutableReplayRecord {
  readonly classification: string;
  readonly replay: {
    readonly argv: readonly string[];
    readonly command: string;
    readonly environment: {
      readonly KOVO_ANALYZER_ORACLE_REPLAY_FILE: string;
      readonly KOVO_SECURITY_FUZZ_SEED: string;
    };
    readonly input: {
      canary: { dropObservedDoor?: string; weakenTransferId?: string };
      readonly expectedDetail: string;
      readonly program: { transferId: string };
      readonly seed: string;
    };
    inputDigest: string;
  };
  readonly replayVerified: boolean;
  readonly safetyVerdict: string;
}

function counterexamplePath(directory: string): string {
  return path.join(directory, 'analyzer-minimized-counterexample.json');
}

function readCounterexampleRecord(artifactPath: string): MutableReplayRecord {
  return JSON.parse(readFileSync(artifactPath, 'utf8')) as MutableReplayRecord;
}

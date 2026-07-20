import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluateTimingBudget,
  persistTimingCounterexample,
  timingOracleSchema,
} from './response-indistinguishability-timing-oracle.mjs';

const budget = {
  absoluteEffectThresholdMs: 5,
  id: 'nightly-v1',
  madMultiplier: 4,
  noiseModel: 'paired-alternating-median-mad',
  relativeEffectThreshold: 0.2,
  sampleSize: 64,
  warmupSamples: 8,
};

describe('response indistinguishability timing oracle', () => {
  it('accepts paired distributions below the declared effect threshold', () => {
    const left = Array.from({ length: 64 }, (_, index) => 30 + (index % 4));
    const right = Array.from({ length: 64 }, (_, index) => 31 + (index % 4));
    expect(evaluateTimingBudget(left, right, budget)).toMatchObject({ ok: true });
  });

  it('rejects a planted world-dependent timing canary and persists a replay artifact', () => {
    const left = Array.from({ length: 64 }, (_, index) => 30 + (index % 3));
    const right = Array.from({ length: 64 }, (_, index) => 50 + (index % 3));
    const verdict = evaluateTimingBudget(left, right, budget);
    expect(verdict.ok).toBe(false);

    const directory = mkdtempSync(path.join(tmpdir(), 'kovo-response-timing-'));
    const file = persistTimingCounterexample({
      budget,
      directory,
      samplesA: left,
      samplesB: right,
      surface: 'canary.account',
    });
    const artifact = JSON.parse(readFileSync(file, 'utf8'));
    expect(artifact).toMatchObject({ schema: timingOracleSchema, surface: 'canary.account' });
    expect(artifact.samplesA.length).toBeLessThanOrEqual(64);
    expect(artifact.verdict.ok).toBe(false);
  });
});

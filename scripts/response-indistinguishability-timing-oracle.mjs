#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { isMainEntry } from './lib/cli-entry.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const timingOracleSchema = 'kovo-response-timing-counterexample/v1';

/** Run paired worlds in alternating order so monotonic host drift does not always favor one. */
export async function measureAlternatingWorlds(options) {
  const { sampleSize, warmupSamples, worldA, worldB } = options;
  assertCount(sampleSize, 'sampleSize', 16);
  assertCount(warmupSamples, 'warmupSamples', 0);
  if (typeof worldA !== 'function' || typeof worldB !== 'function') {
    throw new TypeError('Timing oracle requires worldA and worldB functions.');
  }

  for (let index = 0; index < warmupSamples; index += 1) {
    if (index % 2 === 0) {
      await worldA();
      await worldB();
    } else {
      await worldB();
      await worldA();
    }
  }

  const samplesA = [];
  const samplesB = [];
  for (let index = 0; index < sampleSize; index += 1) {
    if (index % 2 === 0) {
      samplesA.push(await duration(worldA));
      samplesB.push(await duration(worldB));
    } else {
      samplesB.push(await duration(worldB));
      samplesA.push(await duration(worldA));
    }
  }
  return { samplesA, samplesB };
}

/** Evaluate the versioned paired-median/MAD effect budget. */
export function evaluateTimingBudget(samplesA, samplesB, budget) {
  validateSamples(samplesA, samplesB, budget.sampleSize);
  const medianA = median(samplesA);
  const medianB = median(samplesB);
  const pairedDifferences = samplesA.map((value, index) => value - samplesB[index]);
  const effectMs = Math.abs(median(pairedDifferences));
  const differenceMedian = median(pairedDifferences);
  const mad = median(pairedDifferences.map((value) => Math.abs(value - differenceMedian)));
  const pooledMedianMs = median([...samplesA, ...samplesB]);
  const noiseThresholdMs = (budget.madMultiplier * 1.4826 * mad) / Math.sqrt(samplesA.length);
  const thresholdMs = Math.max(
    budget.absoluteEffectThresholdMs,
    budget.relativeEffectThreshold * pooledMedianMs,
    noiseThresholdMs,
  );
  return Object.freeze({
    effectMs,
    medianA,
    medianB,
    noiseThresholdMs,
    ok: effectMs <= thresholdMs,
    pooledMedianMs,
    thresholdMs,
  });
}

/** Persist a minimized failing prefix that can be replayed without rerunning the deployment. */
export function persistTimingCounterexample(options) {
  const { budget, directory, samplesA, samplesB, surface } = options;
  const minimized = minimizeFailingPrefix(samplesA, samplesB, budget);
  mkdirSync(directory, { recursive: true });
  const safeSurface = surface.replace(/[^a-z0-9.-]+/giu, '-');
  const file = path.join(directory, `${safeSurface}-${Date.now()}.json`);
  const artifact = {
    budget,
    replay: `node scripts/response-indistinguishability-timing-oracle.mjs --replay ${file}`,
    samplesA: minimized.samplesA,
    samplesB: minimized.samplesB,
    schema: timingOracleSchema,
    surface,
    verdict: minimized.verdict,
  };
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return file;
}

export function loadNightlyTimingBudget(root = findRepoRoot()) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'security/response-observation-surfaces.v1.json'), 'utf8'),
  );
  const budget = manifest.timingBudgets?.find((entry) => entry.id === 'nightly-v1');
  if (!budget)
    throw new TypeError('Missing response indistinguishability timing budget nightly-v1.');
  return budget;
}

function minimizeFailingPrefix(samplesA, samplesB, budget) {
  let length = samplesA.length;
  while (length > 16) {
    const nextLength = Math.max(16, Math.floor(length / 2));
    const nextBudget = { ...budget, sampleSize: nextLength };
    const verdict = evaluateTimingBudget(
      samplesA.slice(0, nextLength),
      samplesB.slice(0, nextLength),
      nextBudget,
    );
    if (verdict.ok) break;
    length = nextLength;
  }
  const narrowedBudget = { ...budget, sampleSize: length };
  return {
    samplesA: samplesA.slice(0, length),
    samplesB: samplesB.slice(0, length),
    verdict: evaluateTimingBudget(
      samplesA.slice(0, length),
      samplesB.slice(0, length),
      narrowedBudget,
    ),
  };
}

async function duration(run) {
  const start = performance.now();
  await run();
  return performance.now() - start;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function validateSamples(samplesA, samplesB, expectedSize) {
  if (
    !Array.isArray(samplesA) ||
    !Array.isArray(samplesB) ||
    samplesA.length !== samplesB.length ||
    samplesA.length !== expectedSize ||
    samplesA.some((sample) => !Number.isFinite(sample) || sample < 0) ||
    samplesB.some((sample) => !Number.isFinite(sample) || sample < 0)
  ) {
    throw new TypeError('Timing oracle samples must be equal finite non-negative paired arrays.');
  }
}

function assertCount(value, label, minimum) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a finite integer >= ${minimum}.`);
  }
}

if (isMainEntry(import.meta.url)) {
  const replayIndex = process.argv.indexOf('--replay');
  if (replayIndex === -1 || typeof process.argv[replayIndex + 1] !== 'string') {
    process.stderr.write(
      'usage: response-indistinguishability-timing-oracle.mjs --replay <file>\n',
    );
    process.exitCode = 2;
  } else {
    const artifact = JSON.parse(readFileSync(process.argv[replayIndex + 1], 'utf8'));
    if (artifact.schema !== timingOracleSchema)
      throw new TypeError('Unknown timing artifact schema.');
    const budget = { ...artifact.budget, sampleSize: artifact.samplesA.length };
    const verdict = evaluateTimingBudget(artifact.samplesA, artifact.samplesB, budget);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exitCode = verdict.ok ? 0 : 1;
  }
}

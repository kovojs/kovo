#!/usr/bin/env node
/**
 * Verify that the CI shard plan is actually balanced, and that the timing history it was balanced
 * from is actually being refreshed (plans/good-perf.md O17, absorbed from the superseded
 * plans/fast-ci.md "update root Vitest timing history after every successful CI run and verify
 * shard balance").
 *
 * `scripts/ci-shards.mjs` already refuses a shard plan whose predicted wall time exceeds the job
 * budget. That is a ceiling, not a balance check: five shards of 8 / 8 / 8 / 8 / 40 minutes pass the
 * ceiling and still cost the pipeline 40 minutes. It is also blind to a timing history that has
 * quietly stopped being downloaded — every file then falls back to the 5-second default and the
 * "balanced" plan is really a file-count split.
 *
 * This gate consumes what the `test` job already produced: the shard manifests `ci-shards.mjs
 * generate` wrote for EVERY shard, and the combined timing history it balanced from.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT_VITEST_DURATION_FLOOR_SECONDS } from './ci-shards.mjs';

export const SHARD_BALANCE_SCHEMA = 'kovo-ci-shard-balance/v1';

/**
 * Predicted seconds for one manifest, plus how much of it the history actually covered.
 *
 * The reviewed duration FLOORS have to be applied exactly as `ci-shards.mjs balanceShards` applies
 * them, or this gate reports a different plan than the one CI will run: without them the eight
 * floored monoliths look like 5-second files and the heaviest shard reads as the lightest.
 */
export function shardPrediction(files, history, defaultSeconds, floors = {}) {
  let seconds = 0;
  let covered = 0;
  for (const file of files) {
    const entry = history[file];
    const value = Number(entry?.seconds ?? entry);
    const measured = Number.isFinite(value) && value > 0 ? value : defaultSeconds;
    if (Number.isFinite(value) && value > 0) covered += 1;
    seconds += Math.max(measured, Number(floors[file] ?? 0));
  }
  return { covered, fileCount: files.length, seconds: Math.round(seconds * 1000) / 1000 };
}

export function readShardManifests(manifestDir, kind) {
  const pattern = new RegExp(`^${kind}-(\\d+)-of-(\\d+)\\.txt$`, 'u');
  const manifests = [];
  for (const name of readdirSync(manifestDir).sort()) {
    const match = pattern.exec(name);
    if (match === null) continue;
    manifests.push({
      files: readFileSync(path.join(manifestDir, name), 'utf8')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
      index: Number(match[1]),
      name,
      total: Number(match[2]),
    });
  }
  manifests.sort((left, right) => left.index - right.index);
  return manifests;
}

export function analyzeShardBalance(manifests, history, options = {}) {
  const defaultSeconds = options.defaultSeconds ?? 5;
  const floors = options.floors ?? ROOT_VITEST_DURATION_FLOOR_SECONDS;
  const shards = manifests.map((manifest) => ({
    ...shardPrediction(manifest.files, history, defaultSeconds, floors),
    index: manifest.index,
    name: manifest.name,
  }));
  const seconds = shards.map((shard) => shard.seconds);
  const totalFiles = shards.reduce((total, shard) => total + shard.fileCount, 0);
  const coveredFiles = shards.reduce((total, shard) => total + shard.covered, 0);
  const slowest = Math.max(...seconds, 0);
  const fastest = Math.min(...seconds, Infinity);
  return {
    coverage: totalFiles === 0 ? 0 : coveredFiles / totalFiles,
    coveredFiles,
    fastestSeconds: Number.isFinite(fastest) ? fastest : 0,
    // Slowest shard divided by the mean: 1.0 is perfect, and it is the factor by which the whole
    // pipeline is slower than a perfectly balanced plan.
    imbalance:
      seconds.length === 0 || slowest === 0
        ? 1
        : slowest / (seconds.reduce((total, value) => total + value, 0) / seconds.length),
    schema: SHARD_BALANCE_SCHEMA,
    shardCount: shards.length,
    shards,
    slowestSeconds: slowest,
    totalFiles,
  };
}

export function formatShardBalance(analysis, thresholds) {
  const lines = [
    `shard plan: ${String(analysis.shardCount)} shards, ${String(analysis.totalFiles)} files`,
    `timing-history coverage: ${(analysis.coverage * 100).toFixed(1)}% (${String(
      analysis.coveredFiles,
    )}/${String(analysis.totalFiles)} files) — minimum ${(thresholds.minCoverage * 100).toFixed(0)}%`,
    `imbalance: ${analysis.imbalance.toFixed(3)} (slowest ${analysis.slowestSeconds.toFixed(
      1,
    )}s vs fastest ${analysis.fastestSeconds.toFixed(1)}s) — maximum ${thresholds.maxImbalance.toFixed(2)}`,
  ];
  for (const shard of analysis.shards) {
    lines.push(
      `  shard ${String(shard.index)}: ${shard.seconds.toFixed(1)}s over ${String(
        shard.fileCount,
      )} files (${String(shard.covered)} with history)`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function shardBalanceFindings(analysis, thresholds) {
  const findings = [];
  if (analysis.totalFiles === 0) findings.push('no shard manifests were found to verify');
  if (analysis.coverage < thresholds.minCoverage) {
    findings.push(
      `timing-history coverage ${(analysis.coverage * 100).toFixed(1)}% is below the ${(
        thresholds.minCoverage * 100
      ).toFixed(0)}% minimum: the shard plan is a file-count split, not a duration split`,
    );
  }
  if (analysis.imbalance > thresholds.maxImbalance) {
    findings.push(
      `slowest shard is ${analysis.imbalance.toFixed(2)}x the mean, above the ${thresholds.maxImbalance.toFixed(
        2,
      )} ceiling`,
    );
  }
  return findings;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    args[key] = next !== undefined && !next.startsWith('--') ? argv[++index] : true;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const manifestDir = path.resolve(String(args['manifest-dir'] ?? '.'));
  const kind = String(args.kind ?? 'vitest');
  const thresholds = {
    // Both defaults are what the current five-shard root Vitest plan already satisfies; they are
    // ceilings on erosion, not aspirations.
    maxImbalance: Number(args['max-imbalance'] ?? 1.35),
    minCoverage: Number(args['min-coverage'] ?? 0.6),
  };
  let history = {};
  if (typeof args.history === 'string') {
    try {
      history = JSON.parse(readFileSync(path.resolve(args.history), 'utf8'));
    } catch (error) {
      process.stdout.write(
        `timing history ${args.history} is unreadable (${
          error instanceof Error ? error.message : String(error)
        }); treating coverage as zero\n`,
      );
    }
  }
  const analysis = analyzeShardBalance(readShardManifests(manifestDir, kind), history, {
    defaultSeconds: Number(args['default-seconds'] ?? 5),
  });
  process.stdout.write(formatShardBalance(analysis, thresholds));
  const findings = shardBalanceFindings(analysis, thresholds);
  for (const finding of findings) process.stdout.write(`::warning::shard balance: ${finding}\n`);
  if (args.strict === true && findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}

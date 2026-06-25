#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ROOTS = {
  integration: ['tests/integration/specs'],
  vitest: ['scripts', 'tests', 'packages'],
};

const DEFAULT_HISTORY_NAME = 'timing-history.json';
const DEFAULT_DURATION_SECONDS = 5;

export function percentile(values, ratio) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function unknownDurationSeconds(history, fallback = DEFAULT_DURATION_SECONDS) {
  const durations = Object.values(history ?? {}).map((entry) => Number(entry?.seconds ?? entry));
  return percentile(durations, 0.75) ?? percentile(durations, 0.5) ?? fallback;
}

export function balanceShards(files, history = {}, shardCount, options = {}) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, received ${String(shardCount)}`);
  }
  const defaultDuration = options.defaultDurationSeconds ?? unknownDurationSeconds(history);
  const estimates = [...files]
    .sort((a, b) => {
      const durationDelta =
        estimateSeconds(history, b, defaultDuration) - estimateSeconds(history, a, defaultDuration);
      return durationDelta || a.localeCompare(b);
    })
    .map((file) => ({ file, seconds: estimateSeconds(history, file, defaultDuration) }));
  const shards = Array.from({ length: shardCount }, () => ({ files: [], seconds: 0 }));

  for (const estimate of estimates) {
    const lightest = shards
      .map((shard, index) => ({ index, seconds: shard.seconds }))
      .sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
    const shard = shards[lightest.index];
    shard.files.push(estimate.file);
    shard.seconds += estimate.seconds;
  }

  for (const shard of shards) {
    shard.files.sort((a, b) => a.localeCompare(b));
    shard.seconds = Math.round(shard.seconds * 1000) / 1000;
  }
  validateShardAssignment(files, shards);
  return shards;
}

export function validateShardAssignment(discoveredFiles, shards) {
  const expected = new Set(discoveredFiles);
  const seen = new Map();
  for (const shard of shards) {
    for (const file of shard.files) {
      if (!expected.has(file)) {
        throw new Error(`Shard assigned undiscovered test file: ${file}`);
      }
      seen.set(file, (seen.get(file) ?? 0) + 1);
    }
  }
  const missing = [...expected].filter((file) => !seen.has(file));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([file]) => file);
  if (missing.length > 0 || duplicated.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (duplicated.length > 0) parts.push(`duplicated: ${duplicated.join(', ')}`);
    throw new Error(`Invalid shard assignment (${parts.join('; ')})`);
  }
}

export function mergeDurationHistory(previous = {}, latest = {}, options = {}) {
  const previousWeight = options.previousWeight ?? 0.7;
  const latestWeight = options.latestWeight ?? 0.3;
  const merged = {};
  for (const [key, value] of Object.entries(previous)) {
    const seconds = Number(value?.seconds ?? value);
    if (Number.isFinite(seconds) && seconds > 0) merged[key] = { seconds };
  }
  for (const [key, value] of Object.entries(latest)) {
    const latestSeconds = Number(value?.seconds ?? value);
    if (!Number.isFinite(latestSeconds) || latestSeconds <= 0) continue;
    const previousSeconds = merged[key]?.seconds;
    merged[key] = {
      seconds:
        previousSeconds === undefined
          ? roundSeconds(latestSeconds)
          : roundSeconds(previousSeconds * previousWeight + latestSeconds * latestWeight),
    };
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

export async function discoverTests(kind, options = {}) {
  const roots = options.roots ?? DEFAULT_ROOTS[kind];
  if (!roots) throw new Error(`Unknown shard kind: ${kind}`);
  const files = [];
  for (const root of roots) {
    files.push(...(await discoverFromRoot(root, kind)));
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function extractVitestDurations(report) {
  const durations = {};
  visit(report, (node) => {
    const file = normalizeRelativeFile(node?.filepath ?? node?.file?.filepath ?? node?.file);
    const durationMs = Number(node?.duration ?? node?.time ?? node?.perfStats?.runtime);
    if (!file || !Number.isFinite(durationMs) || durationMs <= 0) return;
    durations[file] = {
      seconds: roundSeconds(Math.max(durations[file]?.seconds ?? 0, durationMs / 1000)),
    };
  });
  return durations;
}

export function extractPlaywrightDurations(report) {
  const durations = {};
  visit(report, (node) => {
    const file = normalizeRelativeFile(node?.location?.file ?? node?.file);
    const project = node?.projectName ?? node?.project?.name ?? node?.project;
    const durationMs = Number(node?.duration);
    if (!file || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const key = project ? `${project}:${file}` : file;
    durations[key] = { seconds: roundSeconds((durations[key]?.seconds ?? 0) + durationMs / 1000) };
  });
  return durations;
}

export async function writeShardManifests({
  kind,
  shardCount,
  shardIndex,
  historyPath,
  outputDir,
}) {
  const files = await discoverTests(kind);
  const history = await readJsonIfExists(historyPath);
  const shards = balanceShards(files, history, shardCount);
  const root = outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-shards');
  assertRunnerTempScoped(root);
  await mkdir(root, { recursive: true });
  for (let index = 0; index < shards.length; index += 1) {
    const file = path.join(root, `${kind}-${index + 1}-of-${shards.length}.txt`);
    await writeFile(file, `${shards[index].files.join('\n')}\n`);
  }
  const selected = shards[shardIndex - 1];
  if (!selected) throw new Error(`Shard index ${shardIndex} is outside 1..${shards.length}`);
  const selectedPath = path.join(root, `${kind}-${shardIndex}-of-${shards.length}.txt`);
  return { files, selectedPath, selected, shards };
}

function estimateSeconds(history, file, fallback) {
  const exact = Number(history?.[file]?.seconds ?? history?.[file]);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const suffixMatch = Object.entries(history ?? {}).find(([key]) => key.endsWith(`:${file}`));
  const suffixSeconds = Number(suffixMatch?.[1]?.seconds ?? suffixMatch?.[1]);
  return Number.isFinite(suffixSeconds) && suffixSeconds > 0 ? suffixSeconds : fallback;
}

async function discoverFromRoot(root, kind) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = normalizeRelativeFile(full);
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(relative)) continue;
        await walk(full);
        continue;
      }
      if (kind === 'integration' && /(?:^|\/)[^/]+\.spec\.ts$/.test(relative)) files.push(relative);
      if (
        kind === 'vitest' &&
        /(?:^|\/)[^/]+\.test\.(?:mjs|ts|tsx|js)$/.test(relative) &&
        includeVitest(relative)
      ) {
        files.push(relative);
      }
    }
  }
  await walk(root);
  return files;
}

function includeVitest(file) {
  return (
    !file.startsWith('tests/integration/') &&
    !file.startsWith('conformance/') &&
    !file.endsWith('.browser.test.ts') &&
    !file.includes('/templates/')
  );
}

function shouldSkipDirectory(file) {
  return /(?:^|\/)(?:node_modules|dist|coverage|\.git|\.playwright|\.kovo)(?:\/|$)/.test(file);
}

function normalizeRelativeFile(file) {
  if (!file || typeof file !== 'string') return '';
  const normalized = path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
  return normalized.startsWith('..') ? file.replaceAll('\\', '/') : normalized;
}

function visit(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  for (const item of Object.values(value)) visit(item, fn);
}

async function readJsonIfExists(file) {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertRunnerTempScoped(outputDir) {
  if (!process.env.CI) return;
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required in CI');
  const relative = path.relative(path.resolve(runnerTemp), path.resolve(outputDir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Shard manifests must be written under RUNNER_TEMP; received ${outputDir}`);
  }
}

function roundSeconds(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function durationHistoryEntries(report) {
  if (!report || Array.isArray(report) || typeof report !== 'object') return undefined;
  const entries = Object.entries(report);
  if (entries.length === 0) return undefined;
  const durations = {};
  for (const [key, value] of entries) {
    const seconds = Number(value?.seconds ?? value);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    durations[key] = { seconds };
  }
  return durations;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._ = [...(args._ ?? []), arg];
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === 'generate') {
    const kind = String(args.kind ?? 'vitest');
    const shardCount = Number(args.shards);
    const shardIndex = Number(args.index);
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-shards'),
    );
    const historyPath = String(args.history ?? path.join(outputDir, DEFAULT_HISTORY_NAME));
    const result = await writeShardManifests({
      kind,
      shardCount,
      shardIndex,
      historyPath,
      outputDir,
    });
    process.stdout.write(`${result.selectedPath}\n`);
    process.stderr.write(
      `Generated ${kind} shard ${shardIndex}/${shardCount}: ${result.selected.files.length}/${result.files.length} files, estimate ${result.selected.seconds}s\n`,
    );
    return;
  }

  if (command === 'merge-vitest' || command === 'merge-playwright') {
    const previous = await readJsonIfExists(args.previous);
    const report = await readJsonIfExists(args.report);
    const latest =
      command === 'merge-vitest'
        ? extractVitestDurations(report)
        : (durationHistoryEntries(report) ?? extractPlaywrightDurations(report));
    await writeJson(String(args.out), mergeDurationHistory(previous, latest));
    return;
  }

  throw new Error(`Usage:
  node scripts/ci-shards.mjs generate --kind vitest|integration --shards N --index N --outDir "$RUNNER_TEMP/kovo-shards" [--history file]
  node scripts/ci-shards.mjs merge-vitest --report vitest.json --out timing-history.json [--previous timing-history.json]
  node scripts/ci-shards.mjs merge-playwright --report playwright.json --out timing-history.json [--previous timing-history.json]`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}

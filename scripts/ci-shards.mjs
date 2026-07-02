#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { collectFilesAsync } from './lib/source-files.mjs';

const DEFAULT_ROOTS = {
  integration: ['tests/integration/specs'],
  vitest: ['scripts', 'tests', 'packages'],
};

const DEFAULT_HISTORY_NAME = 'timing-history.json';
const DEFAULT_DURATION_SECONDS = 5;
const STARTER_SHARD_COUNT = 8;
const PACKED_STARTER_MANIFEST = 'packed-kovo-packages.json';
const PACKED_WORKSPACE_PACKAGES = [
  { name: '@kovojs/core', dir: 'core' },
  { name: '@kovojs/style', dir: 'style' },
  { name: '@kovojs/browser', dir: 'browser' },
  { name: '@kovojs/server', dir: 'server' },
  { name: '@kovojs/drizzle', dir: 'drizzle' },
  { name: '@kovojs/headless-ui', dir: 'headless-ui' },
  { name: '@kovojs/icons', dir: 'icons' },
  { name: '@kovojs/ui', dir: 'ui' },
  { name: '@kovojs/better-auth', dir: 'better-auth' },
  { name: '@kovojs/compiler', dir: 'compiler' },
  { name: '@kovojs/cli', dir: 'cli' },
  { name: 'create-kovo', dir: 'create-kovo' },
];
const CONSOLIDATED_VITEST_FILES = new Set([
  'packages/cli/src/index.kovo-compile.test.ts',
  'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts',
  'packages/core/src/diagnostics.test.ts',
  'packages/core/src/sql-safety.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.assets.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.defer.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
  'packages/create-kovo/src/index.build.runtime.test.ts',
  'packages/create-kovo/src/index.build.scaffold.packed-postgres.test.ts',
  'packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts',
  'packages/create-kovo/src/index.build.scaffold.packed-sqlite.test.ts',
  'packages/create-kovo/src/index.build.scaffold.production.test.ts',
  'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
  'packages/create-kovo/src/index.build.scaffold.typecheck.test.ts',
  'packages/drizzle/src/runtime-surface.test.ts',
  'packages/drizzle/src/sql-safety-static.test.ts',
  'packages/server/src/guards.test.ts',
  'packages/test/src/pglite-harness.test.ts',
  'packages/test/src/query-verifier.test.ts',
  'packages/test/src/sqlite-harness.test.ts',
  'packages/test/src/verifier-sql.test.ts',
]);

const STARTER_ENTRIES = [
  {
    id: 'contacts-add-contact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'non-empty enhanced add-contact',
    seconds: 70,
  },
  {
    id: 'contacts-sqlite-add-contact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'generated SQLite add-contact',
    seconds: 67,
  },
  {
    id: 'contacts-multi-component-refresh',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'multi-component modules',
    seconds: 73,
  },
  {
    id: 'contacts-idempotency-collisions',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'idempotency token collisions',
    seconds: 70,
  },
  {
    id: 'security-auth-helper',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'Better Auth credential laundering',
    seconds: 147,
  },
  {
    id: 'security-raw-html-helper-imports',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'raw-HTML helper imports',
    seconds: 44,
  },
  {
    id: 'security-query-loader-storage-writes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'storage writes from query loaders',
    seconds: 72,
  },
  {
    id: 'security-mutation-storage-writes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'declared mutation storage writes',
    seconds: 74,
  },
  {
    id: 'security-trusted-output-provenance',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'trusted output provenance leaks',
    seconds: 77,
  },
  {
    id: 'security-trusted-url-attributes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'TrustedUrl values in non-URL JSX attributes',
    seconds: 65,
  },
  {
    id: 'security-runtime-wires',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'escaped runtime security wires',
    seconds: 143,
  },
  {
    id: 'security-form-error',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'FormError',
    seconds: 77,
  },
  {
    id: 'm1-storage-write',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:storage-write',
    seconds: 210,
  },
  {
    id: 'm1-raw-html',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:raw-html',
    seconds: 151,
  },
  {
    id: 'm1-secret-wire',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:secret-wire',
    seconds: 151,
  },
  {
    id: 'm1-raw-sql',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:raw-sql',
    seconds: 146,
  },
  {
    id: 'm1-output-wire',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:output-wire',
    seconds: 148,
  },
  {
    id: 'raw-sql-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
    seconds: 70,
  },
  {
    id: 'starter-typecheck',
    file: 'packages/create-kovo/src/index.build.scaffold.typecheck.test.ts',
    seconds: 49,
  },
  {
    id: 'asset-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.assets.test.ts',
    seconds: 74,
  },
  {
    id: 'runtime-dev-server',
    file: 'packages/create-kovo/src/index.build.runtime.test.ts',
    seconds: 262,
  },
  {
    id: 'starter-sqlite',
    file: 'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
    seconds: 101,
  },
  {
    id: 'starter-production',
    file: 'packages/create-kovo/src/index.build.scaffold.production.test.ts',
    seconds: 209,
  },
  {
    id: 'starter-packed-postgres',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-postgres.test.ts',
    needsPacked: true,
    seconds: 7,
  },
  {
    id: 'durable-task-retries',
    file: 'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts',
    seconds: 90,
  },
  {
    id: 'starter-packed-sqlite',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-sqlite.test.ts',
    needsPacked: true,
    seconds: 7,
  },
  {
    id: 'transaction-default-served-artifact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'rolls back default mutation transactions and executes webhooks',
    seconds: 78,
  },
  {
    id: 'transaction-managed-write-escape-default',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'managed write raw-driver escapes before default',
    seconds: 70,
  },
  {
    id: 'transaction-managed-write-escape-sqlite',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'managed write raw-driver escapes before SQLite',
    seconds: 70,
  },
  {
    id: 'transaction-sqlite-served-artifact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'SQLite readonly handles isolated and executes webhook transactions',
    seconds: 71,
  },
  {
    id: 'transaction-webhook-escape-default',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'default webhook transaction raw-driver escapes',
    seconds: 70,
  },
  {
    id: 'transaction-webhook-escape-sqlite',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'SQLite webhook transaction raw-driver escapes',
    seconds: 70,
  },
  {
    id: 'starter-packed-runtime',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts',
    needsPacked: true,
    seconds: 69,
  },
  {
    id: 'runtime-contract-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts',
    seconds: 70,
  },
  {
    id: 'durable-task-lifecycle',
    file: 'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts',
    seconds: 85,
  },
  {
    id: 'defer-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.defer.test.ts',
    seconds: 139,
  },
  {
    id: 'header-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
    seconds: 78,
  },
  {
    id: 'redirect-capability-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
    seconds: 73,
  },
  {
    id: 'island-derive-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    seconds: 143,
    needsBrowser: true,
  },
];

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

export function starterEntries() {
  return STARTER_ENTRIES.map((entry) => ({ ...entry }));
}

export function starterEntriesForMode(mode = 'all') {
  const entries = starterEntries();
  if (mode === 'all') return entries;
  if (mode === 'packed') return entries.filter((entry) => entry.needsPacked);
  if (mode === 'unpacked') return entries.filter((entry) => !entry.needsPacked);
  throw new Error(`Unknown starter mode: ${mode}`);
}

export function balanceStarterShards(shardCount = STARTER_SHARD_COUNT, entries = starterEntries()) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, received ${String(shardCount)}`);
  }
  const estimates = [...entries]
    .sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id))
    .map((entry) => ({ ...entry }));
  const shards = Array.from({ length: shardCount }, () => ({ entries: [], seconds: 0 }));

  for (const estimate of estimates) {
    const lightest = shards
      .map((shard, index) => ({ index, seconds: shard.seconds }))
      .sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
    const shard = shards[lightest.index];
    shard.entries.push(estimate);
    shard.seconds += estimate.seconds;
  }

  for (const shard of shards) {
    shard.entries.sort((a, b) => a.id.localeCompare(b.id));
    shard.seconds = roundSeconds(shard.seconds);
  }
  validateStarterShardAssignment(entries, shards);
  return shards;
}

export function validateStarterShardAssignment(entries, shards) {
  const expected = new Set(entries.map((entry) => entry.id));
  const seen = new Map();
  for (const shard of shards) {
    for (const entry of shard.entries) {
      if (!expected.has(entry.id))
        throw new Error(`Starter shard assigned unknown entry: ${entry.id}`);
      seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
    }
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  if (missing.length > 0 || duplicated.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (duplicated.length > 0) parts.push(`duplicated: ${duplicated.join(', ')}`);
    throw new Error(`Invalid starter shard assignment (${parts.join('; ')})`);
  }
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
    const file = normalizeRelativeFile(
      node?.filepath ?? node?.file?.filepath ?? node?.file ?? node?.name,
    );
    const assertionDurationMs = Array.isArray(node?.assertionResults)
      ? node.assertionResults.reduce((total, assertion) => {
          const duration = Number(assertion?.duration);
          return Number.isFinite(duration) && duration > 0 ? total + duration : total;
        }, 0)
      : undefined;
    const durationMs = Number(
      node?.duration ??
        node?.time ??
        node?.perfStats?.runtime ??
        (assertionDurationMs && assertionDurationMs > 0 ? assertionDurationMs : undefined) ??
        (Number.isFinite(Number(node?.endTime)) && Number.isFinite(Number(node?.startTime))
          ? Number(node.endTime) - Number(node.startTime)
          : undefined),
    );
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

export async function writeStarterShardManifest({
  shardCount,
  shardIndex,
  outputDir,
  mode = 'all',
}) {
  const entries = starterEntriesForMode(mode);
  const shards = balanceStarterShards(shardCount, entries);
  const root =
    outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-starter-shards');
  assertRunnerTempScoped(root);
  await mkdir(root, { recursive: true });
  for (let index = 0; index < shards.length; index += 1) {
    const file = path.join(
      root,
      starterManifestName({ mode, index: index + 1, count: shards.length }),
    );
    await writeJson(file, {
      kind: 'starter',
      mode,
      shardIndex: index + 1,
      shardCount: shards.length,
      seconds: shards[index].seconds,
      entries: shards[index].entries,
    });
  }
  const selected = shards[shardIndex - 1];
  if (!selected) throw new Error(`Shard index ${shardIndex} is outside 1..${shards.length}`);
  const selectedPath = path.join(
    root,
    starterManifestName({ mode, index: shardIndex, count: shards.length }),
  );
  return { entries, mode, selectedPath, selected, shards };
}

export async function readStarterShardManifest(file) {
  const manifest = await readJsonIfExists(file);
  if (manifest?.kind !== 'starter' || !Array.isArray(manifest.entries)) {
    throw new Error(`Invalid starter shard manifest: ${file}`);
  }
  return manifest;
}

export async function starterShardNeedsBrowser(file) {
  const manifest = await readStarterShardManifest(file);
  return manifest.entries.some((entry) => entry.needsBrowser);
}

export async function starterShardNeedsPacked(file) {
  const manifest = await readStarterShardManifest(file);
  return manifest.entries.some((entry) => entry.needsPacked);
}

export async function runStarterShard(file) {
  const manifest = await readStarterShardManifest(file);
  for (const group of groupStarterEntriesForExecution(manifest.entries)) {
    const args = starterGroupVitestArgs(group);
    process.stderr.write(
      `\n[starter:${group.map((entry) => entry.id).join(',')}] vp ${args.join(' ')}\n`,
    );
    const result = spawnSync('vp', args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Starter entries ${group.map((entry) => entry.id).join(', ')} failed with exit code ${result.status}`,
      );
    }
  }
}

export async function packStarterPackages(outputDir) {
  const root = path.resolve(
    outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-packed-starter'),
  );
  assertRunnerTempScoped(root);
  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
  const tarballs = {};

  for (const pkg of PACKED_WORKSPACE_PACKAGES) {
    const packageRoot = path.join(process.cwd(), 'packages', pkg.dir);
    const before = new Set((await readdir(root)).filter((file) => file.endsWith('.tgz')));
    const result = spawnSync('vp', ['exec', 'pnpm', 'pack', '--pack-destination', root], {
      cwd: packageRoot,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`vp exec pnpm pack failed for ${pkg.name}`);
    const created = (await readdir(root))
      .filter((file) => file.endsWith('.tgz') && !before.has(file))
      .sort();
    if (created.length !== 1) {
      throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}.`);
    }
    tarballs[pkg.name] = created[0];
  }

  await writeJson(path.join(root, PACKED_STARTER_MANIFEST), {
    generatedBy: 'scripts/ci-shards.mjs pack-starter',
    tarballs,
  });
  return root;
}

export function groupStarterEntriesForExecution(entries) {
  const groupsByFile = new Map();
  for (const entry of entries) {
    const group = groupsByFile.get(entry.file) ?? [];
    group.push(entry);
    groupsByFile.set(entry.file, group);
  }
  return [...groupsByFile.values()].map((group) => group.sort((a, b) => a.id.localeCompare(b.id)));
}

export function starterGroupVitestArgs(group) {
  if (group.length === 0) throw new Error('Starter execution group cannot be empty.');
  const [first] = group;
  const args = ['exec', 'vitest', '--run', first.file];
  if (group.every((entry) => entry.testName)) {
    args.push('-t', starterTestNamePattern(group.map((entry) => entry.testName)));
  }
  return args;
}

function starterTestNamePattern(testNames) {
  if (testNames.length === 1) return testNames[0];
  return testNames.map(escapeRegExp).join('|');
}

function starterManifestName({ mode, index, count }) {
  const modePrefix = mode === 'all' ? 'starter' : `starter-${mode}`;
  return `${modePrefix}-${index}-of-${count}.json`;
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function estimateSeconds(history, file, fallback) {
  const exact = Number(history?.[file]?.seconds ?? history?.[file]);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const suffixMatch = Object.entries(history ?? {}).find(([key]) => key.endsWith(`:${file}`));
  const suffixSeconds = Number(suffixMatch?.[1]?.seconds ?? suffixMatch?.[1]);
  return Number.isFinite(suffixSeconds) && suffixSeconds > 0 ? suffixSeconds : fallback;
}

async function discoverFromRoot(root, kind) {
  return (
    await collectFilesAsync(path.resolve(root), ['.'], {
      absolute: true,
      includeFile: ({ absolutePath }) => {
        const relativePath = normalizeRelativeFile(absolutePath);
        if (kind === 'integration') return /(?:^|\/)[^/]+\.spec\.ts$/.test(relativePath);
        return (
          kind === 'vitest' &&
          /(?:^|\/)[^/]+\.test\.(?:mjs|ts|tsx|js)$/.test(relativePath) &&
          includeVitest(relativePath)
        );
      },
      skipDirectory: ({ relativePath }) => shouldSkipDirectory(normalizeRelativeFile(relativePath)),
    })
  ).map((file) => normalizeRelativeFile(file));
}

export function includeVitest(file) {
  return (
    !file.startsWith('tests/integration/') &&
    !file.startsWith('conformance/') &&
    !file.endsWith('.browser.test.ts') &&
    !file.includes('/templates/') &&
    !CONSOLIDATED_VITEST_FILES.has(file)
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

  if (command === 'generate-starter') {
    const shardCount = Number(args.shards ?? STARTER_SHARD_COUNT);
    const shardIndex = Number(args.index);
    const mode = String(args.mode ?? 'all');
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-starter-shards'),
    );
    const result = await writeStarterShardManifest({ shardCount, shardIndex, outputDir, mode });
    process.stdout.write(`${result.selectedPath}\n`);
    process.stderr.write(
      `Generated starter ${result.mode} shard ${shardIndex}/${shardCount}: ${result.selected.entries.length}/${result.entries.length} entries, estimate ${result.selected.seconds}s\n`,
    );
    return;
  }

  if (command === 'starter-needs-browser') {
    process.exitCode = (await starterShardNeedsBrowser(String(args.manifest))) ? 0 : 1;
    return;
  }

  if (command === 'starter-needs-packed') {
    process.exitCode = (await starterShardNeedsPacked(String(args.manifest))) ? 0 : 1;
    return;
  }

  if (command === 'pack-starter') {
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-packed-starter'),
    );
    const packedDir = await packStarterPackages(outputDir);
    process.stdout.write(`${packedDir}\n`);
    return;
  }

  if (command === 'run-starter') {
    await runStarterShard(String(args.manifest));
    return;
  }

  if (command === 'merge-vitest' || command === 'merge-playwright') {
    const previous = await readJsonIfExists(args.previous);
    const report = await readJsonIfExists(args.report);
    const latest =
      command === 'merge-vitest'
        ? extractVitestDurations(report)
        : (durationHistoryEntries(report) ?? extractPlaywrightDurations(report));
    if (Object.keys(latest).length === 0) {
      throw new Error(`${command} did not find any duration entries in ${String(args.report)}`);
    }
    await writeJson(String(args.out), mergeDurationHistory(previous, latest));
    return;
  }

  throw new Error(`Usage:
  node scripts/ci-shards.mjs generate --kind vitest|integration --shards N --index N --outDir "$RUNNER_TEMP/kovo-shards" [--history file]
  node scripts/ci-shards.mjs generate-starter --mode all|packed|unpacked --shards N --index N --outDir "$RUNNER_TEMP/kovo-starter-shards"
  node scripts/ci-shards.mjs starter-needs-browser --manifest starter-shard.json
  node scripts/ci-shards.mjs starter-needs-packed --manifest starter-shard.json
  node scripts/ci-shards.mjs pack-starter --outDir "$RUNNER_TEMP/kovo-packed-starter"
  node scripts/ci-shards.mjs run-starter --manifest starter-shard.json
  node scripts/ci-shards.mjs merge-vitest --report vitest.json --out timing-history.json [--previous timing-history.json]
  node scripts/ci-shards.mjs merge-playwright --report playwright.json --out timing-history.json [--previous timing-history.json]`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}

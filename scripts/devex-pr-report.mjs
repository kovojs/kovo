#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decodeAgentDocsSnapshot, writeAgentDocsSnapshot } from './agent-docs-snapshot.mjs';
import { DEVEX_BENCHMARK_REPORT_SCHEMA, median } from './devex-benchmark.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { buildPublicApiInventory } from './public-api-inventory.mjs';
import { repoRoot } from './release-packages.mjs';

export const DEVEX_PR_REPORT_SCHEMA = 'kovo-devex-pr-report/v1';

const SPEED_METRICS = Object.freeze([
  'check.cold.durationMs',
  'check.warm.durationMs',
  'check.oneFileIncremental.durationMs',
  'dev.ready.cold.durationMs',
  'dev.ready.warm.durationMs',
  'dev.editToDiagnostic.durationMs',
  'dev.editToServedResult.durationMs',
]);

export function buildDevexPrReport({
  baselineBenchmark = null,
  budgets,
  currentBenchmark = null,
  freshDocs,
  installedDocs = null,
  inventory,
} = {}) {
  const docs = docsFreshness(freshDocs, installedDocs);
  const publicSurface = {
    findings: inventory.findings,
    ...inventory.summary,
  };
  const speed = speedDeltas(currentBenchmark, baselineBenchmark, budgets);
  return {
    schema: DEVEX_PR_REPORT_SCHEMA,
    publicSurface,
    docs,
    speed,
    pass: inventory.findings.length === 0 && docs.status !== 'stale',
  };
}

export function docsFreshness(fresh, installed) {
  if (!fresh?.snapshot || !Buffer.isBuffer(fresh.compressed)) {
    throw new TypeError('fresh docs snapshot evidence is required');
  }
  const installedBytes = fresh.snapshot.files.reduce((total, file) => total + file.bytes, 0);
  if (installed === null) {
    return {
      status: 'unavailable',
      reason: 'No installed packed snapshot was supplied for comparison.',
      snapshotDigest: fresh.snapshot.snapshotDigest,
      publicManifestDigest: fresh.snapshot.publicManifestDigest,
      sourceCommit: fresh.snapshot.sourceCommit,
      files: fresh.snapshot.files.length,
      compressedBytes: fresh.compressed.byteLength,
      installedBytes,
    };
  }
  const current =
    installed.snapshotDigest === fresh.snapshot.snapshotDigest &&
    installed.publicManifestDigest === fresh.snapshot.publicManifestDigest &&
    installed.sourceCommit === fresh.snapshot.sourceCommit &&
    installed.version === fresh.snapshot.version;
  return {
    status: current ? 'current' : 'stale',
    ...(current
      ? {}
      : {
          reason:
            'The installed CLI snapshot does not match the docs, public manifest, version, and source commit at this revision.',
          installedSnapshotDigest: installed.snapshotDigest,
        }),
    snapshotDigest: fresh.snapshot.snapshotDigest,
    publicManifestDigest: fresh.snapshot.publicManifestDigest,
    sourceCommit: fresh.snapshot.sourceCommit,
    files: fresh.snapshot.files.length,
    compressedBytes: fresh.compressed.byteLength,
    installedBytes,
  };
}

export function speedDeltas(current, baseline, budgets) {
  if (current === null) {
    return {
      status: 'unavailable',
      comparison: 'none',
      reason: 'The current revision did not produce a benchmark report.',
      metrics: [],
    };
  }
  const statisticalBaseline =
    baseline?.schema === DEVEX_BENCHMARK_REPORT_SCHEMA &&
    Number.isSafeInteger(baseline.sampleCount) &&
    baseline.sampleCount >= (budgets?.procedure?.minimumStatisticalSamples ?? 5);
  const ratifiedBaseline =
    statisticalBaseline &&
    budgets?.runner?.status === 'ratified' &&
    budgets?.workload?.status === 'ratified' &&
    sameJson(baseline.runner, budgets.runner.fingerprint) &&
    sameJson(benchmarkWorkloadIdentity(baseline), budgets.workload.identity);
  const baselineKind = ratifiedBaseline ? 'ratified-baseline' : 'nightly-candidate';
  const metrics = [];
  for (const metricId of SPEED_METRICS) {
    const samples = current.metrics?.[metricId]?.samples;
    if (!validSamples(samples)) continue;
    const currentValue = median(samples);
    const baselineSamples = statisticalBaseline ? baseline.metrics?.[metricId]?.samples : null;
    const provisionalTarget = budgets?.metrics?.[metricId]?.provisionalTarget;
    const reference = validSamples(baselineSamples)
      ? { kind: baselineKind, value: median(baselineSamples) }
      : Number.isFinite(provisionalTarget)
        ? { kind: 'provisional-target', value: provisionalTarget }
        : null;
    metrics.push({
      metric: metricId,
      current: currentValue,
      unit: 'ms',
      ...(reference === null
        ? { reference: null, delta: null, deltaPercent: null }
        : {
            reference,
            delta: currentValue - reference.value,
            deltaPercent:
              reference.value === 0
                ? null
                : ((currentValue - reference.value) / reference.value) * 100,
          }),
    });
  }
  const comparison = statisticalBaseline
    ? baselineKind
    : metrics.some((metric) => metric.reference?.kind === 'provisional-target')
      ? 'provisional-target'
      : 'none';
  return {
    status: metrics.length > 0 ? 'reported' : 'unavailable',
    comparison,
    ...(statisticalBaseline
      ? {
          baselineRunner: baseline.runner,
          baselineSampleCount: baseline.sampleCount,
          ...(!ratifiedBaseline
            ? {
                reason:
                  'The latest five-sample nightly report is a comparison candidate, not an exact runner-and-workload binding ratification.',
              }
            : {}),
        }
      : {
          reason:
            comparison === 'provisional-target'
              ? 'No accepted baseline was available; deltas use explicitly non-binding provisional targets.'
              : 'No accepted baseline or provisional targets were available.',
        }),
    currentRunner: current.runner,
    currentSampleCount: current.sampleCount,
    metrics,
  };
}

export function renderDevexPrReport(report) {
  const surface = report.publicSurface;
  const lines = [
    '## Kovo DevEx scorecard',
    '',
    `Overall: **${report.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '| Signal | Status | Evidence |',
    '| --- | --- | --- |',
    `| Public surface | ${surface.findings.length === 0 ? 'current' : 'findings'} | ${formatInteger(surface.manifestPublicSubpaths)} subpaths · ${formatInteger(surface.analyzedTypeScriptEntrypoints)} TS entrypoints · ${formatInteger(surface.exportedDeclarations)} declarations · ${formatInteger(surface.generatedFamilyMembers)} generated members |`,
    `| Agent docs | ${report.docs.status} | ${report.docs.files} files · ${formatBytes(report.docs.compressedBytes)} compressed · ${formatBytes(report.docs.installedBytes)} installed |`,
    `| Speed | ${report.speed.status} | ${report.speed.currentSampleCount ?? 0} current sample(s) · comparison=${report.speed.comparison} |`,
  ];
  if (report.docs.reason) lines.push('', `Docs: ${report.docs.reason}`);
  if (report.speed.reason) lines.push('', `Speed: ${report.speed.reason}`);
  if (report.speed.metrics.length > 0) {
    lines.push(
      '',
      '| Speed metric | Current | Reference | Delta |',
      '| --- | ---: | ---: | ---: |',
    );
    for (const metric of report.speed.metrics) {
      lines.push(
        `| \`${metric.metric}\` | ${formatMs(metric.current)} | ${
          metric.reference === null
            ? '—'
            : `${formatMs(metric.reference.value)} (${metric.reference.kind})`
        } | ${metric.deltaPercent === null ? '—' : formatPercent(metric.deltaPercent)} |`,
      );
    }
  }
  if (surface.findings.length > 0) {
    lines.push('', ...surface.findings.slice(0, 20).map((finding) => `- ${finding}`));
  }
  return `${lines.join('\n')}\n`;
}

async function runDevexPrReport(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const inventory = buildPublicApiInventory({ repoRoot });
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-devex-pr-docs-'));
  try {
    const freshOutput = path.join(temporaryRoot, 'fresh.snapshot.json.gz');
    await writeAgentDocsSnapshot({ output: freshOutput, root: repoRoot });
    const compressed = readFileSync(freshOutput);
    const freshDocs = {
      compressed,
      snapshot: decodeAgentDocsSnapshot(compressed),
    };
    let installedDocs = null;
    if (options.installedDocs) {
      installedDocs = decodeAgentDocsSnapshot(readFileSync(options.installedDocs));
    }
    const report = buildDevexPrReport({
      baselineBenchmark: readOptionalJson(options.baseline),
      budgets: JSON.parse(readFileSync(options.budgets, 'utf8')),
      currentBenchmark: readOptionalJson(options.benchmark),
      freshDocs,
      installedDocs,
      inventory,
    });
    if (options.requireInstalledDocs && installedDocs === null) {
      report.pass = false;
    }
    if (options.requireBenchmark && report.speed.status !== 'reported') {
      report.pass = false;
    }
    const markdown = renderDevexPrReport(report);
    writeOutput(options.json, `${JSON.stringify(report, null, 2)}\n`);
    writeOutput(options.markdown, markdown);
    if (options.githubSummary) appendFileSync(options.githubSummary, markdown);
    process.stdout.write(markdown);
    return report.pass ? 0 : 1;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {
    budgets: path.join(repoRoot, 'devex-budgets.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--require-benchmark') options.requireBenchmark = true;
    else if (token === '--require-installed-docs') options.requireInstalledDocs = true;
    else if (
      [
        '--baseline',
        '--benchmark',
        '--budgets',
        '--github-summary',
        '--installed-docs',
        '--json',
        '--markdown',
      ].includes(token)
    ) {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error(`${token} requires a value`);
      const key = token.slice(2).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
      options[key] = path.resolve(value);
    } else {
      throw new Error(`unknown DevEx PR report option ${token}`);
    }
  }
  return options;
}

function benchmarkWorkloadIdentity(report) {
  return {
    scenario: {
      name: report?.scenario?.name,
      digest: report?.scenario?.digest,
    },
    provenance: report?.provenance,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readOptionalJson(file) {
  return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

function writeOutput(file, contents) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function validSamples(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((sample) => Number.isFinite(sample) && sample >= 0)
  );
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function formatMs(value) {
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatInteger(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

if (isMainEntry(import.meta.url)) await runGate(runDevexPrReport);

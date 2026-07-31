import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createFullCatalogWorkloadDefinition,
  createRunnerFingerprint,
  fullCatalogPackageSetDigest,
  fullCatalogScenarioDigest,
  ratifyBudgets,
  ratifyDevexBudgetReports,
  runBenchmarkScenario,
  runDevexBenchmark,
} from './devex-benchmark.mjs';
import {
  DEVEX_GOLDEN_PHASE_CONTRACT,
  buildGoldenReleaseScorecard,
} from './devex-golden-contract.mjs';
import {
  FULL_CATALOG_REPORT_SCHEMA,
  FULL_CATALOG_SAMPLE_SCHEMA,
  packedUiComponentNames,
} from './full-catalog-reproducer.mjs';
import { releasePackages } from './release-packages.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const benchmarkFixtureRoot = path.join(repoRoot, 'scripts/fixtures/devex-benchmark');
const benchmarkScenario = JSON.parse(
  readFileSync(path.join(benchmarkFixtureRoot, 'scenario.json'), 'utf8'),
);
const sourceCommit = 'a'.repeat(40);
const runner = createRunnerFingerprint({
  name: 'github-hosted-ubuntu-24.04-accepted',
  platform: 'linux',
  arch: 'x64',
  node: 'v24.0.0',
  cpuModel: 'fixture hosted CPU',
  packageManager: 'pnpm@10.12.1',
  osImage: `github-actions/ubuntu-24.04@sha256:${'1'.repeat(64)}`,
});

describe('transactional hosted DevEx ratification', () => {
  it('authenticates all three reports before merging them and persists once', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-ratify-batch-success-'));
    try {
      const records = hostedRatificationRecords();
      const budgetsPath = path.join(temporaryRoot, 'devex-budgets.json');
      writeFileSync(budgetsPath, `${JSON.stringify(unratifiedBudgets(), null, 2)}\n`);
      const argv = writeBatchInputs(temporaryRoot, budgetsPath, records);
      const authenticated = [];
      const ratified = [];
      let writes = 0;

      expect(
        runDevexBenchmark(argv, {
          authenticateRatificationReport(record) {
            authenticated.push(record.reportSource);
            return { ratificationOptions: {}, dispose: null };
          },
          cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
          ratifyReport(current, report) {
            const updated = structuredClone(current);
            const source = evidenceSource(report);
            const metricId = {
              benchmark: 'check.cold.durationMs',
              'golden-journey': 'dev.ready.cold.durationMs',
              'full-catalog': 'ui.fullCatalog.peakRssBytes',
            }[source];
            updated.metrics[metricId].provisionalTarget = 100 + ratified.length;
            ratified.push(source);
            return updated;
          },
          writeRatifiedBudgets(filePath, value) {
            writes += 1;
            writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
          },
        }),
      ).toBe(0);

      expect(authenticated).toEqual(['benchmark', 'golden-journey', 'full-catalog']);
      expect(ratified).toEqual(authenticated);
      expect(writes).toBe(1);
      expect(JSON.parse(readFileSync(budgetsPath, 'utf8')).metrics).toMatchObject({
        'check.cold.durationMs': { provisionalTarget: 100 },
        'dev.ready.cold.durationMs': { provisionalTarget: 101 },
        'ui.fullCatalog.peakRssBytes': { provisionalTarget: 102 },
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects mixed source revisions and runners before authenticating any report', () => {
    const records = hostedRatificationRecords();
    const authenticated = [];
    records[1].baselineReport = structuredClone(records[1].baselineReport);
    records[1].baselineReport.provenance.sourceCommit = 'b'.repeat(40);
    records[1].baselineReportBytes = reportBytes(records[1].baselineReport);
    expect(() =>
      ratifyDevexBudgetReports(unratifiedBudgets(), records, {
        authenticateReport(record) {
          authenticated.push(record.reportSource);
          return {};
        },
        cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
        repositoryRoot: repoRoot,
      }),
    ).toThrow('hosted DevEx reports must bind one exact clean source revision');
    expect(authenticated).toEqual([]);

    const anotherRunnerRecords = hostedRatificationRecords();
    const golden = structuredClone(anotherRunnerRecords[1].baselineReport);
    golden.runner = createRunnerFingerprint({ ...golden.runner, cpuModel: 'another hosted CPU' });
    anotherRunnerRecords[1].baselineReport = golden;
    anotherRunnerRecords[1].baselineReportBytes = reportBytes(golden);
    expect(() =>
      ratifyDevexBudgetReports(unratifiedBudgets(), anotherRunnerRecords, {
        authenticateReport(record) {
          authenticated.push(record.reportSource);
          return {};
        },
        cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
        repositoryRoot: repoRoot,
      }),
    ).toThrow('hosted DevEx reports must bind one exact runner fingerprint');
    expect(authenticated).toEqual([]);
  });

  it('rejects unsafe paths and mismatched report bytes before authentication', () => {
    const records = hostedRatificationRecords();
    records[0].baselineReportPath = '../outside.json';
    records[2].baselineReportBytes = Buffer.from(
      records[2].baselineReportBytes.toString('utf8').replace('"pass": true', '"pass": false'),
    );
    let authentications = 0;

    expect(() =>
      ratifyDevexBudgetReports(unratifiedBudgets(), records, {
        authenticateReport() {
          authentications += 1;
          return {};
        },
        cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
        repositoryRoot: repoRoot,
      }),
    ).toThrow(
      /baselineReportPath must be a canonical repository-relative path[\s\S]*baselineReportBytes do not contain baselineReport/u,
    );
    expect(authentications).toBe(0);
  });

  it('validates all baseline paths and digests together after the in-memory merge', () => {
    const records = hostedRatificationRecords();
    expect(() =>
      ratifyDevexBudgetReports(unratifiedBudgets(), records, {
        authenticateReport() {
          return { ratificationOptions: {}, dispose: null };
        },
        cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
        ratifyReport(current, report, proposal, ratificationOptions) {
          expect(ratificationOptions.baselineReports.size).toBe(3);
          if (evidenceSource(report) !== 'golden-journey') return current;
          const updated = ratifyBudgets(current, report, proposal, ratificationOptions);
          updated.metrics['dev.ready.cold.durationMs'].ratification.baselineReport.sha256 =
            `sha256:${'0'.repeat(64)}`;
          return updated;
        },
        repositoryRoot: repoRoot,
      }),
    ).toThrow(
      'dev.ready.cold.durationMs.ratification baseline report digest does not match baselines/hosted-golden-journey.json',
    );
  });

  it('leaves the budgets file byte-identical when one batch input is invalid', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-ratify-batch-rollback-'));
    try {
      const records = hostedRatificationRecords();
      records[2].baselineReport = structuredClone(records[2].baselineReport);
      records[2].baselineReport.sampleCount = 4;
      records[2].baselineReportBytes = reportBytes(records[2].baselineReport);
      const budgetsPath = path.join(temporaryRoot, 'devex-budgets.json');
      const original = Buffer.from(`${JSON.stringify(unratifiedBudgets(), null, 4)}\n`);
      writeFileSync(budgetsPath, original);
      const argv = writeBatchInputs(temporaryRoot, budgetsPath, records);
      let writes = 0;

      expect(() =>
        runDevexBenchmark(argv, {
          authenticateRatificationReport() {
            throw new Error('authentication must not run for an invalid batch');
          },
          cleanSourceIdentity: { commit: sourceCommit, tree: 'clean' },
          writeRatifiedBudgets() {
            writes += 1;
          },
        }),
      ).toThrow(/must contain at least five hosted samples/u);
      expect(writes).toBe(0);
      expect(readFileSync(budgetsPath)).toEqual(original);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});

function hostedRatificationRecords() {
  const reports = [benchmarkReport(), goldenReport(), fullCatalogReport()];
  const metrics = [
    {
      'check.cold.durationMs': {
        budget: 1_000,
        targetRationale: 'Keep the authenticated packed cold check within its reviewed target.',
      },
    },
    {
      'dev.ready.cold.durationMs': {
        budget: 100,
        targetRationale: 'Keep packed cold readiness within the first-run evaluator target.',
      },
    },
    {
      'ui.fullCatalog.peakRssBytes': {
        budget: 1_900_000_000,
        targetRationale: 'Keep the copied catalog within the reviewed hosted-runner RSS target.',
      },
    },
  ];
  return reports.map((baselineReport, index) => ({
    baselineReport,
    baselineReportBytes: reportBytes(baselineReport),
    baselineReportPath: `baselines/hosted-${evidenceSource(baselineReport)}.json`,
    proposal: {
      schema: 'kovo-devex-budget-proposal/v7',
      runnerFingerprint: runner,
      metrics: metrics[index],
    },
  }));
}

function writeBatchInputs(root, budgetsPath, records) {
  const argv = ['--ratify', '--budgets', budgetsPath];
  const baselineRoot = path.join(root, 'reports');
  mkdirSync(baselineRoot);
  for (const [index, record] of records.entries()) {
    const baselinePath = path.join(baselineRoot, `${String(index)}.json`);
    const proposalPath = path.join(baselineRoot, `${String(index)}-proposal.json`);
    writeFileSync(baselinePath, record.baselineReportBytes);
    writeFileSync(proposalPath, `${JSON.stringify(record.proposal, null, 2)}\n`);
    argv.push(
      '--baseline',
      baselinePath,
      '--proposal',
      proposalPath,
      '--baseline-record-path',
      record.baselineReportPath,
    );
  }
  argv.push('--write');
  return argv;
}

function unratifiedBudgets() {
  const value = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));
  value.runner = {
    ...value.runner,
    status: 'unratified',
    fingerprint: null,
  };
  value.workload = { status: 'unratified', identity: null };
  for (const metric of Object.values(value.metrics)) metric.ratification = null;
  return value;
}

function benchmarkReport() {
  const definition = structuredClone(benchmarkScenario);
  definition.environment = {
    runnerName: runner.name,
    platform: runner.platform,
    arch: runner.arch,
    node: runner.node,
    cpuModel: runner.cpuModel,
    packageManager: runner.packageManager,
    osImage: runner.osImage,
  };
  definition.provenance.sourceCommit = sourceCommit;
  definition.provenance.sourceTree = 'clean';
  const report = runBenchmarkScenario(definition, {
    allowFixtureScenario: true,
    observedEnvironment: {
      ...definition.environment,
      sourceCommit,
      sourceTree: 'clean',
    },
    root: benchmarkFixtureRoot,
    samples: 5,
    measure(_command, context) {
      const offset = { cold: 30, warm: 10, oneFileIncremental: 2 }[context.phase];
      return {
        durationMs: offset + context.sampleIndex,
        peakRssBytes: offset * 100 + context.sampleIndex,
        exitCode: 0,
        signal: null,
        error: null,
      };
    },
    measureDev(_command, context) {
      const evidence = {
        cold: {
          bodyDigest: `sha256:${'a'.repeat(64)}`,
          durationMs: 12 + context.sampleIndex,
        },
        diagnostic: {
          bodyDigest: `sha256:${'c'.repeat(64)}`,
          code: 'KV235',
          durationMs: 3 + context.sampleIndex,
          sourceDigest: `sha256:${'e'.repeat(64)}`,
        },
        served: {
          bodyDigest: `sha256:${'d'.repeat(64)}`,
          durationMs: 4 + context.sampleIndex,
          revision: 1,
          sourceDigest: `sha256:${'f'.repeat(64)}`,
        },
        warm: {
          bodyDigest: `sha256:${'b'.repeat(64)}`,
          durationMs: 5 + context.sampleIndex,
        },
      };
      return {
        durationMs: 100 + context.sampleIndex,
        peakRssBytes: 10_000 + context.sampleIndex,
        exitCode: 0,
        signal: null,
        error: null,
        stderr: '',
        stdout: `kovo-dev-profile/v1 ${JSON.stringify(evidence)}\n`,
      };
    },
  });
  for (const observation of report.phaseCensus.analysisInputs) {
    if (observation.phase !== 'oneFileIncremental') continue;
    observation.diagnosticPhases = ratifiableIncrementalPhases(observation.revision);
  }
  return report;
}

function ratifiableIncrementalPhases(revision) {
  const invariant = new Set([
    'lifecycle-policy',
    'config-trust',
    'typescript',
    'project-quality',
    'sound-subset',
  ]);
  return [
    ['lifecycle-policy', 'not-applicable'],
    ['config-trust', 'executed'],
    ['typescript', 'not-applicable'],
    ['project-quality', 'not-applicable'],
    ['sound-subset', 'not-applicable'],
    ['session-authority', 'executed'],
    ['app-source-trust', 'executed'],
    ['stylesheet', 'executed'],
    ['app-evaluation', 'executed'],
    ['build-check-graph', 'executed'],
    ['graph-diagnostics', 'executed'],
  ].map(([name, status]) => ({
    durationMs: 0,
    inputDigest: `sha256:${invariant.has(name) ? '7'.repeat(64) : String(revision).repeat(64)}`,
    name,
    status,
  }));
}

function goldenReport() {
  const packageNames = [
    '@kovojs/better-auth',
    '@kovojs/browser',
    '@kovojs/cli',
    '@kovojs/compiler',
    '@kovojs/core',
    '@kovojs/drizzle',
    '@kovojs/headless-ui',
    '@kovojs/icons',
    '@kovojs/server',
    '@kovojs/style',
    '@kovojs/test',
    '@kovojs/ui',
    '@kovojs/verify',
    'create-kovo',
  ];
  const packageSet = packageNames.map((name) => ({
    name,
    sha512: `sha512-${Buffer.from(name).toString('base64')}`,
    version: '0.3.0',
  }));
  const variants = [];
  for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
    for (const [dialectIndex, dialect] of ['postgres', 'sqlite'].entries()) {
      const offset = sampleIndex * 2 + dialectIndex;
      variants.push({
        schema: 'kovo.golden-journey/packed-app/v1',
        dialect,
        sampleIndex,
        pass: true,
        phases: DEVEX_GOLDEN_PHASE_CONTRACT.app.map((name) => ({
          durationMs:
            name === 'ready' ? 10 + offset : name === 'ready-warm' ? 5 + offset : 1 + offset,
          name,
          status: 0,
        })),
        install: {
          durationMs: 100 + offset,
          installedBytes: 1_000 + offset,
          installedFiles: 10,
          directProductionDependencies: 5,
          transitiveProductionDependencies: 5,
        },
        concepts: { counts: { environmentEdits: 0 } },
        buildPosture: {
          schema: 'kovo.golden-journey/build-posture/v1',
          configPath: 'kovo.config.ts',
          kind: 'controlled-retained-local-fixture',
          retention: {
            hours: 24,
            immutableClientModules: 'retained',
            priorTokenQueryReads: 'retained',
          },
        },
        styledUi: {
          bytes: 1_024,
          path: `evidence/${dialect}-${String(sampleIndex + 1)}/styled-ui.png`,
          sha256: `sha256:${'d'.repeat(64)}`,
          styled: {
            buttonBackground: 'rgb(0, 0, 0)',
            fontFamily: 'Inter',
            styleSheets: 1,
            styledSourceElements: 1,
          },
        },
        accessibility: {
          schema: 'kovo.golden-journey/accessibility/v1',
          states: [
            { name: 'login', violations: [] },
            { name: 'authenticated-crud', violations: [] },
          ],
          violations: 0,
        },
        failure: null,
      });
    }
  }
  const packedApps = {
    schema: 'kovo.golden-journey/packed-apps/v1',
    scenario: 'packed-apps',
    sampleCount: 5,
    dialects: ['postgres', 'sqlite'],
    packageSet,
    variants,
    pass: true,
  };
  const agent = {
    schema: 'kovo.golden-journey/offline-agent/v1',
    scenario: 'offline-agent',
    pass: true,
    phases: DEVEX_GOLDEN_PHASE_CONTRACT.agent.map((name) => ({
      durationMs: 1,
      name,
      status: 0,
    })),
    network: {
      allowlist: [],
      loopback: 'denied',
      mode: 'deny',
      packageManagerOffline: true,
    },
  };
  return buildGoldenReleaseScorecard({
    agent,
    environment: {
      sourceCommit,
      sourceTree: 'clean',
      packageManager: runner.packageManager,
      osImage: runner.osImage,
    },
    manifestSha256: `sha256:${'2'.repeat(64)}`,
    packedApps,
    runner,
  });
}

function fullCatalogReport() {
  const uiManifest = JSON.parse(
    readFileSync(path.join(repoRoot, 'packages/ui/package.json'), 'utf8'),
  );
  const components = packedUiComponentNames(new Map([['@kovojs/ui', { manifest: uiManifest }]]));
  const packageSet = releasePackages()
    .map(({ name, version }) => ({
      name,
      sha512: `sha512-${Buffer.from(name).toString('base64')}`,
      version,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const catalog = {
    componentCount: 44,
    components,
    source: '@kovojs/ui packed manifest exports',
  };
  const workload = createFullCatalogWorkloadDefinition(catalog, packageSet);
  const thresholdBytes = 2 * 1024 * 1024 * 1024;
  const samples = Array.from({ length: 5 }, (_, sampleIndex) => {
    const peakProcessTreeRssBytes = 1024 + sampleIndex;
    return {
      schema: FULL_CATALOG_SAMPLE_SCHEMA,
      sampleIndex,
      copiedComponents: 44,
      copiedSourceFiles: 44,
      unimportedDuringProof: true,
      phases: ['create', 'install', 'copy', 'typecheck', 'check', 'build'].map((name) => ({
        durationMs: 1,
        name,
        peakProcessTreeRssBytes,
        signal: null,
        status: 0,
      })),
      peakProcessTreeRssBytes,
      budget: {
        binding: false,
        thresholdBytes,
        withinThreshold: true,
      },
      functionalPass: true,
      pass: true,
      failure: null,
    };
  });
  return {
    schema: FULL_CATALOG_REPORT_SCHEMA,
    runner,
    source: { commit: sourceCommit, tree: 'clean' },
    packedRelease: {
      schema: 'kovo.packed-public-packages/v2',
      manifestSha256: `sha256:${'2'.repeat(64)}`,
      packageSetSha256: fullCatalogPackageSetDigest(packageSet),
    },
    scenario: {
      name: workload.name,
      digest: fullCatalogScenarioDigest(workload),
      definition: workload,
    },
    packageSet,
    catalog,
    budget: {
      binding: false,
      source: 'provisional',
      thresholdBytes,
    },
    sampleCount: 5,
    samples,
    metrics: {
      'ui.fullCatalog.peakRssBytes': {
        samples: samples.map((sample) => sample.peakProcessTreeRssBytes),
        unit: 'bytes',
      },
    },
    pass: true,
  };
}

function evidenceSource(report) {
  if (report.schema === 'kovo.golden-journey/release-scorecard/v1') return 'golden-journey';
  if (report.schema === FULL_CATALOG_REPORT_SCHEMA) return 'full-catalog';
  return 'benchmark';
}

function reportBytes(report) {
  return Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
}

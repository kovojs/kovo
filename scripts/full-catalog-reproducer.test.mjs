import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  authenticateFullCatalogBaselineReport,
  createFullCatalogWorkloadDefinition,
  createRunnerFingerprint,
  fullCatalogPackageSetDigest,
  fullCatalogScenarioDigest,
  ratifyBudgets,
  runDevexBenchmark,
  validateBudgets,
} from './devex-benchmark.mjs';
import {
  FULL_CATALOG_REPORT_SCHEMA,
  FULL_CATALOG_SAMPLE_SCHEMA,
  assertCatalogUnimported,
  assertCopiedCatalog,
  declarePackedCatalogDependencies,
  fullCatalogBudget,
  fullCatalogCreatorCommand,
  packedUiComponentNames,
  requireCatalogPhaseSuccess,
  validateFullCatalogReport,
} from './full-catalog-reproducer.mjs';
import { releasePackages } from './release-packages.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const uiManifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages/ui/package.json'), 'utf8'),
);
const budgets = JSON.parse(readFileSync(path.join(repoRoot, 'devex-budgets.json'), 'utf8'));

describe('packed full-catalog reproducer', () => {
  it('derives the exact 44-component census from the authenticated packed UI manifest', () => {
    const names = packedUiComponentNames(new Map([['@kovojs/ui', { manifest: uiManifest }]]));

    expect(names).toHaveLength(44);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('accordion');
    expect(names).toContain('toolbar');

    const missing = structuredClone(uiManifest);
    delete missing.exports['./toolbar'];
    expect(() => packedUiComponentNames(new Map([['@kovojs/ui', { manifest: missing }]]))).toThrow(
      'must expose exactly 44 component subpaths; found 43',
    );

    const forged = structuredClone(uiManifest);
    forged.exports['./internal/not-a-component'] = './dist/nope.js';
    expect(() => packedUiComponentNames(new Map([['@kovojs/ui', { manifest: forged }]]))).toThrow(
      'non-component public subpath',
    );
  });

  it('proves every expected copy exists while app-authored source leaves the copies unimported', () => {
    const appRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-catalog-proof-'));
    try {
      const output = path.join(appRoot, 'src/components/ui');
      mkdirSync(output, { recursive: true });
      const components = packedUiComponentNames(
        new Map([['@kovojs/ui', { manifest: uiManifest }]]),
      );
      for (const component of components) {
        writeFileSync(path.join(output, `${component}.tsx`), 'export {};\n');
      }
      writeFileSync(path.join(appRoot, 'src/app.tsx'), 'export const app = 1;\n');

      expect(() => assertCopiedCatalog(appRoot, 'src/components/ui', components)).not.toThrow();
      expect(() => assertCatalogUnimported(appRoot, 'src/components/ui')).not.toThrow();

      writeFileSync(
        path.join(appRoot, 'src/app.tsx'),
        "import { Button } from './components/ui/button';\nexport { Button };\n",
      );
      expect(() => assertCatalogUnimported(appRoot, 'src/components/ui')).toThrow(
        'imports copied UI',
      );
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('keeps the provisional 2 GiB target non-binding and makes ratification binding', () => {
    expect(fullCatalogBudget(budgets)).toEqual({
      binding: false,
      source: 'provisional',
      thresholdBytes: 2 * 1024 * 1024 * 1024,
    });

    const ratified = structuredClone(budgets);
    ratified.metrics['ui.fullCatalog.peakRssBytes'].ratification = {
      threshold: 1_900_000_000,
    };
    expect(fullCatalogBudget(ratified)).toEqual({
      binding: true,
      source: 'ratified',
      thresholdBytes: 1_900_000_000,
    });

    const breached = validReport();
    breached.budget = {
      binding: true,
      source: 'ratified',
      thresholdBytes: 1000,
    };
    breached.samples[0].budget = {
      binding: true,
      thresholdBytes: 1000,
      withinThreshold: false,
    };
    breached.samples[0].pass = false;
    breached.pass = false;
    expect(validateFullCatalogReport(breached)).toEqual([]);
  });

  it('gives the production-build fixture an explicit retained deployment posture', () => {
    expect(fullCatalogCreatorCommand('/packed/create-kovo.mjs', '/tmp/catalog-app', 2)).toEqual([
      process.execPath,
      '/packed/create-kovo.mjs',
      '/tmp/catalog-app',
      '--name',
      'kovo-full-catalog-3',
      '--postgres',
      '--retention',
      'retained-24h',
      '--disable-git',
    ]);
  });

  it('retains failed-phase timing and process-tree RSS as reportable evidence', () => {
    const failed = {
      durationMs: 600_002,
      peakRssBytes: 3_000_000_000,
      exitCode: null,
      signal: 'SIGKILL',
      error: 'command exceeded 600000ms',
      stderr: '',
      stdout: '',
    };

    let failure;
    try {
      requireCatalogPhaseSuccess('check', failed);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      evidence: {
        durationMs: 600_002,
        name: 'check',
        peakProcessTreeRssBytes: 3_000_000_000,
        signal: 'SIGKILL',
        status: null,
      },
      phase: 'check',
    });
  });

  it('accepts bounded signal termination with unavailable measurement evidence', () => {
    const report = validReport();
    const sample = report.samples[0];
    sample.phases = sample.phases.slice(0, 4);
    sample.phases[3] = {
      durationMs: null,
      name: 'typecheck',
      peakProcessTreeRssBytes: null,
      signal: 'SIGTERM',
      status: null,
    };
    sample.functionalPass = false;
    sample.pass = false;
    sample.failure = {
      artifact: {
        directory: 'failed/full-catalog-1',
        sha256: `sha256:${'3'.repeat(64)}`,
      },
      message: 'typecheck exceeded its bounded supervisor deadline',
      phase: 'typecheck',
    };
    report.pass = false;

    expect(validateFullCatalogReport(report)).toEqual([]);
    expect(sample.failure.artifact).toEqual({
      directory: 'failed/full-catalog-1',
      sha256: `sha256:${'3'.repeat(64)}`,
    });
  });

  it('isolates the catalog check by predeclaring its two authenticated source dependencies', () => {
    const appRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-catalog-dependencies-'));
    try {
      writeFileSync(
        path.join(appRoot, 'package.json'),
        '{"dependencies":{"@kovojs/core":"0.2.0"}}\n',
      );
      declarePackedCatalogDependencies(
        appRoot,
        new Map([
          ['@kovojs/headless-ui', { tarballPath: '/packed/headless-ui.tgz' }],
          ['@kovojs/icons', { tarballPath: '/packed/icons.tgz' }],
        ]),
      );
      const manifest = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
      expect(manifest.dependencies).toEqual({
        '@kovojs/core': '0.2.0',
        '@kovojs/headless-ui': 'file:///packed/headless-ui.tgz',
        '@kovojs/icons': 'file:///packed/icons.tgz',
      });
    } finally {
      rmSync(appRoot, { recursive: true, force: true });
    }
  });

  it('rejects incomplete, forged, and non-fail-closed report evidence', () => {
    const report = validReport();
    expect(validateFullCatalogReport(report)).toEqual([]);

    const incomplete = structuredClone(report);
    incomplete.samples[0].phases = incomplete.samples[0].phases.filter(
      (phase) => phase.name !== 'build',
    );
    expect(validateFullCatalogReport(incomplete)).toContain(
      'report.samples[0] did not prove every successful workload phase',
    );

    const forgedMetric = structuredClone(report);
    forgedMetric.metrics['ui.fullCatalog.peakRssBytes'].samples[0] += 1;
    expect(validateFullCatalogReport(forgedMetric)).toContain(
      'report.metrics must exactly match the per-sample full-catalog RSS evidence',
    );

    const ignoredBinding = structuredClone(report);
    ignoredBinding.samples[0].budget.binding = true;
    ignoredBinding.samples[0].budget.withinThreshold = false;
    expect(validateFullCatalogReport(ignoredBinding)).toContain(
      'report.samples[0].budget does not match report threshold and observed peak',
    );

    const duplicateComponent = structuredClone(report);
    duplicateComponent.catalog.components[1] = duplicateComponent.catalog.components[0];
    expect(validateFullCatalogReport(duplicateComponent)).toContain(
      'report.catalog must contain exactly 44 unique sorted authenticated components',
    );

    const forgedPackages = structuredClone(report);
    forgedPackages.packageSet = forgedPackages.packageSet.filter(
      (pkg) => pkg.name !== '@kovojs/ui',
    );
    expect(validateFullCatalogReport(forgedPackages)).toContain(
      'report.packageSet must contain the exact packed release census',
    );
  });

  it('ratifies only the full-catalog RSS metric from five authenticated successful samples', () => {
    const report = validReport(5);
    authenticateFullCatalogFixture(report);
    const baselinePath = 'baselines/full-catalog-fixture.json';
    const baselineBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    const proposal = {
      schema: 'kovo-devex-budget-proposal/v7',
      runnerFingerprint: report.runner,
      metrics: {
        'ui.fullCatalog.peakRssBytes': {
          budget: 1_900_000_000,
          statistic: 'p95',
          targetRationale:
            'Keep the complete copied catalog below the reviewed hosted-runner memory target.',
        },
      },
    };
    const ratified = ratifyBudgets(budgets, report, proposal, {
      baselineReportBytes: baselineBytes,
      baselineReportPath: baselinePath,
      repoRoot,
    });

    expect(ratified.runner).toEqual(budgets.runner);
    expect(ratified.workload).toEqual(budgets.workload);
    expect(ratified.metrics['ui.fullCatalog.peakRssBytes'].ratification).toMatchObject({
      baseline: 1028,
      budget: 1_900_000_000,
      noise: 1,
      noiseMultiplier: 3,
      runnerFingerprint: report.runner,
      sampleCount: 5,
      statistic: 'p95',
      threshold: 1_900_000_003,
      workloadIdentity: report.scenario.definition,
      baselineReport: {
        path: baselinePath,
        schema: FULL_CATALOG_REPORT_SCHEMA,
        scenarioDigest: report.scenario.digest,
        scenarioName: report.scenario.name,
      },
    });
    expect(
      validateBudgets(ratified, {
        baselineReports: new Map([[baselinePath, baselineBytes]]),
        repoRoot,
      }),
    ).toEqual([]);

    const crossSource = structuredClone(proposal);
    crossSource.metrics = {
      'check.cold.durationMs': {
        budget: 1,
        targetRationale: 'This metric belongs to the packed benchmark evidence source.',
      },
    };
    expect(() =>
      ratifyBudgets(budgets, report, crossSource, {
        baselineReportBytes: baselineBytes,
        baselineReportPath: baselinePath,
        repoRoot,
      }),
    ).toThrow(
      'full-catalog baseline cannot ratify metrics from another evidence source: check.cold.durationMs',
    );

    const wrongRunner = structuredClone(proposal);
    wrongRunner.runnerFingerprint = createRunnerFingerprint({
      ...report.runner,
      cpuModel: 'different hosted CPU',
    });
    expect(() =>
      ratifyBudgets(budgets, report, wrongRunner, {
        baselineReportBytes: baselineBytes,
        baselineReportPath: baselinePath,
        repoRoot,
      }),
    ).toThrow('baseline runner fingerprint does not match proposal.runnerFingerprint');

    const changedBytes = Buffer.from(`${JSON.stringify({ ...report, pass: false }, null, 2)}\n`);
    expect(() =>
      ratifyBudgets(budgets, report, proposal, {
        baselineReportBytes: changedBytes,
        baselineReportPath: baselinePath,
        repoRoot,
      }),
    ).toThrow('baselineReportBytes do not contain baselineReport');

    const tamperedBaseline = new Map([
      [baselinePath, Buffer.from(baselineBytes.toString('utf8').replace('1024', '1023'))],
    ]);
    expect(validateBudgets(ratified, { baselineReports: tamperedBaseline, repoRoot })).toContain(
      'ui.fullCatalog.peakRssBytes.ratification baseline report digest does not match baselines/full-catalog-fixture.json',
    );
  });

  it('accepts the full-catalog report through the production ratification CLI', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-full-catalog-ratify-'));
    try {
      const report = validReport(5);
      const baselineDirectory = path.join(temporaryRoot, 'baselines');
      mkdirSync(baselineDirectory);
      const budgetsPath = path.join(temporaryRoot, 'devex-budgets.json');
      const baselinePath = path.join(baselineDirectory, 'full-catalog-hosted.json');
      const proposalPath = path.join(temporaryRoot, 'proposal.json');
      writeFileSync(budgetsPath, readFileSync(path.join(repoRoot, 'devex-budgets.json')));
      writeFileSync(
        path.join(baselineDirectory, 'devex-docs-snapshot-v1.json'),
        readFileSync(path.join(repoRoot, 'baselines/devex-docs-snapshot-v1.json')),
      );
      writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(
        proposalPath,
        `${JSON.stringify(
          {
            schema: 'kovo-devex-budget-proposal/v7',
            runnerFingerprint: report.runner,
            metrics: {
              'ui.fullCatalog.peakRssBytes': {
                budget: 1_900_000_000,
                targetRationale:
                  'Keep the copied full catalog below the reviewed hosted-runner RSS target.',
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = runDevexBenchmark(
        [
          '--ratify',
          '--budgets',
          budgetsPath,
          '--baseline',
          baselinePath,
          '--proposal',
          proposalPath,
          '--write',
        ],
        {
          reproduceFullCatalogEvidence: () => fullCatalogEvidenceFixture(report),
        },
      );

      expect(result).toBe(0);
      expect(
        JSON.parse(readFileSync(budgetsPath, 'utf8')).metrics['ui.fullCatalog.peakRssBytes']
          .ratification,
      ).toMatchObject({
        sampleCount: 5,
        workloadIdentity: report.scenario.definition,
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('rejects too few, failed, and altered workload/package/catalog/phase evidence', () => {
    const proposalFor = (report) => ({
      schema: 'kovo-devex-budget-proposal/v7',
      runnerFingerprint: report.runner,
      metrics: {
        'ui.fullCatalog.peakRssBytes': {
          budget: 1_900_000_000,
          targetRationale: 'Keep the full catalog inside the reviewed memory envelope.',
        },
      },
    });
    const ratify = (report) => {
      authenticateFullCatalogFixture(report);
      return ratifyBudgets(budgets, report, proposalFor(report), {
        baselineReportBytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
        baselineReportPath: 'baselines/full-catalog-fixture.json',
        repoRoot,
      });
    };

    expect(() => ratify(validReport(4))).toThrow(
      'baselineReport ratification requires at least five functionally successful samples',
    );

    const unacceptedRunner = validReport(5);
    unacceptedRunner.runner = createRunnerFingerprint({
      ...unacceptedRunner.runner,
      name: 'local-full-catalog-observation',
      osImage: `local/darwin@sha256:${'3'.repeat(64)}`,
      platform: 'darwin',
    });
    expect(() => ratify(unacceptedRunner)).toThrow(
      'baselineReport.runner must be the exact accepted GitHub-hosted ubuntu-24.04 runner',
    );

    const failed = validReport(5);
    failed.samples[2].functionalPass = false;
    failed.samples[2].pass = false;
    failed.samples[2].failure = {
      artifact: null,
      message: 'check failed',
      phase: 'check',
    };
    failed.pass = false;
    expect(() => ratify(failed)).toThrow(
      'baselineReport ratification requires at least five functionally successful samples',
    );

    const wrongWorkload = validReport(5);
    wrongWorkload.scenario.definition.sourcePosture.copiedOutput = 'src/ui';
    wrongWorkload.scenario.digest = fullCatalogScenarioDigest(wrongWorkload.scenario.definition);
    expect(() => ratify(wrongWorkload)).toThrow(
      'baselineReport.scenario must bind the exact code-owned full-catalog workload',
    );

    const wrongPackage = validReport(5);
    wrongPackage.packageSet[0].name = '@kovojs/not-core';
    wrongPackage.packedRelease.packageSetSha256 = fullCatalogPackageSetDigest(
      wrongPackage.packageSet,
    );
    expect(() => ratify(wrongPackage)).toThrow(
      'baselineReport.packageSet must retain the exact sorted release package names',
    );

    const wrongCatalog = validReport(5);
    wrongCatalog.catalog.components = [
      'not-the-packed-component',
      ...wrongCatalog.catalog.components.slice(1),
    ];
    expect(() => ratify(wrongCatalog)).toThrow(
      'baselineReport.scenario must bind the exact code-owned full-catalog workload',
    );

    const wrongPhase = validReport(5);
    wrongPhase.samples[0].phases[4].name = 'invented-check';
    expect(() => ratify(wrongPhase)).toThrow(
      'baselineReport.samples[0].phases must be an ordered prefix of the workload phases',
    );
  });

  it('rejects self-consistent catalog and package rewrites against fresh packed evidence', () => {
    const authentic = validReport(5);
    expect(() => ratifyFullCatalogFixtureWithoutAuthentication(authentic)).toThrow(
      'full-catalog budget ratification requires evidence reproduced from the exact clean source revision',
    );
    const renamedCatalog = structuredClone(authentic);
    renamedCatalog.catalog.components = ['aardvark', ...renamedCatalog.catalog.components.slice(1)];
    renamedCatalog.scenario.definition = createFullCatalogWorkloadDefinition(
      renamedCatalog.catalog,
      renamedCatalog.packageSet,
    );
    renamedCatalog.scenario.digest = fullCatalogScenarioDigest(renamedCatalog.scenario.definition);

    const rewrittenPackages = structuredClone(authentic);
    rewrittenPackages.packageSet[0] = {
      ...rewrittenPackages.packageSet[0],
      version: '9.9.9',
      sha512: 'sha512-dGFtcGVyZWQ=',
    };
    rewrittenPackages.packedRelease = {
      ...rewrittenPackages.packedRelease,
      manifestSha256: `sha256:${'f'.repeat(64)}`,
      packageSetSha256: fullCatalogPackageSetDigest(rewrittenPackages.packageSet),
    };

    expect(() => ratifyFullCatalogFixture(renamedCatalog, authentic)).toThrow(
      'full-catalog baseline does not match the fresh code-owned packed release: catalog, scenario',
    );
    expect(() => ratifyFullCatalogFixture(rewrittenPackages, authentic)).toThrow(
      'full-catalog baseline does not match the fresh code-owned packed release: packedRelease, packageSet',
    );
  });
});

function validReport(sampleCount = 1) {
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
  const samples = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const peakProcessTreeRssBytes = 1024 + sampleIndex;
    const phases = ['create', 'install', 'copy', 'typecheck', 'check', 'build'].map((name) => ({
      durationMs: 1,
      name,
      peakProcessTreeRssBytes,
      signal: null,
      status: 0,
    }));
    return {
      schema: FULL_CATALOG_SAMPLE_SCHEMA,
      sampleIndex,
      copiedComponents: 44,
      copiedSourceFiles: 44,
      unimportedDuringProof: true,
      phases,
      peakProcessTreeRssBytes,
      budget: {
        binding: false,
        thresholdBytes: 2 * 1024 * 1024 * 1024,
        withinThreshold: true,
      },
      functionalPass: true,
      pass: true,
      failure: null,
    };
  });
  return {
    schema: FULL_CATALOG_REPORT_SCHEMA,
    runner: createRunnerFingerprint({
      name: 'github-hosted-ubuntu-24.04-accepted',
      platform: 'linux',
      arch: 'x64',
      node: 'v24.0.0',
      cpuModel: 'fixture hosted CPU',
      packageManager: 'pnpm@10.12.1',
      osImage: `github-actions/ubuntu-24.04@sha256:${'1'.repeat(64)}`,
    }),
    source: {
      commit: 'a'.repeat(40),
      tree: 'clean',
    },
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
    budget: fullCatalogBudget(budgets),
    sampleCount,
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

function fullCatalogEvidenceFixture(report) {
  return {
    source: structuredClone(report.source),
    packedRelease: structuredClone(report.packedRelease),
    packageSet: structuredClone(report.packageSet),
    catalog: structuredClone(report.catalog),
    scenario: structuredClone(report.scenario),
  };
}

function authenticateFullCatalogFixture(report, expectedReport = report) {
  return authenticateFullCatalogBaselineReport(report, {
    repositoryRoot: repoRoot,
    reproduceEvidence: () => fullCatalogEvidenceFixture(expectedReport),
  });
}

function ratifyFullCatalogFixture(report, expectedReport = report) {
  authenticateFullCatalogFixture(report, expectedReport);
  return ratifyFullCatalogFixtureWithoutAuthentication(report);
}

function ratifyFullCatalogFixtureWithoutAuthentication(report) {
  return ratifyBudgets(
    budgets,
    report,
    {
      schema: 'kovo-devex-budget-proposal/v7',
      runnerFingerprint: report.runner,
      metrics: {
        'ui.fullCatalog.peakRssBytes': {
          budget: 1_900_000_000,
          targetRationale: 'Keep the full catalog inside the reviewed memory envelope.',
        },
      },
    },
    {
      baselineReportBytes: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
      baselineReportPath: 'baselines/full-catalog-fixture.json',
      repoRoot,
    },
  );
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  collectDevexEnvironment,
  createRunnerFingerprint,
  evaluateBudgets,
} from './devex-benchmark.mjs';
import {
  DEVEX_GOLDEN_RELEASE_SCENARIO,
  buildGoldenReleaseScorecard,
} from './devex-golden-contract.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { offlineAgentScenario, runOfflineAgentJourney } from './golden-journey/offline-agent.mjs';
import {
  authenticatedPackedJourneyPackages,
  packedTarballPath,
  validateExternalPackedJourneyManifest,
} from './golden-journey/packed-package-auth.mjs';
import { packedAppsScenario, runPackedAppJourneys } from './golden-journey/packed-app.mjs';
import { manifestPath as defaultManifestPath, repoRoot } from './release-packages.mjs';

export {
  authenticatedPackedJourneyPackages,
  packedTarballPath,
  validateExternalPackedJourneyManifest,
};

export function parseGoldenJourneyArgs(argv) {
  let scenario;
  let packedManifest = defaultManifestPath;
  let report;
  let artifactRoot;
  let dialect = 'all';
  let samples = 1;
  let budgets;
  let evaluate = false;
  let requireRatified = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--evaluate') {
      evaluate = true;
      continue;
    }
    if (token === '--require-ratified') {
      requireRatified = true;
      continue;
    }
    if (
      token === '--scenario' ||
      token === '--packed-manifest' ||
      token === '--report' ||
      token === '--artifacts' ||
      token === '--dialect' ||
      token === '--samples' ||
      token === '--budgets'
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${token} requires a value.`);
      }
      index += 1;
      if (token === '--scenario') scenario = value;
      if (token === '--packed-manifest') packedManifest = path.resolve(repoRoot, value);
      if (token === '--report') report = path.resolve(repoRoot, value);
      if (token === '--artifacts') artifactRoot = path.resolve(repoRoot, value);
      if (token === '--dialect') dialect = value;
      if (token === '--samples') samples = Number(value);
      if (token === '--budgets') budgets = path.resolve(repoRoot, value);
      continue;
    }
    throw new Error(`Unknown golden-journey argument ${JSON.stringify(token)}.`);
  }
  if (
    scenario !== offlineAgentScenario &&
    scenario !== packedAppsScenario &&
    scenario !== DEVEX_GOLDEN_RELEASE_SCENARIO
  ) {
    throw new Error(
      `--scenario must be ${offlineAgentScenario}, ${packedAppsScenario}, or ${DEVEX_GOLDEN_RELEASE_SCENARIO}.`,
    );
  }
  if (!['all', 'postgres', 'sqlite'].includes(dialect)) {
    throw new Error('--dialect must be all, postgres, or sqlite.');
  }
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 20) {
    throw new Error('--samples must be an integer from 1 through 20.');
  }
  if (
    scenario === offlineAgentScenario &&
    (artifactRoot !== undefined || dialect !== 'all' || samples !== 1)
  ) {
    throw new Error(
      '--artifacts, --dialect, and --samples apply only to packed-apps or release-scorecard.',
    );
  }
  if (scenario !== DEVEX_GOLDEN_RELEASE_SCENARIO && (evaluate || requireRatified || budgets)) {
    throw new Error(
      '--evaluate, --require-ratified, and --budgets apply only to release-scorecard.',
    );
  }
  if (requireRatified && !evaluate) {
    throw new Error('--require-ratified requires --evaluate.');
  }
  if (
    (scenario === packedAppsScenario || scenario === DEVEX_GOLDEN_RELEASE_SCENARIO) &&
    artifactRoot === undefined
  ) {
    artifactRoot = path.join(repoRoot, '.release/devex/golden-journey');
  }
  return Object.freeze({
    packedManifest,
    ...(report === undefined ? {} : { report }),
    ...(scenario === packedAppsScenario || scenario === DEVEX_GOLDEN_RELEASE_SCENARIO
      ? {
          artifactRoot,
          dialects: dialect === 'all' ? ['postgres', 'sqlite'] : [dialect],
          samples,
        }
      : {}),
    ...(scenario === DEVEX_GOLDEN_RELEASE_SCENARIO
      ? {
          budgets: budgets ?? path.join(repoRoot, 'devex-budgets.json'),
          evaluate,
          requireRatified,
        }
      : {}),
    scenario,
  });
}

export async function runGoldenJourney(argv = process.argv.slice(2)) {
  const options = parseGoldenJourneyArgs(argv);
  const packedPackages = authenticatedPackedJourneyPackages(options.packedManifest);
  let report;
  if (options.scenario === offlineAgentScenario) {
    report = runOfflineAgentJourney({ packedPackages });
  } else if (options.scenario === packedAppsScenario) {
    report = await runPackedAppJourneys({
      artifactRoot: options.artifactRoot,
      dialects: options.dialects,
      packedPackages,
      samples: options.samples,
    });
  } else {
    const environment = collectDevexEnvironment();
    const packedApps = await runPackedAppJourneys({
      artifactRoot: options.artifactRoot,
      dialects: options.dialects,
      packedPackages,
      samples: options.samples,
    });
    const agent = runOfflineAgentJourney({
      artifactRoot: options.artifactRoot,
      packedPackages,
    });
    report = buildGoldenReleaseScorecard({
      agent,
      environment,
      manifestSha256: sha256(readFileSync(options.packedManifest)),
      packedApps,
      runner: createRunnerFingerprint({
        name: environment.runnerName,
        platform: environment.platform,
        arch: environment.arch,
        node: environment.node,
        cpuModel: environment.cpuModel,
        packageManager: environment.packageManager,
        osImage: environment.osImage,
      }),
    });
    if (options.evaluate) {
      report = {
        ...report,
        evaluation: evaluateBudgets(JSON.parse(readFileSync(options.budgets, 'utf8')), report, {
          repoRoot: path.dirname(options.budgets),
          requireRatified: options.requireRatified,
        }),
      };
    }
  }
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report !== undefined) {
    mkdirSync(path.dirname(options.report), { recursive: true });
    writeFileSync(options.report, output, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(output);
  if (report.pass !== true || report.evaluation?.pass === false) {
    throw new Error(`${options.scenario} golden journey did not satisfy its release gate`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

if (isMainEntry(import.meta.url)) await runGate(runGoldenJourney);

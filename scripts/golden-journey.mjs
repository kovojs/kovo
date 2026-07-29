#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
import { readPackageTarballSnapshot } from './lib/deterministic-tarball.mjs';
import { offlineAgentScenario, runOfflineAgentJourney } from './golden-journey/offline-agent.mjs';
import { packedAppsScenario, runPackedAppJourneys } from './golden-journey/packed-app.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
  verifyPackedAttestationBytes,
} from './publish-packed-packages.mjs';
import {
  manifestPath as defaultManifestPath,
  releasePackages,
  repoRoot,
} from './release-packages.mjs';

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

export function authenticatedPackedJourneyPackages(packedManifestPath) {
  const resolvedManifest = path.resolve(packedManifestPath);
  const manifest = readPackedReleaseManifest(resolvedManifest);
  const expectedPackages = releasePackages();
  const packages =
    packedManifestReleaseRoot(resolvedManifest) === path.resolve(repoRoot)
      ? validatePackedReleaseManifest(manifest, expectedPackages)
      : validateExternalPackedJourneyManifest(manifest, expectedPackages);
  return new Map(
    packages.map((pkg) => {
      const tarballPath = packedTarballPath(resolvedManifest, pkg.tarball);
      const verified = verifyPackedAttestationBytes(pkg, readPackageTarballSnapshot(tarballPath));
      return [
        pkg.name,
        Object.freeze({
          entries: verified.entries,
          manifest: pkg.manifest,
          name: pkg.name,
          sha512: pkg.sha512,
          tarballPath,
          version: pkg.version,
        }),
      ];
    }),
  );
}

export function packedTarballPath(packedManifestPath, relativeTarball) {
  const releaseRoot = packedManifestReleaseRoot(packedManifestPath);
  const tarballRoot = path.join(releaseRoot, '.release', 'tarballs');
  const candidate = path.resolve(releaseRoot, relativeTarball);
  const relative = path.relative(tarballRoot, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    path.extname(relative) !== '.tgz'
  ) {
    throw new Error('packed journey tarball must stay inside its manifest release tarball root');
  }
  const realRoot = realpathSync(tarballRoot);
  const realCandidate = realpathSync(candidate);
  const realRelative = path.relative(realRoot, realCandidate);
  if (
    realRelative === '' ||
    realRelative === '..' ||
    realRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(realRelative)
  ) {
    throw new Error('packed journey tarball resolves outside its manifest release tarball root');
  }
  return realCandidate;
}

export function validateExternalPackedJourneyManifest(manifest, expectedPackages) {
  if (
    manifest?.schema !== 'kovo.packed-public-packages/v2' ||
    !Array.isArray(manifest?.packages) ||
    manifest.packages.length !== expectedPackages.length
  ) {
    throw new Error('external packed journey manifest has an invalid schema or package census');
  }
  const names = new Set();
  const tarballs = new Set();
  for (const [index, expected] of expectedPackages.entries()) {
    const pkg = manifest.packages[index];
    if (
      pkg?.name !== expected.name ||
      pkg?.version !== expected.version ||
      pkg?.manifest?.name !== expected.name ||
      pkg?.manifest?.version !== expected.version ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(pkg?.sha512 ?? '') ||
      !Array.isArray(pkg?.files) ||
      pkg.files.length === 0 ||
      typeof pkg?.tarball !== 'string' ||
      !/^\.release\/tarballs\/[a-z0-9][a-z0-9._-]*\.tgz$/u.test(pkg.tarball)
    ) {
      throw new Error(`external packed journey manifest package ${String(index)} is invalid`);
    }
    if (names.has(pkg.name) || tarballs.has(pkg.tarball)) {
      throw new Error('external packed journey manifest reuses a package or tarball identity');
    }
    names.add(pkg.name);
    tarballs.add(pkg.tarball);
  }
  return manifest.packages;
}

function packedManifestReleaseRoot(packedManifestPath) {
  const manifestDirectory = path.dirname(path.resolve(packedManifestPath));
  return path.basename(manifestDirectory) === '.release'
    ? path.dirname(manifestDirectory)
    : path.resolve(repoRoot);
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

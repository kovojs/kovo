#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { offlineAgentScenario, runOfflineAgentJourney } from './golden-journey/offline-agent.mjs';
import { packedAppsScenario, runPackedAppJourneys } from './golden-journey/packed-app.mjs';
import {
  readPackedReleaseManifest,
  validatePackedReleaseManifest,
  verifyPackedAttestation,
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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      token === '--scenario' ||
      token === '--packed-manifest' ||
      token === '--report' ||
      token === '--artifacts' ||
      token === '--dialect' ||
      token === '--samples'
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
      continue;
    }
    throw new Error(`Unknown golden-journey argument ${JSON.stringify(token)}.`);
  }
  if (scenario !== offlineAgentScenario && scenario !== packedAppsScenario) {
    throw new Error(`--scenario must be ${offlineAgentScenario} or ${packedAppsScenario}.`);
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
    throw new Error('--artifacts, --dialect, and --samples apply only to packed-apps.');
  }
  if (scenario === packedAppsScenario && artifactRoot === undefined) {
    artifactRoot = path.join(repoRoot, '.release/devex/golden-journey');
  }
  return Object.freeze({
    packedManifest,
    ...(report === undefined ? {} : { report }),
    ...(scenario === packedAppsScenario
      ? {
          artifactRoot,
          dialects: dialect === 'all' ? ['postgres', 'sqlite'] : [dialect],
          samples,
        }
      : {}),
    scenario,
  });
}

export function authenticatedPackedJourneyPackages(packedManifestPath) {
  const manifest = readPackedReleaseManifest(packedManifestPath);
  const packages = validatePackedReleaseManifest(manifest, releasePackages());
  return new Map(
    packages.map((pkg) => {
      const tarballPath = path.resolve(repoRoot, pkg.tarball);
      const verified = verifyPackedAttestation(pkg, tarballPath);
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

export async function runGoldenJourney(argv = process.argv.slice(2)) {
  const options = parseGoldenJourneyArgs(argv);
  const packedPackages = authenticatedPackedJourneyPackages(options.packedManifest);
  const report =
    options.scenario === offlineAgentScenario
      ? runOfflineAgentJourney({
          packedPackages,
        })
      : await runPackedAppJourneys({
          artifactRoot: options.artifactRoot,
          dialects: options.dialects,
          packedPackages,
          samples: options.samples,
        });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report !== undefined) {
    mkdirSync(path.dirname(options.report), { recursive: true });
    writeFileSync(options.report, output, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(output);
  if (report.pass !== true) {
    throw new Error(`${options.scenario} golden journey did not satisfy its release gate`);
  }
}

if (isMainEntry(import.meta.url)) await runGate(runGoldenJourney);

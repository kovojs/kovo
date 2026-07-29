#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import { offlineAgentScenario, runOfflineAgentJourney } from './golden-journey/offline-agent.mjs';
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
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--scenario' || token === '--packed-manifest' || token === '--report') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`${token} requires a value.`);
      }
      index += 1;
      if (token === '--scenario') scenario = value;
      if (token === '--packed-manifest') packedManifest = path.resolve(repoRoot, value);
      if (token === '--report') report = path.resolve(repoRoot, value);
      continue;
    }
    throw new Error(`Unknown golden-journey argument ${JSON.stringify(token)}.`);
  }
  if (scenario !== offlineAgentScenario) {
    throw new Error(`--scenario must be ${offlineAgentScenario}.`);
  }
  return Object.freeze({
    packedManifest,
    ...(report === undefined ? {} : { report }),
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
          name: pkg.name,
          sha512: pkg.sha512,
          tarballPath,
          version: pkg.version,
        }),
      ];
    }),
  );
}

export function runGoldenJourney(argv = process.argv.slice(2)) {
  const options = parseGoldenJourneyArgs(argv);
  const packedPackages = authenticatedPackedJourneyPackages(options.packedManifest);
  const report = runOfflineAgentJourney({
    packedPackages,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.report !== undefined) {
    mkdirSync(path.dirname(options.report), { recursive: true });
    writeFileSync(options.report, output, { encoding: 'utf8', flag: 'wx' });
  }
  process.stdout.write(output);
}

if (isMainEntry(import.meta.url)) await runGate(runGoldenJourney);

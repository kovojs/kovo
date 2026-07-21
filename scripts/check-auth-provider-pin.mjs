#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { loadTcbManifest } from './check-tcb-boundary.mjs';
import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  lookupPnpmPackageIntegrity,
  parsePnpmPackageIntegrities,
} from './lib/pnpm-lock-packages.mjs';
import { repoRoot as findRepoRoot } from './lib/repo-root.mjs';

export const repoRoot = findRepoRoot();
export const providerDependency = 'better-auth';
export const providerPackageJsonPath = 'packages/better-auth/package.json';
export const rootPackageJsonPath = 'package.json';
export const tcbManifestPath = 'security/TCB.md';
export const lockfilePath = 'pnpm-lock.yaml';
export const providerGateCommand =
  'node scripts/security-cost-budget-runner.mjs --gate auth-provider-pin';

/**
 * Bind the public Better Auth peer to the exact implementation whose lifecycle behavior Kovo
 * characterizes. The general TCB gate owns dependency integrity; this narrower gate closes the
 * peer-dependency hole and makes its own root-check enrollment non-optional (SPEC §6.6).
 */
export function checkAuthProviderPin(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const readText =
    options.readText ?? ((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'));
  const exists = options.exists ?? ((relativePath) => existsSync(path.join(root, relativePath)));
  const findings = [];

  const providerManifest = readJson(providerPackageJsonPath, { exists, findings, readText });
  const rootManifest = readJson(rootPackageJsonPath, { exists, findings, readText });
  const tcb = readTcb({ exists, findings, readText });
  const surfaces = Array.isArray(tcb?.trustedDependencySurfaces)
    ? tcb.trustedDependencySurfaces.filter((surface) => surface?.dependency === providerDependency)
    : [];

  if (surfaces.length === 0) {
    findings.push(`${tcbManifestPath}: no ${providerDependency} trustedDependencySurfaces found`);
  }

  const versions = new Set(
    surfaces
      .map((surface) => surface?.pinnedVersion)
      .filter((version) => typeof version === 'string' && version !== ''),
  );
  const integrities = new Set(
    surfaces
      .map((surface) => surface?.integrity)
      .filter((integrity) => typeof integrity === 'string' && integrity !== ''),
  );
  if (versions.size > 1) {
    findings.push(
      `${tcbManifestPath}: ${providerDependency} TCB surfaces disagree on pinnedVersion (${[...versions].join(', ')})`,
    );
  }
  if (integrities.size > 1) {
    findings.push(
      `${tcbManifestPath}: ${providerDependency} TCB surfaces disagree on resolution integrity`,
    );
  }

  const pinnedVersion = versions.size === 1 ? [...versions][0] : undefined;
  const pinnedIntegrity = integrities.size === 1 ? [...integrities][0] : undefined;
  for (const surface of surfaces) {
    if (surface?.packageJson !== providerPackageJsonPath) {
      findings.push(
        `${tcbManifestPath}: ${surface?.id ?? providerDependency} must bind ${providerPackageJsonPath}`,
      );
    }
  }

  if (pinnedVersion !== undefined && providerManifest !== undefined) {
    requireExactSpecifier(
      providerManifest,
      'devDependencies',
      providerDependency,
      pinnedVersion,
      findings,
    );
    requireExactSpecifier(
      providerManifest,
      'peerDependencies',
      providerDependency,
      pinnedVersion,
      findings,
    );
    if (providerManifest.peerDependenciesMeta?.[providerDependency]?.optional === true) {
      findings.push(
        `${providerPackageJsonPath}: peerDependencies.${providerDependency} must remain a required peer`,
      );
    }
  }

  if (rootManifest !== undefined) {
    const scripts = rootManifest.scripts;
    if (scripts?.['check:auth-provider-pin'] !== providerGateCommand) {
      findings.push(
        `${rootPackageJsonPath}: scripts.check:auth-provider-pin must be ${JSON.stringify(providerGateCommand)}`,
      );
    }
    const check = scripts?.check;
    const enrollment = 'pnpm run check:auth-provider-pin';
    const enrollmentCount =
      typeof check === 'string'
        ? check.split(' && ').filter((step) => step === enrollment).length
        : 0;
    if (enrollmentCount !== 1) {
      findings.push(
        `${rootPackageJsonPath}: root scripts.check must enroll ${enrollment} exactly once`,
      );
    }
  }

  if (!exists(lockfilePath)) {
    findings.push(`${lockfilePath}: required by the ${providerDependency} provider pin`);
  } else if (pinnedVersion !== undefined) {
    const parsed = parsePnpmPackageIntegrities(readText(lockfilePath), { lockfilePath });
    findings.push(...parsed.findings);
    const resolvedIntegrity = lookupPnpmPackageIntegrity(
      parsed.packages,
      providerDependency,
      pinnedVersion,
    );
    if (resolvedIntegrity === undefined) {
      findings.push(
        `${lockfilePath}: missing exact subject ${providerDependency}@${pinnedVersion}`,
      );
    } else if (pinnedIntegrity !== undefined && resolvedIntegrity !== pinnedIntegrity) {
      findings.push(
        `${lockfilePath}: ${providerDependency}@${pinnedVersion} integrity does not match ${tcbManifestPath}`,
      );
    }
  }

  return {
    findings,
    ok: findings.length === 0,
    summary:
      findings.length === 0
        ? `OK ${providerDependency} provider exact-pinned to ${pinnedVersion} across ${surfaces.length} TCB surfaces`
        : `${findings.length} ${providerDependency} provider pin violation(s)`,
  };
}

function requireExactSpecifier(manifest, bucket, dependency, pinnedVersion, findings) {
  const specifier = manifest?.[bucket]?.[dependency];
  if (specifier !== pinnedVersion) {
    findings.push(
      `${providerPackageJsonPath}: ${bucket}.${dependency} must equal exact TCB pin ${pinnedVersion}; found ${JSON.stringify(specifier)}`,
    );
  }
}

function readJson(relativePath, { exists, findings, readText }) {
  if (!exists(relativePath)) {
    findings.push(`${relativePath}: required by the ${providerDependency} provider pin`);
    return undefined;
  }
  try {
    return JSON.parse(readText(relativePath));
  } catch {
    findings.push(`${relativePath}: must be valid JSON`);
    return undefined;
  }
}

function readTcb({ exists, findings, readText }) {
  if (!exists(tcbManifestPath)) {
    findings.push(`${tcbManifestPath}: required by the ${providerDependency} provider pin`);
    return undefined;
  }
  try {
    return loadTcbManifest({ manifestPath: tcbManifestPath, readText });
  } catch (error) {
    findings.push(
      `${tcbManifestPath}: ${error instanceof Error ? error.message : 'invalid TCB manifest'}`,
    );
    return undefined;
  }
}

export function main(options = {}) {
  const result = checkAuthProviderPin(options);
  process.stdout.write(`check-auth-provider-pin/v1 ${result.summary}\n`);
  for (const finding of result.findings) process.stderr.write(`${finding}\n`);
  return result.ok;
}

if (isMainEntry(import.meta.url)) await runGate(main);

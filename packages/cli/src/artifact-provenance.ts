import { hash as builtinHash } from 'node:crypto';
import {
  existsSync as builtinExistsSync,
  readFileSync as builtinReadFileSync,
  realpathSync as builtinRealpathSync,
} from 'node:fs';
import { createRequire as builtinCreateRequire } from 'node:module';
import {
  dirname as builtinDirname,
  join as builtinJoin,
  resolve as builtinResolve,
} from 'node:path';
import {
  fileURLToPath as builtinFileURLToPath,
  pathToFileURL as builtinPathToFileURL,
} from 'node:url';

import type {
  KovoArtifactFrameworkPackage,
  KovoArtifactProvenance,
} from '@kovojs/core/internal/graph';

import { findNearestFile, isRecord, readJsonRecord } from './tooling.js';

const hash = builtinHash;
const existsSync = builtinExistsSync;
const readFileSync = builtinReadFileSync;
const realpathSync = builtinRealpathSync;
const createRequire = builtinCreateRequire;
const dirname = builtinDirname;
const join = builtinJoin;
const resolve = builtinResolve;
const fileURLToPath = builtinFileURLToPath;
const pathToFileURL = builtinPathToFileURL;

type NodeRequire = ReturnType<typeof builtinCreateRequire>;

export const KOVO_ARTIFACT_PROVENANCE_SCHEMA = 'kovo.artifact.provenance/v1' as const;
export const KOVO_GRAPH_SCHEMA_VERSION = 'kovo.graph/v2';

const KOVO_GUARANTEE_REGISTER_SCHEMA = 'kovo.security.guarantees/v1' as const;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KOVO_PACKAGE_NAME_PATTERN = /^@kovojs\/[a-z0-9][a-z0-9._-]*$/u;
const KOVO_PACKAGE_VERSION_PATTERN =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MAX_PACKAGE_CONTEXTS = 256;
const defaultCliEntryPath = fileURLToPath(import.meta.url);

interface ArtifactProvenanceInputs {
  frameworkPackages: readonly KovoArtifactFrameworkPackage[];
  graphSchemaVersion?: string;
  pnpmLockBytes: string | Uint8Array;
  securityGuarantees: KovoArtifactProvenance['securityGuarantees'];
}

interface ResolveArtifactProvenanceOptions {
  appModulePath: string;
  cliEntryPath?: string;
}

interface LocatedPackageManifest {
  path: string;
  value: Record<string, unknown>;
}

interface PackageContext {
  includeDevDependencies: boolean;
  manifest: LocatedPackageManifest;
  resolver: NodeRequire;
}

interface DeclaredKovoDependency {
  name: string;
  optional: boolean;
}

/**
 * Build the path-free, timestamp-free identity block required by SPEC.md §5.2.3.
 * Exported only as an internal test seam; production resolves these inputs before app evaluation.
 */
export function createKovoArtifactProvenance(
  inputs: ArtifactProvenanceInputs,
): KovoArtifactProvenance {
  const graphSchemaVersion = inputs.graphSchemaVersion ?? KOVO_GRAPH_SCHEMA_VERSION;
  if (graphSchemaVersion.length === 0) {
    throw new TypeError('Kovo graph schema version must be non-empty.');
  }
  if (inputs.securityGuarantees.schema !== KOVO_GUARANTEE_REGISTER_SCHEMA) {
    throw new TypeError(
      `Kovo security guarantee schema must be ${KOVO_GUARANTEE_REGISTER_SCHEMA}.`,
    );
  }
  requireSha256(inputs.securityGuarantees.canonicalHash, 'security guarantee canonical hash');

  return {
    frameworkPackages: normalizeFrameworkPackages(inputs.frameworkPackages),
    graphSchemaVersion,
    pnpmLock: {
      contentHash: sha256(inputs.pnpmLockBytes),
    },
    schema: KOVO_ARTIFACT_PROVENANCE_SCHEMA,
    securityGuarantees: {
      canonicalHash: inputs.securityGuarantees.canonicalHash,
      schema: KOVO_GUARANTEE_REGISTER_SCHEMA,
    },
  };
}

/** Resolve the immutable provenance inputs used by one `kovo build` invocation (SPEC.md §5.2.3). */
export function resolveKovoArtifactProvenance(
  options: ResolveArtifactProvenanceOptions,
): KovoArtifactProvenance {
  const appModulePath = resolve(options.appModulePath);
  const cliEntryPath = realpathSync(resolve(options.cliEntryPath ?? defaultCliEntryPath));
  const lockfilePath = findNearestFile(dirname(appModulePath), 'pnpm-lock.yaml');
  if (lockfilePath === undefined) {
    throw new Error(
      `kovo build requires a pnpm-lock.yaml ancestor for artifact provenance (SPEC §5.2.3): ${appModulePath}`,
    );
  }

  const cliManifest = exactPackageManifest(cliEntryPath, '@kovojs/cli');
  if (cliManifest === undefined) {
    throw new Error(`kovo build could not resolve the executing @kovojs/cli package manifest.`);
  }

  return createKovoArtifactProvenance({
    frameworkPackages: resolveKovoFrameworkPackageVersions({
      appModulePath,
      cliEntryPath,
      cliManifest,
      lockfilePath,
    }),
    pnpmLockBytes: readFileSync(lockfilePath),
    securityGuarantees: securityGuaranteeIdentity(cliManifest),
  });
}

function resolveKovoFrameworkPackageVersions(options: {
  appModulePath: string;
  cliEntryPath: string;
  cliManifest: LocatedPackageManifest;
  lockfilePath: string;
}): KovoArtifactFrameworkPackage[] {
  const packages = new Map<string, KovoArtifactFrameworkPackage>();
  const contexts: PackageContext[] = [];
  const visitedManifestPaths = new Set<string>();
  appendPackageContext(
    contexts,
    visitedManifestPaths,
    packages,
    options.cliManifest,
    options.cliEntryPath,
  );

  const appManifestPath = findNearestFile(dirname(options.appModulePath), 'package.json', {
    stopDir: dirname(options.lockfilePath),
  });
  if (appManifestPath !== undefined) {
    const result = readJsonRecord(appManifestPath);
    if (!result.ok) {
      throw new Error(`kovo build could not read app package manifest ${appManifestPath}.`);
    }
    contexts.push({
      includeDevDependencies: true,
      manifest: { path: realpathSync(appManifestPath), value: result.value },
      resolver: createRequire(pathToFileURL(options.appModulePath)),
    });
  }

  for (let contextIndex = 0; contextIndex < contexts.length; contextIndex += 1) {
    if (contextIndex >= MAX_PACKAGE_CONTEXTS) {
      throw new Error('Kovo artifact provenance exceeded the package-context limit.');
    }
    const context = contexts[contextIndex]!;
    const dependencies = declaredKovoDependencies(context.manifest, context.includeDevDependencies);
    for (let dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex += 1) {
      const dependency = dependencies[dependencyIndex]!;
      const manifest = resolvePackageManifest(context.resolver, dependency.name);
      if (manifest === undefined) {
        if (dependency.optional) continue;
        throw new Error(
          `kovo build could not resolve declared framework package ${dependency.name} from ${context.manifest.path}.`,
        );
      }
      appendPackageContext(contexts, visitedManifestPaths, packages, manifest, manifest.path);
    }
  }

  return [...packages.values()].sort(compareFrameworkPackages);
}

function resolvePackageManifest(
  resolver: NodeRequire,
  packageName: string,
): LocatedPackageManifest | undefined {
  try {
    const entryPath = realpathSync(resolver.resolve(packageName));
    const manifest = exactPackageManifest(entryPath, packageName);
    if (manifest !== undefined) return manifest;
  } catch {
    // A package can deliberately omit a root export. Its package-directory position is still
    // resolved by Node's ordered search contexts and must remain visible in artifact identity.
  }

  const searchPaths = resolver.resolve.paths(packageName);
  if (searchPaths === null) return undefined;
  for (const searchPath of searchPaths) {
    const packageRoot = join(searchPath, packageName);
    const candidatePath = join(packageRoot, 'package.json');
    const result = readJsonRecord(candidatePath);
    if (!result.ok) {
      if (result.error.kind === 'not-found' && !existsSync(packageRoot)) continue;
      throw new Error(
        `kovo build could not read framework package manifest ${candidatePath} (${result.error.kind}).`,
      );
    }
    if (result.value.name !== packageName) {
      throw new Error(`${candidatePath}: package name must be ${packageName}.`);
    }
    try {
      return { path: realpathSync(candidatePath), value: result.value };
    } catch {
      throw new Error(
        `kovo build could not canonicalize framework package manifest ${candidatePath}.`,
      );
    }
  }
  return undefined;
}

function appendPackageContext(
  contexts: PackageContext[],
  visitedManifestPaths: Set<string>,
  packages: Map<string, KovoArtifactFrameworkPackage>,
  manifest: LocatedPackageManifest,
  entryPath: string,
): void {
  const name = manifestString(manifest, 'name');
  const version = manifestString(manifest, 'version');
  if (!KOVO_PACKAGE_NAME_PATTERN.test(name)) {
    throw new Error(`Kovo artifact provenance rejected non-framework package name ${name}.`);
  }
  packages.set(`${name}\0${version}`, { name, version });

  const canonicalManifestPath = realpathSync(manifest.path);
  if (visitedManifestPaths.has(canonicalManifestPath)) return;
  visitedManifestPaths.add(canonicalManifestPath);
  contexts.push({
    includeDevDependencies: false,
    manifest: { path: canonicalManifestPath, value: manifest.value },
    resolver: createRequire(pathToFileURL(entryPath)),
  });
}

function declaredKovoDependencies(
  manifest: LocatedPackageManifest,
  includeDevDependencies: boolean,
): DeclaredKovoDependency[] {
  const dependencies = new Map<string, boolean>();
  appendDependencyMap(dependencies, manifest, 'dependencies', false);
  appendDependencyMap(dependencies, manifest, 'optionalDependencies', true);
  appendPeerDependencyMap(dependencies, manifest);
  if (includeDevDependencies) appendDependencyMap(dependencies, manifest, 'devDependencies', false);
  return [...dependencies.entries()]
    .map(([name, optional]) => ({ name, optional }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

function appendDependencyMap(
  dependencies: Map<string, boolean>,
  manifest: LocatedPackageManifest,
  field: 'dependencies' | 'devDependencies' | 'optionalDependencies',
  optional: boolean,
): void {
  const value = manifest.value[field];
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw new Error(`${manifest.path}: ${field} must be an object.`);
  }
  for (const name of Object.keys(value)) {
    if (!KOVO_PACKAGE_NAME_PATTERN.test(name)) continue;
    if (typeof value[name] !== 'string') {
      throw new Error(`${manifest.path}: ${field}.${name} must be a string.`);
    }
    dependencies.set(name, (dependencies.get(name) ?? true) && optional);
  }
}

function appendPeerDependencyMap(
  dependencies: Map<string, boolean>,
  manifest: LocatedPackageManifest,
): void {
  const peers = manifest.value.peerDependencies;
  if (peers === undefined) return;
  if (!isRecord(peers)) {
    throw new Error(`${manifest.path}: peerDependencies must be an object.`);
  }
  const peerMeta = manifest.value.peerDependenciesMeta;
  if (peerMeta !== undefined && !isRecord(peerMeta)) {
    throw new Error(`${manifest.path}: peerDependenciesMeta must be an object.`);
  }
  for (const name of Object.keys(peers)) {
    if (!KOVO_PACKAGE_NAME_PATTERN.test(name)) continue;
    if (typeof peers[name] !== 'string') {
      throw new Error(`${manifest.path}: peerDependencies.${name} must be a string.`);
    }
    const metadata = isRecord(peerMeta) ? peerMeta[name] : undefined;
    const optional = isRecord(metadata) && metadata.optional === true;
    dependencies.set(name, (dependencies.get(name) ?? true) && optional);
  }
}

function exactPackageManifest(
  entryPath: string,
  expectedName: string,
): LocatedPackageManifest | undefined {
  let directory = dirname(resolve(entryPath));
  for (let depth = 0; depth < 64; depth += 1) {
    const manifestPath = resolve(directory, 'package.json');
    const result = readJsonRecord(manifestPath);
    if (result.ok) {
      return result.value.name === expectedName
        ? { path: manifestPath, value: result.value }
        : undefined;
    }
    if (result.error.kind !== 'not-found') return undefined;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
  return undefined;
}

function securityGuaranteeIdentity(
  cliManifest: LocatedPackageManifest,
): KovoArtifactProvenance['securityGuarantees'] {
  const metadata = cliManifest.value.kovoBuildProvenance;
  if (!isRecord(metadata)) {
    throw new Error(`${cliManifest.path}: kovoBuildProvenance must be an object.`);
  }
  const guarantee = metadata.securityGuarantees;
  if (!isRecord(guarantee)) {
    throw new Error(
      `${cliManifest.path}: kovoBuildProvenance.securityGuarantees must be an object.`,
    );
  }
  const schema = guarantee.schema;
  const canonicalHash = guarantee.canonicalHash;
  if (schema !== KOVO_GUARANTEE_REGISTER_SCHEMA) {
    throw new Error(
      `${cliManifest.path}: security guarantee schema must be ${KOVO_GUARANTEE_REGISTER_SCHEMA}.`,
    );
  }
  if (typeof canonicalHash !== 'string') {
    throw new Error(`${cliManifest.path}: security guarantee canonicalHash must be a string.`);
  }
  requireSha256(canonicalHash, 'security guarantee canonical hash');
  return { canonicalHash, schema };
}

function manifestString(manifest: LocatedPackageManifest, field: 'name' | 'version'): string {
  const value = manifest.value[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${manifest.path}: ${field} must be a non-empty string.`);
  }
  return value;
}

function normalizeFrameworkPackages(
  frameworkPackages: readonly KovoArtifactFrameworkPackage[],
): KovoArtifactFrameworkPackage[] {
  const packages = new Map<string, KovoArtifactFrameworkPackage>();
  for (const frameworkPackage of frameworkPackages) {
    if (!KOVO_PACKAGE_NAME_PATTERN.test(frameworkPackage.name)) {
      throw new TypeError(`Invalid Kovo framework package name ${frameworkPackage.name}.`);
    }
    if (!KOVO_PACKAGE_VERSION_PATTERN.test(frameworkPackage.version)) {
      throw new TypeError(
        `Kovo framework package ${frameworkPackage.name} has an invalid semantic version.`,
      );
    }
    packages.set(`${frameworkPackage.name}\0${frameworkPackage.version}`, {
      name: frameworkPackage.name,
      version: frameworkPackage.version,
    });
  }
  if (packages.size === 0) {
    throw new TypeError('Kovo artifact provenance requires at least one framework package.');
  }
  return [...packages.values()].sort(compareFrameworkPackages);
}

function compareFrameworkPackages(
  left: KovoArtifactFrameworkPackage,
  right: KovoArtifactFrameworkPackage,
): number {
  return compareStrings(left.name, right.name) || compareStrings(left.version, right.version);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: string | Uint8Array): string {
  return `sha256:${hash('sha256', bytes, 'hex')}`;
}

function requireSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new TypeError(`Kovo ${label} must be sha256:<64 lowercase hex>.`);
  }
}

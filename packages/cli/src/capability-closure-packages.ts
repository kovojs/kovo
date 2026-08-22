import { Buffer as NativeBuffer } from 'node:buffer';
import { createHash as builtinCreateHash } from 'node:crypto';
import {
  closeSync as builtinCloseSync,
  existsSync as builtinExistsSync,
  fstatSync as builtinFstatSync,
  lstatSync as builtinLstatSync,
  openSync as builtinOpenSync,
  readFileSync as builtinReadFileSync,
  readSync as builtinReadSync,
  readdirSync as builtinReaddirSync,
  realpathSync as builtinRealpathSync,
} from 'node:fs';
import { createRequire as builtinCreateRequire } from 'node:module';
import {
  dirname as builtinDirname,
  isAbsolute as builtinIsAbsolute,
  join as builtinJoin,
  parse as builtinParsePath,
  relative as builtinRelative,
  resolve as builtinResolve,
} from 'node:path';
import { fileURLToPath as builtinFileURLToPath, pathToFileURL } from 'node:url';

import {
  isCompilerOwnedCapabilityPackage,
  isZeroPublicRequestClosedCapabilityPackage,
  packageCapabilitySummarySchema,
  type CapabilityPackageRequest,
  type PackageCapabilitySummary,
  type PackageCapabilitySummaryEntry,
  type PackageCapabilitySummaryExport,
  type RawCapabilityKind,
  type ResolvedCapabilityPackage,
} from '@kovojs/compiler/internal';

const capabilitySummaryDocumentSchema = 'kovo-package-capability-summaries/v1' as const;
const nativeImportMetaResolve = (specifier: string, parent: string): string =>
  import.meta.resolve(specifier, parent);
const frameworkSourceImplementationPrefix = 'kovo-source-tree-sha256:';
const frameworkPackedImplementationPrefix = 'kovo-packed-tree-sha256:';
const builtinBufferAllocUnsafe = NativeBuffer.allocUnsafe.bind(NativeBuffer);
const builtinBufferByteLength = NativeBuffer.byteLength.bind(NativeBuffer);
const builtinBufferFrom = NativeBuffer.from.bind(NativeBuffer);
const builtinBigInt = globalThis.BigInt;
const builtinNumber = globalThis.Number;

const capabilityKinds = new Set<RawCapabilityKind>([
  'crypto-acquisition',
  'database-driver',
  'digest',
  'dynamic-loader',
  'filesystem',
  'network',
  'process',
  'vm',
  'worker',
]);

const dispositions = new Set<PackageCapabilitySummaryExport['disposition']>([
  'framework-door',
  'pure',
  'raw',
]);

interface CapabilityPackageResolutionOptions {
  /** @internal Test/performance observer; never supplies or alters identity. */
  readonly onImplementationTreeWalk?: (packageRoot: string, layout: 'packed' | 'source') => void;
  /** @internal Invocation-local byte-pin metadata; never crosses a build phase. */
  readonly onImplementationSnapshot?: (snapshot: FrameworkImplementationSnapshot) => void;
}

interface FrameworkImplementationFileSnapshot {
  readonly canonicalPath: string;
  readonly contentDigest: string;
  readonly lexicalPath: string;
  readonly relativePath: string;
  readonly size: number;
}

interface FrameworkImplementationSnapshot {
  readonly canonicalImplementationRoot: string;
  readonly files: readonly FrameworkImplementationFileSnapshot[];
  readonly implementationDigest: string;
  readonly implementationRoot: string;
  readonly layout: 'packed' | 'source';
  readonly packageRoot: string;
}

const frameworkImplementationMaxFiles = 10_000;
const frameworkImplementationMaxBytes = 512 * 1024 * 1024;
const frameworkImplementationMaxDepth = 64;

/** Invocation-confined package resolver with exact source-byte pinning and final recensus. */
export interface CapabilityPackageImportSession {
  readonly assertPinnedSource: (sourcePath: string, source: string) => void;
  readonly finalize: () => void;
  readonly pinResolvedSource: (sourcePath: string) => void;
  readonly resolve: (
    specifier: string,
    importerPath: string,
  ) => ResolvedCapabilityPackage | undefined;
  readonly revoke: () => void;
}

/** Resolve exact package identity/conditional-export facts without evaluating package code. */
export function resolveCapabilityPackages(
  requests: readonly CapabilityPackageRequest[],
  importerPath: string,
  options: CapabilityPackageResolutionOptions = {},
): ResolvedCapabilityPackage[] {
  const facts: ResolvedCapabilityPackage[] = [];
  const implementationDigestCache = new Map<string, string | undefined>();
  for (const request of requests) {
    const requestImporter =
      request.importer === undefined
        ? importerPath
        : builtinResolve(builtinDirname(importerPath), request.importer);
    const fact = resolveCapabilityPackage(
      request.specifier,
      requestImporter,
      implementationDigestCache,
      options,
    );
    if (fact !== undefined) {
      facts.push(request.importer === undefined ? fact : { ...fact, importer: request.importer });
    }
  }
  return facts.sort(
    (left, right) =>
      (left.importer ?? '').localeCompare(right.importer ?? '') ||
      left.specifier.localeCompare(right.specifier),
  );
}

/** Re-resolve one exact import at a supported loader boundary (SPEC §6.6). @internal */
export function resolveCapabilityPackageImport(
  specifier: string,
  importerPath: string,
): ResolvedCapabilityPackage | undefined {
  return resolveCapabilityPackage(specifier, importerPath, new Map(), {});
}

/**
 * Share only one authenticated implementation-tree snapshot within one Vite plugin invocation.
 * Package manifests, exports, roots, versions, and conditions are still re-resolved for every
 * edge. Loaded framework source is checked against the snapshot before downstream transforms can
 * evaluate it, and a fresh whole-tree census is required before results escape (SPEC §5.2 rule 9
 * / §6.6).
 *
 * @internal
 */
export function createCapabilityPackageImportSession(
  options: CapabilityPackageResolutionOptions = {},
): CapabilityPackageImportSession {
  const implementationDigestCache = new Map<string, string | undefined>();
  const implementationFiles = new Map<string, FrameworkImplementationFileSnapshot>();
  const implementationRoots: string[] = [];
  const observations = new Map<string, number>();
  const observationList: Array<{
    readonly fact: ResolvedCapabilityPackage | undefined;
    readonly importerPath: string;
    readonly specifier: string;
  }> = [];
  let state: 'finalized' | 'open' | 'revoked' = 'open';

  const revoke = (): void => {
    state = 'revoked';
    implementationDigestCache.clear();
    implementationFiles.clear();
    implementationRoots.length = 0;
    observations.clear();
    observationList.length = 0;
  };
  const resolutionOptions: CapabilityPackageResolutionOptions = {
    onImplementationSnapshot(snapshot) {
      for (const implementationRoot of [
        snapshot.implementationRoot,
        snapshot.canonicalImplementationRoot,
      ]) {
        if (!implementationRoots.includes(implementationRoot)) {
          implementationRoots.push(implementationRoot);
        }
      }
      for (let index = 0; index < snapshot.files.length; index += 1) {
        const file = snapshot.files[index]!;
        for (const identityPath of [file.lexicalPath, file.canonicalPath]) {
          const previous = implementationFiles.get(identityPath);
          if (previous !== undefined && canonicalJson(previous) !== canonicalJson(file)) {
            throw new TypeError(
              `Kovo framework implementation file ${file.relativePath} has conflicting invocation snapshots.`,
            );
          }
          implementationFiles.set(identityPath, file);
        }
      }
    },
    ...(options.onImplementationTreeWalk === undefined
      ? {}
      : { onImplementationTreeWalk: options.onImplementationTreeWalk }),
  };

  return Object.freeze({
    assertPinnedSource(sourcePath: string, source: string) {
      if (state !== 'open') {
        throw new TypeError(
          `Kovo capability package import session is ${state}; no further source may load.`,
        );
      }
      const lexicalPath = builtinResolve(sourcePath);
      let canonicalPath: string | undefined;
      let isRegularFile = false;
      try {
        isRegularFile = builtinLstatSync(lexicalPath).isFile();
        canonicalPath = builtinRealpathSync(lexicalPath);
      } catch {
        // The exact snapshotted lexical identity check below owns the diagnostic.
      }
      const expected =
        implementationFiles.get(lexicalPath) ??
        (canonicalPath === undefined ? undefined : implementationFiles.get(canonicalPath));
      if (expected === undefined) {
        for (let index = 0; index < implementationRoots.length; index += 1) {
          const implementationRoot = implementationRoots[index]!;
          if (
            pathIsStrictlyWithin(implementationRoot, lexicalPath) ||
            (canonicalPath !== undefined && pathIsStrictlyWithin(implementationRoot, canonicalPath))
          ) {
            revoke();
            throw new TypeError(
              `Kovo framework implementation file ${lexicalPath} appeared outside the phase snapshot before Vite evaluation.`,
            );
          }
        }
        return;
      }
      if (!isRegularFile || canonicalPath === undefined) {
        revoke();
        throw new TypeError(
          `Kovo framework implementation file ${expected.relativePath} changed identity before Vite evaluation.`,
        );
      }
      if (canonicalPath !== expected.canonicalPath) {
        revoke();
        throw new TypeError(
          `Kovo framework implementation file ${expected.relativePath} changed identity before Vite evaluation.`,
        );
      }
      const size = builtinBufferByteLength(source, 'utf8');
      const contentDigest = `sha256:${builtinCreateHash('sha256').update(source, 'utf8').digest('hex')}`;
      if (size !== expected.size || contentDigest !== expected.contentDigest) {
        revoke();
        throw new TypeError(
          `Kovo framework implementation file ${expected.relativePath} changed before Vite evaluation.`,
        );
      }
    },
    finalize() {
      if (state === 'finalized') return;
      if (state === 'revoked') {
        throw new TypeError('Kovo capability package import session is revoked.');
      }
      try {
        const finalDigestCache = new Map<string, string | undefined>();
        const finalOptions: CapabilityPackageResolutionOptions =
          options.onImplementationTreeWalk === undefined
            ? {}
            : { onImplementationTreeWalk: options.onImplementationTreeWalk };
        for (let index = 0; index < observationList.length; index += 1) {
          const observation = observationList[index]!;
          const current = resolveCapabilityPackage(
            observation.specifier,
            observation.importerPath,
            finalDigestCache,
            finalOptions,
          );
          if (canonicalJson(current) !== canonicalJson(observation.fact)) {
            throw new TypeError(
              `Kovo capability package ${observation.specifier} changed before build-phase publication.`,
            );
          }
        }
        state = 'finalized';
      } catch (error) {
        revoke();
        throw error;
      }
    },
    pinResolvedSource(sourcePath: string) {
      if (state !== 'open') {
        throw new TypeError(`Kovo capability package import session is ${state}.`);
      }
      const lexicalPath = builtinResolve(sourcePath);
      let canonicalPath: string;
      try {
        if (!builtinLstatSync(lexicalPath).isFile()) {
          throw new TypeError('resolved framework implementation is not a regular file');
        }
        canonicalPath = builtinRealpathSync(lexicalPath);
      } catch {
        revoke();
        throw new TypeError(
          'Kovo resolved framework implementation changed identity before source pinning.',
        );
      }
      const expected =
        implementationFiles.get(lexicalPath) ?? implementationFiles.get(canonicalPath);
      if (expected === undefined || canonicalPath !== expected.canonicalPath) {
        revoke();
        throw new TypeError(
          'Kovo resolved framework implementation is outside the authenticated phase snapshot.',
        );
      }
      implementationFiles.set(lexicalPath, expected);
      let lexicalImplementationRoot = lexicalPath;
      const relativeSegments = expected.relativePath.split('/');
      for (let index = 0; index < relativeSegments.length; index += 1) {
        lexicalImplementationRoot = builtinDirname(lexicalImplementationRoot);
      }
      if (!implementationRoots.includes(lexicalImplementationRoot)) {
        implementationRoots.push(lexicalImplementationRoot);
      }
    },
    resolve(specifier: string, importerPath: string) {
      if (state !== 'open') {
        throw new TypeError(`Kovo capability package import session is ${state}.`);
      }
      const fact = resolveCapabilityPackage(
        specifier,
        importerPath,
        implementationDigestCache,
        resolutionOptions,
      );
      const key = canonicalJson([specifier, importerPath]);
      const previousIndex = observations.get(key);
      const previous = previousIndex === undefined ? undefined : observationList[previousIndex];
      if (previous !== undefined && canonicalJson(previous.fact) !== canonicalJson(fact)) {
        revoke();
        throw new TypeError(
          `Kovo capability package ${specifier} changed during import resolution.`,
        );
      }
      if (previous === undefined) {
        observations.set(key, observationList.length);
        observationList.push({ fact, importerPath, specifier });
      }
      return fact;
    },
    revoke,
  });
}

/**
 * Verify that a bundler's exact consumed file is one of the selected package export targets.
 * The manifest fingerprint binds all conditional arms; this check binds the current lane's choice.
 * @internal
 */
export function capabilityPackageResolvedTargetMatches(
  specifier: string,
  importerPath: string,
  resolvedId: string,
): boolean {
  return capabilityPackageResolvedTargetRoot(specifier, importerPath, resolvedId) !== undefined;
}

/** Return the exact owning package root only when the bundler target matches package resolution. */
export function capabilityPackageResolvedTargetRoot(
  specifier: string,
  importerPath: string,
  resolvedId: string,
): string | undefined {
  const packageName = packageNameForSpecifier(specifier);
  const manifestPath = resolvedPackageManifestPath(specifier, packageName, importerPath);
  if (manifestPath === undefined) return undefined;
  let manifest: Record<string, unknown>;
  try {
    manifest = requiredRecord(
      JSON.parse(builtinReadFileSync(manifestPath, 'utf8')) as unknown,
      manifestPath,
      undefined,
    );
  } catch {
    return undefined;
  }
  if (ownValue(manifest, 'name') !== packageName) return undefined;
  const cleanResolvedId = resolvedId.split(/[?#]/u, 1)[0] ?? resolvedId;
  if (!builtinIsAbsolute(cleanResolvedId)) return undefined;
  const actualManifestPath = findNearestPackageManifest(cleanResolvedId);
  if (actualManifestPath === undefined) return undefined;
  let canonicalManifestPath: string;
  let canonicalActualManifestPath: string;
  try {
    canonicalManifestPath = builtinRealpathSync(manifestPath);
    canonicalActualManifestPath = builtinRealpathSync(actualManifestPath);
  } catch {
    return undefined;
  }
  if (canonicalManifestPath !== canonicalActualManifestPath) return undefined;

  const packageRoot = builtinDirname(canonicalManifestPath);
  const resolution = packageExportResolution(manifest, packageSubpath(specifier));
  if (!resolution.resolved) return undefined;
  let canonicalActual: string;
  try {
    canonicalActual = builtinRealpathSync(cleanResolvedId);
  } catch {
    return undefined;
  }
  const targetMatches = resolution.targets.some((target) => {
    if (!target.startsWith('./')) return false;
    try {
      const candidate = builtinRealpathSync(builtinResolve(packageRoot, target));
      const relative = slashPath(builtinRelative(packageRoot, candidate));
      return (
        relative !== '' &&
        relative !== '..' &&
        !relative.startsWith('../') &&
        !builtinIsAbsolute(relative) &&
        candidate === canonicalActual
      );
    } catch {
      return false;
    }
  });
  return targetMatches ? packageRoot : undefined;
}

/** Load the optional committed project review ledger. Malformed authority fails before app load. */
export function readCapabilityPackageSummaries(root: string): PackageCapabilitySummary[] {
  const fileName = builtinJoin(root, 'kovo.capabilities.json');
  if (!builtinExistsSync(fileName)) return [];
  let input: unknown;
  try {
    input = JSON.parse(builtinReadFileSync(fileName, 'utf8')) as unknown;
  } catch (error) {
    throw new TypeError(
      `Kovo capability summaries are not valid JSON: ${fileName}. ${errorMessage(error)}`,
    );
  }
  const document = requiredRecord(input, '$', ['packages', 'schema']);
  if (document.schema !== capabilitySummaryDocumentSchema) {
    throw new TypeError(
      `Kovo capability summaries $.schema must equal ${capabilitySummaryDocumentSchema}.`,
    );
  }
  if (!Array.isArray(document.packages)) {
    throw new TypeError('Kovo capability summaries $.packages must be an array.');
  }
  return document.packages.map((value, index) =>
    parsePackageSummary(value, `$.packages[${index}]`, slashPath(builtinRelative(root, fileName))),
  );
}

/** Stable installed-manifest fingerprint authors copy into `kovo.capabilities.json`. */
export function capabilityManifestFingerprint(manifest: Readonly<Record<string, unknown>>): string {
  const securityShape = {
    browser: orderPreservingManifestValue(ownValue(manifest, 'browser')),
    bundleDependencies: orderPreservingManifestValue(ownValue(manifest, 'bundleDependencies')),
    bundledDependencies: orderPreservingManifestValue(ownValue(manifest, 'bundledDependencies')),
    dependencies: orderPreservingManifestValue(ownValue(manifest, 'dependencies')),
    exports: orderPreservingManifestValue(ownValue(manifest, 'exports')),
    imports: orderPreservingManifestValue(ownValue(manifest, 'imports')),
    main: ownValue(manifest, 'main'),
    module: ownValue(manifest, 'module'),
    name: ownValue(manifest, 'name'),
    optionalDependencies: orderPreservingManifestValue(ownValue(manifest, 'optionalDependencies')),
    peerDependencies: orderPreservingManifestValue(ownValue(manifest, 'peerDependencies')),
    peerDependenciesMeta: orderPreservingManifestValue(ownValue(manifest, 'peerDependenciesMeta')),
    sideEffects: orderPreservingManifestValue(ownValue(manifest, 'sideEffects')),
    type: ownValue(manifest, 'type'),
    version: ownValue(manifest, 'version'),
  };
  return `sha256:${builtinCreateHash('sha256').update(canonicalJson(securityShape)).digest('hex')}`;
}

function resolveCapabilityPackage(
  specifier: string,
  importerPath: string,
  implementationDigestCache: Map<string, string | undefined>,
  options: CapabilityPackageResolutionOptions,
): ResolvedCapabilityPackage | undefined {
  const packageName = packageNameForSpecifier(specifier);
  const manifestPath = resolvedPackageManifestPath(specifier, packageName, importerPath);
  if (manifestPath === undefined) return undefined;
  let manifest: Record<string, unknown>;
  try {
    manifest = requiredRecord(
      JSON.parse(builtinReadFileSync(manifestPath, 'utf8')) as unknown,
      `${manifestPath}`,
      undefined,
    );
  } catch {
    return undefined;
  }
  const observedName = ownValue(manifest, 'name');
  const observedVersion = ownValue(manifest, 'version');
  if (typeof observedName !== 'string' || typeof observedVersion !== 'string') return undefined;
  const exportResolution = packageExportResolution(manifest, packageSubpath(specifier));
  const implementationDigest =
    exportResolution.resolved &&
    observedName === packageName &&
    isCompilerOwnedCapabilityPackage(observedName) &&
    !isZeroPublicRequestClosedCapabilityPackage(observedName)
      ? installedFrameworkImplementationDigest(
          builtinDirname(manifestPath),
          exportResolution.targets,
          implementationDigestCache,
          options,
        )
      : undefined;
  return {
    conditions: exportResolution.conditions,
    exportStatus: exportResolution.resolved ? 'resolved' : 'unresolved',
    ...(implementationDigest === undefined ? {} : { implementationDigest }),
    manifestFingerprint: capabilityManifestFingerprint(manifest),
    packageName: observedName,
    packageVersion: observedVersion,
    specifier,
  };
}

function resolvedPackageManifestPath(
  specifier: string,
  packageName: string,
  importerPath: string,
): string | undefined {
  const importerUrl = pathToFileURL(importerPath).href;
  const require = builtinCreateRequire(importerUrl);
  const candidates: string[] = [];
  try {
    const resolved = require.resolve(`${packageName}/package.json`);
    if (builtinIsAbsolute(resolved)) candidates.push(resolved);
  } catch {
    // Export maps commonly hide package.json; resolve executable targets below.
  }
  for (const request of [specifier, packageName]) {
    try {
      const resolved = require.resolve(request);
      // Node built-ins resolve to `node:*` (or a bare built-in name), not a filesystem path.
      // They remain visible to the raw-capability classifier but cannot own package metadata.
      if (builtinIsAbsolute(resolved)) candidates.push(resolved);
    } catch {
      // The ESM condition can still resolve an import-only package.
    }
    try {
      const resolved = nativeImportMetaResolve(request, importerUrl);
      if (resolved.startsWith('file:')) candidates.push(builtinFileURLToPath(resolved));
    } catch {
      // Absence is represented by no metadata fact; the compiler closes it with provenance.
    }
  }
  for (const candidate of candidates) {
    const found = findOwningPackageManifest(candidate, packageName);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findOwningPackageManifest(start: string, packageName: string): string | undefined {
  let current: string;
  try {
    current = builtinDirname(builtinRealpathSync(start));
  } catch {
    return undefined;
  }
  const root = builtinParsePath(current).root;
  for (let depth = 0; depth < 64; depth += 1) {
    const candidate = builtinJoin(current, 'package.json');
    if (builtinExistsSync(candidate)) {
      try {
        const value = JSON.parse(builtinReadFileSync(candidate, 'utf8')) as unknown;
        if (isRecord(value) && ownValue(value, 'name') === packageName) return candidate;
      } catch {
        // Keep walking: a nested malformed manifest cannot authorize the requested package.
      }
    }
    if (current === root) return undefined;
    current = builtinDirname(current);
  }
  return undefined;
}

function findNearestPackageManifest(start: string): string | undefined {
  let current: string;
  try {
    current = builtinDirname(builtinRealpathSync(start));
  } catch {
    return undefined;
  }
  const root = builtinParsePath(current).root;
  for (let depth = 0; depth < 64; depth += 1) {
    const candidate = builtinJoin(current, 'package.json');
    if (builtinExistsSync(candidate)) return candidate;
    if (current === root) return undefined;
    current = builtinDirname(current);
  }
  return undefined;
}

function packageExportResolution(
  manifest: Readonly<Record<string, unknown>>,
  subpath: string,
): { conditions: string[]; resolved: boolean; targets: string[] } {
  const exportsValue = ownValue(manifest, 'exports');
  if (exportsValue === undefined) {
    const main = ownValue(manifest, 'main');
    const module = ownValue(manifest, 'module');
    const browser = ownValue(manifest, 'browser');
    const targets = new Set(
      [main, module].filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      ),
    );
    const hasBrowserTarget = appendBrowserTargets(browser, targets);
    return {
      conditions: hasBrowserTarget ? ['browser', 'default'] : ['default'],
      resolved: subpath === '.' && targets.size > 0,
      targets: [...targets].sort(),
    };
  }
  const target = selectExportTarget(exportsValue, subpath);
  if (target === undefined || target === null) {
    return { conditions: [], resolved: false, targets: [] };
  }
  const conditions = new Set<string>();
  const targets = new Set<string>();
  const hasTarget = collectExportConditions(target, conditions, targets);
  const browser = ownValue(manifest, 'browser');
  if (appendBrowserTargets(browser, targets)) conditions.add('browser');
  if (conditions.size === 0 && hasTarget) conditions.add('default');
  return {
    conditions: [...conditions].sort(),
    resolved: hasTarget,
    targets: [...targets].sort(),
  };
}

function selectExportTarget(exportsValue: unknown, subpath: string): unknown {
  if (!isRecord(exportsValue)) return subpath === '.' ? exportsValue : undefined;
  const keys = Object.keys(exportsValue);
  const hasSubpathKeys = keys.some((key) => key === '.' || key.startsWith('./'));
  if (!hasSubpathKeys) return subpath === '.' ? exportsValue : undefined;
  if (Object.hasOwn(exportsValue, subpath)) return ownValue(exportsValue, subpath);
  const pattern = keys
    .filter((key) => key.includes('*') && exportPatternMatches(key, subpath))
    .sort(compareExportPatterns)[0];
  if (pattern === undefined) return undefined;
  const star = pattern.indexOf('*');
  const match = subpath.slice(star, subpath.length - (pattern.length - star - 1));
  return substituteExportPattern(ownValue(exportsValue, pattern), match);
}

function substituteExportPattern(value: unknown, match: string): unknown {
  if (typeof value === 'string') return value.replaceAll('*', match);
  if (Array.isArray(value)) return value.map((entry) => substituteExportPattern(entry, match));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    result[key] = substituteExportPattern(ownValue(value, key), match);
  }
  return result;
}

function appendBrowserTargets(browser: unknown, targets: Set<string>): boolean {
  if (typeof browser === 'string' && browser.length > 0) {
    targets.add(browser);
    return true;
  }
  if (!isRecord(browser)) return false;
  let found = false;
  for (const [source, target] of Object.entries(browser)) {
    if (typeof target !== 'string' || target.length === 0) continue;
    if (targets.has(source) || targets.has(source.startsWith('./') ? source : `./${source}`)) {
      targets.add(target);
      found = true;
    }
  }
  return found;
}

function collectExportConditions(
  value: unknown,
  conditions: Set<string>,
  targets: Set<string>,
): boolean {
  if (typeof value === 'string') {
    if (value.length > 0) targets.add(value);
    return value.length > 0;
  }
  if (value === null) return false;
  if (Array.isArray(value)) {
    let found = false;
    for (const entry of value) {
      found = collectExportConditions(entry, conditions, targets) || found;
    }
    return found;
  }
  if (!isRecord(value)) return false;
  let found = false;
  for (const key of Object.keys(value)) {
    if (key === '.' || key.startsWith('./')) return false;
    conditions.add(key);
    found = collectExportConditions(ownValue(value, key), conditions, targets) || found;
  }
  return found;
}

function installedFrameworkImplementationDigest(
  packageRoot: string,
  targets: readonly string[],
  cache: Map<string, string | undefined>,
  options: CapabilityPackageResolutionOptions,
): string | undefined {
  const layout = implementationLayout(packageRoot, targets);
  if (layout === undefined) return undefined;
  try {
    const realPackageRoot = builtinRealpathSync(packageRoot);
    const cacheKey = `${realPackageRoot}\0${layout}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    options.onImplementationTreeWalk?.(realPackageRoot, layout);
    const identity = frameworkImplementationTreeIdentity(
      realPackageRoot,
      layout,
      options.onImplementationSnapshot !== undefined,
    );
    const implementationDigest = `${layout === 'source' ? frameworkSourceImplementationPrefix : frameworkPackedImplementationPrefix}${identity.digest}`;
    cache.set(cacheKey, implementationDigest);
    if (identity.files !== undefined) {
      const lexicalPackageRoot = builtinResolve(packageRoot);
      options.onImplementationSnapshot?.({
        canonicalImplementationRoot: identity.implementationRoot,
        files: Object.freeze(
          identity.files.map((file) =>
            Object.freeze({
              ...file,
              lexicalPath: builtinResolve(lexicalPackageRoot, file.relativePath),
            }),
          ),
        ),
        implementationDigest,
        implementationRoot: builtinJoin(lexicalPackageRoot, layout === 'source' ? 'src' : 'dist'),
        layout,
        packageRoot: realPackageRoot,
      });
    }
    return implementationDigest;
  } catch {
    // A missing, escaping, symlinked, or structurally unexpected implementation is not identity.
    // The compiler observes the absent digest and closes the first-party verdict (SPEC §6.6).
    try {
      cache.set(`${builtinRealpathSync(packageRoot)}\0${layout}`, undefined);
    } catch {
      // No stable real root means there is no cacheable installed identity.
    }
    return undefined;
  }
}

function implementationLayout(
  packageRoot: string,
  targets: readonly string[],
): 'packed' | 'source' | undefined {
  let layout: 'packed' | 'source' | undefined;
  for (const target of targets) {
    if (!target.startsWith('./')) return undefined;
    const relativeTarget = slashPath(
      builtinRelative(packageRoot, builtinJoin(packageRoot, target)),
    );
    if (
      relativeTarget === '' ||
      relativeTarget === '..' ||
      relativeTarget.startsWith('../') ||
      builtinIsAbsolute(relativeTarget)
    ) {
      return undefined;
    }
    const targetLayout = relativeTarget.startsWith('src/')
      ? 'source'
      : relativeTarget.startsWith('dist/')
        ? 'packed'
        : undefined;
    if (targetLayout === undefined || (layout !== undefined && layout !== targetLayout)) {
      return undefined;
    }
    layout = targetLayout;
  }
  return layout;
}

function frameworkImplementationTreeIdentity(
  packageRoot: string,
  layout: 'packed' | 'source',
  retainFiles: boolean,
): {
  readonly digest: string;
  readonly files?: readonly FrameworkImplementationFileSnapshot[];
  readonly implementationRoot: string;
} {
  const implementationRoot = builtinJoin(packageRoot, layout === 'source' ? 'src' : 'dist');
  if (!builtinExistsSync(implementationRoot)) {
    throw new Error('framework implementation is missing');
  }
  if (!builtinLstatSync(implementationRoot).isDirectory()) {
    throw new Error('framework implementation root is not a directory');
  }
  const files: string[] = [];
  visitImplementationTree(implementationRoot, (fileName) => {
    if (files.length >= frameworkImplementationMaxFiles) {
      throw new Error('framework implementation exceeds the file-count bound');
    }
    files.push(fileName);
  });
  const hash = builtinCreateHash('sha256');
  const snapshots: FrameworkImplementationFileSnapshot[] = [];
  let totalBytes = 0;
  for (const fileName of [...files].sort(compareStrings)) {
    const relativePath = slashPath(builtinRelative(packageRoot, fileName));
    const lexicalPath = builtinResolve(fileName);
    const { bytes, canonicalPath } = readStableImplementationFile(
      lexicalPath,
      frameworkImplementationMaxBytes - totalBytes,
    );
    if (canonicalPath !== fileName) {
      throw new Error('framework implementation file does not have one canonical path');
    }
    const byteLength = builtinBufferByteLength(bytes);
    totalBytes += byteLength;
    if (totalBytes > frameworkImplementationMaxBytes) {
      throw new Error('framework implementation exceeds the byte bound');
    }
    if (countFrameworkDigestMarkers(bytes) > 0) {
      throw new Error('framework digest is embedded in the implementation tree');
    }
    hash.update(relativePath);
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
    if (retainFiles) {
      snapshots.push(
        Object.freeze({
          canonicalPath,
          contentDigest: `sha256:${builtinCreateHash('sha256').update(bytes).digest('hex')}`,
          lexicalPath,
          relativePath,
          size: byteLength,
        }),
      );
    }
  }
  return {
    digest: hash.digest('hex'),
    ...(retainFiles ? { files: Object.freeze(snapshots) } : {}),
    implementationRoot,
  };
}

function readStableImplementationFile(
  fileName: string,
  maxBytes: number,
): { readonly bytes: NativeBuffer; readonly canonicalPath: string } {
  const lexicalBefore = builtinLstatSync(fileName, { bigint: true });
  if (!lexicalBefore.isFile()) {
    throw new Error('framework implementation tree contains a non-file entry');
  }
  const canonicalBefore = builtinRealpathSync(fileName);
  const descriptor = builtinOpenSync(fileName, 'r');
  let bytes: NativeBuffer;
  let descriptorBefore: ReturnType<typeof builtinFstatSync>;
  let descriptorAfter: ReturnType<typeof builtinFstatSync>;
  try {
    descriptorBefore = builtinFstatSync(descriptor, { bigint: true });
    if (descriptorBefore.size > builtinBigInt(maxBytes)) {
      throw new Error('framework implementation exceeds the byte bound');
    }
    const expectedBytes = builtinNumber(descriptorBefore.size);
    bytes = builtinBufferAllocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = builtinReadSync(descriptor, bytes, offset, expectedBytes - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const overflow = builtinBufferAllocUnsafe(1);
    const overflowBytes = builtinReadSync(descriptor, overflow, 0, 1, expectedBytes);
    if (offset !== expectedBytes || overflowBytes !== 0) {
      throw new Error('framework implementation file changed size during its authenticated read');
    }
    descriptorAfter = builtinFstatSync(descriptor, { bigint: true });
  } finally {
    builtinCloseSync(descriptor);
  }
  const lexicalAfter = builtinLstatSync(fileName, { bigint: true });
  const canonicalAfter = builtinRealpathSync(fileName);
  if (
    !descriptorBefore.isFile() ||
    !descriptorAfter.isFile() ||
    lexicalBefore.dev !== descriptorBefore.dev ||
    lexicalBefore.ino !== descriptorBefore.ino ||
    lexicalAfter.dev !== descriptorAfter.dev ||
    lexicalAfter.ino !== descriptorAfter.ino ||
    descriptorBefore.dev !== descriptorAfter.dev ||
    descriptorBefore.ino !== descriptorAfter.ino ||
    descriptorBefore.size !== descriptorAfter.size ||
    descriptorBefore.mtimeNs !== descriptorAfter.mtimeNs ||
    descriptorBefore.ctimeNs !== descriptorAfter.ctimeNs ||
    descriptorAfter.size !== builtinBigInt(builtinBufferByteLength(bytes)) ||
    canonicalBefore !== canonicalAfter
  ) {
    throw new Error('framework implementation file changed during its authenticated read');
  }
  return { bytes, canonicalPath: canonicalAfter };
}

function pathIsStrictlyWithin(root: string, candidate: string): boolean {
  const relativePath = slashPath(builtinRelative(root, candidate));
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith('../') &&
    !builtinIsAbsolute(relativePath)
  );
}

function visitImplementationTree(
  directory: string,
  appendFile: (fileName: string, entryName: string) => void,
  depth = 0,
): void {
  if (depth > frameworkImplementationMaxDepth) {
    throw new Error('framework implementation exceeds the directory-depth bound');
  }
  for (const entry of builtinReaddirSync(directory, { withFileTypes: true })) {
    const absolute = builtinJoin(directory, entry.name);
    if (entry.isDirectory()) {
      visitImplementationTree(absolute, appendFile, depth + 1);
      continue;
    }
    if (!entry.isFile()) throw new Error('implementation tree contains a non-file entry');
    appendFile(absolute, entry.name);
  }
}

function countFrameworkDigestMarkers(input: NativeBuffer): number {
  return [frameworkSourceImplementationPrefix, frameworkPackedImplementationPrefix].reduce(
    (count, prefix) => count + countDigestPayloads(input, prefix),
    0,
  );
}

function countDigestPayloads(input: NativeBuffer, prefixText: string): number {
  const prefix = builtinBufferFrom(prefixText);
  let matches = 0;
  let offset = 0;
  while (offset < input.length) {
    const found = input.indexOf(prefix, offset);
    if (found < 0) break;
    const start = found + prefix.length;
    const end = start + 64;
    const candidate = input.subarray(start, end).toString('ascii');
    const next = input[end];
    if (/^[a-f0-9]{64}$/u.test(candidate) && (next === undefined || !isLowerHexByte(next))) {
      matches += 1;
    }
    offset = Math.max(end, found + 1);
  }
  return matches;
}

function isLowerHexByte(value: number): boolean {
  return (value >= 0x30 && value <= 0x39) || (value >= 0x61 && value <= 0x66);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exportPatternMatches(pattern: string, subpath: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return false;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return subpath.startsWith(prefix) && subpath.endsWith(suffix);
}

function compareExportPatterns(left: string, right: string): number {
  const leftStar = left.indexOf('*');
  const rightStar = right.indexOf('*');
  const leftBaseLength = leftStar < 0 ? left.length : leftStar + 1;
  const rightBaseLength = rightStar < 0 ? right.length : rightStar + 1;
  if (leftBaseLength !== rightBaseLength) return rightBaseLength - leftBaseLength;
  if (leftStar < 0) return 1;
  if (rightStar < 0) return -1;
  if (left.length !== right.length) return right.length - left.length;
  return 0;
}

function parsePackageSummary(
  input: unknown,
  path: string,
  source: string,
): PackageCapabilitySummary {
  const value = requiredRecord(input, path, [
    'entries',
    'manifestFingerprint',
    'packageName',
    'packageVersion',
    'schema',
    'summaryVersion',
  ]);
  const packageName = requiredString(value, 'packageName', path);
  const packageVersion = requiredString(value, 'packageVersion', path);
  const manifestFingerprint = requiredString(value, 'manifestFingerprint', path);
  const summaryVersion = requiredString(value, 'summaryVersion', path);
  if (value.schema !== packageCapabilitySummarySchema) {
    throw new TypeError(`${path}.schema must equal ${packageCapabilitySummarySchema}.`);
  }
  if (!Array.isArray(value.entries)) throw new TypeError(`${path}.entries must be an array.`);
  return {
    entries: value.entries.map((entry, index) =>
      parseSummaryEntry(entry, `${path}.entries[${index}]`),
    ),
    manifestFingerprint,
    packageName,
    packageVersion,
    schema: packageCapabilitySummarySchema,
    source,
    summaryVersion,
  };
}

function parseSummaryEntry(input: unknown, path: string): PackageCapabilitySummaryEntry {
  const value = requiredRecord(input, path, ['conditions', 'exports', 'subpath']);
  const subpath = requiredString(value, 'subpath', path);
  const conditions = requiredStringArray(value, 'conditions', path);
  if (!Array.isArray(value.exports)) throw new TypeError(`${path}.exports must be an array.`);
  return {
    conditions,
    exports: value.exports.map((entry, index) =>
      parseSummaryExport(entry, `${path}.exports[${index}]`),
    ),
    subpath,
  };
}

function parseSummaryExport(input: unknown, path: string): PackageCapabilitySummaryExport {
  const value = requiredRecord(input, path, ['capabilities', 'disposition', 'name']);
  const name = requiredString(value, 'name', path);
  const capabilities = requiredStringArray(value, 'capabilities', path);
  for (const capability of capabilities) {
    if (!capabilityKinds.has(capability as RawCapabilityKind)) {
      throw new TypeError(`${path}.capabilities contains unknown capability ${capability}.`);
    }
  }
  if (!dispositions.has(value.disposition as PackageCapabilitySummaryExport['disposition'])) {
    throw new TypeError(`${path}.disposition is not pure, raw, or framework-door.`);
  }
  return {
    capabilities: capabilities as RawCapabilityKind[],
    disposition: value.disposition as PackageCapabilitySummaryExport['disposition'],
    name,
  };
}

function requiredRecord(
  input: unknown,
  path: string,
  allowedKeys: readonly string[] | undefined,
): Record<string, unknown> {
  if (!isRecord(input)) throw new TypeError(`${path} must be an object.`);
  if (allowedKeys !== undefined) {
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) throw new TypeError(`${path}.${key} is not a supported field.`);
    }
  }
  return input;
}

function requiredString(value: Record<string, unknown>, key: string, path: string): string {
  const found = ownValue(value, key);
  if (typeof found !== 'string' || found.trim() === '') {
    throw new TypeError(`${path}.${key} must be a non-empty string.`);
  }
  return found;
}

function requiredStringArray(value: Record<string, unknown>, key: string, path: string): string[] {
  const found = ownValue(value, key);
  if (!Array.isArray(found) || found.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${path}.${key} must be an array of strings.`);
  }
  return [...new Set(found)].sort((left, right) => left.localeCompare(right)) as string[];
}

/** Preserve order where Node/Vite treat object insertion order as conditional-export semantics. */
function orderPreservingManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderPreservingManifestValue);
  if (!isRecord(value)) return value;
  return {
    entries: Object.keys(value).map((key) => [
      key,
      orderPreservingManifestValue(ownValue(value, key)),
    ]),
  };
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => ownValue(value, key) !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(ownValue(value, key))}`);
    return `{${entries.join(',')}}`;
  }
  if (value === undefined) return 'null';
  throw new TypeError(`Package manifest contains unsupported ${typeof value} value.`);
}

function packageNameForSpecifier(specifier: string): string {
  if (!specifier.startsWith('@')) return specifier.split('/')[0] ?? specifier;
  const parts = specifier.split('/');
  return parts.length > 1 ? `${parts[0]}/${parts[1]}` : specifier;
}

function packageSubpath(specifier: string): string {
  const packageName = packageNameForSpecifier(specifier);
  return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function slashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

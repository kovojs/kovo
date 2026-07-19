import { createHash as builtinCreateHash } from 'node:crypto';
import {
  existsSync as builtinExistsSync,
  lstatSync as builtinLstatSync,
  readFileSync as builtinReadFileSync,
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
} from 'node:path';
import { fileURLToPath as builtinFileURLToPath, pathToFileURL } from 'node:url';

import {
  isCompilerOwnedCapabilityPackage,
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
const frameworkCompilerSelfSourceImplementationPrefix = 'kovo-compiler-self-source-tree-sha256:';
const frameworkCompilerSelfPackedImplementationPrefix = 'kovo-compiler-self-packed-tree-sha256:';
const frameworkCompilerPackage = '@kovojs/compiler';
const frameworkCompilerSourceCatalogFile =
  'src/security/framework-public-runtime-export-posture.generated.ts';
const frameworkCompilerPackedCatalogFiles = new Set(['dist/internal.mjs', 'dist/internal.mjs.map']);

const capabilityKinds = new Set<RawCapabilityKind>([
  'database-driver',
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
    const fact = resolveCapabilityPackage(
      request.specifier,
      importerPath,
      implementationDigestCache,
      options,
    );
    if (fact !== undefined) facts.push(fact);
  }
  return facts.sort((left, right) => left.specifier.localeCompare(right.specifier));
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
    exports: ownValue(manifest, 'exports'),
    imports: ownValue(manifest, 'imports'),
    main: ownValue(manifest, 'main'),
    module: ownValue(manifest, 'module'),
    name: ownValue(manifest, 'name'),
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
    isCompilerOwnedCapabilityPackage(observedName)
      ? installedFrameworkImplementationDigest(
          builtinDirname(manifestPath),
          observedName,
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

function packageExportResolution(
  manifest: Readonly<Record<string, unknown>>,
  subpath: string,
): { conditions: string[]; resolved: boolean; targets: string[] } {
  const exportsValue = ownValue(manifest, 'exports');
  if (exportsValue === undefined) {
    const main = ownValue(manifest, 'main');
    const module = ownValue(manifest, 'module');
    const targets = [main, module].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    return {
      conditions: ['default'],
      resolved: subpath === '.' && targets.length > 0,
      targets,
    };
  }
  const target = selectExportTarget(exportsValue, subpath);
  if (target === undefined || target === null) {
    return { conditions: [], resolved: false, targets: [] };
  }
  const conditions = new Set<string>();
  const targets = new Set<string>();
  const hasTarget = collectExportConditions(target, conditions, targets);
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
    .sort((left, right) => exportPatternSpecificity(right) - exportPatternSpecificity(left))[0];
  return pattern === undefined ? undefined : ownValue(exportsValue, pattern);
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
  packageName: string,
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
    const digest =
      layout === 'source'
        ? sourceTreeSha256(realPackageRoot, packageName)
        : packedTreeSha256(realPackageRoot, packageName);
    const implementationDigest = `${layout === 'source' ? frameworkSourceImplementationPrefix : frameworkPackedImplementationPrefix}${digest}`;
    cache.set(cacheKey, implementationDigest);
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

function sourceTreeSha256(packageRoot: string, packageName: string): string {
  const sourceRoot = builtinJoin(packageRoot, 'src');
  if (!builtinExistsSync(sourceRoot)) throw new Error('source implementation is missing');
  if (!builtinLstatSync(sourceRoot).isDirectory()) {
    throw new Error('source implementation root is not a directory');
  }
  const files: string[] = [];
  visitImplementationTree(sourceRoot, (fileName) => files.push(fileName));
  let normalizedCompilerCatalog = false;
  const digest = digestFiles(packageRoot, files, (fileName) => {
    const relativeFileName = slashPath(builtinRelative(packageRoot, fileName));
    const bytes = Buffer.from(builtinReadFileSync(fileName));
    if (
      packageName === frameworkCompilerPackage &&
      relativeFileName === frameworkCompilerSourceCatalogFile
    ) {
      const normalized = normalizeCompilerCatalogSelfDigests(bytes);
      requireExactCompilerSelfDigests(normalized);
      normalizedCompilerCatalog = true;
      return normalized.bytes;
    }
    if (countFrameworkDigestMarkers(bytes) > 0) {
      throw new Error('framework digest escaped the compiler catalog artifact');
    }
    return bytes;
  });
  if (packageName === frameworkCompilerPackage && !normalizedCompilerCatalog) {
    throw new Error('compiler source catalog artifact is missing');
  }
  return digest;
}

function packedTreeSha256(packageRoot: string, packageName: string): string {
  const distRoot = builtinJoin(packageRoot, 'dist');
  if (!builtinExistsSync(distRoot)) throw new Error('packed implementation is missing');
  if (!builtinLstatSync(distRoot).isDirectory()) {
    throw new Error('packed implementation root is not a directory');
  }
  const files: string[] = [];
  visitImplementationTree(distRoot, (fileName) => files.push(fileName));
  const normalizedCatalogs = new Set<string>();
  const digest = digestFiles(packageRoot, files, (fileName) => {
    const relativeFileName = slashPath(builtinRelative(packageRoot, fileName));
    const bytes = Buffer.from(builtinReadFileSync(fileName));
    const isCompilerCatalog =
      packageName === frameworkCompilerPackage &&
      frameworkCompilerPackedCatalogFiles.has(relativeFileName);
    if (isCompilerCatalog) {
      const normalized = normalizeCompilerCatalogSelfDigests(bytes);
      requireExactCompilerSelfDigests(normalized);
      normalizedCatalogs.add(relativeFileName);
      return normalized.bytes;
    }
    if (countFrameworkDigestMarkers(bytes) > 0) {
      throw new Error('framework digest escaped the compiler catalog artifact');
    }
    return bytes;
  });
  if (
    packageName === frameworkCompilerPackage &&
    normalizedCatalogs.size !== frameworkCompilerPackedCatalogFiles.size
  ) {
    throw new Error('compiler catalog artifact is missing');
  }
  return digest;
}

function visitImplementationTree(
  directory: string,
  appendFile: (fileName: string, entryName: string) => void,
): void {
  for (const entry of builtinReaddirSync(directory, { withFileTypes: true })) {
    const absolute = builtinJoin(directory, entry.name);
    if (entry.isDirectory()) {
      visitImplementationTree(absolute, appendFile);
      continue;
    }
    if (!entry.isFile()) throw new Error('implementation tree contains a non-file entry');
    appendFile(absolute, entry.name);
  }
}

function digestFiles(
  packageRoot: string,
  files: readonly string[],
  readFile: (fileName: string) => Buffer | undefined,
): string {
  const hash = builtinCreateHash('sha256');
  for (const fileName of [...files].sort(compareStrings)) {
    hash.update(slashPath(builtinRelative(packageRoot, fileName)));
    hash.update('\0');
    const bytes = readFile(fileName);
    if (bytes !== undefined) hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function normalizeCompilerCatalogSelfDigests(input: Buffer): {
  bytes: Buffer;
  packedMatches: number;
  sourceMatches: number;
} {
  const bytes = Buffer.from(input);
  const sourceMatches = normalizeDigestPayloads(
    bytes,
    frameworkCompilerSelfSourceImplementationPrefix,
  );
  const packedMatches = normalizeDigestPayloads(
    bytes,
    frameworkCompilerSelfPackedImplementationPrefix,
  );
  return { bytes, packedMatches, sourceMatches };
}

function requireExactCompilerSelfDigests(normalized: {
  packedMatches: number;
  sourceMatches: number;
}): void {
  if (normalized.sourceMatches !== 1 || normalized.packedMatches !== 1) {
    throw new Error('compiler catalog self-digests are ambiguous');
  }
}

function normalizeDigestPayloads(bytes: Buffer, prefixText: string): number {
  const prefix = Buffer.from(prefixText);
  let matches = 0;
  let offset = 0;
  while (offset < bytes.length) {
    const found = bytes.indexOf(prefix, offset);
    if (found < 0) break;
    const start = found + prefix.length;
    const end = start + 64;
    const candidate = bytes.subarray(start, end).toString('ascii');
    const next = bytes[end];
    if (/^[a-f0-9]{64}$/u.test(candidate) && (next === undefined || !isLowerHexByte(next))) {
      bytes.fill(0x30, start, end);
      matches += 1;
    }
    offset = Math.max(end, found + 1);
  }
  return matches;
}

function countFrameworkDigestMarkers(input: Buffer): number {
  return [
    frameworkSourceImplementationPrefix,
    frameworkPackedImplementationPrefix,
    frameworkCompilerSelfSourceImplementationPrefix,
    frameworkCompilerSelfPackedImplementationPrefix,
  ].reduce((count, prefix) => count + countDigestPayloads(input, prefix), 0);
}

function countDigestPayloads(input: Buffer, prefixText: string): number {
  const prefix = Buffer.from(prefixText);
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

function exportPatternSpecificity(pattern: string): number {
  return pattern.replace('*', '').length;
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

import {
  createFrameworkOutputFileSystemBoundary,
  pathRelativeToRoot,
} from '@kovojs/core/internal/filesystem';

import {
  buildOwnDataProperty,
  buildSecurityPathBasename,
  buildSecurityPathDirname,
  buildSecurityPathJoin,
  buildSecurityPathRelative,
  buildSecurityPathResolve,
  buildSecuritySha256Hex,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import {
  createSecuritySet,
  securityIsUint8Array,
  securitySetAdd,
  securitySetHas,
  securityUint8ArraySlice,
} from './response-security-intrinsics.js';
import { witnessFreeze } from './security-witness-intrinsics.js';

/**
 * @internal Manifest-backed artifact staging primitive for build/export output (SPEC.md §9.5).
 * Callers own domain-specific planning and diagnostics; this layer owns root confinement,
 * hash-aware writes, atomic temp-write/rename commits, check/dry-run modes, and planned cleanup.
 */
export interface ArtifactOutputEntry {
  kind?: string;
  label: string;
  targetPath: string;
  content?: string | Uint8Array;
  sourcePath?: string;
}

/**
 * @internal Result item returned by artifact staging dry-run/check/write modes.
 */
export interface ArtifactOutputManifestEntry {
  hash: string;
  label: string;
  relativePath: string;
  targetPath: string;
}

/**
 * @internal Stale output cleanup hook. `enumerate` returns already-resolved paths under `root`;
 * the writer removes paths not present in the current output manifest.
 */
export interface ArtifactOutputCleanup {
  enumerate(root: string): Promise<readonly string[]>;
}

/**
 * @internal Domain-specific error factory used by build/export surfaces to preserve their
 * existing diagnostics while sharing the staging mechanics.
 */
export interface ArtifactOutputDiagnostics {
  root?(root: string, reason: string): Error;
  target?(entry: ArtifactOutputEntry, reason: string): Error;
}

export interface WriteArtifactOutputOptions {
  cleanup?: ArtifactOutputCleanup;
  diagnostics?: ArtifactOutputDiagnostics;
  mode?: 'write' | 'check' | 'dry-run';
  stagingPrefix?: string;
  validateTargets?: boolean;
}

export interface WriteArtifactOutputResult {
  changed: readonly ArtifactOutputManifestEntry[];
  manifest: readonly ArtifactOutputManifestEntry[];
  mode: 'write' | 'check' | 'dry-run';
  stale: readonly string[];
}

interface PinnedArtifactOutputEntry extends ArtifactOutputEntry {
  readonly content?: string | Uint8Array;
  readonly kind?: string;
  readonly label: string;
  readonly sourcePath?: string;
  readonly targetPath: string;
}

export class ArtifactOutputCheckError extends Error {
  readonly changed: readonly ArtifactOutputManifestEntry[];
  readonly stale: readonly string[];

  constructor(
    message: string,
    changed: readonly ArtifactOutputManifestEntry[],
    stale: readonly string[],
  ) {
    super(message);
    this.name = 'ArtifactOutputCheckError';
    this.changed = changed;
    this.stale = stale;
  }
}

export async function writeArtifactOutput(
  root: string,
  entries: readonly ArtifactOutputEntry[],
  options: WriteArtifactOutputOptions = {},
): Promise<WriteArtifactOutputResult> {
  const mode = options.mode ?? 'write';
  const resolvedRoot = buildSecurityPathResolve(root);
  const fileSystem = createFrameworkOutputFileSystemBoundary(resolvedRoot);
  // SPEC §6.6 boundary rule: classification, hashing, staging, and commit all consume this one
  // framework-owned snapshot. Caller arrays, getters, and mutable Uint8Array bytes are never
  // re-read after the manifest decision.
  const pinnedEntries = snapshotArtifactOutputEntries(entries);
  const manifest = await artifactOutputManifest(resolvedRoot, pinnedEntries, options.diagnostics);
  const changed = mode === 'dry-run' ? [] : await changedArtifactOutputEntries(manifest);
  const stale = options.cleanup
    ? await staleArtifactOutputPaths(resolvedRoot, manifest, options.cleanup)
    : [];

  if (options.validateTargets) {
    await validateArtifactOutputTargets(resolvedRoot, pinnedEntries, manifest, options.diagnostics);
  }
  if (mode === 'dry-run') return { changed, manifest, mode, stale };
  if (mode === 'check') {
    if (changed.length > 0 || stale.length > 0) {
      throw new ArtifactOutputCheckError(
        `Artifact output drift: ${changed.length} changed, ${stale.length} stale`,
        changed,
        stale,
      );
    }
    return { changed, manifest, mode, stale };
  }

  await assertArtifactOutputRoot(resolvedRoot, options.diagnostics);
  if (manifest.length > 0) {
    const stagingRoot = await fileSystem.createStagingRoot(options.stagingPrefix);
    const stagingFileSystem = createFrameworkOutputFileSystemBoundary(stagingRoot);
    try {
      for (let index = 0; index < pinnedEntries.length; index += 1) {
        const entry = pinnedEntries[index]!;
        await writeStagedArtifactOutput(entry, manifest[index]!.relativePath, stagingFileSystem);
      }
      // Re-hash the staged bytes before rename. This closes both mutable-source TOCTOU and any
      // substituted staging write: the committed bytes must match the reviewed manifest exactly.
      await assertStagedArtifactOutputMatchesManifest(
        stagingFileSystem,
        pinnedEntries,
        manifest,
        options.diagnostics,
      );
      await validateArtifactOutputTargets(
        resolvedRoot,
        pinnedEntries,
        manifest,
        options.diagnostics,
      );
      await commitArtifactOutput(resolvedRoot, stagingRoot, manifest);
    } finally {
      await stagingFileSystem.removeTree();
    }
  }
  for (let index = 0; index < stale.length; index += 1) {
    const stalePath = stale[index]!;
    const relativePath = pathRelativeToRoot(resolvedRoot, stalePath);
    if (relativePath !== undefined) await fileSystem.deleteFile(relativePath);
  }
  return { changed, manifest, mode, stale };
}

async function artifactOutputManifest(
  root: string,
  entries: readonly PinnedArtifactOutputEntry[],
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<ArtifactOutputManifestEntry[]> {
  const seen = createSecuritySet<string>();
  const manifest: ArtifactOutputManifestEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    assertArtifactOutputEntryShape(entry);
    const targetPath = buildSecurityPathResolve(entry.targetPath);
    const relativePath = assertArtifactOutputTarget(root, entry, targetPath, diagnostics);
    if (securitySetHas(seen, relativePath)) {
      throw targetError(entry, `duplicate artifact target '${relativePath}'`, diagnostics);
    }
    securitySetAdd(seen, relativePath);
    manifest[manifest.length] = {
      hash: await artifactOutputHash(entry),
      label: entry.label,
      relativePath,
      targetPath,
    };
  }
  return manifest;
}

function snapshotArtifactOutputEntries(
  entries: readonly ArtifactOutputEntry[],
): readonly PinnedArtifactOutputEntry[] {
  const sourceEntries = snapshotBuildArray(entries, 'artifact output entries');
  const pinned: PinnedArtifactOutputEntry[] = [];
  for (let index = 0; index < sourceEntries.length; index += 1) {
    const raw = sourceEntries[index];
    if (typeof raw !== 'object' || raw === null) {
      throw new TypeError(`Artifact output entry ${index} must be an object.`);
    }

    const label = requiredArtifactOutputString(raw, 'label', index);
    const targetPath = requiredArtifactOutputString(raw, 'targetPath', index);
    const kindProperty = buildOwnDataProperty(raw, 'kind', `artifact output entry ${index}.kind`);
    const contentProperty = buildOwnDataProperty(
      raw,
      'content',
      `artifact output entry ${index}.content`,
    );
    const sourcePathProperty = buildOwnDataProperty(
      raw,
      'sourcePath',
      `artifact output entry ${index}.sourcePath`,
    );

    const entry: PinnedArtifactOutputEntry = {
      label,
      targetPath,
      ...(kindProperty.present && kindProperty.value !== undefined
        ? { kind: requiredArtifactOutputString(kindProperty.value, `entry ${index}.kind`) }
        : {}),
      ...(contentProperty.present && contentProperty.value !== undefined
        ? { content: snapshotArtifactOutputContent(contentProperty.value, index) }
        : {}),
      ...(sourcePathProperty.present && sourcePathProperty.value !== undefined
        ? {
            sourcePath: requiredArtifactOutputString(
              sourcePathProperty.value,
              `entry ${index}.sourcePath`,
            ),
          }
        : {}),
    };
    assertArtifactOutputEntryShape(entry);
    pinned[pinned.length] = witnessFreeze(entry);
  }
  return witnessFreeze(pinned);
}

function requiredArtifactOutputString(
  value: object,
  property: 'label' | 'targetPath',
  index: number,
): string;
function requiredArtifactOutputString(value: unknown, label: string): string;
function requiredArtifactOutputString(
  value: unknown,
  propertyOrLabel: string,
  index?: number,
): string {
  if (index !== undefined) {
    const property = buildOwnDataProperty(
      value as object,
      propertyOrLabel,
      `artifact output entry ${index}.${propertyOrLabel}`,
    );
    if (!property.present || typeof property.value !== 'string') {
      throw new TypeError(`Artifact output entry ${index} must declare string ${propertyOrLabel}.`);
    }
    return property.value;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Artifact output ${propertyOrLabel} must be a string.`);
  }
  return value;
}

function snapshotArtifactOutputContent(value: unknown, index: number): string | Uint8Array {
  if (typeof value === 'string') return value;
  if (securityIsUint8Array(value)) return securityUint8ArraySlice(value, 0);
  throw new TypeError(`Artifact output entry ${index}.content must be a string or Uint8Array.`);
}

function assertArtifactOutputEntryShape(entry: ArtifactOutputEntry): void {
  if ((entry.content === undefined) === (entry.sourcePath === undefined)) {
    throw new Error(
      `Artifact output '${entry.label}' must declare exactly one of content or sourcePath.`,
    );
  }
}

function assertArtifactOutputTarget(
  root: string,
  entry: ArtifactOutputEntry,
  targetPath: string,
  diagnostics?: ArtifactOutputDiagnostics,
): string {
  const relativePath = buildSecurityPathRelative(root, targetPath);
  if (pathRelativeToRoot(root, targetPath) === undefined) {
    throw targetError(entry, `target '${targetPath}' escapes output root '${root}'`, diagnostics);
  }
  return relativePath;
}

async function assertArtifactOutputRoot(
  root: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  try {
    await fileSystem.ensureDirectory();
  } catch {
    throw rootError(root, `output root '${root}' is not a directory`, diagnostics);
  }
}

async function changedArtifactOutputEntries(
  manifest: readonly ArtifactOutputManifestEntry[],
): Promise<ArtifactOutputManifestEntry[]> {
  const changed: ArtifactOutputManifestEntry[] = [];
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index]!;
    const fileSystem = createFrameworkOutputFileSystemBoundary(
      buildSecurityPathDirname(entry.targetPath),
    );
    const current = await fileSystem.fileBytes(buildSecurityPathBasename(entry.targetPath));
    if (current === undefined) {
      changed[changed.length] = entry;
      continue;
    }
    if (sha256(current) !== entry.hash) changed[changed.length] = entry;
  }
  return changed;
}

async function staleArtifactOutputPaths(
  root: string,
  manifest: readonly ArtifactOutputManifestEntry[],
  cleanup: ArtifactOutputCleanup,
): Promise<string[]> {
  const owned = createSecuritySet<string>();
  for (let index = 0; index < manifest.length; index += 1) {
    securitySetAdd(owned, manifest[index]!.targetPath);
  }
  const candidates = snapshotBuildArray(
    await cleanup.enumerate(root),
    'artifact cleanup candidates',
  );
  const stale: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate !== 'string') {
      throw new TypeError(`Artifact cleanup candidate ${index} must be a string.`);
    }
    const resolved = buildSecurityPathResolve(candidate);
    if (pathRelativeToRoot(root, resolved) === undefined) continue;
    if (!securitySetHas(owned, resolved)) stale[stale.length] = resolved;
  }
  return stale;
}

async function writeStagedArtifactOutput(
  entry: PinnedArtifactOutputEntry,
  relativePath: string,
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
): Promise<void> {
  if (entry.sourcePath !== undefined) {
    await fileSystem.copyFile(entry.sourcePath, relativePath);
    return;
  }
  await fileSystem.writeFile(relativePath, entry.content!);
}

async function assertStagedArtifactOutputMatchesManifest(
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
  entries: readonly PinnedArtifactOutputEntry[],
  manifest: readonly ArtifactOutputManifestEntry[],
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  for (let index = 0; index < manifest.length; index += 1) {
    const manifestEntry = manifest[index]!;
    const bytes = await fileSystem.fileBytes(manifestEntry.relativePath);
    if (bytes === undefined || sha256(bytes) !== manifestEntry.hash) {
      throw targetError(
        entries[index]!,
        `staged bytes for '${manifestEntry.relativePath}' do not match the reviewed artifact hash`,
        diagnostics,
      );
    }
  }
}

async function validateArtifactOutputTargets(
  root: string,
  sourceEntries: readonly PinnedArtifactOutputEntry[],
  manifest: readonly ArtifactOutputManifestEntry[],
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index]!;
    const sourceEntry = sourceEntries[index]!;
    await assertArtifactOutputParents(root, sourceEntry, entry.targetPath, diagnostics);
    await assertArtifactOutputTargetIsNotDirectory(sourceEntry, entry.targetPath, diagnostics);
  }
}

async function commitArtifactOutput(
  root: string,
  stagingRoot: string,
  manifest: readonly ArtifactOutputManifestEntry[],
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  for (let index = 0; index < manifest.length; index += 1) {
    const entry = manifest[index]!;
    const relativePath = buildSecurityPathRelative(root, entry.targetPath);
    await fileSystem.renameFrom(
      artifactOutputStagedPath(root, stagingRoot, entry.targetPath),
      relativePath,
    );
  }
}

async function assertArtifactOutputParents(
  root: string,
  entry: ArtifactOutputEntry,
  targetPath: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  try {
    await fileSystem.validateFileTarget(buildSecurityPathRelative(root, targetPath));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = rawMessage.replace(/^Filesystem parent/u, 'output parent');
    throw targetError(entry, message, diagnostics);
  }
}

async function assertArtifactOutputTargetIsNotDirectory(
  entry: ArtifactOutputEntry,
  targetPath: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(buildSecurityPathDirname(targetPath));
  try {
    await fileSystem.validateFileTarget(buildSecurityPathBasename(targetPath));
  } catch {
    throw targetError(entry, `target '${targetPath}' is a directory`, diagnostics);
  }
}

function artifactOutputStagedPath(root: string, stagingRoot: string, targetPath: string): string {
  return buildSecurityPathJoin(stagingRoot, buildSecurityPathRelative(root, targetPath));
}

async function artifactOutputHash(entry: ArtifactOutputEntry): Promise<string> {
  if (entry.sourcePath !== undefined) {
    const fileSystem = createFrameworkOutputFileSystemBoundary(
      buildSecurityPathDirname(entry.sourcePath),
    );
    const bytes = await fileSystem.fileBytes(buildSecurityPathBasename(entry.sourcePath));
    if (bytes === undefined)
      throw new Error(`Artifact source '${entry.sourcePath}' was not found.`);
    return sha256(bytes);
  }
  return sha256(entry.content!);
}

function sha256(content: string | Uint8Array): string {
  return buildSecuritySha256Hex(content);
}

function targetError(
  entry: ArtifactOutputEntry,
  reason: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Error {
  return (
    diagnostics?.target?.(entry, reason) ??
    new Error(`Artifact output cannot write ${entry.label}: ${reason}.`)
  );
}

function rootError(root: string, reason: string, diagnostics?: ArtifactOutputDiagnostics): Error {
  return (
    diagnostics?.root?.(root, reason) ??
    new Error(`Artifact output cannot write root '${root}': ${reason}.`)
  );
}

import { createHash } from 'node:crypto';
import * as path from 'node:path';

import {
  createFrameworkOutputFileSystemBoundary,
  pathRelativeToRoot,
} from '@kovojs/core/internal/filesystem';

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
  enumerate(root: string): AsyncIterable<string>;
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
  const resolvedRoot = path.resolve(root);
  const fileSystem = createFrameworkOutputFileSystemBoundary(resolvedRoot);
  const manifest = await artifactOutputManifest(resolvedRoot, entries, options.diagnostics);
  const changed = mode === 'dry-run' ? [] : await changedArtifactOutputEntries(manifest);
  const stale = options.cleanup
    ? await staleArtifactOutputPaths(resolvedRoot, manifest, options.cleanup)
    : [];

  if (options.validateTargets) {
    await validateArtifactOutputTargets(resolvedRoot, entries, manifest, options.diagnostics);
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
      await Promise.all(
        entries.map((entry, index) =>
          writeStagedArtifactOutput(
            entry,
            path.relative(resolvedRoot, manifest[index]!.targetPath),
            stagingFileSystem,
          ),
        ),
      );
      await validateArtifactOutputTargets(resolvedRoot, entries, manifest, options.diagnostics);
      await commitArtifactOutput(resolvedRoot, stagingRoot, manifest);
    } finally {
      await stagingFileSystem.removeTree();
    }
  }
  for (const stalePath of stale) {
    const relativePath = pathRelativeToRoot(resolvedRoot, stalePath);
    if (relativePath !== undefined) await fileSystem.deleteFile(relativePath);
  }
  return { changed, manifest, mode, stale };
}

async function artifactOutputManifest(
  root: string,
  entries: readonly ArtifactOutputEntry[],
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<ArtifactOutputManifestEntry[]> {
  const seen = new Set<string>();
  const manifest: ArtifactOutputManifestEntry[] = [];
  for (const entry of entries) {
    assertArtifactOutputEntryShape(entry);
    const targetPath = path.resolve(entry.targetPath);
    const relativePath = assertArtifactOutputTarget(root, entry, targetPath, diagnostics);
    if (seen.has(relativePath)) {
      throw targetError(entry, `duplicate artifact target '${relativePath}'`, diagnostics);
    }
    seen.add(relativePath);
    manifest.push({
      hash: await artifactOutputHash(entry),
      label: entry.label,
      relativePath,
      targetPath,
    });
  }
  return manifest;
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
  const relativePath = path.relative(root, targetPath);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    relativePath.split(path.sep).includes('..')
  ) {
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
  for (const entry of manifest) {
    const fileSystem = createFrameworkOutputFileSystemBoundary(path.dirname(entry.targetPath));
    const current = await fileSystem.fileBytes(path.basename(entry.targetPath));
    if (current === undefined) {
      changed.push(entry);
      continue;
    }
    if (sha256(current) !== entry.hash) changed.push(entry);
  }
  return changed;
}

async function staleArtifactOutputPaths(
  root: string,
  manifest: readonly ArtifactOutputManifestEntry[],
  cleanup: ArtifactOutputCleanup,
): Promise<string[]> {
  const owned = new Set(manifest.map((entry) => entry.targetPath));
  const stale: string[] = [];
  for await (const candidate of cleanup.enumerate(root)) {
    const resolved = path.resolve(candidate);
    if (pathRelativeToRoot(root, resolved) === undefined) continue;
    if (!owned.has(resolved)) stale.push(resolved);
  }
  return stale;
}

async function writeStagedArtifactOutput(
  entry: ArtifactOutputEntry,
  relativePath: string,
  fileSystem: ReturnType<typeof createFrameworkOutputFileSystemBoundary>,
): Promise<void> {
  if (entry.sourcePath !== undefined) {
    await fileSystem.copyFile(entry.sourcePath, relativePath);
    return;
  }
  await fileSystem.writeFile(relativePath, entry.content!);
}

async function validateArtifactOutputTargets(
  root: string,
  sourceEntries: readonly ArtifactOutputEntry[],
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
  for (const entry of manifest) {
    const relativePath = path.relative(root, entry.targetPath);
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
    await fileSystem.validateFileTarget(path.relative(root, targetPath));
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
  const fileSystem = createFrameworkOutputFileSystemBoundary(path.dirname(targetPath));
  try {
    await fileSystem.validateFileTarget(path.basename(targetPath));
  } catch {
    throw targetError(entry, `target '${targetPath}' is a directory`, diagnostics);
  }
}

function artifactOutputStagedPath(root: string, stagingRoot: string, targetPath: string): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}

async function artifactOutputHash(entry: ArtifactOutputEntry): Promise<string> {
  if (entry.sourcePath !== undefined) {
    const fileSystem = createFrameworkOutputFileSystemBoundary(path.dirname(entry.sourcePath));
    const bytes = await fileSystem.fileBytes(path.basename(entry.sourcePath));
    if (bytes === undefined)
      throw new Error(`Artifact source '${entry.sourcePath}' was not found.`);
    return sha256(bytes);
  }
  return sha256(entry.content!);
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
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

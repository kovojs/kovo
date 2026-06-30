import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';

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
    const stagingRoot = await createArtifactOutputStagingRoot(resolvedRoot, options.stagingPrefix);
    try {
      await Promise.all(
        entries.map((entry, index) =>
          writeStagedArtifactOutput(
            entry,
            artifactOutputStagedPath(resolvedRoot, stagingRoot, manifest[index]!.targetPath),
          ),
        ),
      );
      await validateArtifactOutputTargets(resolvedRoot, entries, manifest, options.diagnostics);
      await commitArtifactOutput(resolvedRoot, stagingRoot, manifest);
    } finally {
      await rm(stagingRoot, { force: true, recursive: true });
    }
  }
  for (const stalePath of stale) {
    await rm(stalePath, { force: true });
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
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(root);
  } catch {
    await mkdir(root, { recursive: true });
    rootStat = await lstat(root);
  }
  if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) return;
  throw rootError(root, `output root '${root}' is not a directory`, diagnostics);
}

async function changedArtifactOutputEntries(
  manifest: readonly ArtifactOutputManifestEntry[],
): Promise<ArtifactOutputManifestEntry[]> {
  const changed: ArtifactOutputManifestEntry[] = [];
  for (const entry of manifest) {
    try {
      const current = await readFile(entry.targetPath);
      if (sha256(current) !== entry.hash) changed.push(entry);
    } catch {
      changed.push(entry);
    }
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
    const relativePath = path.relative(root, resolved);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) continue;
    if (!owned.has(resolved)) stale.push(resolved);
  }
  return stale;
}

async function writeStagedArtifactOutput(
  entry: ArtifactOutputEntry,
  targetPath: string,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (entry.sourcePath !== undefined) {
    await access(entry.sourcePath, fsConstants.R_OK);
    await copyFile(entry.sourcePath, targetPath);
    return;
  }
  await writeFile(
    targetPath,
    entry.content!,
    typeof entry.content === 'string' ? 'utf8' : undefined,
  );
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
  for (const entry of manifest) {
    await mkdir(path.dirname(entry.targetPath), { recursive: true });
    await rename(artifactOutputStagedPath(root, stagingRoot, entry.targetPath), entry.targetPath);
  }
}

async function assertArtifactOutputParents(
  root: string,
  entry: ArtifactOutputEntry,
  targetPath: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  const relativeDirectory = path.relative(root, path.dirname(targetPath));
  const segments = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let parentStat: Awaited<ReturnType<typeof lstat>>;
    try {
      parentStat = await lstat(current);
    } catch {
      continue;
    }
    if (parentStat.isSymbolicLink()) {
      throw targetError(entry, `output parent '${current}' is a symbolic link`, diagnostics);
    }
    if (!parentStat.isDirectory()) {
      throw targetError(entry, `output parent '${current}' is not a directory`, diagnostics);
    }
  }
}

async function assertArtifactOutputTargetIsNotDirectory(
  entry: ArtifactOutputEntry,
  targetPath: string,
  diagnostics?: ArtifactOutputDiagnostics,
): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(targetPath);
  } catch {
    return;
  }
  if (!targetStat.isDirectory()) return;
  throw targetError(entry, `target '${targetPath}' is a directory`, diagnostics);
}

async function createArtifactOutputStagingRoot(
  root: string,
  prefix = '.kovo-output-staging-',
): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), prefix));
}

function artifactOutputStagedPath(root: string, stagingRoot: string, targetPath: string): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}

async function artifactOutputHash(entry: ArtifactOutputEntry): Promise<string> {
  if (entry.sourcePath !== undefined) return sha256(await readFile(entry.sourcePath));
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

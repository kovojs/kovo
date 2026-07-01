import { randomUUID } from 'node:crypto';
import { constants as fsConstants, type Dirent } from 'node:fs';
import { createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { blessSink, isBlessedSink } from './sink-policy.js';

type FileSystemBoundarySink = 'filesystem-boundary';

/** @internal Read mode for the framework-owned filesystem boundary. */
export type ConfinedFileSystemReadBody = 'buffer' | 'stream';

/** @internal Options for reading a file through the framework-owned filesystem boundary. */
export interface ConfinedFileSystemReadOptions {
  body?: ConfinedFileSystemReadBody;
}

/** @internal Confined file read result returned by the framework-owned filesystem boundary. */
export interface ConfinedFileSystemReadResult {
  body: ReadableStream<Uint8Array> | Uint8Array;
  fileName: string;
  size: number;
}

/** @internal Directory entry shape returned by the framework-owned filesystem boundary. */
export interface ConfinedFileSystemEntry {
  kind: 'directory' | 'file' | 'other';
  name: string;
  relativePath: string;
}

/** @internal Existing-root filesystem read/write capability with path confinement. */
export interface FrameworkFileSystemBoundary {
  readonly root: string;
  confinedPath(relativePath: string): string | undefined;
  deleteFile(relativePath: string): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
  readFile(
    relativePath: string,
    options?: ConfinedFileSystemReadOptions,
  ): Promise<ConfinedFileSystemReadResult | undefined>;
  statFile(relativePath: string): Promise<{ mtime: Date; size: number } | undefined>;
  writeFile(relativePath: string, body: string | Uint8Array): Promise<void>;
}

/** @internal Output-root filesystem capability for build/export writers with path confinement. */
export interface FrameworkOutputFileSystemBoundary {
  readonly root: string;
  confinedPath(relativePath: string): string | undefined;
  copyFile(sourcePath: string, relativePath: string): Promise<void>;
  createStagingRoot(prefix?: string): Promise<string>;
  deleteFile(relativePath: string): Promise<void>;
  ensureDirectory(): Promise<void>;
  entries(relativePath?: string): AsyncIterable<ConfinedFileSystemEntry>;
  fileBytes(relativePath: string): Promise<Uint8Array | undefined>;
  fileExists(relativePath: string): Promise<boolean>;
  pathForExistingChild(relativePath: string): string | undefined;
  renameFrom(sourcePath: string, relativePath: string): Promise<void>;
  removeTree(): Promise<void>;
  statFile(relativePath: string): Promise<{ mtime: Date; size: number } | undefined>;
  validateFileTarget(relativePath: string): Promise<void>;
  writeFile(relativePath: string, body: string | Uint8Array): Promise<void>;
}

const FILESYSTEM_BOUNDARY_SINK: FileSystemBoundarySink = 'filesystem-boundary';

/** @internal Create a realpath-confined filesystem capability for an existing root. */
export async function createFrameworkFileSystemBoundary(
  root: string,
): Promise<FrameworkFileSystemBoundary> {
  const realRoot = await realpath(root);
  const boundary: FrameworkFileSystemBoundary = {
    root: realRoot,
    confinedPath: (relativePath) => confinedPath(realRoot, relativePath),
    deleteFile: (relativePath) => deleteConfinedFile(realRoot, relativePath),
    fileExists: (relativePath) => confinedFileExists(realRoot, relativePath),
    readFile: (relativePath, options) => readConfinedFile(realRoot, relativePath, options),
    statFile: (relativePath) => statConfinedFile(realRoot, relativePath),
    writeFile: (relativePath, body) => writeConfinedFile(realRoot, relativePath, body),
  };
  return blessSink(FILESYSTEM_BOUNDARY_SINK, Object.freeze(boundary));
}

/** @internal Create a path-confined output filesystem capability for a build/export root. */
export function createFrameworkOutputFileSystemBoundary(
  root: string,
): FrameworkOutputFileSystemBoundary {
  const resolvedRoot = path.resolve(root);
  const boundary: FrameworkOutputFileSystemBoundary = {
    root: resolvedRoot,
    confinedPath: (relativePath) => confinedPath(resolvedRoot, relativePath),
    copyFile: (sourcePath, relativePath) =>
      copyFileIntoRoot(resolvedRoot, sourcePath, relativePath),
    createStagingRoot: (prefix) => createSiblingStagingRoot(resolvedRoot, prefix),
    deleteFile: (relativePath) => deleteConfinedFile(resolvedRoot, relativePath),
    ensureDirectory: () => ensureDirectoryRoot(resolvedRoot),
    entries: (relativePath) => confinedDirectoryEntries(resolvedRoot, relativePath ?? '.'),
    fileBytes: (relativePath) => readConfinedFileBytes(resolvedRoot, relativePath),
    fileExists: (relativePath) => confinedFileExists(resolvedRoot, relativePath),
    pathForExistingChild: (relativePath) => confinedPath(resolvedRoot, relativePath),
    renameFrom: (sourcePath, relativePath) =>
      renameIntoRoot(resolvedRoot, sourcePath, relativePath),
    removeTree: () => rm(resolvedRoot, { force: true, recursive: true }),
    statFile: (relativePath) => statConfinedFile(resolvedRoot, relativePath),
    validateFileTarget: (relativePath) => validateConfinedFileTarget(resolvedRoot, relativePath),
    writeFile: (relativePath, body) => writeConfinedFile(resolvedRoot, relativePath, body),
  };
  return blessSink(FILESYSTEM_BOUNDARY_SINK, Object.freeze(boundary));
}

/** @internal Test/audit hook for the shared Blessed<Sink> witness substrate. */
export function isFrameworkFileSystemBoundary(value: unknown): boolean {
  return isBlessedSink(FILESYSTEM_BOUNDARY_SINK, value);
}

/** @internal Resolve a relative child path only when it stays under the root. */
export function confinedPath(root: string, relativePath: string): string | undefined {
  if (relativePath.includes('\0') || path.isAbsolute(relativePath)) return undefined;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  return containsPath(resolvedRoot, candidate) ? candidate : undefined;
}

/** @internal Return the root-relative form of an already resolved path, or undefined on escape. */
export function pathRelativeToRoot(root: string, targetPath: string): string | undefined {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  if (!containsPath(resolvedRoot, resolvedTarget) || resolvedTarget === resolvedRoot) {
    return undefined;
  }
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (relativePath === '' || relativePath.split(path.sep).includes('..')) return undefined;
  return relativePath;
}

/** @internal Path containment predicate used by framework filesystem boundary callers. */
export function containsPath(root: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

async function readConfinedFile(
  root: string,
  relativePath: string,
  options: ConfinedFileSystemReadOptions = {},
): Promise<ConfinedFileSystemReadResult | undefined> {
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) return undefined;

  const comparisonRoot = (await safeRealpath(root)) ?? path.resolve(root);
  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(comparisonRoot, resolved)) return undefined;

  const handle = await safeOpen(resolved);
  if (handle === undefined) return undefined;

  try {
    const [fileStat, postOpenResolved] = await Promise.all([handle.stat(), safeRealpath(resolved)]);
    if (
      !fileStat.isFile() ||
      postOpenResolved === undefined ||
      !containsPath(comparisonRoot, postOpenResolved)
    ) {
      return undefined;
    }

    return {
      body:
        options.body === 'stream'
          ? (Readable.toWeb(createReadStream(postOpenResolved)) as ReadableStream<Uint8Array>)
          : new Uint8Array(await handle.readFile()),
      fileName: path.basename(postOpenResolved),
      size: fileStat.size,
    };
  } finally {
    await handle.close();
  }
}

async function statConfinedFile(
  root: string,
  relativePath: string,
): Promise<{ mtime: Date; size: number } | undefined> {
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) return undefined;
  const comparisonRoot = (await safeRealpath(root)) ?? path.resolve(root);
  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(comparisonRoot, resolved)) return undefined;
  const fileStat = await stat(resolved).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (fileStat === undefined || !fileStat.isFile()) return undefined;
  return { mtime: fileStat.mtime, size: fileStat.size };
}

async function readConfinedFileBytes(
  root: string,
  relativePath: string,
): Promise<Uint8Array | undefined> {
  const result = await readConfinedFile(root, relativePath);
  return result?.body instanceof Uint8Array ? result.body : undefined;
}

async function confinedFileExists(root: string, relativePath: string): Promise<boolean> {
  return (await statConfinedFile(root, relativePath)) !== undefined;
}

async function writeConfinedFile(root: string, relativePath: string, source: string | Uint8Array) {
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) throw new Error('Filesystem path escapes its root.');
  await validateConfinedFileTarget(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tempPath, source, typeof source === 'string' ? 'utf8' : undefined);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function deleteConfinedFile(root: string, relativePath: string): Promise<void> {
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) return;
  await rm(filePath, { force: true });
}

async function copyFileIntoRoot(
  root: string,
  sourcePath: string,
  relativePath: string,
): Promise<void> {
  const targetPath = confinedPath(root, relativePath);
  if (targetPath === undefined) throw new Error('Filesystem path escapes its root.');
  await access(sourcePath, fsConstants.R_OK);
  await validateConfinedFileTarget(root, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

async function renameIntoRoot(
  root: string,
  sourcePath: string,
  relativePath: string,
): Promise<void> {
  const targetPath = confinedPath(root, relativePath);
  if (targetPath === undefined) throw new Error('Filesystem path escapes its root.');
  await validateConfinedFileTarget(root, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rename(sourcePath, targetPath);
}

async function validateConfinedFileTarget(root: string, relativePath: string): Promise<void> {
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) throw new Error('Filesystem path escapes its root.');
  await ensureParentsStayDirectories(root, filePath);
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(filePath);
  } catch {
    return;
  }
  if (!targetStat.isDirectory()) return;
  throw new Error(`Filesystem target '${filePath}' is a directory.`);
}

async function ensureDirectoryRoot(root: string): Promise<void> {
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(root);
  } catch {
    await mkdir(root, { recursive: true });
    rootStat = await lstat(root);
  }
  if (rootStat.isDirectory() && !rootStat.isSymbolicLink()) return;
  throw new Error(`Filesystem root '${root}' is not a directory.`);
}

async function createSiblingStagingRoot(
  root: string,
  prefix = '.kovo-output-staging-',
): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), prefix));
}

async function* confinedDirectoryEntries(
  root: string,
  relativePath: string,
): AsyncGenerator<ConfinedFileSystemEntry> {
  const directoryPath = confinedPath(root, relativePath);
  if (directoryPath === undefined) return;
  let entries: Dirent[];
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRelativePath = path.join(relativePath, entry.name);
    yield {
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      name: entry.name,
      relativePath: childRelativePath,
    };
  }
}

async function ensureParentsStayDirectories(root: string, targetPath: string): Promise<void> {
  const relativeDirectory = pathRelativeToRoot(root, path.dirname(targetPath));
  const segments = relativeDirectory === undefined ? [] : relativeDirectory.split(path.sep);
  let current = path.resolve(root);
  for (const segment of segments) {
    current = path.join(current, segment);
    let parentStat: Awaited<ReturnType<typeof lstat>>;
    try {
      parentStat = await lstat(current);
    } catch {
      continue;
    }
    if (parentStat.isSymbolicLink()) {
      throw new Error(`Filesystem parent '${current}' is a symbolic link.`);
    }
    if (!parentStat.isDirectory()) {
      throw new Error(`Filesystem parent '${current}' is not a directory.`);
    }
  }
}

async function safeRealpath(filePath: string): Promise<string | undefined> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function safeOpen(filePath: string) {
  try {
    return await open(filePath, fsConstants.O_RDONLY);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')
  );
}

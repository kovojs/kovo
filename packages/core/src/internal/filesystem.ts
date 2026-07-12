import { blessSink, isBlessedSink } from './sink-policy.js';
import {
  fileSystemArrayIncludesExact,
  fileSystemAccess,
  fileSystemCloseFileDescriptor,
  fileSystemCopyBytes,
  fileSystemCopyFile,
  fileSystemCreateReadableStream,
  fileSystemDirentIsDirectory,
  fileSystemDirentIsFile,
  fileSystemFreeze,
  fileSystemLstat,
  fileSystemLstatSync,
  fileSystemMkdir,
  fileSystemMkdtemp,
  fileSystemOpenFileDescriptor,
  fileSystemPathBasename,
  fileSystemPathDirname,
  fileSystemPathIsAbsolute,
  fileSystemPathJoin,
  fileSystemPathRelative,
  fileSystemPathResolve,
  fileSystemPathSeparator,
  fileSystemRandomUuid,
  fileSystemReadDirectory,
  fileSystemReadFileDescriptor,
  fileSystemRealpath,
  fileSystemRealpathSync,
  fileSystemRemoveTree,
  fileSystemRename,
  fileSystemStat,
  fileSystemStatFileDescriptor,
  fileSystemStatSync,
  fileSystemStatsIsDirectory,
  fileSystemStatsIsFile,
  fileSystemStatsIsSymbolicLink,
  fileSystemStringCharCodeAt,
  fileSystemStringIncludes,
  fileSystemStringSplit,
  fileSystemStringStartsWith,
  fileSystemUnlink,
  fileSystemWriteFile,
  type FileSystemDirent as Dirent,
  type FileSystemStats as Stats,
} from './filesystem-intrinsics.js';

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

interface FileSystemIdentity {
  readonly device: number;
  readonly inode: number;
}

interface PinnedDirectoryIdentity {
  readonly canonicalIdentity: FileSystemIdentity;
  readonly canonicalPath: string;
  readonly lexicalIdentity: FileSystemIdentity;
  readonly lexicalKind: 'directory' | 'symbolic-link';
  readonly lexicalPath: string;
}

interface FileSystemRootState {
  anchor: PinnedDirectoryIdentity | undefined;
  expectedCanonicalRoot: string;
  failure: Error | undefined;
  preparing: Promise<boolean> | undefined;
  retired: boolean;
  rootIdentity: PinnedDirectoryIdentity | undefined;
  readonly root: string;
}

type FileSystemRootAccess = 'create' | 'observe' | 'required';

/** @internal Create a realpath-confined filesystem capability for an existing root. */
export async function createFrameworkFileSystemBoundary(
  root: string,
): Promise<FrameworkFileSystemBoundary> {
  const rootState = captureFileSystemRootState(root);
  if (!(await prepareFileSystemRoot(rootState, 'required'))) {
    throw new Error(`Filesystem root '${rootState.root}' does not exist.`);
  }
  const realRoot = preparedRootPath(rootState);
  const boundary: FrameworkFileSystemBoundary = {
    root: realRoot,
    confinedPath: (relativePath) => verifiedConfinedPath(rootState, relativePath),
    deleteFile: (relativePath) => deleteConfinedFile(rootState, relativePath),
    fileExists: (relativePath) => confinedFileExists(rootState, relativePath),
    readFile: (relativePath, options) => readConfinedFile(rootState, relativePath, options),
    statFile: (relativePath) => statConfinedFile(rootState, relativePath),
    writeFile: (relativePath, body) => writeConfinedFile(rootState, relativePath, body),
  };
  return blessSink(FILESYSTEM_BOUNDARY_SINK, fileSystemFreeze(boundary));
}

/** @internal Create a path-confined output filesystem capability for a build/export root. */
export function createFrameworkOutputFileSystemBoundary(
  root: string,
): FrameworkOutputFileSystemBoundary {
  const resolvedRoot = fileSystemPathResolve(root);
  const rootState = captureFileSystemRootState(resolvedRoot);
  const stableRoot = rootState.expectedCanonicalRoot;
  const boundary: FrameworkOutputFileSystemBoundary = {
    root: stableRoot,
    confinedPath: (relativePath) => verifiedConfinedPath(rootState, relativePath),
    copyFile: (sourcePath, relativePath) => copyFileIntoRoot(rootState, sourcePath, relativePath),
    createStagingRoot: (prefix) => createSiblingStagingRoot(rootState, prefix),
    deleteFile: (relativePath) => deleteConfinedFile(rootState, relativePath),
    ensureDirectory: async () => {
      await prepareFileSystemRoot(rootState, 'create');
    },
    entries: (relativePath) => confinedDirectoryEntries(rootState, relativePath ?? '.'),
    fileBytes: (relativePath) => readConfinedFileBytes(rootState, relativePath),
    fileExists: (relativePath) => confinedFileExists(rootState, relativePath),
    pathForExistingChild: (relativePath) => verifiedExistingChildPath(rootState, relativePath),
    renameFrom: (sourcePath, relativePath) => renameIntoRoot(rootState, sourcePath, relativePath),
    removeTree: () => removeRootTree(rootState),
    statFile: (relativePath) => statConfinedFile(rootState, relativePath),
    validateFileTarget: (relativePath) => validateConfinedFileTarget(rootState, relativePath),
    writeFile: (relativePath, body) => writeConfinedFile(rootState, relativePath, body),
  };
  return blessSink(FILESYSTEM_BOUNDARY_SINK, fileSystemFreeze(boundary));
}

/** @internal Test/audit hook for the shared Blessed<Sink> witness substrate. */
export function isFrameworkFileSystemBoundary(value: unknown): boolean {
  return isBlessedSink(FILESYSTEM_BOUNDARY_SINK, value);
}

/** @internal Resolve a relative child path only when it stays under the root. */
export function confinedPath(root: string, relativePath: string): string | undefined {
  if (fileSystemStringIncludes(relativePath, '\0') || fileSystemPathIsAbsolute(relativePath)) {
    return undefined;
  }
  const resolvedRoot = fileSystemPathResolve(root);
  const candidate = fileSystemPathResolve(resolvedRoot, relativePath);
  return containsPath(resolvedRoot, candidate) ? candidate : undefined;
}

/** @internal Return the root-relative form of an already resolved path, or undefined on escape. */
export function pathRelativeToRoot(root: string, targetPath: string): string | undefined {
  const resolvedRoot = fileSystemPathResolve(root);
  const resolvedTarget = fileSystemPathResolve(targetPath);
  if (!containsPath(resolvedRoot, resolvedTarget) || resolvedTarget === resolvedRoot) {
    return undefined;
  }
  const relativePath = fileSystemPathRelative(resolvedRoot, resolvedTarget);
  if (
    relativePath === '' ||
    fileSystemArrayIncludesExact(
      fileSystemStringSplit(relativePath, fileSystemPathSeparator()),
      '..',
    )
  ) {
    return undefined;
  }
  return relativePath;
}

/** @internal Path containment predicate used by framework filesystem boundary callers. */
export function containsPath(root: string, targetPath: string): boolean {
  const resolvedRoot = fileSystemPathResolve(root);
  const resolvedTarget = fileSystemPathResolve(targetPath);
  return (
    resolvedTarget === resolvedRoot ||
    fileSystemStringStartsWith(resolvedTarget, `${resolvedRoot}${fileSystemPathSeparator()}`)
  );
}

/**
 * SPEC §10.6 root-identity guard shared by storage, build, and export filesystem doors.
 *
 * Existing roots are pinned by canonical realpath plus device/inode at capability construction.
 * Missing roots pin the nearest existing lexical ancestor and its canonical target, which permits
 * stable platform aliases such as macOS `/tmp` while making a later ancestor replacement visible.
 * Creation then walks each missing component without following a newly planted symlink and pins
 * the final directory before use. Every sink revalidates the pinned identity. Node exposes no
 * portable unlinkat/openat directory-handle operations, so a hostile local actor can still race the
 * narrow interval after revalidation; that honest runtime-DiD ceiling is unchanged.
 */
function captureFileSystemRootState(root: string): FileSystemRootState {
  const resolvedRoot = fileSystemPathResolve(root);
  try {
    const rootIdentity = pinDirectorySync(resolvedRoot, false, 'root');
    return {
      anchor: undefined,
      expectedCanonicalRoot: rootIdentity.canonicalPath,
      failure: undefined,
      preparing: undefined,
      retired: false,
      root: resolvedRoot,
      rootIdentity,
    };
  } catch (error) {
    if (!isAbsentPathError(error)) {
      return {
        anchor: undefined,
        expectedCanonicalRoot: resolvedRoot,
        failure: error instanceof Error ? error : new Error(String(error)),
        preparing: undefined,
        retired: false,
        root: resolvedRoot,
        rootIdentity: undefined,
      };
    }
  }

  const anchor = nearestExistingDirectoryIdentitySync(resolvedRoot);
  const relativeRoot = descendantRelativePath(anchor.lexicalPath, resolvedRoot);
  return {
    anchor,
    expectedCanonicalRoot: fileSystemPathResolve(anchor.canonicalPath, relativeRoot),
    failure: undefined,
    preparing: undefined,
    retired: false,
    root: resolvedRoot,
    rootIdentity: undefined,
  };
}

function nearestExistingDirectoryIdentitySync(root: string): PinnedDirectoryIdentity {
  let candidate = fileSystemPathDirname(root);
  while (true) {
    try {
      return pinDirectorySync(candidate, true, 'ancestor');
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }
    const parent = fileSystemPathDirname(candidate);
    if (parent === candidate) {
      throw new Error(`Filesystem root '${root}' has no existing directory ancestor.`);
    }
    candidate = parent;
  }
}

function pinDirectorySync(
  lexicalPath: string,
  allowSymbolicLink: boolean,
  role: 'ancestor' | 'root',
): PinnedDirectoryIdentity {
  const lexicalStat = fileSystemLstatSync(lexicalPath);
  const lexicalKind = fileSystemStatsIsSymbolicLink(lexicalStat)
    ? 'symbolic-link'
    : fileSystemStatsIsDirectory(lexicalStat)
      ? 'directory'
      : undefined;
  if (lexicalKind === undefined || (lexicalKind === 'symbolic-link' && !allowSymbolicLink)) {
    throw new Error(`Filesystem ${role} '${lexicalPath}' must be a non-symbolic-link directory.`);
  }

  const canonicalPath = fileSystemRealpathSync(lexicalPath);
  const canonicalStat = fileSystemStatSync(canonicalPath);
  if (!fileSystemStatsIsDirectory(canonicalStat)) {
    throw new Error(`Filesystem ${role} '${lexicalPath}' does not resolve to a directory.`);
  }
  return {
    canonicalIdentity: fileSystemIdentity(canonicalStat),
    canonicalPath,
    lexicalIdentity: fileSystemIdentity(lexicalStat),
    lexicalKind,
    lexicalPath,
  };
}

async function prepareFileSystemRoot(
  state: FileSystemRootState,
  access: FileSystemRootAccess,
): Promise<boolean> {
  if (state.failure !== undefined) {
    if (access === 'observe') return false;
    throw state.failure;
  }
  const create = access === 'create';
  if (state.retired) {
    throw new Error(`Filesystem root capability '${state.root}' has already been removed.`);
  }
  if (state.rootIdentity !== undefined) {
    await verifyPinnedDirectory(state.rootIdentity, 'root');
    return true;
  }
  if (state.preparing !== undefined) {
    const prepared = await state.preparing;
    if (prepared || !create) return prepared;
    return await prepareFileSystemRoot(state, 'create');
  }

  const preparing = prepareUnpinnedFileSystemRoot(state, create);
  state.preparing = preparing;
  try {
    return await preparing;
  } finally {
    if (state.preparing === preparing) state.preparing = undefined;
  }
}

async function prepareUnpinnedFileSystemRoot(
  state: FileSystemRootState,
  create: boolean,
): Promise<boolean> {
  const anchor = state.anchor;
  if (anchor === undefined) {
    throw new Error(`Filesystem root '${state.root}' has no pinned identity.`);
  }
  const exists = await ensureDescendantDirectories(anchor, state.root, create);
  if (!exists) return false;
  await verifyPinnedDirectory(anchor, 'ancestor');
  state.rootIdentity = await pinRootDirectory(state.root, state.expectedCanonicalRoot);
  return true;
}

async function prepareFileSystemRootParent(state: FileSystemRootState): Promise<void> {
  if (state.failure !== undefined) throw state.failure;
  if (state.retired) {
    throw new Error(`Filesystem root capability '${state.root}' has already been removed.`);
  }
  if (state.rootIdentity !== undefined) {
    await verifyPinnedDirectory(state.rootIdentity, 'root');
    return;
  }
  const anchor = state.anchor;
  if (anchor === undefined) {
    throw new Error(`Filesystem root '${state.root}' has no pinned ancestor identity.`);
  }
  await ensureDescendantDirectories(anchor, fileSystemPathDirname(state.root), true);
  await verifyPinnedDirectory(anchor, 'ancestor');
}

async function ensureDescendantDirectories(
  anchor: PinnedDirectoryIdentity,
  targetPath: string,
  create: boolean,
): Promise<boolean> {
  await verifyPinnedDirectory(anchor, 'ancestor');
  const relativePath = descendantRelativePath(anchor.lexicalPath, targetPath);
  const segments =
    relativePath === '' ? [] : fileSystemStringSplit(relativePath, fileSystemPathSeparator());
  let current = anchor.lexicalPath;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    current = fileSystemPathJoin(current, segment);
    let currentStat: Stats;
    try {
      currentStat = await fileSystemLstat(current);
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
      if (!create) return false;
      try {
        await fileSystemMkdir(current);
      } catch (mkdirError) {
        if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
      }
      currentStat = await fileSystemLstat(current);
    }
    if (fileSystemStatsIsSymbolicLink(currentStat)) {
      throw new Error(`Filesystem root component '${current}' is a symbolic link.`);
    }
    if (!fileSystemStatsIsDirectory(currentStat)) {
      throw new Error(`Filesystem root component '${current}' is not a directory.`);
    }
  }

  const expectedCanonicalPath = fileSystemPathResolve(anchor.canonicalPath, relativePath);
  const canonicalPath = await fileSystemRealpath(targetPath);
  if (canonicalPath !== expectedCanonicalPath) {
    throw rootIdentityChangedError(
      targetPath,
      `resolved to '${canonicalPath}' instead of '${expectedCanonicalPath}'`,
    );
  }
  const canonicalStat = await fileSystemStat(canonicalPath);
  if (!fileSystemStatsIsDirectory(canonicalStat)) {
    throw new Error(`Filesystem root component '${targetPath}' is not a directory.`);
  }
  await verifyPinnedDirectory(anchor, 'ancestor');
  return true;
}

async function pinRootDirectory(
  lexicalPath: string,
  expectedCanonicalPath: string,
): Promise<PinnedDirectoryIdentity> {
  const lexicalStat = await fileSystemLstat(lexicalPath);
  if (fileSystemStatsIsSymbolicLink(lexicalStat) || !fileSystemStatsIsDirectory(lexicalStat)) {
    throw new Error(`Filesystem root '${lexicalPath}' must be a non-symbolic-link directory.`);
  }
  const canonicalPath = await fileSystemRealpath(lexicalPath);
  if (canonicalPath !== expectedCanonicalPath) {
    throw rootIdentityChangedError(
      lexicalPath,
      `resolved to '${canonicalPath}' instead of '${expectedCanonicalPath}'`,
    );
  }
  const canonicalStat = await fileSystemStat(canonicalPath);
  if (!fileSystemStatsIsDirectory(canonicalStat)) {
    throw new Error(`Filesystem root '${lexicalPath}' does not resolve to a directory.`);
  }
  return {
    canonicalIdentity: fileSystemIdentity(canonicalStat),
    canonicalPath,
    lexicalIdentity: fileSystemIdentity(lexicalStat),
    lexicalKind: 'directory',
    lexicalPath,
  };
}

async function verifyPinnedDirectory(
  pinned: PinnedDirectoryIdentity,
  role: 'ancestor' | 'root',
): Promise<void> {
  let lexicalStat: Stats;
  try {
    lexicalStat = await fileSystemLstat(pinned.lexicalPath);
  } catch (error) {
    throw rootIdentityChangedError(
      pinned.lexicalPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  const currentKind = fileSystemStatsIsSymbolicLink(lexicalStat)
    ? 'symbolic-link'
    : fileSystemStatsIsDirectory(lexicalStat)
      ? 'directory'
      : undefined;
  if (
    currentKind !== pinned.lexicalKind ||
    !sameFileSystemIdentity(fileSystemIdentity(lexicalStat), pinned.lexicalIdentity)
  ) {
    throw rootIdentityChangedError(pinned.lexicalPath, `${role} directory entry was replaced`);
  }

  let canonicalPath: string;
  let canonicalStat: Stats;
  try {
    canonicalPath = await fileSystemRealpath(pinned.lexicalPath);
    canonicalStat = await fileSystemStat(canonicalPath);
  } catch (error) {
    throw rootIdentityChangedError(
      pinned.lexicalPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    canonicalPath !== pinned.canonicalPath ||
    !fileSystemStatsIsDirectory(canonicalStat) ||
    !sameFileSystemIdentity(fileSystemIdentity(canonicalStat), pinned.canonicalIdentity)
  ) {
    throw rootIdentityChangedError(pinned.lexicalPath, `${role} canonical identity was replaced`);
  }
}

function preparedRootPath(state: FileSystemRootState): string {
  if (state.rootIdentity === undefined) {
    throw new Error(`Filesystem root '${state.root}' is not prepared.`);
  }
  return state.rootIdentity.canonicalPath;
}

function verifiedExistingChildPath(
  state: FileSystemRootState,
  relativePath: string,
): string | undefined {
  if (state.failure !== undefined) throw state.failure;
  if (state.retired || state.rootIdentity === undefined) return undefined;
  return verifiedConfinedPath(state, relativePath);
}

function verifiedConfinedPath(
  state: FileSystemRootState,
  relativePath: string,
): string | undefined {
  const candidate = confinedPath(state.expectedCanonicalRoot, relativePath);
  if (candidate === undefined) return undefined;
  if (state.failure !== undefined) throw state.failure;
  if (state.retired) return undefined;
  if (state.rootIdentity !== undefined) {
    verifyPinnedDirectorySync(state.rootIdentity, 'root');
  } else if (state.anchor !== undefined) {
    verifyPinnedDirectorySync(state.anchor, 'ancestor');
  } else {
    return undefined;
  }
  return candidate;
}

function verifyPinnedDirectorySync(
  pinned: PinnedDirectoryIdentity,
  role: 'ancestor' | 'root',
): void {
  let lexicalStat: Stats;
  try {
    lexicalStat = fileSystemLstatSync(pinned.lexicalPath);
  } catch (error) {
    throw rootIdentityChangedError(
      pinned.lexicalPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  const currentKind = fileSystemStatsIsSymbolicLink(lexicalStat)
    ? 'symbolic-link'
    : fileSystemStatsIsDirectory(lexicalStat)
      ? 'directory'
      : undefined;
  if (
    currentKind !== pinned.lexicalKind ||
    !sameFileSystemIdentity(fileSystemIdentity(lexicalStat), pinned.lexicalIdentity)
  ) {
    throw rootIdentityChangedError(pinned.lexicalPath, `${role} directory entry was replaced`);
  }

  let canonicalPath: string;
  let canonicalStat: Stats;
  try {
    canonicalPath = fileSystemRealpathSync(pinned.lexicalPath);
    canonicalStat = fileSystemStatSync(canonicalPath);
  } catch (error) {
    throw rootIdentityChangedError(
      pinned.lexicalPath,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (
    canonicalPath !== pinned.canonicalPath ||
    !fileSystemStatsIsDirectory(canonicalStat) ||
    !sameFileSystemIdentity(fileSystemIdentity(canonicalStat), pinned.canonicalIdentity)
  ) {
    throw rootIdentityChangedError(pinned.lexicalPath, `${role} canonical identity was replaced`);
  }
}

async function revalidatePreparedRoot(state: FileSystemRootState): Promise<void> {
  if (state.rootIdentity === undefined) {
    throw new Error(`Filesystem root '${state.root}' is not prepared.`);
  }
  await verifyPinnedDirectory(state.rootIdentity, 'root');
}

function descendantRelativePath(ancestorPath: string, descendantPath: string): string {
  const relativePath = fileSystemPathRelative(ancestorPath, descendantPath);
  if (
    relativePath === '..' ||
    fileSystemStringStartsWith(relativePath, `..${fileSystemPathSeparator()}`) ||
    fileSystemPathIsAbsolute(relativePath)
  ) {
    throw new Error(
      `Filesystem path '${descendantPath}' is not beneath pinned ancestor '${ancestorPath}'.`,
    );
  }
  return relativePath;
}

function fileSystemIdentity(fileStat: Pick<Stats, 'dev' | 'ino'>): FileSystemIdentity {
  return { device: fileStat.dev, inode: fileStat.ino };
}

function sameFileSystemIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function rootIdentityChangedError(root: string, detail: string): Error {
  return new Error(`Filesystem root identity changed for '${root}': ${detail}.`);
}

async function readConfinedFile(
  rootState: FileSystemRootState,
  relativePath: string,
  options: ConfinedFileSystemReadOptions = {},
): Promise<ConfinedFileSystemReadResult | undefined> {
  if (confinedPath(rootState.root, relativePath) === undefined) return undefined;
  if (!(await prepareFileSystemRoot(rootState, 'observe'))) return undefined;
  const root = preparedRootPath(rootState);
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) return undefined;

  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(root, resolved)) return undefined;

  const fileDescriptor = await safeOpen(resolved);
  if (fileDescriptor === undefined) return undefined;

  let streamOwnsFileDescriptor = false;
  try {
    const fileStat = await fileSystemStatFileDescriptor(fileDescriptor);
    const postOpenResolved = await safeRealpath(resolved);
    if (
      !fileSystemStatsIsFile(fileStat) ||
      postOpenResolved === undefined ||
      !containsPath(root, postOpenResolved)
    ) {
      return undefined;
    }

    let body: ReadableStream<Uint8Array> | Uint8Array;
    if (options.body === 'stream') {
      body = fileSystemCreateReadableStream(fileDescriptor);
      streamOwnsFileDescriptor = true;
    } else {
      body = fileSystemCopyBytes(await fileSystemReadFileDescriptor(fileDescriptor));
    }
    return {
      body,
      fileName: fileSystemPathBasename(postOpenResolved),
      size: fileStat.size,
    };
  } finally {
    if (!streamOwnsFileDescriptor) await fileSystemCloseFileDescriptor(fileDescriptor);
  }
}

async function statConfinedFile(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<{ mtime: Date; size: number } | undefined> {
  if (confinedPath(rootState.root, relativePath) === undefined) return undefined;
  if (!(await prepareFileSystemRoot(rootState, 'observe'))) return undefined;
  const root = preparedRootPath(rootState);
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) return undefined;
  const resolved = await safeRealpath(candidate);
  if (resolved === undefined || !containsPath(root, resolved)) return undefined;
  const fileStat = await fileSystemStat(resolved).catch((error: unknown) => {
    if (isMissingPathError(error)) return undefined;
    throw error;
  });
  if (fileStat === undefined || !fileSystemStatsIsFile(fileStat)) return undefined;
  return { mtime: fileStat.mtime, size: fileStat.size };
}

async function readConfinedFileBytes(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<Uint8Array | undefined> {
  const result = await readConfinedFile(rootState, relativePath);
  return result?.body instanceof Uint8Array ? result.body : undefined;
}

async function confinedFileExists(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<boolean> {
  return (await statConfinedFile(rootState, relativePath)) !== undefined;
}

async function writeConfinedFile(
  rootState: FileSystemRootState,
  relativePath: string,
  source: string | Uint8Array,
) {
  if (confinedPath(rootState.root, relativePath) === undefined) {
    throw new Error('Filesystem path escapes its root.');
  }
  await prepareFileSystemRoot(rootState, 'create');
  const root = preparedRootPath(rootState);
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) throw new Error('Filesystem path escapes its root.');
  await validateConfinedFileTarget(rootState, relativePath);
  await fileSystemMkdir(fileSystemPathDirname(filePath), true);
  await revalidatePreparedRoot(rootState);
  const tempPath = fileSystemPathJoin(
    fileSystemPathDirname(filePath),
    `.${fileSystemPathBasename(filePath)}.${process.pid}.${fileSystemRandomUuid()}.tmp`,
  );
  try {
    await fileSystemWriteFile(tempPath, source);
    await revalidatePreparedRoot(rootState);
    await ensureParentsStayDirectories(root, filePath);
    await fileSystemRename(tempPath, filePath);
  } catch (error) {
    await removeConfinedTemporaryFile(rootState, tempPath).catch(() => undefined);
    throw error;
  }
}

async function deleteConfinedFile(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<void> {
  if (confinedPath(rootState.root, relativePath) === undefined) return;
  if (!(await prepareFileSystemRoot(rootState, 'required'))) return;
  const root = preparedRootPath(rootState);
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) return;

  // SPEC §10.6 filesystem door: lexical confinement alone is insufficient because `unlink`/`rm`
  // follows every parent directory component. Reject an existing symlink parent before reaching
  // the destructive sink. `unlink` intentionally does not follow a final-component symlink, so a
  // planted link at the object path removes only that link. Node does not expose portable
  // unlinkat(2)-style directory-handle deletion, so a hostile local actor racing a parent swap
  // remains outside this runtime-DiD boundary's honest platform ceiling.
  await ensureParentsStayDirectories(root, filePath);
  await revalidatePreparedRoot(rootState);
  let targetStat: Stats;
  try {
    targetStat = await fileSystemLstat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  if (fileSystemStatsIsDirectory(targetStat)) {
    throw new Error(`Filesystem target '${filePath}' is a directory.`);
  }
  try {
    await fileSystemUnlink(filePath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

async function copyFileIntoRoot(
  rootState: FileSystemRootState,
  sourcePath: string,
  relativePath: string,
): Promise<void> {
  if (confinedPath(rootState.root, relativePath) === undefined) {
    throw new Error('Filesystem path escapes its root.');
  }
  await prepareFileSystemRoot(rootState, 'create');
  const root = preparedRootPath(rootState);
  const targetPath = confinedPath(root, relativePath);
  if (targetPath === undefined) throw new Error('Filesystem path escapes its root.');
  await fileSystemAccess(sourcePath);
  await validateConfinedFileTarget(rootState, relativePath);
  await fileSystemMkdir(fileSystemPathDirname(targetPath), true);
  await revalidatePreparedRoot(rootState);
  await ensureParentsStayDirectories(root, targetPath);
  // SPEC §10.6 filesystem door: copyFile(2) follows an existing final-component symlink and
  // writes through an existing hardlink's shared inode. Copy into a framework-minted sibling and
  // atomically rename it over the directory entry instead, matching writeConfinedFile. The rename
  // replaces a symlink, hardlink, FIFO, or device node without opening that caller-controlled
  // target, so a confined copy cannot mutate an object reachable outside the root.
  const tempPath = fileSystemPathJoin(
    fileSystemPathDirname(targetPath),
    `.${fileSystemPathBasename(targetPath)}.${process.pid}.${fileSystemRandomUuid()}.tmp`,
  );
  try {
    await fileSystemCopyFile(sourcePath, tempPath);
    await revalidatePreparedRoot(rootState);
    await ensureParentsStayDirectories(root, targetPath);
    await fileSystemRename(tempPath, targetPath);
  } catch (error) {
    await removeConfinedTemporaryFile(rootState, tempPath).catch(() => undefined);
    throw error;
  }
}

async function renameIntoRoot(
  rootState: FileSystemRootState,
  sourcePath: string,
  relativePath: string,
): Promise<void> {
  if (confinedPath(rootState.root, relativePath) === undefined) {
    throw new Error('Filesystem path escapes its root.');
  }
  await prepareFileSystemRoot(rootState, 'create');
  const root = preparedRootPath(rootState);
  const targetPath = confinedPath(root, relativePath);
  if (targetPath === undefined) throw new Error('Filesystem path escapes its root.');
  await validateConfinedFileTarget(rootState, relativePath);
  await fileSystemMkdir(fileSystemPathDirname(targetPath), true);
  await revalidatePreparedRoot(rootState);
  await ensureParentsStayDirectories(root, targetPath);
  await fileSystemRename(sourcePath, targetPath);
}

async function validateConfinedFileTarget(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<void> {
  if (confinedPath(rootState.root, relativePath) === undefined) {
    throw new Error('Filesystem path escapes its root.');
  }
  if (!(await prepareFileSystemRoot(rootState, 'required'))) return;
  const root = preparedRootPath(rootState);
  const filePath = confinedPath(root, relativePath);
  if (filePath === undefined) throw new Error('Filesystem path escapes its root.');
  await ensureParentsStayDirectories(root, filePath);
  await revalidatePreparedRoot(rootState);
  let targetStat: Stats;
  try {
    targetStat = await fileSystemLstat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  if (!fileSystemStatsIsDirectory(targetStat)) return;
  throw new Error(`Filesystem target '${filePath}' is a directory.`);
}

async function removeConfinedTemporaryFile(
  rootState: FileSystemRootState,
  tempPath: string,
): Promise<void> {
  await revalidatePreparedRoot(rootState);
  const root = preparedRootPath(rootState);
  if (!containsPath(root, tempPath) || tempPath === root) return;
  await ensureParentsStayDirectories(root, tempPath);
  await revalidatePreparedRoot(rootState);
  try {
    await fileSystemUnlink(tempPath);
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

async function removeRootTree(rootState: FileSystemRootState): Promise<void> {
  if (rootState.retired) return;
  if (!(await prepareFileSystemRoot(rootState, 'required'))) {
    rootState.retired = true;
    return;
  }
  await revalidatePreparedRoot(rootState);
  await fileSystemRemoveTree(preparedRootPath(rootState));
  rootState.retired = true;
}

async function createSiblingStagingRoot(
  rootState: FileSystemRootState,
  prefix = '.kovo-output-staging-',
): Promise<string> {
  assertSiblingStagingPrefix(prefix);
  await prepareFileSystemRootParent(rootState);
  const siblingParent = fileSystemPathDirname(rootState.root);
  const stagingPrefix = fileSystemPathJoin(siblingParent, prefix);
  if (
    fileSystemPathDirname(stagingPrefix) !== siblingParent ||
    fileSystemPathBasename(stagingPrefix) !== prefix
  ) {
    throw new Error('Filesystem staging prefix must resolve to one sibling filename segment.');
  }
  return await fileSystemMkdtemp(stagingPrefix);
}

function assertSiblingStagingPrefix(prefix: string): void {
  if (
    prefix === '' ||
    prefix === '.' ||
    prefix === '..' ||
    fileSystemPathIsAbsolute(prefix) ||
    fileSystemStringIncludes(prefix, '/') ||
    fileSystemStringIncludes(prefix, '\\')
  ) {
    throw new Error(
      'Filesystem staging prefix must be a nonempty single filename segment without traversal.',
    );
  }
  for (let index = 0; index < prefix.length; index += 1) {
    const codePoint = fileSystemStringCharCodeAt(prefix, index);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      throw new Error('Filesystem staging prefix must not contain control bytes.');
    }
  }
}

async function* confinedDirectoryEntries(
  rootState: FileSystemRootState,
  relativePath: string,
): AsyncGenerator<ConfinedFileSystemEntry> {
  if (confinedPath(rootState.root, relativePath) === undefined) return;
  if (!(await prepareFileSystemRoot(rootState, 'observe'))) return;
  const root = preparedRootPath(rootState);
  const directoryPath = confinedPath(root, relativePath);
  if (directoryPath === undefined) return;
  const resolvedDirectory = await safeRealpath(directoryPath);
  if (resolvedDirectory === undefined || !containsPath(root, resolvedDirectory)) return;
  let entries: Dirent[];
  try {
    entries = await fileSystemReadDirectory(resolvedDirectory);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const childRelativePath = fileSystemPathJoin(relativePath, entry.name);
    yield {
      kind: fileSystemDirentIsDirectory(entry)
        ? 'directory'
        : fileSystemDirentIsFile(entry)
          ? 'file'
          : 'other',
      name: entry.name,
      relativePath: childRelativePath,
    };
  }
}

async function ensureParentsStayDirectories(root: string, targetPath: string): Promise<void> {
  const relativeDirectory = pathRelativeToRoot(root, fileSystemPathDirname(targetPath));
  const segments =
    relativeDirectory === undefined
      ? []
      : fileSystemStringSplit(relativeDirectory, fileSystemPathSeparator());
  let current = fileSystemPathResolve(root);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    current = fileSystemPathJoin(current, segment);
    let parentStat: Stats;
    try {
      parentStat = await fileSystemLstat(current);
    } catch (error) {
      if (isAbsentPathError(error)) continue;
      throw error;
    }
    if (fileSystemStatsIsSymbolicLink(parentStat)) {
      throw new Error(`Filesystem parent '${current}' is a symbolic link.`);
    }
    if (!fileSystemStatsIsDirectory(parentStat)) {
      throw new Error(`Filesystem parent '${current}' is not a directory.`);
    }
  }
}

async function safeRealpath(filePath: string): Promise<string | undefined> {
  try {
    return await fileSystemRealpath(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function safeOpen(filePath: string) {
  try {
    return await fileSystemOpenFileDescriptor(filePath);
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

function isAbsentPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

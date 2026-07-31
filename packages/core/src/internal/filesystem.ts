import { blessSink, isBlessedSink } from '#sink-policy';
import {
  securityDefineProperty,
  securityWeakMap,
  securityWeakMapGet,
  securityWeakMapSet,
} from '#security-witness-intrinsics';
import {
  fileSystemArrayIncludesExact,
  fileSystemArrayBufferViewByteLength,
  fileSystemCloseFileDescriptor,
  fileSystemCopyBytes,
  fileSystemCreatePromise,
  fileSystemCreateExclusiveFileDescriptor,
  fileSystemCreateReadableStream,
  fileSystemDelay,
  fileSystemFreeze,
  fileSystemIsUint8Array,
  fileSystemLstat,
  fileSystemLstatSync,
  fileSystemMkdir,
  fileSystemMkdirPrivate,
  fileSystemMkdtemp,
  fileSystemOpenFileDescriptor,
  fileSystemPathBasename,
  fileSystemPathDirname,
  fileSystemPathIsAbsolute,
  fileSystemPathJoin,
  fileSystemPathRelative,
  fileSystemPathResolve,
  fileSystemPathSeparator,
  fileSystemPromiseThen,
  fileSystemRandomUuid,
  fileSystemReadDirectory,
  fileSystemReadFileDescriptor,
  fileSystemReadFileDescriptorBounded,
  fileSystemRealpath,
  fileSystemRealpathSync,
  fileSystemRemoveTree,
  fileSystemRename,
  fileSystemSetFileMode,
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
  fileSystemSyncFileDescriptor,
  fileSystemUnlink,
  fileSystemUtf8Encode,
  fileSystemWriteFileDescriptor,
  type FileSystemDirent as Dirent,
  type FileSystemStats as Stats,
} from '#filesystem-intrinsics';

type FileSystemBoundarySink = 'filesystem-boundary';

/** @internal Read mode for the framework-owned filesystem boundary. */
export type ConfinedFileSystemReadBody = 'buffer' | 'stream';

/** @internal Options for reading a file through the framework-owned filesystem boundary. */
export interface ConfinedFileSystemReadOptions {
  body?: ConfinedFileSystemReadBody;
  /**
   * Refuse regular files with more than one directory entry. Rooted HTTP serving enables this so
   * an inode first named outside the configured root cannot enter it through a hardlink alias
   * (SPEC §2 / §6.6 / §10.6). Other internal readers retain ordinary filesystem semantics.
   */
  requireSingleLink?: boolean;
}

/** @internal Confined file read result returned by the framework-owned filesystem boundary. */
export interface ConfinedFileSystemReadResult {
  body: ReadableStream<Uint8Array> | Uint8Array;
  fileName: string;
  size: number;
}

const confinedFileSystemEntryBrand: unique symbol = Symbol('kovo.filesystem.confined-entry');
const capturedFileReplacementBrand: unique symbol = Symbol(
  'kovo.filesystem.captured-file-replacement',
);
const frameworkTemporaryFileBrand: unique symbol = Symbol('kovo.filesystem.temporary-file');

/** @internal Directory entry shape returned by the framework-owned filesystem boundary. */
export interface ConfinedFileSystemEntry {
  readonly [confinedFileSystemEntryBrand]: true;
  readonly kind: 'directory' | 'file' | 'other';
  readonly name: string;
  readonly relativePath: string;
}

/** @internal Identity-bound regular-file snapshot accepted by the atomic replacement door. */
export interface CapturedFileReplacement {
  readonly [capturedFileReplacementBrand]: true;
  readonly body: Uint8Array;
  readonly relativePath: string;
}

/** @internal Inert path facts for a framework-owned, identity-bound temporary file. */
export interface FrameworkTemporaryFile {
  readonly [frameworkTemporaryFileBrand]: true;
  readonly path: string;
  readonly relativePath: string;
}

/** @internal Inputs for an exclusively-created temporary file beneath an enrolled root. */
export interface FrameworkTemporaryFileOptions {
  /** Synchronous body construction receives the exact reserved root-relative filename. */
  readonly body: (relativePath: string) => string | Uint8Array;
  readonly prefix: string;
  readonly suffix: string;
}

/** @internal Synchronous decision made while the durable file's exclusive lock is held. */
export type DurableFileUpdate = (
  current: Uint8Array | undefined,
) => string | Uint8Array | undefined;

/** @internal Existing-root filesystem read/write capability with path confinement. */
export interface FrameworkFileSystemBoundary {
  readonly root: string;
  captureFileForReplacement(relativePath: string): Promise<CapturedFileReplacement | undefined>;
  confinedPath(relativePath: string): string | undefined;
  deleteFile(relativePath: string): Promise<void>;
  fileExists(relativePath: string): Promise<boolean>;
  readFile(
    relativePath: string,
    options?: ConfinedFileSystemReadOptions,
  ): Promise<ConfinedFileSystemReadResult | undefined>;
  replaceCapturedFile(snapshot: CapturedFileReplacement, body: string | Uint8Array): Promise<void>;
  statFile(relativePath: string): Promise<{ mtime: Date; size: number } | undefined>;
  updateDurableFile(relativePath: string, update: DurableFileUpdate): Promise<void>;
  withTemporaryFile<Result>(
    options: FrameworkTemporaryFileOptions,
    use: (file: FrameworkTemporaryFile) => Promise<Result>,
  ): Promise<Result>;
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
  entries(relativePath?: string): Promise<readonly ConfinedFileSystemEntry[]>;
  /** Enumerate a directory only while its captured canonical and device/inode identity survives. */
  entriesOf(entry: ConfinedFileSystemEntry): Promise<readonly ConfinedFileSystemEntry[]>;
  /** Read a regular file through its captured identity and an independently witnessed descriptor. */
  fileBytesOf(entry: ConfinedFileSystemEntry): Promise<Uint8Array>;
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

interface ConfinedDirectoryDurabilityWitness {
  readonly identity: FileSystemIdentity;
  readonly path: string;
}

interface IdentityBoundRegularFile {
  readonly canonicalPath: string;
  readonly fileDescriptor: number;
  readonly fileStat: Stats;
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

interface ConfinedFileSystemEntryProvenance {
  readonly canonicalPath: string;
  readonly identity: FileSystemIdentity;
  readonly kind: 'directory' | 'file';
  readonly relativePath: string;
  readonly rootState: FileSystemRootState;
}

interface CapturedFileReplacementProvenance {
  readonly body: Uint8Array;
  readonly canonicalPath: string;
  readonly fileStat: Stats;
  readonly relativePath: string;
  readonly rootState: FileSystemRootState;
}

interface PreparedFrameworkTemporaryFile {
  readonly file: FrameworkTemporaryFile;
  readonly identity: FileSystemIdentity;
  readonly path: string;
}

const confinedFileSystemEntryProvenance = securityWeakMap<
  ConfinedFileSystemEntry,
  ConfinedFileSystemEntryProvenance
>();
const capturedFileReplacementProvenance = securityWeakMap<
  CapturedFileReplacement,
  CapturedFileReplacementProvenance
>();
let fileSystemCommitLock: Promise<void> | undefined;

const DURABLE_FILE_LOCK_RETRY_DELAY_MS = 25;
const DURABLE_FILE_LOCK_RETRY_LIMIT = 200;
const DURABLE_FILE_MAXIMUM_BYTES = 1_048_576;
const FRAMEWORK_TEMPORARY_FILE_RETRY_LIMIT = 32;
const FRAMEWORK_TEMPORARY_NAME_AFFIX_MAXIMUM_LENGTH = 180;
const PRIVATE_FILE_MODE = 0o600;

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
    captureFileForReplacement: (relativePath) =>
      captureConfinedFileForReplacement(rootState, relativePath),
    confinedPath: (relativePath) => verifiedConfinedPath(rootState, relativePath),
    deleteFile: (relativePath) => deleteConfinedFile(rootState, relativePath),
    fileExists: (relativePath) => confinedFileExists(rootState, relativePath),
    readFile: (relativePath, options) => readConfinedFile(rootState, relativePath, options),
    replaceCapturedFile: (snapshot, body) => replaceCapturedConfinedFile(rootState, snapshot, body),
    statFile: (relativePath) => statConfinedFile(rootState, relativePath),
    updateDurableFile: (relativePath, update) =>
      updateDurableConfinedFile(rootState, relativePath, update),
    withTemporaryFile: (options, use) => withConfinedTemporaryFile(rootState, options, use),
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
    entriesOf: (entry) => confinedEntryDirectoryEntries(rootState, entry),
    fileBytesOf: (entry) => readConfinedEntryFileBytes(rootState, entry),
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

async function withConfinedTemporaryFile<Result>(
  rootState: FileSystemRootState,
  options: FrameworkTemporaryFileOptions,
  use: (file: FrameworkTemporaryFile) => Promise<Result>,
): Promise<Result> {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('Framework temporary file options must be an object.');
  }
  const { body, prefix, suffix } = options;
  if (typeof body !== 'function') {
    throw new TypeError('Framework temporary file body must be a synchronous function.');
  }
  if (typeof use !== 'function') {
    throw new TypeError('Framework temporary file use callback must be a function.');
  }
  assertFrameworkTemporaryFileAffix(prefix, 'prefix', false);
  assertFrameworkTemporaryFileAffix(suffix, 'suffix', true);
  if (prefix.length + suffix.length > FRAMEWORK_TEMPORARY_NAME_AFFIX_MAXIMUM_LENGTH) {
    throw new TypeError('Framework temporary file name affixes are too long.');
  }

  const prepared = await createConfinedTemporaryFile(rootState, prefix, suffix, body);
  try {
    return await use(prepared.file);
  } finally {
    await removeConfinedTemporaryFile(rootState, prepared.path, prepared.identity);
  }
}

async function createConfinedTemporaryFile(
  rootState: FileSystemRootState,
  prefix: string,
  suffix: string,
  body: (relativePath: string) => string | Uint8Array,
): Promise<PreparedFrameworkTemporaryFile> {
  await prepareFileSystemRoot(rootState, 'required');
  const root = preparedRootPath(rootState);
  for (let attempt = 0; attempt < FRAMEWORK_TEMPORARY_FILE_RETRY_LIMIT; attempt += 1) {
    const relativePath = `${prefix}${fileSystemRandomUuid()}${suffix}`;
    const path = confinedPath(root, relativePath);
    if (path === undefined || fileSystemPathDirname(path) !== root) {
      throw new TypeError('Framework temporary file name escaped its enrolled root.');
    }
    const source = frameworkTemporaryFileBody(body(relativePath));
    try {
      return await withFileSystemRootCommitLock(root, async () => {
        await ensureParentsStayDirectories(root, path);
        await revalidatePreparedRoot(rootState);
        return await createConfinedTemporaryFileUnderLock(rootState, path, relativePath, source);
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }
  throw new TypeError('Framework temporary file could not reserve a unique filename.');
}

async function createConfinedTemporaryFileUnderLock(
  rootState: FileSystemRootState,
  path: string,
  relativePath: string,
  source: Uint8Array,
): Promise<PreparedFrameworkTemporaryFile> {
  let fileDescriptor: number | undefined;
  let identity: FileSystemIdentity | undefined;
  try {
    fileDescriptor = await fileSystemCreateExclusiveFileDescriptor(path);
    const openedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (!fileSystemStatsIsFile(openedStat) || openedStat.nlink !== 1) {
      throw new Error(`Filesystem temporary '${path}' is not a private regular file.`);
    }
    identity = fileSystemIdentity(openedStat);
    await fileSystemWriteFileDescriptor(fileDescriptor, source);

    const completedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    const lexicalStat = await fileSystemLstat(path);
    if (
      !fileSystemStatsIsFile(completedStat) ||
      completedStat.nlink !== 1 ||
      fileSystemStatsIsSymbolicLink(lexicalStat) ||
      !fileSystemStatsIsFile(lexicalStat) ||
      lexicalStat.nlink !== 1 ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(completedStat)) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(lexicalStat))
    ) {
      throw new Error(`Filesystem temporary '${path}' identity changed during creation.`);
    }
    await revalidatePreparedRoot(rootState);
    const file: FrameworkTemporaryFile = fileSystemFreeze({
      [frameworkTemporaryFileBrand]: true,
      path,
      relativePath,
    });
    return { file, identity, path };
  } catch (error) {
    if (fileDescriptor !== undefined) {
      await fileSystemCloseFileDescriptor(fileDescriptor).catch(() => undefined);
      fileDescriptor = undefined;
    }
    if (identity !== undefined) {
      await removeIdentityBoundTemporaryFile(rootState, path, identity).catch(() => undefined);
    }
    throw error;
  } finally {
    if (fileDescriptor !== undefined) {
      await fileSystemCloseFileDescriptor(fileDescriptor);
    }
  }
}

async function removeConfinedTemporaryFile(
  rootState: FileSystemRootState,
  path: string,
  identity: FileSystemIdentity,
): Promise<void> {
  const root = preparedRootPath(rootState);
  await withFileSystemRootCommitLock(root, async () => {
    await ensureParentsStayDirectories(root, path);
    await revalidatePreparedRoot(rootState);
    let lexicalStat: Stats;
    try {
      lexicalStat = await fileSystemLstat(path);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
    if (
      fileSystemStatsIsSymbolicLink(lexicalStat) ||
      !fileSystemStatsIsFile(lexicalStat) ||
      lexicalStat.nlink !== 1 ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(lexicalStat))
    ) {
      throw confinedEntryIdentityChangedError(path, 'temporary file changed before cleanup');
    }
    await fileSystemUnlink(path);
    await revalidatePreparedRoot(rootState);
  });
}

function assertFrameworkTemporaryFileAffix(
  value: string,
  role: 'prefix' | 'suffix',
  allowEmpty: boolean,
): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value === '') ||
    fileSystemPathIsAbsolute(value) ||
    fileSystemStringIncludes(value, '/') ||
    fileSystemStringIncludes(value, '\\') ||
    fileSystemStringIncludes(value, '\0')
  ) {
    throw new TypeError(
      `Framework temporary file ${role} must be ${allowEmpty ? 'a' : 'a nonempty'} single filename affix.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = fileSystemStringCharCodeAt(value, index);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      throw new TypeError(`Framework temporary file ${role} must not contain control bytes.`);
    }
  }
}

function frameworkTemporaryFileBody(source: string | Uint8Array): Uint8Array {
  const body =
    typeof source === 'string'
      ? fileSystemUtf8Encode(source)
      : fileSystemIsUint8Array(source)
        ? fileSystemCopyBytes(source)
        : undefined;
  if (body === undefined) {
    throw new TypeError('Framework temporary file body must be a string or Uint8Array.');
  }
  if (fileSystemArrayBufferViewByteLength(body) > DURABLE_FILE_MAXIMUM_BYTES) {
    throw new TypeError('Framework temporary file body exceeds the 1 MiB limit.');
  }
  return body;
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

function sameFileSystemVersion(left: Stats, right: Stats): boolean {
  return (
    sameFileSystemIdentity(fileSystemIdentity(left), fileSystemIdentity(right)) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function rootIdentityChangedError(root: string, detail: string): Error {
  return new Error(`Filesystem root identity changed for '${root}': ${detail}.`);
}

async function captureConfinedFileForReplacement(
  rootState: FileSystemRootState,
  relativePath: string,
): Promise<CapturedFileReplacement | undefined> {
  if (confinedPath(rootState.root, relativePath) === undefined) return undefined;
  if (!(await prepareFileSystemRoot(rootState, 'required'))) return undefined;
  const root = preparedRootPath(rootState);
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) return undefined;
  await ensureParentsStayDirectories(root, candidate);
  const opened = await openIdentityBoundRegularFile(candidate, root, false, true);
  if (opened === undefined) return undefined;
  try {
    const body = fileSystemCopyBytes(await fileSystemReadFileDescriptor(opened.fileDescriptor));
    const completedStat = await fileSystemStatFileDescriptor(opened.fileDescriptor);
    const completedCanonicalPath = await safeRealpath(candidate);
    const normalizedRelativePath = pathRelativeToRoot(root, opened.canonicalPath);
    if (
      !sameFileSystemVersion(opened.fileStat, completedStat) ||
      completedCanonicalPath !== opened.canonicalPath ||
      normalizedRelativePath === undefined
    ) {
      return undefined;
    }
    await revalidatePreparedRoot(rootState);
    const snapshot: CapturedFileReplacement = fileSystemFreeze({
      [capturedFileReplacementBrand]: true,
      body: fileSystemCopyBytes(body),
      relativePath: normalizedRelativePath,
    });
    securityWeakMapSet(capturedFileReplacementProvenance, snapshot, {
      body,
      canonicalPath: opened.canonicalPath,
      fileStat: completedStat,
      relativePath: normalizedRelativePath,
      rootState,
    });
    return snapshot;
  } finally {
    await fileSystemCloseFileDescriptor(opened.fileDescriptor);
  }
}

async function replaceCapturedConfinedFile(
  rootState: FileSystemRootState,
  snapshot: CapturedFileReplacement,
  source: string | Uint8Array,
): Promise<void> {
  const provenance = securityWeakMapGet(capturedFileReplacementProvenance, snapshot);
  if (provenance === undefined || provenance.rootState !== rootState) {
    throw new TypeError(
      'Filesystem replacement requires an identity-bound snapshot from this boundary.',
    );
  }
  const replacement = snapshotReplacementBody(source);
  if (!(await prepareFileSystemRoot(rootState, 'required'))) {
    throw confinedEntryIdentityChangedError(provenance.canonicalPath, 'root disappeared');
  }
  const root = preparedRootPath(rootState);
  const targetPath = confinedPath(root, provenance.relativePath);
  if (targetPath === undefined || targetPath !== provenance.canonicalPath) {
    throw confinedEntryIdentityChangedError(
      provenance.canonicalPath,
      'captured path no longer names the same confined target',
    );
  }

  await withFileSystemRootCommitLock(root, async () => {
    await ensureParentsStayDirectories(root, targetPath);
    await revalidatePreparedRoot(rootState);
    const current = await openStrictConfinedRegularFile(targetPath, root);
    if (current === undefined) {
      throw confinedEntryIdentityChangedError(targetPath, 'captured file disappeared');
    }
    try {
      const currentBody = fileSystemCopyBytes(
        await fileSystemReadFileDescriptor(current.fileDescriptor),
      );
      const completedStat = await fileSystemStatFileDescriptor(current.fileDescriptor);
      if (
        current.canonicalPath !== provenance.canonicalPath ||
        !sameFileSystemVersion(provenance.fileStat, current.fileStat) ||
        !sameFileSystemVersion(current.fileStat, completedStat) ||
        !sameFileSystemBytes(provenance.body, currentBody)
      ) {
        throw confinedEntryIdentityChangedError(
          targetPath,
          'captured file changed while its replacement was being proved',
        );
      }
      await writeDurableExclusiveTemporaryFileUnderLock(
        rootState,
        root,
        targetPath,
        replacement,
        provenance.fileStat.mode & 0o7777,
        current,
      );
    } finally {
      await fileSystemCloseFileDescriptor(current.fileDescriptor);
    }
  });
}

async function updateDurableConfinedFile(
  rootState: FileSystemRootState,
  relativePath: string,
  update: DurableFileUpdate,
): Promise<void> {
  if (typeof update !== 'function') {
    throw new TypeError('Durable filesystem update must be a synchronous function.');
  }
  if (confinedPath(rootState.root, relativePath) === undefined) {
    throw new Error('Filesystem path escapes its root.');
  }
  await prepareFileSystemRoot(rootState, 'create');
  const root = preparedRootPath(rootState);
  const targetPath = confinedPath(root, relativePath);
  if (targetPath === undefined) throw new Error('Filesystem path escapes its root.');

  await withFileSystemRootCommitLock(root, async () => {
    const createdDirectories = await createConfinedParentDirectories(rootState, root, targetPath);
    await syncCreatedConfinedDirectoryChain(rootState, root, createdDirectories);
    const lockPath = `${targetPath}.lock`;
    const lock = await acquireDurableFileLock(rootState, root, lockPath);
    try {
      await ensureParentsStayDirectories(root, targetPath);
      await revalidatePreparedRoot(rootState);
      const current = await openStrictConfinedRegularFile(targetPath, root);
      try {
        const currentBody =
          current === undefined
            ? undefined
            : fileSystemCopyBytes(
                await fileSystemReadFileDescriptorBounded(
                  current.fileDescriptor,
                  DURABLE_FILE_MAXIMUM_BYTES,
                ),
              );
        if (current !== undefined) {
          const completedStat = await fileSystemStatFileDescriptor(current.fileDescriptor);
          if (!sameFileSystemVersion(current.fileStat, completedStat)) {
            throw confinedEntryIdentityChangedError(
              targetPath,
              'durable file changed during its locked read',
            );
          }
        }
        const next = update(
          currentBody === undefined ? undefined : fileSystemCopyBytes(currentBody),
        );
        if (next !== undefined) {
          const nextBody = durableFileBody(next);
          await writeDurableExclusiveTemporaryFileUnderLock(
            rootState,
            root,
            targetPath,
            nextBody,
            PRIVATE_FILE_MODE,
            current,
          );
        }
      } finally {
        if (current !== undefined) {
          await fileSystemCloseFileDescriptor(current.fileDescriptor);
        }
      }
    } finally {
      await releaseDurableFileLock(rootState, root, lockPath, lock);
    }
  });
}

function durableFileBody(source: string | Uint8Array): Uint8Array {
  let body: Uint8Array;
  if (typeof source === 'string') {
    body = fileSystemUtf8Encode(source);
  } else {
    if (!fileSystemIsUint8Array(source)) {
      throw new TypeError('Durable filesystem update must be a string or Uint8Array.');
    }
    body = fileSystemCopyBytes(source);
  }
  if (fileSystemArrayBufferViewByteLength(body) > DURABLE_FILE_MAXIMUM_BYTES) {
    throw new TypeError('Durable filesystem update exceeds its byte limit.');
  }
  return body;
}

function snapshotReplacementBody(source: string | Uint8Array): string | Uint8Array {
  if (typeof source === 'string') return source;
  if (!fileSystemIsUint8Array(source)) {
    throw new TypeError('Filesystem replacement body must be a string or Uint8Array.');
  }
  return fileSystemCopyBytes(source);
}

function sameFileSystemBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftLength = fileSystemArrayBufferViewByteLength(left);
  if (leftLength !== fileSystemArrayBufferViewByteLength(right)) return false;
  for (let index = 0; index < leftLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
  const requireSingleLink = options.requireSingleLink === true;
  const opened = await openIdentityBoundRegularFile(candidate, root, requireSingleLink);
  if (opened === undefined) return undefined;

  let streamOwnsFileDescriptor = false;
  try {
    let body: ReadableStream<Uint8Array> | Uint8Array;
    if (options.body === 'stream') {
      body = fileSystemCreateReadableStream(opened.fileDescriptor);
      streamOwnsFileDescriptor = true;
    } else {
      body = fileSystemCopyBytes(await fileSystemReadFileDescriptor(opened.fileDescriptor));
      const completedStat = await fileSystemStatFileDescriptor(opened.fileDescriptor);
      if (
        !sameFileSystemVersion(opened.fileStat, completedStat) ||
        !hasSingleLinkIfRequired(completedStat, requireSingleLink)
      ) {
        return undefined;
      }
    }
    return {
      body,
      fileName: fileSystemPathBasename(opened.canonicalPath),
      size: opened.fileStat.size,
    };
  } finally {
    if (!streamOwnsFileDescriptor) {
      await fileSystemCloseFileDescriptor(opened.fileDescriptor);
    }
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
  const opened = await openIdentityBoundRegularFile(candidate, root);
  if (opened === undefined) return undefined;
  try {
    const completedStat = await fileSystemStatFileDescriptor(opened.fileDescriptor);
    if (!sameFileSystemVersion(opened.fileStat, completedStat)) return undefined;
    return { mtime: completedStat.mtime, size: completedStat.size };
  } finally {
    await fileSystemCloseFileDescriptor(opened.fileDescriptor);
  }
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
  await writeExclusiveTemporaryFile(rootState, root, filePath, source);
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
  await withFileSystemRootCommitLock(root, async () => {
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
  });
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
  const source = await readIdentityBoundCopySource(sourcePath);
  await validateConfinedFileTarget(rootState, relativePath);
  await fileSystemMkdir(fileSystemPathDirname(targetPath), true);
  await revalidatePreparedRoot(rootState);
  await ensureParentsStayDirectories(root, targetPath);
  // SPEC §10.6 filesystem door: the source bytes came from an identity-bound descriptor, while the
  // destination is an exclusive/no-follow temporary descriptor. No reviewed source or framework
  // temporary name is reopened through an attacker-swappable path.
  await writeExclusiveTemporaryFile(rootState, root, targetPath, source);
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
  await withFileSystemRootCommitLock(root, async () => {
    await validateConfinedFileTarget(rootState, relativePath);
    await fileSystemMkdir(fileSystemPathDirname(targetPath), true);
    await revalidatePreparedRoot(rootState);
    await ensureParentsStayDirectories(root, targetPath);
    await fileSystemRename(sourcePath, targetPath);
  });
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

async function readIdentityBoundCopySource(sourcePath: string): Promise<Uint8Array> {
  const opened = await openIdentityBoundRegularFile(sourcePath);
  if (opened === undefined) {
    throw new Error(`Filesystem copy source '${sourcePath}' is not a stable regular file.`);
  }
  try {
    const bytes = fileSystemCopyBytes(await fileSystemReadFileDescriptor(opened.fileDescriptor));
    const completedStat = await fileSystemStatFileDescriptor(opened.fileDescriptor);
    const completedCanonicalPath = await safeRealpath(sourcePath);
    if (
      !sameFileSystemVersion(opened.fileStat, completedStat) ||
      completedCanonicalPath !== opened.canonicalPath
    ) {
      throw new Error(`Filesystem copy source '${sourcePath}' changed during its descriptor read.`);
    }
    return bytes;
  } finally {
    await fileSystemCloseFileDescriptor(opened.fileDescriptor);
  }
}

async function writeExclusiveTemporaryFile(
  rootState: FileSystemRootState,
  root: string,
  targetPath: string,
  source: string | Uint8Array,
): Promise<void> {
  await withFileSystemRootCommitLock(root, async () => {
    await writeExclusiveTemporaryFileUnderLock(rootState, root, targetPath, source);
  });
}

async function writeExclusiveTemporaryFileUnderLock(
  rootState: FileSystemRootState,
  root: string,
  targetPath: string,
  source: string | Uint8Array,
): Promise<void> {
  const tempPath = fileSystemPathJoin(
    fileSystemPathDirname(targetPath),
    `.${fileSystemPathBasename(targetPath)}.${process.pid}.${fileSystemRandomUuid()}.tmp`,
  );
  let fileDescriptor: number | undefined;
  let identity: FileSystemIdentity | undefined;
  try {
    await ensureParentsStayDirectories(root, targetPath);
    await revalidatePreparedRoot(rootState);
    fileDescriptor = await fileSystemCreateExclusiveFileDescriptor(tempPath);
    const openedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (!fileSystemStatsIsFile(openedStat)) {
      throw new Error(`Filesystem temporary '${tempPath}' is not a regular file.`);
    }
    identity = fileSystemIdentity(openedStat);
    await fileSystemWriteFileDescriptor(fileDescriptor, source);

    const lexicalStat = await fileSystemLstat(tempPath);
    if (
      fileSystemStatsIsSymbolicLink(lexicalStat) ||
      !fileSystemStatsIsFile(lexicalStat) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(lexicalStat))
    ) {
      throw new Error(`Filesystem temporary '${tempPath}' identity changed before commit.`);
    }

    await revalidatePreparedRoot(rootState);
    await ensureParentsStayDirectories(root, targetPath);
    await fileSystemRename(tempPath, targetPath);

    const committedStat = await fileSystemLstat(targetPath);
    if (
      fileSystemStatsIsSymbolicLink(committedStat) ||
      !fileSystemStatsIsFile(committedStat) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(committedStat))
    ) {
      throw new Error(`Filesystem target '${targetPath}' identity changed during commit.`);
    }
  } catch (error) {
    if (identity !== undefined) {
      await removeIdentityBoundTemporaryFile(rootState, tempPath, identity).catch(() => undefined);
    }
    throw error;
  } finally {
    if (fileDescriptor !== undefined) {
      await fileSystemCloseFileDescriptor(fileDescriptor);
    }
  }
}

async function openStrictConfinedRegularFile(
  candidate: string,
  root: string,
): Promise<IdentityBoundRegularFile | undefined> {
  const lexicalStat = await safeLstat(candidate);
  if (lexicalStat === undefined) return undefined;
  if (fileSystemStatsIsSymbolicLink(lexicalStat) || !fileSystemStatsIsFile(lexicalStat)) {
    throw new Error(`Filesystem target '${candidate}' must be a regular non-symbolic-link file.`);
  }
  const opened = await openIdentityBoundRegularFile(candidate, root, false, true);
  if (opened === undefined) {
    throw confinedEntryIdentityChangedError(
      candidate,
      'regular-file identity changed before descriptor acquisition',
    );
  }
  return opened;
}

async function writeDurableExclusiveTemporaryFileUnderLock(
  rootState: FileSystemRootState,
  root: string,
  targetPath: string,
  source: string | Uint8Array,
  mode: number,
  expectedTarget: IdentityBoundRegularFile | undefined,
): Promise<void> {
  const tempPath = fileSystemPathJoin(
    fileSystemPathDirname(targetPath),
    `.${fileSystemPathBasename(targetPath)}.${process.pid}.${fileSystemRandomUuid()}.durable.tmp`,
  );
  let fileDescriptor: number | undefined;
  let identity: FileSystemIdentity | undefined;
  try {
    await ensureParentsStayDirectories(root, targetPath);
    await revalidatePreparedRoot(rootState);
    fileDescriptor = await fileSystemCreateExclusiveFileDescriptor(tempPath);
    const openedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (!fileSystemStatsIsFile(openedStat) || openedStat.nlink !== 1) {
      throw new Error(`Filesystem durable temporary '${tempPath}' is not a private regular file.`);
    }
    identity = fileSystemIdentity(openedStat);
    await fileSystemWriteFileDescriptor(fileDescriptor, source);
    await fileSystemSetFileMode(fileDescriptor, mode);
    await fileSystemSyncFileDescriptor(fileDescriptor);

    const preparedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    const lexicalStat = await fileSystemLstat(tempPath);
    if (
      fileSystemStatsIsSymbolicLink(lexicalStat) ||
      !fileSystemStatsIsFile(lexicalStat) ||
      lexicalStat.nlink !== 1 ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(lexicalStat)) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(preparedStat)) ||
      (preparedStat.mode & 0o7777) !== mode
    ) {
      throw new Error(`Filesystem durable temporary '${tempPath}' changed before commit.`);
    }

    await revalidatePreparedRoot(rootState);
    await ensureParentsStayDirectories(root, targetPath);
    await verifyExpectedReplacementTarget(targetPath, root, expectedTarget);
    await fileSystemRename(tempPath, targetPath);

    const committedStat = await fileSystemLstat(targetPath);
    if (
      fileSystemStatsIsSymbolicLink(committedStat) ||
      !fileSystemStatsIsFile(committedStat) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(committedStat)) ||
      (committedStat.mode & 0o7777) !== mode
    ) {
      throw new Error(`Filesystem target '${targetPath}' identity changed during durable commit.`);
    }
    await syncConfinedDirectory(fileSystemPathDirname(targetPath));
  } catch (error) {
    if (identity !== undefined) {
      await removeIdentityBoundTemporaryFile(rootState, tempPath, identity).catch(() => undefined);
    }
    throw error;
  } finally {
    if (fileDescriptor !== undefined) {
      await fileSystemCloseFileDescriptor(fileDescriptor);
    }
  }
}

async function verifyExpectedReplacementTarget(
  targetPath: string,
  root: string,
  expected: IdentityBoundRegularFile | undefined,
): Promise<void> {
  const lexicalStat = await safeLstat(targetPath);
  if (expected === undefined) {
    if (lexicalStat !== undefined) {
      throw confinedEntryIdentityChangedError(targetPath, 'a new target appeared before commit');
    }
    return;
  }
  const canonicalPath = await safeRealpath(targetPath);
  const canonicalStat = canonicalPath === undefined ? undefined : await safeStat(canonicalPath);
  const descriptorStat = await fileSystemStatFileDescriptor(expected.fileDescriptor);
  if (
    lexicalStat === undefined ||
    fileSystemStatsIsSymbolicLink(lexicalStat) ||
    !fileSystemStatsIsFile(lexicalStat) ||
    canonicalPath !== expected.canonicalPath ||
    !containsPath(root, expected.canonicalPath) ||
    canonicalStat === undefined ||
    !fileSystemStatsIsFile(canonicalStat) ||
    !sameFileSystemVersion(expected.fileStat, lexicalStat) ||
    !sameFileSystemVersion(expected.fileStat, canonicalStat) ||
    !sameFileSystemVersion(expected.fileStat, descriptorStat)
  ) {
    throw confinedEntryIdentityChangedError(targetPath, 'expected target changed before commit');
  }
}

async function acquireDurableFileLock(
  rootState: FileSystemRootState,
  root: string,
  lockPath: string,
): Promise<IdentityBoundRegularFile> {
  for (let attempt = 0; attempt < DURABLE_FILE_LOCK_RETRY_LIMIT; attempt += 1) {
    let fileDescriptor: number | undefined;
    let identity: FileSystemIdentity | undefined;
    try {
      await ensureParentsStayDirectories(root, lockPath);
      await revalidatePreparedRoot(rootState);
      fileDescriptor = await fileSystemCreateExclusiveFileDescriptor(lockPath);
      const fileStat = await fileSystemStatFileDescriptor(fileDescriptor);
      identity = fileSystemIdentity(fileStat);
      const lock: IdentityBoundRegularFile = {
        canonicalPath: lockPath,
        fileDescriptor,
        fileStat,
      };
      await verifyDurableFileLock(lockPath, lock);
      return lock;
    } catch (error) {
      if (fileDescriptor !== undefined) {
        await fileSystemCloseFileDescriptor(fileDescriptor).catch(() => undefined);
      }
      if (identity !== undefined) {
        await removeIdentityBoundTemporaryFile(rootState, lockPath, identity).catch(
          () => undefined,
        );
      }
      if (!isAlreadyExistsError(error)) throw error;
      await assertDurableFileLockCollisionIsSafe(rootState, root, lockPath);
      await fileSystemDelay(DURABLE_FILE_LOCK_RETRY_DELAY_MS);
    }
  }
  throw new TypeError('Durable filesystem lock remained busy.');
}

async function releaseDurableFileLock(
  rootState: FileSystemRootState,
  root: string,
  lockPath: string,
  lock: IdentityBoundRegularFile,
): Promise<void> {
  try {
    await verifyDurableFileLock(lockPath, lock);
  } finally {
    // A hostile replacement must not strand our descriptor even though the foreign pathname is
    // intentionally left untouched. The caller still receives the identity failure.
    await fileSystemCloseFileDescriptor(lock.fileDescriptor);
  }
  await ensureParentsStayDirectories(root, lockPath);
  await revalidatePreparedRoot(rootState);
  const lexicalStat = await fileSystemLstat(lockPath);
  if (
    fileSystemStatsIsSymbolicLink(lexicalStat) ||
    !fileSystemStatsIsFile(lexicalStat) ||
    lexicalStat.nlink !== 1 ||
    !sameFileSystemIdentity(fileSystemIdentity(lock.fileStat), fileSystemIdentity(lexicalStat))
  ) {
    throw confinedEntryIdentityChangedError(lockPath, 'durable lock changed before release');
  }
  await fileSystemUnlink(lockPath);
  await syncConfinedDirectory(fileSystemPathDirname(lockPath));
}

async function assertDurableFileLockCollisionIsSafe(
  rootState: FileSystemRootState,
  root: string,
  lockPath: string,
): Promise<void> {
  await ensureParentsStayDirectories(root, lockPath);
  await revalidatePreparedRoot(rootState);
  const lexicalStat = await safeLstat(lockPath);
  if (lexicalStat === undefined) return;
  if (
    fileSystemStatsIsSymbolicLink(lexicalStat) ||
    !fileSystemStatsIsFile(lexicalStat) ||
    lexicalStat.nlink !== 1
  ) {
    throw new Error(`Filesystem durable lock '${lockPath}' is not a private regular file.`);
  }
}

async function verifyDurableFileLock(
  lockPath: string,
  lock: IdentityBoundRegularFile,
): Promise<void> {
  const descriptorStat = await fileSystemStatFileDescriptor(lock.fileDescriptor);
  const lexicalStat = await fileSystemLstat(lockPath);
  if (
    !fileSystemStatsIsFile(lock.fileStat) ||
    lock.fileStat.nlink !== 1 ||
    fileSystemStatsIsSymbolicLink(lexicalStat) ||
    !fileSystemStatsIsFile(lexicalStat) ||
    lexicalStat.nlink !== 1 ||
    !sameFileSystemIdentity(
      fileSystemIdentity(lock.fileStat),
      fileSystemIdentity(descriptorStat),
    ) ||
    !sameFileSystemIdentity(fileSystemIdentity(lock.fileStat), fileSystemIdentity(lexicalStat))
  ) {
    throw confinedEntryIdentityChangedError(lockPath, 'durable lock identity changed');
  }
}

async function syncConfinedDirectory(
  directoryPath: string,
  expectedIdentity?: FileSystemIdentity,
): Promise<void> {
  let fileDescriptor: number | undefined;
  try {
    const lexicalStat = await fileSystemLstat(directoryPath);
    if (fileSystemStatsIsSymbolicLink(lexicalStat) || !fileSystemStatsIsDirectory(lexicalStat)) {
      throw new Error(`Filesystem durability target '${directoryPath}' is not a directory.`);
    }
    if (
      expectedIdentity !== undefined &&
      !sameFileSystemIdentity(expectedIdentity, fileSystemIdentity(lexicalStat))
    ) {
      throw confinedEntryIdentityChangedError(
        directoryPath,
        'directory identity changed before durability sync',
      );
    }
    fileDescriptor = await fileSystemOpenFileDescriptor(directoryPath);
    const descriptorStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (
      !fileSystemStatsIsDirectory(descriptorStat) ||
      !sameFileSystemIdentity(
        fileSystemIdentity(lexicalStat),
        fileSystemIdentity(descriptorStat),
      ) ||
      (expectedIdentity !== undefined &&
        !sameFileSystemIdentity(expectedIdentity, fileSystemIdentity(descriptorStat)))
    ) {
      throw confinedEntryIdentityChangedError(
        directoryPath,
        'directory identity changed before durability sync',
      );
    }
    await fileSystemSyncFileDescriptor(fileDescriptor);
    const completedStat = await fileSystemLstat(directoryPath);
    if (
      fileSystemStatsIsSymbolicLink(completedStat) ||
      !fileSystemStatsIsDirectory(completedStat) ||
      !sameFileSystemIdentity(
        fileSystemIdentity(descriptorStat),
        fileSystemIdentity(completedStat),
      ) ||
      (expectedIdentity !== undefined &&
        !sameFileSystemIdentity(expectedIdentity, fileSystemIdentity(completedStat)))
    ) {
      throw confinedEntryIdentityChangedError(
        directoryPath,
        'directory identity changed during durability sync',
      );
    }
  } catch (error) {
    if (!isWindowsDirectorySyncError(error)) throw error;
  } finally {
    if (fileDescriptor !== undefined) {
      await fileSystemCloseFileDescriptor(fileDescriptor);
    }
  }
}

function isWindowsDirectorySyncError(error: unknown): boolean {
  return (
    process.platform === 'win32' &&
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EACCES' ||
      error.code === 'EINVAL' ||
      error.code === 'EISDIR' ||
      error.code === 'EPERM')
  );
}

async function withFileSystemRootCommitLock<Result>(
  _root: string,
  run: () => Promise<Result>,
): Promise<Result> {
  // SPEC §2 / §10.6: independently-created boundaries share one boot-pinned commit queue. A
  // process-global tail is the honest alias-complete baseline: exact/case-folded target aliases,
  // overlapping roots (`/root/sub/x` vs `/root/sub` + `x`), and parent-tree removal all serialize.
  // Reads and precomputation remain outside this short commit section.
  const previous =
    fileSystemCommitLock ?? fileSystemCreatePromise<void>((resolveLock) => resolveLock(undefined));
  let releaseCurrent: () => void = () => undefined;
  const current = fileSystemCreatePromise<void>((resolveLock) => {
    releaseCurrent = resolveLock;
  });
  // Store the private gate directly. Returning it from a promise callback would trigger thenable
  // assimilation through mutable Promise.prototype.then after app evaluation, letting authored
  // code settle the queue tail before this commit releases it.
  fileSystemCommitLock = current;
  await fileSystemPromiseThen(
    previous,
    () => undefined,
    () => undefined,
  );
  try {
    return await run();
  } finally {
    releaseCurrent();
    if (fileSystemCommitLock === current) fileSystemCommitLock = undefined;
  }
}

async function removeIdentityBoundTemporaryFile(
  rootState: FileSystemRootState,
  tempPath: string,
  identity: FileSystemIdentity,
): Promise<void> {
  await revalidatePreparedRoot(rootState);
  const root = preparedRootPath(rootState);
  if (!containsPath(root, tempPath) || tempPath === root) return;
  await ensureParentsStayDirectories(root, tempPath);
  await revalidatePreparedRoot(rootState);
  try {
    const lexicalStat = await fileSystemLstat(tempPath);
    if (
      fileSystemStatsIsSymbolicLink(lexicalStat) ||
      !fileSystemStatsIsFile(lexicalStat) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(lexicalStat))
    ) {
      return;
    }
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
  const root = preparedRootPath(rootState);
  await withFileSystemRootCommitLock(root, async () => {
    await revalidatePreparedRoot(rootState);
    await fileSystemRemoveTree(root);
  });
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

async function confinedDirectoryEntries(
  rootState: FileSystemRootState,
  relativePath: string,
  expectedDirectory?: ConfinedFileSystemEntryProvenance,
): Promise<readonly ConfinedFileSystemEntry[]> {
  if (confinedPath(rootState.root, relativePath) === undefined) return fileSystemFreeze([]);
  if (!(await prepareFileSystemRoot(rootState, 'observe'))) return fileSystemFreeze([]);
  const root = preparedRootPath(rootState);
  const resolvedDirectory =
    expectedDirectory === undefined
      ? await resolvedConfinedDirectory(root, relativePath)
      : await verifyConfinedEntryProvenance(rootState, expectedDirectory, 'directory');
  if (resolvedDirectory === undefined) return fileSystemFreeze([]);
  let entries: Dirent[];
  try {
    entries = await fileSystemReadDirectory(resolvedDirectory);
  } catch (error) {
    if (isMissingPathError(error)) return fileSystemFreeze([]);
    throw error;
  }
  await revalidatePreparedRoot(rootState);
  if (expectedDirectory !== undefined) {
    await verifyConfinedEntryProvenance(rootState, expectedDirectory, 'directory');
  }
  const output: ConfinedFileSystemEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const childRelativePath = fileSystemPathJoin(relativePath, entry.name);
    const snapshot = await snapshotConfinedFileSystemEntry(
      rootState,
      root,
      entry.name,
      childRelativePath,
    );
    securityDefineProperty(output, output.length, {
      configurable: true,
      enumerable: true,
      value: snapshot,
      writable: true,
    });
  }
  return fileSystemFreeze(output);
}

async function resolvedConfinedDirectory(
  root: string,
  relativePath: string,
): Promise<string | undefined> {
  const directoryPath = confinedPath(root, relativePath);
  if (directoryPath === undefined) return undefined;
  const resolvedDirectory = await safeRealpath(directoryPath);
  return resolvedDirectory !== undefined && containsPath(root, resolvedDirectory)
    ? resolvedDirectory
    : undefined;
}

async function snapshotConfinedFileSystemEntry(
  rootState: FileSystemRootState,
  root: string,
  name: string,
  relativePath: string,
): Promise<ConfinedFileSystemEntry> {
  const candidate = confinedPath(root, relativePath);
  if (candidate === undefined) {
    throw new Error(`Filesystem directory entry '${relativePath}' escapes its root.`);
  }

  let lexicalStat: Stats;
  try {
    lexicalStat = await fileSystemLstat(candidate);
  } catch (error) {
    throw confinedEntryIdentityChangedError(candidate, error);
  }
  const kind: ConfinedFileSystemEntry['kind'] = fileSystemStatsIsSymbolicLink(lexicalStat)
    ? 'other'
    : fileSystemStatsIsDirectory(lexicalStat)
      ? 'directory'
      : fileSystemStatsIsFile(lexicalStat)
        ? 'file'
        : 'other';
  const snapshot: ConfinedFileSystemEntry = fileSystemFreeze({
    [confinedFileSystemEntryBrand]: true,
    kind,
    name,
    relativePath,
  });

  if (kind === 'directory' || kind === 'file') {
    const canonicalPath = await safeRealpath(candidate);
    if (canonicalPath === undefined || !containsPath(root, canonicalPath)) {
      throw confinedEntryIdentityChangedError(candidate, 'canonical path escaped its root');
    }
    let canonicalStat: Stats;
    try {
      canonicalStat = await fileSystemStat(canonicalPath);
    } catch (error) {
      throw confinedEntryIdentityChangedError(candidate, error);
    }
    const identity = fileSystemIdentity(lexicalStat);
    if (
      (kind === 'directory'
        ? !fileSystemStatsIsDirectory(canonicalStat)
        : !fileSystemStatsIsFile(canonicalStat)) ||
      !sameFileSystemIdentity(identity, fileSystemIdentity(canonicalStat))
    ) {
      throw confinedEntryIdentityChangedError(candidate, 'classification or identity changed');
    }
    await revalidatePreparedRoot(rootState);
    securityWeakMapSet(confinedFileSystemEntryProvenance, snapshot, {
      canonicalPath,
      identity,
      kind,
      relativePath,
      rootState,
    });
  }

  return snapshot;
}

async function confinedEntryDirectoryEntries(
  rootState: FileSystemRootState,
  entry: ConfinedFileSystemEntry,
): Promise<readonly ConfinedFileSystemEntry[]> {
  const provenance = confinedEntryProvenance(rootState, entry, 'directory');
  return await confinedDirectoryEntries(rootState, provenance.relativePath, provenance);
}

async function readConfinedEntryFileBytes(
  rootState: FileSystemRootState,
  entry: ConfinedFileSystemEntry,
): Promise<Uint8Array> {
  const provenance = confinedEntryProvenance(rootState, entry, 'file');
  const resolved = await verifyConfinedEntryProvenance(rootState, provenance, 'file');
  const fileDescriptor = await safeOpen(resolved);
  if (fileDescriptor === undefined) {
    throw confinedEntryIdentityChangedError(resolved, 'file disappeared before open');
  }
  try {
    const openedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (
      !fileSystemStatsIsFile(openedStat) ||
      !sameFileSystemIdentity(provenance.identity, fileSystemIdentity(openedStat))
    ) {
      throw confinedEntryIdentityChangedError(resolved, 'opened file identity changed');
    }
    await verifyConfinedEntryProvenance(rootState, provenance, 'file');
    const bytes = await fileSystemReadFileDescriptor(fileDescriptor);
    const finalStat = await fileSystemStatFileDescriptor(fileDescriptor);
    if (!sameFileSystemIdentity(provenance.identity, fileSystemIdentity(finalStat))) {
      throw confinedEntryIdentityChangedError(resolved, 'file identity changed during read');
    }
    return fileSystemCopyBytes(bytes);
  } finally {
    await fileSystemCloseFileDescriptor(fileDescriptor);
  }
}

function confinedEntryProvenance(
  rootState: FileSystemRootState,
  entry: ConfinedFileSystemEntry,
  expectedKind: 'directory' | 'file',
): ConfinedFileSystemEntryProvenance {
  const provenance = securityWeakMapGet(confinedFileSystemEntryProvenance, entry);
  if (
    provenance === undefined ||
    provenance.rootState !== rootState ||
    provenance.kind !== expectedKind
  ) {
    throw new TypeError(
      `Filesystem ${expectedKind} entry must be an identity-bound result from this boundary.`,
    );
  }
  return provenance;
}

async function verifyConfinedEntryProvenance(
  rootState: FileSystemRootState,
  provenance: ConfinedFileSystemEntryProvenance,
  expectedKind: 'directory' | 'file',
): Promise<string> {
  if (provenance.rootState !== rootState || provenance.kind !== expectedKind) {
    throw new TypeError(`Filesystem ${expectedKind} entry belongs to another boundary.`);
  }
  if (!(await prepareFileSystemRoot(rootState, 'required'))) {
    throw confinedEntryIdentityChangedError(provenance.canonicalPath, 'root disappeared');
  }
  const root = preparedRootPath(rootState);
  const candidate = confinedPath(root, provenance.relativePath);
  if (candidate === undefined) {
    throw confinedEntryIdentityChangedError(provenance.canonicalPath, 'path escaped its root');
  }
  let lexicalStat: Stats;
  try {
    lexicalStat = await fileSystemLstat(candidate);
  } catch (error) {
    throw confinedEntryIdentityChangedError(candidate, error);
  }
  if (
    fileSystemStatsIsSymbolicLink(lexicalStat) ||
    (expectedKind === 'directory'
      ? !fileSystemStatsIsDirectory(lexicalStat)
      : !fileSystemStatsIsFile(lexicalStat)) ||
    !sameFileSystemIdentity(provenance.identity, fileSystemIdentity(lexicalStat))
  ) {
    throw confinedEntryIdentityChangedError(candidate, 'lexical entry identity changed');
  }
  const canonicalPath = await safeRealpath(candidate);
  if (canonicalPath === undefined || canonicalPath !== provenance.canonicalPath) {
    throw confinedEntryIdentityChangedError(candidate, 'canonical path changed');
  }
  let canonicalStat: Stats;
  try {
    canonicalStat = await fileSystemStat(canonicalPath);
  } catch (error) {
    throw confinedEntryIdentityChangedError(candidate, error);
  }
  if (
    (expectedKind === 'directory'
      ? !fileSystemStatsIsDirectory(canonicalStat)
      : !fileSystemStatsIsFile(canonicalStat)) ||
    !sameFileSystemIdentity(provenance.identity, fileSystemIdentity(canonicalStat))
  ) {
    throw confinedEntryIdentityChangedError(candidate, 'canonical entry identity changed');
  }
  await revalidatePreparedRoot(rootState);
  return canonicalPath;
}

function confinedEntryIdentityChangedError(path: string, detail: unknown): Error {
  const message = detail instanceof Error ? detail.message : String(detail);
  return new Error(`Filesystem entry identity changed for '${path}': ${message}.`);
}

async function createConfinedParentDirectories(
  rootState: FileSystemRootState,
  root: string,
  targetPath: string,
): Promise<readonly ConfinedDirectoryDurabilityWitness[]> {
  const parentPath = fileSystemPathDirname(targetPath);
  const resolvedRoot = fileSystemPathResolve(root);
  const relativeDirectory =
    parentPath === resolvedRoot ? '' : pathRelativeToRoot(resolvedRoot, parentPath);
  if (relativeDirectory === undefined) throw new Error('Filesystem path escapes its root.');
  const segments =
    relativeDirectory === ''
      ? []
      : fileSystemStringSplit(relativeDirectory, fileSystemPathSeparator());
  const createdDirectories: ConfinedDirectoryDurabilityWitness[] = [];
  let current = resolvedRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = fileSystemPathJoin(current, segments[index]!);
    let parentStat = await safeLstat(current);
    const wasMissing = parentStat === undefined;
    if (parentStat === undefined) {
      // SPEC §10.6: create one checked component at a time. Node has no portable mkdirat(2), so
      // the narrow lstat/mkdir interval remains part of the documented hostile-local-actor ceiling.
      try {
        await fileSystemMkdirPrivate(current);
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
      parentStat = await fileSystemLstat(current);
    }
    if (fileSystemStatsIsSymbolicLink(parentStat)) {
      throw new Error(`Filesystem parent '${current}' is a symbolic link.`);
    }
    if (!fileSystemStatsIsDirectory(parentStat)) {
      throw new Error(`Filesystem parent '${current}' is not a directory.`);
    }
    if (wasMissing) {
      createdDirectories[createdDirectories.length] = {
        identity: fileSystemIdentity(parentStat),
        path: current,
      };
    }
    await revalidatePreparedRoot(rootState);
  }
  const canonicalParent = await safeRealpath(parentPath);
  if (canonicalParent !== parentPath) {
    throw confinedEntryIdentityChangedError(
      parentPath,
      `resolved to '${String(canonicalParent)}' instead of the confined parent`,
    );
  }
  await revalidatePreparedRoot(rootState);
  return createdDirectories;
}

async function syncCreatedConfinedDirectoryChain(
  rootState: FileSystemRootState,
  root: string,
  createdDirectories: readonly ConfinedDirectoryDurabilityWitness[],
): Promise<void> {
  if (createdDirectories.length === 0) return;

  // SPEC §10.6 durable state: mkdir persistence is a separate commit from file persistence.
  // Sync each newly created directory deepest-first, then sync the first existing parent that
  // carries the shallowest new directory entry. This makes the whole namespace chain durable
  // before a lock or replacement file can be committed inside it.
  for (let index = createdDirectories.length - 1; index >= 0; index -= 1) {
    const directory = createdDirectories[index]!;
    await syncWitnessedConfinedDirectory(rootState, root, directory);
  }

  const carrierPath = fileSystemPathDirname(createdDirectories[0]!.path);
  await ensureParentsStayDirectories(root, carrierPath);
  await revalidatePreparedRoot(rootState);
  const carrierStat = await fileSystemLstat(carrierPath);
  if (fileSystemStatsIsSymbolicLink(carrierStat) || !fileSystemStatsIsDirectory(carrierStat)) {
    throw new Error(`Filesystem durability carrier '${carrierPath}' is not a directory.`);
  }
  await syncWitnessedConfinedDirectory(rootState, root, {
    identity: fileSystemIdentity(carrierStat),
    path: carrierPath,
  });
}

async function syncWitnessedConfinedDirectory(
  rootState: FileSystemRootState,
  root: string,
  directory: ConfinedDirectoryDurabilityWitness,
): Promise<void> {
  if (!containsPath(root, directory.path)) {
    throw new Error('Filesystem durability path escapes its root.');
  }
  await ensureParentsStayDirectories(root, directory.path);
  await revalidatePreparedRoot(rootState);
  await syncConfinedDirectory(directory.path, directory.identity);
  await ensureParentsStayDirectories(root, directory.path);
  await revalidatePreparedRoot(rootState);
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

/**
 * Open one regular file only when the canonical entry observed before open still names the exact
 * descriptor afterward. This binds realpath/stat decisions to the bytes or metadata consumed at
 * the sink instead of reopening an attacker-swappable pathname (SPEC §10.6).
 */
async function openIdentityBoundRegularFile(
  candidate: string,
  confinedRoot?: string,
  requireSingleLink = false,
  rejectSymbolicLink = false,
): Promise<IdentityBoundRegularFile | undefined> {
  const lexicalStat = await safeLstat(candidate);
  if (lexicalStat === undefined || !hasSingleLinkIfRequired(lexicalStat, requireSingleLink)) {
    return undefined;
  }
  const lexicalIsSymbolicLink = fileSystemStatsIsSymbolicLink(lexicalStat);
  if (rejectSymbolicLink && lexicalIsSymbolicLink) return undefined;
  const canonicalPath = await safeRealpath(candidate);
  if (
    canonicalPath === undefined ||
    (confinedRoot !== undefined && !containsPath(confinedRoot, canonicalPath))
  ) {
    return undefined;
  }
  const expectedStat = await safeStat(canonicalPath);
  if (
    expectedStat === undefined ||
    !fileSystemStatsIsFile(expectedStat) ||
    !hasSingleLinkIfRequired(expectedStat, requireSingleLink)
  ) {
    return undefined;
  }
  if (
    !lexicalIsSymbolicLink &&
    !sameFileSystemIdentity(fileSystemIdentity(lexicalStat), fileSystemIdentity(expectedStat))
  ) {
    return undefined;
  }

  const fileDescriptor = await safeOpen(canonicalPath);
  if (fileDescriptor === undefined) return undefined;
  try {
    const openedStat = await fileSystemStatFileDescriptor(fileDescriptor);
    const postOpenLexicalStat = await safeLstat(candidate);
    const postOpenCanonicalPath = await safeRealpath(candidate);
    const postOpenStat =
      postOpenCanonicalPath === undefined ? undefined : await safeStat(postOpenCanonicalPath);
    if (
      !fileSystemStatsIsFile(openedStat) ||
      !hasSingleLinkIfRequired(openedStat, requireSingleLink) ||
      !sameFileSystemVersion(expectedStat, openedStat) ||
      postOpenLexicalStat === undefined ||
      !hasSingleLinkIfRequired(postOpenLexicalStat, requireSingleLink) ||
      fileSystemStatsIsSymbolicLink(postOpenLexicalStat) !== lexicalIsSymbolicLink ||
      (rejectSymbolicLink && fileSystemStatsIsSymbolicLink(postOpenLexicalStat)) ||
      !sameFileSystemIdentity(
        fileSystemIdentity(lexicalStat),
        fileSystemIdentity(postOpenLexicalStat),
      ) ||
      postOpenCanonicalPath !== canonicalPath ||
      postOpenStat === undefined ||
      !fileSystemStatsIsFile(postOpenStat) ||
      !hasSingleLinkIfRequired(postOpenStat, requireSingleLink) ||
      !sameFileSystemVersion(expectedStat, postOpenStat) ||
      (confinedRoot !== undefined && !containsPath(confinedRoot, postOpenCanonicalPath))
    ) {
      await fileSystemCloseFileDescriptor(fileDescriptor);
      return undefined;
    }
    return { canonicalPath, fileDescriptor, fileStat: openedStat };
  } catch (error) {
    await fileSystemCloseFileDescriptor(fileDescriptor).catch(() => undefined);
    throw error;
  }
}

function hasSingleLinkIfRequired(fileStat: Stats, requireSingleLink: boolean): boolean {
  return !requireSingleLink || fileStat.nlink === 1;
}

async function safeRealpath(filePath: string): Promise<string | undefined> {
  try {
    return await fileSystemRealpath(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function safeLstat(filePath: string): Promise<Stats | undefined> {
  try {
    return await fileSystemLstat(filePath);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function safeStat(filePath: string): Promise<Stats | undefined> {
  try {
    return await fileSystemStat(filePath);
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

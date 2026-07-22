/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked directly. */
import { Buffer as BuiltinBuffer } from 'node:buffer';
import {
  closeSync as builtinCloseSync,
  constants as builtinFsConstants,
  fstatSync as builtinFstatSync,
  lstatSync as builtinLstatSync,
  openSync as builtinOpenSync,
  readFileSync as builtinReadFileSync,
  readSync as builtinReadSync,
  readdirSync as builtinReaddirSync,
  realpathSync as builtinRealpathSync,
  statSync as builtinStatSync,
  type Stats,
} from 'node:fs';
import {
  isAbsolute as builtinPathIsAbsolute,
  relative as builtinPathRelative,
  resolve as builtinPathResolve,
  sep as pathSeparator,
} from 'node:path';

import typescript from 'typescript';

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayLength,
  compilerFailClosed,
  compilerFreeze,
  compilerNumberIsFinite,
  compilerNumberIsSafeInteger,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerStatsIsDirectory,
  compilerStatsIsFile,
  compilerStatsIsSymbolicLink,
  compilerStringIncludes,
  compilerStringStartsWith,
  compilerUtf8Text,
} from './compiler-security-intrinsics.ts';

const nativeBufferAllocUnsafe = BuiltinBuffer.allocUnsafe;
const nativeCloseSync = builtinCloseSync;
const nativeFstatSync = builtinFstatSync;
const nativeLstatSync = builtinLstatSync;
const nativeOpenSync = builtinOpenSync;
const nativePathIsAbsolute = builtinPathIsAbsolute;
const nativePathRelative = builtinPathRelative;
const nativePathResolve = builtinPathResolve;
const nativeReadFileSync = builtinReadFileSync;
const nativeReadSync = builtinReadSync;
const nativeReaddirSync = builtinReaddirSync;
const nativeRealpathSync = builtinRealpathSync;
const nativeStatSync = builtinStatSync;
const nativePreProcessFile = typescript.preProcessFile;
const compilerSourceOpenFlags =
  builtinFsConstants.O_RDONLY | builtinFsConstants.O_NOFOLLOW | builtinFsConstants.O_NONBLOCK;

type CompilerSourceEntryKind = 'directory' | 'file' | 'other';

interface FileSystemIdentity {
  readonly device: number;
  readonly inode: number;
}

interface FileSystemVersion {
  readonly ctimeMs: number;
  readonly mtimeMs: number;
  readonly size: number;
}

/** @internal Immutable launch-root identity for ambient compiler discovery. */
export interface CompilerSourceRootWitness extends FileSystemIdentity {
  readonly canonicalRoot: string;
}

interface CompilerSourceRootState {
  readonly canonicalRoot: string;
  readonly identity: FileSystemIdentity;
  readonly lexicalRoot: string;
}

interface CompilerSourceEntryFacts {
  readonly canonicalPath: string;
  readonly identity: FileSystemIdentity;
  readonly kind: Exclude<CompilerSourceEntryKind, 'other'>;
  readonly lexicalPath: string;
  readonly version: FileSystemVersion;
}

/** @internal Synchronous source-tree capability used by compiler build discovery. */
export interface CompilerSourceFileSystem {
  readonly root: string;
  entries(directory: string): readonly string[];
  kind(fileName: string): CompilerSourceEntryKind;
  readDirectory(directory: string): readonly string[] | null;
  readFile(fileName: string): string | null;
  readFileBounded(fileName: string, maxBytes: number): string | null;
}

/** @internal Extract the module specifiers TypeScript recognizes without evaluating source. */
export function compilerSourceModuleSpecifiers(source: string): readonly string[] {
  const preprocessed = nativePreProcessFile(source, true, true);
  const importedFiles = preprocessed.importedFiles;
  if (!compilerArrayIsArray(importedFiles)) {
    return compilerFailClosed('Compiler source module specifiers must be an array.');
  }
  const length = compilerArrayLength(importedFiles, 'Compiler source module specifiers');
  const specifiers: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const imported = compilerOwnDataValue(
      importedFiles,
      index,
      'Compiler source module specifiers',
    );
    if (!imported || typeof imported !== 'object') {
      return compilerFailClosed(`Compiler source module specifiers[${index}] must be a record.`);
    }
    const fileName = compilerOwnDataValue(
      imported,
      'fileName',
      `Compiler source module specifiers[${index}]`,
    );
    if (typeof fileName !== 'string') {
      return compilerFailClosed(
        `Compiler source module specifiers[${index}].fileName must be a string.`,
      );
    }
    compilerArrayAppend(specifiers, fileName, 'Compiler source module specifier snapshot');
  }
  return compilerFreeze(specifiers);
}

/**
 * Pin an existing compiler source root and return descriptor-bound, realpath-confined reads.
 *
 * App modules execute in the build process, so every Node/path control is captured when this module
 * is enrolled by the supported compiler bootstrap. A package root itself may be a workspace
 * symlink, but descendants cannot escape its captured canonical target. Final-component symlinks
 * are accepted only when they resolve to a regular file inside that target; directory links and
 * every outside-root link remain unavailable. This preserves SPEC.md §5.2's source-derived IR
 * boundary while allowing in-root documentation aliases.
 *
 * @internal
 */
export function createCompilerSourceRootWitness(rootDir: string): CompilerSourceRootWitness | null {
  try {
    const canonicalRoot = nativeRealpathSync(nativePathResolve(rootDir));
    const rootStat = nativeLstatSync(canonicalRoot);
    if (!compilerStatsIsDirectory(rootStat)) return null;
    if (nativeRealpathSync(canonicalRoot) !== canonicalRoot) return null;
    const identity = fileSystemIdentity(rootStat, 'Compiler source root witness');
    return compilerFreeze({ canonicalRoot, ...identity });
  } catch {
    return null;
  }
}

/** @internal Create a realpath-confined filesystem capability for compiler discovery. */
export function createCompilerSourceFileSystem(
  rootDir: string,
  expectedRoot?: CompilerSourceRootWitness,
): CompilerSourceFileSystem | null {
  let state: CompilerSourceRootState;
  try {
    const lexicalRoot = nativePathResolve(rootDir);
    const canonicalRoot = nativeRealpathSync(lexicalRoot);
    const rootStat = nativeStatSync(canonicalRoot);
    if (!compilerStatsIsDirectory(rootStat)) return null;
    const identity = fileSystemIdentity(rootStat, 'Compiler source root');
    if (
      expectedRoot !== undefined &&
      (canonicalRoot !== expectedRoot.canonicalRoot ||
        !sameFileSystemIdentity(identity, expectedRoot))
    ) {
      return null;
    }
    state = {
      canonicalRoot,
      identity,
      lexicalRoot,
    };
    if (!compilerSourceRootIsStable(state)) return null;
  } catch {
    return null;
  }

  return compilerFreeze({
    root: state.lexicalRoot,
    entries: (directory: string) => compilerSourceDirectoryEntries(state, directory) ?? [],
    kind: (fileName: string) => compilerSourceEntryKind(state, fileName),
    readDirectory: (directory: string) => compilerSourceDirectoryEntries(state, directory),
    readFile: (fileName: string) => readCompilerSourceFile(state, fileName),
    readFileBounded: (fileName: string, maxBytes: number) =>
      readCompilerSourceFile(state, fileName, maxBytes),
  });
}

function compilerSourceDirectoryEntries(
  state: CompilerSourceRootState,
  directory: string,
): readonly string[] | null {
  try {
    const before = compilerSourceEntryFacts(state, directory);
    if (before === null || before.kind !== 'directory') return null;
    const names = compilerSnapshotDenseArray(
      nativeReaddirSync(before.canonicalPath),
      'Compiler source directory entries',
    );
    const after = compilerSourceEntryFacts(state, directory);
    if (after === null || !sameEntryFacts(before, after)) return null;

    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (
        typeof name !== 'string' ||
        name.length === 0 ||
        name === '.' ||
        name === '..' ||
        nativePathIsAbsolute(name) ||
        compilerStringIncludes(name, '\0')
      ) {
        return null;
      }
    }
    return names;
  } catch {
    return null;
  }
}

function compilerSourceEntryKind(
  state: CompilerSourceRootState,
  fileName: string,
): CompilerSourceEntryKind {
  try {
    return compilerSourceEntryFacts(state, fileName)?.kind ?? 'other';
  } catch {
    return 'other';
  }
}

function readCompilerSourceFile(
  state: CompilerSourceRootState,
  fileName: string,
  maxBytes?: number,
): string | null {
  let fileDescriptor: number | undefined;
  try {
    if (maxBytes !== undefined && (!compilerNumberIsSafeInteger(maxBytes) || maxBytes < 0)) {
      return null;
    }
    const before = compilerSourceEntryFacts(state, fileName);
    if (before === null || before.kind !== 'file') return null;

    // O_NOFOLLOW closes the final-component swap window; O_NONBLOCK ensures a raced FIFO cannot
    // stall the compiler before fstat rejects it as non-regular.
    fileDescriptor = nativeOpenSync(before.canonicalPath, compilerSourceOpenFlags);
    const openedBefore = nativeFstatSync(fileDescriptor);
    const openedSize = compilerSourceFileSize(openedBefore);
    const openedBeforeVersion = fileSystemVersion(openedBefore, 'Compiler source');
    if (
      !compilerStatsIsFile(openedBefore) ||
      (maxBytes !== undefined && openedSize > maxBytes) ||
      !sameFileSystemIdentity(
        before.identity,
        fileSystemIdentity(openedBefore, 'Compiler source'),
      ) ||
      !sameFileSystemVersion(before.version, openedBeforeVersion)
    ) {
      return null;
    }

    // A size check followed by readFileSync(fd) is not a memory bound: the same inode can grow
    // between those operations. The bounded path allocates only the observed size plus a one-byte
    // growth probe and reads from the already-validated descriptor.
    const source =
      maxBytes === undefined
        ? nativeReadFileSync(fileDescriptor, 'utf8')
        : readBoundedCompilerSourceText(fileDescriptor, openedSize);
    if (source === null) return null;
    const openedAfter = nativeFstatSync(fileDescriptor);
    const openedAfterVersion = fileSystemVersion(openedAfter, 'Compiler source');
    const after = compilerSourceEntryFacts(state, fileName);
    if (
      typeof source !== 'string' ||
      !compilerStatsIsFile(openedAfter) ||
      (maxBytes !== undefined && compilerSourceFileSize(openedAfter) > maxBytes) ||
      compilerSourceFileSize(openedAfter) !== compilerSourceFileSize(openedBefore) ||
      !sameFileSystemVersion(openedBeforeVersion, openedAfterVersion) ||
      !sameFileSystemIdentity(
        before.identity,
        fileSystemIdentity(openedAfter, 'Compiler source'),
      ) ||
      after === null ||
      !sameEntryFacts(before, after)
    ) {
      return null;
    }
    return source;
  } catch {
    return null;
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        nativeCloseSync(fileDescriptor);
      } catch {
        // A failed close cannot make an unverified source read authoritative.
      }
    }
  }
}

function readBoundedCompilerSourceText(
  fileDescriptor: number,
  expectedBytes: number,
): string | null {
  const bytes = nativeBufferAllocUnsafe(expectedBytes);
  let offset = 0;
  while (offset < expectedBytes) {
    const read = nativeReadSync(fileDescriptor, bytes, offset, expectedBytes - offset, null);
    if (!compilerNumberIsSafeInteger(read) || read < 0 || read > expectedBytes - offset)
      return null;
    if (read === 0) return null;
    offset += read;
  }

  const growthProbe = nativeBufferAllocUnsafe(1);
  const extra = nativeReadSync(fileDescriptor, growthProbe, 0, 1, null);
  if (!compilerNumberIsSafeInteger(extra) || extra !== 0) return null;
  return compilerUtf8Text(bytes);
}

function compilerSourceFileSize(value: Stats): number {
  const size = compilerOwnDataValue(value, 'size', 'Compiler source file');
  if (
    typeof size !== 'number' ||
    !compilerNumberIsFinite(size) ||
    !compilerNumberIsSafeInteger(size) ||
    size < 0
  ) {
    return compilerFailClosed('Compiler source file has an invalid size.');
  }
  return size;
}

function fileSystemVersion(value: Stats, label: string): FileSystemVersion {
  const ctimeMs = compilerOwnDataValue(value, 'ctimeMs', label);
  const mtimeMs = compilerOwnDataValue(value, 'mtimeMs', label);
  const size = compilerSourceFileSize(value);
  if (
    typeof ctimeMs !== 'number' ||
    !compilerNumberIsFinite(ctimeMs) ||
    typeof mtimeMs !== 'number' ||
    !compilerNumberIsFinite(mtimeMs)
  ) {
    return compilerFailClosed(`${label} has an invalid filesystem version.`);
  }
  return { ctimeMs, mtimeMs, size };
}

function compilerSourceEntryFacts(
  state: CompilerSourceRootState,
  fileName: string,
): CompilerSourceEntryFacts | null {
  if (!compilerSourceRootIsStable(state)) return null;
  const lexicalPath = nativePathResolve(fileName);
  if (!containsResolvedPath(state.lexicalRoot, lexicalPath)) return null;
  if (lexicalPath === state.lexicalRoot) {
    const rootStat = nativeStatSync(state.canonicalRoot);
    return {
      canonicalPath: state.canonicalRoot,
      identity: state.identity,
      kind: 'directory',
      lexicalPath,
      version: fileSystemVersion(rootStat, 'Compiler source root'),
    };
  }

  const lexicalStat = nativeLstatSync(lexicalPath);
  const lexicalKind = compilerStatsIsDirectory(lexicalStat)
    ? 'directory'
    : compilerStatsIsFile(lexicalStat)
      ? 'file'
      : compilerStatsIsSymbolicLink(lexicalStat)
        ? 'symbolic-link'
        : null;
  if (lexicalKind === null) return null;

  const canonicalPath = nativeRealpathSync(lexicalPath);
  if (!containsResolvedPath(state.canonicalRoot, canonicalPath)) return null;
  const canonicalStat = nativeStatSync(canonicalPath);
  const canonicalIdentity = fileSystemIdentity(canonicalStat, 'Compiler source entry');
  const canonicalVersion = fileSystemVersion(canonicalStat, 'Compiler source entry');
  let identity: FileSystemIdentity;
  let kind: Exclude<CompilerSourceEntryKind, 'other'>;
  if (lexicalKind === 'symbolic-link') {
    if (!compilerStatsIsFile(canonicalStat)) return null;
    identity = canonicalIdentity;
    kind = 'file';
  } else {
    kind = lexicalKind;
    identity = fileSystemIdentity(lexicalStat, 'Compiler source entry');
    if (
      (kind === 'directory'
        ? !compilerStatsIsDirectory(canonicalStat)
        : !compilerStatsIsFile(canonicalStat)) ||
      !sameFileSystemIdentity(identity, canonicalIdentity) ||
      !sameFileSystemVersion(
        fileSystemVersion(lexicalStat, 'Compiler lexical source entry'),
        canonicalVersion,
      )
    ) {
      return null;
    }
  }
  if (!compilerSourceRootIsStable(state)) return null;

  return { canonicalPath, identity, kind, lexicalPath, version: canonicalVersion };
}

function compilerSourceRootIsStable(state: CompilerSourceRootState): boolean {
  try {
    const canonicalRoot = nativeRealpathSync(state.lexicalRoot);
    if (canonicalRoot !== state.canonicalRoot) return false;
    const rootStat = nativeStatSync(canonicalRoot);
    return (
      compilerStatsIsDirectory(rootStat) &&
      sameFileSystemIdentity(state.identity, fileSystemIdentity(rootStat, 'Compiler source root'))
    );
  } catch {
    return false;
  }
}

function containsResolvedPath(root: string, target: string): boolean {
  const relativePath = nativePathRelative(root, target);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !compilerStringStartsWith(relativePath, `..${pathSeparator}`) &&
      !nativePathIsAbsolute(relativePath))
  );
}

function fileSystemIdentity(value: Stats, label: string): FileSystemIdentity {
  const device = compilerOwnDataValue(value, 'dev', label);
  const inode = compilerOwnDataValue(value, 'ino', label);
  if (
    typeof device !== 'number' ||
    !compilerNumberIsFinite(device) ||
    typeof inode !== 'number' ||
    !compilerNumberIsFinite(inode)
  ) {
    return compilerFailClosed(`${label} has an invalid filesystem identity.`);
  }
  return { device, inode };
}

function sameFileSystemIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function sameFileSystemVersion(left: FileSystemVersion, right: FileSystemVersion): boolean {
  return (
    left.ctimeMs === right.ctimeMs && left.mtimeMs === right.mtimeMs && left.size === right.size
  );
}

function sameEntryFacts(left: CompilerSourceEntryFacts, right: CompilerSourceEntryFacts): boolean {
  return (
    left.canonicalPath === right.canonicalPath &&
    left.kind === right.kind &&
    left.lexicalPath === right.lexicalPath &&
    sameFileSystemIdentity(left.identity, right.identity) &&
    sameFileSystemVersion(left.version, right.version)
  );
}

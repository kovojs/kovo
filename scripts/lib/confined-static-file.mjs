/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

import {
  close as importedCloseFileDescriptor,
  constants as fsConstants,
  fstat as importedStatFileDescriptor,
  open as importedOpenFileDescriptor,
  readFile as importedReadFileDescriptor,
  stat as importedStatFilePath,
} from 'node:fs';
import { realpath as importedRealpath } from 'node:fs/promises';
import {
  isAbsolute as importedPathIsAbsolute,
  relative as importedPathRelative,
  resolve as importedPathResolve,
  sep as importedPathSeparator,
} from 'node:path';

const NativeObject = globalThis.Object;
const NativeNumber = globalThis.Number;
const NativePromise = globalThis.Promise;
const NativeString = globalThis.String;
const nativeFunctionBind = globalThis.Function.prototype.bind;
const nativeReflectApply = globalThis.Reflect.apply;
const closeFileDescriptor = bindControl(importedCloseFileDescriptor);
const openFileDescriptor = bindControl(importedOpenFileDescriptor);
const pathIsAbsolute = bindControl(importedPathIsAbsolute);
const pathRelative = bindControl(importedPathRelative);
const pathResolve = bindControl(importedPathResolve);
const pathSeparator = importedPathSeparator;
const readFileDescriptor = bindControl(importedReadFileDescriptor);
const realpath = bindControl(importedRealpath);
const statFileDescriptor = bindControl(importedStatFileDescriptor);
const statFilePath = bindControl(importedStatFilePath);
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIs = NativeObject.is;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const fsFileTypeMask = fsConstants.S_IFMT;
const fsRegularFileType = fsConstants.S_IFREG;
const fsReadOnlyNoFollowFlags =
  fsConstants.O_RDONLY | (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);

/**
 * Load one URL pathname from an authenticated regular-file descriptor beneath a static root.
 *
 * SPEC §6.6/§10.6: request bytes, lexical paths, canonical paths, and opened filesystem
 * objects are distinct trust boundaries. Every Node/fs/path control is copied at module boot so
 * later app code plus `syncBuiltinESMExports()` cannot replace the containment decision. The bytes
 * come from the descriptor whose identity was checked, never from a pathname reopened afterward.
 */
export async function readConfinedStaticFile(root, encodedPathname, prefix = '/', readBody = true) {
  let pathname;
  try {
    pathname = apply(nativeDecodeURIComponent, undefined, [encodedPathname]);
  } catch {
    return undefined;
  }
  if (!stringStartsWith(pathname, prefix)) return undefined;

  try {
    const canonicalRoot = await realpath(root);
    const lexicalCandidate = apply(pathResolve, undefined, [canonicalRoot, `.${pathname}`]);
    if (!isConfinedPath(canonicalRoot, lexicalCandidate)) return undefined;
    return await readConfinedFilePath(canonicalRoot, lexicalCandidate, readBody);
  } catch (error) {
    if (isStaticFileMissError(error)) return undefined;
    throw error;
  }
}

/** Load one already-decoded candidate through an authenticated numeric descriptor. */
export async function readConfinedFilePath(root, candidate, readBody = true) {
  let fileDescriptor;
  try {
    const canonicalRoot = await realpath(root);
    const canonicalCandidate = await realpath(candidate);
    if (!isConfinedPath(canonicalRoot, canonicalCandidate)) return undefined;

    const expectedStat = await staticFilePathStat(canonicalCandidate);
    if (!regularStaticFileStat(expectedStat)) return undefined;
    fileDescriptor = await openStaticFileDescriptor(canonicalCandidate);
    if (fileDescriptor === undefined) return undefined;

    const openedStat = await staticFileDescriptorStat(fileDescriptor);
    if (
      !regularStaticFileStat(openedStat) ||
      !sameStaticFileIdentity(expectedStat, openedStat) ||
      !(await staticPathRetainsIdentity(canonicalRoot, canonicalCandidate, expectedStat))
    ) {
      return undefined;
    }

    const body = readBody ? await readStaticFileDescriptor(fileDescriptor) : undefined;
    const completedStat = await staticFileDescriptorStat(fileDescriptor);
    if (
      !regularStaticFileStat(completedStat) ||
      !sameStaticFileIdentity(expectedStat, completedStat) ||
      !(await staticPathRetainsIdentity(canonicalRoot, canonicalCandidate, expectedStat))
    ) {
      return undefined;
    }
    const size = ownDataValue(completedStat, 'size');
    if (
      typeof size !== 'number' ||
      !apply(nativeNumberIsSafeInteger, NativeNumber, [size]) ||
      size < 0
    ) {
      return undefined;
    }

    return { body, filePath: canonicalCandidate, size };
  } catch (error) {
    if (isStaticFileMissError(error)) return undefined;
    throw error;
  } finally {
    if (fileDescriptor !== undefined) await closeStaticFileDescriptor(fileDescriptor);
  }
}

function openStaticFileDescriptor(filePath) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    apply(openFileDescriptor, undefined, [
      filePath,
      fsReadOnlyNoFollowFlags,
      (error, fileDescriptor) => {
        if (error) {
          if (isStaticFileMissError(error)) resolvePromise(undefined);
          else rejectPromise(error);
          return;
        }
        resolvePromise(fileDescriptor);
      },
    ]);
  });
}

function staticFileDescriptorStat(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    apply(statFileDescriptor, undefined, [
      fileDescriptor,
      (error, fileStat) => {
        if (error) rejectPromise(error);
        else resolvePromise(fileStat);
      },
    ]);
  });
}

function staticFilePathStat(filePath) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    apply(statFilePath, undefined, [
      filePath,
      (error, fileStat) => {
        if (error) {
          if (isStaticFileMissError(error)) resolvePromise(undefined);
          else rejectPromise(error);
          return;
        }
        resolvePromise(fileStat);
      },
    ]);
  });
}

function readStaticFileDescriptor(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    apply(readFileDescriptor, undefined, [
      fileDescriptor,
      (error, body) => {
        if (error) rejectPromise(error);
        else resolvePromise(body);
      },
    ]);
  });
}

function closeStaticFileDescriptor(fileDescriptor) {
  return new NativePromise((resolvePromise, rejectPromise) => {
    apply(closeFileDescriptor, undefined, [
      fileDescriptor,
      (error) => {
        if (error) rejectPromise(error);
        else resolvePromise();
      },
    ]);
  });
}

async function staticPathRetainsIdentity(root, candidate, expectedStat) {
  let currentCanonical;
  try {
    currentCanonical = await realpath(candidate);
  } catch (error) {
    if (isStaticFileMissError(error)) return false;
    throw error;
  }
  if (currentCanonical !== candidate || !isConfinedPath(root, currentCanonical)) return false;
  const currentStat = await staticFilePathStat(currentCanonical);
  return regularStaticFileStat(currentStat) && sameStaticFileIdentity(expectedStat, currentStat);
}

function regularStaticFileStat(fileStat) {
  if (fileStat === undefined) return false;
  const mode = ownDataValue(fileStat, 'mode');
  return typeof mode === 'number' && (mode & fsFileTypeMask) === fsRegularFileType;
}

function sameStaticFileIdentity(left, right) {
  const leftDevice = ownDataValue(left, 'dev');
  const leftInode = ownDataValue(left, 'ino');
  const rightDevice = ownDataValue(right, 'dev');
  const rightInode = ownDataValue(right, 'ino');
  return (
    typeof leftDevice === 'number' &&
    typeof leftInode === 'number' &&
    leftDevice === rightDevice &&
    leftInode === rightInode
  );
}

function isStaticFileMissError(error) {
  if (typeof error !== 'object' || error === null) return false;
  const code = ownDataValue(error, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EINVAL';
}

function isConfinedPath(root, candidate) {
  const relative = apply(pathRelative, undefined, [root, candidate]);
  return (
    relative !== '' &&
    relative !== '..' &&
    !stringStartsWith(relative, `..${pathSeparator}`) &&
    !apply(pathIsAbsolute, undefined, [relative])
  );
}

function ownDataValue(value, property) {
  const before = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  const after = apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError('Kovo static-file data changed while it was inspected.');
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new TypeError('Kovo static-file data must use own data properties.');
  }
  return before.value;
}

function sameDataDescriptor(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    apply(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function stringStartsWith(value, prefix) {
  return apply(nativeStringStartsWith, value, [prefix]);
}

function apply(fn, receiver, args) {
  return nativeReflectApply(fn, receiver, args);
}

function bindControl(control) {
  return nativeReflectApply(nativeFunctionBind, control, [undefined]);
}

import {
  closeSync as builtinCloseSync,
  constants as builtinFileSystemConstants,
  fstatSync as builtinFstatSync,
  lstatSync as builtinLstatSync,
  openSync as builtinOpenSync,
  readSync as builtinReadSync,
  type BigIntStats,
} from 'node:fs';

const closeSync = builtinCloseSync;
const fstatSync = builtinFstatSync;
const lstatSync = builtinLstatSync;
const openSync = builtinOpenSync;
const readSync = builtinReadSync;
const boundedNumberIsSafeInteger = Number.isSafeInteger;
const boundedInputOpenFlags =
  builtinFileSystemConstants.O_RDONLY | builtinFileSystemConstants.O_NOFOLLOW;

/** @internal Options for one identity-pinned local CLI evidence read. */
export interface BoundedRegularFileOptions {
  label: string;
  limitMessage: string;
  maxBytes: number;
}

/** @internal Read one regular non-symlink file through a fixed maximum-plus-one descriptor cap. */
export function readBoundedRegularFile(path: string, options: BoundedRegularFileOptions): Buffer {
  if (!boundedNumberIsSafeInteger(options.maxBytes) || options.maxBytes < 0) {
    throw new TypeError('bounded regular-file maximum must be a non-negative safe integer');
  }
  let lexical: BigIntStats;
  let fileDescriptor: number;
  try {
    lexical = lstatSync(path, { bigint: true });
    if (!lexical.isFile()) throw new Error('not a regular file');
    fileDescriptor = openSync(path, boundedInputOpenFlags);
  } catch {
    throw new TypeError(`${options.label} must be a regular non-symlink file`);
  }
  try {
    const initial = fstatSync(fileDescriptor, { bigint: true });
    if (!initial.isFile() || !sameFileVersion(lexical, initial)) {
      throw new TypeError(`${options.label} changed before its bounded descriptor read`);
    }
    if (initial.size > BigInt(options.maxBytes)) throw new TypeError(options.limitMessage);
    const expectedLength = Number(initial.size);
    const bytes = Buffer.allocUnsafe(expectedLength + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const count = readSync(fileDescriptor, bytes, length, bytes.byteLength - length, null);
      if (count === 0) break;
      length += count;
    }
    const completed = fstatSync(fileDescriptor, { bigint: true });
    let completedLexical: BigIntStats;
    try {
      completedLexical = lstatSync(path, { bigint: true });
    } catch {
      throw new TypeError(`${options.label} changed during its bounded descriptor read`);
    }
    if (length > options.maxBytes) throw new TypeError(options.limitMessage);
    if (
      length !== expectedLength ||
      !sameFileVersion(initial, completed) ||
      !sameFileVersion(completed, completedLexical)
    ) {
      throw new TypeError(`${options.label} changed during its bounded descriptor read`);
    }
    return Buffer.from(bytes.subarray(0, length));
  } finally {
    closeSync(fileDescriptor);
  }
}

function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

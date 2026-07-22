import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

/** Snapshot one regular non-symlink file without allocating from its untrusted size. */
export function readBoundedRegularFile(filePath, maxBytes, label) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError(`${label} has an invalid byte limit`);
  }
  const pathStat = lstatSync(filePath, { bigint: true });
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size > BigInt(maxBytes)) {
    throw new TypeError(`${label} must be a regular non-symlink file no larger than ${maxBytes}`);
  }

  // O_NONBLOCK prevents a path swapped to a FIFO after lstat from hanging before fstat rejects it.
  const descriptor = openSync(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameFileSnapshot(pathStat, before) || before.size > BigInt(maxBytes)) {
      throw new TypeError(`${label} changed identity or exceeds its byte limit`);
    }

    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const remaining = buffer.byteLength - offset;
      const count = readSync(descriptor, buffer, offset, remaining, null);
      if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
        throw new TypeError(`${label} descriptor returned an invalid byte count`);
      }
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new TypeError(`${label} exceeds its ${maxBytes}-byte limit`);

    const after = fstatSync(descriptor, { bigint: true });
    const finalPathStat = lstatSync(filePath, { bigint: true });
    if (
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, finalPathStat) ||
      BigInt(offset) !== after.size
    ) {
      throw new TypeError(`${label} changed while its bytes were snapshotted`);
    }
    return Buffer.from(buffer.subarray(0, offset));
  } finally {
    closeSync(descriptor);
  }
}

function sameFileSnapshot(left, right) {
  return (
    left.isFile() === right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

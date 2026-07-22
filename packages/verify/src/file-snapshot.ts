import type { BigIntStats } from 'node:fs';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

interface BoundedRegularFileSnapshot {
  bytes: Uint8Array;
  stat: BigIntStats;
}

type DescriptorReader = (
  descriptor: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: null,
) => number;

/** Read at most maxBytes from the descriptor without an attacker-controlled allocation. */
export function readBoundedDescriptor(
  descriptor: number,
  maxBytes: number,
  label: string,
  read: DescriptorReader = readSync,
): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError(`${label} has an invalid byte limit`);
  }
  const buffer = new Uint8Array(maxBytes + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const remaining = buffer.byteLength - offset;
    const count = read(descriptor, buffer, offset, remaining, null);
    if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
      throw new TypeError(`${label} descriptor returned an invalid byte count`);
    }
    if (count === 0) break;
    offset += count;
  }
  if (offset > maxBytes) {
    throw new TypeError(`${label} exceeds its ${maxBytes}-byte limit`);
  }
  return buffer.subarray(0, offset);
}

/** Snapshot one regular, non-symlink path through the same bounded no-follow descriptor. */
export function readBoundedRegularFileSnapshot(
  filePath: string,
  maxBytes: number,
  label: string,
): BoundedRegularFileSnapshot {
  const pathStat = lstatSync(filePath, { bigint: true });
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.size > BigInt(maxBytes)) {
    throw new TypeError(`${label} must be a regular non-symlink file no larger than ${maxBytes}`);
  }
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.dev !== pathStat.dev ||
      before.ino !== pathStat.ino ||
      before.size > BigInt(maxBytes)
    ) {
      throw new TypeError(`${label} changed identity or exceeds its byte limit`);
    }
    const bytes = readBoundedDescriptor(descriptor, maxBytes, label);
    const after = fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new TypeError(`${label} changed while its bytes were snapshotted`);
    }
    return { bytes, stat: after };
  } finally {
    closeSync(descriptor);
  }
}

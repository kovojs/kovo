import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  securityApply,
  securityArrayAppend,
  securityGetOwnPropertyNames,
  securityGetOwnPropertySymbols,
  securityGetPrototypeOf,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
} from '#security-witness-intrinsics';

/** Package-private controls for render-plan framing and hashing (SPEC §5.2.1). */
const NativeBuffer = Buffer;
const nativeBufferByteLength = NativeBuffer.byteLength;
const nativeCreateHash = createHash;
const hashControl = nativeCreateHash('sha256');
const hashPrototype = securityGetPrototypeOf(hashControl);
const nativeHashUpdate =
  hashPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(hashPrototype, 'update')?.value;
const nativeHashDigest =
  hashPrototype === null
    ? undefined
    : securityGetOwnPropertyDescriptor(hashPrototype, 'digest')?.value;

if (typeof nativeHashUpdate !== 'function' || typeof nativeHashDigest !== 'function') {
  throw new TypeError('Kovo render-plan hash controls are unavailable.');
}

function controlsAreSound(): boolean {
  try {
    if (securityApply(nativeBufferByteLength, NativeBuffer, ['名🙂', 'utf8']) !== 7) return false;
    const hash = nativeCreateHash('sha256');
    securityApply(nativeHashUpdate, hash, ['abc']);
    return (
      securityApply<string>(nativeHashDigest, hash, ['hex']) ===
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = controlsAreSound();
const MAX_RENDER_PLAN_SHAPE_ENTRIES = 100_000;

function assertControls(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo render-plan controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

export function renderPlanUtf8ByteLength(value: string): number {
  assertControls();
  if (typeof value !== 'string') throw new TypeError('Render-plan frame values must be strings.');
  return securityApply(nativeBufferByteLength, NativeBuffer, [value, 'utf8']);
}

export function renderPlanOwnStringEntries(input: object): readonly (readonly [string, string])[] {
  assertControls();
  if (securityGetOwnPropertySymbols(input).length !== 0) {
    throw new TypeError('Render-plan shape maps must not contain symbol properties.');
  }
  const ownNames = securityGetOwnPropertyNames(input);
  if (ownNames.length > MAX_RENDER_PLAN_SHAPE_ENTRIES) {
    throw new TypeError(
      `Render-plan shape maps must contain at most ${MAX_RENDER_PLAN_SHAPE_ENTRIES} entries.`,
    );
  }
  const names = sortStrings(ownNames);
  const entries: [string, string][] = [];
  for (let index = 0; index < names.length; index += 1) {
    const nameEntry = securityOwnArrayEntry(names, index);
    if (!nameEntry.ok) throw new TypeError('Render-plan shape names must be dense.');
    const name = nameEntry.value;
    const descriptor = securityGetOwnPropertyDescriptor(input, name);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(`Render-plan shape ${name} must be an enumerable string data property.`);
    }
    const entry: [string, string] = [name, descriptor.value];
    securityArrayAppend(entries, entry);
  }
  return entries;
}

export function renderPlanHash16(parts: readonly string[]): string {
  assertControls();
  const hash = nativeCreateHash('sha256');
  for (let index = 0; index < parts.length; index += 1) {
    const partEntry = securityOwnArrayEntry(parts, index);
    if (!partEntry.ok) throw new TypeError('Render-plan hash inputs must be dense.');
    const part = partEntry.value;
    if (typeof part !== 'string') throw new TypeError('Render-plan hash inputs must be strings.');
    securityApply(nativeHashUpdate, hash, [part]);
  }
  const digest = securityApply<string>(nativeHashDigest, hash, ['hex']);
  if (digest.length !== 64) throw new TypeError('Kovo render-plan digest has an invalid shape.');
  let token = '';
  for (let index = 0; index < 16; index += 1) token += digest[index];
  return token;
}

function sortStrings(values: string[]): string[] {
  // Query names are app-shaped build input. Keep canonicalization O(n log n)
  // so reverse-ordered names cannot turn the render-plan authority token into
  // an insertion-sort build denial of service.
  const length = values.length;
  if (length < 2) return values;
  let source = values;
  for (let width = 1; width < length; width *= 2) {
    const target: string[] = [];
    for (let start = 0; start < length; start += width * 2) {
      const middle = start + width < length ? start + width : length;
      const end = start + width * 2 < length ? start + width * 2 : length;
      let left = start;
      let right = middle;
      while (left < middle || right < end) {
        const leftEntry = left < middle ? securityOwnArrayEntry(source, left) : undefined;
        const rightEntry = right < end ? securityOwnArrayEntry(source, right) : undefined;
        if ((left < middle && !leftEntry?.ok) || (right < end && !rightEntry?.ok)) {
          throw new TypeError('Render-plan shape names must be dense.');
        }
        if (right >= end) {
          if (!leftEntry?.ok) throw new TypeError('Render-plan shape names must be dense.');
          securityArrayAppend(target, leftEntry.value);
          left += 1;
        } else if (left >= middle) {
          if (!rightEntry?.ok) throw new TypeError('Render-plan shape names must be dense.');
          securityArrayAppend(target, rightEntry.value);
          right += 1;
        } else if (leftEntry?.ok && rightEntry?.ok && leftEntry.value <= rightEntry.value) {
          securityArrayAppend(target, leftEntry.value);
          left += 1;
        } else {
          if (!rightEntry?.ok) throw new TypeError('Render-plan shape names must be dense.');
          securityArrayAppend(target, rightEntry.value);
          right += 1;
        }
      }
    }
    source = target;
  }
  return source;
}

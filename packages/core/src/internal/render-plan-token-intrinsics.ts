import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  securityApply,
  securityGetPrototypeOf,
  securityGetOwnPropertyDescriptor,
  securityObjectKeys,
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
  const names = securityObjectKeys(input);
  sortStrings(names);
  const entries: [string, string][] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = securityGetOwnPropertyDescriptor(input, name);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw new TypeError(
        `Render-plan shape ${name} must be an enumerable string data property.`,
      );
    }
    entries[entries.length] = [name, descriptor.value];
  }
  return entries;
}

export function renderPlanHash16(parts: readonly string[]): string {
  assertControls();
  const hash = nativeCreateHash('sha256');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (typeof part !== 'string') throw new TypeError('Render-plan hash inputs must be strings.');
    securityApply(nativeHashUpdate, hash, [part]);
  }
  const digest = securityApply<string>(nativeHashDigest, hash, ['hex']);
  if (digest.length !== 64) throw new TypeError('Kovo render-plan digest has an invalid shape.');
  let token = '';
  for (let index = 0; index < 16; index += 1) token += digest[index];
  return token;
}

function sortStrings(values: string[]): void {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    let insertAt = index;
    while (insertAt > 0 && value < values[insertAt - 1]!) {
      values[insertAt] = values[insertAt - 1]!;
      insertAt -= 1;
    }
    values[insertAt] = value;
  }
}

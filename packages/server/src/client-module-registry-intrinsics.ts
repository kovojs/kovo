import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

import {
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/** Package-private hash controls for immutable client-module build tokens (SPEC §5.2.1). */
const nativeCreateHash = createHash;
const NativeBuffer = Buffer;
const nativeBufferByteLength = NativeBuffer.byteLength;
const nativeStringCharCodeAt = String.prototype.charCodeAt;
const hashControl = nativeCreateHash('sha256');
const hashPrototype = witnessGetPrototypeOf(hashControl);
const nativeHashUpdate =
  hashPrototype === null
    ? undefined
    : witnessGetOwnPropertyDescriptor(hashPrototype, 'update')?.value;
const nativeHashDigest =
  hashPrototype === null
    ? undefined
    : witnessGetOwnPropertyDescriptor(hashPrototype, 'digest')?.value;

if (typeof nativeHashUpdate !== 'function' || typeof nativeHashDigest !== 'function') {
  throw new TypeError('Kovo client-module build-token hash controls are unavailable.');
}

const semanticHash = nativeCreateHash('sha256');
witnessReflectApply(nativeHashUpdate, semanticHash, ['abc']);
if (
  witnessReflectApply<number>(nativeBufferByteLength, NativeBuffer, ['名🙂', 'utf8']) !== 7 ||
  witnessReflectApply<string>(nativeHashDigest, semanticHash, ['hex']) !==
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
) {
  throw new TypeError('Kovo client-module build-token hash controls failed their semantic check.');
}

export function clientModuleBuildTokenHash(
  renderPlanFingerprint: string,
  entries: readonly string[],
): string {
  const hash = nativeCreateHash('sha256');
  updateFrame(hash, 'domain', 'kovo-app-build-token/v1');
  updateFrame(hash, 'render-plan', renderPlanFingerprint);
  for (let index = 0; index < entries.length; index += 1) {
    updateFrame(hash, 'active-module-href', entries[index]!);
  }
  const digest = witnessReflectApply<string>(nativeHashDigest, hash, ['hex']);
  if (digest.length !== 64) {
    throw new TypeError('Kovo client-module build-token digest has an invalid shape.');
  }
  for (let index = 0; index < digest.length; index += 1) {
    const code = witnessReflectApply<number>(nativeStringCharCodeAt, digest, [index]);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) {
      throw new TypeError('Kovo client-module build-token digest has an invalid shape.');
    }
  }
  return digest;
}

function updateFrame(hash: object, tag: string, value: string): void {
  const tagLength = witnessReflectApply<number>(nativeBufferByteLength, NativeBuffer, [
    tag,
    'utf8',
  ]);
  const valueLength = witnessReflectApply<number>(nativeBufferByteLength, NativeBuffer, [
    value,
    'utf8',
  ]);
  witnessReflectApply(nativeHashUpdate, hash, [`${tagLength}:`]);
  witnessReflectApply(nativeHashUpdate, hash, [tag]);
  witnessReflectApply(nativeHashUpdate, hash, [`${valueLength}:`]);
  witnessReflectApply(nativeHashUpdate, hash, [value]);
}

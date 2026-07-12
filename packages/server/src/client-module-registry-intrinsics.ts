import { createHash } from 'node:crypto';

import {
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/** Package-private hash controls for immutable client-module build tokens (SPEC §5.2.1). */
const nativeCreateHash = createHash;
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
  witnessReflectApply<string>(nativeHashDigest, semanticHash, ['hex']) !==
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
) {
  throw new TypeError('Kovo client-module build-token hash controls failed their semantic check.');
}

export function clientModuleBuildTokenHash(
  grammarVersion: string,
  renderPlanFingerprint: string | undefined,
  entries: readonly string[],
): string {
  const hash = nativeCreateHash('sha256');
  witnessReflectApply(nativeHashUpdate, hash, [grammarVersion]);
  witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  if (renderPlanFingerprint !== undefined) {
    witnessReflectApply(nativeHashUpdate, hash, [renderPlanFingerprint]);
    witnessReflectApply(nativeHashUpdate, hash, ['\0']);
  }
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) witnessReflectApply(nativeHashUpdate, hash, ['\n']);
    witnessReflectApply(nativeHashUpdate, hash, [entries[index]!]);
  }
  const digest = witnessReflectApply<string>(nativeHashDigest, hash, ['hex']);
  if (digest.length !== 64) {
    throw new TypeError('Kovo client-module build-token digest has an invalid shape.');
  }
  let token = '';
  for (let index = 0; index < 16; index += 1) token += digest[index];
  return token;
}

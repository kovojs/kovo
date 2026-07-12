import { createHash } from 'node:crypto';

import { securityArrayIsArray, securityNumberIsInteger } from './response-security-intrinsics.js';
import {
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessReflectApply,
} from './security-witness-intrinsics.js';

/**
 * Boot-pinned controls used by build and static-export authority boundaries.
 *
 * Evaluated application modules share the build process realm. SPEC §6.6 therefore requires
 * build/export classification and output identities to consume framework-owned snapshots and
 * captured cryptographic controls rather than mutable caller arrays, accessors, or live globals.
 */

const NativeResponse = globalThis.Response;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeCreateHash = createHash;
const nativeResponseText = stableOwnFunction(NativeResponse.prototype, 'text');
const nativeResponseStatus = stableOwnGetter(NativeResponse.prototype, 'status');

const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = stableOwnFunction(hashControl, 'update');
const nativeHashDigest = stableOwnFunction(hashControl, 'digest');

function stableOwnFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      const data = descriptorDataProperty(descriptor);
      if (typeof data !== 'function') {
        throw new TypeError(`Kovo build security control ${String(property)} is unavailable.`);
      }
      return data;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`Kovo build security control ${String(property)} is unavailable.`);
}

function stableOwnGetter(value: object, property: PropertyKey): Function {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) {
    throw new TypeError(`Kovo build security getter ${String(property)} is unavailable.`);
  }
  const getterDescriptor = witnessGetOwnPropertyDescriptor(descriptor, 'get');
  if (getterDescriptor === undefined || typeof getterDescriptor.value !== 'function') {
    throw new TypeError(`Kovo build security getter ${String(property)} is unavailable.`);
  }
  return getterDescriptor.value;
}

function descriptorDataProperty(descriptor: PropertyDescriptor): unknown {
  const valueDescriptor = witnessGetOwnPropertyDescriptor(descriptor, 'value');
  if (valueDescriptor === undefined) {
    throw new TypeError('Kovo build security boundary rejects accessor-backed values.');
  }
  return valueDescriptor.value;
}

function rawDigest(
  algorithm: 'sha256' | 'sha384',
  content: string | Uint8Array,
  encoding: 'base64' | 'hex',
): string {
  const hash = nativeCreateHash(algorithm);
  witnessReflectApply(nativeHashUpdate, hash, [content]);
  return witnessReflectApply(nativeHashDigest, hash, [encoding]);
}

function capturedControlsAreSound(): boolean {
  try {
    const response = new NativeResponse('control', { status: 201 });
    return (
      witnessReflectApply<number>(nativeResponseStatus, response, []) === 201 &&
      witnessReflectApply(nativeDecodeURIComponent, undefined, ['safe%2Fchild']) === 'safe/child' &&
      rawDigest('sha256', '', 'hex') ===
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' &&
      rawDigest('sha384', '', 'hex') ===
        '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b'
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertBuildSecurityIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo build security controls are unavailable because realm intrinsics were modified before framework initialization.',
    );
  }
}

/** Snapshot a caller-owned dense array through own data descriptors and freeze the copy. */
export function snapshotBuildArray<Value>(
  value: readonly Value[],
  label: string,
): readonly Value[] {
  assertBuildSecurityIntrinsics();
  if (!securityArrayIsArray(value)) {
    throw new TypeError(`Kovo build security boundary expected ${label} to be an array.`);
  }

  const lengthDescriptor = witnessGetOwnPropertyDescriptor(value, 'length');
  if (lengthDescriptor === undefined) {
    throw new TypeError(`Kovo build security boundary could not snapshot ${label}.`);
  }
  const rawLength = descriptorDataProperty(lengthDescriptor);
  if (!securityNumberIsInteger(rawLength) || (rawLength as number) < 0) {
    throw new TypeError(`Kovo build security boundary found an invalid ${label} length.`);
  }

  const snapshot: Value[] = [];
  for (let index = 0; index < (rawLength as number); index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined) {
      throw new TypeError(`Kovo build security boundary rejects sparse ${label}.`);
    }
    snapshot[index] = descriptorDataProperty(descriptor) as Value;
  }
  return witnessFreeze(snapshot);
}

export type BuildOwnDataProperty =
  | { readonly present: false }
  | { readonly present: true; readonly value: unknown };

/** Read one caller-owned field exactly once, ignoring inherited properties and rejecting getters. */
export function buildOwnDataProperty(
  value: object,
  property: PropertyKey,
  label: string,
): BuildOwnDataProperty {
  assertBuildSecurityIntrinsics();
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return { present: false };
  try {
    return { present: true, value: descriptorDataProperty(descriptor) };
  } catch {
    throw new TypeError(`Kovo build security boundary rejects accessor-backed ${label}.`);
  }
}

export function buildSecurityDecodeURIComponent(value: string): string {
  assertBuildSecurityIntrinsics();
  return witnessReflectApply(nativeDecodeURIComponent, undefined, [value]);
}

export function buildSecurityResponseStatus(response: Response): number {
  assertBuildSecurityIntrinsics();
  return witnessReflectApply(nativeResponseStatus, response, []);
}

export function buildSecurityResponseText(response: Response): Promise<string> {
  assertBuildSecurityIntrinsics();
  return witnessReflectApply(nativeResponseText, response, []);
}

export function buildSecuritySha256Hex(content: string | Uint8Array): string {
  assertBuildSecurityIntrinsics();
  return rawDigest('sha256', content, 'hex');
}

export function buildSecuritySha384Base64(content: string | Uint8Array): string {
  assertBuildSecurityIntrinsics();
  return rawDigest('sha384', content, 'base64');
}

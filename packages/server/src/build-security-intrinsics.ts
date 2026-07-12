/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { securityArrayIsArray, securityNumberIsInteger } from './response-security-intrinsics.ts';
import {
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessJsonStringifyPrimitive,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
  witnessWeakSetAdd,
  witnessWeakSetDelete,
  witnessWeakSetHas,
} from './security-witness-intrinsics.ts';

/**
 * Boot-pinned controls used by build and static-export authority boundaries.
 *
 * Evaluated application modules share the build process realm. SPEC §6.6 therefore requires
 * build/export classification and output identities to consume framework-owned snapshots and
 * captured cryptographic controls rather than mutable caller arrays, accessors, or live globals.
 */

const NativeRequest = globalThis.Request;
const NativeResponse = globalThis.Response;
const NativeURL = globalThis.URL;
const nativeGlobalThis = globalThis;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeCreateHash = createHash;
const nativeFileURLToPath = fileURLToPath;
const nativeFunctionToString = globalThis.Function.prototype.toString;
const nativePathBasename = path.basename;
const nativePathDirname = path.dirname;
const nativePathExtname = path.extname;
const nativePathJoin = path.join;
const nativePathRelative = path.relative;
const nativePathResolve = path.resolve;
const nativePathSeparator = path.sep;
const nativePosixExtname = path.posix.extname;
const nativePosixDirname = path.posix.dirname;
const nativeResponseText = stableOwnFunction(NativeResponse.prototype, 'text');
const nativeRequestMethod = stableOwnGetter(NativeRequest.prototype, 'method');
const nativeRequestUrl = stableOwnGetter(NativeRequest.prototype, 'url');
const nativeResponseStatus = stableOwnGetter(NativeResponse.prototype, 'status');
const nativeUrlHash = stableOwnGetter(NativeURL.prototype, 'hash');
const nativeUrlHref = stableOwnGetter(NativeURL.prototype, 'href');
const nativeUrlOrigin = stableOwnGetter(NativeURL.prototype, 'origin');
const nativeUrlPathname = stableOwnGetter(NativeURL.prototype, 'pathname');
const nativeUrlProtocol = stableOwnGetter(NativeURL.prototype, 'protocol');
const nativeUrlSearch = stableOwnGetter(NativeURL.prototype, 'search');

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
    const request = new NativeRequest('https://kovo-build-control.test/safe', { method: 'GET' });
    const url = new NativeURL('/safe?proof=1', 'https://kovo-build-control.test');
    const pathControl = nativePathResolve('kovo-build-control', 'child.txt');
    const joinedPathControl = nativePathJoin('kovo-build-control', 'child.txt');
    const fileUrlControl = nativeFileURLToPath('file:///tmp/kovo-build-control.txt');
    return (
      witnessReflectApply<number>(nativeResponseStatus, response, []) === 201 &&
      witnessReflectApply<string>(nativeRequestMethod, request, []) === 'GET' &&
      witnessReflectApply<string>(nativeRequestUrl, request, []) ===
        'https://kovo-build-control.test/safe' &&
      witnessReflectApply<string>(nativeUrlHref, url, []) ===
        'https://kovo-build-control.test/safe?proof=1' &&
      witnessReflectApply<string>(nativeUrlPathname, url, []) === '/safe' &&
      witnessReflectApply(nativeDecodeURIComponent, undefined, ['safe%2Fchild']) === 'safe/child' &&
      nativePathBasename(pathControl) === 'child.txt' &&
      nativePathBasename(nativePathDirname(pathControl)) === 'kovo-build-control' &&
      nativePathBasename(joinedPathControl) === 'child.txt' &&
      nativePathRelative(nativePathDirname(pathControl), pathControl) === 'child.txt' &&
      nativePathExtname(pathControl) === '.txt' &&
      (nativePathSeparator === '/' || nativePathSeparator === '\\') &&
      nativePathBasename(fileUrlControl) === 'kovo-build-control.txt' &&
      nativePosixExtname('/assets/app.css') === '.css' &&
      nativePosixDirname('/assets/app.css') === '/assets' &&
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

/** Commit one value to a framework-owned dense array without mutable method or prototype dispatch. */
export function commitBuildArrayValue<Value>(target: Value[], value: Value, label: string): void {
  assertBuildSecurityIntrinsics();
  if (!securityArrayIsArray(target)) {
    throw new TypeError(`Kovo build security boundary expected ${label} target to be an array.`);
  }

  const lengthDescriptor = witnessGetOwnPropertyDescriptor(target, 'length');
  if (lengthDescriptor === undefined) {
    throw new TypeError(`Kovo build security boundary could not commit ${label}.`);
  }
  const rawLength = descriptorDataProperty(lengthDescriptor);
  if (!securityNumberIsInteger(rawLength) || (rawLength as number) < 0) {
    throw new TypeError(`Kovo build security boundary found an invalid ${label} target length.`);
  }

  // Object.defineProperty's array-index algorithm grows `length` while bypassing inherited numeric
  // setters. The control itself is boot-pinned, so evaluated app code cannot replace the commit.
  witnessDefineProperty(target, rawLength as number, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
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

export interface BuildSecurityUrlSnapshot {
  readonly hash: string;
  readonly href: string;
  readonly origin: string;
  readonly pathname: string;
  readonly protocol: string;
  readonly search: string;
}

/** Construct and snapshot a URL through controls captured before evaluated app code runs. */
export function buildSecurityUrlSnapshot(input: string, base?: string): BuildSecurityUrlSnapshot {
  assertBuildSecurityIntrinsics();
  const url = base === undefined ? new NativeURL(input) : new NativeURL(input, base);
  return {
    hash: witnessReflectApply(nativeUrlHash, url, []),
    href: witnessReflectApply(nativeUrlHref, url, []),
    origin: witnessReflectApply(nativeUrlOrigin, url, []),
    pathname: witnessReflectApply(nativeUrlPathname, url, []),
    protocol: witnessReflectApply(nativeUrlProtocol, url, []),
    search: witnessReflectApply(nativeUrlSearch, url, []),
  };
}

/** Construct one synthetic static-export GET Request through the boot-pinned constructor. */
export function buildSecurityGetRequest(href: string): Request {
  assertBuildSecurityIntrinsics();
  const request = constructNativeGetRequest(href);
  if (
    witnessReflectApply<string>(nativeRequestMethod, request, []) !== 'GET' ||
    witnessReflectApply<string>(nativeRequestUrl, request, []) !== href
  ) {
    throw new TypeError('Kovo build security boundary could not construct an exact GET request.');
  }
  return request;
}

function constructNativeGetRequest(href: string): Request {
  const lateUrlDescriptor = witnessGetOwnPropertyDescriptor(nativeGlobalThis, 'URL');
  if (lateUrlDescriptor === undefined) {
    throw new TypeError('Kovo build security boundary could not witness the ambient URL control.');
  }

  const lateUrlValue = witnessGetOwnPropertyDescriptor(lateUrlDescriptor, 'value');
  if (lateUrlValue !== undefined && witnessObjectIs(lateUrlValue.value, NativeURL)) {
    return new NativeRequest(href, { method: 'GET' });
  }

  const configurable = descriptorBoolean(lateUrlDescriptor, 'configurable');
  const enumerable = descriptorBoolean(lateUrlDescriptor, 'enumerable');
  const writable =
    lateUrlValue === undefined ? false : descriptorBoolean(lateUrlDescriptor, 'writable');
  if (!configurable && !writable) {
    throw new TypeError(
      'Kovo build security boundary cannot restore the captured URL control for Request construction.',
    );
  }

  // Node's native Request constructor resolves string inputs through the ambient URL binding.
  // Replace only that binding for this synchronous intrinsic call, then restore the exact late
  // descriptor before any application code can observe another turn (SPEC §6.6/§9.5).
  witnessDefineProperty(nativeGlobalThis, 'URL', {
    configurable,
    enumerable,
    value: NativeURL,
    writable: configurable ? true : writable,
  });
  let request: Request | undefined;
  let constructionError: unknown;
  let constructionFailed = false;
  try {
    const installed = witnessGetOwnPropertyDescriptor(nativeGlobalThis, 'URL');
    if (installed === undefined || !witnessObjectIs(descriptorDataProperty(installed), NativeURL)) {
      throw new TypeError(
        'Kovo build security boundary could not install the captured URL control.',
      );
    }
    request = new NativeRequest(href, { method: 'GET' });
  } catch (error) {
    constructionFailed = true;
    constructionError = error;
  }

  witnessDefineProperty(nativeGlobalThis, 'URL', lateUrlDescriptor);
  const restored = witnessGetOwnPropertyDescriptor(nativeGlobalThis, 'URL');
  if (restored === undefined || !propertyDescriptorsMatch(restored, lateUrlDescriptor)) {
    throw new TypeError(
      'Kovo build security boundary could not restore the ambient URL descriptor.',
    );
  }
  if (constructionFailed) throw constructionError;
  if (request === undefined) {
    throw new TypeError('Kovo build security boundary could not construct the GET request.');
  }
  return request;
}

function descriptorBoolean(
  descriptor: PropertyDescriptor,
  property: 'configurable' | 'enumerable' | 'writable',
): boolean {
  const field = witnessGetOwnPropertyDescriptor(descriptor, property);
  if (field === undefined || typeof field.value !== 'boolean') {
    throw new TypeError(`Kovo build security boundary found an invalid ${property} descriptor.`);
  }
  return field.value;
}

function propertyDescriptorsMatch(left: PropertyDescriptor, right: PropertyDescriptor): boolean {
  return (
    descriptorFieldsMatch(left, right, 'configurable') &&
    descriptorFieldsMatch(left, right, 'enumerable') &&
    descriptorFieldsMatch(left, right, 'value') &&
    descriptorFieldsMatch(left, right, 'writable') &&
    descriptorFieldsMatch(left, right, 'get') &&
    descriptorFieldsMatch(left, right, 'set')
  );
}

function descriptorFieldsMatch(
  left: PropertyDescriptor,
  right: PropertyDescriptor,
  property: 'configurable' | 'enumerable' | 'value' | 'writable' | 'get' | 'set',
): boolean {
  const leftField = witnessGetOwnPropertyDescriptor(left, property);
  const rightField = witnessGetOwnPropertyDescriptor(right, property);
  if (leftField === undefined || rightField === undefined) return leftField === rightField;
  return witnessObjectIs(leftField.value, rightField.value);
}

export function buildSecurityFileUrlToPath(href: string): string {
  assertBuildSecurityIntrinsics();
  return nativeFileURLToPath(href);
}

export function buildSecurityPathBasename(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePathBasename(value);
}

export function buildSecurityPathDirname(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePathDirname(value);
}

export function buildSecurityPathExtname(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePathExtname(value);
}

export function buildSecurityPathJoin(...values: string[]): string {
  assertBuildSecurityIntrinsics();
  return nativePathJoin(...values);
}

export function buildSecurityPathRelative(from: string, to: string): string {
  assertBuildSecurityIntrinsics();
  return nativePathRelative(from, to);
}

export function buildSecurityPathResolve(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePathResolve(value);
}

export function buildSecurityPathSeparator(): string {
  assertBuildSecurityIntrinsics();
  return nativePathSeparator;
}

export function buildSecurityPosixDirname(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePosixDirname(value);
}

export function buildSecurityPosixExtname(value: string): string {
  assertBuildSecurityIntrinsics();
  return nativePosixExtname(value);
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

/**
 * Capture reviewed framework function source through the boot-pinned Function control.
 *
 * This is an artifact-construction mechanism, never a provenance test (SPEC §6.6 rule 6).
 */
export function buildSecurityFunctionSource(value: Function): string {
  assertBuildSecurityIntrinsics();
  return witnessReflectApply(nativeFunctionToString, value, []);
}

/**
 * Serialize JSON data as an executable source literal without consulting caller prototypes,
 * accessors, `toJSON`, iterators, or the ambient JSON serializer after app evaluation.
 */
export function buildSecuritySourceLiteral(value: unknown): string {
  assertBuildSecurityIntrinsics();
  return serializeBuildSourceValue(value, createWitnessWeakSet(), 0);
}

function serializeBuildSourceValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): string {
  if (depth > 100) {
    throw new TypeError('Kovo generated source data exceeds the depth limit.');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    const serialized = witnessJsonStringifyPrimitive(value);
    if (serialized === undefined) {
      throw new TypeError('Kovo generated source contains a non-serializable primitive.');
    }
    return serialized;
  }
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('Kovo generated source must contain only own JSON data.');
  }
  if (witnessWeakSetHas(ancestors, value)) {
    throw new TypeError('Kovo generated source cannot contain cycles.');
  }
  witnessWeakSetAdd(ancestors, value);
  try {
    if (witnessIsArray(value)) {
      const length = stableBuildArrayLength(value);
      let serialized = '[';
      for (let index = 0; index < length; index += 1) {
        if (index > 0) serialized += ',';
        serialized += serializeBuildSourceValue(
          stableBuildDataValue(value, index, `generated source array[${index}]`),
          ancestors,
          depth + 1,
        );
      }
      return `${serialized}]`;
    }

    const keys = witnessObjectKeys(value);
    let serialized = '{';
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (index > 0) serialized += ',';
      serialized += `${witnessJsonStringifyPrimitive(key)!}:${serializeBuildSourceValue(
        stableBuildDataValue(value, key, `generated source object.${key}`),
        ancestors,
        depth + 1,
      )}`;
    }
    return `${serialized}}`;
  } finally {
    witnessWeakSetDelete(ancestors, value);
  }
}

function stableBuildArrayLength(value: readonly unknown[]): number {
  const length = stableBuildDataValue(value, 'length', 'generated source array.length');
  if (
    !securityNumberIsInteger(length) ||
    (length as number) < 0 ||
    (length as number) > 1_000_000
  ) {
    throw new TypeError('Kovo generated source array must have a bounded stable length.');
  }
  return length as number;
}

function stableBuildDataValue(value: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if (!sameBuildDataDescriptor(before, after) || before === undefined || !('value' in before)) {
    throw new TypeError(`Kovo generated source requires a stable own data property for ${label}.`);
  }
  return before.value;
}

function sameBuildDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

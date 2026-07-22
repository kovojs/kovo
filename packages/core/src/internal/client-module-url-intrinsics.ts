/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import { createHash as builtinCreateHash } from 'node:crypto';
import { Buffer as NativeBuffer } from 'node:buffer';

import {
  securityApply,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityStringCharCodeAt,
} from '#security-witness-intrinsics';

/**
 * Package-private URL controls for the immutable client-module registry.
 *
 * Application modules share the framework realm and can replace URL/string/math methods. The
 * client-module path and version are registry authority, so every normalization step consumes
 * these bootstrap-captured controls after supported Kovo runners initialize framework modules and
 * before they evaluate app/plugins (SPEC §5.2.1/§6.6/§9.5). Pre-run host loaders are part of the
 * host TCB; finite vectors or Function#toString likeness cannot attest them from JavaScript.
 */
const NativeURL = globalThis.URL;
const NativeMath = globalThis.Math;
const NativeString = globalThis.String;
const nativeMathImul = NativeMath.imul;
const nativeCreateHash = builtinCreateHash;
const nativeBufferByteLength = NativeBuffer.byteLength;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeUrlHashGet = ownGetter(NativeURL.prototype, 'hash');
const nativeUrlOriginGet = ownGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGet = ownGetter(NativeURL.prototype, 'pathname');
const nativeUrlSearchGet = ownGetter(NativeURL.prototype, 'search');
const hashControl = nativeCreateHash('sha256');
const hashPrototype = securityGetPrototypeOf(hashControl);
const nativeHashUpdate = hashPrototype === null ? undefined : ownFunction(hashPrototype, 'update');
const nativeHashDigest = hashPrototype === null ? undefined : ownFunction(hashPrototype, 'digest');
const CLIENT_MODULE_REPRESENTATION_DOMAIN = 'kovo-client-module-representation/v1';
export const CLIENT_MODULE_CONTENT_TYPE = 'text/javascript; charset=utf-8';

function ownGetter(value: object, key: PropertyKey): Function {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (typeof descriptor?.get !== 'function') {
    throw new TypeError(`Kovo client-module URL getter ${String(key)} is unavailable.`);
  }
  return descriptor.get;
}

function ownFunction(value: object, key: PropertyKey): Function {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (typeof descriptor?.value !== 'function') {
    throw new TypeError(`Kovo client-module URL control ${String(key)} is unavailable.`);
  }
  return descriptor.value;
}

function snapshotUnchecked(value: string, base: string): ClientModuleUrlSnapshot {
  const url = new NativeURL(value, base);
  const search = securityApply<string>(nativeUrlSearchGet, url, []);
  return {
    hash: securityApply(nativeUrlHashGet, url, []),
    origin: securityApply(nativeUrlOriginGet, url, []),
    pathname: securityApply(nativeUrlPathnameGet, url, []),
    search,
  };
}

function bootstrapSelfCheckPasses(): boolean {
  try {
    if (typeof nativeHashUpdate !== 'function' || typeof nativeHashDigest !== 'function') {
      return false;
    }
    // Initialization health only; supported-runner ordering owns provenance.
    const semanticHash = nativeCreateHash('sha256');
    securityApply(nativeHashUpdate, semanticHash, ['abc']);
    if (
      securityApply<string>(nativeHashDigest, semanticHash, ['hex']) !==
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    ) {
      return false;
    }
    if (securityApply<number>(nativeBufferByteLength, NativeBuffer, ['名🙂', 'utf8']) !== 7) {
      return false;
    }
    const loneBytes = securityApply<Buffer>(nativeBufferFrom, NativeBuffer, ['\ud800', 'utf8']);
    if (securityApply<string>(nativeBufferToString, loneBytes, ['utf8']) !== '�') return false;
    const local = snapshotUnchecked('/c/one/../safe.client.js#handler', 'https://kovo.local');
    const foreign = snapshotUnchecked('/c/foreign.client.js', 'https://attacker.invalid');
    return (
      local.origin === 'https://kovo.local' &&
      local.pathname === '/c/safe.client.js' &&
      local.search === '' &&
      local.hash === '#handler' &&
      foreign.origin === 'https://attacker.invalid' &&
      securityApply(nativeStringIndexOf, 'version/path', ['/']) === 7 &&
      securityApply(nativeStringIndexOf, 'version', ['/']) === -1 &&
      securityApply(nativeMathImul, NativeMath, [0x01020304, 0x01000193]) === -1708474548
    );
  } catch {
    return false;
  }
}

const bootstrapHealthy = bootstrapSelfCheckPasses();

function assertControls(): void {
  if (!bootstrapHealthy) {
    throw new TypeError(
      'Kovo client-module security bootstrap failed its initialization self-check. Use a supported Kovo runner that initializes framework controls before app/plugin evaluation.',
    );
  }
}

export interface ClientModuleUrlSnapshot {
  hash: string;
  origin: string;
  pathname: string;
  search: string;
}

export function snapshotClientModuleUrl(value: string, base: string): ClientModuleUrlSnapshot {
  assertControls();
  if (typeof value !== 'string' || typeof base !== 'string') {
    throw new TypeError('Client module URL inputs must be strings.');
  }
  return snapshotUnchecked(value, base);
}

export function clientModuleStringIndexOf(
  value: string,
  search: string,
  fromIndex?: number,
): number {
  assertControls();
  return securityApply(
    nativeStringIndexOf,
    value,
    fromIndex === undefined ? [search] : [search, fromIndex],
  );
}

export function clientModuleImul(left: number, right: number): number {
  assertControls();
  return securityApply(nativeMathImul, NativeMath, [left, right]);
}

/**
 * Canonical well-formed UTF-8 representation served for a client module.
 * Node's UTF-8 encoder replaces each unpaired UTF-16 surrogate with U+FFFD; decoding the captured
 * bytes back to a string pins the response body to those exact bytes too (SPEC §5.2.1/§14).
 */
export function canonicalClientModuleSource(source: string): string {
  assertControls();
  if (typeof source !== 'string') throw new TypeError('Client module source must be a string.');
  const bytes = securityApply<Buffer>(nativeBufferFrom, NativeBuffer, [source, 'utf8']);
  return securityApply<string>(nativeBufferToString, bytes, ['utf8']);
}

/**
 * Full SHA-256 identity of the fixed JavaScript representation. The preimage is domain-separated
 * and byte-length-framed, so neither Unicode nor delimiter-shaped source can alias another frame
 * sequence (SPEC §5.2.1/§14).
 */
export function clientModuleRepresentationHash(source: string): string {
  const canonicalSource = canonicalClientModuleSource(source);
  const hash = nativeCreateHash('sha256');
  updateFrame(hash, 'domain', CLIENT_MODULE_REPRESENTATION_DOMAIN);
  updateFrame(hash, 'content-type', CLIENT_MODULE_CONTENT_TYPE);
  updateFrame(hash, 'body', canonicalSource);
  const digest = securityApply<string>(nativeHashDigest!, hash, ['hex']);
  if (digest.length !== 64)
    throw new TypeError('Client module content digest has an invalid shape.');
  for (let index = 0; index < digest.length; index += 1) {
    const code = securityStringCharCodeAt(digest, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) {
      throw new TypeError('Client module content digest has an invalid shape.');
    }
  }
  return digest;
}

function updateFrame(hash: object, tag: string, value: string): void {
  const tagLength = securityApply<number>(nativeBufferByteLength, NativeBuffer, [tag, 'utf8']);
  const valueLength = securityApply<number>(nativeBufferByteLength, NativeBuffer, [value, 'utf8']);
  securityApply(nativeHashUpdate!, hash, [`${tagLength}:`]);
  securityApply(nativeHashUpdate!, hash, [tag]);
  securityApply(nativeHashUpdate!, hash, [`${valueLength}:`]);
  securityApply(nativeHashUpdate!, hash, [value]);
}

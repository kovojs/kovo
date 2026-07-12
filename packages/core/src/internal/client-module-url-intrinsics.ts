/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked via pinned Reflect.apply. */
import { createHash as builtinCreateHash } from 'node:crypto';

import {
  securityApply,
  securityGetOwnPropertyDescriptor,
  securityGetPrototypeOf,
  securityMap,
  securityMapGet,
  securityMapSet,
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
const NativeURLSearchParams = globalThis.URLSearchParams;
const NativeMath = globalThis.Math;
const NativeString = globalThis.String;
const nativeMathImul = NativeMath.imul;
const nativeCreateHash = builtinCreateHash;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeUrlHashGet = ownGetter(NativeURL.prototype, 'hash');
const nativeUrlOriginGet = ownGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGet = ownGetter(NativeURL.prototype, 'pathname');
const nativeUrlSearchGet = ownGetter(NativeURL.prototype, 'search');
const nativeSearchParamsGet = ownFunction(NativeURLSearchParams.prototype, 'get');
const hashControl = nativeCreateHash('sha256');
const hashPrototype = securityGetPrototypeOf(hashControl);
const nativeHashUpdate = hashPrototype === null ? undefined : ownFunction(hashPrototype, 'update');
const nativeHashDigest = hashPrototype === null ? undefined : ownFunction(hashPrototype, 'digest');
const clientModuleSourceByDigest = securityMap<string, string>();

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
  const searchParams = new NativeURLSearchParams(search);
  return {
    hash: securityApply(nativeUrlHashGet, url, []),
    origin: securityApply(nativeUrlOriginGet, url, []),
    pathname: securityApply(nativeUrlPathnameGet, url, []),
    search,
    versionSearchParam: securityApply(nativeSearchParamsGet, searchParams, ['v']),
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
    const local = snapshotUnchecked(
      '/c/one/../safe.client.js?v=build%201&v=ignored#handler',
      'https://kovo.local',
    );
    const foreign = snapshotUnchecked('/c/foreign.client.js', 'https://attacker.invalid');
    return (
      local.origin === 'https://kovo.local' &&
      local.pathname === '/c/safe.client.js' &&
      local.search === '?v=build%201&v=ignored' &&
      local.hash === '#handler' &&
      local.versionSearchParam === 'build 1' &&
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
  versionSearchParam: string | null;
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

/** Collision-resistant full-source identity for immutable client-module URLs (SPEC §5.2.1). */
export function clientModuleContentHash(source: string): string {
  assertControls();
  if (typeof source !== 'string') throw new TypeError('Client module source must be a string.');
  const hash = nativeCreateHash('sha256');
  securityApply(nativeHashUpdate!, hash, [source]);
  const digest = securityApply<string>(nativeHashDigest!, hash, ['hex']);
  if (digest.length !== 64)
    throw new TypeError('Client module content digest has an invalid shape.');
  for (let index = 0; index < digest.length; index += 1) {
    const code = securityStringCharCodeAt(digest, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) {
      throw new TypeError('Client module content digest has an invalid shape.');
    }
  }
  const existingSource = securityMapGet(clientModuleSourceByDigest, digest);
  if (existingSource === undefined) {
    securityMapSet(clientModuleSourceByDigest, digest, source);
  } else if (existingSource !== source) {
    throw new TypeError(
      'Kovo client-module content digest collision detected; refusing to cross-bind immutable output.',
    );
  }
  return digest;
}

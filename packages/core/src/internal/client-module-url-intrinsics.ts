import {
  securityApply,
  securityGetOwnPropertyDescriptor,
} from '#security-witness-intrinsics';

/**
 * Package-private URL controls for the immutable client-module registry.
 *
 * Application modules share the framework realm and can replace URL/string/math methods. The
 * client-module path and version are registry authority, so every normalization step consumes
 * these captured controls and checks their semantics before use (SPEC §5.2.1/§6.6/§9.5).
 */
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;
const NativeMath = globalThis.Math;
const NativeString = globalThis.String;
const nativeMathImul = NativeMath.imul;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeUrlHashGet = ownGetter(NativeURL.prototype, 'hash');
const nativeUrlOriginGet = ownGetter(NativeURL.prototype, 'origin');
const nativeUrlPathnameGet = ownGetter(NativeURL.prototype, 'pathname');
const nativeUrlSearchGet = ownGetter(NativeURL.prototype, 'search');
const nativeSearchParamsGet = ownFunction(NativeURLSearchParams.prototype, 'get');

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

function controlsAreSound(): boolean {
  try {
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

const capturedControlsSound = controlsAreSound();

function assertControls(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo client-module URL controls are unavailable because realm intrinsics were modified before framework initialization.',
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

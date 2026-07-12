/**
 * @internal Shared client-module URL ABI for compiler emission, Vite dev
 * serving, and server registry serving (SPEC.md §5.2.1, §6.6).
 */

import {
  freezeSecurityValue,
  securityDecodeURIComponent,
  securityEncodeURIComponent,
  securityRegExpExec,
  securityStringCharCodeAt,
  securityStringSlice,
  securityStringStartsWith,
} from '#security-witness-intrinsics';
import {
  clientModuleImul,
  clientModuleStringIndexOf,
  snapshotClientModuleUrl,
  type ClientModuleUrlSnapshot,
} from './client-module-url-intrinsics.ts';

const CLIENT_MODULE_ORIGIN = 'https://kovo.local';
const CLIENT_MODULE_PREFIX = '/c/';
const CLIENT_MODULE_VERSION_PREFIX = '/c/__v/';

/** @internal Parsed immutable client-module request target. */
export interface ClientModuleRequestTarget {
  path: string;
  version: string;
}

/** @internal Construct the canonical `/c/...client.js` href for a source module file name. */
export function clientModuleHrefForSourceFile(fileName: string, version?: string): string {
  assertClientModuleScalar(fileName, 'source file name');
  let firstNonSlash = 0;
  while (
    firstNonSlash < fileName.length &&
    securityStringCharCodeAt(fileName, firstNonSlash) === 0x2f
  ) {
    firstNonSlash += 1;
  }
  const relativeFileName = securityStringSlice(fileName, firstNonSlash);
  const path = `${CLIENT_MODULE_PREFIX}${replaceClientModuleSourceExtension(relativeFileName)}`;
  return version === undefined ? path : versionedClientModuleHref(path, version);
}

/**
 * @internal Construct the immutable `/c/__v/<version>/...` href for a client module.
 * Fragments are preserved so event handler refs can version the module URL without
 * losing the exported handler anchor.
 */
export function versionedClientModuleHref(href: string, version: string): string {
  assertClientModuleScalar(version, 'version');
  if (version.length === 0) throw new Error('Client module version must not be empty.');
  const url = parseClientModuleUrl(href);
  if (securityStringStartsWith(url.pathname, CLIENT_MODULE_VERSION_PREFIX)) {
    throw new Error(`Client module source href must not already be versioned: ${href}`);
  }
  const relativePath = securityStringSlice(url.pathname, CLIENT_MODULE_PREFIX.length);
  return `${CLIENT_MODULE_VERSION_PREFIX}${securityEncodeURIComponent(version)}/${relativePath}${url.hash}`;
}

/** @internal Normalize a same-origin client-module href to its `/c/...` pathname. */
export function clientModulePath(href: string): string {
  return parseClientModuleUrl(href).pathname;
}

/** @internal Parse a versioned client-module browser request. */
export function parseVersionedClientModuleTarget(
  href: string,
): ClientModuleRequestTarget | undefined {
  const url = parseClientModuleUrl(href);
  return versionedClientModuleTargetFromUrl(url);
}

/** @internal Canonical key used by dev serving maps for versioned client-module requests. */
export function versionedClientModuleRequestKey(href: string): string | undefined {
  const url = parseClientModuleUrl(href);
  const target = versionedClientModuleTargetFromUrl(url);
  if (target === undefined) return undefined;

  if (securityStringStartsWith(url.pathname, CLIENT_MODULE_VERSION_PREFIX)) return url.pathname;
  return `${target.path}?v=${securityEncodeURIComponent(target.version)}`;
}

/** @internal Deterministic content version used in generated client-module URLs. */
export function clientModuleContentVersion(source: string): string {
  assertClientModuleScalar(source, 'source');
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= securityStringCharCodeAt(source, index);
    hash = clientModuleImul(hash, 0x01000193) >>> 0;
  }

  return fixedHex32(hash);
}

function parseClientModuleUrl(href: string): ClientModuleUrlSnapshot {
  assertClientModuleScalar(href, 'href');
  const url = snapshotClientModuleUrl(href, CLIENT_MODULE_ORIGIN);
  if (url.origin !== CLIENT_MODULE_ORIGIN) {
    throw new Error(`Client module href must be same-origin: ${href}`);
  }
  if (!securityStringStartsWith(url.pathname, CLIENT_MODULE_PREFIX)) {
    throw new Error(`Client module href must live under /c/: ${href}`);
  }
  return url;
}

function versionedClientModuleTargetFromUrl(
  url: ClientModuleUrlSnapshot,
): ClientModuleRequestTarget | undefined {
  const versionedPath = versionedClientModulePathTarget(url.pathname);
  if (versionedPath !== undefined) return versionedPath;

  const version = url.versionSearchParam;
  if (!version) return undefined;
  return freezeSecurityValue({ path: url.pathname, version });
}

function versionedClientModulePathTarget(pathname: string): ClientModuleRequestTarget | undefined {
  if (!securityStringStartsWith(pathname, CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  const rest = securityStringSlice(pathname, CLIENT_MODULE_VERSION_PREFIX.length);
  const separator = clientModuleStringIndexOf(rest, '/');
  if (separator <= 0 || separator === rest.length - 1) return undefined;

  let version: string;
  try {
    version = securityDecodeURIComponent(securityStringSlice(rest, 0, separator));
  } catch {
    return undefined;
  }

  const path = `${CLIENT_MODULE_PREFIX}${securityStringSlice(rest, separator + 1)}`;
  if (securityStringStartsWith(path, CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  return freezeSecurityValue({ path, version });
}

function replaceClientModuleSourceExtension(fileName: string): string {
  const match = securityRegExpExec(/\.[cm]?[jt]sx?$/, fileName);
  if (match === null) return fileName;
  return `${securityStringSlice(fileName, 0, match.index)}.client.js`;
}

function fixedHex32(value: number): string {
  const alphabet = '0123456789abcdef';
  let output = '';
  for (let shift = 28; shift >= 0; shift -= 4) {
    output += alphabet[(value >>> shift) & 0x0f];
  }
  return output;
}

function assertClientModuleScalar(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`Client module ${name} must be a string.`);
  }
}

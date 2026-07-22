/**
 * @internal Shared client-module URL ABI for compiler emission, Vite dev
 * serving, and server registry serving (SPEC.md §5.2.1, §6.6).
 */

import {
  freezeSecurityValue,
  securityRegExpExec,
  securityStringCharCodeAt,
  securityStringSlice,
  securityStringStartsWith,
} from '#security-witness-intrinsics';
import {
  canonicalClientModuleSource,
  clientModuleRepresentationHash,
  clientModuleStringIndexOf,
  snapshotClientModuleUrl,
  type ClientModuleUrlSnapshot,
} from './client-module-url-intrinsics.ts';

const CLIENT_MODULE_ORIGIN = 'https://kovo.local';
const CLIENT_MODULE_PREFIX = '/c/';
const CLIENT_MODULE_VERSION_PREFIX = '/c/__v/';

/** @internal Parsed immutable client-module request target. */
export interface ClientModuleRequestTarget {
  digest: string;
  path: string;
}

/** @internal Construct the canonical `/c/...client.js` href for a source module file name. */
export function clientModuleHrefForSourceFile(fileName: string, digest?: string): string {
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
  return digest === undefined ? path : versionedClientModuleHref(path, digest);
}

/**
 * @internal Construct the immutable `/c/__v/<digest>/...` href for a client module.
 * Fragments are preserved so event handler refs can version the module URL without
 * losing the exported handler anchor.
 */
export function versionedClientModuleHref(href: string, digest: string): string {
  assertClientModuleDigest(digest);
  const url = parseClientModuleUrl(href);
  if (securityStringStartsWith(url.pathname, CLIENT_MODULE_VERSION_PREFIX)) {
    throw new Error(`Client module source href must not already be versioned: ${href}`);
  }
  const relativePath = securityStringSlice(url.pathname, CLIENT_MODULE_PREFIX.length);
  return `${CLIENT_MODULE_VERSION_PREFIX}${digest}/${relativePath}${url.hash}`;
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

  return url.pathname;
}

/** @internal Canonical well-formed source bytes served by every Kovo module resolver. */
export function canonicalClientModuleRepresentation(source: string): string {
  assertClientModuleScalar(source, 'source');
  return canonicalClientModuleSource(source);
}

/** @internal Full immutable representation digest used in generated client-module URLs. */
export function clientModuleRepresentationDigest(source: string): string {
  assertClientModuleScalar(source, 'source');
  return clientModuleRepresentationHash(source);
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
  // Technical-preview policy: the former `?v=` compatibility spelling and every other query
  // spelling are invalid. There is exactly one canonical immutable URL grammar.
  if (url.search.length !== 0) return undefined;
  return versionedClientModulePathTarget(url.pathname);
}

function versionedClientModulePathTarget(pathname: string): ClientModuleRequestTarget | undefined {
  if (!securityStringStartsWith(pathname, CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  const rest = securityStringSlice(pathname, CLIENT_MODULE_VERSION_PREFIX.length);
  const separator = clientModuleStringIndexOf(rest, '/');
  if (separator <= 0 || separator === rest.length - 1) return undefined;

  const digest = securityStringSlice(rest, 0, separator);
  if (!isClientModuleDigest(digest)) return undefined;

  const path = `${CLIENT_MODULE_PREFIX}${securityStringSlice(rest, separator + 1)}`;
  if (securityStringStartsWith(path, CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  return freezeSecurityValue({ digest, path });
}

function replaceClientModuleSourceExtension(fileName: string): string {
  const match = securityRegExpExec(/\.[cm]?[jt]sx?$/, fileName);
  if (match === null) return fileName;
  return `${securityStringSlice(fileName, 0, match.index)}.client.js`;
}

function assertClientModuleScalar(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`Client module ${name} must be a string.`);
  }
}

function assertClientModuleDigest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isClientModuleDigest(value)) {
    throw new TypeError('Client module representation digest must be 64 lowercase hex characters.');
  }
}

function isClientModuleDigest(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
  }
  return true;
}

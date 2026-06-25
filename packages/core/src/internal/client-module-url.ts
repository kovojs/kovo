/**
 * @internal Shared client-module URL ABI for compiler emission, Vite dev
 * serving, and server registry serving (SPEC.md §5.2.1, §6.6).
 */

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
  const path = `${CLIENT_MODULE_PREFIX}${replaceClientModuleSourceExtension(fileName).replace(
    /^\/+/,
    '',
  )}`;
  return version === undefined ? path : versionedClientModuleHref(path, version);
}

/**
 * @internal Construct the immutable `/c/__v/<version>/...` href for a client module.
 * Fragments are preserved so event handler refs can version the module URL without
 * losing the exported handler anchor.
 */
export function versionedClientModuleHref(href: string, version: string): string {
  const url = parseClientModuleUrl(href);
  const relativePath = url.pathname.slice(CLIENT_MODULE_PREFIX.length);
  return `${CLIENT_MODULE_VERSION_PREFIX}${encodeURIComponent(version)}/${relativePath}${url.hash}`;
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

  if (url.pathname.startsWith(CLIENT_MODULE_VERSION_PREFIX)) return url.pathname;
  return `${target.path}?v=${target.version}`;
}

/** @internal Deterministic content version used in generated client-module URLs. */
export function clientModuleContentVersion(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function parseClientModuleUrl(href: string): URL {
  const url = new URL(href, CLIENT_MODULE_ORIGIN);
  if (url.origin !== CLIENT_MODULE_ORIGIN) {
    throw new Error(`Client module href must be same-origin: ${href}`);
  }
  if (!url.pathname.startsWith(CLIENT_MODULE_PREFIX)) {
    throw new Error(`Client module href must live under /c/: ${href}`);
  }
  return url;
}

function versionedClientModuleTargetFromUrl(url: URL): ClientModuleRequestTarget | undefined {
  const versionedPath = versionedClientModulePathTarget(url.pathname);
  if (versionedPath !== undefined) return versionedPath;

  const version = url.searchParams.get('v');
  if (!version) return undefined;
  return { path: url.pathname, version };
}

function versionedClientModulePathTarget(pathname: string): ClientModuleRequestTarget | undefined {
  if (!pathname.startsWith(CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  const rest = pathname.slice(CLIENT_MODULE_VERSION_PREFIX.length);
  const separator = rest.indexOf('/');
  if (separator <= 0 || separator === rest.length - 1) return undefined;

  let version: string;
  try {
    version = decodeURIComponent(rest.slice(0, separator));
  } catch {
    return undefined;
  }

  const path = `${CLIENT_MODULE_PREFIX}${rest.slice(separator + 1)}`;
  if (path.startsWith(CLIENT_MODULE_VERSION_PREFIX)) return undefined;

  return { path, version };
}

function replaceClientModuleSourceExtension(fileName: string): string {
  return fileName.replace(/\.[cm]?[jt]sx?$/, '.client.js');
}

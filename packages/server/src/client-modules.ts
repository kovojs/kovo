import { createHash } from 'node:crypto';
import { reportServerError, type ServerErrorHandler } from './diagnostics.js';
import type { ServerResponseBase } from './response.js';

/**
 * Source module registered into the request-shell client-module registry for
 * versioned browser delivery (SPEC §9.5).
 */
export interface VersionedClientModuleInput {
  contentType?: string;
  path: string;
  source: string;
  version: string;
}

/** @internal Response envelope produced by the server-owned client-module request path. */
export interface VersionedClientModuleResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  200 | 404
> {}

/**
 * Registry used by the server request shell to publish immutable versioned
 * client modules and resolve browser requests for them (SPEC §9.5).
 */
export interface VersionedClientModuleRegistry {
  /**
   * A deterministic build-global token derived from the set of registered
   * client module versions. Identical within one build, changes on redeploy.
   * Used for `Kovo-Build` response header and `<meta name="kovo-build">` page
   * stamping so the client can detect deploy skew (SPEC §5.1, §9.1.1).
   * Returns an empty string when no modules are registered.
   */
  buildToken(): string;
  put(module: VersionedClientModuleInput): string;
  resolve(href: string): ServerResponseBase<string, Record<string, string>, 200 | 404>;
}

/** @internal Request context accepted by the server-owned client-module request path. */
export interface VersionedClientModuleRequest {
  onError?: ServerErrorHandler;
  url?: string | null;
}

/** Options for the in-memory versioned client-module registry. */
export interface MemoryVersionedClientModuleRegistryOptions {
  maxVersionsPerPath?: number;
}

/** @internal Construct a version-stamped client-module href for framework request-shell output. */
export function versionedClientModuleHref(href: string, version: string): string {
  const url = clientModuleUrl(href);
  url.searchParams.set('v', version);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Create an in-memory registry of versioned client modules — the default store
 * `createApp` uses to serve hashed island/handler bundles to the browser.
 *
 * @param options - Optional registry configuration.
 * @returns A `VersionedClientModuleRegistry`.
 */
export function createMemoryVersionedClientModuleRegistry(
  options: MemoryVersionedClientModuleRegistryOptions = {},
): VersionedClientModuleRegistry {
  const modules = new Map<string, VersionedClientModuleInput>();
  const versionsByPath = new Map<string, string[]>();
  // Cache: recompute whenever versionsByPath changes (tracked by a generation counter).
  let cachedBuildToken: string | undefined;
  let buildTokenGeneration = 0;
  let lastTokenGeneration = -1;

  return {
    buildToken() {
      // Recompute only when the registry changed since the last call.
      if (cachedBuildToken !== undefined && lastTokenGeneration === buildTokenGeneration) {
        return cachedBuildToken;
      }
      // Derive a deterministic token: sorted "path@version" pairs hashed with SHA-256.
      // This is stable for the same set of modules regardless of registration order.
      const entries: string[] = [];
      for (const [path, versions] of versionsByPath) {
        for (const version of versions) {
          entries.push(`${path}@${version}`);
        }
      }
      entries.sort();
      const token =
        entries.length === 0
          ? ''
          : createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16);
      cachedBuildToken = token;
      lastTokenGeneration = buildTokenGeneration;
      return token;
    },
    put(module) {
      const url = clientModuleUrl(module.path);
      const path = url.pathname;
      const href = versionedClientModuleHref(path, module.version);
      const key = versionedClientModuleKey(path, module.version);

      modules.set(key, { ...module, path });
      rememberClientModuleVersion(versionsByPath, modules, path, module.version, options);
      buildTokenGeneration += 1;

      return href;
    },
    resolve(href) {
      const url = clientModuleUrl(href);
      const version = url.searchParams.get('v');
      if (!version) return missingClientModuleResponse();

      const module = modules.get(versionedClientModuleKey(url.pathname, version));
      if (!module) return missingClientModuleResponse();

      // SPEC §6.6: versioned emitted module URLs are immutable and retained across deploys.
      return {
        body: module.source,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': module.contentType ?? 'text/javascript; charset=utf-8',
        },
        status: 200,
      };
    },
  };
}

/** @internal Render a versioned client-module response for the framework request shell. */
export function renderVersionedClientModuleResponse(
  registry: VersionedClientModuleRegistry,
  request: string | VersionedClientModuleRequest,
): VersionedClientModuleResponse {
  const href = typeof request === 'string' ? request : request.url;
  if (!href) return missingClientModuleResponse();

  let url: URL;
  try {
    url = clientModuleUrl(href);
  } catch (error) {
    if (typeof request !== 'string') {
      reportServerError(request.onError, error, {
        operation: 'client-module',
        url: href ?? undefined,
      });
    }
    return missingClientModuleResponse();
  }

  if (!url.searchParams.has('v')) return missingClientModuleResponse();

  return registry.resolve(`${url.pathname}${url.search}${url.hash}`);
}

function missingClientModuleResponse(): VersionedClientModuleResponse {
  return {
    body: 'Not Found',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 404,
  };
}

function clientModuleUrl(href: string): URL {
  const url = new URL(href, 'https://kovo.local');
  if (url.origin !== 'https://kovo.local') {
    throw new Error(`Client module href must be same-origin: ${href}`);
  }
  if (!url.pathname.startsWith('/c/')) {
    throw new Error(`Client module href must live under /c/: ${href}`);
  }
  return url;
}

function versionedClientModuleKey(path: string, version: string): string {
  return `${path}\0${version}`;
}

function rememberClientModuleVersion(
  versionsByPath: Map<string, string[]>,
  modules: Map<string, VersionedClientModuleInput>,
  path: string,
  version: string,
  options: MemoryVersionedClientModuleRegistryOptions,
): void {
  const versions = versionsByPath.get(path) ?? [];
  if (!versions.includes(version)) versions.push(version);
  versionsByPath.set(path, versions);

  const maxVersions = options.maxVersionsPerPath;
  if (maxVersions === undefined) return;

  while (versions.length > maxVersions) {
    const evicted = versions.shift();
    if (evicted) modules.delete(versionedClientModuleKey(path, evicted));
  }
}

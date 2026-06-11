export interface VersionedClientModuleInput {
  contentType?: string;
  path: string;
  source: string;
  version: string;
}

export interface VersionedClientModuleResponse {
  body: string;
  headers: Record<string, string>;
  status: 200 | 404;
}

export interface VersionedClientModuleRegistry {
  put(module: VersionedClientModuleInput): string;
  resolve(href: string): VersionedClientModuleResponse;
}

export interface VersionedClientModuleRequest {
  url?: string | null;
}

export interface MemoryVersionedClientModuleRegistryOptions {
  maxVersionsPerPath?: number;
}

export function versionedClientModuleHref(href: string, version: string): string {
  const url = clientModuleUrl(href);
  url.searchParams.set('v', version);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createMemoryVersionedClientModuleRegistry(
  options: MemoryVersionedClientModuleRegistryOptions = {},
): VersionedClientModuleRegistry {
  const modules = new Map<string, VersionedClientModuleInput>();
  const versionsByPath = new Map<string, string[]>();

  return {
    put(module) {
      const url = clientModuleUrl(module.path);
      const path = url.pathname;
      const href = versionedClientModuleHref(path, module.version);
      const key = versionedClientModuleKey(path, module.version);

      modules.set(key, { ...module, path });
      rememberClientModuleVersion(versionsByPath, modules, path, module.version, options);

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

export function renderVersionedClientModuleResponse(
  registry: VersionedClientModuleRegistry,
  request: string | VersionedClientModuleRequest,
): VersionedClientModuleResponse {
  const href = typeof request === 'string' ? request : request.url;
  if (!href) return missingClientModuleResponse();

  let url: URL;
  try {
    url = clientModuleUrl(href);
  } catch {
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
  const url = new URL(href, 'https://jiso.local');
  if (url.origin !== 'https://jiso.local') {
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

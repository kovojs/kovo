export interface DynamicImportUrlOptions {
  allowedModuleUrls?: readonly string[];
  buildToken?: string;
}

export type DynamicImportModule<T = Record<string, unknown>> = (url: string) => Promise<T>;

/** @internal Runtime allowlist for compiler-emitted client-module import refs (SPEC §5.2.1). */
export function assertAllowedKovoDynamicImportUrl(
  url: string,
  options: DynamicImportUrlOptions = {},
): void {
  if (!isAllowedKovoDynamicImportUrl(url, options)) {
    throw new Error(`Disallowed Kovo dynamic import URL: ${url}`);
  }
}

/** @internal Wrap a dynamic importer with the same URL allowlist used by handler/derive refs. */
export function guardKovoDynamicImportModule<T = Record<string, unknown>>(
  importModule: DynamicImportModule<T>,
  options: DynamicImportUrlOptions = {},
): DynamicImportModule<T> {
  return (url) => {
    assertAllowedKovoDynamicImportUrl(url, options);
    return importModule(url);
  };
}

/** @internal True when a handler/derive ref points at a same-origin Kovo client module. */
export function isAllowedKovoDynamicImportUrl(
  url: string,
  options: DynamicImportUrlOptions = {},
): boolean {
  const parsed = parseImportUrl(url);
  if (!parsed) return false;
  if (parsed.origin !== currentOrigin()) return false;
  if (isAllowedLocalDevSourceModuleUrl(parsed)) return true;
  if (!parsed.pathname.startsWith('/c/')) return false;

  const manifest = allowedClientModuleUrlManifest(options.allowedModuleUrls);
  if (manifest.size === 0) return true;

  return manifest.has(canonicalImportUrl(parsed));
}

function isAllowedLocalDevSourceModuleUrl(url: URL): boolean {
  if (!isLocalDevOrigin(url)) return false;
  if (url.pathname.startsWith('/c/')) return false;
  return /\.(?:[cm]?tsx?)$/.test(url.pathname);
}

function isLocalDevOrigin(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
  );
}

function parseImportUrl(value: string): URL | null {
  try {
    return new URL(value, currentHref());
  } catch {
    return null;
  }
}

function currentHref(): string {
  return globalThis.location?.href ?? 'http://localhost/';
}

function currentOrigin(): string {
  return globalThis.location?.origin ?? new URL(currentHref()).origin;
}

function allowedClientModuleUrlManifest(explicit?: readonly string[]): ReadonlySet<string> {
  const values = explicit ?? documentModulepreloadClientModules();
  if (!values || values.length === 0) return new Set();

  const allowed = new Set<string>();
  for (const value of values) {
    const parsed = parseImportUrl(value);
    if (!parsed) continue;
    if (parsed.origin !== currentOrigin()) continue;
    if (!parsed.pathname.startsWith('/c/')) continue;
    allowed.add(canonicalImportUrl(parsed));
  }
  return allowed;
}

function documentModulepreloadClientModules(): readonly string[] | undefined {
  if (typeof document === 'undefined') return undefined;
  const links = document.querySelectorAll?.(
    'link[data-kovo-module-allowlist][rel~="modulepreload"][href]',
  );
  if (!links || typeof links[Symbol.iterator] !== 'function') return undefined;

  const hrefs: string[] = [];
  for (const link of links as Iterable<{ getAttribute?: (name: string) => string | null }>) {
    const href = link.getAttribute?.('href');
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function canonicalImportUrl(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

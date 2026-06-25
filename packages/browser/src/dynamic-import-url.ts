import { readPageBuildToken } from './build-token.js';

export interface DynamicImportUrlOptions {
  buildToken?: string;
}

/** @internal Runtime allowlist for compiler-emitted client-module import refs (SPEC §5.2.1). */
export function assertAllowedKovoDynamicImportUrl(
  url: string,
  options: DynamicImportUrlOptions = {},
): void {
  if (!isAllowedKovoDynamicImportUrl(url, options)) {
    throw new Error(`Disallowed Kovo dynamic import URL: ${url}`);
  }
}

/** @internal True when a handler/derive ref points at a same-origin Kovo client module. */
export function isAllowedKovoDynamicImportUrl(
  url: string,
  options: DynamicImportUrlOptions = {},
): boolean {
  const parsed = parseImportUrl(url);
  if (!parsed) return false;
  if (parsed.origin !== currentOrigin()) return false;
  if (!parsed.pathname.startsWith('/c/')) return false;

  const buildToken = options.buildToken ?? readPageBuildToken();
  if (!buildToken) return true;

  const versionPrefix = `/c/__v/${encodeURIComponent(buildToken)}/`;
  return parsed.pathname.startsWith(versionPrefix) || !parsed.pathname.startsWith('/c/__v/');
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

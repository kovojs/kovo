import type { KovoModuleRef } from '@kovojs/core/internal/module-ref';

import {
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from './security-witness-intrinsics.js';

export interface DynamicImportUrlOptions {
  allowedModuleUrls?: readonly string[];
  buildToken?: string;
}

export type DynamicImportModule<T = Record<string, unknown>> = (url: string) => Promise<T>;

const guardedDynamicImportModules = securityWeakSet<object>();

/** @internal Runtime allowlist for compiler-emitted client-module import refs (SPEC §5.2.1). */
export function assertAllowedKovoDynamicImportUrl(
  url: string,
  options: DynamicImportUrlOptions = {},
): void {
  if (!isAllowedKovoDynamicImportUrl(url, options)) {
    throw new Error(`Disallowed Kovo dynamic import URL: ${url}`);
  }
}

/** @internal Runtime allowlist for a parsed compiler-emitted module ref (SPEC §4.4). */
export function assertAllowedKovoDynamicImportRef(
  ref: KovoModuleRef,
  options: DynamicImportUrlOptions = {},
): void {
  if (!isAllowedKovoDynamicImportRef(ref, options)) {
    throw new Error(`Disallowed Kovo dynamic import URL: ${ref.url}`);
  }
}

/** @internal Wrap a dynamic importer with the same URL allowlist used by handler/derive refs. */
export function guardKovoDynamicImportModule<T = Record<string, unknown>>(
  importModule: DynamicImportModule<T>,
  options: DynamicImportUrlOptions = {},
): DynamicImportModule<T> {
  const guarded = (url: string) => {
    assertAllowedKovoDynamicImportUrl(url, options);
    return importModule(url);
  };
  securityWeakSetAdd(guardedDynamicImportModules, guarded);
  return guarded;
}

/** @internal Avoid a weaker second default-manifest check after an explicit guarded importer. */
export function assertAllowedKovoDynamicImportRefForModule(
  ref: KovoModuleRef,
  importModule: DynamicImportModule,
): void {
  if (!securityWeakSetHas(guardedDynamicImportModules, importModule)) {
    assertAllowedKovoDynamicImportRef(ref);
  }
}

/** @internal Avoid a weaker second default-manifest check after an explicit guarded importer. */
export function assertAllowedKovoDynamicImportUrlForModule(
  url: string,
  importModule: DynamicImportModule,
): void {
  if (!securityWeakSetHas(guardedDynamicImportModules, importModule)) {
    assertAllowedKovoDynamicImportUrl(url);
  }
}

/** @internal True when a parsed handler/derive ref points at an allowed client module. */
export function isAllowedKovoDynamicImportRef(
  ref: KovoModuleRef,
  options: DynamicImportUrlOptions = {},
): boolean {
  return isAllowedKovoDynamicImportUrl(ref.url, options);
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
  // SPEC §4.7/§4.8/§6.6: a missing/empty compiler-owned registry is deny, never a
  // wildcard for every same-origin /c/ module. Local Vite source modules retain their explicit
  // development-only branch above.
  if (manifest.size === 0) return false;

  return securitySetHas(manifest, canonicalImportUrl(parsed));
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

function allowedClientModuleUrlManifest(explicit?: readonly string[]): Set<string> {
  const values = explicit ?? documentModulepreloadClientModules();
  if (!values || values.length === 0) return securitySet();

  const allowed = securitySet<string>();
  for (const value of values) {
    const parsed = parseImportUrl(value);
    if (!parsed) continue;
    if (parsed.origin !== currentOrigin()) continue;
    if (!parsed.pathname.startsWith('/c/')) continue;
    securitySetAdd(allowed, canonicalImportUrl(parsed));
  }
  return allowed;
}

function documentModulepreloadClientModules(): readonly string[] | undefined {
  if (typeof document === 'undefined') return undefined;
  const markers = document.querySelectorAll?.('[data-kovo-module-allowlist]');
  if (!markers || typeof markers[Symbol.iterator] !== 'function') return undefined;

  const hrefs: string[] = [];
  for (const marker of markers as Iterable<{ getAttribute?: (name: string) => string | null }>) {
    const declared = marker.getAttribute?.('data-kovo-module-allowlist');
    if (declared) hrefs.push(...declared.split(/\s+/).filter(Boolean));
    const href = marker.getAttribute?.('href');
    if (!declared && href) hrefs.push(href);
  }
  return hrefs;
}

function canonicalImportUrl(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`;
}

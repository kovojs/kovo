import type { KovoModuleRef } from '@kovojs/core/internal/module-ref';

import {
  securityArrayAppend,
  applySecurityIntrinsic,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
  securityRegExpTest,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityStringSlice,
  securityStringStartsWith,
  securityWeakSet,
  securityWeakSetAdd,
  securityWeakSetHas,
} from './security-witness-intrinsics.js';

const IntrinsicURL = URL;
const intrinsicUrlOrigin = securityGetOwnPropertyDescriptor(IntrinsicURL.prototype, 'origin')?.get;
const intrinsicUrlPathname = securityGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  'pathname',
)?.get;
const intrinsicUrlSearch = securityGetOwnPropertyDescriptor(IntrinsicURL.prototype, 'search')?.get;
const intrinsicUrlProtocol = securityGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  'protocol',
)?.get;
const intrinsicUrlHostname = securityGetOwnPropertyDescriptor(
  IntrinsicURL.prototype,
  'hostname',
)?.get;
const capturedUrlControlsSound = verifyCapturedUrlControls();

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
  if (urlOrigin(parsed) !== currentOrigin()) return false;
  if (isAllowedLocalDevSourceModuleUrl(parsed)) return true;
  if (!securityStringStartsWith(urlPathname(parsed), '/c/')) return false;

  const manifest = allowedClientModuleUrlManifest(options.allowedModuleUrls);
  // SPEC §4.7/§4.8/§6.6: a missing/empty compiler-owned registry is deny, never a
  // wildcard for every same-origin /c/ module. Local Vite source modules retain their explicit
  // development-only branch above.
  return securitySetHas(manifest, canonicalImportUrl(parsed));
}

function isAllowedLocalDevSourceModuleUrl(url: URL): boolean {
  if (!isLocalDevOrigin(url)) return false;
  const pathname = urlPathname(url);
  if (securityStringStartsWith(pathname, '/c/')) return false;
  return securityRegExpTest(/\.(?:[cm]?tsx?)$/, pathname);
}

function isLocalDevOrigin(url: URL): boolean {
  const protocol = urlProtocol(url);
  const hostname = urlHostname(url);
  return (
    protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
  );
}

function parseImportUrl(value: string): URL | null {
  if (!capturedUrlControlsSound) return null;
  try {
    return new IntrinsicURL(value, currentHref());
  } catch {
    return null;
  }
}

function currentHref(): string {
  return globalThis.location?.href ?? 'http://localhost/';
}

function currentOrigin(): string {
  return globalThis.location?.origin ?? urlOrigin(new IntrinsicURL(currentHref()));
}

function allowedClientModuleUrlManifest(explicit?: readonly string[]): Set<string> {
  const values = explicit ?? documentModulepreloadClientModules();
  if (!values || values.length === 0) return securitySet();

  const allowed = securitySet<string>();
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok || typeof entry.value !== 'string') continue;
    const value = entry.value;
    const parsed = parseImportUrl(value);
    if (!parsed) continue;
    if (urlOrigin(parsed) !== currentOrigin()) continue;
    if (!securityStringStartsWith(urlPathname(parsed), '/c/')) continue;
    securitySetAdd(allowed, canonicalImportUrl(parsed));
  }
  return allowed;
}

function documentModulepreloadClientModules(): readonly string[] | undefined {
  if (typeof document === 'undefined') return undefined;
  const markers = document.querySelectorAll?.('[data-kovo-module-allowlist]');
  if (!markers) return undefined;

  const hrefs: string[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index] as { getAttribute?: (name: string) => string | null } | undefined;
    if (marker === undefined) continue;
    const declared = marker.getAttribute?.('data-kovo-module-allowlist');
    if (declared) appendWhitespaceTokens(hrefs, declared);
    const href = marker.getAttribute?.('href');
    if (!declared && href)
      securityArrayAppend(
        hrefs,
        href,
        'Browser packages/browser/src/dynamic-import-url.ts collection',
      );
  }
  return hrefs;
}

function canonicalImportUrl(url: URL): string {
  return `${urlOrigin(url)}${urlPathname(url)}${urlSearch(url)}`;
}

function urlOrigin(url: URL): string {
  return readUrlField(intrinsicUrlOrigin, url);
}

function urlPathname(url: URL): string {
  return readUrlField(intrinsicUrlPathname, url);
}

function urlSearch(url: URL): string {
  return readUrlField(intrinsicUrlSearch, url);
}

function urlProtocol(url: URL): string {
  return readUrlField(intrinsicUrlProtocol, url);
}

function urlHostname(url: URL): string {
  return readUrlField(intrinsicUrlHostname, url);
}

function readUrlField(getter: (() => string) | undefined, url: URL): string {
  if (!capturedUrlControlsSound || getter === undefined) {
    throw new TypeError('Kovo dynamic import URL controls are unavailable.');
  }
  return applySecurityIntrinsic<string>(getter, url, []);
}

function verifyCapturedUrlControls(): boolean {
  if (
    intrinsicUrlOrigin === undefined ||
    intrinsicUrlPathname === undefined ||
    intrinsicUrlSearch === undefined ||
    intrinsicUrlProtocol === undefined ||
    intrinsicUrlHostname === undefined
  ) {
    return false;
  }
  try {
    const control = new IntrinsicURL('/c/control.client.js?q=1', 'http://localhost/base');
    return (
      applySecurityIntrinsic<string>(intrinsicUrlOrigin, control, []) === 'http://localhost' &&
      applySecurityIntrinsic<string>(intrinsicUrlPathname, control, []) ===
        '/c/control.client.js' &&
      applySecurityIntrinsic<string>(intrinsicUrlSearch, control, []) === '?q=1' &&
      applySecurityIntrinsic<string>(intrinsicUrlProtocol, control, []) === 'http:' &&
      applySecurityIntrinsic<string>(intrinsicUrlHostname, control, []) === 'localhost'
    );
  } catch {
    return false;
  }
}

function appendWhitespaceTokens(target: string[], value: string): void {
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && !securityRegExpTest(/\s/u, value[index] ?? '')) continue;
    if (index > start)
      securityArrayAppend(
        target,
        securityStringSlice(value, start, index),
        'Browser packages/browser/src/dynamic-import-url.ts collection',
      );
    start = index + 1;
  }
}

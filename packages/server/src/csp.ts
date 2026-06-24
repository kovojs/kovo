import { createHash, randomBytes } from 'node:crypto';

import { escapeAttribute } from './html.js';

/** CSP metadata for scripts/styles generated during document assembly. */
export interface CspInlineMetadata {
  /**
   * Per-document CSP nonce stamped onto every framework-emitted `<script>` tag
   * (SPEC.md §6.6, §9.5; Phase 7 defense-in-depth).
   */
  nonce?: string;
  /** Stable CSP hashes for generated inline `<script>` bodies in document order. */
  scripts: readonly string[];
  /** Stable CSP hashes for generated inline `<style>` bodies in document order. */
  styles: readonly string[];
}

/** Options for assembling a `Content-Security-Policy` header from Kovo document metadata. */
export interface ContentSecurityPolicyOptions {
  /**
   * Legacy option retained for source compatibility. `base-uri` is non-overridable and
   * always emitted as `'self'` so an injected `<base href="//evil">` cannot reroute the relative
   * `/c/__v/.../module.js` modulepreload/`<script src>` to an attacker origin and
   * execute attacker JS despite the hash-locked `script-src` (`base-uri` has no
   * `default-src` fallback).
   *
   * @deprecated Kovo's document CSP always emits `base-uri 'self'`; this hardening
   * directive is not overridable.
   */
  baseUri?: readonly string[];
  connectSrc?: readonly string[];
  defaultSrc?: readonly string[];
  /**
   * Legacy option retained for source compatibility. `form-action` is non-overridable
   * and always emitted as `'self'` so an injected `<form action>` cannot exfiltrate to
   * an attacker origin.
   *
   * @deprecated Kovo's document CSP always emits `form-action 'self'`; this hardening
   * directive is not overridable.
   */
  formAction?: readonly string[];
  /**
   * Legacy option retained for source compatibility. `frame-ancestors` is
   * non-overridable and always emitted as `'none'` (clickjacking defense).
   *
   * @deprecated Kovo's document CSP always emits `frame-ancestors 'none'`; this
   * hardening directive is not overridable.
   */
  frameAncestors?: readonly string[];
  imgSrc?: readonly string[];
  /**
   * Legacy option retained for source compatibility. `object-src` is non-overridable
   * and always emitted as `'none'` (legacy `<object>`/`<embed>` plugin-content vector).
   *
   * @deprecated Kovo's document CSP always emits `object-src 'none'`; this hardening
   * directive is not overridable.
   */
  objectSrc?: readonly string[];
  scriptSrc?: readonly string[];
  styleSrc?: readonly string[];
}

/**
 * Compute the CSP `sha256-…` source-expression for an inline script/style body, so an
 * app can hash any additional inline content it authors and admit it under the same
 * hash-based `Content-Security-Policy` produced by {@link renderContentSecurityPolicy}
 * (bugs-part3 CSP-3).
 *
 * @param value - The exact inline script/style body (the text between the tags).
 * @returns A `sha256-<base64>` CSP source expression.
 */
export function cspSha256(value: string): string {
  return `sha256-${createHash('sha256').update(value).digest('base64')}`;
}

export function cspHashAttribute(hash: string): string {
  return `data-kovo-csp-hash="${escapeAttribute(hash)}"`;
}

export function cspNonceAttribute(nonce: string | undefined): string {
  return nonce === undefined ? '' : ` nonce="${escapeAttribute(nonce)}"`;
}

export function createCspNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function emptyCspInlineMetadata(): CspInlineMetadata {
  return { scripts: [], styles: [] };
}

export function mergeCspInlineMetadata(
  ...metadata: readonly (CspInlineMetadata | undefined)[]
): CspInlineMetadata {
  return {
    ...mergedNonce(metadata),
    scripts: dedupe(metadata.flatMap((item) => item?.scripts ?? [])),
    styles: dedupe(metadata.flatMap((item) => item?.styles ?? [])),
  };
}

export function hasCspInlineMetadata(metadata: CspInlineMetadata): boolean {
  return metadata.nonce !== undefined || metadata.scripts.length > 0 || metadata.styles.length > 0;
}

/**
 * Assemble Kovo's default strict `Content-Security-Policy` header value from the
 * nonce and deterministic inline-script/style hashes surfaced on a rendered document
 * (`document.csp` from `renderRouteDocumentResponse` / `renderDeferredDocument`).
 *
 * The default script policy is nonce-based with `strict-dynamic` and never emits
 * `unsafe-inline` or `unsafe-eval`. Stable hashes are retained for compatibility with
 * existing metadata and diagnostics. The policy always includes the non-overridable
 * hardening directives `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`,
 * and `frame-ancestors 'none'` so a strict `script-src` cannot be bypassed by an
 * injected `<base>`/`<object>`/`<form>` (Phase 7 / SPEC.md §6.6, §9.5).
 *
 * @param metadata - Inline-script/style CSP hashes surfaced on the rendered document.
 * @param options - Optional per-directive source-list overrides.
 * @returns The assembled `Content-Security-Policy` header value.
 */
export function renderContentSecurityPolicy(
  metadata: CspInlineMetadata,
  options: ContentSecurityPolicyOptions = {},
): string {
  const directives = [
    directive('default-src', options.defaultSrc ?? ["'self'"]),
    directive('script-src', [
      ...(options.scriptSrc ?? ["'self'"]),
      ...(metadata.nonce === undefined ? [] : [`'nonce-${metadata.nonce}'`, "'strict-dynamic'"]),
      ...quoteHashes(metadata.scripts),
    ]),
    directive('style-src', [...(options.styleSrc ?? ["'self'"]), ...quoteHashes(metadata.styles)]),
    directive('img-src', options.imgSrc),
    directive('connect-src', options.connectSrc),
    // G2 (bugs-part3 CSP-2): `base-uri` and `object-src` are NON-overridable hardening
    // directives with no `default-src` fallback. Without `base-uri`, an injected
    // `<base href="//evil">` (markup injection, no script execution) reroutes every
    // relative module URL to an attacker origin and runs attacker JS despite the
    // hash-locked `script-src`. Emit them unconditionally with secure defaults.
    directive('base-uri', ["'self'"]),
    directive('object-src', ["'none'"]),
    // `form-action`/`frame-ancestors` close the injected-`<form action>` exfiltration
    // and clickjacking vectors respectively; emit with secure defaults.
    directive('form-action', ["'self'"]),
    directive('frame-ancestors', ["'none'"]),
  ].filter((item): item is string => item !== undefined);

  return directives.join('; ');
}

function quoteHashes(hashes: readonly string[]): string[] {
  return hashes.map((hash) => `'${hash}'`);
}

function mergedNonce(
  metadata: readonly (CspInlineMetadata | undefined)[],
): Pick<CspInlineMetadata, 'nonce'> {
  const nonces = dedupe(
    metadata.flatMap((item) => (item?.nonce === undefined ? [] : [item.nonce])),
  );
  if (nonces.length === 0) return {};
  if (nonces.length > 1) {
    throw new Error('Cannot merge CSP metadata from different document nonces.');
  }
  const nonce = nonces[0];
  return nonce === undefined ? {} : { nonce };
}

function directive(name: string, values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return `${name} ${dedupe(values).join(' ')}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

import { createHash } from 'node:crypto';

import { escapeAttribute } from './html.js';

/** CSP hash metadata for inline scripts/styles generated during document assembly. */
export interface CspInlineMetadata {
  /** Stable CSP hashes for generated inline `<script>` bodies in document order. */
  scripts: readonly string[];
  /** Stable CSP hashes for generated inline `<style>` bodies in document order. */
  styles: readonly string[];
}

/** Options for assembling a `Content-Security-Policy` header from Kovo document metadata. */
export interface ContentSecurityPolicyOptions {
  /**
   * G2 (bugs-part3 CSP-2): `base-uri` source list. Defaults to `'self'` and is emitted
   * unconditionally so an injected `<base href="//evil">` cannot reroute the relative
   * `/c/__v/.../module.js` modulepreload/`<script src>` to an attacker origin and
   * execute attacker JS despite the hash-locked `script-src` (`base-uri` has no
   * `default-src` fallback).
   */
  baseUri?: readonly string[];
  connectSrc?: readonly string[];
  defaultSrc?: readonly string[];
  /**
   * G2 (bugs-part3 CSP-2): `form-action` source list. Defaults to `'self'` so an
   * injected `<form action>` cannot exfiltrate to an attacker origin.
   */
  formAction?: readonly string[];
  /**
   * G2 (bugs-part3 CSP-2): `frame-ancestors` source list. Defaults to `'none'`
   * (clickjacking defense; X-Frame-Options is also absent on documents — see CSP-3).
   */
  frameAncestors?: readonly string[];
  imgSrc?: readonly string[];
  /**
   * G2 (bugs-part3 CSP-2): `object-src` source list. Defaults to `'none'` and is
   * emitted unconditionally (legacy `<object>`/`<embed>` plugin-content vector).
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

export function emptyCspInlineMetadata(): CspInlineMetadata {
  return { scripts: [], styles: [] };
}

export function mergeCspInlineMetadata(
  ...metadata: readonly (CspInlineMetadata | undefined)[]
): CspInlineMetadata {
  return {
    scripts: dedupe(metadata.flatMap((item) => item?.scripts ?? [])),
    styles: dedupe(metadata.flatMap((item) => item?.styles ?? [])),
  };
}

export function hasCspInlineMetadata(metadata: CspInlineMetadata): boolean {
  return metadata.scripts.length > 0 || metadata.styles.length > 0;
}

/**
 * Assemble a `Content-Security-Policy` header value that references the deterministic
 * inline-script/style hashes Kovo surfaces on a rendered document (`document.csp` from
 * `renderRouteDocumentResponse` / `renderDeferredDocument`).
 *
 * Kovo emits stable hashes for its generated inline scripts/styles rather than
 * per-request nonces, so apps opt into CSP by passing the surfaced `csp` metadata here
 * and setting the returned value as their `Content-Security-Policy` header. The policy
 * always includes the non-overridable hardening directives `base-uri 'self'`,
 * `object-src 'none'`, `form-action 'self'`, and `frame-ancestors 'none'` so a
 * hash-locked `script-src` cannot be bypassed by an injected `<base>`/`<object>`/`<form>`
 * (bugs-part3 CSP-2/CSP-3). Override any directive via {@link ContentSecurityPolicyOptions}.
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
    directive('base-uri', options.baseUri ?? ["'self'"]),
    directive('object-src', options.objectSrc ?? ["'none'"]),
    // `form-action`/`frame-ancestors` close the injected-`<form action>` exfiltration
    // and clickjacking vectors respectively; emit with secure defaults.
    directive('form-action', options.formAction ?? ["'self'"]),
    directive('frame-ancestors', options.frameAncestors ?? ["'none'"]),
  ].filter((item): item is string => item !== undefined);

  return directives.join('; ');
}

function quoteHashes(hashes: readonly string[]): string[] {
  return hashes.map((hash) => `'${hash}'`);
}

function directive(name: string, values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  return `${name} ${dedupe(values).join(' ')}`;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

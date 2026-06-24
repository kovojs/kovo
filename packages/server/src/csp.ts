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
  /**
   * SF (secure-framework Tier 3): `frame-src` source list — the origins an embedded
   * `<iframe>` may load (e.g. a Stripe/checkout/embed third party). Omitted entirely
   * when undefined, so it falls back to `default-src 'self'` (no third-party frames).
   */
  frameSrc?: readonly string[];
  imgSrc?: readonly string[];
  /**
   * G2 (bugs-part3 CSP-2): `object-src` source list. Defaults to `'none'` and is
   * emitted unconditionally (legacy `<object>`/`<embed>` plugin-content vector).
   */
  objectSrc?: readonly string[];
  scriptSrc?: readonly string[];
  styleSrc?: readonly string[];
  /**
   * SF (secure-framework Tier 3): when `true`, append `require-trusted-types-for 'script'`
   * and a `trusted-types <policy>` directive that admits ONLY Kovo's sole framework
   * policy ({@link KOVO_TRUSTED_TYPES_POLICY}). On Chromium this turns every
   * non-framework `innerHTML`/`script.src`/`eval` DOM-write sink into a throw —
   * runtime defense-in-depth against a slipped-through DOM-XSS (SPEC §6.6), NOT a
   * by-construction proof. Off by every other CSP path; gated by the document call
   * site because it only holds once Kovo's own internal sinks route through the
   * policy's `createHTML`/`createScriptURL` (see `packages/browser`).
   */
  trustedTypes?: boolean;
}

/**
 * SF (secure-framework Tier 3): the name of Kovo's single framework-owned Trusted
 * Types policy. The strict CSP admits ONLY this policy via `trusted-types kovo`
 * (no `'allow-duplicates'`), so any app or third-party attempt to create another
 * named (or the default) policy throws on Chromium. Kept in lockstep with the
 * browser-side `createPolicy('kovo', …)` call so the header and the runtime agree.
 */
export const KOVO_TRUSTED_TYPES_POLICY = 'kovo';

/**
 * SF (secure-framework Tier 3): an app-facing third-party allowlist that EXTENDS
 * (never replaces) the strict default policy's per-fetch directives. Because the
 * default-on CSP ships with no report-only ramp, a third-party embed
 * (analytics/Stripe/Sentry) is denied until its origin is declared here — without
 * this, the only escape is disabling CSP wholesale, which is strictly worse. Each
 * list is appended to `'self'` (plus Kovo's inline hashes for `script-src`), and the
 * non-overridable hardening directives (`base-uri`/`object-src`/`form-action`/
 * `frame-ancestors`) are NEVER reachable from here.
 */
export interface CspAllowlist {
  /** Extra origins admitted for `connect-src` (XHR/fetch/WebSocket/EventSource/beacon). */
  connectSrc?: readonly string[];
  /** Extra origins admitted for `frame-src` (embedded `<iframe>` sources). */
  frameSrc?: readonly string[];
  /** Extra origins admitted for `img-src` (external image hosts/CDNs). */
  imgSrc?: readonly string[];
  /** Extra origins admitted for `script-src` (third-party SDKs). */
  scriptSrc?: readonly string[];
  /** Extra origins admitted for `style-src` (external stylesheet hosts). */
  styleSrc?: readonly string[];
}

/**
 * SF (secure-framework Tier 3): the strict default-on CSP configuration carried on a
 * document response. `allowlist` extends the per-fetch directives; `trustedTypes`
 * opts into the Chromium-only Trusted Types floor.
 */
export interface DocumentCspConfig {
  allowlist?: CspAllowlist;
  trustedTypes?: boolean;
}

/**
 * SF (secure-framework Tier 3): assemble the strict default-on `Content-Security-Policy`
 * header value for a framework-rendered document.
 *
 * This is the dispatch-path counterpart of {@link renderContentSecurityPolicy}: it
 * starts from the strong default (`'self'` + Kovo's inline-script/style hashes + the
 * NON-overridable `base-uri`/`object-src`/`form-action`/`frame-ancestors` hardening
 * directives) and folds in a third-party {@link CspAllowlist} by APPENDING origins to
 * the per-fetch directives only. The hardening directives are assembled internally and
 * are never reachable from `config`, so an allowlist can widen where scripts/styles/
 * frames/connections may come from but can never relax clickjacking/base-uri/object/
 * form-exfil protection.
 *
 * @param metadata - Inline-script/style CSP hashes surfaced on the rendered document.
 * @param config - Optional third-party allowlist + Trusted Types opt-in.
 * @returns The assembled strict `Content-Security-Policy` header value.
 */
export function renderDefaultDocumentCsp(
  metadata: CspInlineMetadata,
  config: DocumentCspConfig = {},
): string {
  const allow = config.allowlist ?? {};
  // The allowlist EXTENDS the secure `'self'` base — it never replaces it — and it can
  // only touch the per-fetch directives below. `base-uri`/`object-src`/`form-action`/
  // `frame-ancestors` are assembled by `renderContentSecurityPolicy` from their secure
  // defaults and are intentionally absent from `CspAllowlist`, so they stay locked.
  return renderContentSecurityPolicy(metadata, {
    scriptSrc: ["'self'", ...(allow.scriptSrc ?? [])],
    styleSrc: ["'self'", ...(allow.styleSrc ?? [])],
    ...(allow.imgSrc && allow.imgSrc.length > 0
      ? { imgSrc: ["'self'", 'data:', ...allow.imgSrc] }
      : {}),
    ...(allow.connectSrc && allow.connectSrc.length > 0
      ? { connectSrc: ["'self'", ...allow.connectSrc] }
      : {}),
    ...(allow.frameSrc && allow.frameSrc.length > 0 ? { frameSrc: allow.frameSrc } : {}),
    ...(config.trustedTypes ? { trustedTypes: true } : {}),
  });
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
    directive('frame-src', options.frameSrc),
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
    // SF (secure-framework Tier 3): the Chromium-only Trusted Types floor. Opt-in
    // (`trustedTypes: true`) because it BRICKS Kovo's own hydration on Chromium until
    // every internal `innerHTML`/`script.src` sink routes through the framework policy
    // (`packages/browser`). `require-trusted-types-for 'script'` makes injection sinks
    // throw; `trusted-types kovo` admits ONLY Kovo's sole policy (no `'allow-duplicates'`)
    // so an attacker cannot mint a bypassing policy. Other browsers ignore both
    // directives, leaving the cross-browser CSP floor above intact.
    ...(options.trustedTypes
      ? ["require-trusted-types-for 'script'", `trusted-types ${KOVO_TRUSTED_TYPES_POLICY}`]
      : []),
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

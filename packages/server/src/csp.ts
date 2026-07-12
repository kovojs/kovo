import { escapeAttribute } from './html.js';
import {
  createSecuritySet,
  securityArrayJoin,
  securityArrayPush,
  securityJsonStringify,
  securityMathFloor,
  securityNumberIsFinite,
  securityRegExpExec,
  securityRegExpReplace,
  securityRegExpTest,
  securitySetAdd,
  securitySetHas,
  securitySha256Base64,
  securityStringCharCodeAt,
  securityStringReplaceAll,
} from './response-security-intrinsics.js';

/** CSP hash metadata for inline scripts/styles generated during document assembly. */
export interface CspInlineMetadata {
  /** Stable CSP hashes for generated inline `<script>` bodies in document order. */
  scripts: readonly string[];
  /** Stable CSP hashes for generated inline `<style>` bodies in document order. */
  styles: readonly string[];
  /** Stable CSP hashes for rendered `style="..."` attribute values in document order. */
  styleAttributes?: readonly string[];
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
  /**
   * OPP-14 / SPEC §6.6 audit-only telemetry: CSP violation reports are routed to a
   * framework-owned Reporting API group when present. This does not loosen the enforced
   * policy and is never a report-only ramp.
   */
  reportTo?: string;
  scriptSrc?: readonly string[];
  styleSrc?: readonly string[];
  /**
   * SF (secure-framework Tier 3): when `true`, append `require-trusted-types-for 'script'`
   * and a `trusted-types <policy>` directive that admits ONLY Kovo's sole framework
   * policy ({@link KOVO_TRUSTED_TYPES_POLICY}). On Chromium this turns every
   * non-framework `innerHTML`/`script.src`/`eval` DOM-write sink into a throw —
   * runtime defense-in-depth against a slipped-through DOM-XSS (SPEC §6.6), NOT a
   * by-construction proof. {@link renderDefaultDocumentCsp} now defaults this ON because
   * every Kovo internal sink (module-side AND the always-on inline loader) routes through
   * the policy's `createHTML`; this low-level builder still treats `true` as the explicit
   * opt-in for callers assembling a CSP by hand.
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
  /**
   * OPP-14 / SPEC §6.6 audit-only telemetry: omitted/`{}` emits a framework-owned
   * Reporting API group and CSP `report-to` directive for the strict enforced policy.
   * Set `false` to opt out. Reports are runtime audit signals, not by-construction
   * security and not a report-only ramp.
   */
  reporting?: CspReportingConfig | false;
  /**
   * SF (secure-framework Tier 3): the Chromium-only Trusted Types floor, now DEFAULT-ON.
   * Omitted/`true` emits `require-trusted-types-for 'script'` + `trusted-types kovo`; set
   * `false` to opt OUT (e.g. an app embedding a third-party widget that needs its own
   * un-named TT policy, or that writes raw HTML through a sink Kovo does not route).
   */
  trustedTypes?: boolean;
}

/** Framework-owned CSP Reporting API group name. */
export const KOVO_CSP_REPORT_GROUP = 'kovo-csp';

/** Framework-owned relative endpoint for browser CSP reports. */
export const KOVO_CSP_REPORT_ENDPOINT = '/_kovo/reports/csp';

/** Options for the framework-owned CSP reporting group. */
export interface CspReportingConfig {
  /**
   * Reporting API cache lifetime in seconds. Defaults to 10886400 seconds (126 days),
   * matching common browser examples for long-lived reporting groups.
   */
  maxAgeSeconds?: number;
}

export type CspReportingHeaders = {
  'Report-To': string;
  'Reporting-Endpoints': string;
};

interface CspReportingHeaderOptions {
  endpointOrigin?: string;
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
  const reporting = resolveCspReporting(config.reporting);
  const scriptSrc = appendSourceValues(["'self'"], allow.scriptSrc);
  const styleSrc = appendSourceValues(["'self'"], allow.styleSrc);
  const imgSrc =
    allow.imgSrc !== undefined && allow.imgSrc.length > 0
      ? appendSourceValues(["'self'", 'data:'], allow.imgSrc)
      : undefined;
  const connectSrc =
    allow.connectSrc !== undefined && allow.connectSrc.length > 0
      ? appendSourceValues(["'self'"], allow.connectSrc)
      : undefined;
  const frameSrc =
    allow.frameSrc !== undefined && allow.frameSrc.length > 0
      ? appendSourceValues([], allow.frameSrc)
      : undefined;
  // The allowlist EXTENDS the secure `'self'` base — it never replaces it — and it can
  // only touch the per-fetch directives below. `base-uri`/`object-src`/`form-action`/
  // `frame-ancestors` are assembled by `renderContentSecurityPolicy` from their secure
  // defaults and are intentionally absent from `CspAllowlist`, so they stay locked.
  return renderContentSecurityPolicy(metadata, {
    scriptSrc,
    styleSrc,
    ...(imgSrc === undefined ? {} : { imgSrc }),
    ...(connectSrc === undefined ? {} : { connectSrc }),
    ...(frameSrc === undefined ? {} : { frameSrc }),
    ...(reporting === undefined ? {} : { reportTo: reporting.group }),
    // SF (secure-framework Tier 3): Trusted Types is now DEFAULT-ON. Every framework-
    // assembled DOM-write sink — the module-side `morph.ts`/`query-bindings.ts` writes AND
    // the always-on inline loader's `insertAdjacentHTML`/`innerHTML` fragment-apply sinks
    // (the inlined `trustedHtml` shim, response-fragment-apply.ts) — routes through the
    // framework `kovo` Trusted Types policy, so the strict `require-trusted-types-for
    // 'script'` directive no longer bricks Kovo's own hydration on Chromium. It is a
    // Chromium-only runtime defense-in-depth floor (SPEC §6.6) that turns DOM-XSS sinks
    // OUTSIDE the framework into throws; every non-Chromium engine silently ignores it, so
    // the cross-browser CSP floor above carries the real guarantee. An app can opt OUT with
    // `document: { csp: { trustedTypes: false } }` (e.g. a third-party library that needs
    // its own un-named TT policy or an unrouted raw-HTML sink).
    ...(config.trustedTypes === false ? {} : { trustedTypes: true }),
  });
}

export function renderCspReportingHeaders(
  config: DocumentCspConfig = {},
  options: CspReportingHeaderOptions = {},
): CspReportingHeaders | undefined {
  const reporting = resolveCspReporting(config.reporting);
  if (reporting === undefined) return undefined;
  const endpoint = relativeReportEndpoint(reporting.endpoint, options.endpointOrigin);
  const endpointJson = securityJsonStringify(endpoint);
  const groupJson = securityJsonStringify(reporting.group);
  if (endpointJson === undefined || groupJson === undefined) {
    throw new TypeError('Kovo CSP reporting values could not be serialized.');
  }
  return {
    'Report-To': `{"endpoints":[{"url":${endpointJson}}],"group":${groupJson},"max_age":${reporting.maxAgeSeconds}}`,
    'Reporting-Endpoints': `${reporting.group}="${escapeStructuredFieldString(endpoint)}"`,
  };
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
  return `sha256-${securitySha256Base64(value)}`;
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
  const scripts: string[] = [];
  const styles: string[] = [];
  const rawStyleAttributes: string[] = [];
  for (let index = 0; index < metadata.length; index += 1) {
    const item = metadata[index];
    if (item === undefined) continue;
    appendSourceValuesInto(scripts, item.scripts);
    appendSourceValuesInto(styles, item.styles);
    if (item.styleAttributes !== undefined) {
      appendSourceValuesInto(rawStyleAttributes, item.styleAttributes);
    }
  }
  const styleAttributes = dedupe(rawStyleAttributes);
  return {
    scripts: dedupe(scripts),
    styles: dedupe(styles),
    ...(styleAttributes.length === 0 ? {} : { styleAttributes }),
  };
}

export function hasCspInlineMetadata(metadata: CspInlineMetadata): boolean {
  return (
    metadata.scripts.length > 0 ||
    metadata.styles.length > 0 ||
    (metadata.styleAttributes?.length ?? 0) > 0
  );
}

export function styleAttributeCspInlineMetadata(html: string): CspInlineMetadata {
  const hashes: string[] = [];
  const pattern = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>`]+))/giu;
  const withoutScripts = securityRegExpReplace(html, /<script\b[^>]*>[\s\S]*?<\/script>/giu, '');
  const scannableHtml = securityRegExpReplace(
    withoutScripts,
    /<style\b[^>]*>[\s\S]*?<\/style>/giu,
    '',
  );
  let match: RegExpExecArray | null;
  while ((match = securityRegExpExec(pattern, scannableHtml)) !== null) {
    const rawValue = match[1] ?? match[2] ?? match[3] ?? '';
    securityArrayPush(hashes, cspSha256(decodeHtmlAttribute(rawValue)));
  }
  const styleAttributes = dedupe(hashes);
  return styleAttributes.length === 0
    ? emptyCspInlineMetadata()
    : { scripts: [], styles: [], styleAttributes };
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
  const scriptSources = appendSourceValues(
    appendSourceValues([], options.scriptSrc ?? ["'self'"]),
    quoteHashes(metadata.scripts),
  );
  const styleSources = appendSourceValues(
    appendSourceValues(
      appendSourceValues([], options.styleSrc ?? ["'self'"]),
      quoteHashes(metadata.styles),
    ),
    (metadata.styleAttributes?.length ?? 0) === 0 ? [] : ["'unsafe-hashes'"],
  );
  appendSourceValuesInto(styleSources, quoteHashes(metadata.styleAttributes ?? []));
  const candidates: (string | undefined)[] = [
    directive('default-src', options.defaultSrc ?? ["'self'"]),
    directive('script-src', scriptSources),
    directive('style-src', styleSources),
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
    directive('report-to', options.reportTo === undefined ? undefined : [options.reportTo]),
    // SF (secure-framework Tier 3): the Chromium-only Trusted Types floor, now DEFAULT-ON
    // (`renderDefaultDocumentCsp` passes `trustedTypes: true` unless the app opts out).
    // Safe to default-on because EVERY framework DOM-write sink — module-side
    // `morph.ts`/`query-bindings.ts` AND the always-on inline loader's
    // `insertAdjacentHTML`/`innerHTML` fragment-apply sinks — routes through the framework
    // `kovo` policy, so Kovo's own hydration survives enforcement on Chromium.
    // `require-trusted-types-for 'script'` makes injection sinks throw; `trusted-types kovo`
    // admits ONLY Kovo's sole policy (no `'allow-duplicates'`) so an attacker cannot mint a
    // bypassing policy. Other browsers ignore both directives, leaving the cross-browser CSP
    // floor above intact (TT is runtime DiD, not a by-construction proof — SPEC §6.6).
  ];
  if (options.trustedTypes) {
    securityArrayPush(candidates, "require-trusted-types-for 'script'");
    securityArrayPush(candidates, `trusted-types ${KOVO_TRUSTED_TYPES_POLICY}`);
  }
  const directives: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined) securityArrayPush(directives, candidate);
  }

  return securityArrayJoin(directives, '; ');
}

function quoteHashes(hashes: readonly string[]): string[] {
  const quoted: string[] = [];
  for (let index = 0; index < hashes.length; index += 1) {
    securityArrayPush(quoted, `'${hashes[index]!}'`);
  }
  return quoted;
}

function decodeHtmlAttribute(value: string): string {
  return securityStringReplaceAll(
    securityStringReplaceAll(
      securityStringReplaceAll(securityStringReplaceAll(value, '&quot;', '"'), '&gt;', '>'),
      '&lt;',
      '<',
    ),
    '&amp;',
    '&',
  );
}

function directive(name: string, values: readonly string[] | undefined): string | undefined {
  if (!values || values.length === 0) return undefined;
  const deduped = dedupe(values);
  for (let index = 0; index < deduped.length; index += 1) {
    assertSafeCspSourceListValue(name, deduped[index]!);
  }
  return `${name} ${securityArrayJoin(deduped, ' ')}`;
}

/**
 * bugz-3 L18 / SPEC §6.6: source-list values are joined with spaces and the assembled
 * directives are joined with `; `, so a value containing `;`, `,`, whitespace, a newline,
 * or a control char would smuggle or split a directive. Because CSP is first-occurrence-
 * wins, a crafted allowlist entry (e.g. `evil.com; script-src 'unsafe-inline'`) could
 * inject a directive that overrides the supposedly NON-overridable hardening directives
 * (`base-uri`/`object-src`/`form-action`/`frame-ancestors`), contradicting this module's
 * "NEVER reachable from here" invariant. A legitimate CSP source expression (`'self'`,
 * `'none'`, a `'sha256-…'` hash, a scheme like `data:`, or an origin) never contains any
 * of these separators, so reject them fail-closed at assembly time with a clear error.
 */
function assertSafeCspSourceListValue(name: string, value: string): void {
  if (securityRegExpTest(/[\s;,]/, value) || hasCspControlCharacter(value)) {
    const serialized = securityJsonStringify(value) ?? 'undefined';
    throw new Error(
      `Kovo refused to assemble a Content-Security-Policy: the '${name}' source-list value ${serialized} contains a directive separator (';'/','), whitespace, a newline, or a control character. ` +
        `Such a value can smuggle or override CSP directives (SPEC §6.6 / bugz-3 L18); CSP allowlist entries must be single source expressions like 'self', a 'sha256-…' hash, a scheme, or an origin.`,
    );
  }
}

function hasCspControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function dedupe(values: readonly string[]): string[] {
  const seen = createSecuritySet<string>();
  const result: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === '' || securitySetHas(seen, value)) continue;
    securitySetAdd(seen, value);
    securityArrayPush(result, value);
  }
  return result;
}

function appendSourceValues(
  base: readonly string[],
  extra: readonly string[] | undefined,
): string[] {
  const result: string[] = [];
  appendSourceValuesInto(result, base);
  if (extra !== undefined) appendSourceValuesInto(result, extra);
  return result;
}

function appendSourceValuesInto(target: string[], values: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    securityArrayPush(target, values[index]!);
  }
}

function resolveCspReporting(config: CspReportingConfig | false | undefined):
  | {
      endpoint: string;
      group: string;
      maxAgeSeconds: number;
    }
  | undefined {
  if (config === false) return undefined;
  return {
    endpoint: KOVO_CSP_REPORT_ENDPOINT,
    group: KOVO_CSP_REPORT_GROUP,
    maxAgeSeconds: normalizeMaxAgeSeconds(config?.maxAgeSeconds),
  };
}

function normalizeMaxAgeSeconds(value: number | undefined): number {
  if (value === undefined) return 10886400;
  if (!securityNumberIsFinite(value) || value < 0) return 0;
  return securityMathFloor(value);
}

function escapeStructuredFieldString(value: string): string {
  return securityStringReplaceAll(securityStringReplaceAll(value, '\\', '\\\\'), '"', '\\"');
}

function relativeReportEndpoint(endpoint: string, _origin: string | undefined): string {
  return endpoint;
}

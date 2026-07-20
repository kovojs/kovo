import { escapeAttribute } from './html.js';
import type {
  BrowserPostureCspDirective,
  BrowserPostureManifest,
} from '@kovojs/core/internal/security-operation-ir';
import {
  registeredGeneratedBrowserPostureManifest,
  snapshotBrowserPostureManifest,
} from './generated-browser-posture-registry.js';
import { assertCrossOriginIsolationEligible } from './browser-response-posture.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
} from './security-witness-intrinsics.js';
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
  securityStringTrim,
  securityUrlSnapshot,
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
  fontSrc?: readonly string[];
  imgSrc?: readonly string[];
  mediaSrc?: readonly string[];
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
  workerSrc?: readonly string[];
  /**
   * SF (secure-framework Tier 3): when `true`, append `require-trusted-types-for 'script'`
   * and a `trusted-types <policies>` directive that admits only Kovo's generated
   * ({@link KOVO_TRUSTED_TYPES_POLICY}) and modular framework policies. On Chromium this turns every
   * non-framework `innerHTML`/`script.src`/`eval` DOM-write sink into a throw —
   * runtime defense-in-depth against a slipped-through DOM-XSS (SPEC §6.6), NOT a
   * by-construction proof. {@link renderDefaultDocumentCsp} now defaults this ON because
   * every Kovo internal sink (module-side AND the always-on inline loader) routes through
   * its private policy's `createHTML`; this low-level builder still treats `true` as the explicit
   * opt-in for callers assembling a CSP by hand.
   */
  trustedTypes?: boolean;
}

/**
 * SF (secure-framework Tier 3): the name of the framework-owned Trusted Types policy
 * used by Kovo's generated runtime. The strict CSP also admits the
 * distinct module-private `kovo-browser` policy used by the modular browser runtime;
 * it deliberately omits `'allow-duplicates'`, so app or third-party attempts to
 * recreate either framework policy still throw on Chromium.
 */
export const KOVO_TRUSTED_TYPES_POLICY = 'kovo';
const KOVO_BROWSER_TRUSTED_TYPES_POLICY = 'kovo-browser';

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
/** One reviewed CSP origin that cannot be connected to a static compiler census entry. */
export interface CspAllowlistOrigin {
  /** Canonical absolute HTTP(S)/WS(S) origin admitted by the reviewed escape. */
  origin: string;
  /** Non-empty audit reason for admitting an origin absent from the static census. */
  rationale: string;
}

/** A census-matched origin or an explicit reviewed escape. */
export type CspAllowlistEntry = string | CspAllowlistOrigin;

/**
 * App-facing third-party origins that extend, but never replace, Kovo's strict per-resource
 * defaults. Uncensused origins must use {@link CspAllowlistOrigin} so the reviewed rationale is
 * explicit; hardening directives such as `base-uri` and `object-src` are not configurable here.
 */
export interface CspAllowlist {
  /** Extra origins admitted for `connect-src` (XHR/fetch/WebSocket/EventSource/beacon). */
  connectSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `font-src`. */
  fontSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `frame-src` (embedded `<iframe>` sources). */
  frameSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `img-src` (external image hosts/CDNs). */
  imgSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `media-src`. */
  mediaSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `script-src` (third-party SDKs). */
  scriptSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `style-src` (external stylesheet hosts). */
  styleSrc?: readonly CspAllowlistEntry[];
  /** Extra origins admitted for `worker-src`. */
  workerSrc?: readonly CspAllowlistEntry[];
}

/**
 * SF (secure-framework Tier 3): the strict default-on CSP configuration carried on a
 * document response. `allowlist` extends the per-fetch directives; `trustedTypes`
 * opts into the Chromium-only Trusted Types floor.
 */
export interface DocumentCspConfig {
  allowlist?: CspAllowlist;
  /**
   * Enable COOP/COEP/CORP only when the generated posture proves there are no external resources,
   * frames, popups, opaque URLs, or dynamic browser fetch/worker effects.
   */
  crossOriginIsolation?: true;
  /**
   * OPP-14 / SPEC §6.6 audit-only telemetry: omitted/`{}` emits a framework-owned
   * Reporting API group and CSP `report-to` directive for the strict enforced policy.
   * Set `false` to opt out. Reports are runtime audit signals, not by-construction
   * security and not a report-only ramp.
   */
  reporting?: CspReportingConfig | false;
  /**
   * SF (secure-framework Tier 3): the Chromium-only Trusted Types floor, now DEFAULT-ON.
   * Omitted/`true` emits `require-trusted-types-for 'script'` plus the two private Kovo
   * policy names; set
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

const CSP_ALLOWLIST_KEYS = [
  'connectSrc',
  'fontSrc',
  'frameSrc',
  'imgSrc',
  'mediaSrc',
  'scriptSrc',
  'styleSrc',
  'workerSrc',
] as const satisfies readonly (keyof CspAllowlist)[];

const CSP_POLICY_ARRAY_KEYS = [
  'baseUri',
  'connectSrc',
  'defaultSrc',
  'formAction',
  'frameAncestors',
  'frameSrc',
  'fontSrc',
  'imgSrc',
  'mediaSrc',
  'objectSrc',
  'scriptSrc',
  'styleSrc',
  'workerSrc',
] as const satisfies readonly (keyof ContentSecurityPolicyOptions)[];

function snapshotCspInlineMetadata(source: CspInlineMetadata): CspInlineMetadata {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('CSP inline metadata must be a stable own-data record.');
  }
  const scripts = snapshotCspStringArray(
    cspRequiredOwnDataValue(source, 'scripts', 'CSP inline metadata'),
    'CSP inline script hashes',
  );
  const styles = snapshotCspStringArray(
    cspRequiredOwnDataValue(source, 'styles', 'CSP inline metadata'),
    'CSP inline style hashes',
  );
  const rawStyleAttributes = cspOwnDataValue(source, 'styleAttributes', 'CSP inline metadata');
  const styleAttributes =
    rawStyleAttributes === undefined
      ? undefined
      : snapshotCspStringArray(rawStyleAttributes, 'CSP inline style-attribute hashes');
  const snapshot = witnessCreateNullRecord<unknown>();
  snapshot.scripts = scripts;
  snapshot.styles = styles;
  snapshot.styleAttributes = styleAttributes;
  return witnessFreeze(snapshot) as unknown as CspInlineMetadata;
}

function snapshotDocumentCspConfig(source: DocumentCspConfig): DocumentCspConfig {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Document CSP config must be a stable own-data record.');
  }
  const rawAllowlist = cspOwnDataValue(source, 'allowlist', 'Document CSP config');
  const crossOriginIsolation = cspOwnDataValue(
    source,
    'crossOriginIsolation',
    'Document CSP config',
  );
  const rawReporting = cspOwnDataValue(source, 'reporting', 'Document CSP config');
  const trustedTypes = cspOwnDataValue(source, 'trustedTypes', 'Document CSP config');
  if (crossOriginIsolation !== undefined && crossOriginIsolation !== true) {
    throw new TypeError('Document CSP crossOriginIsolation must be true when present.');
  }
  if (trustedTypes !== undefined && typeof trustedTypes !== 'boolean') {
    throw new TypeError('Document CSP trustedTypes must be a boolean.');
  }
  const allowlist = rawAllowlist === undefined ? undefined : snapshotCspAllowlist(rawAllowlist);
  const reporting =
    rawReporting === undefined || rawReporting === false
      ? rawReporting
      : snapshotCspReportingConfig(rawReporting);
  const snapshot = witnessCreateNullRecord<unknown>();
  snapshot.allowlist = allowlist;
  snapshot.crossOriginIsolation = crossOriginIsolation;
  snapshot.reporting = reporting;
  snapshot.trustedTypes = trustedTypes;
  return witnessFreeze(snapshot) as unknown as DocumentCspConfig;
}

function snapshotCspAllowlist(source: unknown): CspAllowlist {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Document CSP allowlist must be a stable own-data record.');
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < CSP_ALLOWLIST_KEYS.length; index += 1) {
    const key = CSP_ALLOWLIST_KEYS[index]!;
    const value = cspOwnDataValue(source, key, 'Document CSP allowlist');
    snapshot[key] =
      value === undefined ? undefined : snapshotCspAllowlistEntries(value, `CSP allowlist.${key}`);
  }
  return witnessFreeze(snapshot) as unknown as CspAllowlist;
}

function snapshotCspAllowlistEntries(source: unknown, label: string): readonly CspAllowlistEntry[] {
  if (!witnessIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = cspRequiredOwnDataValue(source, 'length', label);
  if (
    typeof length !== 'number' ||
    !securityNumberIsFinite(length) ||
    securityMathFloor(length) !== length ||
    length < 0 ||
    length > 100_000
  ) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: CspAllowlistEntry[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = cspRequiredOwnDataValue(source, index, label);
    if (typeof entry === 'string') {
      witnessArrayAppend(snapshot, entry, label);
      continue;
    }
    if (typeof entry !== 'object' || entry === null || witnessIsArray(entry)) {
      throw new TypeError(`${label} entries must be origins or reviewed origin records.`);
    }
    const origin = cspRequiredOwnDataValue(entry, 'origin', `${label}[${index}]`);
    const rationale = cspRequiredOwnDataValue(entry, 'rationale', `${label}[${index}]`);
    if (
      typeof origin !== 'string' ||
      typeof rationale !== 'string' ||
      securityStringTrim(rationale) === ''
    ) {
      throw new TypeError(`${label} reviewed entries require string origin and rationale.`);
    }
    witnessArrayAppend(
      snapshot,
      witnessFreeze({ origin, rationale: securityStringTrim(rationale) }),
      label,
    );
  }
  return witnessFreeze(snapshot);
}

function snapshotCspReportingConfig(source: unknown): CspReportingConfig {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Document CSP reporting config must be a stable own-data record.');
  }
  const maxAgeSeconds = cspOwnDataValue(source, 'maxAgeSeconds', 'CSP reporting config');
  if (maxAgeSeconds !== undefined && typeof maxAgeSeconds !== 'number') {
    throw new TypeError('CSP reporting maxAgeSeconds must be a number.');
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  snapshot.maxAgeSeconds = maxAgeSeconds;
  return witnessFreeze(snapshot) as unknown as CspReportingConfig;
}

function snapshotContentSecurityPolicyOptions(
  source: ContentSecurityPolicyOptions,
): ContentSecurityPolicyOptions {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('CSP policy options must be a stable own-data record.');
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  for (let index = 0; index < CSP_POLICY_ARRAY_KEYS.length; index += 1) {
    const key = CSP_POLICY_ARRAY_KEYS[index]!;
    const value = cspOwnDataValue(source, key, 'CSP policy options');
    snapshot[key] =
      value === undefined ? undefined : snapshotCspStringArray(value, `CSP policy ${key}`);
  }
  const reportTo = cspOwnDataValue(source, 'reportTo', 'CSP policy options');
  const trustedTypes = cspOwnDataValue(source, 'trustedTypes', 'CSP policy options');
  if (reportTo !== undefined && typeof reportTo !== 'string') {
    throw new TypeError('CSP reportTo must be a string.');
  }
  if (trustedTypes !== undefined && typeof trustedTypes !== 'boolean') {
    throw new TypeError('CSP trustedTypes must be a boolean.');
  }
  snapshot.reportTo = reportTo;
  snapshot.trustedTypes = trustedTypes;
  return witnessFreeze(snapshot) as unknown as ContentSecurityPolicyOptions;
}

function snapshotCspStringArray(source: unknown, label: string): readonly string[] {
  if (!witnessIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = cspRequiredOwnDataValue(source, 'length', label);
  if (
    typeof length !== 'number' ||
    !securityNumberIsFinite(length) ||
    securityMathFloor(length) !== length ||
    length < 0 ||
    length > 100_000
  ) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = cspRequiredOwnDataValue(source, index, label);
    if (typeof value !== 'string') throw new TypeError(`${label} must contain strings.`);
    witnessArrayAppend(snapshot, value, label);
  }
  return witnessFreeze(snapshot);
}

function cspRequiredOwnDataValue(source: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined || after === undefined) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return cspStableDescriptorValue(before, after, property, label);
}

function cspOwnDataValue(source: object, property: PropertyKey, label: string): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (before === undefined || after === undefined) {
    throw new TypeError(`${label}.${String(property)} must be stable.`);
  }
  return cspStableDescriptorValue(before, after, property, label);
}

function cspStableDescriptorValue(
  before: PropertyDescriptor,
  after: PropertyDescriptor,
  property: PropertyKey,
  label: string,
): unknown {
  if (!('value' in before) || !('value' in after)) {
    throw new TypeError(`${label}.${String(property)} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`${label}.${String(property)} changed during validation.`);
  }
  return before.value;
}

/**
 * SF (secure-framework Tier 3): assemble the strict default-on `Content-Security-Policy`
 * header value for a framework-rendered document.
 *
 * This is the dispatch-path counterpart of {@link renderContentSecurityPolicy}: it
 * starts from the strong default (`'self'` + Kovo's inline-script/style hashes + the
 * NON-overridable `base-uri`/`object-src`/`form-action`/`frame-ancestors` hardening
 * directives), admits compiler-censused origins, and folds in only census-matched or
 * explicitly rationalized {@link CspAllowlist} origins. The hardening directives are
 * never reachable from `config`.
 *
 * @param metadata - Inline-script/style CSP hashes surfaced on the rendered document.
 * @param config - Optional reviewed origins, reporting/Trusted Types, and isolation posture.
 * @returns The assembled strict `Content-Security-Policy` header value.
 */
export function renderDefaultDocumentCsp(
  metadata: CspInlineMetadata,
  config: DocumentCspConfig = {},
): string {
  return renderDefaultDocumentCspFromManifest(
    metadata,
    config,
    registeredGeneratedBrowserPostureManifest(),
  );
}

/** Render against an explicit compiler carrier for framework tests and generated gates. @internal */
export function renderDefaultDocumentCspFromManifest(
  metadata: CspInlineMetadata,
  config: DocumentCspConfig,
  manifest: BrowserPostureManifest | undefined,
): string {
  const closedMetadata = snapshotCspInlineMetadata(metadata);
  const closedConfig = snapshotDocumentCspConfig(config);
  if (closedConfig.crossOriginIsolation === true) {
    assertDocumentCspConfigMatchesBrowserPosture(closedConfig, manifest);
  }
  const sources = browserPostureCspSources(closedConfig, manifest);
  const reporting = resolveCspReporting(closedConfig.reporting);
  const scriptSrc = appendSourceValues(["'self'"], sources.scriptSrc);
  const styleSrc = appendSourceValues(["'self'"], sources.styleSrc);
  const imgSrc =
    sources.imgSrc.length > 0 ? appendSourceValues(["'self'", 'data:'], sources.imgSrc) : undefined;
  const connectSrc =
    sources.connectSrc.length > 0 ? appendSourceValues(["'self'"], sources.connectSrc) : undefined;
  const frameSrc =
    sources.frameSrc.length > 0 ? appendSourceValues(["'self'"], sources.frameSrc) : undefined;
  const fontSrc =
    sources.fontSrc.length > 0 ? appendSourceValues(["'self'"], sources.fontSrc) : undefined;
  const mediaSrc =
    sources.mediaSrc.length > 0 ? appendSourceValues(["'self'"], sources.mediaSrc) : undefined;
  const workerSrc =
    sources.workerSrc.length > 0 ? appendSourceValues(["'self'"], sources.workerSrc) : undefined;
  // The allowlist EXTENDS the secure `'self'` base — it never replaces it — and it can
  // only touch the per-fetch directives below. `base-uri`/`object-src`/`form-action`/
  // `frame-ancestors` are assembled by `renderContentSecurityPolicy` from their secure
  // defaults and are intentionally absent from `CspAllowlist`, so they stay locked.
  return renderContentSecurityPolicy(closedMetadata, {
    scriptSrc,
    styleSrc,
    ...(imgSrc === undefined ? {} : { imgSrc }),
    ...(connectSrc === undefined ? {} : { connectSrc }),
    ...(frameSrc === undefined ? {} : { frameSrc }),
    ...(fontSrc === undefined ? {} : { fontSrc }),
    ...(mediaSrc === undefined ? {} : { mediaSrc }),
    ...(workerSrc === undefined ? {} : { workerSrc }),
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
    ...(closedConfig.trustedTypes === false ? {} : { trustedTypes: true }),
  });
}

/** Validate authored CSP entries against the compiler-owned external-origin census. @internal */
export function assertDocumentCspConfigMatchesBrowserPosture(
  config: DocumentCspConfig,
  manifest: BrowserPostureManifest | undefined = registeredGeneratedBrowserPostureManifest(),
): void {
  const closed = snapshotDocumentCspConfig(config);
  browserPostureCspSources(closed, manifest);
  if (closed.crossOriginIsolation === true) {
    assertCrossOriginIsolationEligible(manifest);
    if (cspAllowlistHasEntries(closed.allowlist)) {
      throw new TypeError(
        'crossOriginIsolation cannot prove CORP/CORS requirements for authored CSP allowlist origins.',
      );
    }
  }
}

function cspAllowlistHasEntries(allowlist: CspAllowlist | undefined): boolean {
  if (allowlist === undefined) return false;
  for (let index = 0; index < CSP_ALLOWLIST_KEYS.length; index += 1) {
    const values = allowlist[CSP_ALLOWLIST_KEYS[index]!];
    if (values !== undefined && values.length > 0) return true;
  }
  return false;
}

interface BrowserPostureCspSources {
  connectSrc: readonly string[];
  fontSrc: readonly string[];
  frameSrc: readonly string[];
  imgSrc: readonly string[];
  mediaSrc: readonly string[];
  scriptSrc: readonly string[];
  styleSrc: readonly string[];
  workerSrc: readonly string[];
}

function browserPostureCspSources(
  config: DocumentCspConfig,
  manifest: BrowserPostureManifest | undefined,
): BrowserPostureCspSources {
  const closedManifest =
    manifest === undefined ? undefined : snapshotBrowserPostureManifest(manifest);
  return witnessFreeze({
    connectSrc: sourcesForBrowserDirective(
      'connect-src',
      config.allowlist?.connectSrc,
      closedManifest,
    ),
    fontSrc: sourcesForBrowserDirective('font-src', config.allowlist?.fontSrc, closedManifest),
    frameSrc: sourcesForBrowserDirective('frame-src', config.allowlist?.frameSrc, closedManifest),
    imgSrc: sourcesForBrowserDirective('img-src', config.allowlist?.imgSrc, closedManifest),
    mediaSrc: sourcesForBrowserDirective('media-src', config.allowlist?.mediaSrc, closedManifest),
    scriptSrc: sourcesForBrowserDirective(
      'script-src',
      config.allowlist?.scriptSrc,
      closedManifest,
    ),
    styleSrc: sourcesForBrowserDirective('style-src', config.allowlist?.styleSrc, closedManifest),
    workerSrc: sourcesForBrowserDirective(
      'worker-src',
      config.allowlist?.workerSrc,
      closedManifest,
    ),
  });
}

function sourcesForBrowserDirective(
  directive: BrowserPostureCspDirective,
  entries: readonly CspAllowlistEntry[] | undefined,
  manifest: BrowserPostureManifest | undefined,
): readonly string[] {
  const census: string[] = [];
  const origins = manifest?.externalOrigins ?? [];
  for (let index = 0; index < origins.length; index += 1) {
    const fact = origins[index]!;
    if (fact.directive === directive) securityArrayPush(census, fact.origin);
  }
  const sources = dedupe(census);
  if (entries === undefined) return witnessFreeze(sources);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const reviewed = typeof entry !== 'string';
    const origin = canonicalCspOrigin(reviewed ? entry.origin : entry, directive);
    if (!reviewed && !containsSource(census, origin)) {
      throw new TypeError(
        `CSP allowlist ${directive} origin ${origin} is absent from the compiler-derived browser posture census; add a rationale only for an audited non-static source.`,
      );
    }
    securityArrayPush(sources, origin);
  }
  return witnessFreeze(dedupe(sources));
}

function canonicalCspOrigin(value: string, directive: BrowserPostureCspDirective): string {
  if (securityStringTrim(value) !== value || value === '') {
    throw new TypeError(`CSP allowlist ${directive} entries must be canonical non-empty origins.`);
  }
  let url: ReturnType<typeof securityUrlSnapshot>;
  try {
    url = securityUrlSnapshot(value);
  } catch {
    throw new TypeError(`CSP allowlist ${directive} contains an invalid absolute origin.`);
  }
  if (
    (url.protocol !== 'http:' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'ws:' &&
      url.protocol !== 'wss:') ||
    url.origin !== value
  ) {
    throw new TypeError(
      `CSP allowlist ${directive} entries must be canonical HTTP(S) or WS(S) origins.`,
    );
  }
  return url.origin;
}

function containsSource(values: readonly string[], expected: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

export function renderCspReportingHeaders(
  config: DocumentCspConfig = {},
  options: CspReportingHeaderOptions = {},
): CspReportingHeaders | undefined {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('CSP reporting options must be a stable own-data record.');
  }
  const closedConfig = snapshotDocumentCspConfig(config);
  const endpointOrigin = cspOwnDataValue(options, 'endpointOrigin', 'CSP reporting options');
  if (endpointOrigin !== undefined && typeof endpointOrigin !== 'string') {
    throw new TypeError('CSP reporting endpointOrigin must be a string.');
  }
  const reporting = resolveCspReporting(closedConfig.reporting);
  if (reporting === undefined) return undefined;
  const endpoint = relativeReportEndpoint(reporting.endpoint, endpointOrigin);
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
  const closedMetadata = snapshotCspInlineMetadata(metadata);
  const closedOptions = snapshotContentSecurityPolicyOptions(options);
  const scriptSources = appendSourceValues(
    appendSourceValues([], closedOptions.scriptSrc ?? ["'self'"]),
    quoteHashes(closedMetadata.scripts),
  );
  const styleSources = appendSourceValues(
    appendSourceValues(
      appendSourceValues([], closedOptions.styleSrc ?? ["'self'"]),
      quoteHashes(closedMetadata.styles),
    ),
    (closedMetadata.styleAttributes?.length ?? 0) === 0 ? [] : ["'unsafe-hashes'"],
  );
  appendSourceValuesInto(styleSources, quoteHashes(closedMetadata.styleAttributes ?? []));
  const candidates: (string | undefined)[] = [
    directive('default-src', closedOptions.defaultSrc ?? ["'self'"]),
    directive('script-src', scriptSources),
    directive('style-src', styleSources),
    directive('img-src', closedOptions.imgSrc),
    directive('connect-src', closedOptions.connectSrc),
    directive('frame-src', closedOptions.frameSrc),
    directive('font-src', closedOptions.fontSrc),
    directive('media-src', closedOptions.mediaSrc),
    directive('worker-src', closedOptions.workerSrc),
    // G2 (bugs-part3 CSP-2): `base-uri` and `object-src` are NON-overridable hardening
    // directives with no `default-src` fallback. Without `base-uri`, an injected
    // `<base href="//evil">` (markup injection, no script execution) reroutes every
    // relative module URL to an attacker origin and runs attacker JS despite the
    // hash-locked `script-src`. Emit them unconditionally with secure defaults.
    directive('base-uri', closedOptions.baseUri ?? ["'self'"]),
    directive('object-src', closedOptions.objectSrc ?? ["'none'"]),
    // `form-action`/`frame-ancestors` close the injected-`<form action>` exfiltration
    // and clickjacking vectors respectively; emit with secure defaults.
    directive('form-action', closedOptions.formAction ?? ["'self'"]),
    directive('frame-ancestors', closedOptions.frameAncestors ?? ["'none'"]),
    directive(
      'report-to',
      closedOptions.reportTo === undefined ? undefined : [closedOptions.reportTo],
    ),
    // SF (secure-framework Tier 3): the Chromium-only Trusted Types floor, now DEFAULT-ON
    // (`renderDefaultDocumentCsp` passes `trustedTypes: true` unless the app opts out).
    // Safe to default-on because EVERY framework DOM-write sink — module-side
    // `morph.ts`/`query-bindings.ts` AND the always-on inline loader's
    // `insertAdjacentHTML`/`innerHTML` fragment-apply sinks — routes through the framework
    // private `kovo` / `kovo-browser` policies, so Kovo's own hydration survives enforcement on
    // Chromium even when generated and modular runtimes coexist. `require-trusted-types-for
    // 'script'` makes injection sinks throw; omitting `'allow-duplicates'` prevents another
    // controller from recreating either framework policy. Other browsers ignore both directives,
    // leaving the cross-browser CSP floor above intact (TT is runtime DiD, not a by-construction
    // proof — SPEC §6.6).
  ];
  if (closedOptions.trustedTypes) {
    securityArrayPush(candidates, "require-trusted-types-for 'script'");
    securityArrayPush(
      candidates,
      `trusted-types ${KOVO_TRUSTED_TYPES_POLICY} ${KOVO_BROWSER_TRUSTED_TYPES_POLICY}`,
    );
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

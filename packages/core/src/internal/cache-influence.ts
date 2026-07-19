import {
  freezeSecurityValue,
  securityArrayAppend,
  securityGetOwnPropertyDescriptor,
  securityIsArray,
  securityJsonStringify,
  securityOwnArrayEntry,
  securityRegExpTest,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityStringToLowerCase,
  securityStringTrim,
} from './security-witness-intrinsics.js';

/** Versioned compiler-to-runtime shared-cache influence contract (SPEC §9.4). @internal */
export const cacheInfluenceManifestSchema = 'kovo-cache-influence/v1' as const;

/** @internal */
export type CacheInfluenceSurface = 'document' | 'endpoint' | 'query';

/** @internal */
export interface CacheInfluenceAuditedEscape {
  readonly name: string;
  readonly retainedObligation: string;
}

/** @internal */
export interface CacheInfluenceAuthoredIntent {
  readonly auditedEscape?: CacheInfluenceAuditedEscape;
  readonly cacheControl?: string;
  readonly posture: 'non-public' | 'public';
}

/** @internal */
export type CacheInfluenceKeyContribution =
  | { readonly axis: 'request-header'; readonly name: string }
  | { readonly axis: 'url-path' }
  | { readonly axis: 'url-search'; readonly name: string };

/** @internal */
export interface CacheInfluenceExternalDataVersionInput {
  readonly key?: CacheInfluenceKeyContribution;
  readonly name: string;
}

/** @internal Compiler-owned finite influence input, never app-authored proof. */
export interface CacheInfluenceDerivationInput {
  readonly authored: CacheInfluenceAuthoredIntent;
  readonly influences: {
    readonly authorization?: true;
    readonly cookie?: true;
    readonly externalDataVersions?: readonly CacheInfluenceExternalDataVersionInput[];
    readonly frameworkState?: true;
    readonly principal?: true;
    readonly requestHeaders?: readonly string[];
    readonly secret?: true;
    readonly session?: true;
    readonly unclassified?: readonly string[];
    readonly urlPath?: true;
    readonly urlSearch?: true;
  };
  readonly root: string;
  readonly surface: CacheInfluenceSurface;
}

/** @internal */
export type CacheInfluenceAxis =
  | { readonly kind: 'url-path'; readonly role: 'cache-key' }
  | { readonly kind: 'url-search'; readonly role: 'cache-key' }
  | { readonly kind: 'request-header'; readonly name: string; readonly role: 'vary' }
  | {
      readonly key?: CacheInfluenceKeyContribution;
      readonly kind: 'external-data-version';
      readonly name: string;
      readonly role: 'cache-key' | 'shared-cache-closed';
    }
  | {
      readonly kind: 'framework-state';
      readonly role: 'external-version-key' | 'shared-cache-closed';
    }
  | {
      readonly kind:
        | 'authorization'
        | 'cookie'
        | 'principal'
        | 'secret'
        | 'session'
        | 'unclassified';
      readonly role: 'shared-cache-closed';
    };

/** @internal Stable closed-verdict vocabulary for cache influence. */
export type CacheInfluenceClosedReason =
  | 'authored-non-public'
  | 'authorization-influence'
  | 'cookie-influence'
  | 'external-data-version-without-key-contribution'
  | 'framework-state-without-keyed-external-version'
  | 'principal-influence'
  | 'secret-influence'
  | 'session-influence'
  | 'unclassified-influence';

/** @internal One source-derived handler/cache declaration verdict. */
export interface CacheInfluenceManifestEntry {
  readonly auditedEscape?: CacheInfluenceAuditedEscape;
  readonly authored: CacheInfluenceAuthoredIntent;
  readonly axes: readonly CacheInfluenceAxis[];
  readonly closedReasons: readonly CacheInfluenceClosedReason[];
  readonly root: string;
  readonly surface: CacheInfluenceSurface;
  readonly vary: readonly string[];
  readonly verdict: 'audited-escape' | 'public-proved' | 'shared-cache-closed';
}

/** @internal Compiler-owned app manifest registered before app modules evaluate. */
export interface CacheInfluenceManifest {
  readonly entries: readonly CacheInfluenceManifestEntry[];
  readonly schema: typeof cacheInfluenceManifestSchema;
}

/**
 * Canonicalize compiler-owned influence facts into the only cache manifest shape accepted by the
 * runtime. URL components are cache-key axes, named headers alone become Vary, and every ambient
 * authority axis closes shared caching (SPEC §9.4 and Plan 2 Phase 0 cache decision).
 * @internal
 */
export function deriveCacheInfluenceManifestEntry(
  input: CacheInfluenceDerivationInput,
): CacheInfluenceManifestEntry {
  const root = requiredText(input.root, 'cache influence root');
  const surface = cacheInfluenceSurface(input.surface);
  const authored = snapshotAuthoredIntent(input.authored);
  const influences = ownRecord(input, 'influences', 'cache influence input');
  const axes: CacheInfluenceAxis[] = [];
  const reasons: CacheInfluenceClosedReason[] = [];
  const headers: string[] = [];

  if (ownTrue(influences, 'urlPath')) {
    securityArrayAppend(axes, freezeSecurityValue({ kind: 'url-path', role: 'cache-key' }));
  }
  if (ownTrue(influences, 'urlSearch')) {
    securityArrayAppend(axes, freezeSecurityValue({ kind: 'url-search', role: 'cache-key' }));
  }

  const unclassified: string[] = [];
  const sourceHeaders = optionalOwnArray(influences, 'requestHeaders', 'request headers');
  for (let index = 0; index < sourceHeaders.length; index += 1) {
    const entry = ownArrayValue(sourceHeaders, index, 'request headers');
    const header = typeof entry === 'string' ? normalizedHeaderName(entry) : undefined;
    if (header === undefined) {
      securityArrayAppend(unclassified, 'invalid or dynamic request-header name');
    } else {
      insertUniqueString(headers, header);
    }
  }

  const externalVersions = optionalOwnArray(
    influences,
    'externalDataVersions',
    'external data versions',
  );
  let keyedExternalVersions = 0;
  for (let index = 0; index < externalVersions.length; index += 1) {
    const version = ownArrayValue(externalVersions, index, 'external data versions');
    if (version === null || typeof version !== 'object') {
      throw new TypeError('Cache external data versions must be own data records.');
    }
    const name = requiredText(ownData(version, 'name', 'external data version'), 'version name');
    const keyValue = optionalOwnData(version, 'key', 'external data version');
    const key = keyValue === undefined ? undefined : snapshotKeyContribution(keyValue);
    if (key === undefined) {
      appendReason(reasons, 'external-data-version-without-key-contribution');
      securityArrayAppend(
        axes,
        freezeSecurityValue({
          kind: 'external-data-version',
          name,
          role: 'shared-cache-closed',
        }),
      );
      continue;
    }
    keyedExternalVersions += 1;
    if (key.axis === 'request-header') insertUniqueString(headers, key.name);
    securityArrayAppend(
      axes,
      freezeSecurityValue({ key, kind: 'external-data-version', name, role: 'cache-key' }),
    );
  }

  for (let index = 0; index < headers.length; index += 1) {
    securityArrayAppend(
      axes,
      freezeSecurityValue({ kind: 'request-header', name: headers[index]!, role: 'vary' }),
    );
  }

  appendClosingAxis(influences, axes, reasons, 'authorization', 'authorization-influence');
  appendClosingAxis(influences, axes, reasons, 'cookie', 'cookie-influence');
  appendClosingAxis(influences, axes, reasons, 'principal', 'principal-influence');
  appendClosingAxis(influences, axes, reasons, 'session', 'session-influence');
  appendClosingAxis(influences, axes, reasons, 'secret', 'secret-influence');

  if (ownTrue(influences, 'frameworkState')) {
    const keyed = externalVersions.length > 0 && keyedExternalVersions === externalVersions.length;
    securityArrayAppend(
      axes,
      freezeSecurityValue({
        kind: 'framework-state',
        role: keyed ? 'external-version-key' : 'shared-cache-closed',
      }),
    );
    if (!keyed) appendReason(reasons, 'framework-state-without-keyed-external-version');
  }

  const sourceUnclassified = optionalOwnArray(influences, 'unclassified', 'unclassified facts');
  for (let index = 0; index < sourceUnclassified.length; index += 1) {
    const value = ownArrayValue(sourceUnclassified, index, 'unclassified facts');
    if (typeof value === 'string' && securityStringTrim(value) !== '') {
      securityArrayAppend(unclassified, securityStringTrim(value));
    }
  }
  if (unclassified.length > 0) {
    securityArrayAppend(axes, freezeSecurityValue({ kind: 'unclassified', role: 'shared-cache-closed' }));
    appendReason(reasons, 'unclassified-influence');
  }

  if (authored.posture !== 'public') appendReason(reasons, 'authored-non-public');
  const verdict =
    authored.posture === 'public' && reasons.length === 0
      ? 'public-proved'
      : authored.posture === 'public' && authored.auditedEscape !== undefined
        ? 'audited-escape'
        : 'shared-cache-closed';

  freezeSecurityValue(headers);
  freezeSecurityValue(axes);
  freezeSecurityValue(reasons);
  return freezeSecurityValue({
    ...(authored.auditedEscape === undefined ? {} : { auditedEscape: authored.auditedEscape }),
    authored,
    axes,
    closedReasons: reasons,
    root,
    surface,
    vary: headers,
    verdict,
  });
}

/** Build and deeply validate one deterministic manifest. @internal */
export function createCacheInfluenceManifest(
  entries: readonly CacheInfluenceManifestEntry[],
): CacheInfluenceManifest {
  if (!securityIsArray(entries)) throw new TypeError('Cache influence entries must be an array.');
  const snapshot: CacheInfluenceManifestEntry[] = [];
  const roots = securitySet<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = ownArrayValue(entries, index, 'cache influence entries');
    const normalized = snapshotManifestEntry(entry);
    if (securitySetHas(roots, normalized.root)) {
      throw new TypeError(`Duplicate cache influence root ${normalized.root}.`);
    }
    securitySetAdd(roots, normalized.root);
    securityArrayAppend(snapshot, normalized);
  }
  freezeSecurityValue(snapshot);
  return freezeSecurityValue({ entries: snapshot, schema: cacheInfluenceManifestSchema });
}

/** Validate and snapshot an untrusted serialized manifest without trusting its verdict fields. */
export function snapshotCacheInfluenceManifest(value: unknown): CacheInfluenceManifest {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Cache influence manifest must be an object.');
  }
  if (ownData(value, 'schema', 'cache influence manifest') !== cacheInfluenceManifestSchema) {
    throw new TypeError(`Cache influence manifest schema must be ${cacheInfluenceManifestSchema}.`);
  }
  const entries = ownData(value, 'entries', 'cache influence manifest');
  if (!securityIsArray(entries)) throw new TypeError('Cache influence manifest entries must be an array.');
  return createCacheInfluenceManifest(entries as readonly CacheInfluenceManifestEntry[]);
}

function snapshotManifestEntry(value: unknown): CacheInfluenceManifestEntry {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Cache influence manifest entries must be objects.');
  }
  const authored = snapshotAuthoredIntent(
    ownData(value, 'authored', 'cache influence entry') as CacheInfluenceAuthoredIntent,
  );
  const axesValue = ownData(value, 'axes', 'cache influence entry');
  if (!securityIsArray(axesValue)) throw new TypeError('Cache influence entry axes must be an array.');
  const influences: CacheInfluenceDerivationInput['influences'] = axesToInfluences(axesValue);
  const derived = deriveCacheInfluenceManifestEntry({
    authored,
    influences,
    root: requiredText(ownData(value, 'root', 'cache influence entry'), 'cache influence root'),
    surface: cacheInfluenceSurface(ownData(value, 'surface', 'cache influence entry')),
  });
  const suppliedVary = stringArray(ownData(value, 'vary', 'cache influence entry'), 'Vary');
  const suppliedReasons = stringArray(
    ownData(value, 'closedReasons', 'cache influence entry'),
    'closed reasons',
  );
  const suppliedVerdict = ownData(value, 'verdict', 'cache influence entry');
  if (securityJsonStringify(axesValue) !== securityJsonStringify(derived.axes)) {
    throw new TypeError(`Cache influence ${derived.root} axes are not canonical.`);
  }
  if (jsonArrayKey(suppliedVary) !== jsonArrayKey(derived.vary)) {
    throw new TypeError(`Cache influence ${derived.root} Vary does not match request-header axes.`);
  }
  if (jsonArrayKey(suppliedReasons) !== jsonArrayKey(derived.closedReasons)) {
    throw new TypeError(`Cache influence ${derived.root} closed reasons do not match its axes.`);
  }
  if (suppliedVerdict !== derived.verdict) {
    throw new TypeError(`Cache influence ${derived.root} verdict does not match its axes.`);
  }
  return derived;
}

function axesToInfluences(axes: readonly unknown[]): CacheInfluenceDerivationInput['influences'] {
  const result: {
    authorization?: true;
    cookie?: true;
    externalDataVersions?: CacheInfluenceExternalDataVersionInput[];
    frameworkState?: true;
    principal?: true;
    requestHeaders?: string[];
    secret?: true;
    session?: true;
    unclassified?: string[];
    urlPath?: true;
    urlSearch?: true;
  } = {};
  const headers: string[] = [];
  const versions: CacheInfluenceExternalDataVersionInput[] = [];
  for (let index = 0; index < axes.length; index += 1) {
    const axis = ownArrayValue(axes, index, 'cache influence axes');
    if (axis === null || typeof axis !== 'object') throw new TypeError('Cache influence axes must be objects.');
    const kind = ownData(axis, 'kind', 'cache influence axis');
    switch (kind) {
      case 'url-path':
        result.urlPath = true;
        break;
      case 'url-search':
        result.urlSearch = true;
        break;
      case 'request-header':
        insertUniqueString(headers, requiredHeader(ownData(axis, 'name', 'request-header axis')));
        break;
      case 'external-data-version': {
        const key = optionalOwnData(axis, 'key', 'external data version axis');
        securityArrayAppend(versions, {
          ...(key === undefined ? {} : { key: snapshotKeyContribution(key) }),
          name: requiredText(ownData(axis, 'name', 'external data version axis'), 'version name'),
        });
        break;
      }
      case 'framework-state':
        result.frameworkState = true;
        break;
      case 'authorization':
      case 'cookie':
      case 'principal':
      case 'secret':
      case 'session':
        result[kind] = true;
        break;
      case 'unclassified':
        result.unclassified = ['serialized unclassified influence'];
        break;
      default:
        throw new TypeError('Unknown cache influence axis.');
    }
  }
  if (headers.length > 0) result.requestHeaders = headers;
  if (versions.length > 0) result.externalDataVersions = versions;
  return result;
}

function snapshotAuthoredIntent(value: CacheInfluenceAuthoredIntent): CacheInfluenceAuthoredIntent {
  if (value === null || typeof value !== 'object') throw new TypeError('Cache authored intent must be an object.');
  const posture = ownData(value, 'posture', 'cache authored intent');
  if (posture !== 'public' && posture !== 'non-public') {
    throw new TypeError('Cache authored posture must be public or non-public.');
  }
  const cacheControlValue = optionalOwnData(value, 'cacheControl', 'cache authored intent');
  const cacheControl =
    cacheControlValue === undefined
      ? undefined
      : requiredText(cacheControlValue, 'authored Cache-Control');
  const escapeValue = optionalOwnData(value, 'auditedEscape', 'cache authored intent');
  const auditedEscape = escapeValue === undefined ? undefined : snapshotAuditedEscape(escapeValue);
  return freezeSecurityValue({
    ...(auditedEscape === undefined ? {} : { auditedEscape }),
    ...(cacheControl === undefined ? {} : { cacheControl }),
    posture,
  });
}

function snapshotAuditedEscape(value: unknown): CacheInfluenceAuditedEscape {
  if (value === null || typeof value !== 'object') throw new TypeError('Cache audited escape must be an object.');
  return freezeSecurityValue({
    name: requiredText(ownData(value, 'name', 'cache audited escape'), 'escape name'),
    retainedObligation: requiredText(
      ownData(value, 'retainedObligation', 'cache audited escape'),
      'retained obligation',
    ),
  });
}

function snapshotKeyContribution(value: unknown): CacheInfluenceKeyContribution {
  if (value === null || typeof value !== 'object') throw new TypeError('Cache key contribution must be an object.');
  const axis = ownData(value, 'axis', 'cache key contribution');
  if (axis === 'url-path') return freezeSecurityValue({ axis });
  if (axis === 'url-search') {
    return freezeSecurityValue({
      axis,
      name: requiredText(ownData(value, 'name', 'URL-search key contribution'), 'search name'),
    });
  }
  if (axis === 'request-header') {
    return freezeSecurityValue({
      axis,
      name: requiredHeader(ownData(value, 'name', 'request-header key contribution')),
    });
  }
  throw new TypeError('Cache key contribution axis must be url-path, url-search, or request-header.');
}

function appendClosingAxis(
  influences: object,
  axes: CacheInfluenceAxis[],
  reasons: CacheInfluenceClosedReason[],
  kind: 'authorization' | 'cookie' | 'principal' | 'secret' | 'session',
  reason: CacheInfluenceClosedReason,
): void {
  if (!ownTrue(influences, kind)) return;
  securityArrayAppend(axes, freezeSecurityValue({ kind, role: 'shared-cache-closed' }));
  appendReason(reasons, reason);
}

function appendReason(
  reasons: CacheInfluenceClosedReason[],
  reason: CacheInfluenceClosedReason,
): void {
  for (let index = 0; index < reasons.length; index += 1) {
    if (reasons[index] === reason) return;
  }
  securityArrayAppend(reasons, reason);
}

function insertUniqueString(values: string[], value: string): void {
  let index = 0;
  while (index < values.length && values[index]! < value) index += 1;
  if (values[index] === value) return;
  securityArrayAppend(values, '');
  for (let move = values.length - 1; move > index; move -= 1) values[move] = values[move - 1]!;
  values[index] = value;
}

function normalizedHeaderName(value: string): string | undefined {
  const normalized = securityStringToLowerCase(securityStringTrim(value));
  return normalized !== '' && securityRegExpTest(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u, normalized)
    ? normalized
    : undefined;
}

function requiredHeader(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Cache request-header name must be a string.');
  const normalized = normalizedHeaderName(value);
  if (normalized === undefined) throw new TypeError('Cache request-header name must be an HTTP token.');
  return normalized;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || securityStringTrim(value) === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return securityStringTrim(value);
}

function cacheInfluenceSurface(value: unknown): CacheInfluenceSurface {
  if (value === 'document' || value === 'endpoint' || value === 'query') return value;
  throw new TypeError('Cache influence surface must be document, endpoint, or query.');
}

function ownRecord(value: object, key: string, label: string): object {
  const result = ownData(value, key, label);
  if (result === null || typeof result !== 'object') throw new TypeError(`${label}.${key} must be an object.`);
  return result;
}

function ownTrue(value: object, key: string): boolean {
  const result = optionalOwnData(value, key, 'cache influence facts');
  if (result === undefined) return false;
  if (result !== true) throw new TypeError(`Cache influence ${key} must be true when present.`);
  return true;
}

function optionalOwnArray(value: object, key: string, label: string): readonly unknown[] {
  const result = optionalOwnData(value, key, label);
  if (result === undefined) return [];
  if (!securityIsArray(result)) throw new TypeError(`${label} must be an array.`);
  return result;
}

function ownArrayValue(values: readonly unknown[], index: number, label: string): unknown {
  const result = securityOwnArrayEntry(values, index);
  if (!result.ok) throw new TypeError(`${label}[${index}] must be own data.`);
  return result.value;
}

function ownData(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be an own data property.`);
  }
  return descriptor.value;
}

function optionalOwnData(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label}.${String(key)} must be an own data property.`);
  return descriptor.value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!securityIsArray(value)) throw new TypeError(`Cache influence ${label} must be an array.`);
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = ownArrayValue(value, index, label);
    if (typeof entry !== 'string') throw new TypeError(`Cache influence ${label} entries must be strings.`);
    securityArrayAppend(result, entry);
  }
  return result;
}

function jsonArrayKey(values: readonly string[]): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) result += `${values[index]!.length}:${values[index]}`;
  return result;
}

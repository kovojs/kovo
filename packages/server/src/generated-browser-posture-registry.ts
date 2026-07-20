import {
  browserPostureManifestSchema,
  isBrowserSecurityOperationKind,
  type BrowserPostureCspDirective,
  type BrowserPostureExternalOrigin,
  type BrowserPostureIsolationBlocker,
  type BrowserPostureManifest,
  type BrowserPostureOpaqueExternalUrl,
} from '@kovojs/core/internal/security-operation-ir';

import { buildSecuritySourceLiteral } from './build-security-intrinsics.js';
import {
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
} from './security-witness-intrinsics.js';
import {
  securityNumberIsInteger,
  securityStringTrim,
  securityUrlSnapshot,
} from './response-security-intrinsics.js';

let registeredManifest: BrowserPostureManifest | undefined;
let registeredLiteral: string | undefined;

/** Register the compiler-owned browser posture before authored app modules evaluate. @internal */
export function registerGeneratedBrowserPostureManifest(
  manifest: BrowserPostureManifest,
): BrowserPostureManifest {
  const snapshot = snapshotBrowserPostureManifest(manifest);
  const literal = buildSecuritySourceLiteral(snapshot);
  if (registeredManifest !== undefined) {
    if (literal !== registeredLiteral) {
      throw new TypeError(
        'Generated browser-posture manifest is already registered for this boot.',
      );
    }
    return snapshot;
  }
  registeredManifest = snapshot;
  registeredLiteral = literal;
  return snapshot;
}

/** Exact compiler-derived browser posture registered for this supported app boot. @internal */
export function registeredGeneratedBrowserPostureManifest(): BrowserPostureManifest | undefined {
  return registeredManifest;
}

/** Reconstruct an immutable manifest from generated wire data. @internal */
export function snapshotBrowserPostureManifest(value: unknown): BrowserPostureManifest {
  const record = postureRecord(value, 'browser posture manifest');
  if (postureValue(record, 'schema', 'browser posture manifest') !== browserPostureManifestSchema) {
    throw new TypeError('Browser posture manifest has an unsupported schema.');
  }
  return witnessFreeze({
    externalOrigins: snapshotPostureArray(
      postureValue(record, 'externalOrigins', 'browser posture manifest'),
      'browser posture external origins',
      snapshotExternalOrigin,
    ),
    isolationBlockers: snapshotPostureArray(
      postureValue(record, 'isolationBlockers', 'browser posture manifest'),
      'browser posture isolation blockers',
      snapshotIsolationBlocker,
    ),
    opaqueExternalUrls: snapshotPostureArray(
      postureValue(record, 'opaqueExternalUrls', 'browser posture manifest'),
      'browser posture opaque external URLs',
      snapshotOpaqueExternalUrl,
    ),
    operations: snapshotPostureArray(
      postureValue(record, 'operations', 'browser posture manifest'),
      'browser posture operations',
      (operation) => {
        if (!isBrowserSecurityOperationKind(operation)) {
          throw new TypeError('Browser posture manifest contains an unknown operation kind.');
        }
        return operation;
      },
    ),
    schema: browserPostureManifestSchema,
  });
}

function snapshotExternalOrigin(value: unknown): BrowserPostureExternalOrigin {
  const record = postureRecord(value, 'browser posture external origin');
  const origin = postureString(
    postureValue(record, 'origin', 'browser posture external origin'),
    'browser posture external origin.origin',
  );
  let parsed: ReturnType<typeof securityUrlSnapshot>;
  try {
    parsed = securityUrlSnapshot(origin);
  } catch {
    throw new TypeError('Browser posture external origin must be one canonical HTTP(S) origin.');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
    throw new TypeError('Browser posture external origin must be one canonical HTTP(S) origin.');
  }
  return witnessFreeze({
    directive: postureDirective(
      postureValue(record, 'directive', 'browser posture external origin'),
    ),
    fileName: postureString(
      postureValue(record, 'fileName', 'browser posture external origin'),
      'browser posture external origin.fileName',
    ),
    origin,
    site: postureString(
      postureValue(record, 'site', 'browser posture external origin'),
      'browser posture external origin.site',
    ),
    span: snapshotSpan(
      postureValue(record, 'span', 'browser posture external origin'),
      'browser posture external origin.span',
    ),
  });
}

function snapshotOpaqueExternalUrl(value: unknown): BrowserPostureOpaqueExternalUrl {
  const record = postureRecord(value, 'browser posture opaque URL');
  return witnessFreeze({
    directive: postureDirective(postureValue(record, 'directive', 'browser posture opaque URL')),
    fileName: postureString(
      postureValue(record, 'fileName', 'browser posture opaque URL'),
      'browser posture opaque URL.fileName',
    ),
    reason: postureString(
      postureValue(record, 'reason', 'browser posture opaque URL'),
      'browser posture opaque URL.reason',
    ),
    site: postureString(
      postureValue(record, 'site', 'browser posture opaque URL'),
      'browser posture opaque URL.site',
    ),
    span: snapshotSpan(
      postureValue(record, 'span', 'browser posture opaque URL'),
      'browser posture opaque URL.span',
    ),
  });
}

function snapshotIsolationBlocker(value: unknown): BrowserPostureIsolationBlocker {
  const record = postureRecord(value, 'browser posture isolation blocker');
  const kind = postureValue(record, 'kind', 'browser posture isolation blocker');
  if (
    kind !== 'dynamic-fetch-or-worker' &&
    kind !== 'external-resource' &&
    kind !== 'frame' &&
    kind !== 'opaque-resource' &&
    kind !== 'popup'
  ) {
    throw new TypeError('Browser posture manifest contains an unknown isolation blocker.');
  }
  const span = postureValue(record, 'span', 'browser posture isolation blocker');
  return witnessFreeze({
    fileName: postureString(
      postureValue(record, 'fileName', 'browser posture isolation blocker'),
      'browser posture isolation blocker.fileName',
    ),
    kind,
    site: postureString(
      postureValue(record, 'site', 'browser posture isolation blocker'),
      'browser posture isolation blocker.site',
    ),
    ...(span === undefined
      ? {}
      : { span: snapshotSpan(span, 'browser posture isolation blocker.span') }),
  });
}

function snapshotSpan(
  value: unknown,
  label: string,
): { readonly end: number; readonly start: number } {
  const record = postureRecord(value, label);
  const start = postureValue(record, 'start', label);
  const end = postureValue(record, 'end', label);
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !securityNumberIsInteger(start) ||
    !securityNumberIsInteger(end) ||
    start < 0 ||
    end <= start ||
    end > 9_007_199_254_740_991
  ) {
    throw new TypeError(`${label} must be one finite non-empty source span.`);
  }
  return witnessFreeze({ end, start });
}

function postureDirective(value: unknown): BrowserPostureCspDirective {
  switch (value) {
    case 'connect-src':
    case 'font-src':
    case 'frame-src':
    case 'img-src':
    case 'media-src':
    case 'script-src':
    case 'style-src':
    case 'worker-src':
      return value;
    default:
      throw new TypeError('Browser posture manifest contains an unknown CSP directive.');
  }
}

function postureRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be an own-data record.`);
  }
  return value as Record<PropertyKey, unknown>;
}

function postureValue(
  record: Record<PropertyKey, unknown>,
  property: PropertyKey,
  label: string,
): unknown {
  const before = witnessGetOwnPropertyDescriptor(record, property);
  const after = witnessGetOwnPropertyDescriptor(record, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    if (before === undefined && after === undefined) return undefined;
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return before.value;
}

function postureString(value: unknown, label: string): string {
  if (typeof value !== 'string' || securityStringTrim(value) === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function snapshotPostureArray<Value>(
  value: unknown,
  label: string,
  snapshot: (entry: unknown) => Value,
): readonly Value[] {
  if (!witnessIsArray(value)) throw new TypeError(`${label} must be a dense array.`);
  const length = postureValue(value as unknown as Record<PropertyKey, unknown>, 'length', label);
  if (
    typeof length !== 'number' ||
    !securityNumberIsInteger(length) ||
    length < 0 ||
    length > 100_000
  ) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const result: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    witnessArrayAppend(
      result,
      snapshot(postureValue(value as unknown as Record<PropertyKey, unknown>, index, label)),
      label,
    );
  }
  return witnessFreeze(result);
}

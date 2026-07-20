import {
  browserSecurityOperationKinds,
  type BrowserPostureManifest,
  type BrowserSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import {
  registeredGeneratedBrowserPostureManifest,
  snapshotBrowserPostureManifest,
} from './generated-browser-posture-registry.js';
import { securityArrayJoin, securityArrayPush } from './response-security-intrinsics.js';
import { witnessCreateNullRecord, witnessFreeze } from './security-witness-intrinsics.js';

type PermissionPolicyFeature = 'camera' | 'geolocation' | 'microphone' | 'payment' | 'usb';

const permissionPolicyFeatures = witnessFreeze([
  'camera',
  'microphone',
  'geolocation',
  'payment',
  'usb',
] as const satisfies readonly PermissionPolicyFeature[]);

/**
 * One reviewed decision per compiler-owned browser operation kind. The `never` branch makes a new
 * kind a type error until its ambient browser-capability posture is decided (SPEC §6.6).
 */
function permissionsRequiredByOperation(
  kind: BrowserSecurityOperationKind,
): readonly PermissionPolicyFeature[] {
  switch (kind) {
    case 'browser.dialog.close':
    case 'browser.dialog.open':
    case 'browser.dom.focus':
    case 'browser.event.control':
    case 'browser.event.read':
    case 'browser.form.reset':
    case 'browser.form.submit':
    case 'browser.framework.call':
    case 'browser.state.read':
    case 'browser.state.write':
    case 'browser.timer.cancel':
    case 'browser.timer.schedule':
      return [];
    default: {
      const unsupported: never = kind;
      return unsupported;
    }
  }
}

/** Render the one Permissions-Policy decision table used by normal and reporting responses. */
export function renderBrowserPermissionsPolicy(
  reportingGroup?: string,
  manifest: BrowserPostureManifest | undefined = registeredGeneratedBrowserPostureManifest(),
): string {
  const closedManifest =
    manifest === undefined ? undefined : snapshotBrowserPostureManifest(manifest);
  const required = witnessCreateNullRecord<true>();
  const operations = closedManifest?.operations ?? browserSecurityOperationKinds;
  for (let index = 0; index < operations.length; index += 1) {
    const features = permissionsRequiredByOperation(operations[index]!);
    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      required[features[featureIndex]!] = true;
    }
  }

  const directives: string[] = [];
  for (let index = 0; index < permissionPolicyFeatures.length; index += 1) {
    const feature = permissionPolicyFeatures[index]!;
    if (required[feature] === true) continue;
    securityArrayPush(
      directives,
      reportingGroup === undefined ? `${feature}=()` : `${feature}=();report-to=${reportingGroup}`,
    );
  }
  return securityArrayJoin(directives, ', ');
}

export const DEFAULT_BROWSER_PERMISSIONS_POLICY = renderBrowserPermissionsPolicy();

/**
 * Derive the browser isolation/hardening response headers from the registered compiler manifest.
 * Cross-origin isolation is available only when the census proves there are no external assets,
 * opaque resources, dynamic browser calls, frames, or popups (SPEC §6.6).
 */
export function browserResponsePostureHeaders(
  options: {
    crossOriginIsolation?: true;
    /** Explicit compiler manifest for framework tests/gates; supported app paths use the registry. */
    manifest?: BrowserPostureManifest;
    reportingGroup?: string;
  } = {},
): Readonly<Record<string, string>> {
  const isolated = options.crossOriginIsolation === true;
  const manifest = options.manifest ?? registeredGeneratedBrowserPostureManifest();
  if (isolated) assertCrossOriginIsolationEligible(manifest);
  const headers = witnessCreateNullRecord<string>() as Record<string, string>;
  headers['Cross-Origin-Opener-Policy'] = isolated ? 'same-origin' : 'same-origin-allow-popups';
  if (isolated) {
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    headers['Cross-Origin-Resource-Policy'] = 'same-origin';
  }
  headers['Origin-Agent-Cluster'] = '?1';
  headers['Permissions-Policy'] = renderBrowserPermissionsPolicy(options.reportingGroup, manifest);
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
  headers['X-Frame-Options'] = 'DENY';
  return witnessFreeze(headers);
}

/** @internal Fail closed unless the exact generated manifest proves isolation eligibility. */
export function assertCrossOriginIsolationEligible(
  manifest: BrowserPostureManifest | undefined = registeredGeneratedBrowserPostureManifest(),
): asserts manifest is BrowserPostureManifest {
  if (manifest === undefined) {
    throw new TypeError(
      'crossOriginIsolation requires the compiler-derived browser posture manifest.',
    );
  }
  const closed = snapshotBrowserPostureManifest(manifest);
  if (closed.externalOrigins.length > 0) {
    const resource = closed.externalOrigins[0]!;
    throw new TypeError(
      `crossOriginIsolation is not closed: external-resource at ${resource.fileName} (${resource.site}).`,
    );
  }
  if (closed.opaqueExternalUrls.length > 0) {
    const resource = closed.opaqueExternalUrls[0]!;
    throw new TypeError(
      `crossOriginIsolation is not closed: opaque-resource at ${resource.fileName} (${resource.site}).`,
    );
  }
  for (let index = 0; index < closed.operations.length; index += 1) {
    if (closed.operations[index] === 'browser.framework.call') {
      throw new TypeError(
        'crossOriginIsolation is not closed: dynamic-fetch-or-worker at generated browser operation (browser.framework.call).',
      );
    }
  }
  if (closed.isolationBlockers.length > 0) {
    const blocker = closed.isolationBlockers[0]!;
    throw new TypeError(
      `crossOriginIsolation is not closed: ${blocker.kind} at ${blocker.fileName} (${blocker.site}).`,
    );
  }
}

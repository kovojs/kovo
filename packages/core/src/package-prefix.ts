import type { PackageComponentPrefixExplain } from './graph.js';
import {
  freezeSecurityValue,
  securityGetOwnPropertyDescriptor,
  securityIsArray,
  securityObjectIs,
} from './internal/security-witness-intrinsics.js';

/** @internal */
export interface PackageComponentPrefixManifestOptions {
  effectivePrefix?: string;
  requirePrefix?: boolean;
}

/** @internal */
export function packageComponentPrefixFactFromPackageManifest(
  manifest: unknown,
  options: PackageComponentPrefixManifestOptions = {},
): PackageComponentPrefixExplain | null {
  if (!isRecord(manifest)) return null;
  const name = ownDataValue(manifest, 'name');
  if (!name.present || typeof name.value !== 'string') return null;

  const kovoValue = ownDataValue(manifest, 'kovo');
  const kovo = kovoValue.present && isRecord(kovoValue.value) ? kovoValue.value : null;
  const requirePrefix = ownDataValue(options, 'requirePrefix');
  if (!kovo && requirePrefix.value !== true) return null;

  const prefixValue =
    kovo === null ? { present: false, value: undefined } : ownDataValue(kovo, 'prefix');
  const prefix =
    prefixValue.present && typeof prefixValue.value === 'string' ? prefixValue.value : null;
  const effectivePrefix = ownDataValue(options, 'effectivePrefix');
  return freezeSecurityValue({
    ...(effectivePrefix.present && typeof effectivePrefix.value === 'string'
      ? { effectivePrefix: effectivePrefix.value }
      : {}),
    packageName: name.value,
    prefix,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !securityIsArray(value);
}

function ownDataValue(
  value: object,
  property: PropertyKey,
): { readonly present: boolean; readonly value: unknown } {
  const before = securityGetOwnPropertyDescriptor(value, property);
  const after = securityGetOwnPropertyDescriptor(value, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !securityObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    return { present: false, value: undefined };
  }
  return { present: true, value: before.value };
}

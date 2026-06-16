import type { PackageComponentPrefixExplain } from './graph.js';

export interface PackageComponentPrefixManifestOptions {
  effectivePrefix?: string;
  requirePrefix?: boolean;
}

export function packageComponentPrefixFactFromPackageManifest(
  manifest: unknown,
  options: PackageComponentPrefixManifestOptions = {},
): PackageComponentPrefixExplain | null {
  if (!isRecord(manifest) || typeof manifest.name !== 'string') return null;

  const kovo = isRecord(manifest.kovo) ? manifest.kovo : null;
  if (!kovo && !options.requirePrefix) return null;

  const prefix = kovo && typeof kovo.prefix === 'string' ? kovo.prefix : null;
  return {
    ...(options.effectivePrefix === undefined ? {} : { effectivePrefix: options.effectivePrefix }),
    packageName: manifest.name,
    prefix,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

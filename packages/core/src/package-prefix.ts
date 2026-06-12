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

  const jiso = isRecord(manifest.jiso) ? manifest.jiso : null;
  if (!jiso && !options.requirePrefix) return null;

  const prefix = jiso && typeof jiso.prefix === 'string' ? jiso.prefix : null;
  return {
    ...(options.effectivePrefix === undefined ? {} : { effectivePrefix: options.effectivePrefix }),
    packageName: manifest.name,
    prefix,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

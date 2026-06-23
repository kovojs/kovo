import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';
import type { VersionedClientModuleRegistry } from './client-modules.js';

const registeredRuntimeHrefs = new WeakMap<VersionedClientModuleRegistry, string>();

/** @internal Register the framework-owned deferred loader runtime in the app's `/c/` registry. */
export function ensureKovoLoaderRuntimeClientModule(
  registry: VersionedClientModuleRegistry,
): string {
  const existing = registeredRuntimeHrefs.get(registry);
  if (existing !== undefined) return existing;

  const href = registry.put({
    path: kovoDeferredRuntimeModulePath,
    source: kovoDeferredRuntimeModuleSource,
    version: kovoDeferredRuntimeModuleVersion,
  });
  registeredRuntimeHrefs.set(registry, href);
  return href;
}

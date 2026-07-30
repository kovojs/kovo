import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
} from '@kovojs/browser/internal/inline-loader';
import { kovoDeferredAppRuntimeModuleSource } from '@kovojs/browser/internal/deferred-app-runtime';
import {
  kovoDeferredAppRuntimeModuleHref,
  kovoDeferredAppRuntimeModulePath,
} from '@kovojs/browser/internal/deferred-app-runtime-identity';
import {
  clientModulePath,
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import {
  registerMandatoryVersionedClientModule,
  type VersionedClientModuleInput,
  type VersionedClientModuleRegistry,
} from './client-modules.js';
import { securityStringIncludes } from './response-security-intrinsics.js';
import {
  witnessArrayAppend,
  createWitnessWeakMap,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const registeredRuntimeHrefs = createWitnessWeakMap<VersionedClientModuleRegistry, string>();
const GENERATED_APP_RUNTIME_PATH = '/c/generated/app.client.js';
const GENERATED_APP_RUNTIME_MARKER = '// @kovojs-generated-app-runtime/v1';
const GENERATED_APP_RUNTIME_INSTALLER = 'export function installKovoDeferredRuntime()';
const OPTIMISTIC_PLAN_EXPORT = 'export const kovoOptimisticMutationPlans = Object.freeze({';

/**
 * @internal Select the compiler-generated deferred app runtime when the active immutable registry
 * contains one; otherwise register the framework's static inline-loader runtime.
 *
 * SPEC §5.2/§9.1/§10.4: an active compiler-owned optimistic plan without its generated app runtime
 * would silently send the mutation without prediction/rebase support. Refuse that partial graph,
 * and refuse multiple canonical app runtimes, instead of selecting by iteration order.
 */
export function ensureKovoLoaderRuntimeClientModule(
  registry: VersionedClientModuleRegistry,
): string {
  const entries = registry.entries();
  const appRuntimes: VersionedClientModuleInput[] = [];
  const generatedRuntimes: VersionedClientModuleInput[] = [];
  let hasOptimisticPlans = false;
  for (let index = 0; index < entries.length; index += 1) {
    const module = entries[index]!;
    if (
      securityStringIncludes(module.source, OPTIMISTIC_PLAN_EXPORT) &&
      securityStringIncludes(module.source, '// @kovojs-ir')
    ) {
      hasOptimisticPlans = true;
    }
    if (clientModulePath(module.path) === GENERATED_APP_RUNTIME_PATH) {
      witnessArrayAppend(appRuntimes, module, 'Kovo generated app runtimes');
    }
    if (clientModulePath(module.path) === kovoDeferredAppRuntimeModulePath) {
      witnessArrayAppend(generatedRuntimes, module, 'Kovo generated deferred app runtimes');
    }
  }

  if (appRuntimes.length > 1) {
    throw new Error(
      'Kovo refused multiple active compiler-generated app runtimes at /c/generated/app.client.js.',
    );
  }
  const appRuntime = appRuntimes[0];
  if (appRuntime !== undefined) {
    if (
      !securityStringIncludes(appRuntime.source, GENERATED_APP_RUNTIME_MARKER) ||
      !securityStringIncludes(appRuntime.source, GENERATED_APP_RUNTIME_INSTALLER)
    ) {
      throw new Error(
        'Kovo refused a malformed compiler-generated app runtime at /c/generated/app.client.js.',
      );
    }
    if (!securityStringIncludes(appRuntime.source, kovoDeferredAppRuntimeModuleHref)) {
      throw new Error(
        'Kovo refused a malformed compiler-generated app runtime without its exact deferred-runtime import.',
      );
    }
    if (generatedRuntimes.length !== 1) {
      throw new Error(
        'Kovo refused a compiler-generated app runtime without exactly one active generated deferred runtime.',
      );
    }
    const generatedRuntime = generatedRuntimes[0]!;
    const generatedRuntimeHref = versionedClientModuleHref(
      generatedRuntime.path,
      clientModuleRepresentationDigest(generatedRuntime.source),
    );
    if (
      generatedRuntime.source !== kovoDeferredAppRuntimeModuleSource ||
      generatedRuntimeHref !== kovoDeferredAppRuntimeModuleHref
    ) {
      throw new TypeError(
        'Kovo generated app runtime identity does not match its active compiler snapshot.',
      );
    }
    return versionedClientModuleHref(
      appRuntime.path,
      clientModuleRepresentationDigest(appRuntime.source),
    );
  }
  if (hasOptimisticPlans) {
    throw new Error(
      'Kovo refused compiler-generated optimistic plans without /c/generated/app.client.js.',
    );
  }

  const existing = witnessWeakMapGet(registeredRuntimeHrefs, registry);
  if (existing !== undefined) return existing;

  const href = registerMandatoryVersionedClientModule(registry, {
    path: kovoDeferredRuntimeModulePath,
    source: kovoDeferredRuntimeModuleSource,
  });
  witnessWeakMapSet(registeredRuntimeHrefs, registry, href);
  return href;
}

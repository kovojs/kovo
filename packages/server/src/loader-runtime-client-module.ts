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
  compilerOwnedVersionedClientModuleRole,
  registerMandatoryVersionedClientModule,
  versionedClientModulePublishEpoch,
  type VersionedClientModuleInput,
  type VersionedClientModuleRegistry,
} from './client-modules.js';
import {
  witnessArrayAppend,
  createWitnessWeakMap,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const registeredRuntimeHrefs = createWitnessWeakMap<VersionedClientModuleRegistry, string>();

interface LoaderRuntimeHrefMemo {
  /** Publish-epoch token captured when `href` was last proven for this registry. */
  epoch: object;
  href: string;
}

/**
 * Per-registry memo over the full selection/validation pass below. The active set, compiler role
 * map, and render-plan fingerprint — everything the pass reads — are replaced only by a successful
 * active-snapshot publication, and every publication installs a fresh epoch token
 * (`versionedClientModulePublishEpoch`). An unchanged (registry, epoch) pair therefore proves the
 * pass would re-read byte-identical inputs and re-derive the identical href, so skipping it cannot
 * skip a validation outcome that could differ: any publication — including one that republishes
 * byte-identical modules under different compiler provenance roles — moves the epoch and forces
 * the complete pass, including the generated-runtime identity checks, to run again. Refusal paths
 * are never memoized; a refused registry re-runs and re-throws on every call (fail-closed).
 */
const loaderRuntimeHrefMemo = createWitnessWeakMap<
  VersionedClientModuleRegistry,
  LoaderRuntimeHrefMemo
>();
const GENERATED_APP_RUNTIME_PATH = '/c/generated/app.client.js';

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
  // Epoch first: this throws for poisoned/non-framework registries, so the memoized fast path
  // keeps the exact refusal behavior of the `registry.entries()` call it short-circuits.
  const epoch = versionedClientModulePublishEpoch(registry);
  const memoized = witnessWeakMapGet(loaderRuntimeHrefMemo, registry);
  if (memoized !== undefined && memoized.epoch === epoch) return memoized.href;

  const entries = registry.entries();
  const appRuntimes: VersionedClientModuleInput[] = [];
  const generatedRuntimes: VersionedClientModuleInput[] = [];
  let hasOptimisticPlans = false;
  for (let index = 0; index < entries.length; index += 1) {
    const module = entries[index]!;
    const role = compilerOwnedVersionedClientModuleRole(registry, module);
    const path = clientModulePath(module.path);
    if (role === 'optimistic-plan') hasOptimisticPlans = true;
    if (path === GENERATED_APP_RUNTIME_PATH && role !== 'app-bootstrap') {
      throw new Error(
        'Kovo refused an unproven compiler-generated app runtime at /c/generated/app.client.js.',
      );
    }
    if (path === kovoDeferredAppRuntimeModulePath && role !== 'deferred-app-runtime') {
      throw new Error('Kovo refused an unproven generated deferred app runtime.');
    }
    if (role === 'app-bootstrap') {
      witnessArrayAppend(appRuntimes, module, 'Kovo generated app runtimes');
    }
    if (role === 'deferred-app-runtime') {
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
    const appRuntimeHref = versionedClientModuleHref(
      appRuntime.path,
      clientModuleRepresentationDigest(appRuntime.source),
    );
    witnessWeakMapSet(loaderRuntimeHrefMemo, registry, { epoch, href: appRuntimeHref });
    return appRuntimeHref;
  }
  if (hasOptimisticPlans) {
    throw new Error(
      'Kovo refused compiler-generated optimistic plans without /c/generated/app.client.js.',
    );
  }

  const existing = witnessWeakMapGet(registeredRuntimeHrefs, registry);
  if (existing !== undefined) {
    // Mandatory registration is staging-only and does not move the publish epoch, so the memo
    // stored here also proves nothing publication-visible changed since this validation pass.
    witnessWeakMapSet(loaderRuntimeHrefMemo, registry, { epoch, href: existing });
    return existing;
  }

  const href = registerMandatoryVersionedClientModule(registry, {
    path: kovoDeferredRuntimeModulePath,
    source: kovoDeferredRuntimeModuleSource,
  });
  witnessWeakMapSet(registeredRuntimeHrefs, registry, href);
  witnessWeakMapSet(loaderRuntimeHrefMemo, registry, { epoch, href });
  return href;
}

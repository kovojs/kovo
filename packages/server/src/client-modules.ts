import {
  clientModulePath,
  parseVersionedClientModuleTarget,
  versionedClientModuleHref as sharedVersionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import {
  RENDER_PLAN_GRAMMAR_VERSION,
  computeRenderPlanFingerprint,
  type RenderPlanFingerprintInput,
} from '@kovojs/core/internal/render-plan-token';
import { clientModuleBuildTokenHash } from './client-module-registry-intrinsics.js';
import { reportServerError, type ServerErrorHandler } from './diagnostics.js';
import type { ServerResponseBase } from './response.js';
import {
  witnessArrayAppend,
  createWitnessMap,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessObjectIs,
  witnessReflectApply,
  witnessReflectGet,
  witnessSortStrings,
} from './security-witness-intrinsics.js';

// FN1 (plans/compiler-refactoring.md): the render-plan grammar version + fingerprint
// are the single source of truth in `@kovojs/core` so the compiler (KV416) and the
// server build token cannot drift (SPEC §5.2.1 rule 1). Re-exported here under the
// historical names so this module's public/internal surface is unchanged.
export {
  RENDER_PLAN_GRAMMAR_VERSION,
  computeRenderPlanFingerprint,
  type RenderPlanFingerprintInput,
};

/**
 * Source module registered into a {@link VersionedClientModuleRegistry} for
 * versioned browser delivery (SPEC §9.5). Apps that inject a custom registry via
 * `createApp({ clientModules })` name this when calling `put`.
 */
export interface VersionedClientModuleInput {
  contentType?: string;
  path: string;
  source: string;
  version: string;
}

/** @internal Response envelope produced by the server-owned client-module request path. */
export interface VersionedClientModuleResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  200 | 404
> {}

/**
 * Registry used by the server request shell to publish immutable versioned
 * client modules and resolve browser requests for them (SPEC §9.5). Apps inject
 * a custom implementation through `createApp({ clientModules })` and hold a
 * reference to register interactive modules (e.g. examples/gallery, crm,
 * stackoverflow, reference; site/src/client/modules.ts).
 */
export interface VersionedClientModuleRegistry {
  /**
   * A deterministic build-global token derived from the render-plan grammar
   * version, optional projected query-shape fingerprint, and the set of
   * registered client-module versions.  Always non-empty — even a module-less
   * app produces a token so the `<meta name="kovo-build">` stamp is always
   * present (SPEC §5.2.1 rule 1, SPEC §5.2.1 rule 2(b)).
   */
  buildToken(): string;
  /**
   * Return the registered immutable modules for build/static artifact emission.
   * Entries are normalized to same-origin `/c/` paths and sorted
   * deterministically by path + version.
   */
  entries(): readonly VersionedClientModuleInput[];
  put(module: VersionedClientModuleInput): string;
  resolve(href: string): ServerResponseBase<string, Record<string, string>, 200 | 404>;
  /**
   * Supply an opaque projected-query-shape fingerprint (computed by
   * {@link computeRenderPlanFingerprint}) so that `buildToken()` changes
   * whenever the query shape changes, even when no module versions changed
   * (SPEC §5.2.1 rule 1).  Optional: custom registry implementations that
   * already fold shape facts into their own token do not need to call this.
   */
  setRenderPlanFingerprint?(fingerprint: string): void;
}

/** Pin an injected registry's executable authority while preserving its mutable backing store. */
export function snapshotVersionedClientModuleRegistry(
  source: VersionedClientModuleRegistry,
): VersionedClientModuleRegistry {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('createApp clientModules must be a stable registry object.');
  }
  const buildToken = stableClientModuleRegistryMethod(source, 'buildToken')!;
  const entries = stableClientModuleRegistryMethod(source, 'entries')!;
  const put = stableClientModuleRegistryMethod(source, 'put')!;
  const resolve = stableClientModuleRegistryMethod(source, 'resolve')!;
  const setRenderPlanFingerprint = stableClientModuleRegistryMethod(
    source,
    'setRenderPlanFingerprint',
    true,
  );

  return witnessFreeze({
    buildToken() {
      return witnessReflectApply<string>(buildToken, source, []);
    },
    entries() {
      return witnessReflectApply<readonly VersionedClientModuleInput[]>(entries, source, []);
    },
    put(module: VersionedClientModuleInput) {
      return witnessReflectApply<string>(put, source, [module]);
    },
    resolve(href: string) {
      return witnessReflectApply<ReturnType<VersionedClientModuleRegistry['resolve']>>(
        resolve,
        source,
        [href],
      );
    },
    ...(setRenderPlanFingerprint === undefined
      ? {}
      : {
          setRenderPlanFingerprint(fingerprint: string) {
            witnessReflectApply(setRenderPlanFingerprint, source, [fingerprint]);
          },
        }),
  });
}

function stableClientModuleRegistryMethod(
  source: object,
  property: keyof VersionedClientModuleRegistry,
  optional = false,
): Function | undefined {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, property);
    const prototype = witnessGetPrototypeOf(owner);
    const after = witnessGetOwnPropertyDescriptor(owner, property);
    if (!sameClientModuleMethodDescriptor(before, after)) {
      throw new TypeError(`createApp clientModules.${property} changed while it was closed.`);
    }
    if (before !== undefined) {
      if (!('value' in before) || typeof before.value !== 'function') {
        throw new TypeError(`createApp clientModules.${property} must be a stable data method.`);
      }
      const observed = witnessReflectGet(source, property, source);
      if (!witnessObjectIs(observed, before.value)) {
        throw new TypeError(
          `createApp clientModules.${property} must resolve to its stable method.`,
        );
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(
        `createApp clientModules.${property} prototype changed while it was closed.`,
      );
    }
    owner = prototype;
  }
  if (optional) return undefined;
  throw new TypeError(`createApp clientModules requires a stable ${property} method.`);
}

function sameClientModuleMethodDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

/** @internal Request context accepted by the server-owned client-module request path. */
export interface VersionedClientModuleRequest {
  onError?: ServerErrorHandler;
  url?: string | null;
}

/**
 * Options for {@link createMemoryVersionedClientModuleRegistry} — the in-memory
 * versioned client-module registry (SPEC §9.5).
 */
export interface MemoryVersionedClientModuleRegistryOptions {
  /**
   * @deprecated SPEC §14 requires at least 24 hours of prior immutable
   * `/c/__v/...` module retention. Count-based immediate eviction cannot prove
   * that floor and is rejected with KV417.
   */
  maxVersionsPerPath?: number;
  /**
   * Initial projected-query-shape fingerprint (produced by
   * {@link computeRenderPlanFingerprint}).  Folded into `buildToken()` so the
   * token changes on a shape-only redeploy (SPEC §5.2.1 rule 1).  Can also be
   * set or updated at any time via `setRenderPlanFingerprint`.
   */
  renderPlanFingerprint?: string;
}

/** @internal Construct a version-stamped client-module href for framework request-shell output. */
export function versionedClientModuleHref(href: string, version: string): string {
  return sharedVersionedClientModuleHref(href, version);
}

/**
 * Create an in-memory registry of versioned client modules — the default store
 * `createApp` uses to serve hashed island/handler bundles to the browser, and
 * the registry apps construct to inject via `createApp({ clientModules })`
 * (SPEC §9.5).
 *
 * @param options - Optional registry configuration.
 * @returns A {@link VersionedClientModuleRegistry}.
 */
export function createMemoryVersionedClientModuleRegistry(
  options: MemoryVersionedClientModuleRegistryOptions = {},
): VersionedClientModuleRegistry {
  assertDeploySkewRetentionOptions(options);
  const modules = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const versionsByPath = createWitnessMap<string, string[]>();
  // Shape fingerprint threaded in from the build pipeline (SPEC §5.2.1 rule 1).
  let renderPlanFingerprint = optionalRegistryString(
    options.renderPlanFingerprint,
    'render-plan fingerprint',
  );
  // Cache: recompute whenever versionsByPath or renderPlanFingerprint changes.
  let cachedBuildToken: string | undefined;
  let buildTokenGeneration = 0;
  let lastTokenGeneration = -1;

  return {
    buildToken() {
      // Recompute only when the registry changed since the last call.
      if (cachedBuildToken !== undefined && lastTokenGeneration === buildTokenGeneration) {
        return cachedBuildToken;
      }
      // Derive a deterministic token:
      //   1. Always seed with RENDER_PLAN_GRAMMAR_VERSION so the token is never
      //      empty (DEPLOY-3) and so a grammar-only change moves the token
      //      (SPEC §5.2.1 rule 1).
      //   2. Fold in the optional projected-shape fingerprint if one was supplied.
      //   3. Fold in sorted "path@version" pairs (original module-hash input).
      const tokenEntries: string[] = [];
      witnessMapForEach(versionsByPath, (versions, path) => {
        for (let index = 0; index < versions.length; index += 1) {
          witnessArrayAppend(
            tokenEntries,
            `${path}@${versions[index]!}`,
            'Server packages/server/src/client-modules.ts collection',
          );
        }
      });
      witnessSortStrings(tokenEntries);
      const token = clientModuleBuildTokenHash(
        RENDER_PLAN_GRAMMAR_VERSION,
        renderPlanFingerprint,
        tokenEntries,
      );
      cachedBuildToken = token;
      lastTokenGeneration = buildTokenGeneration;
      return token;
    },
    setRenderPlanFingerprint(fingerprint: string) {
      renderPlanFingerprint = registryString(fingerprint, 'render-plan fingerprint');
      // Invalidate the cached token so the next buildToken() call recomputes.
      cachedBuildToken = undefined;
      buildTokenGeneration += 1;
    },
    entries() {
      const entries: VersionedClientModuleInput[] = [];
      witnessMapForEach(modules, (module) => {
        witnessArrayAppend(
          entries,
          cloneClientModule(module),
          'Server packages/server/src/client-modules.ts collection',
        );
      });
      sortClientModuleEntries(entries);
      return entries;
    },
    put(module) {
      const snapshot = snapshotClientModuleInput(module);
      const path = clientModulePath(snapshot.path);
      const href = versionedClientModuleHref(path, snapshot.version);
      const key = versionedClientModuleKey(path, snapshot.version);
      const stored = witnessFreeze({
        ...(snapshot.contentType === undefined ? {} : { contentType: snapshot.contentType }),
        path,
        source: snapshot.source,
        version: snapshot.version,
      });

      witnessMapSet(modules, key, stored);
      rememberClientModuleVersion(versionsByPath, path, snapshot.version);
      buildTokenGeneration += 1;

      return href;
    },
    resolve(href) {
      const target = parseVersionedClientModuleTarget(href);
      if (target === undefined) return missingClientModuleResponse();

      const module = witnessMapGet(modules, versionedClientModuleKey(target.path, target.version));
      if (!module) return missingClientModuleResponse();

      // SPEC §6.6: versioned emitted module URLs are immutable and retained across deploys.
      return {
        body: module.source,
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          // SPEC §6.6: immutable same-origin client modules are not a cross-origin
          // resource; CORP:same-origin blocks cross-origin embedding (Spectre/leak DiD).
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Content-Type': module.contentType ?? 'text/javascript; charset=utf-8',
        },
        status: 200,
      };
    },
  };
}

/** @internal Render a versioned client-module response for the framework request shell. */
export function renderVersionedClientModuleResponse(
  registry: VersionedClientModuleRegistry,
  request: string | VersionedClientModuleRequest,
): VersionedClientModuleResponse {
  const href = typeof request === 'string' ? request : request.url;
  if (!href) return missingClientModuleResponse();

  let target;
  try {
    target = parseVersionedClientModuleTarget(href);
    if (target === undefined) return missingClientModuleResponse();
  } catch (error) {
    if (typeof request !== 'string') {
      reportServerError(request.onError, error, {
        operation: 'client-module',
        url: href ?? undefined,
      });
    }
    return missingClientModuleResponse();
  }

  // Reconstruct a fixed canonical target from the one parsed path/version snapshot. The custom
  // registry never receives the caller-owned URL carrier after its classification (SPEC §6.6).
  return registry.resolve(sharedVersionedClientModuleHref(target.path, target.version));
}

function missingClientModuleResponse(): VersionedClientModuleResponse {
  return {
    body: 'Not Found',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 404,
  };
}

function versionedClientModuleKey(path: string, version: string): string {
  return `${path}\0${version}`;
}

function rememberClientModuleVersion(
  versionsByPath: Map<string, string[]>,
  path: string,
  version: string,
): void {
  const versions = witnessMapGet(versionsByPath, path) ?? [];
  let alreadyPresent = false;
  for (let index = 0; index < versions.length; index += 1) {
    if (versions[index] === version) {
      alreadyPresent = true;
      break;
    }
  }
  if (!alreadyPresent)
    witnessArrayAppend(
      versions,
      version,
      'Server packages/server/src/client-modules.ts collection',
    );
  witnessMapSet(versionsByPath, path, versions);
}

function snapshotClientModuleInput(module: VersionedClientModuleInput): VersionedClientModuleInput {
  if (typeof module !== 'object' || module === null) {
    throw new TypeError('Client module input must be an object.');
  }
  const path = registryString(module.path, 'path');
  const source = registryString(module.source, 'source');
  const version = registryString(module.version, 'version');
  if (version.length === 0) throw new TypeError('Client module version must not be empty.');
  const contentType = optionalRegistryString(module.contentType, 'content type');
  return witnessFreeze({
    ...(contentType === undefined ? {} : { contentType }),
    path,
    source,
    version,
  });
}

function cloneClientModule(
  module: Readonly<VersionedClientModuleInput>,
): VersionedClientModuleInput {
  return {
    ...(module.contentType === undefined ? {} : { contentType: module.contentType }),
    path: module.path,
    source: module.source,
    version: module.version,
  };
}

function sortClientModuleEntries(entries: VersionedClientModuleInput[]): void {
  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index]!;
    let insertAt = index;
    while (insertAt > 0 && compareClientModules(entry, entries[insertAt - 1]!) < 0) {
      entries[insertAt] = entries[insertAt - 1]!;
      insertAt -= 1;
    }
    entries[insertAt] = entry;
  }
}

function compareClientModules(
  left: VersionedClientModuleInput,
  right: VersionedClientModuleInput,
): number {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  if (left.version < right.version) return -1;
  if (left.version > right.version) return 1;
  return 0;
}

function registryString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`Client module ${name} must be a string.`);
  return value;
}

function optionalRegistryString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : registryString(value, name);
}

function assertDeploySkewRetentionOptions(
  options: MemoryVersionedClientModuleRegistryOptions,
): void {
  if (options.maxVersionsPerPath === undefined) return;

  throw new Error(
    'KV417: createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath }) cannot satisfy ' +
      'SPEC §14. The serving layer must retain prior immutable /c/__v/... modules and prior-token ' +
      '/_q reads for at least 24 hours; count-based immediate eviction is unsupported.',
  );
}

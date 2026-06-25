import { createHash } from 'node:crypto';
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
import { reportServerError, type ServerErrorHandler } from './diagnostics.js';
import type { ServerResponseBase } from './response.js';

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
  const modules = new Map<string, VersionedClientModuleInput>();
  const versionsByPath = new Map<string, string[]>();
  // Shape fingerprint threaded in from the build pipeline (SPEC §5.2.1 rule 1).
  let renderPlanFingerprint: string | undefined = options.renderPlanFingerprint;
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
      const entries: string[] = [];
      for (const [path, versions] of versionsByPath) {
        for (const version of versions) {
          entries.push(`${path}@${version}`);
        }
      }
      entries.sort();
      const hash = createHash('sha256');
      hash.update(RENDER_PLAN_GRAMMAR_VERSION);
      hash.update('\0');
      if (renderPlanFingerprint !== undefined) {
        hash.update(renderPlanFingerprint);
        hash.update('\0');
      }
      hash.update(entries.join('\n'));
      const token = hash.digest('hex').slice(0, 16);
      cachedBuildToken = token;
      lastTokenGeneration = buildTokenGeneration;
      return token;
    },
    setRenderPlanFingerprint(fingerprint: string) {
      renderPlanFingerprint = fingerprint;
      // Invalidate the cached token so the next buildToken() call recomputes.
      cachedBuildToken = undefined;
      buildTokenGeneration += 1;
    },
    entries() {
      return [...modules.values()]
        .map((module) => ({ ...module }))
        .sort((left, right) => {
          const pathOrder = left.path.localeCompare(right.path);
          return pathOrder === 0 ? left.version.localeCompare(right.version) : pathOrder;
        });
    },
    put(module) {
      const path = clientModulePath(module.path);
      const href = versionedClientModuleHref(path, module.version);
      const key = versionedClientModuleKey(path, module.version);

      modules.set(key, { ...module, path });
      rememberClientModuleVersion(versionsByPath, path, module.version);
      buildTokenGeneration += 1;

      return href;
    },
    resolve(href) {
      const target = parseVersionedClientModuleTarget(href);
      if (target === undefined) return missingClientModuleResponse();

      const module = modules.get(versionedClientModuleKey(target.path, target.version));
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

  let url: URL;
  try {
    url = new URL(href, 'https://kovo.local');
    clientModulePath(href);
  } catch (error) {
    if (typeof request !== 'string') {
      reportServerError(request.onError, error, {
        operation: 'client-module',
        url: href ?? undefined,
      });
    }
    return missingClientModuleResponse();
  }

  if (parseVersionedClientModuleTarget(href) === undefined) return missingClientModuleResponse();

  return registry.resolve(`${url.pathname}${url.search}${url.hash}`);
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
  const versions = versionsByPath.get(path) ?? [];
  if (!versions.includes(version)) versions.push(version);
  versionsByPath.set(path, versions);
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

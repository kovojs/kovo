import {
  canonicalClientModuleRepresentation,
  clientModulePath,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
  versionedClientModuleHref as sharedVersionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';
import {
  computeRenderPlanFingerprint,
  type RenderPlanFingerprintInput,
  RENDER_PLAN_GRAMMAR_VERSION,
} from '@kovojs/core/internal/render-plan-token';

import { clientModuleBuildTokenHash } from './client-module-registry-intrinsics.js';
import { reportServerError, type ServerErrorHandler } from './diagnostics.js';
import {
  securityStringCharCodeAt,
  securityStringStartsWith,
} from './response-security-intrinsics.js';
import type { ServerResponseBase } from './response.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessMapForEach,
  witnessMapGet,
  witnessMapHas,
  witnessMapSet,
  witnessObjectIs,
  witnessReflectApply,
  witnessReflectGet,
  witnessSortStrings,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

export {
  computeRenderPlanFingerprint,
  RENDER_PLAN_GRAMMAR_VERSION,
  type RenderPlanFingerprintInput,
};

const CLIENT_MODULE_CONTENT_TYPE = 'text/javascript; charset=utf-8';
const DEFAULT_RENDER_PLAN_FINGERPRINT = computeRenderPlanFingerprint({});
const nativeArrayIsArray = Array.isArray;

/** Source representation accepted by framework-owned client-module storage (SPEC §5.2.1/§14). */
export interface VersionedClientModuleInput {
  path: string;
  source: string;
}

/**
 * App/deployment storage contract. It stores representations and resolves retained history, but it
 * never supplies compatibility identity. `entries()` is the exact current active set, not resolver
 * history (SPEC §14).
 */
export interface VersionedClientModuleStore {
  entries(): readonly VersionedClientModuleInput[];
  put(module: VersionedClientModuleInput): string;
  resolve(href: string): ServerResponseBase<string, Record<string, string>, 200 | 404>;
}

/** Framework facade used by the request shell after closing an injected store. */
export interface VersionedClientModuleRegistry extends VersionedClientModuleStore {
  /** Frozen, eagerly derived app-build token. This call never hashes or mutates storage. */
  buildToken(): string;
}

/** @internal Response envelope produced by the server-owned client-module request path. */
export interface VersionedClientModuleResponse extends ServerResponseBase<
  string,
  Record<string, string>,
  200 | 404
> {}

/** @internal Request context accepted by the server-owned client-module request path. */
export interface VersionedClientModuleRequest {
  onError?: ServerErrorHandler;
  url?: string | null;
}

/** Options for the in-memory store. Count-based retention remains an explicit KV417 refusal. */
export interface MemoryVersionedClientModuleRegistryOptions {
  /** @deprecated Count-based eviction cannot prove SPEC §14's 24-hour restart/replica floor. */
  maxVersionsPerPath?: number;
}

interface RegistryControl {
  activeByHref: Map<string, Readonly<VersionedClientModuleInput>>;
  buildToken: string;
  renderPlanFingerprint: string;
  sealed: boolean;
  store: ClosedClientModuleStore;
}

interface ClosedClientModuleStore {
  entries: Function;
  put: Function;
  receiver: object;
  resolve: Function;
}

const registryControls = createWitnessWeakMap<VersionedClientModuleRegistry, RegistryControl>();

/**
 * Close an injected storage object behind framework-owned identity, active-manifest, and resolver
 * verification. Custom `buildToken` and render-fingerprint setters are deliberately neither read nor
 * reflected onto the facade.
 */
export function snapshotVersionedClientModuleRegistry(
  source: VersionedClientModuleStore,
): VersionedClientModuleRegistry {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('createApp clientModules must be a stable client-module store object.');
  }

  const existing = witnessWeakMapGet(
    registryControls,
    source as VersionedClientModuleRegistry,
  );
  if (existing !== undefined) return source as VersionedClientModuleRegistry;

  const store: ClosedClientModuleStore = {
    entries: stableClientModuleStoreMethod(source, 'entries'),
    put: stableClientModuleStoreMethod(source, 'put'),
    receiver: source,
    resolve: stableClientModuleStoreMethod(source, 'resolve'),
  };
  const activeByHref = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const initialEntries = witnessReflectApply<readonly VersionedClientModuleInput[]>(
    store.entries,
    store.receiver,
    [],
  );
  snapshotActiveEntries(initialEntries, activeByHref, 'clientModules.entries()');

  const control: RegistryControl = {
    activeByHref,
    buildToken: '',
    renderPlanFingerprint: DEFAULT_RENDER_PLAN_FINGERPRINT,
    sealed: false,
    store,
  };

  let facade!: VersionedClientModuleRegistry;
  facade = witnessFreeze({
    buildToken() {
      return control.buildToken;
    },
    entries() {
      return activeEntries(control);
    },
    put(module: VersionedClientModuleInput) {
      if (control.sealed) {
        throw new Error(
          'KV417: immutable client-module build snapshot is sealed; post-finalization mutation is forbidden.',
        );
      }
      const snapshot = snapshotClientModuleInput(module);
      const href = moduleHref(snapshot);
      const returnedHref = witnessReflectApply<string>(control.store.put, control.store.receiver, [
        snapshot,
      ]);
      if (returnedHref !== href) {
        throw new TypeError(
          `Client-module store returned ${String(returnedHref)} for framework-derived href ${href}.`,
        );
      }
      rememberActive(control.activeByHref, href, snapshot);
      refreshBuildToken(control);
      return href;
    },
    resolve(href: string) {
      return resolveVerifiedClientModule(control, href);
    },
  });
  refreshBuildToken(control);
  witnessWeakMapSet(registryControls, facade, control);
  return facade;
}

/**
 * @internal Replace the current active manifest atomically while retaining all previously stored
 * representations for resolver history. Development/HMR uses this operation; no graph digest is
 * introduced (SPEC §14).
 */
export function replaceVersionedClientModuleBuildSnapshot(
  registry: VersionedClientModuleRegistry,
  input: {
    modules: readonly VersionedClientModuleInput[];
    renderPlanFingerprint: string;
  },
): string {
  const control = registryControl(registry);
  if (control.sealed) {
    throw new Error('KV417: immutable client-module build snapshot is already sealed.');
  }
  const fingerprint = renderPlanFingerprint(input.renderPlanFingerprint);
  const next = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const modules = snapshotInputArray(input.modules, 'client-module build snapshot');
  for (let index = 0; index < modules.length; index += 1) {
    const module = snapshotClientModuleInput(modules[index]!);
    const href = moduleHref(module);
    const returnedHref = witnessReflectApply<string>(control.store.put, control.store.receiver, [
      module,
    ]);
    if (returnedHref !== href) {
      throw new TypeError(
        `Client-module store returned ${String(returnedHref)} for framework-derived href ${href}.`,
      );
    }
    rememberActive(next, href, module);
  }
  // Commit only after every entry was validated and stored. Resolver history may have grown on a
  // failed custom store, but the visible active snapshot and token remain unchanged.
  control.activeByHref = next;
  control.renderPlanFingerprint = fingerprint;
  refreshBuildToken(control);
  return control.buildToken;
}

/** @internal Seal one production build snapshot. Repeating the exact finalization is idempotent. */
export function finalizeVersionedClientModuleBuild(
  registry: VersionedClientModuleRegistry,
  renderPlanFingerprintValue: string = DEFAULT_RENDER_PLAN_FINGERPRINT,
): string {
  const control = registryControl(registry);
  const fingerprint = renderPlanFingerprint(renderPlanFingerprintValue);
  if (control.sealed) {
    if (control.renderPlanFingerprint !== fingerprint) {
      throw new Error('KV417: immutable client-module build snapshot was finalized twice differently.');
    }
    return control.buildToken;
  }
  control.renderPlanFingerprint = fingerprint;
  refreshBuildToken(control);
  control.sealed = true;
  return control.buildToken;
}

/** @internal Whether production finalization has frozen the manifest/token pair. */
export function isVersionedClientModuleBuildSealed(
  registry: VersionedClientModuleRegistry,
): boolean {
  return registryControl(registry).sealed;
}

/** @internal Construct an immutable client-module href from its full representation digest. */
export function versionedClientModuleHref(href: string, digest: string): string {
  return sharedVersionedClientModuleHref(href, digest);
}

/**
 * Create the default in-memory representation store. This store is useful in development and for
 * build assembly, but does not by itself prove SPEC §14 restart/replica retention.
 */
export function createMemoryVersionedClientModuleRegistry(
  options: MemoryVersionedClientModuleRegistryOptions = {},
): VersionedClientModuleStore {
  assertDeploySkewRetentionOptions(options);
  const retained = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const active = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();

  return witnessFreeze({
    entries() {
      return sortedEntries(active);
    },
    put(module: VersionedClientModuleInput) {
      const snapshot = snapshotClientModuleInput(module);
      const href = moduleHref(snapshot);
      const existing = witnessMapGet(retained, href);
      if (existing !== undefined && (existing.path !== snapshot.path || existing.source !== snapshot.source)) {
        throw new TypeError(
          'Kovo client-module store refused a conflicting overwrite of an immutable href.',
        );
      }
      witnessMapSet(retained, href, snapshot);
      witnessMapSet(active, href, snapshot);
      return href;
    },
    resolve(href: string) {
      const target = parseVersionedClientModuleTarget(href);
      if (target === undefined) return missingClientModuleResponse();
      const canonicalHref = sharedVersionedClientModuleHref(target.path, target.digest);
      const module = witnessMapGet(retained, canonicalHref);
      if (module === undefined) return missingClientModuleResponse();
      return verifiedClientModuleResponse(module.source, canonicalHref);
    },
  });
}

/** @internal Render a versioned client-module response for the framework request shell. */
export function renderVersionedClientModuleResponse(
  registry: VersionedClientModuleRegistry,
  request: string | VersionedClientModuleRequest,
): VersionedClientModuleResponse {
  const href = typeof request === 'string' ? request : request.url;
  if (!href) return missingClientModuleResponse();
  try {
    const target = parseVersionedClientModuleTarget(href);
    if (target === undefined) return missingClientModuleResponse();
    return registry.resolve(sharedVersionedClientModuleHref(target.path, target.digest));
  } catch (error) {
    if (typeof request !== 'string') {
      reportServerError(request.onError, error, { operation: 'client-module', url: href });
    }
    return missingClientModuleResponse();
  }
}

function registryControl(registry: VersionedClientModuleRegistry): RegistryControl {
  const control = witnessWeakMapGet(registryControls, registry);
  if (control === undefined) {
    throw new TypeError('Client-module registry is not a framework-closed facade.');
  }
  return control;
}

function stableClientModuleStoreMethod(
  source: object,
  property: keyof VersionedClientModuleStore,
): Function {
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
      if (!witnessObjectIs(witnessReflectGet(source, property, source), before.value)) {
        throw new TypeError(`createApp clientModules.${property} must resolve to its stable method.`);
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(`createApp clientModules.${property} prototype changed while it was closed.`);
    }
    owner = prototype;
  }
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

function snapshotActiveEntries(
  value: readonly VersionedClientModuleInput[],
  target: Map<string, Readonly<VersionedClientModuleInput>>,
  label: string,
): void {
  const entries = snapshotInputArray(value, label);
  for (let index = 0; index < entries.length; index += 1) {
    const module = snapshotClientModuleInput(entries[index]!);
    rememberActive(target, moduleHref(module), module);
  }
}

function snapshotInputArray(
  value: readonly VersionedClientModuleInput[],
  label: string,
): readonly VersionedClientModuleInput[] {
  if (!nativeArrayIsArray(value) || value.length > 100_000) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const result: VersionedClientModuleInput[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label}[${index}] must be stable own data.`);
    }
    witnessArrayAppend(result, descriptor.value as VersionedClientModuleInput, label);
  }
  return result;
}

function snapshotClientModuleInput(module: VersionedClientModuleInput): Readonly<VersionedClientModuleInput> {
  if (typeof module !== 'object' || module === null) {
    throw new TypeError('Client module input must be an object.');
  }
  const path = ownString(module, 'path');
  const source = canonicalClientModuleRepresentation(ownString(module, 'source'));
  const normalizedPath = clientModulePath(path);
  if (securityStringStartsWith(normalizedPath, '/c/__v/')) {
    throw new TypeError('Client module source path must be unversioned.');
  }
  return witnessFreeze({ path: normalizedPath, source });
}

function ownString(value: object, property: 'path' | 'source'): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError(`Client module ${property} must be a stable own string.`);
  }
  return descriptor.value;
}

function moduleHref(module: Readonly<VersionedClientModuleInput>): string {
  return sharedVersionedClientModuleHref(
    module.path,
    clientModuleRepresentationDigest(module.source),
  );
}

function rememberActive(
  target: Map<string, Readonly<VersionedClientModuleInput>>,
  href: string,
  module: Readonly<VersionedClientModuleInput>,
): void {
  const existing = witnessMapGet(target, href);
  if (existing !== undefined && (existing.path !== module.path || existing.source !== module.source)) {
    throw new TypeError('Kovo client-module active manifest contains a conflicting immutable href.');
  }
  witnessMapSet(target, href, module);
}

function refreshBuildToken(control: RegistryControl): void {
  const hrefs: string[] = [];
  witnessMapForEach(control.activeByHref, (_module, href) => {
    witnessArrayAppend(hrefs, href, 'client-module active hrefs');
  });
  witnessSortStrings(hrefs);
  control.buildToken = clientModuleBuildTokenHash(control.renderPlanFingerprint, hrefs);
}

function activeEntries(control: RegistryControl): readonly VersionedClientModuleInput[] {
  return sortedEntries(control.activeByHref);
}

function sortedEntries(
  source: Map<string, Readonly<VersionedClientModuleInput>>,
): readonly VersionedClientModuleInput[] {
  const byHref = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const hrefs: string[] = [];
  witnessMapForEach(source, (module, href) => {
    witnessMapSet(byHref, href, module);
    witnessArrayAppend(hrefs, href, 'client-module entry hrefs');
  });
  witnessSortStrings(hrefs);
  const entries: VersionedClientModuleInput[] = [];
  for (let index = 0; index < hrefs.length; index += 1) {
    const module = witnessMapGet(byHref, hrefs[index]!);
    if (module === undefined) throw new TypeError('Client-module entry snapshot changed.');
    witnessArrayAppend(entries, { path: module.path, source: module.source }, 'client-module entries');
  }
  return witnessFreeze(entries);
}

function resolveVerifiedClientModule(
  control: RegistryControl,
  href: string,
): VersionedClientModuleResponse {
  const target = parseVersionedClientModuleTarget(href);
  if (target === undefined) return missingClientModuleResponse();
  const canonicalHref = sharedVersionedClientModuleHref(target.path, target.digest);
  const response = witnessReflectApply<VersionedClientModuleResponse>(
    control.store.resolve,
    control.store.receiver,
    [canonicalHref],
  );
  if (response.status === 404) return missingClientModuleResponse();
  if (response.status !== 200 || typeof response.body !== 'string') {
    throw new TypeError('Client-module store returned an invalid response envelope.');
  }
  const contentType = responseHeader(response.headers, 'Content-Type');
  if (contentType !== CLIENT_MODULE_CONTENT_TYPE) {
    throw new TypeError('Client-module store returned non-canonical representation metadata.');
  }
  const canonicalBody = canonicalClientModuleRepresentation(response.body);
  if (canonicalBody !== response.body || clientModuleRepresentationDigest(canonicalBody) !== target.digest) {
    throw new TypeError('Client-module store returned bytes that do not match the sealed href.');
  }
  return verifiedClientModuleResponse(canonicalBody, canonicalHref);
}

function responseHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(headers, name);
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function verifiedClientModuleResponse(source: string, href: string): VersionedClientModuleResponse {
  const target = parseVersionedClientModuleTarget(href);
  if (target === undefined || clientModuleRepresentationDigest(source) !== target.digest) {
    throw new TypeError('Client-module representation does not match its immutable href.');
  }
  return {
    body: source,
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Type': CLIENT_MODULE_CONTENT_TYPE,
      'X-Content-Type-Options': 'nosniff',
    },
    status: 200,
  };
}

function missingClientModuleResponse(): VersionedClientModuleResponse {
  return {
    body: 'Not Found',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 404,
  };
}

function renderPlanFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !isLowerHexDigest(value)) {
    throw new TypeError('Render-plan fingerprint must be 64 lowercase hex characters.');
  }
  return value;
}

function isLowerHexDigest(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = securityStringCharCodeAt(value, index);
    if (!((code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x66))) return false;
  }
  return true;
}

function assertDeploySkewRetentionOptions(
  options: MemoryVersionedClientModuleRegistryOptions,
): void {
  if (options.maxVersionsPerPath === undefined) return;
  throw new Error(
    'KV417: createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath }) cannot satisfy ' +
      'SPEC §14. The serving layer must retain prior immutable /c/__v/... modules and prior-token ' +
      '/_q reads for at least 24 hours across restart and replicas.',
  );
}

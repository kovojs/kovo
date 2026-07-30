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
import { kovoDeferredAppRuntimeModulePath } from '@kovojs/browser/internal/deferred-app-runtime-identity';
import { types as nodeUtilTypes } from 'node:util';

import { clientModuleBuildTokenHash } from './client-module-registry-intrinsics.js';
import {
  compilerOwnedClientModuleRole,
  type CompilerOwnedViteClientModuleRole,
} from './compiler-client-module-provenance.js';
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
const GENERATED_APP_BOOTSTRAP_PATH = '/c/generated/app.client.js';
const nativeArrayIsArray = Array.isArray;
const nativeIsProxy = nodeUtilTypes.isProxy;

/** Source representation accepted by framework-owned client-module storage (SPEC §5.2.1/§14). */
export interface VersionedClientModuleInput {
  path: string;
  source: string;
}

/**
 * Durable exact active deployment snapshot stored by a client-module store (SPEC §5.2.1/§14).
 * The framework derives every href and the app-build token from these raw inputs.
 */
export interface VersionedClientModuleActiveSnapshot {
  modules: readonly VersionedClientModuleInput[];
  renderPlanFingerprint: string;
}

/**
 * App/deployment storage contract. Immutable representation retention and active-snapshot
 * publication are deliberately separate: `replaceActiveSnapshot()` MUST atomically replace the
 * durable exact active set, while `resolve()` continues to serve retained history for the §14 skew
 * window. The store never supplies an href, digest, or app-build token (SPEC §5.2.1/§14).
 */
export interface VersionedClientModuleStore {
  readActiveSnapshot(): VersionedClientModuleActiveSnapshot;
  replaceActiveSnapshot(snapshot: VersionedClientModuleActiveSnapshot): void;
  retain(module: VersionedClientModuleInput): void;
  resolve(href: string): ServerResponseBase<string, Record<string, string>, 200 | 404>;
}

/** Framework facade used by the request shell after closing an injected store. */
export interface VersionedClientModuleRegistry {
  /** Frozen, eagerly derived app-build token. This call never hashes or mutates storage. */
  buildToken(): string;
  /** Exact current active set; retained resolver history is excluded. */
  entries(): readonly VersionedClientModuleInput[];
  /** Stage a stable/manual module using a framework-derived immutable href. */
  put(module: VersionedClientModuleInput): string;
  /** Resolve and re-verify one immutable representation through the closed store. */
  resolve(href: string): ServerResponseBase<string, Record<string, string>, 200 | 404>;
}

/** @internal Current-process app-authored and framework-mandatory staging, excluding durable active history. */
export interface VersionedClientModuleStagingSnapshot {
  mandatory: readonly VersionedClientModuleInput[];
  stable: readonly VersionedClientModuleInput[];
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
  compilerRoleByHref: Map<string, CompilerOwnedViteClientModuleRole>;
  dirty: boolean;
  mandatoryByHref: Map<string, Readonly<VersionedClientModuleInput>>;
  poisoned: Error | undefined;
  renderPlanFingerprint: string;
  sealed: boolean;
  stableByHref: Map<string, Readonly<VersionedClientModuleInput>>;
  store: ClosedClientModuleStore;
}

interface ClosedClientModuleStore {
  readActiveSnapshot: Function;
  receiver: object;
  replaceActiveSnapshot: Function;
  retain: Function;
  resolve: Function;
}

const registryControls = createWitnessWeakMap<VersionedClientModuleRegistry, RegistryControl>();

/**
 * Close an injected storage object behind framework-owned identity, active-manifest, and resolver
 * verification. Custom `buildToken` and render-fingerprint setters are deliberately neither read nor
 * reflected onto the facade.
 */
export function snapshotVersionedClientModuleRegistry(
  source: VersionedClientModuleStore | VersionedClientModuleRegistry,
): VersionedClientModuleRegistry {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('createApp clientModules must be a stable client-module store object.');
  }

  const existing = witnessWeakMapGet(registryControls, source as VersionedClientModuleRegistry);
  if (existing !== undefined) return source as VersionedClientModuleRegistry;

  const store: ClosedClientModuleStore = {
    readActiveSnapshot: stableClientModuleStoreMethod(source, 'readActiveSnapshot'),
    receiver: source,
    replaceActiveSnapshot: stableClientModuleStoreMethod(source, 'replaceActiveSnapshot'),
    retain: stableClientModuleStoreMethod(source, 'retain'),
    resolve: stableClientModuleStoreMethod(source, 'resolve'),
  };
  const activeByHref = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const initialSnapshot = witnessReflectApply<VersionedClientModuleActiveSnapshot>(
    store.readActiveSnapshot,
    store.receiver,
    [],
  );
  const reconstructed = snapshotActiveSnapshot(
    initialSnapshot,
    'clientModules.readActiveSnapshot()',
  );
  snapshotActiveEntries(reconstructed.modules, activeByHref, 'clientModules active snapshot');

  const control: RegistryControl = {
    activeByHref,
    buildToken: '',
    // Durable source/manifest records deliberately do not authenticate compiler authority. A
    // genuine compiler snapshot must be republished in this process before generated roles exist.
    compilerRoleByHref: createWitnessMap<string, CompilerOwnedViteClientModuleRole>(),
    dirty: false,
    mandatoryByHref: createWitnessMap<string, Readonly<VersionedClientModuleInput>>(),
    poisoned: undefined,
    renderPlanFingerprint: reconstructed.renderPlanFingerprint,
    sealed: false,
    stableByHref: createWitnessMap<string, Readonly<VersionedClientModuleInput>>(),
    store,
  };

  let facade!: VersionedClientModuleRegistry;
  facade = witnessFreeze({
    buildToken() {
      assertRegistryControlUsable(control);
      return control.buildToken;
    },
    entries() {
      assertRegistryControlUsable(control);
      return activeEntries(control);
    },
    put(module: VersionedClientModuleInput) {
      assertRegistryControlUsable(control);
      if (control.sealed) {
        throw new Error(
          'KV417: immutable client-module build snapshot is sealed; post-finalization mutation is forbidden.',
        );
      }
      const snapshot = snapshotClientModuleInput(module);
      assertManualClientModulePath(snapshot.path);
      const href = moduleHref(snapshot);
      witnessReflectApply<void>(control.store.retain, control.store.receiver, [snapshot]);
      rememberActive(control.stableByHref, href, snapshot);
      control.dirty = true;
      return href;
    },
    resolve(href: string) {
      assertRegistryControlUsable(control);
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
  compilerModules?: readonly unknown[],
): string {
  const control = registryControl(registry);
  if (control.sealed) {
    throw new Error('KV417: immutable client-module build snapshot is already sealed.');
  }
  const fingerprint = renderPlanFingerprint(input.renderPlanFingerprint);
  const next = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  const modules = snapshotInputArray(input.modules, 'client-module build snapshot');
  const compilerRoleByHref = compilerClientModuleRoles(modules, compilerModules);
  for (let index = 0; index < modules.length; index += 1) {
    const module = snapshotClientModuleInput(modules[index]!);
    const href = moduleHref(module);
    rememberActive(next, href, module);
  }
  copyModuleMap(control.stableByHref, next);
  copyModuleMap(control.mandatoryByHref, next);
  publishActiveSnapshot(control, next, fingerprint, compilerRoleByHref);
  return control.buildToken;
}

/** @internal Seal one production build snapshot. Repeating the exact finalization is idempotent. */
export function finalizeVersionedClientModuleBuild(
  registry: VersionedClientModuleRegistry,
  renderPlanFingerprintValue?: string,
): string {
  const control = registryControl(registry);
  const fingerprint =
    renderPlanFingerprintValue === undefined
      ? control.renderPlanFingerprint
      : renderPlanFingerprint(renderPlanFingerprintValue);
  if (control.sealed) {
    if (control.renderPlanFingerprint !== fingerprint) {
      throw new Error(
        'KV417: immutable client-module build snapshot was finalized twice differently.',
      );
    }
    return control.buildToken;
  }
  if (control.dirty || control.renderPlanFingerprint !== fingerprint) {
    const next = cloneModuleMap(control.activeByHref);
    copyModuleMap(control.stableByHref, next);
    copyModuleMap(control.mandatoryByHref, next);
    publishActiveSnapshot(control, next, fingerprint);
  }
  control.sealed = true;
  return control.buildToken;
}

/** @internal Whether production finalization has frozen the manifest/token pair. */
export function isVersionedClientModuleBuildSealed(
  registry: VersionedClientModuleRegistry,
): boolean {
  return registryControl(registry).sealed;
}

/**
 * @internal Snapshot only modules republished by this process.
 *
 * Durable `activeByHref` may describe a previous deployment and cannot distinguish old compiler
 * output from manual modules after restart. Build orchestration uses this staging-only view to
 * construct the next exact active set without carrying stale deployment records forward.
 */
export function snapshotVersionedClientModuleStaging(
  registry: VersionedClientModuleRegistry,
): Readonly<VersionedClientModuleStagingSnapshot> {
  const control = registryControl(registry);
  return witnessFreeze({
    mandatory: sortedEntries(control.mandatoryByHref),
    stable: sortedEntries(control.stableByHref),
  });
}

/** @internal Return the server-private role proven for one exact active module representation. */
export function compilerOwnedVersionedClientModuleRole(
  registry: VersionedClientModuleRegistry,
  module: VersionedClientModuleInput,
): CompilerOwnedViteClientModuleRole | undefined {
  const control = registryControl(registry);
  const snapshot = snapshotClientModuleInput(module);
  return witnessMapGet(control.compilerRoleByHref, moduleHref(snapshot));
}

/**
 * @internal Stage one framework-mandatory module without publishing a partial compiler snapshot.
 * The next complete build replacement or production finalization includes it exactly once.
 */
export function registerMandatoryVersionedClientModule(
  registry: VersionedClientModuleRegistry,
  input: VersionedClientModuleInput,
): string {
  const control = registryControl(registry);
  if (control.sealed) {
    throw new Error('KV417: immutable client-module build snapshot is sealed.');
  }
  const module = snapshotClientModuleInput(input);
  const href = moduleHref(module);
  witnessReflectApply<void>(control.store.retain, control.store.receiver, [module]);
  rememberActive(control.mandatoryByHref, href, module);
  control.dirty = true;
  return href;
}

/** @internal Atomically publish staged stable/mandatory modules without sealing development. */
export function commitVersionedClientModuleStaging(
  registry: VersionedClientModuleRegistry,
): string {
  const control = registryControl(registry);
  if (!control.dirty) return control.buildToken;
  const next = cloneModuleMap(control.activeByHref);
  copyModuleMap(control.stableByHref, next);
  copyModuleMap(control.mandatoryByHref, next);
  publishActiveSnapshot(control, next, control.renderPlanFingerprint);
  return control.buildToken;
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
): VersionedClientModuleRegistry {
  return snapshotVersionedClientModuleRegistry(createMemoryVersionedClientModuleStore(options));
}

/** @internal Construct the raw in-memory store for restart/adapter contract tests. */
export function createMemoryVersionedClientModuleStore(
  options: MemoryVersionedClientModuleRegistryOptions = {},
): VersionedClientModuleStore {
  assertDeploySkewRetentionOptions(options);
  const retained = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  let active = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  let activeRenderPlanFingerprint = DEFAULT_RENDER_PLAN_FINGERPRINT;

  return witnessFreeze({
    readActiveSnapshot() {
      return witnessFreeze({
        modules: sortedEntries(active),
        renderPlanFingerprint: activeRenderPlanFingerprint,
      });
    },
    replaceActiveSnapshot(value: VersionedClientModuleActiveSnapshot) {
      const snapshot = snapshotActiveSnapshot(value, 'memory client-module active snapshot');
      const next = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
      snapshotActiveEntries(snapshot.modules, next, 'memory client-module active modules');
      // One pointer swap publishes the exact set; retained resolver history remains separate.
      active = next;
      activeRenderPlanFingerprint = snapshot.renderPlanFingerprint;
    },
    retain(module: VersionedClientModuleInput) {
      const snapshot = snapshotClientModuleInput(module);
      const href = moduleHref(snapshot);
      const existing = witnessMapGet(retained, href);
      if (
        existing !== undefined &&
        (existing.path !== snapshot.path || existing.source !== snapshot.source)
      ) {
        throw new TypeError(
          'Kovo client-module store refused a conflicting overwrite of an immutable href.',
        );
      }
      witnessMapSet(retained, href, snapshot);
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
  assertRegistryControlUsable(control);
  return control;
}

function assertRegistryControlUsable(control: RegistryControl): void {
  if (control.poisoned !== undefined) throw control.poisoned;
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

function snapshotActiveSnapshot(
  value: VersionedClientModuleActiveSnapshot,
  label: string,
): Readonly<VersionedClientModuleActiveSnapshot> {
  assertStableRecord(value, label);
  const modules = ownDataValue(value, 'modules', label);
  const fingerprint = ownDataValue(value, 'renderPlanFingerprint', label);
  if (!nativeArrayIsArray(modules)) {
    throw new TypeError(`${label}.modules must be a bounded dense array.`);
  }
  if (typeof fingerprint !== 'string') {
    throw new TypeError(`${label}.renderPlanFingerprint must be a string.`);
  }
  const sourceModules = snapshotInputArray(
    modules as readonly VersionedClientModuleInput[],
    `${label}.modules`,
  );
  const pinnedModules: Readonly<VersionedClientModuleInput>[] = [];
  for (let index = 0; index < sourceModules.length; index += 1) {
    witnessArrayAppend(
      pinnedModules,
      snapshotClientModuleInput(sourceModules[index]!),
      `${label}.modules`,
    );
  }
  return witnessFreeze({
    modules: witnessFreeze(pinnedModules),
    renderPlanFingerprint: renderPlanFingerprint(fingerprint),
  });
}

function assertStableRecord(value: unknown, label: string): asserts value is object {
  if (typeof value !== 'object' || value === null || nativeIsProxy(value)) {
    throw new TypeError(`${label} must be a non-Proxy object with stable own data.`);
  }
}

function ownDataValue(value: object, property: string, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${property} must be stable own data.`);
  }
  return descriptor.value;
}

function snapshotInputArray(
  value: readonly VersionedClientModuleInput[],
  label: string,
): readonly VersionedClientModuleInput[] {
  if (!nativeArrayIsArray(value) || nativeIsProxy(value) || value.length > 100_000) {
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

function snapshotClientModuleInput(
  module: VersionedClientModuleInput,
): Readonly<VersionedClientModuleInput> {
  assertStableRecord(module, 'Client module input');
  const path = ownString(module, 'path');
  const source = canonicalClientModuleRepresentation(ownString(module, 'source'));
  const normalizedPath = clientModulePath(path);
  if (securityStringStartsWith(normalizedPath, '/c/__v/')) {
    throw new TypeError('Client module source path must be unversioned.');
  }
  return witnessFreeze({ path: normalizedPath, source });
}

function assertManualClientModulePath(path: string): void {
  if (isCompilerReservedClientModulePath(path)) {
    throw new TypeError(`Kovo compiler-generated client-module path is reserved: ${path}.`);
  }
}

function isCompilerReservedClientModulePath(path: string): boolean {
  return (
    path === GENERATED_APP_BOOTSTRAP_PATH ||
    path === clientModulePath(kovoDeferredAppRuntimeModulePath)
  );
}

function compilerClientModuleRoles(
  modules: readonly VersionedClientModuleInput[],
  compilerModules: readonly unknown[] | undefined,
): Map<string, CompilerOwnedViteClientModuleRole> {
  const roles = createWitnessMap<string, CompilerOwnedViteClientModuleRole>();
  const proofs =
    compilerModules === undefined
      ? []
      : snapshotInputArray(
          compilerModules as readonly VersionedClientModuleInput[],
          'compiler client-module provenance',
        );
  if (compilerModules !== undefined && proofs.length !== modules.length) {
    throw new TypeError('Compiler client-module provenance must cover the exact build snapshot.');
  }
  for (let index = 0; index < modules.length; index += 1) {
    const module = snapshotClientModuleInput(modules[index]!);
    const proof = proofs[index];
    const role = proof === undefined ? undefined : compilerOwnedClientModuleRole(proof);
    if (role !== undefined && proof !== undefined) {
      const proven = snapshotClientModuleInput(proof);
      if (proven.path !== module.path || proven.source !== module.source) {
        throw new TypeError(
          'Compiler client-module provenance does not match the published representation.',
        );
      }
      assertCompilerClientModuleRolePath(role, module.path);
      witnessMapSet(roles, moduleHref(module), role);
      continue;
    }
    if (isCompilerReservedClientModulePath(module.path)) {
      throw new TypeError(
        `Kovo refused unproven compiler-generated client-module path: ${module.path}.`,
      );
    }
  }
  return roles;
}

function assertCompilerClientModuleRolePath(
  role: CompilerOwnedViteClientModuleRole,
  path: string,
): void {
  const expected =
    role === 'app-bootstrap'
      ? GENERATED_APP_BOOTSTRAP_PATH
      : role === 'deferred-app-runtime'
        ? clientModulePath(kovoDeferredAppRuntimeModulePath)
        : undefined;
  if (
    (expected !== undefined && path !== expected) ||
    (expected === undefined && isCompilerReservedClientModulePath(path))
  ) {
    throw new TypeError(`Compiler client-module role ${role} cannot publish ${path}.`);
  }
}

function ownString(value: object, property: 'path' | 'source'): string {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'string'
  ) {
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
  if (
    existing !== undefined &&
    (existing.path !== module.path || existing.source !== module.source)
  ) {
    throw new TypeError(
      'Kovo client-module active manifest contains a conflicting immutable href.',
    );
  }
  witnessMapSet(target, href, module);
}

function copyModuleMap(
  source: Map<string, Readonly<VersionedClientModuleInput>>,
  target: Map<string, Readonly<VersionedClientModuleInput>>,
): void {
  witnessMapForEach(source, (module, href) => {
    rememberActive(target, href, module);
  });
}

function cloneModuleMap(
  source: Map<string, Readonly<VersionedClientModuleInput>>,
): Map<string, Readonly<VersionedClientModuleInput>> {
  const clone = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
  copyModuleMap(source, clone);
  return clone;
}

function publishActiveSnapshot(
  control: RegistryControl,
  next: Map<string, Readonly<VersionedClientModuleInput>>,
  fingerprint: string,
  compilerRoleByHref = retainedCompilerRoles(control, next),
): void {
  const modules = sortedEntries(next);
  // Retention can grow before publication, but no active set/token changes unless every retain and
  // the store's one atomic replacement succeed (SPEC §5.2.1/§14).
  for (let index = 0; index < modules.length; index += 1) {
    witnessReflectApply<void>(control.store.retain, control.store.receiver, [modules[index]!]);
  }
  const durableSnapshot = witnessFreeze({
    modules,
    renderPlanFingerprint: fingerprint,
  });
  try {
    witnessReflectApply<void>(control.store.replaceActiveSnapshot, control.store.receiver, [
      durableSnapshot,
    ]);
    const observed = snapshotActiveSnapshot(
      witnessReflectApply<VersionedClientModuleActiveSnapshot>(
        control.store.readActiveSnapshot,
        control.store.receiver,
        [],
      ),
      'clientModules.readActiveSnapshot() after commit',
    );
    const observedByHref = createWitnessMap<string, Readonly<VersionedClientModuleInput>>();
    snapshotActiveEntries(
      observed.modules,
      observedByHref,
      'committed client-module active snapshot',
    );
    if (observed.renderPlanFingerprint !== fingerprint || !sameModuleMap(next, observedByHref)) {
      throw new TypeError('store readback differed from the committed exact snapshot');
    }
  } catch (cause) {
    const failure = new Error(
      'KV417: client-module active-snapshot publication became unverifiable; this registry is permanently closed.',
      { cause },
    );
    control.poisoned = failure;
    throw failure;
  }
  control.activeByHref = next;
  control.compilerRoleByHref = compilerRoleByHref;
  control.renderPlanFingerprint = fingerprint;
  control.dirty = false;
  refreshBuildToken(control);
}

function retainedCompilerRoles(
  control: RegistryControl,
  next: Map<string, Readonly<VersionedClientModuleInput>>,
): Map<string, CompilerOwnedViteClientModuleRole> {
  const retained = createWitnessMap<string, CompilerOwnedViteClientModuleRole>();
  witnessMapForEach(control.compilerRoleByHref, (role, href) => {
    if (witnessMapGet(next, href) !== undefined) witnessMapSet(retained, href, role);
  });
  return retained;
}

function sameModuleMap(
  left: Map<string, Readonly<VersionedClientModuleInput>>,
  right: Map<string, Readonly<VersionedClientModuleInput>>,
): boolean {
  let leftCount = 0;
  let matches = true;
  witnessMapForEach(left, (module, href) => {
    leftCount += 1;
    const candidate = witnessMapGet(right, href);
    if (
      candidate === undefined ||
      candidate.path !== module.path ||
      candidate.source !== module.source
    ) {
      matches = false;
    }
  });
  let rightCount = 0;
  witnessMapForEach(right, () => {
    rightCount += 1;
  });
  return matches && leftCount === rightCount;
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
    witnessArrayAppend(
      entries,
      witnessFreeze({ path: module.path, source: module.source }),
      'client-module entries',
    );
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
  assertStableRecord(response, 'Client-module store response');
  const status = ownDataValue(response, 'status', 'Client-module store response');
  const body = ownDataValue(response, 'body', 'Client-module store response');
  const headers = ownDataValue(response, 'headers', 'Client-module store response');
  if (status === 404) return missingClientModuleResponse();
  if (status !== 200 || typeof body !== 'string') {
    throw new TypeError('Client-module store returned an invalid response envelope.');
  }
  const contentType = responseHeader(headers, 'Content-Type');
  if (contentType !== CLIENT_MODULE_CONTENT_TYPE) {
    throw new TypeError('Client-module store returned non-canonical representation metadata.');
  }
  const canonicalBody = canonicalClientModuleRepresentation(body);
  if (canonicalBody !== body || clientModuleRepresentationDigest(canonicalBody) !== target.digest) {
    throw new TypeError('Client-module store returned bytes that do not match the sealed href.');
  }
  return verifiedClientModuleResponse(canonicalBody, canonicalHref);
}

function responseHeader(headers: unknown, name: string): string | undefined {
  if (typeof headers !== 'object' || headers === null || nativeIsProxy(headers)) return undefined;
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

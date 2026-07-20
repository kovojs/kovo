import {
  hasFrameworkPrincipalEpochStoreReceipt,
  propagateFrameworkPrincipalEpochStoreReceipt,
} from '@kovojs/core/internal/security-markers';

import { isProvenPrincipal } from './auth-principal.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessMapGet,
  witnessMapSet,
  witnessObjectIs,
  witnessReflectApply,
  witnessWeakSetAdd,
  witnessWeakSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

const NativeAbortController = AbortController;
const NativePromise = Promise;
const NativeTypeError = TypeError;
const nativeClearTimeout = clearTimeout;
const nativeSetTimeout = setTimeout;

/** Maximum time a request sink waits for authoritative revocation state before failing closed. */
export const PRINCIPAL_EPOCH_LOOKUP_TIMEOUT_MS = 1_000;

/** Persistent monotone state for one principal, independent of every session lifetime. */
export interface PrincipalEpochState {
  /** Monotone epoch. A credential minted at any other value is stale. */
  readonly epoch: number;
  /** Authoritative change time used to reject idempotency tokens minted before a privilege change. */
  readonly changedAtMs: number;
  /** Tombstoned principals never verify and cannot be reactivated by ordinary advancement. */
  readonly status: 'active' | 'tombstoned';
}

/** Closed reasons accepted by the principal-epoch invalidation door. */
export type PrincipalEpochAdvanceReason =
  | 'principal-created'
  | 'password-change'
  | 'role-change'
  | 'tenant-change'
  | 'admin-change'
  | 'provider-revocation'
  | 'manual-security-invalidation';

/** Closed reasons that permanently tombstone a principal identity. */
export type PrincipalEpochTombstoneReason = 'principal-deletion' | 'provider-deletion';

/** Cooperative lookup options. Stores should stop avoidable work when `signal` aborts. */
export interface PrincipalEpochLookupOptions {
  readonly signal: AbortSignal;
}

/**
 * Persistent per-principal revocation authority (SPEC §6.6/§10.3).
 *
 * `current()` is authoritative and side-effect free. `advance()` and `tombstone()` must update one
 * persistent monotone row atomically. Production accepts only a framework-authenticated durable
 * implementation; the memory constructor is deliberately development/test only.
 */
export interface PrincipalEpochStore {
  initialize(principal: string): Promise<PrincipalEpochState> | PrincipalEpochState;
  current(
    principal: string,
    options: PrincipalEpochLookupOptions,
  ): Promise<PrincipalEpochState | undefined> | PrincipalEpochState | undefined;
  advance(
    principal: string,
    reason: PrincipalEpochAdvanceReason,
  ): Promise<PrincipalEpochState> | PrincipalEpochState;
  tombstone(
    principal: string,
    reason: PrincipalEpochTombstoneReason,
  ): Promise<PrincipalEpochState> | PrincipalEpochState;
}

/** Authoritative lookup failed, timed out, returned no row, or returned malformed state. */
export class PrincipalEpochUnavailableError extends Error {
  constructor(message = 'Authoritative principal epoch state is unavailable.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrincipalEpochUnavailableError';
  }
}

/** The credential epoch no longer matches current persistent principal state. */
export class PrincipalEpochStaleError extends Error {
  constructor() {
    super('Credential principal epoch is stale or tombstoned.');
    this.name = 'PrincipalEpochStaleError';
  }
}

const memoryPrincipalEpochStores = createWitnessWeakSet<object>();
interface PrincipalEpochRequestTransitionReceipt {
  readonly current: PrincipalEpochState;
  readonly previousEpoch: number;
  readonly principal: string;
}
const requestTransitionReceipts = createWitnessWeakMap<
  object,
  PrincipalEpochRequestTransitionReceipt
>();

/** Volatile development/test store with the same monotone and tombstone semantics as production. */
export function createMemoryPrincipalEpochStore(
  options: { now?: () => number } = {},
): PrincipalEpochStore {
  const configuredNow = optionalStableOwnDataValue(options, 'now');
  if (configuredNow !== undefined && typeof configuredNow !== 'function') {
    throw new NativeTypeError('Principal epoch memory-store now must be a function.');
  }
  const now = configuredNow ?? Date.now;
  const states = createWitnessMap<string, PrincipalEpochState>();
  const store: PrincipalEpochStore = witnessFreeze({
    advance(principal, reason) {
      assertPrincipal(principal);
      assertAdvanceReason(reason);
      const previous = witnessMapGet(states, principal);
      const state = nextMemoryState(previous, currentClock(now), false);
      witnessMapSet(states, principal, state);
      return state;
    },
    current(principal, lookup) {
      assertPrincipal(principal);
      assertLookupOptions(lookup);
      if (lookup.signal.aborted) {
        throw new PrincipalEpochUnavailableError('Principal epoch lookup was aborted.');
      }
      return witnessMapGet(states, principal);
    },
    initialize(principal) {
      assertPrincipal(principal);
      const existing = witnessMapGet(states, principal);
      if (existing !== undefined) return existing;
      const state = nextMemoryState(undefined, currentClock(now), false);
      witnessMapSet(states, principal, state);
      return state;
    },
    tombstone(principal, reason) {
      assertPrincipal(principal);
      assertTombstoneReason(reason);
      const previous = witnessMapGet(states, principal);
      const state = nextMemoryState(previous, currentClock(now), true);
      witnessMapSet(states, principal, state);
      return state;
    },
  });
  witnessWeakSetAdd(memoryPrincipalEpochStores, store);
  return store;
}

/** @internal True only for the volatile development/test constructor and its snapshots. */
export function isMemoryPrincipalEpochStore(source: unknown): boolean {
  return (
    (typeof source === 'object' || typeof source === 'function') &&
    source !== null &&
    witnessWeakSetHas(memoryPrincipalEpochStores, source)
  );
}

/** @internal True only for a framework-authenticated persistent store and its snapshots. */
export function isDurablePrincipalEpochStore(source: unknown): boolean {
  return hasFrameworkPrincipalEpochStoreReceipt(source);
}

/** Pin the store receiver and exact own methods once at app/endpoint assembly. */
export function snapshotPrincipalEpochStore(source: unknown): PrincipalEpochStore {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new NativeTypeError('Principal epoch store must be a stable object.');
  }
  const current = stableOwnFunction(source, 'current');
  const initialize = stableOwnFunction(source, 'initialize');
  const advance = stableOwnFunction(source, 'advance');
  const tombstone = stableOwnFunction(source, 'tombstone');
  const snapshot: PrincipalEpochStore = witnessFreeze({
    advance(principal, reason) {
      return witnessReflectApply(advance, source, [principal, reason]);
    },
    current(principal, options) {
      return witnessReflectApply(current, source, [principal, options]);
    },
    initialize(principal) {
      return witnessReflectApply(initialize, source, [principal]);
    },
    tombstone(principal, reason) {
      return witnessReflectApply(tombstone, source, [principal, reason]);
    },
  });
  if (witnessWeakSetHas(memoryPrincipalEpochStores, source)) {
    witnessWeakSetAdd(memoryPrincipalEpochStores, snapshot);
  }
  propagateFrameworkPrincipalEpochStoreReceipt(source, snapshot);
  return snapshot;
}

/**
 * Identity-provider lifecycle door. Atomically creates epoch 1 for a newly authenticated principal
 * and otherwise returns the existing state without advancing it. A tombstone never reactivates.
 */
export async function initializePrincipalEpoch(
  store: PrincipalEpochStore,
  principal: string,
): Promise<PrincipalEpochState> {
  assertPrincipal(principal);
  try {
    const state = snapshotPrincipalEpochState(await store.initialize(principal));
    if (state.status !== 'active') throw new PrincipalEpochStaleError();
    return state;
  } catch (error) {
    if (error instanceof PrincipalEpochStaleError) throw error;
    throw new PrincipalEpochUnavailableError('Principal epoch initialization failed closed.', {
      cause: error,
    });
  }
}

/**
 * Read current persistent state with no positive application cache. Missing, malformed, rejected,
 * and over-budget lookups all fail closed. Thus maximum revocation staleness is zero successful
 * lookups (bounded only by this one lookup's 1-second availability budget).
 */
export async function currentPrincipalEpoch(
  store: PrincipalEpochStore,
  principal: string,
): Promise<PrincipalEpochState> {
  assertPrincipal(principal);
  const controller = new NativeAbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookup = NativePromise.resolve(
      store.current(principal, witnessFreeze({ signal: controller.signal })),
    );
    const timeout = new NativePromise<never>((_resolve, reject) => {
      timer = nativeSetTimeout(() => {
        controller.abort();
        reject(
          new PrincipalEpochUnavailableError(
            `Principal epoch lookup exceeded ${PRINCIPAL_EPOCH_LOOKUP_TIMEOUT_MS}ms.`,
          ),
        );
      }, PRINCIPAL_EPOCH_LOOKUP_TIMEOUT_MS);
    });
    const state = await NativePromise.race([lookup, timeout]);
    if (state === undefined) {
      throw new PrincipalEpochUnavailableError('Principal epoch state is missing.');
    }
    return snapshotPrincipalEpochState(state);
  } catch (error) {
    if (error instanceof PrincipalEpochUnavailableError) throw error;
    throw new PrincipalEpochUnavailableError('Principal epoch lookup failed closed.', {
      cause: error,
    });
  } finally {
    if (timer !== undefined) nativeClearTimeout(timer);
    controller.abort();
  }
}

/** Verify an embedded credential epoch against authoritative current state. */
export async function assertPrincipalEpochFresh(
  store: PrincipalEpochStore,
  principal: string,
  embeddedEpoch: number,
): Promise<PrincipalEpochState> {
  if (!Number.isSafeInteger(embeddedEpoch) || embeddedEpoch < 1) {
    throw new PrincipalEpochStaleError();
  }
  const state = await currentPrincipalEpoch(store, principal);
  if (state.status !== 'active' || state.epoch !== embeddedEpoch) {
    throw new PrincipalEpochStaleError();
  }
  return state;
}

/**
 * Settlement verifier for a privilege-changing mutation. Ordinary requests take the exact freshness
 * path; only the same framework-owned request carrier may consume its one expected old-to-new
 * transition so the response can settle under the now-unreachable old replay namespace.
 * @internal
 */
export async function assertPrincipalEpochFreshForRequest(
  store: PrincipalEpochStore,
  requestCarrier: unknown,
  principal: string,
  embeddedEpoch: number,
): Promise<PrincipalEpochState> {
  try {
    return await assertPrincipalEpochFresh(store, principal, embeddedEpoch);
  } catch (error) {
    if (!(error instanceof PrincipalEpochStaleError)) throw error;
  }
  if ((typeof requestCarrier !== 'object' && typeof requestCarrier !== 'function') || requestCarrier === null) {
    throw new PrincipalEpochStaleError();
  }
  const receipt = witnessWeakMapGet(requestTransitionReceipts, requestCarrier);
  if (
    receipt === undefined ||
    receipt.principal !== principal ||
    receipt.previousEpoch !== embeddedEpoch
  ) {
    throw new PrincipalEpochStaleError();
  }
  const current = await currentPrincipalEpoch(store, principal);
  if (
    current.epoch !== receipt.current.epoch ||
    current.changedAtMs !== receipt.current.changedAtMs ||
    current.status !== receipt.current.status
  ) {
    throw new PrincipalEpochStaleError();
  }
  return current;
}

/** @internal Apply one explicit mutation-registry privilege transition after handler success. */
export async function applyPrincipalEpochMutationTransition(
  store: PrincipalEpochStore | undefined,
  requestCarrier: unknown,
  declaration:
    | {
        readonly action: 'advance';
        readonly principal: Function;
        readonly reason: PrincipalEpochAdvanceReason;
      }
    | {
        readonly action: 'tombstone';
        readonly principal: Function;
        readonly reason: PrincipalEpochTombstoneReason;
      },
  input: unknown,
  lifecycleRequest: unknown,
): Promise<PrincipalEpochState> {
  if (store === undefined) {
    throw new PrincipalEpochUnavailableError(
      'A privilege-changing mutation requires the app principalEpochStore.',
    );
  }
  if ((typeof requestCarrier !== 'object' && typeof requestCarrier !== 'function') || requestCarrier === null) {
    throw new PrincipalEpochUnavailableError(
      'A privilege-changing mutation requires a stable request carrier.',
    );
  }
  const principal = witnessReflectApply<unknown>(declaration.principal, undefined, [
    input,
    lifecycleRequest,
  ]);
  assertPrincipal(principal);
  const previous = await currentPrincipalEpoch(store, principal);
  const current =
    declaration.action === 'advance'
      ? await advancePrincipalEpoch(store, principal, declaration.reason)
      : await tombstonePrincipalEpoch(store, principal, declaration.reason);
  if (current.epoch !== previous.epoch + 1 || current.changedAtMs <= previous.changedAtMs) {
    throw new PrincipalEpochUnavailableError(
      'Principal epoch transition did not own exactly one monotone step.',
    );
  }
  witnessWeakMapSet(
    requestTransitionReceipts,
    requestCarrier,
    witnessFreeze({ current, previousEpoch: previous.epoch, principal }),
  );
  return current;
}

/** Framework/provider/OOB invalidation door for password, role, tenant, admin, and revocation events. */
export async function advancePrincipalEpoch(
  store: PrincipalEpochStore,
  principal: string,
  reason: PrincipalEpochAdvanceReason,
): Promise<PrincipalEpochState> {
  assertPrincipal(principal);
  assertAdvanceReason(reason);
  try {
    return snapshotPrincipalEpochState(await store.advance(principal, reason));
  } catch (error) {
    throw new PrincipalEpochUnavailableError('Principal epoch advance failed closed.', {
      cause: error,
    });
  }
}

/** Permanent principal deletion door. Tombstoned identities never verify again. */
export async function tombstonePrincipalEpoch(
  store: PrincipalEpochStore,
  principal: string,
  reason: PrincipalEpochTombstoneReason,
): Promise<PrincipalEpochState> {
  assertPrincipal(principal);
  assertTombstoneReason(reason);
  try {
    const state = snapshotPrincipalEpochState(await store.tombstone(principal, reason));
    if (state.status !== 'tombstoned') {
      throw new PrincipalEpochUnavailableError('Principal epoch tombstone did not persist.');
    }
    return state;
  } catch (error) {
    if (error instanceof PrincipalEpochUnavailableError) throw error;
    throw new PrincipalEpochUnavailableError('Principal epoch tombstone failed closed.', {
      cause: error,
    });
  }
}

function nextMemoryState(
  previous: PrincipalEpochState | undefined,
  now: number,
  tombstone: boolean,
): PrincipalEpochState {
  const epoch = (previous?.epoch ?? 0) + 1;
  if (!Number.isSafeInteger(epoch)) {
    throw new PrincipalEpochUnavailableError('Principal epoch exhausted its integer range.');
  }
  return witnessFreeze({
    changedAtMs: previous === undefined ? now : Math.max(now, previous.changedAtMs + 1),
    epoch,
    status: tombstone || previous?.status === 'tombstoned' ? 'tombstoned' : 'active',
  });
}

function snapshotPrincipalEpochState(source: unknown): PrincipalEpochState {
  if (typeof source !== 'object' || source === null) {
    throw new PrincipalEpochUnavailableError('Principal epoch state must be a stable record.');
  }
  const epoch = stableOwnDataValue(source, 'epoch');
  const changedAtMs = stableOwnDataValue(source, 'changedAtMs');
  const status = stableOwnDataValue(source, 'status');
  if (
    !Number.isSafeInteger(epoch) ||
    (epoch as number) < 1 ||
    !Number.isSafeInteger(changedAtMs) ||
    (changedAtMs as number) < 0 ||
    (status !== 'active' && status !== 'tombstoned')
  ) {
    throw new PrincipalEpochUnavailableError('Principal epoch state is malformed.');
  }
  return witnessFreeze({
    changedAtMs: changedAtMs as number,
    epoch: epoch as number,
    status,
  });
}

function stableOwnFunction(source: object, property: PropertyKey): Function {
  const value = stableOwnDataValue(source, property);
  if (typeof value !== 'function') {
    throw new NativeTypeError(`Principal epoch store requires an own ${String(property)} method.`);
  }
  return value;
}

function stableOwnDataValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new NativeTypeError(
      `Principal epoch ${String(property)} must be a stable own data property.`,
    );
  }
  return before.value;
}

function optionalStableOwnDataValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new NativeTypeError(
      `Principal epoch ${String(property)} must be a stable own data property.`,
    );
  }
  return before.value;
}

function currentClock(now: Function): number {
  const value = witnessReflectApply<unknown>(now, undefined, []);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PrincipalEpochUnavailableError(
      'Principal epoch clock must return non-negative integer milliseconds.',
    );
  }
  return value;
}

function assertLookupOptions(options: unknown): asserts options is PrincipalEpochLookupOptions {
  if (typeof options !== 'object' || options === null) {
    throw new PrincipalEpochUnavailableError('Principal epoch lookup options are missing.');
  }
  const signal = stableOwnDataValue(options, 'signal');
  if (!(signal instanceof AbortSignal)) {
    throw new PrincipalEpochUnavailableError('Principal epoch lookup signal is invalid.');
  }
}

function assertPrincipal(principal: unknown): asserts principal is string {
  if (!isProvenPrincipal(principal) || principal.length > 1_024) {
    throw new NativeTypeError('Principal epoch operations require a bounded proven principal.');
  }
}

function assertAdvanceReason(reason: unknown): asserts reason is PrincipalEpochAdvanceReason {
  if (
    reason !== 'principal-created' &&
    reason !== 'password-change' &&
    reason !== 'role-change' &&
    reason !== 'tenant-change' &&
    reason !== 'admin-change' &&
    reason !== 'provider-revocation' &&
    reason !== 'manual-security-invalidation'
  ) {
    throw new NativeTypeError('Principal epoch advance reason is unsupported.');
  }
}

function assertTombstoneReason(reason: unknown): asserts reason is PrincipalEpochTombstoneReason {
  if (reason !== 'principal-deletion' && reason !== 'provider-deletion') {
    throw new NativeTypeError('Principal epoch tombstone reason is unsupported.');
  }
}

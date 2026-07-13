import { isUntrusted, revealUntrusted } from '@kovojs/core';

import {
  blessRedirectResponse,
  cloneResponseHeaders,
  isBlessedRedirectResponse,
  type FrameworkWireBody,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import { resolveCsrfReplayBinding, type CsrfOptions } from './csrf.js';
import { formLikeToRecord } from './schema.js';
import { requestFormDataEntries, requestIsFormData } from './request-body-intrinsics.js';
import {
  createWitnessMap,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessJsonStringifyPrimitive,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
  witnessReflectGet,
  witnessSortStrings,
} from './security-witness-intrinsics.js';
import {
  requestStateExactCompositeKey,
  requestStateIgnorePromiseRejection,
  requestStateIsSafeInteger,
  requestStateMax,
  requestStateNow,
  requestStatePromiseThen,
} from './request-state-intrinsics.js';

const NativeArrayBuffer = ArrayBuffer;
const NativeUint8Array = Uint8Array;
const nativeSubtleCrypto = globalThis.crypto.subtle;
const subtleCryptoPrototype = witnessGetPrototypeOf(nativeSubtleCrypto);
const nativeSubtleDigest =
  subtleCryptoPrototype === null
    ? undefined
    : witnessGetOwnPropertyDescriptor(subtleCryptoPrototype, 'digest')?.value;
if (typeof nativeSubtleDigest !== 'function') {
  throw new TypeError('Kovo replay upload digest controls are unavailable.');
}
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const subtleDigestControl = witnessReflectApply<Promise<ArrayBuffer>>(
  nativeSubtleDigest,
  nativeSubtleCrypto,
  ['SHA-256', new NativeUint8Array()],
).then((digest) => bytesToHex(new NativeUint8Array(digest)) === EMPTY_SHA256);

export type MutationReplayResponse = ServerResponseBase<
  FrameworkWireBody,
  ResponseHeaders,
  200 | 303 | 401 | 403 | 409 | 422 | 429 | 500
>;

/**
 * Idempotent mutation/webhook replay store contract (SPEC §9.1): look up a prior
 * response by `(scope, idem)`, reserve a pending slot for an in-flight handler, and
 * record the committed response. Apps inject a custom store via the public webhook
 * replay lifecycle (e.g. conformance/webhook-spike) and the framework provides
 * {@link createMemoryMutationReplayStore} as the default in-memory implementation.
 */
export interface MutationReplayStore<
  Response extends MutationReplayResponse = MutationReplayResponse,
> {
  get(scope: string, idem: string, fingerprint?: string): Promise<Response> | Response | undefined;
  reserve(
    scope: string,
    idem: string,
    fingerprint?: string,
  ): MutationReplayReservation<Response> | undefined;
  set(scope: string, idem: string, response: Response, fingerprint?: string): void;
}

/** Pin a custom mutation replay store's method/receiver authority at app assembly. */
export function snapshotMutationReplayStore<Response extends MutationReplayResponse>(
  source: MutationReplayStore<Response>,
): MutationReplayStore<Response> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('createApp mutationReplayStore must be a stable replay-store object.');
  }
  const get = stableMutationReplayMethod(source, 'get', true)!;
  const reserve = stableMutationReplayMethod(source, 'reserve', true)!;
  const set = stableMutationReplayMethod(source, 'set', true)!;
  return witnessFreeze({
    get(scope: string, idem: string, fingerprint?: string) {
      return witnessReflectApply(get, source, [scope, idem, fingerprint]);
    },
    reserve(scope: string, idem: string, fingerprint?: string) {
      const reservation = witnessReflectApply<unknown>(reserve, source, [scope, idem, fingerprint]);
      return reservation === undefined
        ? undefined
        : snapshotMutationReplayReservation<Response>(reservation);
    },
    set(scope: string, idem: string, response: Response, fingerprint?: string) {
      witnessReflectApply(set, source, [scope, idem, response, fingerprint]);
    },
  });
}

function snapshotMutationReplayReservation<Response extends MutationReplayResponse>(
  source: unknown,
): MutationReplayReservation<Response> {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError('Mutation replay reserve() must return a stable reservation object.');
  }
  const commit = stableMutationReplayMethod(source, 'commit', true)!;
  const abort = stableMutationReplayMethod(source, 'abort', false);
  return witnessFreeze({
    ...(abort === undefined
      ? {}
      : {
          abort() {
            witnessReflectApply(abort, source, []);
          },
        }),
    commit(response: Response) {
      witnessReflectApply(commit, source, [response]);
    },
  });
}

function stableMutationReplayMethod(
  source: object,
  property: PropertyKey,
  required: boolean,
): Function | undefined {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined) {
    if (!required) return undefined;
    throw new TypeError(`Mutation replay store requires an own ${String(property)} method.`);
  }
  if (!('value' in before) || typeof before.value !== 'function') {
    throw new TypeError(`Mutation replay store ${String(property)} must be an own data method.`);
  }
  const observed = witnessReflectGet(source, property, source);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    after === undefined ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    !witnessObjectIs(observed, before.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`Mutation replay store ${String(property)} must be stable.`);
  }
  return before.value;
}

/**
 * A pending reservation returned by {@link MutationReplayStore.reserve}: commit the
 * eventual response or abort to release the slot (SPEC §9.1). Part of the public
 * replay-store surface (recursive publicness, rules/api-surface.md).
 */
export interface MutationReplayReservation<
  Response extends MutationReplayResponse = MutationReplayResponse,
> {
  /**
   * Abandon the reservation without committing a result, releasing the pending
   * record so a corrected retry can run (e.g. after a non-replayable validation
   * failure). Optional for backward compatibility with stores predating
   * security finding M4; callers must tolerate its absence.
   */
  abort?(): void;
  commit(response: Response): void;
}

export interface MutationReplayContext<
  Response extends MutationReplayResponse = MutationReplayResponse,
> {
  fingerprint?: string;
  idem?: string;
  replayStore?: MutationReplayStore<Response>;
  scope: string | null;
}

export interface ReplayReservationStore<Response, Reservation> {
  get(
    scope: string,
    idem: string,
    fingerprint?: string,
  ): Promise<Response | undefined> | Response | undefined;
  reserve(scope: string, idem: string, fingerprint?: string): Reservation | undefined;
}

export type ReplayReservationResult<Response, Reservation> =
  | { kind: 'conflict' }
  | { kind: 'disabled' }
  | { kind: 'replayed'; response: Response }
  | { kind: 'reserved'; reservation: Reservation }
  | { kind: 'unavailable' };

export interface ReplayReservationRequest<Response, Reservation> {
  fingerprint?: string | undefined;
  idem?: string | undefined;
  scope: string | null;
  store?: ReplayReservationStore<Response, Reservation> | undefined;
}

export interface MutationReplayStoreOptions {
  /** Maximum number of settled responses retained independently from in-flight reservations. */
  maxEntries?: number;
  /**
   * E4 (SPEC §9.1:1073 atomic reservation; §9.5:914 pre-dispatch shed): a separate
   * bound on concurrent *in-flight pending* reservations, independent of `maxEntries`.
   * Part-2 A6 (SPEC §10.3:1063/1065) correctly stopped EVICTING pending slots to avoid
   * the M4 double-execute hazard, but that left pending reservations free to bypass
   * `maxEntries`; M7 additionally requires them to remain joined without TTL eviction until
   * explicit commit/abort. An authenticated attacker firing many
   * concurrent slow mutations with client-chosen `Kovo-Idem` values could accumulate
   * unbounded pending records. When the number of pending reservations is at this cap,
   * `reserve()` REFUSES a new reservation (callers fail closed) rather than EVICTING an
   * existing pending slot (which would re-open A6/M4).
   * Defaults to `maxEntries` so the documented A6 maxEntries-pressure behavior is unchanged.
   */
  maxPending?: number;
  /** Time-to-live for a committed response, measured from commit/set (pending work never expires). */
  ttlMs?: number;
}

type CsrfReplayScope<Request> =
  | false
  | Pick<CsrfOptions<Request>, 'anonymousCookie' | 'field' | 'sessionId'>;

/**
 * Build the default in-memory {@link MutationReplayStore} (SPEC §9.1): settled responses are
 * bounded by `maxEntries` with a post-commit `ttlMs`; in-flight work is independently bounded by
 * `maxPending` and never expires or gets evicted before commit/abort.
 */
export function createMemoryMutationReplayStore<
  Response extends MutationReplayResponse = MutationReplayResponse,
>(options: MutationReplayStoreOptions = {}): MutationReplayStore<Response> {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('createMemoryMutationReplayStore options must be an object.');
  }
  const configuredMaxEntries = stableMutationReplayOption(options, 'maxEntries');
  const configuredMaxPending = stableMutationReplayOption(options, 'maxPending');
  const configuredTtlMs = stableMutationReplayOption(options, 'ttlMs');
  const maxEntries = configuredMaxEntries ?? 1_000;
  // E4 (SPEC §9.1:1073/§9.5:914): bound in-flight pending reservations independently of
  // `maxEntries` to cap peak memory under a concurrent-flood DoS. The default is a generous
  // absolute bound (`max(maxEntries, 256)`) rather than `maxEntries` itself, so it never
  // throttles legitimate concurrency under a deliberately tiny `maxEntries` (e.g. the A6
  // maxEntries-pressure scenario, where several pending records must coexist under
  // `maxEntries:2`) while still bounding the default-config peak to `maxEntries` (1000).
  const maxPending = configuredMaxPending ?? requestStateMax(maxEntries, 256);
  const ttlMs = configuredTtlMs ?? 5 * 60_000;
  assertMutationReplayStoreOptions({ maxEntries, maxPending, ttlMs });
  const responses = createWitnessMap<string, MutationReplayRecord<Response>>();

  // SPEC §10.3 (M7): pending and committed state have independent bounds/lifetimes. Pending
  // reservations never expire or get capacity-evicted; maxPending keeps that state bounded.
  // Committed responses start ttlMs at commit/set and maxEntries bounds only settled truth.
  let pendingCount = 0;
  let committedCount = 0;

  function evictExpiredCommitted(): void {
    const now = requestStateNow();
    witnessMapForEach(responses, (record, key) => {
      if (record.kind === 'committed' && record.expiresAt <= now) {
        witnessMapDelete(responses, key);
        committedCount -= 1;
      }
    });
  }

  function evictCommittedOverCapacity(): void {
    while (committedCount > maxEntries) {
      let oldestCommitted: string | undefined;
      witnessMapForEach(responses, (record, key) => {
        if (oldestCommitted === undefined && record.kind === 'committed') {
          oldestCommitted = key;
        }
      });
      if (oldestCommitted === undefined) return;
      witnessMapDelete(responses, oldestCommitted);
      committedCount -= 1;
    }
  }

  return {
    get(scope, idem, fingerprint) {
      const key = mutationReplayKey(scope, idem);
      const record = witnessMapGet(responses, key);
      if (!record) return undefined;
      if (record.kind === 'committed' && record.expiresAt <= requestStateNow()) {
        witnessMapDelete(responses, key);
        committedCount -= 1;
        return undefined;
      }

      if (!fingerprintsMatch(record.fingerprint, fingerprint)) {
        throw new MutationReplayConflictError();
      }

      if (record.kind === 'pending') {
        return requestStatePromiseThen(record.pending, cloneMutationReplayResponse);
      }

      return cloneMutationReplayResponse(record.response);
    },
    reserve(scope, idem, fingerprint) {
      evictExpiredCommitted();
      const key = mutationReplayKey(scope, idem);
      const existing = witnessMapGet(responses, key);
      if (existing) {
        if (!fingerprintsMatch(existing.fingerprint, fingerprint)) {
          throw new MutationReplayConflictError();
        }
        return undefined;
      }

      // E4 (SPEC §9.1:1073 atomic reservation; §9.5:914 pre-dispatch shed): when pending
      // reservations are at `maxPending`, REFUSE a new one so callers can fail closed rather
      // than allocating without bound. Must REFUSE, never EVICT a pending slot — evicting one
      // re-opens the part-2 A6/M4 double-execute hazard.
      if (pendingCount >= maxPending) return undefined;

      let resolvePending: (response: Response) => void = () => undefined;
      let rejectPending: (reason?: unknown) => void = () => undefined;
      const pending = new Promise<Response>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      // Swallow rejections so an aborted reservation with no awaiter never raises
      // an unhandled-rejection warning; awaiting callers still observe the reject.
      requestStateIgnorePromiseRejection(pending);
      const generation = {};
      const record: MutationReplayRecord<Response> = {
        fingerprint,
        generation,
        kind: 'pending',
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      witnessMapSet(responses, key, record);
      pendingCount += 1;

      return {
        abort() {
          // Release only this reservation generation. A stale abort must not remove or reject
          // a newer committed/pending generation installed under the same key.
          const current = witnessMapGet(responses, key);
          if (
            current !== record ||
            current.kind !== 'pending' ||
            current.generation !== generation
          ) {
            return;
          }
          witnessMapDelete(responses, key);
          pendingCount -= 1;
          rejectPending(new MutationReplayAbortedError());
        },
        commit(response) {
          // Generation fence (M7): an aborted/superseded reservation has lost ownership of this
          // key and may never overwrite newer truth. `set()` resolves its waiters when it
          // supersedes a pending record, so a stale commit can safely become a no-op.
          const current = witnessMapGet(responses, key);
          if (
            current !== record ||
            current.kind !== 'pending' ||
            current.generation !== generation
          ) {
            return;
          }
          const cloned = cloneMutationReplayResponse(response);
          pendingCount -= 1;
          committedCount += 1;
          // Delete/reinsert so FIFO capacity order reflects commit time, not reservation time.
          witnessMapDelete(responses, key);
          witnessMapSet(responses, key, {
            expiresAt: requestStateNow() + ttlMs,
            fingerprint,
            kind: 'committed',
            response: cloned,
          });
          resolvePending(cloned);
          evictCommittedOverCapacity();
        },
      };
    },
    set(scope, idem, response, fingerprint) {
      evictExpiredCommitted();
      const key = mutationReplayKey(scope, idem);
      const existing = witnessMapGet(responses, key);
      if (existing && !fingerprintsMatch(existing.fingerprint, fingerprint)) {
        throw new MutationReplayConflictError();
      }
      const cloned = cloneMutationReplayResponse(response);
      if (existing?.kind === 'pending') {
        pendingCount -= 1;
        committedCount += 1;
      } else if (!existing) {
        committedCount += 1;
      }
      // Refresh insertion order/TTL for an existing committed record too.
      witnessMapDelete(responses, key);
      witnessMapSet(responses, key, {
        expiresAt: requestStateNow() + ttlMs,
        fingerprint,
        kind: 'committed',
        response: cloned,
      });
      if (existing?.kind === 'pending') existing.resolve(cloned);
      // Capacity eviction is committed-only. Pending records stay joined until their owner
      // explicitly commits/aborts; total state remains bounded by maxEntries + maxPending.
      evictCommittedOverCapacity();
    },
  };
}

function stableMutationReplayOption(
  source: MutationReplayStoreOptions,
  property: keyof MutationReplayStoreOptions,
): number | undefined {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if ((before === undefined) !== (after === undefined)) {
    throw new TypeError(`Mutation replay option ${property} must be stable own data.`);
  }
  if (before === undefined) return undefined;
  if (!('value' in before) || after === undefined || !('value' in after)) {
    throw new TypeError(`Mutation replay option ${property} must be an own data property.`);
  }
  if (!witnessObjectIs(before.value, after.value) || typeof before.value !== 'number') {
    throw new TypeError(`Mutation replay option ${property} must be stable numeric own data.`);
  }
  return before.value;
}

function assertMutationReplayStoreOptions(options: {
  maxEntries: number;
  maxPending: number;
  ttlMs: number;
}): void {
  if (!requestStateIsSafeInteger(options.maxEntries) || options.maxEntries < 0) {
    throw new TypeError(
      'createMemoryMutationReplayStore({ maxEntries }) must be a non-negative integer.',
    );
  }
  if (!requestStateIsSafeInteger(options.maxPending) || options.maxPending < 0) {
    throw new TypeError(
      'createMemoryMutationReplayStore({ maxPending }) must be a non-negative integer.',
    );
  }
  if (!requestStateIsSafeInteger(options.ttlMs) || options.ttlMs < 0) {
    throw new TypeError(
      'createMemoryMutationReplayStore({ ttlMs }) must be a non-negative integer.',
    );
  }
}

export async function mutationReplayContext<Request, Response extends MutationReplayResponse>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: {
    idem?: string;
    mutationKey?: string;
    replayStore?: MutationReplayStore<Response>;
    rawInput?: unknown;
    request: Request;
    requestFingerprint?: string;
  },
): Promise<MutationReplayContext<Response>> {
  const sessionScope = mutationReplayScope(csrf, wireRequest.request);
  return {
    ...(wireRequest.idem === undefined ? {} : { idem: wireRequest.idem }),
    ...(await replayFingerprint(csrf, wireRequest)),
    ...(wireRequest.replayStore === undefined ? {} : { replayStore: wireRequest.replayStore }),
    // Security finding M4: fold the mutation key into the replay scope so
    // idempotency is per-(session, mutation, idem). Without this, one mutation's
    // cached response/Set-Cookie could be replayed under a different mutation
    // that happened to share a session and Kovo-Idem.
    scope: composeMutationReplayScope(sessionScope, wireRequest.mutationKey),
  };
}

async function replayFingerprint<Request>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: { rawInput?: unknown; request: Request; requestFingerprint?: string },
): Promise<{ fingerprint?: string }> {
  if (wireRequest.rawInput === undefined) {
    return wireRequest.requestFingerprint === undefined
      ? {}
      : { fingerprint: wireRequest.requestFingerprint };
  }
  return {
    fingerprint: await canonicalRequestFingerprint(canonicalReplayInput(csrf, wireRequest)),
  };
}

function canonicalReplayInput<Request>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: { rawInput?: unknown; request: Request },
): unknown {
  if (csrf === false || wireRequest.rawInput === undefined) return wireRequest.rawInput;
  const csrfBinding = resolveCsrfReplayBinding(wireRequest.request, csrf);
  if (!csrfBinding) return wireRequest.rawInput;

  const field = csrf.field ?? 'kovo-csrf';
  if (isNativeFormData(wireRequest.rawInput)) {
    let found = false;
    const entries: Array<readonly [string, unknown]> = [];
    const rawEntries = snapshotFormDataEntries(wireRequest.rawInput);
    for (let index = 0; index < rawEntries.length; index += 1) {
      const entry = rawEntries[index]!;
      const name = entry[0];
      const value = entry[1];
      if (name === field) {
        found = true;
        appendReplayValue(entries, [name, `csrf-binding:${csrfBinding}`]);
      } else {
        // Request provenance wrappers are intentionally not coercible. Preserve each value as-is
        // in a module-private carrier; canonicalJson reveals it at the internal fingerprint choke.
        appendReplayValue(entries, [name, value]);
      }
    }
    return found ? new ReplayFormDataFingerprintInput(entries) : wireRequest.rawInput;
  }
  const record = formLikeToRecord(wireRequest.rawInput);
  const keys = witnessObjectKeys(record);
  const fields = snapshotReplayRecord(record, keys);
  let found = false;
  const normalized = {} as Record<string, unknown>;
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    const key = entry[0];
    if (key === field) found = true;
    witnessDefineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value: key === field ? `csrf-binding:${csrfBinding}` : entry[1],
      writable: true,
    });
  }
  return found ? normalized : wireRequest.rawInput;
}

function composeMutationReplayScope(
  sessionScope: string | null,
  mutationKey: string | undefined,
): string | null {
  if (sessionScope === null) return null;
  return mutationKey === undefined ? sessionScope : `${mutationKey}\0${sessionScope}`;
}

export async function readMutationReplay<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
): Promise<Response | undefined> {
  if (!replay.idem || !replay.scope) return undefined;
  try {
    const response = await replay.replayStore?.get(replay.scope, replay.idem, replay.fingerprint);
    return response === undefined ? undefined : cloneMutationReplayResponse(response);
  } catch (error) {
    // A pending record this read joined was aborted (e.g. the in-flight request
    // hit a non-replayable validation failure). Treat it as a miss so this
    // request runs the handler itself.
    if (error instanceof MutationReplayAbortedError) return undefined;
    if (error instanceof MutationReplayConflictError) throw error;
    throw error;
  }
}

/**
 * Reserve a pending replay record BEFORE the handler runs (mirrors the webhook
 * get→reserve→run order), so concurrent duplicates of the same
 * (session, mutation, idem) coalesce onto one execution instead of double-running
 * the handler (security finding M4). Returns either a `reservation` to commit the
 * result under, or a `replayed` response when another in-flight request already
 * holds the reservation (the reserve-returns-undefined race).
 */
export async function reserveMutationReplayBeforeRun<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
): Promise<
  | { kind: 'conflict' }
  | { kind: 'disabled' }
  | { kind: 'replayed'; response: Response }
  | { kind: 'reserved'; reservation: MutationReplayReservation<Response> }
  | { kind: 'unavailable' }
> {
  const result = await reserveReplayBeforeRun({
    fingerprint: replay.fingerprint,
    idem: replay.idem,
    scope: replay.scope,
    store: replay.replayStore,
  });
  return result.kind === 'replayed'
    ? { kind: 'replayed', response: cloneMutationReplayResponse(result.response) }
    : result;
}

/**
 * Shared SPEC §10.3 fail-closed replay reservation machine for mutation and webhook paths.
 * `reserve()` may return undefined for an already-pending durable row; callers must then await
 * the committed response, retry the atomic reservation, and fail closed if neither succeeds.
 */
export async function reserveReplayBeforeRun<Response, Reservation>(
  replay: ReplayReservationRequest<Response, Reservation>,
): Promise<ReplayReservationResult<Response, Reservation>> {
  if (replay.idem === undefined || replay.scope === null || replay.store === undefined) {
    return { kind: 'disabled' };
  }

  let reservation: Reservation | undefined;
  try {
    reservation = replay.store.reserve(replay.scope, replay.idem, replay.fingerprint);
  } catch (error) {
    if (error instanceof MutationReplayConflictError) return { kind: 'conflict' };
    throw error;
  }
  if (reservation) return { kind: 'reserved', reservation };

  // reserve() returned undefined: a concurrent request created the record between
  // our get() miss and this reserve(). Await the now-present pending entry rather
  // than re-running the handler. If that in-flight request aborts its reservation
  // (e.g. a validation failure), the pending promise rejects — fall back to
  // running ourselves rather than propagating the abort.
  try {
    const pending = await replay.store.get(replay.scope, replay.idem, replay.fingerprint);
    if (pending) return { kind: 'replayed', response: pending };
  } catch (error) {
    if (error instanceof MutationReplayConflictError) return { kind: 'conflict' };
    if (!(error instanceof MutationReplayAbortedError)) throw error;
  }

  // A6: The record vanished (expired/evicted/aborted) before we could read it.
  // Re-reserve so this request runs with a proper reservation rather than falling
  // through unprotected (which would re-open the M4 double-execute hazard).
  let retryReservation: Reservation | undefined;
  try {
    retryReservation = replay.store.reserve(replay.scope, replay.idem, replay.fingerprint);
  } catch (error) {
    if (error instanceof MutationReplayConflictError) return { kind: 'conflict' };
    throw error;
  }
  if (retryReservation) return { kind: 'reserved', reservation: retryReservation };

  // Another request snuck in again — await that one.
  try {
    const pending = await replay.store.get(replay.scope, replay.idem, replay.fingerprint);
    if (pending) return { kind: 'replayed', response: pending };
  } catch (error) {
    if (error instanceof MutationReplayConflictError) return { kind: 'conflict' };
    if (!(error instanceof MutationReplayAbortedError)) throw error;
  }

  // Still can't reserve. A bounded replay store is shedding distinct pending work (for
  // example maxPending saturation), so callers must fail closed instead of running the
  // mutation without the atomic replay reservation SPEC §10.3 requires.
  return { kind: 'unavailable' };
}

export class MutationReplayAbortedError extends Error {
  constructor() {
    super('Mutation replay reservation aborted before commit.');
    this.name = 'MutationReplayAbortedError';
  }
}

export class MutationReplayConflictError extends Error {
  constructor() {
    super('Mutation idempotency token was reused with a different request fingerprint.');
    this.name = 'MutationReplayConflictError';
  }
}

/**
 * Render under a reservation already created by `reserveMutationReplayBeforeRun`,
 * committing the result so duplicate in-flight requests resolve to it.
 */
export async function commitReservedMutationReplay<Response extends MutationReplayResponse>(
  reservation: MutationReplayReservation<Response> | undefined,
  render: () => Promise<Response>,
): Promise<Response> {
  const response = await render();
  reservation?.commit(response);
  return response;
}

type MutationReplayRecord<Response extends MutationReplayResponse> =
  | {
      expiresAt: number;
      fingerprint: string | undefined;
      kind: 'committed';
      response: Response;
    }
  | {
      fingerprint: string | undefined;
      generation: object;
      kind: 'pending';
      pending: Promise<Response>;
      // Explicit abort settles joined awaiters; capacity and TTL never evict pending records.
      reject(reason?: unknown): void;
      resolve(response: Response): void;
    };

function mutationReplayScope<Request>(
  csrf: CsrfReplayScope<Request>,
  request: Request,
): string | null {
  const csrfBinding = csrf === false ? undefined : resolveCsrfReplayBinding(request, csrf);
  if (csrfBinding) return csrfBinding;

  if (typeof request !== 'object' || request === null) return null;
  const sessionId = stableMutationReplayRequestValue(request, 'sessionId');
  if (typeof sessionId === 'string' && sessionId !== '') return sessionId;

  const session = stableMutationReplayRequestValue(request, 'session');
  if (typeof session === 'object' && session !== null) {
    const nestedSessionId = stableMutationReplayRequestValue(session, 'id', 'session.id');
    if (typeof nestedSessionId === 'string' && nestedSessionId !== '') return nestedSessionId;
  }

  return null;
}

function stableMutationReplayRequestValue(
  source: object,
  property: PropertyKey,
  label = String(property),
): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined && after === undefined) return undefined;
  if (before === undefined || after === undefined || !('value' in before) || !('value' in after)) {
    throw new TypeError(`Mutation replay request ${label} must be an own data property.`);
  }
  if (
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`Mutation replay request ${label} changed during validation.`);
  }
  return before.value;
}

function mutationReplayKey(scope: string, idem: string): string {
  return requestStateExactCompositeKey(scope, idem);
}

/**
 * Canonicalize a mutation request body into the stable fingerprint string used to detect
 * idempotency-key reuse-with-different-input (SPEC §9.1 {@link MutationReplayConflictError}).
 * The replay boundary computes from raw input after the lifecycle gates, so caller-provided
 * precomputed strings are never security authority. Rotating CSRF tokens are normalized to their
 * stable binding before canonicalization.
 *
 * M8 (bugz-26, SPEC §9.1/§10.3): upload fingerprints include a SHA-256 digest of immutable
 * `arrayBuffer()` bytes plus metadata. This boundary is asynchronous by necessity. FormData is
 * canonicalized as its ordered entry list rather than a record so field multiplicity and global
 * order remain part of the collision decision. Reading Blob/File bytes does not consume them, so
 * schema parsing and the handler still observe the original upload. Any read/digest failure rejects
 * before replay reservation or handler execution.
 */
export async function canonicalRequestFingerprint(value: unknown): Promise<string> {
  return canonicalJson(value);
}

async function canonicalJson(value: unknown): Promise<string> {
  // SPEC §5.2 rule 11 / §9.1: request provenance tags are author-time guardrails. The replay
  // fingerprint compares the validated wire value, so reveal wrappers at this internal choke
  // before structural canonicalization.
  if (isUntrusted(value)) {
    return canonicalJson(revealUntrusted(value, 'validated request-derived replay fingerprint'));
  }
  if (value instanceof ReplayFormDataFingerprintInput) {
    return canonicalFormDataEntries(value.entries);
  }
  if (isNativeFormData(value)) return canonicalFormDataEntries(snapshotFormDataEntries(value));
  if (isUploadLike(value)) return `upload:${await canonicalJson(await uploadFingerprint(value))}`;
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    const encoded = witnessJsonStringifyPrimitive(
      value as string | number | boolean | null | undefined,
    );
    if (encoded === undefined) {
      throw new MutationReplayFingerprintError(
        `Unsupported replay fingerprint value of type ${typeof value}.`,
      );
    }
    return encoded;
  }
  if (witnessIsArray(value)) {
    const entries = snapshotReplayArray(value);
    let result = '[';
    for (let index = 0; index < entries.length; index += 1) {
      if (index > 0) result += ',';
      result += await canonicalJson(entries[index]);
    }
    return `${result}]`;
  }
  const keys = witnessObjectKeys(value);
  witnessSortStrings(keys);
  const fields = snapshotReplayRecord(value, keys);
  let result = '{';
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (index > 0) result += ',';
    result += `${witnessJsonStringifyPrimitive(field[0])!}:${await canonicalJson(field[1])}`;
  }
  return `${result}}`;
}

function snapshotReplayArray(value: unknown[]): unknown[] {
  const length = witnessGetOwnPropertyDescriptor(value, 'length');
  if (length === undefined || !('value' in length) || typeof length.value !== 'number') {
    throw new MutationReplayFingerprintError(
      'Replay fingerprint arrays require a stable own length.',
    );
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor !== undefined && !('value' in descriptor)) {
      throw new MutationReplayFingerprintError(
        'Replay fingerprint arrays require stable own data entries.',
      );
    }
    appendReplayValue(entries, descriptor?.value);
  }
  return entries;
}

function snapshotReplayRecord(
  value: object,
  keys: readonly string[],
): Array<readonly [string, unknown]> {
  const fields: Array<readonly [string, unknown]> = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new MutationReplayFingerprintError(
        'Replay fingerprint records require stable own data properties.',
      );
    }
    appendReplayValue(fields, [key, descriptor.value]);
  }
  return fields;
}

function isNativeFormData(value: unknown): value is FormData {
  return requestIsFormData(value);
}

function snapshotFormDataEntries(value: FormData): Array<readonly [string, FormDataEntryValue]> {
  const entries: Array<readonly [string, FormDataEntryValue]> = [];
  const source = requestFormDataEntries(value);
  for (let index = 0; index < source.length; index += 1) {
    appendReplayValue(entries, source[index]!);
  }
  return entries;
}

function appendReplayValue<Value>(values: Value[], value: Value): void {
  witnessDefineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

class ReplayFormDataFingerprintInput {
  constructor(readonly entries: readonly (readonly [string, unknown])[]) {}
}

async function canonicalFormDataEntries(
  formEntries: readonly (readonly [string, unknown])[],
): Promise<string> {
  let result = 'formdata:[';
  for (let index = 0; index < formEntries.length; index += 1) {
    const formEntry = formEntries[index]!;
    const name = formEntry[0];
    const entry = formEntry[1];
    if (index > 0) result += ',';
    // Embed each child fingerprint as a JSON string so separators inside metadata or field names
    // cannot create an ambiguous chosen-prefix representation.
    result += `[${witnessJsonStringifyPrimitive(name)!},${witnessJsonStringifyPrimitive(
      await canonicalJson(entry),
    )!}]`;
  }
  return `${result}]`;
}

interface ReplayUploadLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: unknown;
  size: number;
  type?: unknown;
}

function isUploadLike(value: unknown): value is ReplayUploadLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    typeof (value as { size?: unknown }).size === 'number'
  );
}

async function uploadFingerprint(value: ReplayUploadLike): Promise<{
  __kovoUpload: true;
  digest: string;
  name: string | null;
  size: number;
  type: string | null;
}> {
  let bytes: ArrayBuffer;
  try {
    bytes = await value.arrayBuffer();
  } catch (error) {
    throw new MutationReplayFingerprintError(
      'Unable to read upload bytes for replay fingerprint.',
      {
        cause: error,
      },
    );
  }
  if (!(bytes instanceof NativeArrayBuffer) || bytes.byteLength !== value.size) {
    throw new MutationReplayFingerprintError(
      'Upload bytes did not match declared metadata while computing replay fingerprint.',
    );
  }

  let digest: ArrayBuffer;
  try {
    if (!(await subtleDigestControl)) {
      throw new TypeError('Replay upload digest controls failed their semantic check.');
    }
    digest = await witnessReflectApply<Promise<ArrayBuffer>>(
      nativeSubtleDigest,
      nativeSubtleCrypto,
      ['SHA-256', bytes],
    );
  } catch (error) {
    throw new MutationReplayFingerprintError(
      'Unable to digest upload bytes for replay fingerprint.',
      {
        cause: error,
      },
    );
  }

  return {
    __kovoUpload: true,
    digest: bytesToHex(new NativeUint8Array(digest)),
    name: typeof value.name === 'string' ? value.name : null,
    size: value.size,
    type: typeof value.type === 'string' ? value.type : null,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  const alphabet = '0123456789abcdef';
  let output = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    output += alphabet[byte >>> 4]! + alphabet[byte & 0x0f]!;
  }
  return output;
}

class MutationReplayFingerprintError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MutationReplayFingerprintError';
  }
}

function fingerprintsMatch(left: string | undefined, right: string | undefined): boolean {
  // Missing fingerprint state is not a compatibility wildcard: allowing `undefined` to match a
  // byte-sensitive fingerprint would silently replay pre-fix/under-specified records. Both sides
  // must carry the same posture and exact value (SPEC §10.3 integrity-fault contract).
  return left === right;
}

function cloneMutationReplayResponse<Response extends MutationReplayResponse>(
  response: Response,
): Response {
  if (typeof response !== 'object' || response === null || witnessIsArray(response)) {
    throw new TypeError('Mutation replay response must be a stable own-data record.');
  }
  const body = requiredMutationReplayResponseValue(response, 'body');
  const headers = requiredMutationReplayResponseValue(response, 'headers');
  const status = requiredMutationReplayResponseValue(response, 'status');
  if (typeof body !== 'string') {
    throw new TypeError('Mutation replay response body must be a framework wire string.');
  }
  if (!isMutationReplayResponseStatus(status)) {
    throw new TypeError('Mutation replay response status is not allowed.');
  }
  if (typeof headers !== 'object' || headers === null || witnessIsArray(headers)) {
    throw new TypeError('Mutation replay response headers must be a stable record.');
  }
  const cloned = {
    body,
    headers: cloneResponseHeaders(headers as ResponseHeaders),
    status,
  } as Response;

  // SPEC §6.6 boundary rule 5 / §9.1: replay reconstruction may preserve private
  // redirect provenance only when the response being persisted genuinely owns that witness.
  // Re-blessing also revalidates the cloned Location value, so a mutable source cannot smuggle
  // bytes written after its original classification into a later replay sink. Arbitrary durable
  // store records never pass this identity check and therefore remain fail-closed/unblessed.
  return isBlessedRedirectResponse(response) ? blessRedirectResponse(cloned) : cloned;
}

function requiredMutationReplayResponseValue(source: object, property: PropertyKey): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (before === undefined || after === undefined || !('value' in before) || !('value' in after)) {
    throw new TypeError(
      `Mutation replay response ${String(property)} must be an own data property.`,
    );
  }
  if (!witnessObjectIs(before.value, after.value)) {
    throw new TypeError(`Mutation replay response ${String(property)} changed during validation.`);
  }
  return before.value;
}

function isMutationReplayResponseStatus(value: unknown): value is MutationReplayResponse['status'] {
  return (
    value === 200 ||
    value === 303 ||
    value === 401 ||
    value === 403 ||
    value === 409 ||
    value === 422 ||
    value === 429 ||
    value === 500
  );
}

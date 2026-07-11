import { isUntrusted, revealUntrusted } from '@kovojs/core';

import {
  cloneResponseHeaders,
  type FrameworkWireBody,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import { resolveCsrfReplayBinding, type CsrfOptions } from './csrf.js';
import { formLikeToRecord } from './schema.js';

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
  const maxEntries = options.maxEntries ?? 1_000;
  // E4 (SPEC §9.1:1073/§9.5:914): bound in-flight pending reservations independently of
  // `maxEntries` to cap peak memory under a concurrent-flood DoS. The default is a generous
  // absolute bound (`max(maxEntries, 256)`) rather than `maxEntries` itself, so it never
  // throttles legitimate concurrency under a deliberately tiny `maxEntries` (e.g. the A6
  // maxEntries-pressure scenario, where several pending records must coexist under
  // `maxEntries:2`) while still bounding the default-config peak to `maxEntries` (1000).
  const maxPending = options.maxPending ?? Math.max(maxEntries, 256);
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const responses = new Map<string, MutationReplayRecord<Response>>();

  // SPEC §10.3 (M7): pending and committed state have independent bounds/lifetimes. Pending
  // reservations never expire or get capacity-evicted; maxPending keeps that state bounded.
  // Committed responses start ttlMs at commit/set and maxEntries bounds only settled truth.
  let pendingCount = 0;
  let committedCount = 0;

  function evictExpiredCommitted(): void {
    const now = Date.now();
    for (const [key, record] of responses) {
      if (!('pending' in record) && record.expiresAt <= now) {
        responses.delete(key);
        committedCount -= 1;
      }
    }
  }

  function evictCommittedOverCapacity(): void {
    while (committedCount > Math.max(0, maxEntries)) {
      let evicted = false;
      for (const [key, record] of responses) {
        if ('pending' in record) continue;
        responses.delete(key);
        committedCount -= 1;
        evicted = true;
        break;
      }
      if (!evicted) return;
    }
  }

  return {
    get(scope, idem, fingerprint) {
      const key = mutationReplayKey(scope, idem);
      const record = responses.get(key);
      if (!record) return undefined;
      if (!('pending' in record) && record.expiresAt <= Date.now()) {
        responses.delete(key);
        committedCount -= 1;
        return undefined;
      }

      if (!fingerprintsMatch(record.fingerprint, fingerprint)) {
        throw new MutationReplayConflictError();
      }

      if ('pending' in record) {
        return record.pending.then(cloneMutationReplayResponse);
      }

      return cloneMutationReplayResponse(record.response);
    },
    reserve(scope, idem, fingerprint) {
      evictExpiredCommitted();
      const key = mutationReplayKey(scope, idem);
      const existing = responses.get(key);
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
      pending.catch(() => undefined);
      const record: MutationReplayRecord<Response> = {
        fingerprint,
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      responses.set(key, record);
      pendingCount += 1;

      return {
        abort() {
          // Release only this reservation generation. A stale abort must not remove or reject
          // a newer committed/pending generation installed under the same key.
          if (responses.get(key) !== record) return;
          responses.delete(key);
          pendingCount -= 1;
          rejectPending(new MutationReplayAbortedError());
        },
        commit(response) {
          // Generation fence (M7): an aborted/superseded reservation has lost ownership of this
          // key and may never overwrite newer truth. `set()` resolves its waiters when it
          // supersedes a pending record, so a stale commit can safely become a no-op.
          if (responses.get(key) !== record) return;
          const cloned = cloneMutationReplayResponse(response);
          pendingCount -= 1;
          committedCount += 1;
          // Delete/reinsert so FIFO capacity order reflects commit time, not reservation time.
          responses.delete(key);
          responses.set(key, {
            expiresAt: Date.now() + ttlMs,
            fingerprint,
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
      const existing = responses.get(key);
      if (existing && !fingerprintsMatch(existing.fingerprint, fingerprint)) {
        throw new MutationReplayConflictError();
      }
      const cloned = cloneMutationReplayResponse(response);
      if (existing && 'pending' in existing) {
        pendingCount -= 1;
        committedCount += 1;
      } else if (!existing) {
        committedCount += 1;
      }
      // Refresh insertion order/TTL for an existing committed record too.
      responses.delete(key);
      responses.set(key, {
        expiresAt: Date.now() + ttlMs,
        fingerprint,
        response: cloned,
      });
      if (existing && 'pending' in existing) existing.resolve(cloned);
      // Capacity eviction is committed-only. Pending records stay joined until their owner
      // explicitly commits/aborts; total state remains bounded by maxEntries + maxPending.
      evictCommittedOverCapacity();
    },
  };
}

export function mutationReplayContext<Request, Response extends MutationReplayResponse>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: {
    idem?: string;
    mutationKey?: string;
    replayStore?: MutationReplayStore<Response>;
    rawInput?: unknown;
    request: Request;
    requestFingerprint?: string;
  },
): MutationReplayContext<Response> {
  const sessionScope = mutationReplayScope(csrf, wireRequest.request);
  return {
    ...(wireRequest.idem === undefined ? {} : { idem: wireRequest.idem }),
    ...replayFingerprint(csrf, wireRequest),
    ...(wireRequest.replayStore === undefined ? {} : { replayStore: wireRequest.replayStore }),
    // Security finding M4: fold the mutation key into the replay scope so
    // idempotency is per-(session, mutation, idem). Without this, one mutation's
    // cached response/Set-Cookie could be replayed under a different mutation
    // that happened to share a session and Kovo-Idem.
    scope: composeMutationReplayScope(sessionScope, wireRequest.mutationKey),
  };
}

function replayFingerprint<Request>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: { rawInput?: unknown; request: Request; requestFingerprint?: string },
): { fingerprint?: string } {
  if (wireRequest.rawInput === undefined) {
    return wireRequest.requestFingerprint === undefined
      ? {}
      : { fingerprint: wireRequest.requestFingerprint };
  }
  return { fingerprint: canonicalRequestFingerprint(canonicalReplayInput(csrf, wireRequest)) };
}

function canonicalReplayInput<Request>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: { rawInput?: unknown; request: Request },
): unknown {
  if (csrf === false || wireRequest.rawInput === undefined) return wireRequest.rawInput;
  const csrfBinding = resolveCsrfReplayBinding(wireRequest.request, csrf);
  if (!csrfBinding) return wireRequest.rawInput;

  const field = csrf.field ?? 'kovo-csrf';
  const record = formLikeToRecord(wireRequest.rawInput);
  if (!(field in record)) return wireRequest.rawInput;

  return {
    ...record,
    [field]: `csrf-binding:${csrfBinding}`,
  };
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
    return await replay.replayStore?.get(replay.scope, replay.idem, replay.fingerprint);
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
  return reserveReplayBeforeRun({
    fingerprint: replay.fingerprint,
    idem: replay.idem,
    scope: replay.scope,
    store: replay.replayStore,
  });
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
  | { expiresAt: number; fingerprint: string | undefined; response: Response }
  | {
      fingerprint: string | undefined;
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

  if (
    typeof request === 'object' &&
    request !== null &&
    'sessionId' in request &&
    typeof request.sessionId === 'string' &&
    request.sessionId !== ''
  ) {
    return request.sessionId;
  }

  if (
    typeof request === 'object' &&
    request !== null &&
    'session' in request &&
    typeof request.session === 'object' &&
    request.session !== null &&
    'id' in request.session &&
    typeof request.session.id === 'string' &&
    request.session.id !== ''
  ) {
    return request.session.id;
  }

  return null;
}

function mutationReplayKey(scope: string, idem: string): string {
  return `${scope}\0${idem}`;
}

/**
 * Canonicalize a mutation request body into the stable fingerprint string used to detect
 * idempotency-key reuse-with-different-input (SPEC §9.1 {@link MutationReplayConflictError}).
 * Shared with the wire precompute in `mutation-wire.ts` so the precomputed
 * `requestFingerprint` and any store-side recompute agree on the same value for the same body.
 *
 * L3 (bugz-3): a `FormData`/multipart body exposes no own-enumerable keys, so the naive
 * `Object.keys()` walk below produced `canonicalJson(formData) === "{}"` for EVERY multipart
 * submission — the enhanced JS client always submits FormData — collapsing all bodies to one
 * fingerprint so the conflict defense never fired. Canonicalize FormData (and nested File/Blob
 * uploads) to a record first, mirroring how the idem token and CSRF field are already read off
 * FormData via {@link formLikeToRecord}, so distinct bodies fingerprint distinctly and identical
 * bodies match.
 */
export function canonicalRequestFingerprint(value: unknown): string {
  return canonicalJson(value);
}

function canonicalJson(value: unknown): string {
  // SPEC §5.2 rule 11 / §9.1: request provenance tags are author-time guardrails. The replay
  // fingerprint compares the validated wire value, so reveal wrappers at this internal choke
  // before structural canonicalization.
  if (isUntrusted(value)) {
    return canonicalJson(revealUntrusted(value, 'validated request-derived replay fingerprint'));
  }
  // L3 (SPEC §9.1): a FormData body has no own-enumerable keys — canonicalize its entries to
  // a record (mirroring formLikeToRecord) before the structural walk so the fingerprint is
  // body-sensitive instead of always "{}".
  if (value instanceof FormData) return canonicalJson(formLikeToRecord(value));
  // A File/Blob can only be hashed asynchronously, but the fingerprint is computed
  // synchronously on the conflict path; reduce an upload to its stable descriptor so two
  // different uploads under one idem still diverge (conflict) while a re-submit of the
  // identical file matches (replay). This is strictly stronger than dropping file entries.
  if (isUploadLike(value)) return canonicalJson(uploadFingerprint(value));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

function isUploadLike(value: unknown): value is { name?: unknown; size?: unknown; type?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
    typeof (value as { size?: unknown }).size === 'number'
  );
}

function uploadFingerprint(value: { name?: unknown; size?: unknown; type?: unknown }): {
  __kovoUpload: true;
  name: string | null;
  size: number | null;
  type: string | null;
} {
  return {
    __kovoUpload: true,
    name: typeof value.name === 'string' ? value.name : null,
    size: typeof value.size === 'number' ? value.size : null,
    type: typeof value.type === 'string' ? value.type : null,
  };
}

function fingerprintsMatch(left: string | undefined, right: string | undefined): boolean {
  return left === undefined || right === undefined || left === right;
}

function cloneMutationReplayResponse<Response extends MutationReplayResponse>(
  response: Response,
): Response {
  return {
    body: response.body,
    headers: cloneResponseHeaders(response.headers),
    status: response.status,
  } as Response;
}

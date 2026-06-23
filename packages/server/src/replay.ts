import { cloneResponseHeaders, type ResponseHeaders, type ServerResponseBase } from './response.js';

export type MutationReplayResponse = ServerResponseBase<
  string,
  ResponseHeaders,
  200 | 401 | 403 | 422 | 429 | 500
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
  get(scope: string, idem: string): Promise<Response> | Response | undefined;
  reserve(scope: string, idem: string): MutationReplayReservation<Response> | undefined;
  set(scope: string, idem: string, response: Response): void;
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
  idem?: string;
  replayStore?: MutationReplayStore<Response>;
  scope: string | null;
}

export interface MutationReplayStoreOptions {
  maxEntries?: number;
  /**
   * E4 (SPEC §9.1:1073 atomic reservation; §9.5:914 pre-dispatch shed): a separate
   * bound on concurrent *in-flight pending* reservations, independent of `maxEntries`.
   * Part-2 A6 (SPEC §10.3:1063/1065) correctly stopped EVICTING pending slots to avoid
   * the M4 double-execute hazard, but that left pending reservations free to bypass
   * `maxEntries` and linger for the full `ttlMs` — an authenticated attacker firing many
   * concurrent slow mutations with client-chosen `Kovo-Idem` values could accumulate
   * unbounded pending records. When the number of pending reservations is at this cap,
   * `reserve()` REFUSES a new reservation (returns `undefined`, so the request runs
   * unprotected) rather than EVICTING an existing pending slot (which would re-open A6/M4).
   * Defaults to `maxEntries` so the documented A6 maxEntries-pressure behavior is unchanged.
   */
  maxPending?: number;
  ttlMs?: number;
}

type CsrfReplayScope<Request> =
  | false
  | {
      sessionId(request: Request): string | undefined;
    };

/**
 * Build the default in-memory {@link MutationReplayStore} (SPEC §9.1): bounded by
 * `maxEntries` with a `ttlMs` expiry. Apps name this to provision an idempotent
 * replay store for webhook/mutation handlers (e.g. conformance/webhook-spike).
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

  // E4: number of in-flight pending reservations currently held in `responses`. Kept in
  // sync with every path that adds (reserve), removes (abort/commit/set-overwrite), or
  // expires (evictExpiredPending) a pending record, so the `maxPending` refusal below is
  // O(1) rather than re-scanning the map on every reserve.
  let pendingCount = 0;
  function evictExpired(): void {
    const now = Date.now();
    for (const [key, record] of responses) {
      if (record.expiresAt <= now) {
        if ('pending' in record) pendingCount -= 1;
        responses.delete(key);
      }
    }
  }

  return {
    get(scope, idem) {
      const key = mutationReplayKey(scope, idem);
      const record = responses.get(key);
      if (!record) return undefined;
      if (record.expiresAt <= Date.now()) {
        if ('pending' in record) pendingCount -= 1;
        responses.delete(key);
        return undefined;
      }

      if ('pending' in record) {
        return record.pending.then(cloneMutationReplayResponse);
      }

      return cloneMutationReplayResponse(record.response);
    },
    reserve(scope, idem) {
      evictExpired();
      const key = mutationReplayKey(scope, idem);
      if (responses.has(key)) return undefined;

      // E4 (SPEC §9.1:1073 atomic reservation; §9.5:914 pre-dispatch shed): when pending
      // reservations are at `maxPending`, REFUSE a new one (return undefined → caller runs
      // unprotected) rather than allocating without bound. Must REFUSE, never EVICT a
      // pending slot — evicting one re-opens the part-2 A6/M4 double-execute hazard.
      if (pendingCount >= maxPending) return undefined;

      // A6 (SPEC §10.3:1063/1065): only evict committed/expired records, never
      // in-flight pending reservations (evicting a pending slot re-opens the M4
      // double-execute hazard).
      if (responses.size >= maxEntries) {
        for (const [evictKey, evictRecord] of responses) {
          if (!('pending' in evictRecord)) {
            responses.delete(evictKey);
            break;
          }
        }
      }

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
        expiresAt: Date.now() + ttlMs,
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      responses.set(key, record);
      pendingCount += 1;

      return {
        abort() {
          // Security finding M4: release the pending record so a corrected retry
          // can run, and reject the pending promise so concurrent duplicates that
          // raced onto this reservation fall back to running themselves.
          if (responses.get(key) === record) {
            responses.delete(key);
            pendingCount -= 1;
          }
          rejectPending(new MutationReplayAbortedError());
        },
        commit(response) {
          const cloned = cloneMutationReplayResponse(response);
          // Commit replaces the pending record with a committed one. Decrement only if
          // this reservation's pending record is still the one in the map (an abort or
          // set-overwrite may have already removed/replaced it).
          if (responses.get(key) === record) pendingCount -= 1;
          responses.set(key, {
            expiresAt: Date.now() + ttlMs,
            response: cloned,
          });
          resolvePending(cloned);
        },
      };
    },
    set(scope, idem, response) {
      evictExpired();
      const key = mutationReplayKey(scope, idem);
      const existing = responses.get(key);
      while (!existing && responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        const oldestRecord = responses.get(oldest);
        responses.delete(oldest);
        // K3 (SPEC §9.1): never silently drop a pending record. A6 stopped reserve() from
        // evicting pending slots, but set()'s maxEntries eviction could still delete the
        // oldest — which may be an in-flight reservation — leaving any duplicate that joined
        // it via get() hung forever. Reject its pending promise (MutationReplayAbortedError)
        // so the awaiter falls back to running itself (mirrors reserve()/A4 abort).
        if (oldestRecord && 'pending' in oldestRecord) {
          pendingCount -= 1;
          oldestRecord.reject(new MutationReplayAbortedError());
        }
      }

      // Overwriting an existing pending record with a committed one releases its pending slot.
      if (existing && 'pending' in existing) pendingCount -= 1;
      const cloned = cloneMutationReplayResponse(response);
      responses.set(key, {
        expiresAt: Date.now() + ttlMs,
        response: cloned,
      });
      if (existing && 'pending' in existing) existing.resolve(cloned);
    },
  };
}

export function mutationReplayContext<Request, Response extends MutationReplayResponse>(
  csrf: CsrfReplayScope<Request>,
  wireRequest: {
    idem?: string;
    mutationKey?: string;
    replayStore?: MutationReplayStore<Response>;
    request: Request;
  },
): MutationReplayContext<Response> {
  const sessionScope = mutationReplayScope(csrf, wireRequest.request);
  return {
    ...(wireRequest.idem === undefined ? {} : { idem: wireRequest.idem }),
    ...(wireRequest.replayStore === undefined ? {} : { replayStore: wireRequest.replayStore }),
    // Security finding M4: fold the mutation key into the replay scope so
    // idempotency is per-(session, mutation, idem). Without this, one mutation's
    // cached response/Set-Cookie could be replayed under a different mutation
    // that happened to share a session and Kovo-Idem.
    scope: composeMutationReplayScope(sessionScope, wireRequest.mutationKey),
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
    return await replay.replayStore?.get(replay.scope, replay.idem);
  } catch (error) {
    // A pending record this read joined was aborted (e.g. the in-flight request
    // hit a non-replayable validation failure). Treat it as a miss so this
    // request runs the handler itself.
    if (error instanceof MutationReplayAbortedError) return undefined;
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
  | { kind: 'disabled' }
  | { kind: 'replayed'; response: Response }
  | { kind: 'reserved'; reservation: MutationReplayReservation<Response> }
> {
  if (!replay.idem || !replay.scope || !replay.replayStore) return { kind: 'disabled' };

  const reservation = replay.replayStore.reserve(replay.scope, replay.idem);
  if (reservation) return { kind: 'reserved', reservation };

  // reserve() returned undefined: a concurrent request created the record between
  // our get() miss and this reserve(). Await the now-present pending entry rather
  // than re-running the handler. If that in-flight request aborts its reservation
  // (e.g. a validation failure), the pending promise rejects — fall back to
  // running ourselves rather than propagating the abort.
  try {
    const pending = await replay.replayStore.get(replay.scope, replay.idem);
    if (pending) return { kind: 'replayed', response: pending };
  } catch (error) {
    if (!(error instanceof MutationReplayAbortedError)) throw error;
  }

  // A6: The record vanished (expired/evicted/aborted) before we could read it.
  // Re-reserve so this request runs with a proper reservation rather than falling
  // through unprotected (which would re-open the M4 double-execute hazard).
  const retryReservation = replay.replayStore.reserve(replay.scope, replay.idem);
  if (retryReservation) return { kind: 'reserved', reservation: retryReservation };

  // Another request snuck in again — await that one.
  try {
    const pending = await replay.replayStore.get(replay.scope, replay.idem);
    if (pending) return { kind: 'replayed', response: pending };
  } catch (error) {
    if (!(error instanceof MutationReplayAbortedError)) throw error;
  }

  // Still can't reserve; run unprotected rather than dropping.
  return { kind: 'disabled' };
}

export class MutationReplayAbortedError extends Error {
  constructor() {
    super('Mutation replay reservation aborted before commit.');
    this.name = 'MutationReplayAbortedError';
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
  | { expiresAt: number; response: Response }
  | {
      expiresAt: number;
      pending: Promise<Response>;
      // K3 (SPEC §9.1): carried so an eviction path that drops a pending record can settle
      // any joined awaiter (reject with MutationReplayAbortedError) instead of stranding it.
      reject(reason?: unknown): void;
      resolve(response: Response): void;
    };

function mutationReplayScope<Request>(
  csrf: CsrfReplayScope<Request>,
  request: Request,
): string | null {
  const csrfSessionId = csrf === false ? undefined : csrf.sessionId(request);
  if (csrfSessionId) return csrfSessionId;

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

function cloneMutationReplayResponse<Response extends MutationReplayResponse>(
  response: Response,
): Response {
  return {
    body: response.body,
    headers: cloneResponseHeaders(response.headers),
    status: response.status,
  } as Response;
}

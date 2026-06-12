import { cloneResponseHeaders, type ResponseHeaders, type ServerResponseBase } from './response.js';

export type MutationReplayResponse = ServerResponseBase<
  string,
  ResponseHeaders,
  200 | 422 | 429 | 500
>;

export interface MutationReplayStore<
  Response extends MutationReplayResponse = MutationReplayResponse,
> {
  get(scope: string, idem: string): Promise<Response> | Response | undefined;
  reserve(scope: string, idem: string): MutationReplayReservation<Response> | undefined;
  set(scope: string, idem: string, response: Response): void;
}

export interface MutationReplayReservation<
  Response extends MutationReplayResponse = MutationReplayResponse,
> {
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
  ttlMs?: number;
}

type CsrfReplayScope<Request> =
  | false
  | {
      sessionId(request: Request): string | undefined;
    };

export function createMemoryMutationReplayStore<
  Response extends MutationReplayResponse = MutationReplayResponse,
>(options: MutationReplayStoreOptions = {}): MutationReplayStore<Response> {
  const maxEntries = options.maxEntries ?? 1_000;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const responses = new Map<string, MutationReplayRecord<Response>>();

  return {
    get(scope, idem) {
      const key = mutationReplayKey(scope, idem);
      const record = responses.get(key);
      if (!record) return undefined;
      if (record.expiresAt <= Date.now()) {
        responses.delete(key);
        return undefined;
      }

      if ('pending' in record) {
        return record.pending.then(cloneMutationReplayResponse);
      }

      return cloneMutationReplayResponse(record.response);
    },
    reserve(scope, idem) {
      evictExpiredMutationReplays(responses);
      const key = mutationReplayKey(scope, idem);
      if (responses.has(key)) return undefined;

      while (responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        responses.delete(oldest);
      }

      let resolvePending: (response: Response) => void = () => undefined;
      const pending = new Promise<Response>((resolve) => {
        resolvePending = resolve;
      });
      responses.set(key, {
        expiresAt: Date.now() + ttlMs,
        pending,
        resolve: resolvePending,
      });

      return {
        commit(response) {
          const cloned = cloneMutationReplayResponse(response);
          responses.set(key, {
            expiresAt: Date.now() + ttlMs,
            response: cloned,
          });
          resolvePending(cloned);
        },
      };
    },
    set(scope, idem, response) {
      evictExpiredMutationReplays(responses);
      const key = mutationReplayKey(scope, idem);
      const existing = responses.get(key);
      while (!existing && responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        responses.delete(oldest);
      }

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
    replayStore?: MutationReplayStore<Response>;
    request: Request;
  },
): MutationReplayContext<Response> {
  return {
    ...(wireRequest.idem === undefined ? {} : { idem: wireRequest.idem }),
    ...(wireRequest.replayStore === undefined ? {} : { replayStore: wireRequest.replayStore }),
    scope: mutationReplayScope(csrf, wireRequest.request),
  };
}

export async function readMutationReplay<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
): Promise<Response | undefined> {
  if (!replay.idem || !replay.scope) return undefined;
  return replay.replayStore?.get(replay.scope, replay.idem);
}

export async function withMutationReplay<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
  render: () => Promise<Response>,
): Promise<Response> {
  const reservation = reserveMutationReplay(replay);
  const response = await render();
  commitMutationReplay(replay, response, reservation);
  return response;
}

type MutationReplayRecord<Response extends MutationReplayResponse> =
  | { expiresAt: number; response: Response }
  | {
      expiresAt: number;
      pending: Promise<Response>;
      resolve(response: Response): void;
    };

function commitMutationReplay<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
  response: Response,
  reservation?: MutationReplayReservation<Response>,
): void {
  if (reservation) {
    reservation.commit(response);
  } else {
    if (!replay.idem || !replay.scope) return;
    replay.replayStore?.set(replay.scope, replay.idem, response);
  }
}

function reserveMutationReplay<Response extends MutationReplayResponse>(
  replay: MutationReplayContext<Response>,
): MutationReplayReservation<Response> | undefined {
  if (!replay.idem || !replay.scope) return undefined;

  return replay.replayStore?.reserve(replay.scope, replay.idem);
}

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

function evictExpiredMutationReplays<Response extends MutationReplayResponse>(
  responses: Map<string, MutationReplayRecord<Response>>,
): void {
  const now = Date.now();
  for (const [key, record] of responses) {
    if (record.expiresAt <= now) responses.delete(key);
  }
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

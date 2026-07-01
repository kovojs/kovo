import { KOVO_IDEM_FIELD_NAME, type CsrfValidationOptions } from '../csrf.js';
import {
  canonicalRequestFingerprint,
  MutationReplayConflictError,
  mutationReplayContext,
  readMutationReplay,
  reserveReplayBeforeRun,
  reserveMutationReplayBeforeRun,
} from '../replay.js';
import { formLikeToRecord } from '../schema.js';
import type {
  BufferedMutationWireResponse,
  MutationEndpointReplayResponse,
  MutationWireRequest,
  NoJsMutationReplayReservation,
  NoJsMutationRequest,
  NoJsMutationResponse,
} from '../mutation-wire.js';
import type { ResolvedGuardFailure } from '../guards.js';
import type { MutationFail, MutationSuccess } from './definition.js';
import type { ValidationFailurePayload } from '../schema.js';

export type MutationLifecycleReplayReservation<Response> = {
  abort?(): void;
  commit(response: Response): void;
};

export type MutationLifecycleReplayPolicy<Response> = {
  read(): Promise<Response | undefined> | Response | undefined;
  reserve():
    | Promise<
        | { kind: 'conflict' }
        | { kind: 'disabled' }
        | { kind: 'replayed'; response: Response }
        | { kind: 'reserved'; reservation: MutationLifecycleReplayReservation<Response> }
        | { kind: 'unavailable' }
        | { kind: 'unreserved' }
      >
    | { kind: 'conflict' }
    | { kind: 'disabled' }
    | { kind: 'replayed'; response: Response }
    | { kind: 'reserved'; reservation: MutationLifecycleReplayReservation<Response> }
    | { kind: 'unavailable' }
    | { kind: 'unreserved' };
};

export type MutationLifecycleOutcome<Value, Input, ReplayResponse> =
  | { kind: 'csrf-failure'; failure: MutationFail<'CSRF', Record<string, never>> }
  | { kind: 'validation-failure'; failure: MutationFail<'VALIDATION', ValidationFailurePayload> }
  | {
      failure: MutationFail;
      guardFailure: ResolvedGuardFailure;
      kind: 'guard-failure';
      lifecycleRequest: unknown;
    }
  | { kind: 'replay-conflict' }
  | { kind: 'replay-unavailable' }
  | { kind: 'replayed'; response: ReplayResponse }
  | {
      error: unknown;
      kind: 'handler-error';
      reservation: MutationLifecycleReplayReservation<ReplayResponse> | undefined;
    }
  | {
      kind: 'mutation-failure';
      reservation: MutationLifecycleReplayReservation<ReplayResponse> | undefined;
      result: MutationFail;
    }
  | {
      kind: 'success';
      reservation: MutationLifecycleReplayReservation<ReplayResponse> | undefined;
      result: MutationSuccess<Value, Input>;
    };

export function optionalReplayPolicy<Response>(
  replay: MutationLifecycleReplayPolicy<Response> | undefined,
): { replay?: MutationLifecycleReplayPolicy<Response> } {
  return replay === undefined ? {} : { replay };
}

export function enhancedMutationReplayPolicy<Request>(mode: {
  csrf: CsrfValidationOptions<Request> | false | undefined;
  mutationKey: string;
  request: MutationWireRequest<Request>;
}): MutationLifecycleReplayPolicy<BufferedMutationWireResponse> {
  const context = mutationReplayContext(mode.csrf ?? false, {
    ...mode.request,
    mutationKey: mode.mutationKey,
  });
  return {
    async read() {
      return enhancedReplayResponseOrConflict(await readMutationReplay(context));
    },
    async reserve() {
      const result = await reserveMutationReplayBeforeRun(context);
      if (result.kind === 'replayed') {
        return {
          kind: 'replayed',
          response: enhancedReplayResultOrConflict(result.response),
        };
      }
      if (result.kind !== 'reserved') return result;
      return {
        kind: 'reserved',
        reservation: {
          ...(result.reservation.abort === undefined
            ? {}
            : { abort: () => result.reservation.abort?.() }),
          commit(response: BufferedMutationWireResponse) {
            result.reservation.commit(response);
          },
        },
      };
    },
  };
}

export function noJsMutationReplayPolicy<Request, Value>(mode: {
  csrf: CsrfValidationOptions<Request> | false | undefined;
  mutationKey: string;
  request: NoJsMutationRequest<Request, Value>;
}): MutationLifecycleReplayPolicy<NoJsMutationResponse> | undefined {
  // A2 (SPEC §10.3:1063/1151): derive the idem from the hidden `Kovo-Idem` form field.
  const idem = mode.request.idem ?? readNoJsIdemField(mode.request.rawInput);
  if (!idem || !mode.request.replayStore) return undefined;

  const scope = noJsReplayScopeFor(mode.csrf, mode.mutationKey, mode.request.request);
  const fingerprint =
    mode.request.requestFingerprint ?? canonicalRequestFingerprint(mode.request.rawInput);
  return {
    async read() {
      return noJsReplayResponseOrConflict(
        await mode.request.replayStore?.get(scope, idem, fingerprint),
      );
    },
    async reserve() {
      const result = await reserveReplayBeforeRun<
        MutationEndpointReplayResponse,
        NoJsMutationReplayReservation
      >({
        fingerprint,
        idem,
        scope,
        store: mode.request.replayStore,
      });
      if (result.kind === 'replayed') {
        return {
          kind: 'replayed',
          response: noJsReplayResultOrConflict(result.response),
        };
      }
      if (result.kind !== 'reserved') return result;
      return {
        kind: 'reserved',
        reservation: noJsReplayReservation(result.reservation),
      };
    },
  };
}

export function isNoJsReplayResponse(
  response: MutationEndpointReplayResponse,
): response is NoJsMutationResponse {
  return (
    response.status === 303 ||
    String(response.headers['Content-Type'] ?? '').startsWith('text/html;')
  );
}

export function isEnhancedReplayResponse(
  response: MutationEndpointReplayResponse,
): response is BufferedMutationWireResponse {
  return (
    response.status !== 303 &&
    (String(response.headers['Content-Type'] ?? '').startsWith('text/vnd.kovo.fragment+html;') ||
      typeof response.headers['Kovo-Reauth'] === 'string')
  );
}

function enhancedReplayResponseOrConflict(
  response: MutationEndpointReplayResponse | undefined,
): BufferedMutationWireResponse | undefined {
  if (response === undefined) return undefined;
  return enhancedReplayResultOrConflict(response);
}

function enhancedReplayResultOrConflict(
  response: MutationEndpointReplayResponse,
): BufferedMutationWireResponse {
  if (isEnhancedReplayResponse(response)) return response;
  throw new MutationReplayConflictError();
}

function noJsReplayResponseOrConflict(
  response: MutationEndpointReplayResponse | undefined,
): NoJsMutationResponse | undefined {
  if (response === undefined) return undefined;
  return noJsReplayResultOrConflict(response);
}

function noJsReplayResultOrConflict(
  response: MutationEndpointReplayResponse,
): NoJsMutationResponse {
  if (isNoJsReplayResponse(response)) return response;
  throw new MutationReplayConflictError();
}

function noJsReplayReservation(
  reservation: NoJsMutationReplayReservation,
): MutationLifecycleReplayReservation<NoJsMutationResponse> {
  return {
    ...(reservation.abort === undefined ? {} : { abort: () => reservation.abort?.() }),
    commit(response) {
      reservation.commit(response);
    },
  };
}

function readNoJsIdemField(rawInput: unknown): string | undefined {
  if (typeof rawInput !== 'object' || rawInput === null) return undefined;
  let record: Record<string, unknown>;
  try {
    record = formLikeToRecord(rawInput);
  } catch {
    return undefined;
  }
  const value = record[KOVO_IDEM_FIELD_NAME];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function noJsReplayScopeFor<Request>(
  csrf: CsrfValidationOptions<Request> | false | undefined,
  mutationKey: string,
  request: Request,
): string {
  let sessionScope: string | null = null;

  if (csrf !== false && csrf !== undefined && 'sessionId' in csrf) {
    const id = (csrf as { sessionId(r: Request): string | undefined }).sessionId(request);
    if (id) sessionScope = id;
  }

  if (!sessionScope && typeof request === 'object' && request !== null) {
    const req = request as Record<string, unknown>;
    if (typeof req['sessionId'] === 'string' && req['sessionId'] !== '') {
      sessionScope = req['sessionId'];
    } else if (
      typeof req['session'] === 'object' &&
      req['session'] !== null &&
      typeof (req['session'] as Record<string, unknown>)['id'] === 'string' &&
      (req['session'] as Record<string, unknown>)['id'] !== ''
    ) {
      sessionScope = (req['session'] as Record<string, unknown>)['id'] as string;
    }
  }

  return sessionScope !== null ? `nojs:${mutationKey}\0${sessionScope}` : `nojs:${mutationKey}`;
}

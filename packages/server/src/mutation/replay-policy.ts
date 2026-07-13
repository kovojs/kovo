import { isUntrusted, revealUntrusted } from '@kovojs/core';

import { KOVO_IDEM_FIELD_NAME, type CsrfOptions } from '../csrf.js';
import {
  MutationReplayConflictError,
  mutationReplayContext,
  readMutationReplay,
  reserveReplayBeforeRun,
  reserveMutationReplayBeforeRun,
  snapshotMutationReplayResponse,
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
import {
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
} from '../security-witness-intrinsics.js';
import { securityStringStartsWith } from '../response-security-intrinsics.js';

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
  csrf: CsrfOptions<Request> | false | undefined;
  mutationKey: string;
  request: MutationWireRequest<Request>;
}): MutationLifecycleReplayPolicy<BufferedMutationWireResponse> | undefined {
  if (!mode.request.idem || !mode.request.replayStore) return undefined;
  let context: ReturnType<typeof mutationReplayContext> | undefined;
  const replayContext = () =>
    (context ??= mutationReplayContext(mode.csrf ?? false, {
      ...mode.request,
      mutationKey: mode.mutationKey,
    }));
  return {
    async read() {
      return enhancedReplayResponseOrConflict(await readMutationReplay(await replayContext()));
    },
    async reserve() {
      const result = await reserveMutationReplayBeforeRun(await replayContext());
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
  csrf: CsrfOptions<Request> | false | undefined;
  mutationKey: string;
  request: NoJsMutationRequest<Request, Value>;
}): MutationLifecycleReplayPolicy<NoJsMutationResponse> | undefined {
  // A2 (SPEC §10.3:1063/1151): derive the idem from the hidden `Kovo-Idem` form field.
  const idem = mode.request.idem ?? readNoJsIdemField(mode.request.rawInput);
  if (!idem || !mode.request.replayStore) return undefined;

  let context: ReturnType<typeof mutationReplayContext> | undefined;
  const replayContext = () =>
    (context ??= mutationReplayContext(mode.csrf ?? false, {
      idem,
      mutationKey: mode.mutationKey,
      rawInput: mode.request.rawInput,
      request: mode.request.request,
      ...(mode.request.requestFingerprint === undefined
        ? {}
        : { requestFingerprint: mode.request.requestFingerprint }),
    }));
  // Keep response vocabularies separated while deriving both enhanced and no-JS principal/fingerprint
  // facts from the same session-or-anonymous-CSRF binding. csrf:false sessionless no-JS retains its
  // mutation-key fallback for the existing public-machine submission contract.
  return {
    async read() {
      const context = await replayContext();
      const scope = context.scope === null ? `nojs:${mode.mutationKey}` : `nojs:${context.scope}`;
      const response = await mode.request.replayStore?.get(scope, idem, context.fingerprint);
      return noJsReplayResponseOrConflict(
        response === undefined ? undefined : snapshotMutationReplayResponse(response),
      );
    },
    async reserve() {
      const context = await replayContext();
      const scope = context.scope === null ? `nojs:${mode.mutationKey}` : `nojs:${context.scope}`;
      const result = await reserveReplayBeforeRun<
        MutationEndpointReplayResponse,
        NoJsMutationReplayReservation
      >({
        fingerprint: context.fingerprint,
        idem,
        scope,
        store: mode.request.replayStore,
      });
      if (result.kind === 'replayed') {
        return {
          kind: 'replayed',
          response: noJsReplayResultOrConflict(snapshotMutationReplayResponse(result.response)),
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
  const status = stableReplayOwnData(response, 'status');
  const headers = stableReplayOwnData(response, 'headers');
  const contentType = stableReplayHeader(headers, 'Content-Type');
  return (
    status === 303 ||
    (typeof contentType === 'string' && securityStringStartsWith(contentType, 'text/html;'))
  );
}

export function isEnhancedReplayResponse(
  response: MutationEndpointReplayResponse,
): response is BufferedMutationWireResponse {
  const status = stableReplayOwnData(response, 'status');
  const headers = stableReplayOwnData(response, 'headers');
  const contentType = stableReplayHeader(headers, 'Content-Type');
  const reauth = stableReplayHeader(headers, 'Kovo-Reauth');
  return (
    status !== undefined &&
    status !== 303 &&
    ((typeof contentType === 'string' &&
      securityStringStartsWith(contentType, 'text/vnd.kovo.fragment+html;')) ||
      typeof reauth === 'string')
  );
}

function stableReplayHeader(headers: unknown, name: string): unknown {
  if (typeof headers !== 'object' || headers === null || witnessIsArray(headers)) return undefined;
  return stableReplayOwnData(headers, name);
}

function stableReplayOwnData(source: unknown, property: PropertyKey): unknown {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) return undefined;
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    return undefined;
  }
  return before.value;
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
  const rawValue = record[KOVO_IDEM_FIELD_NAME];
  const value = isUntrusted(rawValue)
    ? revealUntrusted(rawValue, 'validated request-derived no-js idempotency token')
    : rawValue;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

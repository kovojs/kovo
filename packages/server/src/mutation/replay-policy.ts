import { isUntrusted, revealUntrusted, type ScopedKey } from '@kovojs/core';

import { KOVO_IDEM_FIELD_NAME, type CsrfOptions } from '../csrf.js';
import { provenPrincipalFromRequest } from '../auth-principal.js';
import {
  assertPrincipalEpochFresh,
  assertPrincipalEpochFreshForRequest,
  currentPrincipalEpoch,
  PrincipalEpochStaleError,
  snapshotPrincipalEpochStore,
  type PrincipalEpochState,
  type PrincipalEpochStore,
} from '../principal-epoch.js';
import {
  MutationReplayConflictError,
  MutationReplaySettlementExpiredError,
  mutationReplayContext,
  mutationReplayScopedKey,
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
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessObjectIs,
} from '../security-witness-intrinsics.js';
import { securityStringStartsWith } from '../response-security-intrinsics.js';
import { validateMutationIdemToken } from '../mutation-idem.js';
import { requestStateExactCompositeKey } from '../request-state-intrinsics.js';

export type MutationLifecycleReplayReservation<Response> = {
  abort?(): Promise<void> | void;
  commit(response: Response): Promise<void> | void;
  /** @internal Exact principal epoch that owned this replay reservation. */
  principalEpochAdmission?: ReplayPrincipalEpochAdmission;
};

/** @internal Carries one reservation's principal epoch into handler admission. */
export interface ReplayPrincipalEpochAdmission {
  readonly epoch: number;
  readonly principal: string;
  readonly store: PrincipalEpochStore;
}

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
  const idem: unknown = mode.request.idem;
  if (idem === undefined) {
    return mode.request.replayStore === undefined ? undefined : invalidMutationIdemReplayPolicy();
  }
  const idemFacts = validateMutationIdemToken(idem);
  if (idemFacts === undefined) return invalidMutationIdemReplayPolicy();
  const principalEpochStore = optionalPrincipalEpochStore(mode.request.principalEpochStore);
  const replayStore = mode.request.replayStore;
  if (!replayStore) return freshnessOnlyMutationIdemReplayPolicy(idemFacts.token);
  const freshnessCheckedStore = {
    async get(key: ScopedKey, scope: string, token: string, fingerprint?: string) {
      assertFreshMutationIdem(idemFacts.token);
      const response = await replayStore.get(key, scope, token, fingerprint);
      assertFreshMutationIdem(idemFacts.token);
      return response;
    },
    async reserve(key: ScopedKey, scope: string, token: string, fingerprint?: string) {
      assertFreshMutationIdem(idemFacts.token);
      const reservation = await replayStore.reserve(key, scope, token, fingerprint);
      if (validateMutationIdemToken(idemFacts.token) === undefined) {
        await reservation?.abort?.();
        throw new MutationReplayConflictError();
      }
      return reservation;
    },
    set(
      key: ScopedKey,
      scope: string,
      token: string,
      response: BufferedMutationWireResponse,
      fingerprint?: string,
    ) {
      return replayStore.set(key, scope, token, response, fingerprint);
    },
  };
  let context: ReturnType<typeof mutationReplayContext> | undefined;
  let baseScopedContext: Awaited<ReturnType<typeof mutationReplayContext>> | undefined;
  const replayContext = async (): Promise<PrincipalEpochReplayContext> => {
    const resolved = await (context ??= mutationReplayContext(mode.csrf ?? false, {
      ...mode.request,
      idem: idemFacts.token,
      mutationKey: mode.mutationKey,
      replayStore: freshnessCheckedStore,
    }));
    // SPEC §10.3 atomic reservation applies to csrf:false machine clients too. With neither an
    // anonymous-CSRF cookie nor a session, isolate their enhanced replay truth by mutation key;
    // no-JS uses its own `nojs:` namespace below so response vocabularies cannot cross-replay.
    const base = (baseScopedContext ??=
      resolved.scope === null
        ? {
            ...resolved,
            scope: requestStateExactCompositeKey('enhanced-sessionless', mode.mutationKey),
          }
        : resolved);
    return principalEpochReplayContext(
      base,
      principalEpochStore,
      mode.request.request,
      idemFacts.issuedAtMs,
    );
  };
  return {
    async read() {
      const scoped = await replayContext();
      const response = enhancedReplayResponseOrConflict(
        await readMutationReplay(scoped.context),
      );
      if (response !== undefined) await assertReplayResponseEpochFresh(scoped);
      return response;
    },
    async reserve() {
      const scoped = await replayContext();
      const result = await reserveMutationReplayBeforeRun(scoped.context);
      if (result.kind === 'replayed') {
        await assertReplayResponseEpochFresh(scoped);
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
          ...(scoped.binding === undefined
            ? {}
            : { principalEpochAdmission: replayPrincipalEpochAdmission(scoped.binding) }),
          async commit(response: BufferedMutationWireResponse) {
            assertFreshMutationIdemSettlement(idemFacts.token);
            await assertReplaySettlementEpochFresh(scoped);
            return result.reservation.commit(response);
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
  // A2 (SPEC §10.3): the framework-authored hidden field is authoritative when supplied; the
  // header is only its fallback. Preserve presence separately from truthiness so an empty,
  // duplicated, accessor-backed, or otherwise malformed field cannot disable replay validation.
  const formIdem = readNoJsIdemField(mode.request.rawInput);
  const idem: unknown = formIdem.present ? formIdem.value : mode.request.idem;
  if (!formIdem.present && idem === undefined) {
    return mode.request.replayStore === undefined ? undefined : invalidMutationIdemReplayPolicy();
  }
  const idemFacts = validateMutationIdemToken(idem);
  if (idemFacts === undefined) return invalidMutationIdemReplayPolicy();
  const principalEpochStore = optionalPrincipalEpochStore(mode.request.principalEpochStore);
  const replayStore = mode.request.replayStore;
  if (!replayStore) return freshnessOnlyMutationIdemReplayPolicy(idemFacts.token);

  const freshnessCheckedStore = {
    async get(key: ScopedKey, scope: string, token: string, fingerprint?: string) {
      assertFreshMutationIdem(idemFacts.token);
      const response = await replayStore.get(key, scope, token, fingerprint);
      assertFreshMutationIdem(idemFacts.token);
      return response;
    },
    async reserve(key: ScopedKey, scope: string, token: string, fingerprint?: string) {
      assertFreshMutationIdem(idemFacts.token);
      const reservation = await replayStore.reserve(key, scope, token, fingerprint);
      if (validateMutationIdemToken(idemFacts.token) === undefined) {
        await reservation?.abort?.();
        throw new MutationReplayConflictError();
      }
      return reservation;
    },
  };

  let context: ReturnType<typeof mutationReplayContext> | undefined;
  const replayContext = async (): Promise<PrincipalEpochReplayContext> => {
    const base = await (context ??= mutationReplayContext(mode.csrf ?? false, {
      idem: idemFacts.token,
      mutationKey: mode.mutationKey,
      rawInput: mode.request.rawInput,
      request: mode.request.request,
      ...(mode.request.requestFingerprint === undefined
        ? {}
        : { requestFingerprint: mode.request.requestFingerprint }),
    }));
    return principalEpochReplayContext(
      base.scope === null
        ? {
            ...base,
            scope: requestStateExactCompositeKey('nojs-sessionless', mode.mutationKey),
          }
        : base,
      principalEpochStore,
      mode.request.request,
      idemFacts.issuedAtMs,
    );
  };
  // Keep response vocabularies separated while deriving both enhanced and no-JS principal/fingerprint
  // facts from the same session-or-anonymous-CSRF binding. csrf:false sessionless no-JS retains its
  // mutation-key fallback for the existing public-machine submission contract.
  return {
    async read() {
      const scoped = await replayContext();
      const context = scoped.context;
      const scope = context.scope === null ? `nojs:${mode.mutationKey}` : `nojs:${context.scope}`;
      const response = await freshnessCheckedStore.get(
        mutationReplayScopedKey(scope, idemFacts.token),
        scope,
        idemFacts.token,
        context.fingerprint,
      );
      const replayed = noJsReplayResponseOrConflict(
        response === undefined ? undefined : snapshotMutationReplayResponse(response),
      );
      if (replayed !== undefined) await assertReplayResponseEpochFresh(scoped);
      return replayed;
    },
    async reserve() {
      const scoped = await replayContext();
      const context = scoped.context;
      const scope = context.scope === null ? `nojs:${mode.mutationKey}` : `nojs:${context.scope}`;
      const replayKey = mutationReplayScopedKey(scope, idemFacts.token);
      const result = await reserveReplayBeforeRun<
        MutationEndpointReplayResponse,
        NoJsMutationReplayReservation
      >({
        fingerprint: context.fingerprint,
        idem: idemFacts.token,
        scope,
        store: {
          get(_scope: string, _idem: string, fingerprint?: string) {
            return freshnessCheckedStore.get(replayKey, scope, idemFacts.token, fingerprint);
          },
          reserve(_scope: string, _idem: string, fingerprint?: string) {
            return freshnessCheckedStore.reserve(replayKey, scope, idemFacts.token, fingerprint);
          },
        },
      });
      if (result.kind === 'replayed') {
        await assertReplayResponseEpochFresh(scoped);
        return {
          kind: 'replayed',
          response: noJsReplayResultOrConflict(snapshotMutationReplayResponse(result.response)),
        };
      }
      if (result.kind !== 'reserved') return result;
      return {
        kind: 'reserved',
        reservation: noJsReplayReservation(
          result.reservation,
          idemFacts.token,
          scoped,
        ),
      };
    },
  };
}

function invalidMutationIdemReplayPolicy<Response>(): MutationLifecycleReplayPolicy<Response> {
  return {
    read() {
      throw new MutationReplayConflictError();
    },
    reserve() {
      return { kind: 'conflict' };
    },
  };
}

function freshnessOnlyMutationIdemReplayPolicy<Response>(
  token: string,
): MutationLifecycleReplayPolicy<Response> {
  return {
    read() {
      assertFreshMutationIdem(token);
      return undefined;
    },
    reserve() {
      assertFreshMutationIdem(token);
      return { kind: 'disabled' };
    },
  };
}

function assertFreshMutationIdem(token: string): void {
  if (validateMutationIdemToken(token) === undefined) {
    throw new MutationReplayConflictError();
  }
}

function assertFreshMutationIdemSettlement(token: string): void {
  if (validateMutationIdemToken(token) === undefined) {
    throw new MutationReplaySettlementExpiredError();
  }
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
  token: string,
  scoped: PrincipalEpochReplayContext,
): MutationLifecycleReplayReservation<NoJsMutationResponse> {
  return {
    ...(reservation.abort === undefined ? {} : { abort: () => reservation.abort?.() }),
    ...(scoped.binding === undefined
      ? {}
      : { principalEpochAdmission: replayPrincipalEpochAdmission(scoped.binding) }),
    async commit(response) {
      assertFreshMutationIdemSettlement(token);
      await assertReplaySettlementEpochFresh(scoped);
      return reservation.commit(response);
    },
  };
}

function replayPrincipalEpochAdmission(
  binding: PrincipalEpochReplayBinding,
): ReplayPrincipalEpochAdmission {
  return witnessFreeze({
    epoch: binding.state.epoch,
    principal: binding.principal,
    store: binding.store,
  });
}

interface PrincipalEpochReplayBinding {
  readonly principal: string;
  readonly state: PrincipalEpochState;
  readonly store: PrincipalEpochStore;
  readonly requestCarrier: unknown;
}

interface PrincipalEpochReplayContext {
  readonly binding?: PrincipalEpochReplayBinding;
  readonly context: Awaited<ReturnType<typeof mutationReplayContext>>;
}

function optionalPrincipalEpochStore(
  store: PrincipalEpochStore | undefined,
): PrincipalEpochStore | undefined {
  return store === undefined ? undefined : snapshotPrincipalEpochStore(store);
}

async function principalEpochReplayContext(
  context: Awaited<ReturnType<typeof mutationReplayContext>>,
  store: PrincipalEpochStore | undefined,
  requestCarrier: unknown,
  issuedAtMs: number,
): Promise<PrincipalEpochReplayContext> {
  const principal = provenPrincipalFromRequest(requestCarrier);
  if (store === undefined || principal === undefined) return { context };
  const state = await currentPrincipalEpoch(store, principal);
  // Epoch 1 is identity initialization, not revocation. A form stamped in the same millisecond as
  // first authenticated resolution remains valid; equality at every later epoch is closed because
  // ordering within the revocation millisecond is unknowable.
  if (
    state.status !== 'active' ||
    issuedAtMs < state.changedAtMs ||
    (issuedAtMs === state.changedAtMs && state.epoch > 1)
  ) {
    throw new MutationReplayConflictError();
  }
  if (context.scope === null) throw new MutationReplayConflictError();
  return {
    binding: { principal, requestCarrier, state, store },
    context: {
      ...context,
      // The durable receipt embeds the current epoch in its unique replay namespace. The original
      // scope is already principal-bound; append only the epoch to stay below the 4096-unit ceiling.
      scope: requestStateExactCompositeKey(context.scope, `epoch:${state.epoch}`),
    },
  };
}

async function assertReplayResponseEpochFresh(scoped: PrincipalEpochReplayContext): Promise<void> {
  const binding = scoped.binding;
  if (binding === undefined) return;
  try {
    await assertPrincipalEpochFresh(binding.store, binding.principal, binding.state.epoch);
  } catch (error) {
    if (error instanceof PrincipalEpochStaleError) throw new MutationReplayConflictError();
    throw error;
  }
}

async function assertReplaySettlementEpochFresh(
  scoped: PrincipalEpochReplayContext,
): Promise<void> {
  const binding = scoped.binding;
  if (binding === undefined) return;
  try {
    await assertPrincipalEpochFreshForRequest(
      binding.store,
      binding.requestCarrier,
      binding.principal,
      binding.state.epoch,
    );
  } catch (error) {
    if (error instanceof PrincipalEpochStaleError) {
      throw new MutationReplaySettlementExpiredError();
    }
    throw error;
  }
}

interface MutationIdemFieldSnapshot {
  readonly present: boolean;
  readonly value: unknown;
}

function readNoJsIdemField(rawInput: unknown): MutationIdemFieldSnapshot {
  if (typeof rawInput !== 'object' || rawInput === null) {
    return { present: false, value: undefined };
  }
  let record: Record<string, unknown>;
  try {
    record = formLikeToRecord(rawInput);
  } catch {
    return { present: false, value: undefined };
  }
  const descriptor = witnessGetOwnPropertyDescriptor(record, KOVO_IDEM_FIELD_NAME);
  if (descriptor === undefined) return { present: false, value: undefined };
  if (!('value' in descriptor)) return { present: true, value: undefined };
  const rawValue = descriptor.value;
  const value = isUntrusted(rawValue)
    ? revealUntrusted(rawValue, 'validated request-derived no-js idempotency token')
    : rawValue;
  return { present: true, value };
}

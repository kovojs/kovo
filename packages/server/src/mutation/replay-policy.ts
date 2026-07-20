import { isUntrusted, revealUntrusted, type ScopedKey } from '@kovojs/core';

import { KOVO_IDEM_FIELD_NAME, type CsrfOptions } from '../csrf.js';
import { provenPrincipalFromRequest } from '../auth-principal.js';
import { frameworkRevealUntrustedPolicy } from '../declassification-policy.js';
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
  MutationWireResponse,
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
  witnessOwnKeys,
  witnessReflectApply,
} from '../security-witness-intrinsics.js';
import {
  securityIsPromise,
  securityStringStartsWith,
  securityStringToLowerCase,
} from '../response-security-intrinsics.js';
import { validateMutationIdemToken } from '../mutation-idem.js';
import {
  mergeResponseHeaders,
  type ResponseHeaders,
  type ResponseHeaderValue,
} from '../response.js';
import {
  requestStateExactCompositeKey,
  requestStateIgnorePromiseRejection,
  requestStateIsBoundedMutationReplayIdentity,
} from '../request-state-intrinsics.js';

type MachineReplayPrincipalSelector<Request> = (request: Request) => unknown;

export type EnhancedMutationReplayDelivery = 'buffered' | 'stream';

const ENHANCED_STREAM_REPLAY_HEADER = 'Kovo-Stream';
const ENHANCED_STREAM_REPLAY_HEADER_LOWER = 'kovo-stream';

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
  read(lifecycleRequest: unknown): Promise<Response | undefined> | Response | undefined;
  reserve(
    lifecycleRequest: unknown,
  ):
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

export function enhancedMutationReplayPolicy<
  Request,
  PrincipalRequest extends Request = Request,
>(mode: {
  csrf: CsrfOptions<Request> | false | undefined;
  machineReplayPrincipal?: MachineReplayPrincipalSelector<PrincipalRequest>;
  mutationKey: string;
  request: MutationWireRequest<Request>;
}): MutationLifecycleReplayPolicy<BufferedMutationWireResponse> | undefined {
  const idem: unknown = mode.request.idem;
  if (idem === undefined) {
    return mode.request.replayStore === undefined ? undefined : invalidMutationIdemReplayPolicy();
  }
  const idemFacts = validateMutationIdemToken(idem);
  if (idemFacts === undefined) return invalidMutationIdemReplayPolicy();
  const expectedDelivery: EnhancedMutationReplayDelivery =
    mode.request.stream === true ? 'stream' : 'buffered';
  const principalEpochStore = optionalPrincipalEpochStore(mode.request.principalEpochStore);
  const replayStore = mode.request.replayStore;
  if (!replayStore) return freshnessOnlyMutationIdemReplayPolicy(idemFacts.token);
  const freshnessCheckedStore = {
    async get(
      key: ScopedKey,
      scope: string,
      token: string,
      fingerprint?: string,
      principal?: string,
    ) {
      assertFreshMutationIdem(idemFacts.token);
      const response = await replayStore.get(key, scope, token, fingerprint, principal);
      assertFreshMutationIdem(idemFacts.token);
      return response;
    },
    async reserve(
      key: ScopedKey,
      scope: string,
      token: string,
      fingerprint?: string,
      principal?: string,
    ) {
      assertFreshMutationIdem(idemFacts.token);
      const reservation = await replayStore.reserve(key, scope, token, fingerprint, principal);
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
      principal?: string,
    ) {
      return replayStore.set(key, scope, token, response, fingerprint, principal);
    },
  };
  let context: ReturnType<typeof mutationReplayContext> | undefined;
  let baseScopedContext: Awaited<ReturnType<typeof mutationReplayContext>> | undefined;
  const replayContext = async (lifecycleRequest: unknown): Promise<PrincipalEpochReplayContext> => {
    if (context === undefined) {
      const machineReplayPrincipal = resolveMachineReplayPrincipal(
        mode.csrf,
        mode.machineReplayPrincipal,
        lifecycleRequest,
      );
      context = mutationReplayContext(mode.csrf ?? false, {
        ...mode.request,
        idem: idemFacts.token,
        ...(machineReplayPrincipal === undefined ? {} : { machineReplayPrincipal }),
        mutationKey: mode.mutationKey,
        replayStore: freshnessCheckedStore,
      });
    }
    const resolved = await context;
    // The scope is closed for replay-enabled csrf:false mutations unless an explicit post-guard
    // machine principal was witnessed. Never fall back to a mutation-wide namespace.
    if (mode.csrf === false && resolved.scope === null) throw new MutationReplayConflictError();
    const base = (baseScopedContext ??= resolved);
    return principalEpochReplayContext(
      base,
      principalEpochStore,
      mode.request.request,
      idemFacts.issuedAtMs,
    );
  };
  return {
    async read(lifecycleRequest) {
      const scoped = await replayContext(lifecycleRequest);
      let stored: MutationEndpointReplayResponse | undefined;
      try {
        stored = await readMutationReplay(scoped.context);
      } catch (error) {
        if (error instanceof TypeError) throw new MutationReplayConflictError();
        throw error;
      }
      const response = enhancedReplayResponseOrConflict(stored, expectedDelivery);
      if (response !== undefined) await assertReplayResponseEpochFresh(scoped);
      return response;
    },
    async reserve(lifecycleRequest) {
      const scoped = await replayContext(lifecycleRequest);
      let result: Awaited<ReturnType<typeof reserveMutationReplayBeforeRun>>;
      try {
        result = await reserveMutationReplayBeforeRun(scoped.context);
      } catch (error) {
        if (error instanceof TypeError) throw new MutationReplayConflictError();
        throw error;
      }
      if (result.kind === 'replayed') {
        await assertReplayResponseEpochFresh(scoped);
        return {
          kind: 'replayed',
          response: enhancedReplayResultOrConflict(result.response, expectedDelivery),
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
            return result.reservation.commit(
              bindEnhancedMutationReplayDelivery(response, expectedDelivery),
            );
          },
        },
      };
    },
  };
}

export function noJsMutationReplayPolicy<
  Request,
  Value,
  PrincipalRequest extends Request = Request,
>(mode: {
  csrf: CsrfOptions<Request> | false | undefined;
  machineReplayPrincipal?: MachineReplayPrincipalSelector<PrincipalRequest>;
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
    async get(
      key: ScopedKey,
      scope: string,
      token: string,
      fingerprint?: string,
      principal?: string,
    ) {
      assertFreshMutationIdem(idemFacts.token);
      const response = await replayStore.get(key, scope, token, fingerprint, principal);
      assertFreshMutationIdem(idemFacts.token);
      return response;
    },
    async reserve(
      key: ScopedKey,
      scope: string,
      token: string,
      fingerprint?: string,
      principal?: string,
    ) {
      assertFreshMutationIdem(idemFacts.token);
      const reservation = await replayStore.reserve(key, scope, token, fingerprint, principal);
      if (validateMutationIdemToken(idemFacts.token) === undefined) {
        await reservation?.abort?.();
        throw new MutationReplayConflictError();
      }
      return reservation;
    },
  };

  let context: ReturnType<typeof mutationReplayContext> | undefined;
  const replayContext = async (lifecycleRequest: unknown): Promise<PrincipalEpochReplayContext> => {
    if (context === undefined) {
      const machineReplayPrincipal = resolveMachineReplayPrincipal(
        mode.csrf,
        mode.machineReplayPrincipal,
        lifecycleRequest,
      );
      context = mutationReplayContext(mode.csrf ?? false, {
        idem: idemFacts.token,
        ...(machineReplayPrincipal === undefined ? {} : { machineReplayPrincipal }),
        mutationKey: mode.mutationKey,
        rawInput: mode.request.rawInput,
        request: mode.request.request,
        ...(mode.request.requestFingerprint === undefined
          ? {}
          : { requestFingerprint: mode.request.requestFingerprint }),
      });
    }
    const base = await context;
    if (mode.csrf === false && base.scope === null) throw new MutationReplayConflictError();
    return principalEpochReplayContext(
      base,
      principalEpochStore,
      mode.request.request,
      idemFacts.issuedAtMs,
    );
  };
  // Enhanced and no-JS share one replay claim identity. Their response vocabularies remain closed:
  // a cross-mode retry observes the existing claim and returns an idempotency conflict instead of
  // replaying incompatible bytes or executing the handler again (SPEC §9.1/§10.3).
  return {
    async read(lifecycleRequest) {
      const scoped = await replayContext(lifecycleRequest);
      const context = scoped.context;
      if (context.scope === null) throw new MutationReplayConflictError();
      const scope = context.scope;
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
    async reserve(lifecycleRequest) {
      const scoped = await replayContext(lifecycleRequest);
      const context = scoped.context;
      if (context.scope === null) throw new MutationReplayConflictError();
      const scope = context.scope;
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
            return freshnessCheckedStore.get(
              replayKey,
              scope,
              idemFacts.token,
              fingerprint,
              context.principal,
            );
          },
          reserve(_scope: string, _idem: string, fingerprint?: string) {
            return freshnessCheckedStore.reserve(
              replayKey,
              scope,
              idemFacts.token,
              fingerprint,
              context.principal,
            );
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
        reservation: noJsReplayReservation(result.reservation, idemFacts.token, scoped),
      };
    },
  };
}

function resolveMachineReplayPrincipal<Request, PrincipalRequest extends Request>(
  csrf: CsrfOptions<Request> | false | undefined,
  selector: MachineReplayPrincipalSelector<PrincipalRequest> | undefined,
  lifecycleRequest: unknown,
): string | undefined {
  if (csrf !== false) {
    if (selector !== undefined) throw new MutationReplayConflictError();
    return undefined;
  }
  // SPEC §6.6/§10.3 C9: this callback runs only from replay.read()/reserve(), which the
  // lifecycle reaches after schema parsing and the guard/access decision. Invoke the declaration
  // once against the framework-pinned lifecycle request and accept only an immutable primitive;
  // never coerce an object, accessor, or wrapper that could change between validation and use.
  if (selector === undefined) throw new MutationReplayConflictError();
  let selected: unknown;
  try {
    selected = witnessReflectApply<unknown>(selector, undefined, [lifecycleRequest]);
  } catch {
    // A selector executes app code. Collapse every rejection/throw to the framework's closed
    // idempotency-conflict vocabulary so credential material or attacker-controlled messages
    // cannot escape through the generic mutation error/reporting path.
    throw new MutationReplayConflictError();
  }
  // A cast can bypass the synchronous selector type. Drain a native rejected promise before the
  // closed malformed-value verdict so app-controlled rejection data cannot become an unhandled
  // rejection or terminate a strict Node process after Kovo has already answered 422.
  try {
    if (securityIsPromise(selected)) requestStateIgnorePromiseRejection(selected);
  } catch {
    throw new MutationReplayConflictError();
  }
  if (!requestStateIsBoundedMutationReplayIdentity(selected)) {
    throw new MutationReplayConflictError();
  }
  return selected;
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
  expectedDelivery?: EnhancedMutationReplayDelivery,
): response is BufferedMutationWireResponse {
  const status = stableReplayOwnData(response, 'status');
  const headers = stableReplayOwnData(response, 'headers');
  const contentType = stableReplayHeader(headers, 'Content-Type');
  const reauth = stableReplayHeader(headers, 'Kovo-Reauth');
  const replayDelivery = enhancedReplayDeliveryFromHeaders(headers);
  return (
    status !== undefined &&
    status !== 303 &&
    replayDelivery !== undefined &&
    (expectedDelivery === undefined || replayDelivery === expectedDelivery) &&
    ((typeof contentType === 'string' &&
      securityStringStartsWith(contentType, 'text/vnd.kovo.fragment+html;')) ||
      typeof reauth === 'string')
  );
}

/**
 * Bind one framework mutation response to the negotiated enhanced delivery vocabulary.
 *
 * This is the final live-response/replay-commit seal. It removes every app- or carrier-authored
 * case variant before minting the one canonical stream marker, so response hooks cannot inject,
 * suppress, or duplicate replay delivery authority (SPEC §9.1/§10.3).
 *
 * @internal
 */
export function bindEnhancedMutationReplayDelivery<
  Response extends BufferedMutationWireResponse | MutationWireResponse,
>(response: Response, delivery: EnhancedMutationReplayDelivery): Response {
  const body = requiredStableReplayOwnData(response, 'body');
  const rawHeaders = requiredStableReplayOwnData(response, 'headers');
  const status = requiredStableReplayOwnData(response, 'status');
  return {
    body,
    headers: bindEnhancedReplayDeliveryHeaders(rawHeaders, delivery),
    status,
  } as Response;
}

function bindEnhancedReplayDeliveryHeaders(
  source: unknown,
  delivery: EnhancedMutationReplayDelivery,
): ResponseHeaders {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('Enhanced mutation response headers must be an own-data header record.');
  }

  const beforeKeys = witnessOwnKeys(source);
  let headers = mergeResponseHeaders();
  for (let index = 0; index < beforeKeys.length; index += 1) {
    const name = beforeKeys[index];
    if (typeof name !== 'string') continue;
    const descriptor = stableReplayOwnDataDescriptor(source, name);
    if (descriptor === undefined) {
      throw new TypeError(`Enhanced mutation response header ${name} must be stable own data.`);
    }
    if (!descriptor.enumerable) continue;
    if (securityStringToLowerCase(name) === ENHANCED_STREAM_REPLAY_HEADER_LOWER) continue;
    headers = mergeResponseHeaders(headers, {
      [name]: descriptor.value as ResponseHeaderValue,
    });
  }
  const afterKeys = witnessOwnKeys(source);
  if (!replayOwnKeysMatch(beforeKeys, afterKeys)) {
    throw new TypeError('Enhanced mutation response header names changed during delivery binding.');
  }

  return mergeResponseHeaders(
    headers,
    delivery === 'stream' ? { [ENHANCED_STREAM_REPLAY_HEADER]: 'true' } : undefined,
  );
}

function enhancedReplayDeliveryFromHeaders(
  headers: unknown,
): EnhancedMutationReplayDelivery | undefined {
  if (typeof headers !== 'object' || headers === null || witnessIsArray(headers)) return undefined;
  try {
    const beforeKeys = witnessOwnKeys(headers);
    let markerSeen = false;
    for (let index = 0; index < beforeKeys.length; index += 1) {
      const name = beforeKeys[index];
      if (
        typeof name !== 'string' ||
        securityStringToLowerCase(name) !== ENHANCED_STREAM_REPLAY_HEADER_LOWER
      ) {
        continue;
      }
      if (markerSeen || name !== ENHANCED_STREAM_REPLAY_HEADER) return undefined;
      markerSeen = true;
      const descriptor = stableReplayOwnDataDescriptor(headers, name);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        descriptor.value !== 'true'
      ) {
        return undefined;
      }
    }
    const afterKeys = witnessOwnKeys(headers);
    if (!replayOwnKeysMatch(beforeKeys, afterKeys)) return undefined;
    return markerSeen ? 'stream' : 'buffered';
  } catch {
    return undefined;
  }
}

function replayOwnKeysMatch(
  before: readonly PropertyKey[],
  after: readonly PropertyKey[],
): boolean {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index += 1) {
    if (!witnessObjectIs(before[index], after[index])) return false;
  }
  return true;
}

function stableReplayOwnDataDescriptor(
  source: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
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
    return undefined;
  }
  return before;
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

function requiredStableReplayOwnData(source: object, property: PropertyKey): unknown {
  const descriptor = stableReplayOwnDataDescriptor(source, property);
  if (descriptor === undefined) {
    throw new TypeError(`Enhanced mutation response ${String(property)} must be stable own data.`);
  }
  return descriptor.value;
}

function enhancedReplayResponseOrConflict(
  response: MutationEndpointReplayResponse | undefined,
  expectedDelivery: EnhancedMutationReplayDelivery,
): BufferedMutationWireResponse | undefined {
  if (response === undefined) return undefined;
  return enhancedReplayResultOrConflict(response, expectedDelivery);
}

function enhancedReplayResultOrConflict(
  response: MutationEndpointReplayResponse,
  expectedDelivery: EnhancedMutationReplayDelivery,
): BufferedMutationWireResponse {
  if (isEnhancedReplayResponse(response, expectedDelivery)) return response;
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
    ? revealUntrusted(rawValue, frameworkRevealUntrustedPolicy)
    : rawValue;
  return { present: true, value };
}

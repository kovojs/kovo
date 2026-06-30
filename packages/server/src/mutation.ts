import type { Redirect } from '@kovojs/core';
import {
  forwardSetCookie,
  serializeCookie,
  type CookieOptions,
  type ForwardSetCookiePosture,
} from './cookies.js';
import {
  KOVO_IDEM_FIELD_NAME,
  mutationCsrfOptions,
  validateCsrfToken,
  verifyCsrfRequestOriginFloor,
  type CsrfValidationOptions,
} from './csrf.js';
import { invalidate, mutationRegistryChangeRecords, type ChangeRecord } from './change-record.js';
import { reportServerError } from './diagnostics.js';
import { escapeAttribute, escapeHtml } from './html.js';
import {
  explainGuard,
  guardFailureIsUnauthenticated,
  resolveLifecycleRequest,
  runGuard,
  withGuardArgs,
  type Guard,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { stampGuardFailureDocumentSecurityFloor } from './document-core.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { renderFragmentWireHtml } from './wire-html.js';
import type { JsonSerializable } from './json-boundary.js';
import {
  appendResponseHeader,
  blessRedirectResponse,
  redirectLocationHeader,
  retryAfterHeaders,
  type MutationResponseHeaders,
  type ResponseHeaders,
} from './response.js';
import {
  mutationWireRequestFromHeaders,
  type LiveTargetRenderer,
  type BufferedMutationWireResponse,
  type MutationEndpointRequest,
  type MutationEndpointResponse,
  type MutationWireRequest,
  type MutationWireResponse,
  type NoJsMutationReplayStore,
  type NoJsMutationRequest,
  type NoJsMutationResponse,
} from './mutation-wire.js';
import {
  commitReservedMutationReplay,
  canonicalRequestFingerprint,
  MutationReplayConflictError,
  mutationReplayContext,
  readMutationReplay,
  reserveMutationReplayBeforeRun,
  type MutationReplayStore,
} from './replay.js';
import {
  formLikeToRecord,
  isSchemaValidationError,
  parseSchemaAsync,
  type InferSchema,
  type Schema,
  type ValidationFailurePayload,
} from './schema.js';
import { renderStreamingMutationWireResponse } from './mutation/streaming.js';
import {
  queriesToRerun,
  renderFragmentChunks,
  renderLiveTargetChunks,
  renderQueryChunks,
  selectMutationResponseTargets,
} from './mutation/targets.js';
import { mutationWithRuntimeRegistryFacts, type RuntimeRegistryFacts } from './registry-facts.js';
import type {
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationResult,
  MutationSuccess,
  RunMutationOptions,
} from './mutation/definition.js';
import { isStaleVersionError, staleVersionConflict } from './mutation/stale-version.js';
export {
  errorBoundary,
  mutation,
  mutationFormAttributes,
  queue,
  renderMutationFormAttributes,
  write,
} from './mutation/definition.js';
export type {
  MutationContext,
  MutationDefinition,
  MutationFactory,
  MutationFail,
  MutationFormAttributes,
  MutationFormDefinition,
  MutationOptimisticEntry,
  MutationOptimisticMap,
  MutationOptimisticTransform,
  MutationQueue,
  MutationRegistry,
  MutationResult,
  MutationSuccess,
  QueryRerun,
  RunMutationOptions,
  WriteDefinition,
} from './mutation/definition.js';
// KV429 (SPEC §10.3/§11.1): stale-version conflict signal for optimistic-concurrency mutations.
// `StaleVersionError` is thrown by a handler when 0 rows are updated by the CAS predicate;
// `StaleVersionConflict` is the typed 409 outcome returned by `runMutation`.
export { StaleVersionError } from './mutation/stale-version.js';
export type { StaleVersionConflict } from './mutation/stale-version.js';
export { coalesceMutationStreamChunks, stream } from './mutation/streaming.js';
export { renderLiveTargetChunks } from './mutation/targets.js';
export type {
  MutationStreamChunk,
  MutationStreamContext,
  MutationStreamDoneChunk,
  MutationStreamFragmentChunk,
  MutationStreamFragmentHtml,
  MutationStreamQueryChunk,
  MutationStreamSource,
  MutationStreamTextChunk,
  MutationTextCoalescingPolicy,
} from './mutation/streaming.js';
export { invalidate } from './change-record.js';
export type { ChangeRecord, InvalidateOptions, MutationTouchSite } from './change-record.js';

type MutationLifecycleReplayReservation<Response> = {
  abort?(): void;
  commit(response: Response): void;
};

type MutationLifecycleReplayPolicy<Response> = {
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

type MutationLifecycleOutcome<Value, Input, ReplayResponse> =
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

type ExecuteMutationLifecycleOptions<Request, ReplayResponse> = RunMutationOptions<Request> & {
  catchHandlerErrors?: boolean;
  replay?: MutationLifecycleReplayPolicy<ReplayResponse>;
};

/**
 * Internal mutation lifecycle state machine shared by enhanced, no-JS, and direct
 * mutation execution. It owns the normative SPEC §6.6/§9.1/§10.3 order:
 * CSRF → schema parse → arg-aware guard → replay reserve/read → handler.
 */
async function executeMutationLifecycle<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
  ReplayResponse = never,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: ExecuteMutationLifecycleOptions<Request, ReplayResponse> = {},
): Promise<MutationLifecycleOutcome<Value, InferSchema<InputSchema>, ReplayResponse>> {
  const csrf = mutationCsrfOptions(definition, options.csrf);
  if (
    csrf === undefined ||
    (csrf !== false && !validateCsrfToken(rawInput, request, csrf, { audience: definition.key }))
  ) {
    return {
      failure: { error: { code: 'CSRF', payload: {} }, ok: false, status: 422 },
      kind: 'csrf-failure',
    };
  }

  // SPEC §10.3: parse/coerce before guards so arg-aware guards inspect the same validated input
  // later handed to the handler, and before replay so cached responses cannot bypass revocation.
  const inputResult = options.preParsedInput
    ? { ok: true as const, value: options.preParsedInput.value as InferSchema<InputSchema> }
    : await parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return { failure: inputResult.failure, kind: 'validation-failure' };

  const input = inputResult.value as InferSchema<InputSchema>;
  const lifecycleOptions = {
    ...options,
    guardResolved: true,
    preParsedInput: { value: input },
  } satisfies RunMutationOptions<Request>;
  const lifecycleRequest = withGuardArgs(await resolveLifecycleRequest(request, options), input);

  if (!options.guardResolved) {
    const guardFailure = await runGuard(definition.guard, lifecycleRequest);
    if (guardFailure) {
      const status = mutationGuardFailureStatus(guardFailure);
      return {
        failure: {
          error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
          ok: false,
          ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
          status,
        },
        guardFailure,
        kind: 'guard-failure',
        lifecycleRequest,
      };
    }
  }

  if (options.replay) {
    let replayed: ReplayResponse | undefined;
    try {
      replayed = await options.replay.read();
    } catch (error) {
      if (error instanceof MutationReplayConflictError) return { kind: 'replay-conflict' };
      throw error;
    }
    if (replayed) return { kind: 'replayed', response: replayed };

    let reservationResult: Awaited<
      ReturnType<MutationLifecycleReplayPolicy<ReplayResponse>['reserve']>
    >;
    try {
      reservationResult = await options.replay.reserve();
    } catch (error) {
      if (error instanceof MutationReplayConflictError) return { kind: 'replay-conflict' };
      throw error;
    }
    if (reservationResult.kind === 'conflict') return { kind: 'replay-conflict' };
    if (reservationResult.kind === 'replayed') {
      return { kind: 'replayed', response: reservationResult.response };
    }
    if (reservationResult.kind === 'unavailable') return { kind: 'replay-unavailable' };

    const reservation =
      reservationResult.kind === 'reserved' ? reservationResult.reservation : undefined;
    return runMutationLifecycleHandler(definition, rawInput, request, lifecycleOptions, {
      catchHandlerErrors: options.catchHandlerErrors,
      reservation,
    });
  }

  return runMutationLifecycleHandler(definition, rawInput, request, lifecycleOptions, {
    catchHandlerErrors: options.catchHandlerErrors,
    reservation: undefined,
  });
}

async function runMutationLifecycleHandler<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
  ReplayResponse,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: RunMutationOptions<Request>,
  state: {
    catchHandlerErrors: boolean | undefined;
    reservation: MutationLifecycleReplayReservation<ReplayResponse> | undefined;
  },
): Promise<MutationLifecycleOutcome<Value, InferSchema<InputSchema>, ReplayResponse>> {
  let result: MutationResult<Value, InferSchema<InputSchema>>;
  try {
    result = await runMutation(definition, rawInput, request, options);
  } catch (error) {
    state.reservation?.abort?.();
    if (!state.catchHandlerErrors) throw error;
    return { error, kind: 'handler-error', reservation: state.reservation };
  }

  if (!result.ok) {
    if (result.error.code === 'VALIDATION' || result.status === 429 || result.status === 409) {
      // Validation, transient rate-limit, and KV429 stale-version outcomes are retryable with
      // corrected/fresh state; never store them as idempotent replay responses (SPEC §9.1/§10.3).
      state.reservation?.abort?.();
    }
    return { kind: 'mutation-failure', reservation: state.reservation, result };
  }

  return { kind: 'success', reservation: state.reservation, result };
}

/**
 * Execute a mutation against raw input and a request, returning a typed result
 * without rendering any wire response. Validates CSRF and input, runs guards and
 * the transaction wrapper, and collects the change records. Prefer the render
 * helpers for HTTP; use this when you want the structured result directly (for
 * example in tests) (SPEC §10.3).
 *
 * @param definition - The mutation to run.
 * @param rawInput - Unparsed input (e.g. `FormData` or a record).
 * @param request - The per-request value passed to the handler.
 * @param options - Optional CSRF, session provider, and error hook.
 * @returns A `MutationResult`: a success with changes/value, or a typed failure.
 * @internal
 */
export async function runMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  rawInput: unknown,
  request: Request,
  options: RunMutationOptions<Request> = {},
): Promise<MutationResult<Value, InferSchema<InputSchema>>> {
  const csrf = mutationCsrfOptions(definition, options.csrf);
  if (
    csrf === undefined ||
    (csrf !== false && !validateCsrfToken(rawInput, request, csrf, { audience: definition.key }))
  ) {
    return {
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    };
  }

  // The enhanced/no-JS dispatch paths parse+coerce the input once to thread `req.args` onto the
  // pre-replay arg-aware guard (SPEC §10.3 lifecycle: parse → guard) and pass the parsed value in
  // via `preParsedInput` so we do not re-parse here; direct callers (fixtures/tests) parse here.
  const inputResult = options.preParsedInput
    ? { ok: true as const, value: options.preParsedInput.value as InferSchema<InputSchema> }
    : await parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return inputResult.failure;

  const input = inputResult.value as InferSchema<InputSchema>;
  // SPEC §10.3:1155-1157 ("Guards (arg-aware, normative)"): merge the query's/mutation's *validated*
  // args onto the request so an arg-aware guard (`guards.owns` reading `req.args`) and the handler
  // both see the same `s.*`-coerced values, discharging KV414 for the covered key. In the
  // enhanced/no-JS paths the authoritative arg-aware guard already ran pre-replay against this same
  // merged shape, so `guardResolved` skips the re-run below (avoiding double-running rateLimit).
  const lifecycleRequest = withGuardArgs(await resolveLifecycleRequest(request, options), input);

  // A1 (SPEC §10.3): when the dispatch layer already evaluated the guard chain before the replay
  // lookup, skip it here so a stateful guard (rateLimit) is not double-executed.
  if (!options.guardResolved) {
    const guardFailure = await runGuard(definition.guard, lifecycleRequest);
    if (guardFailure) {
      return {
        error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
        ok: false,
        ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
        status: guardFailure.status,
      };
    }
  }

  const manualInvalidations: ChangeRecord[] = [];
  const responseHeaders: MutationResponseHeaders = {};
  // B3 (SPEC §9.1.1:846): only the typed (name, value, options) builder is exposed;
  // the raw single-string overload has been removed to prevent arbitrary attribute injection.
  function setCookie(name: string, value: string, options?: CookieOptions): void {
    const cookie = serializeCookie(name, value, options);
    appendResponseHeader(responseHeaders, 'Set-Cookie', cookie);
  }

  function forwardCookie(rawSetCookie: string, posture: ForwardSetCookiePosture): void {
    appendResponseHeader(responseHeaders, 'Set-Cookie', forwardSetCookie(rawSetCookie, posture));
  }

  const context = {
    fail<const Code extends Extract<keyof Errors, string>>(
      code: Code,
      payload: JsonSerializable<InferSchema<Errors[Code]>>,
    ): MutationFail<Code, JsonSerializable<InferSchema<Errors[Code]>>> {
      return {
        error: { code, payload },
        ok: false,
        status: 422,
      } as MutationFail<Code, JsonSerializable<InferSchema<Errors[Code]>>>;
    },
    invalidate(domain, options) {
      const record = invalidate(domain, options);
      manualInvalidations.push(record);
      return record;
    },
    setCookie,
    forwardSetCookie: forwardCookie,
    setSessionRevocationClearSiteData() {
      appendResponseHeader(
        responseHeaders,
        'Clear-Site-Data',
        '"cookies", "storage", "executionContexts"',
      );
    },
  } satisfies MutationContext<Errors> & {
    forwardSetCookie: (rawSetCookie: string, posture: ForwardSetCookiePosture) => void;
    setSessionRevocationClearSiteData: () => void;
  };
  const runHandler = async (handlerRequest: GuardedRequest): Promise<Value> => {
    const handlerValue = await definition.handler(input, handlerRequest, context);

    if (isMutationFail(handlerValue)) {
      throw new MutationRollback(handlerValue);
    }

    return handlerValue as Value;
  };
  const guardedRequest = lifecycleRequest as GuardedRequest;

  let value: Value;

  try {
    value = definition.transaction
      ? await definition.transaction(lifecycleRequest, runHandler)
      : await runHandler(guardedRequest);
  } catch (error) {
    if (error instanceof MutationRollback) return error.failure;
    // KV429 (SPEC §10.3/§11.1): a StaleVersionError thrown from the handler (or its
    // transaction wrapper) signals that the CAS predicate matched 0 rows — the row was
    // concurrently modified since the version was read. Return a typed 409 outcome
    // distinct from the IDEMPOTENCY_CONFLICT 409 produced by the replay path.
    if (isStaleVersionError(error)) return staleVersionConflict();
    throw error;
  }

  const changes = [
    ...mutationRegistryChangeRecords(definition.registry, input),
    ...manualInvalidations,
  ];
  const rerunQueryInstances = queriesToRerun(definition.registry?.queries ?? [], changes, input);
  return mutationSuccess(
    {
      changes,
      ok: true,
      ...(Object.keys(responseHeaders).length > 0 ? { responseHeaders } : {}),
      ...(rerunQueryInstances.some((query) => query.instanceKey !== undefined)
        ? { rerunQueryInstances }
        : {}),
      rerunQueries: [...new Set(rerunQueryInstances.map((query) => query.key))],
      value,
    },
    input,
  );
}

function mutationSuccess<Value, Input>(
  result: Omit<MutationSuccess<Value, Input>, 'input'>,
  input: Input,
): MutationSuccess<Value, Input> {
  return Object.defineProperty(result, 'input', {
    enumerable: false,
    value: input,
  }) as MutationSuccess<Value, Input>;
}

class MutationRollback extends Error {
  readonly failure: MutationFail;

  constructor(failure: MutationFail) {
    super(failure.error.code);
    this.name = 'MutationRollback';
    this.failure = failure;
  }
}

/**
 * Run a mutation and render the SPEC §9.1 fragment-wire response (the
 * enhanced/JavaScript path). Prefer `renderMutationEndpointResponse`, which
 * dispatches between this and the no-JS path automatically.
 *
 * @param definition - The mutation to run.
 * @param wireRequest - The parsed wire request (raw input, request, fragment renderers).
 * @returns A `MutationWireResponse` of fragment HTML.
 * @internal
 */
export async function renderMutationResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  wireRequest: MutationWireRequest<Request>,
): Promise<MutationWireResponse> {
  const csrf = mutationCsrfOptions(definition, wireRequest.csrf);
  const lifecycle = await executeMutationLifecycle<
    Key,
    InputSchema,
    Errors,
    Request,
    Value,
    GuardedRequest,
    BufferedMutationWireResponse
  >(definition, wireRequest.rawInput, wireRequest.request, {
    ...runMutationOptions(wireRequest.csrf, wireRequest),
    catchHandlerErrors: true,
    replay: {
      read: () =>
        readMutationReplay(
          mutationReplayContext(csrf ?? false, {
            ...wireRequest,
            mutationKey: definition.key,
          }),
        ),
      reserve: () =>
        reserveMutationReplayBeforeRun(
          mutationReplayContext(csrf ?? false, {
            ...wireRequest,
            mutationKey: definition.key,
          }),
        ),
    },
  });

  if (lifecycle.kind === 'csrf-failure') {
    const reauthResponse = await staleSessionEnhancedCsrfReauthResponse(
      definition,
      csrf,
      wireRequest,
    );
    if (reauthResponse) return reauthResponse;
    return {
      body: await renderFailureFragment(lifecycle.failure, wireRequest),
      headers: mutationWireResponseHeaders(wireRequest),
      status: 422,
    };
  }

  if (lifecycle.kind === 'validation-failure') {
    return {
      body: await renderFailureFragment(lifecycle.failure, wireRequest),
      headers: mutationWireResponseHeaders(wireRequest),
      status: 422,
    };
  }

  if (lifecycle.kind === 'guard-failure') {
    const reauthResponse = enhancedMutationReauthResponse(
      lifecycle.guardFailure,
      lifecycle.lifecycleRequest as Request,
      wireRequest.currentUrl === undefined ? {} : { currentUrl: wireRequest.currentUrl },
    );
    if (reauthResponse) return reauthResponse;
    return {
      body: await renderFailureFragment(lifecycle.failure, wireRequest),
      // A1: a rate-limit (or other retry-able) guard failure carries Retry-After; preserve it on the
      // pre-replay guard-failure response (the old runMutation path added it via retryAfterHeaders).
      headers: {
        ...mutationWireResponseHeaders(wireRequest),
        ...retryAfterHeaders(lifecycle.guardFailure),
      },
      status: lifecycle.failure.status,
    };
  }

  if (lifecycle.kind === 'replay-conflict') return renderReplayConflictFragment(wireRequest);
  if (lifecycle.kind === 'replayed') return lifecycle.response;
  if (lifecycle.kind === 'replay-unavailable') return renderReplayUnavailableFragment(wireRequest);

  if (lifecycle.kind === 'handler-error') {
    reportServerError(wireRequest.onError, lifecycle.error, {
      mutationKey: definition.key,
      operation: 'mutation-handler',
      request: wireRequest.request,
      ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
    });
    return mutationServerErrorResponse(wireRequest);
  }

  if (lifecycle.kind === 'mutation-failure') {
    const result = lifecycle.result;
    if (result.error.code === 'VALIDATION' || result.status === 429 || result.status === 409) {
      return {
        body: await renderFailureFragment(result, wireRequest),
        headers: {
          ...mutationWireResponseHeaders(wireRequest),
          ...retryAfterHeaders(result),
        },
        status: result.status,
      };
    }

    return commitReservedMutationReplay(lifecycle.reservation, async () => ({
      body: await renderFailureFragment(result, wireRequest),
      headers: {
        ...mutationWireResponseHeaders(wireRequest),
        ...retryAfterHeaders(result),
      },
      status: result.status,
    }));
  }

  const { reservation, result } = lifecycle;
  const renderInput = mutationResponseInput(result, wireRequest.rawInput);
  let finalResponse: BufferedMutationWireResponse;
  try {
    finalResponse = await renderSuccessfulMutationWireResponse(
      definition,
      wireRequest,
      result,
      renderInput,
    );
  } catch (error) {
    reportServerError(wireRequest.onError, error, {
      mutationKey: definition.key,
      operation: 'mutation-render',
      request: wireRequest.request,
      ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
    });
    return commitReservedMutationReplay(reservation, async () =>
      mutationRenderErrorResponse(result.changes, wireRequest, result.responseHeaders),
    );
  }

  if (wireRequest.stream === true && definition.stream) {
    // A3 (SPEC §10.3:1063 + §9): do NOT commit the head-only finalResponse before
    // the stream runs — that would replay an unterminated empty body to duplicates.
    // Instead pass the reservation into the streamer so it can commit the full
    // settled body (head + streamed chunks + <kovo-done>) after the stream completes.
    return renderStreamingMutationWireResponse(
      definition.stream({
        input: result.input,
        request: wireRequest.request as GuardedRequest,
        result,
      }),
      finalResponse,
      reservation,
      // L10-1 (SPEC §9): thread the error hook + diagnostic context so a generator that
      // throws mid-stream reports via onError and emits a failure terminator instead of
      // silently hanging the client.
      {
        onError: wireRequest.onError,
        context: {
          mutationKey: definition.key,
          operation: 'mutation-stream',
          request: wireRequest.request,
          ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
        },
      },
    );
  }

  reservation?.commit(finalResponse);
  return finalResponse;
}

async function renderSuccessfulMutationWireResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  wireRequest: MutationWireRequest<Request>,
  result: MutationSuccess<Value, InferSchema<InputSchema>>,
  renderInput: unknown,
): Promise<BufferedMutationWireResponse> {
  const selection = selectMutationResponseTargets({
    changes: result.changes,
    fragmentRenderers: wireRequest.fragmentRenderers ?? [],
    liveTargetDescriptors: wireRequest.liveTargetDescriptors ?? [],
    liveTargetRenderers: wireRequest.liveTargetRenderers ?? [],
    liveTargets: wireRequest.liveTargets,
    registryFacts: mutationRuntimeRegistryFacts(definition, wireRequest.liveTargetRenderers ?? []),
    rerunQueries: result.rerunQueryInstances ?? result.rerunQueries.map((key) => ({ key })),
    targets: wireRequest.targets ?? [],
  });
  const queryChunks = await renderQueryChunks(
    definition.registry?.queries ?? [],
    selection.rerunQueries,
    renderInput,
    wireRequest.request,
    result.changes,
  );
  const fragmentChunks = [
    ...(await renderLiveTargetChunks(
      wireRequest.liveTargetRenderers ?? [],
      selection.liveTargetDescriptors,
      renderInput,
      wireRequest.request,
      wireRequest.csrf,
    )),
    ...(await renderFragmentChunks(
      wireRequest.fragmentRenderers ?? [],
      selection.fragmentTargets,
      renderInput,
    )),
  ];

  // SPEC §5.2.1 rule 2(c): enhanced mutation/full fragment responses are build-scoped
  // payloads, so a successful response must carry the render-plan token.
  const buildHeaders: MutationResponseHeaders = {
    'Kovo-Build': requiredMutationBuildToken(wireRequest),
  };

  return {
    body: [...queryChunks, ...fragmentChunks].join('\n'),
    headers: mergeMutationResponseHeaders(
      mutationWireResponseHeaders(wireRequest),
      {
        'Kovo-Changes': mutationWireChangeHeader(result.changes),
      },
      buildHeaders,
      result.responseHeaders,
    ),
    status: 200,
  };
}

function requiredMutationBuildToken<Request>(wireRequest: MutationWireRequest<Request>): string {
  if (wireRequest.buildToken !== undefined && wireRequest.buildToken !== '') {
    return wireRequest.buildToken;
  }

  throw new TypeError(
    'renderMutationResponse() requires a non-empty buildToken for successful mutation wire responses. SPEC §5.2.1 requires every mutation delta/full response to carry the render-plan token.',
  );
}

function mutationRenderErrorResponse<Request>(
  changes: readonly ChangeRecord[],
  wireRequest: MutationWireRequest<Request>,
  responseHeaders?: MutationResponseHeaders,
): BufferedMutationWireResponse {
  return {
    body: renderMutationRenderErrorFragment(wireRequest),
    headers: mergeMutationResponseHeaders(
      mutationWireResponseHeaders(wireRequest),
      {
        'Kovo-Changes': mutationWireChangeHeader(changes),
      },
      responseHeaders,
    ),
    status: 500,
  };
}

function mutationServerErrorResponse<Request>(
  wireRequest: MutationWireRequest<Request>,
): MutationWireResponse {
  return {
    body: renderMutationServerErrorFragment(wireRequest),
    headers: mutationWireResponseHeaders(wireRequest),
    status: 500,
  };
}

function renderReplayConflictFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): BufferedMutationWireResponse {
  return {
    body: renderFragmentWireHtml({
      html: '<output role="alert" data-error-code="IDEMPOTENCY_CONFLICT">Conflict</output>',
      target: mutationFailureTarget(wireRequest),
    }),
    headers: mutationWireResponseHeaders(wireRequest),
    status: 422,
  };
}

/**
 * Run a mutation and render the single response that serves both modes: the
 * SPEC §9.1 fragment wire when the request carries the enhancement headers, and
 * a POST-redirect-GET document otherwise. One handler answers JavaScript and
 * no-JavaScript clients identically (SPEC §6.3, §9.1).
 *
 * @param definition - The mutation to run.
 * @param endpointRequest - Raw input, request, wire headers, `redirectTo`, fragment renderers, and failure renderers.
 * @returns A `MutationEndpointResponse` (status, headers, body).
 * @internal
 * @example
 * import { mutation, s } from '@kovojs/server';
 * import { renderMutationEndpointResponse } from '@kovojs/server/internal/wire';
 *
 * interface Req { db: { add(id: string): void } }
 *
 * const addToCart = mutation('cart/add', {
 *   csrf: false,
 *   input: s.object({ productId: s.string() }),
 *   handler(input, request: Req) {
 *     request.db.add(input.productId);
 *     return { productId: input.productId };
 *   },
 * });
 *
 * export function submit(rawInput: unknown, request: Req, headers: Headers) {
 *   return renderMutationEndpointResponse(addToCart, {
 *     fragmentRenderers: [],
 *     headers,
 *     rawInput,
 *     redirectTo: '/',
 *     request,
 *   });
 * }
 */
export async function renderMutationEndpointResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  endpointRequest: MutationEndpointRequest<Request, Value>,
): Promise<MutationEndpointResponse> {
  const liveTargetRenderers =
    endpointRequest.liveTargetRenderers ?? registeredGeneratedLiveTargetRenderers<Request>();
  const endpointDefinition = mutationWithRuntimeRegistryFacts(definition, {
    liveTargetRenderers,
    queries: [],
  });
  const wireRequest = mutationWireRequestFromHeaders({
    ...endpointRequest,
    liveTargetRenderers,
    mutationKey: definition.key,
  });
  if (wireRequest.fragment) return renderMutationResponse(endpointDefinition, wireRequest);

  return renderNoJsMutationResponse(endpointDefinition, {
    ...(endpointRequest.csrf === undefined ? {} : { csrf: endpointRequest.csrf }),
    ...(endpointRequest.currentUrl === undefined ? {} : { currentUrl: endpointRequest.currentUrl }),
    rawInput: endpointRequest.rawInput,
    redirectTo: endpointRequest.redirectTo,
    ...(wireRequest.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: wireRequest.requestFingerprint }),
    // SPEC §10.3:1151 ("atomic reservation … for all mutation paths — the enhanced and no-JS
    // mutation() lifecycle"): thread the same injected replay store into the no-JS POST-redirect-GET
    // branch as the enhanced wire branch so duplicate/concurrent no-JS submits dedup onto one handler
    // run. The store is adapted to the 303-capable NoJsMutationReplayStore shape (records are
    // namespaced by `noJsReplayScopeFor` so no-JS 303s never collide with enhanced 200s).
    ...(endpointRequest.replayStore === undefined
      ? {}
      : { replayStore: noJsReplayStoreFromMutationStore(endpointRequest.replayStore) }),
    ...(endpointRequest.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: endpointRequest.renderFailurePage }),
    request: endpointRequest.request,
    ...(endpointRequest.db === undefined ? {} : { db: endpointRequest.db }),
    ...(endpointRequest.onError === undefined ? {} : { onError: endpointRequest.onError }),
    ...(endpointRequest.sessionProvider === undefined
      ? {}
      : { sessionProvider: endpointRequest.sessionProvider }),
  });
}

/**
 * Adapt the app's enhanced {@link MutationReplayStore} (200/4xx/5xx wire responses, used by the
 * `Kovo-Fragment` path) into a {@link NoJsMutationReplayStore} (303 redirect responses) so the
 * no-JS POST-redirect-GET path shares the same injected idempotency store. SPEC §10.3:1151 requires
 * the atomic-reservation replay floor for ALL mutation paths, including the no-JS `mutation()`
 * lifecycle. Only `get`/`reserve` are used (the no-JS path never calls `set`); the redirect body is
 * a plain string the store treats opaquely, and no-JS records are namespaced (`nojs:` scope, see
 * {@link noJsReplayScopeFor}) so they can never replay across the enhanced/no-JS status boundary.
 */
function noJsReplayStoreFromMutationStore(
  store: MutationReplayStore<BufferedMutationWireResponse>,
): NoJsMutationReplayStore {
  return {
    get(scope, idem, fingerprint) {
      return store.get(scope, idem, fingerprint) as unknown as
        | Promise<NoJsMutationResponse | undefined>
        | NoJsMutationResponse
        | undefined;
    },
    reserve(scope, idem, fingerprint) {
      const reservation = store.reserve(scope, idem, fingerprint);
      if (!reservation) return undefined;
      return {
        ...(reservation.abort === undefined ? {} : { abort: () => reservation.abort?.() }),
        commit(response) {
          reservation.commit(response as unknown as BufferedMutationWireResponse);
        },
      };
    },
  };
}

function mutationRuntimeRegistryFacts<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  renderers: readonly LiveTargetRenderer<Request>[],
): RuntimeRegistryFacts<Request> {
  return {
    liveTargetRenderers: renderers,
    queries: (definition.registry?.queries ?? []) as RuntimeRegistryFacts<Request>['queries'],
  };
}

/**
 * Run a mutation and render the no-JavaScript POST-redirect-GET response: a 303
 * redirect on success, or a re-rendered failure page. The fallback half of
 * `renderMutationEndpointResponse` (SPEC §6.3).
 *
 * Wires the replay reservation lifecycle so duplicate no-JS form submissions
 * (Back-resubmit / double-click) are deduplicated via the `Kovo-Idem` hidden
 * field (A2, SPEC §10.3:1063).
 *
 * @param definition - The mutation to run.
 * @param noJsRequest - Raw input, request, `redirectTo`, and optional failure-page renderer.
 * @returns A `NoJsMutationResponse` (redirect or document).
 * @internal
 */
export async function renderNoJsMutationResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const csrf = mutationCsrfOptions(definition, noJsRequest.csrf);
  // A2 (SPEC §10.3:1063/1151): derive the idem from the hidden `Kovo-Idem` form field. A real no-JS
  // POST arrives as `FormData` (or a pre-parsed record), so the field must be READ via
  // `formLikeToRecord` (which materializes FormData entries) — the `in` operator never sees FormData
  // entries and silently disabled this floor for every real submit. The explicit `idem` option wins
  // for callers that supply it directly (tests / pre-resolved tokens).
  const idem = noJsRequest.idem ?? readNoJsIdemField(noJsRequest.rawInput);
  const noJsScope = noJsReplayScopeFor(csrf, definition.key, noJsRequest.request);
  const requestFingerprint =
    noJsRequest.requestFingerprint ?? canonicalRequestFingerprint(noJsRequest.rawInput);
  const replay =
    idem && noJsRequest.replayStore
      ? ({
          read: () => noJsRequest.replayStore?.get(noJsScope, idem, requestFingerprint),
          async reserve() {
            let reservation = noJsRequest.replayStore?.reserve(noJsScope, idem, requestFingerprint);
            if (reservation) return { kind: 'reserved' as const, reservation };

            const pending = await noJsRequest.replayStore?.get(noJsScope, idem, requestFingerprint);
            if (pending) return { kind: 'replayed' as const, response: pending };

            reservation = noJsRequest.replayStore?.reserve(noJsScope, idem, requestFingerprint);
            return reservation
              ? { kind: 'reserved' as const, reservation }
              : { kind: 'unavailable' as const };
          },
        } satisfies MutationLifecycleReplayPolicy<NoJsMutationResponse>)
      : undefined;
  const lifecycle = await executeMutationLifecycle<
    Key,
    InputSchema,
    Errors,
    Request,
    Value,
    GuardedRequest,
    NoJsMutationResponse
  >(definition, noJsRequest.rawInput, noJsRequest.request, {
    ...runMutationOptions(noJsRequest.csrf, noJsRequest),
    catchHandlerErrors: true,
    ...(replay === undefined ? {} : { replay }),
  });

  if (lifecycle.kind === 'csrf-failure') {
    const reauthResponse = await staleSessionNoJsCsrfReauthResponse(definition, csrf, noJsRequest);
    if (reauthResponse) return reauthResponse;
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'validation-failure') {
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'guard-failure') {
    const reauthResponse = noJsMutationReauthResponse(
      lifecycle.guardFailure,
      lifecycle.lifecycleRequest as Request,
      noJsRequest.currentUrl === undefined ? {} : { currentUrl: noJsRequest.currentUrl },
    );
    if (reauthResponse) return reauthResponse;
    return renderNoJsMutationFailureResponse(lifecycle.failure, noJsRequest);
  }

  if (lifecycle.kind === 'replay-conflict') return renderNoJsReplayConflictPage(noJsRequest);
  if (lifecycle.kind === 'replayed') return lifecycle.response;
  if (lifecycle.kind === 'replay-unavailable') return renderNoJsReplayUnavailablePage(noJsRequest);
  if (lifecycle.kind === 'handler-error') {
    reportServerError(noJsRequest.onError, lifecycle.error, {
      mutationKey: definition.key,
      operation: 'no-js-mutation-handler',
      request: noJsRequest.request,
    });
    return noJsMutationServerErrorResponse();
  }

  if (lifecycle.kind === 'mutation-failure') {
    lifecycle.reservation?.abort?.();
    return renderNoJsMutationFailureResponse(lifecycle.result, noJsRequest);
  }

  const successResponse = blessRedirectResponse({
    body: '',
    headers: mergeMutationResponseHeaders(
      {
        'Cache-Control': 'no-store',
        Location: redirectLocationHeader(
          mutationRedirectLocation(noJsRequest.redirectTo, lifecycle.result),
        ),
      },
      lifecycle.result.responseHeaders,
    ),
    status: 303 as const,
  });
  lifecycle.reservation?.commit(successResponse);
  return successResponse;
}

async function renderNoJsMutationFailureResponse<Request, Value>(
  failure: MutationFail,
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const body = noJsRequest.renderFailurePage
    ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
    : renderDefaultFailurePage(failure);

  return {
    body,
    headers: stampNoJsMutationFailureHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      ...retryAfterHeaders(failure),
    }),
    status: failure.status,
  };
}

/**
 * Read the per-submit `Kovo-Idem` token from a no-JS form body (A2, SPEC §10.3:1063/1151).
 *
 * A real no-JS POST arrives as `FormData`; `formLikeToRecord` materializes its entries (and
 * passes a pre-parsed record through unchanged), so the hidden `Kovo-Idem` field is actually
 * read rather than missed by an `in`-operator probe that FormData entries never satisfy. Returns
 * `undefined` for a non-object body or an absent/empty field so the caller falls through to the
 * unprotected path only when there is genuinely no idem token.
 */
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

/**
 * Derive the replay scope for the no-JS form path (A2 + GAP4-2, SPEC §10.3:1062-1066/1151).
 *
 * Scopes by (mutation-key, session-id) when a session is available; for `csrf:false`
 * or sessionless mutations, falls back to a mutation-key namespace so a stable
 * `Kovo-Idem` still dedups duplicate external POSTs. Every scope carries a `nojs:` prefix so
 * no-JS 303 records share a key space with no enhanced 200-wire record when one injected
 * {@link MutationReplayStore} backs both mutation paths (see `noJsReplayStoreFromMutationStore`).
 */
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

function isMutationFail(value: unknown): value is MutationFail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value
  );
}

function mutationRedirectLocation<Value>(
  redirectTo: string | Redirect | ((result: MutationSuccess<Value>) => string | Redirect),
  result: MutationSuccess<Value>,
): string {
  const target = typeof redirectTo === 'function' ? redirectTo(result) : redirectTo;
  // SPEC §6.4/§9.1 (PRG): a typed `redirect()` value carries its path-typed `location`; a plain
  // string is the location itself. Either way the framework Location sink re-sanitizes (SPEC §6.6),
  // so an app-derived `redirect()` location and a legacy string path converge on the same emission.
  return redirectLocationHeader(typeof target === 'string' ? target : target.location);
}

function noJsMutationServerErrorResponse(): NoJsMutationResponse {
  return {
    body: 'Internal Server Error',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 500,
  };
}

async function renderReplayUnavailableFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): Promise<MutationWireResponse> {
  return {
    body: await renderFailureFragment(replayUnavailableFailure(), wireRequest),
    headers: {
      ...mutationWireResponseHeaders(wireRequest),
      'Retry-After': '1',
    },
    status: 429,
  };
}

async function renderNoJsReplayUnavailablePage<Request, Value>(
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const failure = replayUnavailableFailure();
  return {
    body: noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
      : renderDefaultFailurePage(failure),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '1',
    },
    status: 429,
  };
}

async function renderNoJsReplayConflictPage<Request, Value>(
  noJsRequest: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse> {
  const failure: MutationFail = {
    error: { code: 'IDEMPOTENCY_CONFLICT', payload: {} },
    ok: false,
    status: 422,
  };
  return {
    body: noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(failure, noJsRequest.rawInput)
      : renderDefaultFailurePage(failure),
    headers: stampNoJsMutationFailureHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    status: 422,
  };
}

function replayUnavailableFailure(): MutationFail<'RATE_LIMITED', { reason: string }> {
  return {
    error: { code: 'RATE_LIMITED', payload: { reason: 'replay-unavailable' } },
    ok: false,
    retryAfter: 1,
    status: 429,
  };
}

function mergeMutationResponseHeaders(
  ...sources: readonly (MutationResponseHeaders | undefined)[]
): MutationResponseHeaders {
  const headers: MutationResponseHeaders = {};

  for (const source of sources) {
    if (!source) continue;

    for (const [name, value] of Object.entries(source)) {
      appendResponseHeader(headers, name, value);
    }
  }

  return headers;
}

async function parseMutationInput<InputSchema extends Schema<unknown>>(
  schema: InputSchema,
  rawInput: unknown,
): Promise<
  | { ok: true; value: InferSchema<InputSchema> }
  | { failure: MutationFail<'VALIDATION', ValidationFailurePayload>; ok: false }
> {
  try {
    return {
      ok: true,
      value: (await parseSchemaAsync(schema, rawInput)) as InferSchema<InputSchema>,
    };
  } catch (error) {
    if (!isSchemaValidationError(error)) throw error;

    return {
      failure: {
        error: {
          code: 'VALIDATION',
          payload: { issues: error.issues },
        },
        ok: false,
        status: 422,
      },
      ok: false,
    };
  }
}

function runMutationOptions<Request>(
  csrf: CsrfValidationOptions<Request> | undefined,
  lifecycle?: RequestLifecycleOptions<Request>,
): RunMutationOptions<Request> {
  return {
    ...(csrf === undefined ? {} : { csrf }),
    ...(lifecycle?.db === undefined ? {} : { db: lifecycle.db }),
    ...(lifecycle?.onError === undefined ? {} : { onError: lifecycle.onError }),
    ...(lifecycle?.sessionProvider === undefined
      ? {}
      : { sessionProvider: lifecycle.sessionProvider }),
  };
}

function mutationWireChangeRecords(
  changes: readonly ChangeRecord[],
): Pick<ChangeRecord, 'domain' | 'keys'>[] {
  return changes.map((change) => ({
    domain: change.domain,
    ...(change.keys === undefined ? {} : { keys: change.keys }),
  }));
}

function mutationWireChangeHeader(changes: readonly ChangeRecord[]): string {
  return asciiJsonHeaderValue(mutationWireChangeRecords(changes));
}

function asciiJsonHeaderValue(value: unknown): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function mutationResponseInput<Value>(result: MutationSuccess<Value>, rawInput: unknown): unknown {
  if (Object.hasOwn(result, 'input')) return result.input;

  return result.changes.find((change) => change.input !== undefined)?.input ?? rawInput;
}

async function renderFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
): Promise<string> {
  const target = mutationFailureTarget(wireRequest);
  const html = wireRequest.renderFailureFragment
    ? await wireRequest.renderFailureFragment(failure, wireRequest.rawInput)
    : await renderDefaultFailureFragment(failure, wireRequest, target);

  return renderFragmentWireHtml({
    html,
    stylesheets: wireRequest.failureStylesheets,
    target,
  });
}

async function renderDefaultFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
  target: string,
): Promise<string> {
  const descriptor = wireRequest.liveTargetDescriptors?.find((entry) => entry.target === target);
  const renderer =
    descriptor === undefined
      ? undefined
      : wireRequest.liveTargetRenderers?.find(
          (candidate) => candidate.component === descriptor.component,
        );
  if (descriptor && renderer) {
    return renderer.render({
      failure,
      input: wireRequest.rawInput,
      ...(wireRequest.csrf === undefined ? {} : { csrf: wireRequest.csrf }),
      ...(wireRequest.mutationKey === undefined ? {} : { mutationKey: wireRequest.mutationKey }),
      props: descriptor.props,
      request: wireRequest.request,
      target,
    });
  }

  return renderDefaultFailureFragmentContent(failure);
}

function renderMutationRenderErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = mutationFailureTarget(wireRequest);

  return renderFragmentWireHtml({
    html: '<output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output>',
    target,
  });
}

function renderMutationServerErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = mutationFailureTarget(wireRequest);

  return renderFragmentWireHtml({
    html: '<output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output>',
    stylesheets: wireRequest.failureStylesheets,
    target,
  });
}

function mutationFailureTarget<Request>(wireRequest: MutationWireRequest<Request>): string {
  return (
    wireRequest.failureTarget ??
    wireRequest.submittedFormTarget ??
    wireRequest.targets?.[0] ??
    'error'
  );
}

function renderDefaultFailureFragmentContent(failure: MutationFail): string {
  if (failure.error.code === 'VALIDATION' && isValidationFailurePayload(failure.error.payload)) {
    return failure.error.payload.issues
      .map(
        (issue) =>
          `<output role="alert" data-error-path="${escapeAttribute(issue.path.join('.'))}">${escapeHtml(issue.message)}</output>`,
      )
      .join('');
  }

  return `<output role="alert" data-error-code="${escapeAttribute(failure.error.code)}">${escapeHtml(JSON.stringify(failure.error.payload))}</output>`;
}

function isValidationFailurePayload(value: unknown): value is ValidationFailurePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'issues' in value &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        'message' in issue &&
        typeof issue.message === 'string' &&
        'path' in issue &&
        Array.isArray(issue.path) &&
        issue.path.every((part: unknown) => typeof part === 'string'),
    )
  );
}

function renderDefaultFailurePage(failure: MutationFail): string {
  if (failure.error.code === 'VALIDATION' && isValidationFailurePayload(failure.error.payload)) {
    return `<!doctype html><html><body>${renderDefaultFailureFragmentContent(failure)}</body></html>`;
  }

  return `<!doctype html><html><body><output role="alert" data-error-code="${escapeAttribute(failure.error.code)}">${escapeHtml(JSON.stringify(failure.error.payload))}</output></body></html>`;
}

function stampNoJsMutationFailureHeaders(headers: ResponseHeaders): ResponseHeaders {
  return stampGuardFailureDocumentSecurityFloor({
    body: '',
    headers,
    status: 422,
  }).headers;
}

function mutationWireResponseHeaders<Request>(
  wireRequest: MutationWireRequest<Request>,
): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
    Vary: 'Cookie',
    ...(wireRequest.buildToken ? { 'Kovo-Build': wireRequest.buildToken } : {}),
    ...(wireRequest.idem ? { 'Kovo-Idem': wireRequest.idem } : {}),
  };
}

function enhancedMutationReauthResponse<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
  options: { currentUrl?: string },
): BufferedMutationWireResponse | undefined {
  if (!mutationGuardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  // SPEC §6.5: enhanced unauthenticated mutation guard failures re-enter auth
  // with a 401 Kovo-Reauth directive instead of rendering validation UI.
  return {
    body: '',
    headers: {
      ...mutationWireResponseHeaders({} as MutationWireRequest<Request>),
      'Kovo-Reauth': loginLocation(options.currentUrl ?? '/'),
    },
    status: 401,
  };
}

async function staleSessionEnhancedCsrfReauthResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfValidationOptions<Request> | false | undefined,
  request: MutationWireRequest<Request>,
): Promise<BufferedMutationWireResponse | undefined> {
  const lifecycleRequest = await staleSessionCsrfLifecycleRequest(definition, csrf, request);
  if (!lifecycleRequest) return undefined;
  return enhancedMutationReauthResponse(
    {
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      status: 422,
    },
    lifecycleRequest,
    { currentUrl: request.currentUrl ?? '/' },
  );
}

async function staleSessionNoJsCsrfReauthResponse<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfValidationOptions<Request> | false | undefined,
  request: NoJsMutationRequest<Request, Value>,
): Promise<NoJsMutationResponse | undefined> {
  const lifecycleRequest = await staleSessionCsrfLifecycleRequest(definition, csrf, request);
  if (!lifecycleRequest) return undefined;
  return noJsMutationReauthResponse(
    {
      auth: 'unauthenticated',
      code: 'UNAUTHORIZED',
      status: 422,
    },
    lifecycleRequest,
    { currentUrl: request.currentUrl ?? '/' },
  );
}

async function staleSessionCsrfLifecycleRequest<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request = Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  csrf: CsrfValidationOptions<Request> | false | undefined,
  request: MutationWireRequest<Request> | NoJsMutationRequest<Request, Value>,
): Promise<Request | undefined> {
  if (csrf === undefined || csrf === false) return undefined;
  if (!sessionGuardedMutation(definition)) return undefined;
  if (!hasSubmittedCsrfTokenShape(request.rawInput, csrf.field ?? 'kovo-csrf')) return undefined;
  if (!verifyCsrfRequestOriginFloor(request.request, csrf)) return undefined;

  const lifecycleRequest = await resolveLifecycleRequest(
    request.request,
    runMutationOptions(request.csrf, request),
  );
  if (requestHasSessionUser(lifecycleRequest)) return undefined;
  return lifecycleRequest;
}

function sessionGuardedMutation<Request>(definition: { guard?: Guard<Request> }): boolean {
  return explainGuard(definition.guard).some((fact) => 'auth' in fact && fact.auth !== undefined);
}

function requestHasSessionUser(request: unknown): boolean {
  return Boolean(
    (request as { session?: { user?: unknown } | null } | null | undefined)?.session?.user,
  );
}

function hasSubmittedCsrfTokenShape(rawInput: unknown, field: string): boolean {
  const submitted = formLikeToRecord(rawInput)[field];
  return (
    typeof submitted === 'string' && /^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u.test(submitted)
  );
}

function noJsMutationReauthResponse<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
  options: { currentUrl?: string },
): NoJsMutationResponse | undefined {
  if (!mutationGuardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  return blessRedirectResponse({
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: redirectLocationHeader(loginLocation(options.currentUrl ?? '/')),
    },
    status: 303 as const,
  });
}

function mutationGuardFailureIsUnauthenticated<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
): boolean {
  // SPEC §6.5: mutation reauth is reserved for auth guard failures. Non-auth guard denials such as
  // RATE_LIMITED must preserve their own status/Retry-After instead of being inferred as sessionless
  // login redirects.
  if (guardFailure.code !== 'UNAUTHORIZED' || guardFailure.status !== 422) return false;
  return guardFailureIsUnauthenticated(guardFailure, request);
}

function mutationGuardFailureStatus(guardFailure: ResolvedGuardFailure): 403 | 422 | 429 {
  if (guardFailure.auth === 'unauthorized') return 403;
  return guardFailure.status as 422 | 429;
}

function loginLocation(next: string): string {
  const url = new URL('/login', 'https://kovo.local');
  url.searchParams.set('next', next.startsWith('/') && !next.startsWith('//') ? next : '/');
  return `${url.pathname}${url.search}${url.hash}`;
}

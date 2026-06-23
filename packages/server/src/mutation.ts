import { serializeCookie, type CookieOptions } from './cookies.js';
import { mutationCsrfOptions, validateCsrfToken, type CsrfValidationOptions } from './csrf.js';
import {
  invalidate,
  mutationRegistryChangeRecords,
  type ChangeRecord,
  type MutationTouchSite,
} from './change-record.js';
import { reportServerError } from './diagnostics.js';
import { escapeAttribute, escapeHtml } from './html.js';
import {
  guardFailureIsUnauthenticated,
  resolveLifecycleRequest,
  runGuard,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { registeredGeneratedMutationTouches } from './generated-mutation-registry.js';
import { queryWithGeneratedReads } from './generated-query-registry.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { renderFragmentWireHtml } from './wire-html.js';
import type { RegisteredQueryDefinition } from './query.js';
import {
  appendResponseHeader,
  retryAfterHeaders,
  type MutationResponseHeaders,
} from './response.js';
import {
  mutationWireRequestFromHeaders,
  type LiveTargetRenderer,
  type BufferedMutationWireResponse,
  type MutationEndpointRequest,
  type MutationEndpointResponse,
  type MutationWireRequest,
  type MutationWireResponse,
  type NoJsMutationRequest,
  type NoJsMutationResponse,
} from './mutation-wire.js';
import {
  commitReservedMutationReplay,
  mutationReplayContext,
  readMutationReplay,
  reserveMutationReplayBeforeRun,
} from './replay.js';
import {
  isSchemaValidationError,
  parseSchemaAsync,
  type InferSchema,
  type Schema,
  type ValidationFailurePayload,
} from './schema.js';
import {
  coalesceMutationStreamChunks,
  renderStreamingMutationWireResponse,
} from './mutation/streaming.js';
import {
  queriesToRerun,
  renderFragmentChunks,
  renderLiveTargetChunks,
  renderQueryChunks,
  selectMutationResponseTargets,
} from './mutation/targets.js';
import type {
  MutationContext,
  MutationDefinition,
  MutationFail,
  MutationRegistry,
  MutationResult,
  MutationSuccess,
  QueryRerun,
  RunMutationOptions,
} from './mutation/definition.js';
export {
  errorBoundary,
  mutation,
  mutationFormAttributes,
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
  MutationRegistry,
  MutationResult,
  MutationSuccess,
  QueryRerun,
  RunMutationOptions,
  WriteDefinition,
} from './mutation/definition.js';
export { coalesceMutationStreamChunks, stream } from './mutation/streaming.js';
export { renderLiveTargetChunks } from './mutation/targets.js';
export type {
  MutationStreamChunk,
  MutationStreamContext,
  MutationStreamDoneChunk,
  MutationStreamFragmentChunk,
  MutationStreamQueryChunk,
  MutationStreamSource,
  MutationStreamTextChunk,
  MutationTextCoalescingPolicy,
} from './mutation/streaming.js';
export { invalidate } from './change-record.js';
export type { ChangeRecord, InvalidateOptions, MutationTouchSite } from './change-record.js';

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
  if (csrf === undefined || (csrf !== false && !validateCsrfToken(rawInput, request, csrf))) {
    return {
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const inputResult = await parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return inputResult.failure;

  const input = inputResult.value as InferSchema<InputSchema>;
  const lifecycleRequest = await resolveLifecycleRequest(request, options);

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

  const context: MutationContext<Errors> = {
    fail(code, payload) {
      return {
        error: { code, payload },
        ok: false,
        status: 422,
      };
    },
    invalidate(domain, options) {
      const record = invalidate(domain, options);
      manualInvalidations.push(record);
      return record;
    },
    setCookie,
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
  if (
    csrf === undefined ||
    (csrf !== false && !validateCsrfToken(wireRequest.rawInput, wireRequest.request, csrf))
  ) {
    return {
      body: await renderFailureFragment(
        {
          error: { code: 'CSRF', payload: {} },
          ok: false,
          status: 422,
        },
        wireRequest,
      ),
      headers: mutationWireResponseHeaders(wireRequest),
      status: 422,
    };
  }

  // A1 (SPEC §10.3:1061): evaluate the session-bound guard chain against the
  // *current* principal BEFORE checking the replay store. A replay hit must not
  // bypass authorization — the cached response was produced for an authorized
  // principal; if that principal's role has since been revoked, we must reject.
  // Order: CSRF (above) → lifecycle/guard → replay reserve/lookup → handler.
  const lifecycleRequestForGuard = await resolveLifecycleRequest(
    wireRequest.request,
    runMutationOptions(wireRequest.csrf, wireRequest),
  );
  const guardFailure = await runGuard(definition.guard, lifecycleRequestForGuard);
  if (guardFailure) {
    const reauthResponse = enhancedMutationReauthResponse(
      guardFailure,
      lifecycleRequestForGuard,
      wireRequest.currentUrl === undefined ? {} : { currentUrl: wireRequest.currentUrl },
    );
    if (reauthResponse) return reauthResponse;
    const status = mutationGuardFailureStatus(guardFailure);
    return {
      body: await renderFailureFragment(
        {
          error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
          ok: false,
          ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
          status,
        },
        wireRequest,
      ),
      // A1: a rate-limit (or other retry-able) guard failure carries Retry-After; preserve it on the
      // pre-replay guard-failure response (the old runMutation path added it via retryAfterHeaders).
      headers: { ...mutationWireResponseHeaders(wireRequest), ...retryAfterHeaders(guardFailure) },
      status,
    };
  }

  // Security finding M4: reserve the replay record BEFORE running the handler
  // (mirroring the webhook get→reserve→run order) so concurrent Kovo-Idem
  // duplicates coalesce onto one handler execution. The replay scope folds in the
  // mutation key (see mutationReplayContext) so the reservation is per-(session,
  // mutation, idem).
  const replay = mutationReplayContext(csrf, {
    ...wireRequest,
    mutationKey: definition.key,
  });
  const replayed = await readMutationReplay(replay);
  if (replayed) return replayed;

  const reservationResult = await reserveMutationReplayBeforeRun(replay);
  if (reservationResult.kind === 'replayed') return reservationResult.response;
  if (reservationResult.kind === 'unavailable') return renderReplayUnavailableFragment(wireRequest);
  const reservation =
    reservationResult.kind === 'reserved' ? reservationResult.reservation : undefined;

  let result: MutationResult<Value, InferSchema<InputSchema>>;
  try {
    result = await runMutation(definition, wireRequest.rawInput, wireRequest.request, {
      ...runMutationOptions(wireRequest.csrf, wireRequest),
      guardResolved: true,
    });
  } catch (error) {
    // The handler threw before producing a result; release the reservation so a
    // retry can run, then surface the server-error fragment (never replayed).
    reservation?.abort?.();
    reportServerError(wireRequest.onError, error, {
      mutationKey: definition.key,
      operation: 'mutation-handler',
      request: wireRequest.request,
      ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
    });
    return mutationServerErrorResponse(wireRequest);
  }

  if (!result.ok) {
    if (result.error.code === 'VALIDATION' || result.status === 429) {
      // Pure schema validation failures and transient 429 rate-limits are not
      // replayable (SPEC §9.1.1:904, A5): abandon the reservation so a corrected
      // retry or post-window retry runs the handler fresh.
      reservation?.abort?.();
      return {
        body: await renderFailureFragment(result, wireRequest),
        headers: {
          ...mutationWireResponseHeaders(wireRequest),
          ...retryAfterHeaders(result),
        },
        status: result.status,
      };
    }

    return commitReservedMutationReplay(reservation, async () => ({
      body: await renderFailureFragment(result, wireRequest),
      headers: {
        ...mutationWireResponseHeaders(wireRequest),
        ...retryAfterHeaders(result),
      },
      status: result.status,
    }));
  }

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
    queryDefinitions: definition.registry?.queries ?? [],
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

  // Kovo-Build header: present on every 200 mutation response when a build token
  // is known, so the client can detect deploy skew (SPEC §5.1, §9.1.1).
  const buildHeaders: MutationResponseHeaders =
    wireRequest.buildToken !== undefined && wireRequest.buildToken !== ''
      ? { 'Kovo-Build': wireRequest.buildToken }
      : {};

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
  const endpointDefinition = mutationWithGeneratedRegistryFacts(definition, liveTargetRenderers);
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

function mutationWithGeneratedRegistryFacts<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  GuardedRequest extends Request,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
  renderers: readonly LiveTargetRenderer<Request>[],
): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> {
  const queries = renderers.flatMap((renderer) => renderer.queryDefinitions ?? []);
  const inferredTouches = registeredGeneratedMutationTouches(definition.key);
  if (queries.length === 0 && inferredTouches.length === 0) return definition;

  return {
    ...definition,
    registry: mergeMutationRegistryFacts(definition.registry, { inferredTouches, queries }),
  };
}

function mergeMutationRegistryFacts(
  registry: MutationRegistry | undefined,
  facts: {
    inferredTouches: readonly MutationTouchSite[];
    queries: readonly RegisteredQueryDefinition[];
  },
): MutationRegistry {
  const queriesByKey = new Map<string, RegisteredQueryDefinition>();

  for (const queryDefinition of registry?.queries ?? []) {
    const generatedQueryDefinition = queryWithGeneratedReads(queryDefinition);
    queriesByKey.set(generatedQueryDefinition.key, generatedQueryDefinition);
  }
  for (const queryDefinition of facts.queries) {
    const generatedQueryDefinition = queryWithGeneratedReads(queryDefinition);
    if (!queriesByKey.has(generatedQueryDefinition.key)) {
      queriesByKey.set(generatedQueryDefinition.key, generatedQueryDefinition);
    }
  }

  return {
    ...registry,
    ...(facts.inferredTouches.length === 0 ? {} : { inferredTouches: facts.inferredTouches }),
    queries: [...queriesByKey.values()],
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
  // A2 (SPEC §10.3:1063): derive the idem from the hidden `Kovo-Idem` form field
  // (emitted by SRV-OUTPUT) or from the explicit `idem` option; also accept it from
  // the raw input object for callers that pre-parse form bodies.
  const csrf = mutationCsrfOptions(definition, noJsRequest.csrf);

  // G2 (SPEC §6.6:735): validate CSRF FIRST — before the guard lifecycle and before any
  // replay reservation — mirroring the wire path (renderMutationResponse). Otherwise a
  // CSRF-invalid POST would still run a stateful `guards.rateLimit` (exhausting the
  // victim's budget) and occupy a replay slot. The inner `runMutation` CSRF check below
  // remains as defense-in-depth. Renders the failure through the same 422 page path as a
  // handler-returned CSRF failure so no-JS clients see a consistent response.
  if (
    csrf === undefined ||
    (csrf !== false && !validateCsrfToken(noJsRequest.rawInput, noJsRequest.request, csrf))
  ) {
    const failure: MutationFail = {
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    };
    const body = noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(failure)
      : renderDefaultFailurePage(failure);
    return {
      body,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    };
  }

  const idem =
    noJsRequest.idem ??
    (typeof noJsRequest.rawInput === 'object' &&
    noJsRequest.rawInput !== null &&
    'Kovo-Idem' in noJsRequest.rawInput
      ? String((noJsRequest.rawInput as Record<string, unknown>)['Kovo-Idem'])
      : undefined);

  // A1 (SPEC §10.3:1061) + A2: guard runs before replay check in the no-JS path too.
  // guardResolved: the no-JS guard chain is evaluated once below (A1) before the replay lookup, so
  // runMutation must not re-run it (would double-execute a stateful rateLimit guard). The flag is
  // inert for resolveLifecycleRequest.
  const lifecycleOpts = {
    ...runMutationOptions(noJsRequest.csrf, noJsRequest),
    guardResolved: true,
  };
  const lifecycleRequestForGuard = await resolveLifecycleRequest(
    noJsRequest.request,
    lifecycleOpts,
  );
  const guardFailure = await runGuard(definition.guard, lifecycleRequestForGuard);
  if (guardFailure) {
    const reauthResponse = noJsMutationReauthResponse(
      guardFailure,
      lifecycleRequestForGuard,
      noJsRequest.currentUrl === undefined ? {} : { currentUrl: noJsRequest.currentUrl },
    );
    if (reauthResponse) return reauthResponse;
    const status = mutationGuardFailureStatus(guardFailure);
    const body = noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage({
          error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
          ok: false,
          status,
        })
      : renderDefaultFailurePage({
          error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
          ok: false,
          status,
        });
    return {
      body,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...retryAfterHeaders(guardFailure) },
      status,
    };
  }

  // A2 + GAP4-2: derive the replay scope and run reserve/replay lifecycle.
  // For `csrf:false` mutations with no session, use the mutation key as the scope
  // so a stable Kovo-Idem still dedups duplicate external POSTs (SPEC §10.3:1062-1066).
  const noJsScope = noJsReplayScopeFor(csrf, definition.key, noJsRequest.request);

  if (idem && noJsRequest.replayStore) {
    const replayed = await noJsRequest.replayStore.get(noJsScope, idem);
    if (replayed) return replayed;

    let reservation = noJsRequest.replayStore.reserve(noJsScope, idem);
    if (!reservation) {
      const pending = await noJsRequest.replayStore.get(noJsScope, idem);
      if (pending) return pending;
      reservation = noJsRequest.replayStore.reserve(noJsScope, idem);
      if (!reservation) return renderNoJsReplayUnavailablePage(noJsRequest);
    }

    let result: MutationResult<Value>;
    try {
      result = await runMutation(
        definition,
        noJsRequest.rawInput,
        noJsRequest.request,
        lifecycleOpts,
      );
    } catch (error) {
      reservation?.abort?.();
      reportServerError(noJsRequest.onError, error, {
        mutationKey: definition.key,
        operation: 'no-js-mutation-handler',
        request: noJsRequest.request,
      });
      return noJsMutationServerErrorResponse();
    }

    if (!result.ok) {
      reservation?.abort?.();
      const body = noJsRequest.renderFailurePage
        ? await noJsRequest.renderFailurePage(result)
        : renderDefaultFailurePage(result);
      return {
        body,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...retryAfterHeaders(result),
        },
        status: result.status,
      };
    }

    const successResponse: NoJsMutationResponse = {
      body: '',
      headers: mergeMutationResponseHeaders(
        {
          'Cache-Control': 'no-store',
          Location:
            typeof noJsRequest.redirectTo === 'function'
              ? noJsRequest.redirectTo(result)
              : noJsRequest.redirectTo,
        },
        result.responseHeaders,
      ),
      status: 303,
    };
    reservation?.commit(successResponse);
    return successResponse;
  }

  // No replay store or idem — plain path (no dedup protection).
  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      noJsRequest.rawInput,
      noJsRequest.request,
      lifecycleOpts,
    );
  } catch (error) {
    reportServerError(noJsRequest.onError, error, {
      mutationKey: definition.key,
      operation: 'no-js-mutation-handler',
      request: noJsRequest.request,
    });
    return noJsMutationServerErrorResponse();
  }

  if (!result.ok) {
    const body = noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(result)
      : renderDefaultFailurePage(result);

    return {
      body,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...retryAfterHeaders(result),
      },
      status: result.status,
    };
  }

  return {
    body: '',
    headers: mergeMutationResponseHeaders(
      {
        'Cache-Control': 'no-store',
        Location:
          typeof noJsRequest.redirectTo === 'function'
            ? noJsRequest.redirectTo(result)
            : noJsRequest.redirectTo,
      },
      result.responseHeaders,
    ),
    status: 303,
  };
}

/**
 * Derive the replay scope for the no-JS form path (A2 + GAP4-2, SPEC §10.3:1062-1066).
 *
 * Scopes by (mutation-key, session-id) when a session is available; for `csrf:false`
 * or sessionless mutations, falls back to a mutation-key namespace so a stable
 * `Kovo-Idem` still dedups duplicate external POSTs.
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

  return sessionScope !== null ? `${mutationKey}\0${sessionScope}` : `nojs:${mutationKey}`;
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
      ? await noJsRequest.renderFailurePage(failure)
      : renderDefaultFailurePage(failure),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': '1',
    },
    status: 429,
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

function mutationWireResponseHeaders<Request>(
  wireRequest: MutationWireRequest<Request>,
): Record<string, string> {
  return {
    'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
    ...(wireRequest.idem ? { 'Kovo-Idem': wireRequest.idem } : {}),
  };
}

function enhancedMutationReauthResponse<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
  options: { currentUrl?: string },
): BufferedMutationWireResponse | undefined {
  if (!guardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  // SPEC §6.5: enhanced unauthenticated mutation guard failures re-enter auth
  // with a 401 Kovo-Reauth directive instead of rendering validation UI.
  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      'Kovo-Reauth': loginLocation(options.currentUrl ?? '/'),
    },
    status: 401,
  };
}

function noJsMutationReauthResponse<Request>(
  guardFailure: ResolvedGuardFailure,
  request: Request,
  options: { currentUrl?: string },
): NoJsMutationResponse | undefined {
  if (!guardFailureIsUnauthenticated(guardFailure, request)) return undefined;

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location: loginLocation(options.currentUrl ?? '/'),
    },
    status: 303,
  };
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

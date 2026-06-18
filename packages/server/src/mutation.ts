import { buildQueryDelta, queryDeltaIsSmaller, type JsonValue } from '@kovojs/core';
import { serializeCookie, validateRawSetCookie, type CookieOptions } from './cookies.js';
import { mutationCsrfOptions, validateCsrfToken, type CsrfValidationOptions } from './csrf.js';
import {
  changeRecordTouchesQueryInstance,
  invalidate,
  mutationRegistryChangeRecords,
  type ChangeRecord,
  type InvalidateOptions,
  type MutationTouchSite,
} from './change-record.js';
import { reportServerError } from './diagnostics.js';
import { type Domain } from './domain.js';
import { escapeAttribute, escapeHtml } from './html.js';
import {
  resolveLifecycleRequest,
  runGuard,
  type Guard,
  type RequestLifecycleOptions,
} from './guards.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from './wire-html.js';
import {
  readQueryInstanceKey,
  readQueryVersion,
  runQuery,
  type QueryDefinition,
  type RegisteredQueryDefinition,
} from './query.js';
import {
  appendResponseHeader,
  retryAfterHeaders,
  type MutationResponseHeaders,
} from './response.js';
import {
  mutationWireRequestFromHeaders,
  type ErrorBoundaryRenderer,
  type FragmentRenderer,
  type LiveTargetRenderer,
  type MutationLiveTargetDescriptor,
  type MutationLiveTarget,
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
export { invalidate } from './change-record.js';
export type { ChangeRecord, InvalidateOptions, MutationTouchSite } from './change-record.js';

export interface MutationFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  retryAfter?: number;
  status: 422 | 429;
}

export interface MutationSuccess<Value, Input = unknown> {
  changes: ChangeRecord[];
  input: Input;
  rerunQueryInstances?: QueryRerun[];
  rerunQueries: string[];
  ok: true;
  responseHeaders?: MutationResponseHeaders;
  value: Value;
}

export type MutationResult<Value, Input = unknown> = MutationFail | MutationSuccess<Value, Input>;

export interface MutationContext<Errors extends Record<string, Schema<unknown>>> {
  fail<const Code extends Extract<keyof Errors, string>>(
    code: Code,
    payload: InferSchema<Errors[Code]>,
  ): MutationFail<Code, InferSchema<Errors[Code]>>;
  invalidate<const DomainKey extends string, Input = unknown>(
    domain: Domain<DomainKey>,
    options?: InvalidateOptions<Input>,
  ): ChangeRecord<DomainKey, Input>;
  setCookie?: {
    (rawSetCookie: string): void;
    (name: string, value: string, options?: CookieOptions): void;
  };
}

export interface WriteDefinition<
  Key extends string,
  Touches extends readonly Domain[],
  Args extends readonly unknown[],
  Value,
> {
  key: Key;
  run: (...args: Args) => Promise<Value> | Value;
  touches: Touches;
}

/**
 * Declare a reusable write: a named operation plus the exact domains it
 * `touches`. Composing mutations from `write`s makes the touched-domain set
 * explicit and auditable instead of inferred (SPEC §10.3).
 *
 * @param definition - The write's `key`, `touches` domains, and `run` body.
 * @returns The same `WriteDefinition`, typed.
 * @example
 * import { domain, write } from '@kovojs/server';
 *
 * const cart = domain('cart');
 *
 * export const addItem = write({
 *   key: 'cart/add-item',
 *   touches: [cart],
 *   run: (productId: string, quantity: number) => ({ productId, quantity }),
 * });
 */
export function write<
  const Key extends string,
  const Touches extends readonly Domain[],
  Args extends readonly unknown[],
  Value,
>(
  definition: WriteDefinition<Key, Touches, Args, Value>,
): WriteDefinition<Key, Touches, Args, Value> {
  return definition;
}

export interface QueryRerun {
  instanceKey?: string;
  key: string;
}

export interface MutationRegistry {
  inferredTouches?: readonly MutationTouchSite[];
  queries?: readonly RegisteredQueryDefinition[];
  touches?: readonly Domain[];
}

export interface MutationDefinition<
  Key extends string = string,
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
> {
  csrf?: CsrfValidationOptions<Request> | false;
  errors?: Errors;
  guard?: Guard<Request, GuardedRequest>;
  handler: (
    input: InferSchema<InputSchema>,
    request: GuardedRequest,
    context: MutationContext<Errors>,
  ) => Promise<Value | MutationFail> | Value | MutationFail;
  input: InputSchema;
  key: Key;
  registry?: MutationRegistry;
  transaction?: <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ) => Promise<Result>;
}

/** Attributes emitted for a SPEC §6.3 enhanced mutation form. */
export interface MutationFormAttributes<Key extends string = string> {
  /** No-JS mutation endpoint path derived from the typed mutation key. */
  action: `/_m/${Key}`;
  /** Stable mutation key metadata used by enhanced submit/runtime tooling. */
  'data-mutation': Key;
  /** Enables the SPEC §9.1 enhanced fragment submit path. */
  enhance: true;
  /** Mutation forms post by default. */
  method: 'post';
}

export interface RunMutationOptions<
  Request,
  SessionValue = unknown,
  DbValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue, DbValue> {
  csrf?: CsrfValidationOptions<Request>;
}

/** App-scoped mutation factory. `createApp()` uses this to contextually type handlers from configured request providers (SPEC §9.5/§10.3). */
export interface MutationFactory<Request = unknown> {
  <
    const Key extends string,
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
    Value = unknown,
    GuardedRequest extends Request = Request,
  >(
    key: Key,
    definition: Omit<
      MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
      'key'
    >,
  ): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> & { key: Key };
}

/**
 * Declare a typed write. A mutation couples a stable key, an input `Schema`, a
 * `handler` that performs the write, optional typed `errors`, an optional
 * `guard`, and an optional `transaction` wrapper. The input schema doubles as
 * `FormData` coercion; `context.fail(code, payload)` returns a typed failure;
 * `context.invalidate(domain)` records what the write touched so dependent
 * queries rerun (SPEC §10.3). CSRF is default-on — supply `csrf` or set it to
 * `false` with justification.
 *
 * @param key - The mutation's stable registry key.
 * @param definition - Input schema, handler, and optional errors/guard/transaction/csrf.
 * @returns A `MutationDefinition` carrying `key`.
 * @example
 * import { mutation, s } from '@kovojs/server';
 *
 * interface CartRequest {
 *   db: { add(productId: string, quantity: number): void };
 * }
 *
 * export const addToCart = mutation('cart/add', {
 *   csrf: false,
 *   input: s.object({
 *     productId: s.string(),
 *     quantity: s.number().int().min(1).default(1),
 *   }),
 *   errors: {
 *     OUT_OF_STOCK: s.object({ available: s.number().int().min(0) }),
 *   },
 *   handler(input, request: CartRequest, context) {
 *     if (input.quantity > 10) return context.fail('OUT_OF_STOCK', { available: 10 });
 *     request.db.add(input.productId, input.quantity);
 *     return { productId: input.productId };
 *   },
 * });
 */
export function mutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
>(
  key: Key,
  definition: Omit<
    MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest>,
    'key'
  >,
): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> & { key: Key } {
  return { ...definition, key };
}

/**
 * Render the no-JS/enhanced form attributes for a typed mutation value
 * (SPEC §6.3). Component-authored `<form mutation={...}>` is still compiler
 * lowered when submitted-form targets are needed; this helper keeps direct
 * server-rendered templates from hard-coding `/_m/*` URLs.
 */
export function mutationFormAttributes<const Key extends string>(
  definition: Pick<MutationDefinition<Key>, 'key'>,
): MutationFormAttributes<Key> {
  return {
    action: `/_m/${definition.key}`,
    'data-mutation': definition.key,
    enhance: true,
    method: 'post',
  };
}

/**
 * Render SPEC §6.3 no-JS/enhanced form attributes for string templates.
 *
 * Use this when a direct server-rendered helper returns an HTML string rather
 * than JSX, so the mutation endpoint URL and `data-mutation` value still derive
 * from the typed mutation definition.
 */
export function renderMutationFormAttributes<const Key extends string>(
  definition: Pick<MutationDefinition<Key>, 'key'>,
): string {
  const attributes = mutationFormAttributes(definition);
  return `method="${attributes.method}" action="${escapeAttribute(
    attributes.action,
  )}" enhance data-mutation="${escapeAttribute(attributes['data-mutation'])}"`;
}

/**
 * Attach an error-boundary renderer to a fragment renderer, so a fragment that
 * throws while rendering degrades to boundary HTML instead of failing the whole
 * mutation response (SPEC §9.1).
 *
 * @param renderer - The fragment renderer to wrap.
 * @param boundary - The renderer invoked when `renderer` throws.
 * @returns The fragment renderer with an `errorBoundary` attached.
 */
export function errorBoundary<Renderer extends FragmentRenderer>(
  renderer: Renderer,
  boundary: ErrorBoundaryRenderer,
): Renderer & { errorBoundary: ErrorBoundaryRenderer } {
  return { ...renderer, errorBoundary: boundary };
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

  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) {
    return {
      error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
      ok: false,
      ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
      status: guardFailure.status,
    };
  }

  const manualInvalidations: ChangeRecord[] = [];
  const responseHeaders: MutationResponseHeaders = {};
  function setCookie(rawSetCookie: string): void;
  function setCookie(name: string, value: string, options?: CookieOptions): void;
  function setCookie(nameOrRawSetCookie: string, value?: string, options?: CookieOptions): void {
    const cookie =
      value === undefined
        ? validateRawSetCookie(nameOrRawSetCookie)
        : serializeCookie(nameOrRawSetCookie, value, options);
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
  const reservation =
    reservationResult.kind === 'reserved' ? reservationResult.reservation : undefined;

  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      wireRequest.rawInput,
      wireRequest.request,
      runMutationOptions(wireRequest.csrf, wireRequest),
    );
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
    if (result.error.code === 'VALIDATION') {
      // Pure schema validation failures are not replayable: abandon the
      // reservation so a corrected retry runs the handler.
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
  return commitReservedMutationReplay(reservation, async () => {
    let queryChunks: string[];
    let fragmentChunks: string[];
    try {
      const selection = selectMutationResponseTargets({
        fragmentRenderers: wireRequest.fragmentRenderers ?? [],
        liveTargetDescriptors: wireRequest.liveTargetDescriptors ?? [],
        liveTargetRenderers: wireRequest.liveTargetRenderers ?? [],
        liveTargets: wireRequest.liveTargets,
        rerunQueries: result.rerunQueryInstances ?? result.rerunQueries.map((key) => ({ key })),
        targets: wireRequest.targets ?? [],
      });
      queryChunks = await renderQueryChunks(
        definition.registry?.queries ?? [],
        selection.rerunQueries,
        renderInput,
        wireRequest.request,
        result.changes,
      );
      fragmentChunks = await renderFragmentChunks(
        wireRequest.fragmentRenderers ?? [],
        selection.fragmentTargets,
        renderInput,
      );
      fragmentChunks = [
        ...(await renderLiveTargetChunks(
          wireRequest.liveTargetRenderers ?? [],
          selection.liveTargetDescriptors,
          renderInput,
          wireRequest.request,
        )),
        ...fragmentChunks,
      ];
    } catch (error) {
      reportServerError(wireRequest.onError, error, {
        mutationKey: definition.key,
        operation: 'mutation-render',
        request: wireRequest.request,
        ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
      });
      return mutationRenderErrorResponse(result.changes, wireRequest, result.responseHeaders);
    }

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
  });
}

function mutationRenderErrorResponse<Request>(
  changes: readonly ChangeRecord[],
  wireRequest: MutationWireRequest<Request>,
  responseHeaders?: MutationResponseHeaders,
): MutationWireResponse {
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
 * @example
 * import { mutation, renderMutationEndpointResponse, s } from '@kovojs/server';
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
  const endpointDefinition = mutationWithLiveTargetQueries(definition, liveTargetRenderers);
  const wireRequest = mutationWireRequestFromHeaders({
    ...endpointRequest,
    liveTargetRenderers,
  });
  if (wireRequest.fragment) return renderMutationResponse(endpointDefinition, wireRequest);

  return renderNoJsMutationResponse(endpointDefinition, {
    ...(endpointRequest.csrf === undefined ? {} : { csrf: endpointRequest.csrf }),
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

function mutationWithLiveTargetQueries<
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
  if (queries.length === 0) return definition;

  return {
    ...definition,
    registry: mergeMutationRegistryQueries(definition.registry, queries),
  };
}

function mergeMutationRegistryQueries(
  registry: MutationRegistry | undefined,
  queries: readonly RegisteredQueryDefinition[],
): MutationRegistry {
  const queriesByKey = new Map<string, RegisteredQueryDefinition>();

  for (const queryDefinition of registry?.queries ?? []) {
    queriesByKey.set(queryDefinition.key, queryDefinition);
  }
  for (const queryDefinition of queries) {
    if (!queriesByKey.has(queryDefinition.key)) {
      queriesByKey.set(queryDefinition.key, queryDefinition);
    }
  }

  return {
    ...(registry ?? {}),
    queries: [...queriesByKey.values()],
  };
}

/**
 * Run a mutation and render the no-JavaScript POST-redirect-GET response: a 303
 * redirect on success, or a re-rendered failure page. The fallback half of
 * `renderMutationEndpointResponse` (SPEC §6.3).
 *
 * @param definition - The mutation to run.
 * @param noJsRequest - Raw input, request, `redirectTo`, and optional failure-page renderer.
 * @returns A `NoJsMutationResponse` (redirect or document).
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
  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      noJsRequest.rawInput,
      noJsRequest.request,
      runMutationOptions(noJsRequest.csrf, noJsRequest),
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

function queriesToRerun(
  queries: readonly QueryDefinition[],
  changes: readonly ChangeRecord[],
  input: unknown,
): QueryRerun[] {
  return queries
    .filter((queryDefinition) =>
      changes.some((change) => queryTouchedByChange(queryDefinition, change, input)),
    )
    .map((queryDefinition) => {
      const instanceKey = readQueryInstanceKey(queryDefinition, input);
      return {
        ...(instanceKey === undefined ? {} : { instanceKey }),
        key: queryDefinition.key,
      };
    });
}

function queryTouchedByChange(
  queryDefinition: QueryDefinition,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!queryDefinition.reads.some((read) => read.key === change.domain)) return false;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return changeRecordTouchesQueryInstance(change, instanceKey);
}

async function renderQueryChunks(
  queries: readonly QueryDefinition[],
  rerunQueries: readonly QueryRerun[],
  input: unknown,
  request: unknown,
  changes: readonly ChangeRecord[],
): Promise<string[]> {
  const chunks: string[] = [];

  // Build affectedKeysByDomain once for all queries in this render pass (SPEC §9.1.1).
  const affectedKeysByDomain = buildAffectedKeysByDomain(changes);

  for (const queryDefinition of queries) {
    if (!rerunQueries.some((target) => queryMatchesRerun(queryDefinition, input, target))) {
      continue;
    }

    const result = await runQuery(queryDefinition, input, request);
    if (!result.ok) {
      throw new Error(`Rerun query failed: ${queryDefinition.key}`, { cause: result });
    }

    chunks.push(
      renderQueryRerunChunk(queryDefinition, result.input, result.value, affectedKeysByDomain),
    );
  }

  return chunks;
}

function queryMatchesRerun(
  queryDefinition: QueryDefinition,
  input: unknown,
  target: QueryRerun,
): boolean {
  if (queryDefinition.key !== target.key) return false;

  return readQueryInstanceKey(queryDefinition, input) === target.instanceKey;
}

function renderQueryRerunChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
  affectedKeysByDomain: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);
  const version = readQueryVersion(queryDefinition, input, value);

  // Automatic full-vs-delta selection (SPEC §9.1.1): attempt a delta only when the
  // query has delta-eligible collections, then ship whichever is smaller.
  if (queryDefinition.delta && queryDefinition.delta.length > 0) {
    const delta = buildQueryDelta(value as JsonValue, affectedKeysByDomain, queryDefinition.delta);
    if (delta !== undefined && queryDeltaIsSmaller(delta, value as JsonValue)) {
      return renderQueryWireHtml({
        delta: true,
        key,
        name: queryDefinition.key,
        value: delta,
        version,
      });
    }
  }

  return renderQueryWireHtml({
    key,
    name: queryDefinition.key,
    value,
    version,
  });
}

/**
 * Build the `affectedKeysByDomain` map consumed by `buildQueryDelta` (SPEC §9.1.1).
 * For each change record that carries explicit `keys`, those keys are added to the
 * set for that domain.
 */
function buildAffectedKeysByDomain(
  changes: readonly ChangeRecord[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!change.keys || change.keys.length === 0) continue;
    const set = map.get(change.domain) ?? new Set<string>();
    for (const key of change.keys) set.add(key);
    map.set(change.domain, set);
  }
  return map;
}

async function renderFragmentChunks(
  renderers: readonly FragmentRenderer[],
  targets: readonly string[],
  input: unknown,
): Promise<string[]> {
  const wanted = new Set(targets);
  const chunks: string[] = [];

  for (const renderer of renderers) {
    if (wanted.size > 0 && !wanted.has(renderer.target)) continue;

    try {
      chunks.push(
        renderFragmentWireHtml({
          html: await renderer.render(input),
          mode: renderer.mode,
          stylesheets: renderer.stylesheets,
          target: renderer.target,
        }),
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      chunks.push(
        renderFragmentWireHtml({
          errorBoundary: renderer.target,
          html: await renderer.errorBoundary.render(error, input),
          stylesheets: renderer.stylesheets,
          target,
        }),
      );
    }
  }

  return chunks;
}

async function renderLiveTargetChunks<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  targets: readonly MutationLiveTargetDescriptor[],
  input: unknown,
  request: Request,
): Promise<string[]> {
  const renderersByComponent = liveTargetRenderersByComponent(renderers);
  const chunks: string[] = [];

  for (const target of targets) {
    const renderer = renderersByComponent.get(target.component);
    if (!renderer) continue;

    try {
      chunks.push(
        renderFragmentWireHtml({
          html: await renderer.render({
            input,
            props: target.props,
            request,
            target: target.target,
          }),
          stylesheets: renderer.stylesheets,
          target: target.target,
        }),
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const boundaryTarget = renderer.errorBoundary.target ?? target.target;
      chunks.push(
        renderFragmentWireHtml({
          errorBoundary: target.target,
          html: await renderer.errorBoundary.render(error, input),
          stylesheets: renderer.stylesheets,
          target: boundaryTarget,
        }),
      );
    }
  }

  return chunks;
}

function liveTargetRenderersByComponent<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): ReadonlyMap<string, LiveTargetRenderer<Request>> {
  const byComponent = new Map<string, LiveTargetRenderer<Request>>();
  for (const renderer of renderers) {
    if (!byComponent.has(renderer.component)) byComponent.set(renderer.component, renderer);
  }
  return byComponent;
}

interface MutationResponseSelectionInput {
  fragmentRenderers: readonly FragmentRenderer[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  liveTargetRenderers: readonly LiveTargetRenderer[];
  liveTargets?: readonly MutationLiveTarget[] | undefined;
  rerunQueries: readonly QueryRerun[];
  targets: readonly string[];
}

interface MutationResponseSelection {
  fragmentTargets: readonly string[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  rerunQueries: readonly QueryRerun[];
}

function selectMutationResponseTargets(
  input: MutationResponseSelectionInput,
): MutationResponseSelection {
  if (input.liveTargets === undefined) {
    return {
      fragmentTargets: input.targets,
      liveTargetDescriptors: [],
      rerunQueries: input.rerunQueries,
    };
  }

  if (input.liveTargets.length === 0) {
    return { fragmentTargets: [], liveTargetDescriptors: [], rerunQueries: [] };
  }

  const renderersByTarget = fragmentRenderersByTarget(input.fragmentRenderers);
  const liveRenderersByComponent = liveTargetRenderersByComponent(input.liveTargetRenderers);
  const affectedQueryTokens = new Set<string>();
  for (const query of input.rerunQueries) {
    const tokens = queryRerunTokens(query);
    if (
      input.liveTargets.some((target) => depsMatch(target, tokens)) ||
      input.liveTargetDescriptors.some((descriptor) => {
        const renderer = liveRenderersByComponent.get(descriptor.component);
        return renderer?.queries?.some((rendererQuery) => tokens.includes(rendererQuery)) ?? false;
      })
    ) {
      for (const token of tokens) affectedQueryTokens.add(token);
    }
  }

  const rerunQueries = input.rerunQueries.filter((query) => {
    const tokens = queryRerunTokens(query);
    if (
      !input.liveTargets?.some(
        (target) =>
          targetIsPlanCovered(target.target, renderersByTarget) && depsMatch(target, tokens),
      ) &&
      !input.liveTargetDescriptors.some((descriptor) => {
        const renderer = liveRenderersByComponent.get(descriptor.component);
        return renderer?.queries?.some((rendererQuery) => tokens.includes(rendererQuery)) ?? false;
      })
    ) {
      return false;
    }

    return true;
  });

  const fragmentTargets = input.fragmentRenderers
    .filter((renderer) => {
      if (renderer.updateCoverage === 'plan') return false;
      const liveTarget = input.liveTargets?.find((target) => target.target === renderer.target);
      return liveTarget !== undefined && depsMatch(liveTarget, affectedQueryTokens);
    })
    .map((renderer) => renderer.target);

  const liveTargetDescriptors = input.liveTargetDescriptors.filter((descriptor) => {
    if (renderersByTarget.has(descriptor.target)) return false;
    const renderer = liveRenderersByComponent.get(descriptor.component);
    if (!renderer) return false;
    const liveTarget = input.liveTargets?.find((target) => target.target === descriptor.target);
    const rendererQueries = renderer.queries ?? [];
    if (rendererQueries.some((query) => affectedQueryTokens.has(query))) return true;
    return liveTarget !== undefined && depsMatch(liveTarget, affectedQueryTokens);
  });

  return { fragmentTargets, liveTargetDescriptors, rerunQueries };
}

function fragmentRenderersByTarget(
  renderers: readonly FragmentRenderer[],
): ReadonlyMap<string, FragmentRenderer> {
  const byTarget = new Map<string, FragmentRenderer>();
  for (const renderer of renderers) {
    const existing = byTarget.get(renderer.target);
    if (existing && existing.updateCoverage !== 'plan') continue;
    byTarget.set(renderer.target, renderer);
  }
  return byTarget;
}

function targetIsPlanCovered(
  target: string,
  renderersByTarget: ReadonlyMap<string, FragmentRenderer>,
): boolean {
  return renderersByTarget.get(target)?.updateCoverage === 'plan' || !renderersByTarget.has(target);
}

function queryRerunTokens(query: QueryRerun): string[] {
  return query.instanceKey === undefined ? [query.key] : [query.key, query.instanceKey];
}

function depsMatch(
  liveTarget: MutationLiveTarget,
  queryTokens: ReadonlySet<string> | readonly string[],
): boolean {
  const tokens = queryTokens instanceof Set ? queryTokens : new Set(queryTokens);
  return liveTarget.deps.some((dep) => tokens.has(dep));
}

async function renderFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
): Promise<string> {
  const target = mutationFailureTarget(wireRequest);
  const html = wireRequest.renderFailureFragment
    ? await wireRequest.renderFailureFragment(failure, wireRequest.rawInput)
    : renderDefaultFailureFragmentContent(failure);

  return renderFragmentWireHtml({
    html,
    stylesheets: wireRequest.failureStylesheets,
    target,
  });
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

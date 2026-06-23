import type {
  InvalidationSets,
  JsonValue,
  OptimisticDerivationSets,
  QueryRegistry,
} from '@kovojs/core';
import { buildQueryDelta, queryDeltaIsSmaller } from '@kovojs/core/internal/query-delta';
import { serializeCookie, type CookieOptions } from './cookies.js';
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
  guardFailureIsUnauthenticated,
  resolveLifecycleRequest,
  runGuard,
  type Guard,
  type RequestLifecycleOptions,
  type ResolvedGuardFailure,
} from './guards.js';
import { registeredGeneratedMutationTouches } from './generated-mutation-registry.js';
import { queryWithGeneratedReads } from './generated-query-registry.js';
import { registeredGeneratedLiveTargetRenderers } from './live-target-registry.js';
import {
  renderDoneWireHtml,
  renderFragmentWireHtml,
  renderQueryWireHtml,
  renderTextWireHtml,
} from './wire-html.js';
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
  type MutationReplayReservation,
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

/**
 * A typed mutation failure outcome (SPEC §9.2): a declared `error` `code` plus its
 * validated `payload`, served as HTTP 422 (validation/app `fail()`), 429 (rate limit,
 * with optional `retryAfter`), or framework-owned authenticated authorization denial
 * as HTTP 403. Produced via `MutationContext.fail` for app failures and by guards for
 * authorization failures.
 */
export interface MutationFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  retryAfter?: number;
  status: 403 | 422 | 429;
}

/**
 * A successful mutation outcome (SPEC §9.1/§10.3): the returned `value`, the validated
 * `input`, the emitted `changes`, the query names/instances to rerun, and any
 * `responseHeaders` to apply (e.g. Set-Cookie).
 */
export interface MutationSuccess<Value, Input = unknown> {
  changes: ChangeRecord[];
  input: Input;
  rerunQueryInstances?: QueryRerun[];
  rerunQueries: string[];
  ok: true;
  responseHeaders?: MutationResponseHeaders;
  value: Value;
}

/** The outcome of a mutation: {@link MutationSuccess} or {@link MutationFail} (SPEC §9.1/§9.2). */
export type MutationResult<Value, Input = unknown> = MutationFail | MutationSuccess<Value, Input>;

/** A server-rendered fragment chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamFragmentChunk {
  html: string;
  kind: 'fragment';
  mode?: 'append' | 'replace';
  target: string;
}

/** An escaped text-source chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamTextChunk {
  kind: 'text';
  mode?: 'append' | 'checkpoint';
  target: string;
  text: string;
}

/** A query-truth chunk for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamQueryChunk {
  delta?: boolean;
  key?: string;
  kind: 'query';
  name: string;
  value: unknown;
  version?: number | string;
}

/** A readable terminal marker for a SPEC §9.1 streaming mutation response. */
export interface MutationStreamDoneChunk {
  kind: 'done';
  reason?: string;
}

/** A typed chunk yielded by a streaming mutation author function (SPEC §9.1). */
export type MutationStreamChunk =
  | MutationStreamDoneChunk
  | MutationStreamFragmentChunk
  | MutationStreamQueryChunk
  | MutationStreamTextChunk;

/** Context passed to a streaming mutation author function after the mutation succeeds. */
export interface MutationStreamContext<Value = unknown, Input = unknown, Request = unknown> {
  input: Input;
  request: Request;
  result: MutationSuccess<Value, Input>;
}

/** Iterable chunk source returned by a streaming mutation author function. */
export type MutationStreamSource<_Value, _Input, _Request> =
  | AsyncIterable<MutationStreamChunk>
  | Iterable<MutationStreamChunk>;

/** Coarse server-side text coalescing policy for streaming mutation text chunks. */
export interface MutationTextCoalescingPolicy {
  maxDelayMs?: number;
  maxTextChars?: number;
}

const defaultMutationTextCoalescingPolicy: Required<MutationTextCoalescingPolicy> = {
  maxDelayMs: 32,
  maxTextChars: 2048,
};

/**
 * Build SPEC §9.1 streaming mutation wire chunks. Text chunks are escaped by the server
 * renderer and are coalesced before being written to the response stream.
 */
export const stream = {
  done(options: { reason?: string } = {}): MutationStreamDoneChunk {
    return { kind: 'done', ...(options.reason === undefined ? {} : { reason: options.reason }) };
  },
  fragment(options: {
    html: string;
    mode?: 'append' | 'replace';
    target: string;
  }): MutationStreamFragmentChunk {
    return {
      html: options.html,
      kind: 'fragment',
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      target: options.target,
    };
  },
  query(options: {
    delta?: boolean;
    key?: string;
    name: string;
    value: unknown;
    version?: number | string;
  }): MutationStreamQueryChunk {
    return {
      ...(options.delta === undefined ? {} : { delta: options.delta }),
      ...(options.key === undefined ? {} : { key: options.key }),
      kind: 'query',
      name: options.name,
      value: options.value,
      ...(options.version === undefined ? {} : { version: options.version }),
    };
  },
  text(
    target: string,
    text: string,
    options: { mode?: 'append' | 'checkpoint' } = {},
  ): MutationStreamTextChunk {
    return {
      kind: 'text',
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      target,
      text,
    };
  },
};

/**
 * The `context` argument passed to a mutation `handler` (SPEC §9.1/§10.3). Exposes
 * `fail` to return a typed {@link MutationFail} from the declared `errors`, `invalidate`
 * to record a domain change, and the typed `setCookie` builder (SPEC §9.1.1).
 */
export interface MutationContext<Errors extends Record<string, Schema<unknown>>> {
  fail<const Code extends Extract<keyof Errors, string>>(
    code: Code,
    payload: InferSchema<Errors[Code]>,
  ): MutationFail<Code, InferSchema<Errors[Code]>>;
  invalidate<const DomainKey extends string, Input = unknown>(
    domain: Domain<DomainKey>,
    options?: InvalidateOptions<Input>,
  ): ChangeRecord<DomainKey, Input>;
  /**
   * Set a typed `Set-Cookie` header via the safe typed builder (SPEC §9.1.1:846).
   * Pass `(name, value, options?)`. The raw single-string overload has been removed
   * (B3) — the typed builder is the only supported call form.
   */
  setCookie?: (name: string, value: string, options?: CookieOptions) => void;
  // NOTE: `value` is not optional in the type to prevent raw-string abuse; the
  // runtime implementation enforces this. External code that previously called
  // setCookie(rawString) must migrate to the (name, value, options) form.
}

/**
 * The shape of a reusable write passed to and returned by {@link write} (SPEC §10.3):
 * a named `key`, the exact domains it `touches`, and the `run` body. Composing mutations
 * from writes makes the touched-domain set explicit and auditable.
 */
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

/** @internal */
export interface QueryRerun {
  input?: unknown;
  instanceKey?: string;
  key: string;
  whole?: boolean;
}

/** @internal */
export interface MutationRegistry {
  inferredTouches?: readonly MutationTouchSite[];
  queries?: readonly RegisteredQueryDefinition[];
  touches?: readonly Domain[];
}

type MutationInvalidatedQueryNames<Key extends string> = Key extends keyof InvalidationSets
  ? Extract<InvalidationSets[Key], Extract<keyof QueryRegistry, string>>
  : never;

type MutationDerivableOptimisticQueryNames<Key extends string> =
  Key extends keyof OptimisticDerivationSets
    ? Extract<OptimisticDerivationSets[Key], MutationInvalidatedQueryNames<Key>>
    : never;

type MutationRequiredOptimisticQueryNames<Key extends string> = Exclude<
  MutationInvalidatedQueryNames<Key>,
  MutationDerivableOptimisticQueryNames<Key>
>;

type MutableDraft<Value> = Value extends (...args: any[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? MutableDraft<Item>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: MutableDraft<Value[Key]> }
      : Value;

export type MutationOptimisticTransform<Input = unknown, Value = unknown> = (
  draft: MutableDraft<Value>,
  input: Input,
) => void;

export type MutationOptimisticEntry<Input = unknown, Value = unknown> =
  | MutationOptimisticTransform<Input, Value>
  | 'await-fragment';

type KnownMutationOptimisticMap<Key extends string, InputSchema extends Schema<unknown>> = {
  [QueryName in MutationRequiredOptimisticQueryNames<Key>]-?: MutationOptimisticEntry<
    InferSchema<InputSchema>,
    QueryRegistry[QueryName]
  >;
} & {
  [QueryName in MutationDerivableOptimisticQueryNames<Key>]?: MutationOptimisticEntry<
    InferSchema<InputSchema>,
    QueryRegistry[QueryName]
  >;
};

export type MutationOptimisticMap<Key extends string, InputSchema extends Schema<unknown>> = [
  MutationInvalidatedQueryNames<Key>,
] extends [never]
  ? Record<string, MutationOptimisticEntry<InferSchema<InputSchema>, any>>
  : KnownMutationOptimisticMap<Key, InputSchema>;

/**
 * The full definition object passed to {@link mutation} (SPEC §6.3/§9.1/§10.3): the
 * `key`, `input` schema, optional `errors`, `guard`, `csrf` posture, `optimistic` map,
 * `redirectTo`/`defaultRedirectTo` POST-redirect-GET targets, `stream`/`transaction`
 * hooks, and the `handler` body. Typed `mutation()`'s parameter and return shape.
 */
export interface MutationDefinition<
  Key extends string = string,
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
> {
  csrf?: CsrfValidationOptions<Request> | false;
  /** Static/common POST-redirect-GET target for successful no-JS submissions (SPEC §9.1). */
  defaultRedirectTo?: string;
  errors?: Errors;
  guard?: Guard<Request, GuardedRequest>;
  handler: (
    input: InferSchema<InputSchema>,
    request: GuardedRequest,
    context: MutationContext<Errors>,
  ) => Promise<Value | MutationFail> | Value | MutationFail;
  input: InputSchema;
  key: Key;
  optimistic?: MutationOptimisticMap<Key, InputSchema>;
  queue?: string;
  /** Mutation-local success redirect policy for dynamic POST-redirect-GET targets. */
  redirectTo?: string | ((result: MutationSuccess<Value, InferSchema<InputSchema>>) => string);
  registry?: MutationRegistry;
  stream?: (
    context: MutationStreamContext<Value, InferSchema<InputSchema>, GuardedRequest>,
  ) => MutationStreamSource<Value, InferSchema<InputSchema>, GuardedRequest>;
  transaction?: <Result>(
    request: Request,
    run: (transactionRequest: GuardedRequest) => Promise<Result>,
  ) => Promise<Result>;
}

/**
 * The minimal mutation reference ({@link MutationDefinition} `key` plus `csrf` posture)
 * carried on a {@link MutationFormAttributes} `mutation` field so the server JSX runtime
 * can inject the CSRF token into an enhanced form (SPEC §6.3/§9.1).
 */
export interface MutationFormDefinition<Key extends string = string, Request = unknown> {
  csrf?: CsrfValidationOptions<Request> | false;
  key: Key;
}

/** Attributes emitted for a SPEC §6.3 enhanced mutation form. */
export interface MutationFormAttributes<Key extends string = string, Request = unknown> {
  /** No-JS mutation endpoint path derived from the typed mutation key. */
  action: `/_m/${Key}`;
  /** Stable mutation key metadata used by enhanced submit/runtime tooling. */
  'data-mutation': Key;
  /** Enables the SPEC §9.1 enhanced fragment submit path. */
  enhance: true;
  /** Mutation forms post by default. */
  method: 'post';
  /** Typed mutation value retained for server JSX runtime CSRF injection. */
  mutation: MutationFormDefinition<Key, Request>;
}

/** @internal */
export interface RunMutationOptions<
  Request,
  SessionValue = unknown,
  DbValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue, DbValue> {
  csrf?: CsrfValidationOptions<Request>;
  /**
   * When the caller has already evaluated the session-bound guard chain before the replay
   * lookup (A1, SPEC §10.3 "re-evaluate the guard chain before re-serving"), `runMutation` must
   * NOT re-run it — re-running double-executes a stateful guard (e.g. rateLimit). Default false so
   * direct callers (fixtures, tests) keep the in-handler guard evaluation.
   */
  guardResolved?: boolean;
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
 * `guard`, an optional static `defaultRedirectTo`, and an optional `transaction` wrapper. The input schema doubles as
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
export function mutationFormAttributes<const Key extends string, Request = unknown>(
  definition: MutationFormDefinition<Key, Request>,
): MutationFormAttributes<Key, Request> {
  return {
    action: `/_m/${definition.key}`,
    'data-mutation': definition.key,
    enhance: true,
    method: 'post',
    mutation: definition,
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

/**
 * L10-1 (SPEC §9): error-reporting context threaded into the streaming render so a
 * generator that throws mid-stream can report via `onError` and emit a failure
 * terminator. `'mutation-stream'` is not yet a member of the shared
 * `ServerErrorDiagnosticContext.operation` union, so the context is cast at the
 * reporting boundary; the runtime value the diagnostic hook observes is unchanged.
 */
interface StreamingMutationErrorContext {
  context: {
    mutationKey: string;
    operation: string;
    request: unknown;
    targets?: readonly string[] | undefined;
  };
  onError?: import('./diagnostics.js').ServerErrorHandler | undefined;
}

function renderStreamingMutationWireResponse(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
  finalResponse: BufferedMutationWireResponse,
  reservation?: MutationReplayReservation<BufferedMutationWireResponse>,
  errorContext?: StreamingMutationErrorContext,
): MutationWireResponse {
  const encoder = new TextEncoder();
  // H4 (SPEC §9): retain a reference to the raw source iterator so the cancel
  // handler can call return() on it directly — the coalesce layer's inner await
  // on a pending read won't propagate the cancel signal automatically.
  const sourceIterator = toAsyncIterator(chunks);
  const sourceIterable: AsyncIterable<MutationStreamChunk> = {
    [Symbol.asyncIterator]: () => sourceIterator,
  };
  const source = coalesceMutationStreamChunks(sourceIterable);
  const iterator = source[Symbol.asyncIterator]();

  return {
    body: new ReadableStream<Uint8Array>({
      async start(controller) {
        // A3 (SPEC §10.3:1063): buffer all emitted bytes so we can commit the full
        // settled body (stream chunks + finalResponse.body + <kovo-done>) to the
        // replay store after the stream completes, not the head-only body before.
        const buffered: string[] = [];

        const enqueue = (text: string): void => {
          const line = `${text}\n`;
          buffered.push(line);
          controller.enqueue(encoder.encode(line));
        };

        try {
          for (;;) {
            const { done, value: chunk } = await iterator.next();
            if (done) break;
            enqueue(renderMutationStreamChunk(chunk));
            if (chunk.kind === 'done') {
              controller.close();
              // Commit the full settled body so replays re-serve the complete stream.
              reservation?.commit({
                body: buffered.join(''),
                headers: finalResponse.headers,
                status: finalResponse.status,
              });
              return;
            }
          }
          // Generator exhausted without an explicit done chunk; emit the reconciled
          // fragment body (pre-rendered query/fragment HTML) and kovo-done.
          if (finalResponse.body) enqueue(finalResponse.body);
          enqueue(renderDoneWireHtml());
          controller.close();
          // Commit after the generator exhausted (no explicit done chunk).
          reservation?.commit({
            body: buffered.join(''),
            headers: finalResponse.headers,
            status: finalResponse.status,
          });
        } catch (error) {
          // L10-1 (SPEC §9): a streaming generator threw mid-stream. Report it via the
          // server error hook and emit a `<kovo-done reason="error">` terminator so the
          // client observes a clean, in-band end-of-stream (mirroring the explicit
          // `stream.done({ reason: 'error' })` path) instead of a silent hang. The
          // reservation is aborted, never committed, so the failed stream is not replayed.
          if (errorContext) {
            reportServerError(
              errorContext.onError,
              error,
              errorContext.context as import('./diagnostics.js').ServerErrorDiagnosticContext,
            );
          }
          try {
            enqueue(renderDoneWireHtml({ reason: 'error' }));
            controller.close();
          } catch {
            // The controller may already be errored/closed (e.g. the consumer cancelled
            // concurrently); fall back to surfacing the original error on the stream.
            controller.error(error);
          }
          // Do not commit on error; let the reservation remain pending/aborted.
          reservation?.abort?.();
        }
      },
      cancel() {
        // H4 (SPEC §9): propagate client disconnect to the author generator so its
        // finally block runs. We call return() on the raw sourceIterator (not the
        // coalesced iterator) because the coalesce layer holds a pending .next() call
        // that won't resolve until the source yields — the return() must reach the
        // source generator directly to interrupt it.
        void sourceIterator.return?.();
      },
    }),
    headers: finalResponse.headers,
    status: finalResponse.status,
  };
}

export async function* coalesceMutationStreamChunks(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
  policy: MutationTextCoalescingPolicy = {},
): AsyncIterable<MutationStreamChunk> {
  const maxDelayMs = policy.maxDelayMs ?? defaultMutationTextCoalescingPolicy.maxDelayMs;
  const maxTextChars = policy.maxTextChars ?? defaultMutationTextCoalescingPolicy.maxTextChars;
  const iterator = toAsyncIterator(chunks);
  let pendingRead: Promise<IteratorResult<MutationStreamChunk>> | undefined;
  let bufferedText: MutationStreamTextChunk | undefined;
  let bufferedSince = 0;
  let timer: Promise<'flush'> | undefined;

  const flush = function* (): Generator<MutationStreamTextChunk> {
    if (!bufferedText) return;
    const chunk = bufferedText;
    bufferedText = undefined;
    bufferedSince = 0;
    timer = undefined;
    yield chunk;
  };

  for (;;) {
    pendingRead ??= iterator.next();
    if (bufferedText && maxDelayMs <= 0) {
      yield* flush();
      continue;
    }
    timer ??=
      bufferedText && maxDelayMs > 0
        ? new Promise<'flush'>((resolve) => setTimeout(() => resolve('flush'), maxDelayMs))
        : undefined;

    let next: IteratorResult<MutationStreamChunk> | 'flush';
    try {
      next = timer === undefined ? await pendingRead : await Promise.race([pendingRead, timer]);
    } catch (error) {
      // L10-1 (SPEC §9): the source generator threw mid-stream. Flush any buffered text
      // so already-yielded partial output is not lost, then propagate the error so the
      // streaming render's catch can report it and emit the failure terminator.
      yield* flush();
      throw error;
    }
    if (next === 'flush') {
      yield* flush();
      continue;
    }

    pendingRead = undefined;
    if (next.done) {
      yield* flush();
      return;
    }

    const chunk = next.value;
    if (chunk.kind !== 'text' || chunk.mode === 'checkpoint') {
      yield* flush();
      yield chunk;
      continue;
    }

    if (!bufferedText) {
      bufferedText = { ...chunk, mode: 'append' };
      bufferedSince = Date.now();
      timer = undefined;
    } else if (bufferedText.target === chunk.target) {
      bufferedText = {
        ...bufferedText,
        text: `${bufferedText.text}${chunk.text}`,
      };
    } else {
      yield* flush();
      bufferedText = { ...chunk, mode: 'append' };
      bufferedSince = Date.now();
    }

    if (
      bufferedText.text.length >= maxTextChars ||
      (bufferedSince > 0 && Date.now() - bufferedSince >= maxDelayMs)
    ) {
      yield* flush();
    }
  }
}

function toAsyncIterator(
  chunks: MutationStreamSource<unknown, unknown, unknown>,
): AsyncIterator<MutationStreamChunk> {
  if (Symbol.asyncIterator in chunks) return chunks[Symbol.asyncIterator]();
  return (async function* () {
    yield* chunks;
  })()[Symbol.asyncIterator]();
}

function renderMutationStreamChunk(chunk: MutationStreamChunk): string {
  switch (chunk.kind) {
    case 'done':
      return renderDoneWireHtml({ reason: chunk.reason });
    case 'fragment':
      return renderFragmentWireHtml({
        html: chunk.html,
        mode: chunk.mode,
        target: chunk.target,
      });
    case 'query':
      return renderQueryWireHtml({
        delta: chunk.delta,
        key: chunk.key,
        name: chunk.name,
        value: chunk.value,
        version: chunk.version,
      });
    case 'text':
      return renderTextWireHtml({
        mode: chunk.mode,
        target: chunk.target,
        text: chunk.text,
      });
  }
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

    const reservation = noJsRequest.replayStore.reserve(noJsScope, idem);

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
        ...(instanceKey !== undefined &&
        changes.some((change) =>
          queryChangeInvalidatesWholeQueryInstance(queryDefinition, change, input),
        )
          ? { whole: true }
          : {}),
      };
    });
}

function queryTouchedByChange(
  queryDefinition: QueryDefinition,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!(queryDefinition.reads ?? []).some((read) => read.key === change.domain)) return false;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return changeRecordTouchesQueryInstance(change, instanceKey);
}

function queryChangeInvalidatesWholeQueryInstance(
  queryDefinition: QueryDefinition,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!(queryDefinition.reads ?? []).some((read) => read.key === change.domain)) return false;
  if ((change.keys?.length ?? 0) === 0) return true;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return canonicalSingleRowQueryValue(change.domain, instanceKey) === undefined;
}

function canonicalSingleRowQueryValue(domain: string, instanceKey: string): string | undefined {
  const prefix = `${domain}:`;
  if (!instanceKey.startsWith(prefix)) return undefined;

  const value = instanceKey.slice(prefix.length);
  if (!value || value.includes(':')) return undefined;
  return value;
}

async function renderQueryChunks(
  queries: readonly QueryDefinition[],
  rerunQueries: readonly QueryRerun[],
  defaultInput: unknown,
  request: unknown,
  changes: readonly ChangeRecord[],
): Promise<string[]> {
  const chunks: string[] = [];

  // Build affectedKeysByDomain once for all queries in this render pass (SPEC §9.1.1).
  const affectedKeysByDomain = buildAffectedKeysByDomain(changes);

  for (const queryDefinition of queries) {
    const rerunQuery = rerunQueries.find((target) =>
      queryMatchesRerun(queryDefinition, defaultInput, target),
    );
    if (rerunQuery === undefined) {
      continue;
    }

    const input = rerunQuery.input ?? defaultInput;
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
  defaultInput: unknown,
  target: QueryRerun,
): boolean {
  if (queryDefinition.key !== target.key) return false;

  const input = target.input ?? defaultInput;
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

/** @internal Render server-owned live-target fragment wire for dev HMR and mutation refresh. */
export async function renderLiveTargetChunks<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  targets: readonly MutationLiveTargetDescriptor[],
  input: unknown,
  request: Request,
  csrf: MutationWireRequest<Request>['csrf'] | undefined,
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
            ...(csrf === undefined ? {} : { csrf }),
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

interface MutationResponseSelectionInput<Request> {
  changes: readonly ChangeRecord[];
  fragmentRenderers: readonly FragmentRenderer[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  liveTargetRenderers: readonly LiveTargetRenderer<Request>[];
  liveTargets?: readonly MutationLiveTarget[] | undefined;
  queryDefinitions: readonly QueryDefinition[];
  rerunQueries: readonly QueryRerun[];
  targets: readonly string[];
}

interface MutationResponseSelection {
  fragmentTargets: readonly string[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  rerunQueries: readonly QueryRerun[];
}

function selectMutationResponseTargets<Request>(
  input: MutationResponseSelectionInput<Request>,
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

  const liveTargets = input.liveTargets;
  const renderersByTarget = fragmentRenderersByTarget(input.fragmentRenderers);
  const liveRenderersByComponent = liveTargetRenderersByComponent(input.liveTargetRenderers);
  const affectedQueryTokens = new Set<string>();
  for (const query of input.rerunQueries) {
    const tokens = queryRerunTokens(query);
    if (liveTargets.some((target) => depsMatch(target, tokens))) {
      addQueryTokens(affectedQueryTokens, tokens);
    }
  }

  const descriptorReruns = new Map<MutationLiveTargetDescriptor, readonly QueryRerun[]>();
  for (const descriptor of input.liveTargetDescriptors) {
    const renderer = liveRenderersByComponent.get(descriptor.component);
    const liveTarget = liveTargets.find((target) => target.target === descriptor.target);
    if (!renderer || liveTarget === undefined) continue;

    const reruns = liveTargetDescriptorQueryReruns(
      renderer,
      descriptor,
      input.queryDefinitions,
      input.changes,
    );
    descriptorReruns.set(descriptor, reruns);

    if (reruns.some((query) => depsMatch(liveTarget, queryRerunTokens(query)))) {
      for (const query of reruns) addQueryTokens(affectedQueryTokens, queryRerunTokens(query));
    }
  }

  const rerunQueries = input.rerunQueries.filter((query) => {
    const tokens = queryRerunTokens(query);
    return liveTargets.some(
      (target) =>
        targetIsPlanCovered(target.target, renderersByTarget) && depsMatch(target, tokens),
    );
  });

  const fragmentTargets = input.fragmentRenderers
    .filter((renderer) => {
      if (renderer.updateCoverage === 'plan') return false;
      const liveTarget = liveTargets.find((target) => target.target === renderer.target);
      return liveTarget !== undefined && depsMatch(liveTarget, affectedQueryTokens);
    })
    .map((renderer) => renderer.target);

  const liveTargetDescriptors = input.liveTargetDescriptors.filter((descriptor) => {
    if (renderersByTarget.has(descriptor.target)) return false;
    const renderer = liveRenderersByComponent.get(descriptor.component);
    if (!renderer) return false;
    const liveTarget = liveTargets.find((target) => target.target === descriptor.target);
    if (liveTarget === undefined) return false;

    const reruns = descriptorReruns.get(descriptor) ?? [];
    return reruns.some((query) => depsMatch(liveTarget, queryRerunTokens(query)));
  });

  return {
    fragmentTargets,
    liveTargetDescriptors,
    rerunQueries: mergeQueryReruns([
      ...rerunQueries,
      ...liveTargetDescriptors.flatMap((descriptor) => descriptorReruns.get(descriptor) ?? []),
    ]),
  };
}

interface LiveTargetRendererQueryBinding {
  args?: (props: Record<string, unknown>) => unknown;
  query: QueryDefinition;
}

type LiveTargetRendererWithQueryBindings<Request> = LiveTargetRenderer<Request> & {
  queryBindings?: readonly LiveTargetRendererQueryBinding[];
};

function liveTargetDescriptorQueryReruns<Request>(
  renderer: LiveTargetRenderer<Request>,
  descriptor: MutationLiveTargetDescriptor,
  queryDefinitions: readonly QueryDefinition[],
  changes: readonly ChangeRecord[],
): QueryRerun[] {
  const bindings = liveTargetRendererQueryBindings(renderer, queryDefinitions);
  const reruns: QueryRerun[] = [];

  for (const binding of bindings) {
    const queryInput = binding.args ? binding.args(descriptor.props) : undefined;
    if (!changes.some((change) => queryTouchedByChange(binding.query, change, queryInput))) {
      continue;
    }

    const instanceKey = readQueryInstanceKey(binding.query, queryInput);
    reruns.push({
      input: queryInput,
      ...(instanceKey === undefined ? {} : { instanceKey }),
      key: binding.query.key,
      ...(instanceKey !== undefined &&
      changes.some((change) =>
        queryChangeInvalidatesWholeQueryInstance(binding.query, change, queryInput),
      )
        ? { whole: true }
        : {}),
    });
  }

  return mergeQueryReruns(reruns);
}

function liveTargetRendererQueryBindings<Request>(
  renderer: LiveTargetRenderer<Request>,
  queryDefinitions: readonly QueryDefinition[],
): readonly LiveTargetRendererQueryBinding[] {
  const rendererWithBindings = renderer as LiveTargetRendererWithQueryBindings<Request>;
  if (rendererWithBindings.queryBindings) return rendererWithBindings.queryBindings;
  if (renderer.queryDefinitions) {
    return renderer.queryDefinitions.map((queryDefinition) => ({ query: queryDefinition }));
  }

  return (renderer.queries ?? []).flatMap((queryKey) => {
    const queryDefinition = queryDefinitions.find((candidate) => candidate.key === queryKey);
    return queryDefinition === undefined ? [] : [{ query: queryDefinition }];
  });
}

function mergeQueryReruns(queries: readonly QueryRerun[]): QueryRerun[] {
  const byIdentity = new Map<string, QueryRerun>();
  for (const query of queries) {
    const identity = `${query.key}\0${query.instanceKey ?? ''}`;
    const existing = byIdentity.get(identity);
    byIdentity.set(identity, {
      ...query,
      ...(existing?.input !== undefined && query.input === undefined
        ? { input: existing.input }
        : {}),
      ...((existing?.whole === true || query.whole === true) && query.instanceKey !== undefined
        ? { whole: true }
        : {}),
    });
  }
  return [...byIdentity.values()];
}

function addQueryTokens(target: Set<string>, tokens: readonly string[]): void {
  for (const token of tokens) target.add(token);
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
  if (query.instanceKey === undefined) return [query.key];
  return query.whole === true ? [query.key, query.instanceKey] : [query.instanceKey];
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

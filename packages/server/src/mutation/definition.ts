import type { InvalidationSets, OptimisticDerivationSets, QueryRegistry } from '@kovojs/core';
import type { ChangeRecord, InvalidateOptions, MutationTouchSite } from '../change-record.js';
import type { AccessDecision } from '../access.js';
import type { CookieOptions } from '../cookies.js';
import type { CsrfValidationOptions } from '../csrf.js';
import type { Domain } from '../domain.js';
import type { Guard, RequestLifecycleOptions } from '../guards.js';
import { escapeAttribute } from '../html.js';
import type { ErrorBoundaryRenderer, FragmentRenderer } from '../mutation-wire.js';
import type { InferSchema, Schema } from '../schema.js';
import type { JsonSerializable } from '../json-boundary.js';
import type { MutationStreamContext, MutationStreamSource } from './streaming.js';

/**
 * A typed mutation failure outcome (SPEC §9.2): a declared `error` `code` plus its
 * validated `payload`, served as HTTP 409 (optimistic concurrency conflict), 422
 * (validation/app `fail()`), 429 (rate limit, with optional `retryAfter`), or
 * framework-owned authenticated authorization denial as HTTP 403. Produced via
 * `MutationContext.fail` for app failures, by TOCTOU primitives for conflicts, and by
 * guards for authorization failures.
 */
export interface MutationFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  retryAfter?: number;
  status: 403 | 409 | 422 | 429;
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
  responseHeaders?: import('../response.js').MutationResponseHeaders;
  value: Value;
}

/** The outcome of a mutation: {@link MutationSuccess} or {@link MutationFail} (SPEC §9.1/§9.2). */
export type MutationResult<Value, Input = unknown> = MutationFail | MutationSuccess<Value, Input>;

/**
 * The `context` argument passed to a mutation `handler` (SPEC §9.1/§10.3). Exposes
 * `conflict` for stale optimistic-concurrency submits (KV429), `fail` to return a
 * typed {@link MutationFail} from the declared `errors`, `invalidate` to record a
 * domain change, and the typed `setCookie` builder (SPEC §9.1.1).
 */
export interface MutationContext<Errors extends Record<string, Schema<unknown>>> {
  conflict<Payload extends JsonSerializable<Record<string, unknown>> = Record<string, never>>(
    payload?: Payload,
  ): MutationFail<'CONFLICT', Payload>;
  fail<const Code extends Extract<keyof Errors, string>>(
    code: Code,
    payload: JsonSerializable<InferSchema<Errors[Code]>>,
  ): MutationFail<Code, JsonSerializable<InferSchema<Errors[Code]>>>;
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
  /**
   * Raw-SQL write table allowlist (SPEC §10.3): opaque writes declare every
   * physical table they mutate so runtime verification can fail closed.
   */
  tables?: readonly string[];
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
  queries?: readonly import('../query.js').RegisteredQueryDefinition[];
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
  access: AccessDecision;
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
 *     request.db.add(input.productId);
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

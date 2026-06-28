import type {
  InvalidationSets,
  OptimisticDerivationSets,
  QueryRegistry,
  Redirect,
} from '@kovojs/core';
import type { ChangeRecord, InvalidateOptions, MutationTouchSite } from '../change-record.js';
import type { AccessDecision } from '../access.js';
import type { CookieOptions } from '../cookies.js';
import type { CsrfValidationOptions } from '../csrf.js';
import type { Domain } from '../domain.js';
import type { Guard, RequestLifecycleOptions } from '../guards.js';
import { escapeAttribute } from '../html.js';
import type { ErrorBoundaryRenderer, FragmentRenderer } from '../mutation-wire.js';
import { mutationInputFileFields, type InferSchema, type Schema } from '../schema.js';
import type { JsonSerializable } from '../json-boundary.js';
import type { MutationStreamContext, MutationStreamSource } from './streaming.js';

/**
 * A typed mutation failure outcome (SPEC §9.2): a declared `error` `code` plus its
 * validated `payload`, served as HTTP 422 (validation/app `fail()`), 429 (rate limit,
 * with optional `retryAfter`), framework-owned authenticated authorization denial as HTTP
 * 403, or a KV429 stale-version optimistic-concurrency conflict as HTTP 409 (SPEC
 * §10.3/§11.1). Produced via `MutationContext.fail` for app failures, by guards for
 * authorization failures, and by the lifecycle when a `StaleVersionError` is thrown.
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
 * `fail` to return a typed {@link MutationFail} from the declared `errors`, `invalidate`
 * to record a domain change, and the typed `setCookie` builder (SPEC §9.1.1).
 */
export interface MutationContext<Errors extends Record<string, Schema<unknown>>> {
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

/**
 * One query's optimistic policy in a mutation's `optimistic` map (SPEC §10.4/§10.6). Three
 * forms, each counting toward KV310 exhaustiveness (§10.6):
 *
 * - a pure {@link MutationOptimisticTransform} — predict from input, for an UNKEYED query;
 * - a **keyed** `{ keys, transform }` pair — for a query with several INSTANCES on a page
 *   (`questionDetail:q3` vs `questionDetail:q7`, §10.2). Optimism is keyed to the *query*
 *   (§10.4), so a transform on a keyed detail query must say WHICH instance it predicts: the
 *   `keys` companion derives that instance key from the same validated mutation `input` the
 *   `transform` sees, exactly as the query's own instance key does (§10.2 — the WHERE
 *   eq-predicate resolved to `args.*`). `keys` returns either the canonical instance-key VALUE
 *   string (the `keyValue` of `name:keyValue`, §10.2:1040) or the declared args object (e.g.
 *   `{ id: input.targetId }`), whose values reduce to the keyValue in declared order. The
 *   lowered plan routes the prediction to that instance's store slot and reconciles it against
 *   the matching `<kovo-query name key>` server-truth chunk by `kovo-key` (§13.2), so the keyed
 *   detail view gets an INSTANT prediction instead of an `'await-fragment'` round-trip;
 * - `'await-fragment'` — a recorded decision to wait for the server fragment.
 */
export type MutationOptimisticEntry<Input = unknown, Value = unknown> =
  | MutationOptimisticTransform<Input, Value>
  | {
      keys: (input: Input) => string | Record<string, string | number | boolean>;
      transform: MutationOptimisticTransform<Input, Value>;
    }
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
 * A first-class shared mutation queue name (SPEC §4.1/§10.4): this is conceptual grouping
 * vocabulary, not a mutation registry identity. Use {@link queue} to construct one so shared
 * queues are explicit values instead of ad hoc strings.
 */
export class MutationQueue<Name extends string = string> {
  private readonly __mutationQueueBrand!: Name;

  private constructor(readonly name: Name) {}

  /** @internal */
  static create<const Name extends string>(name: Name): MutationQueue<Name> {
    return Object.freeze(new MutationQueue(name)) as MutationQueue<Name>;
  }
}

/**
 * Declare a named client-side FIFO queue shared by one or more mutations (SPEC §10.4). Use
 * `queue: true` for the common per-mutation queue derived from that mutation's own source identity;
 * use `queue('checkout')` only when several mutations intentionally share one queue.
 */
export function queue<const Name extends string>(name: Name): MutationQueue<Name> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('queue(name) requires a non-empty queue name.');
  }
  return MutationQueue.create(name);
}

function isMutationQueue(value: unknown): value is MutationQueue {
  return value instanceof MutationQueue;
}

function normalizeMutationQueue(
  queueValue: string | true | MutationQueue | undefined,
): string | true | undefined {
  if (isMutationQueue(queueValue)) return queueValue.name;
  return queueValue;
}

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
  access?: AccessDecision;
  csrf?: CsrfValidationOptions<Request> | false;
  /** Static/common POST-redirect-GET target for successful no-JS submissions (SPEC §9.1). */
  defaultRedirectTo?: string;
  /** @internal Derived from `input` when the schema contains `s.file()` fields. */
  enctype?: 'multipart/form-data';
  errors?: Errors;
  /** @internal Top-level input field names that require multipart form encoding. */
  fileFields?: readonly string[];
  guard?: Guard<Request, GuardedRequest>;
  handler: (
    input: InferSchema<InputSchema>,
    request: GuardedRequest,
    context: MutationContext<Errors>,
  ) => Promise<Value | MutationFail> | Value | MutationFail;
  input: InputSchema;
  key: Key;
  optimistic?: MutationOptimisticMap<Key, InputSchema>;
  queue?: string | true | MutationQueue;
  /**
   * Mutation-local success redirect policy for dynamic POST-redirect-GET targets (SPEC §9.1 PRG).
   * Accepts three forms:
   * - a plain `string` path (legacy/back-compat, not route-table validated);
   * - a typed {@link Redirect} value from `redirect('/chat/:id', { params })` (`@kovojs/core`,
   *   SPEC §6.4:724) — the preferred create-then-navigate form. Because the typed value can only be
   *   minted by a path-typed `redirect()` call, the target participates in KV220 route-table path
   *   typing and route-rename propagation: a wrong path or param is a type error at the `redirect()`
   *   call, and renaming the route turns every such `redirect()` red (SPEC §6.2/§6.4:724);
   * - a function of the success `result` returning either form, for the common create-then-navigate
   *   case where the new row id is only known after the handler runs, e.g.
   *   `redirectTo: (r) => redirect('/chat/:id', { params: { id: r.value.id } })`.
   * The resolved `location` is re-sanitized at the framework Location sink (SPEC §6.6).
   */
  redirectTo?:
    | string
    | Redirect
    | ((result: MutationSuccess<Value, InferSchema<InputSchema>>) => string | Redirect);
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
  enctype?: 'multipart/form-data';
  fileFields?: readonly string[];
  input?: Schema<unknown>;
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
  /** Required for no-JS file uploads when the mutation input contains `s.file()`. */
  enctype?: 'multipart/form-data';
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
  /**
   * The already parsed+coerced input, wrapped so a value of `undefined` is still distinguishable
   * from "not provided". The enhanced/no-JS dispatch paths parse the input once before the
   * pre-replay arg-aware guard (SPEC §10.3:1155-1157 — to thread validated `req.args` onto the
   * guard) and pass it here so `runMutation` reuses it instead of re-parsing. Only set alongside
   * `guardResolved`; direct callers omit it and `runMutation` parses `rawInput` itself.
   */
  preParsedInput?: { value: unknown };
}

/** App-scoped mutation factory. `createApp()` uses this to contextually type handlers from configured request providers (SPEC §9.5/§10.3). */
export interface MutationFactory<Request = unknown> {
  <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
    ContextRequest extends Request = Request,
    Value = unknown,
    GuardedRequest extends ContextRequest = ContextRequest,
  >(
    definition: Omit<
      MutationDefinition<string, InputSchema, Errors, ContextRequest, Value, GuardedRequest>,
      'key'
    >,
  ): MutationDefinition<string, InputSchema, Errors, ContextRequest, Value, GuardedRequest> & {
    key: string;
  };
}

/**
 * Declare a typed write. App-authored mutations use object form and the compiler derives the stable
 * registry key from the exported binding plus module path (SPEC §4.1/§10.3). A mutation couples an
 * input `Schema`, a `handler` that performs the write, optional typed `errors`, an optional `guard`,
 * an optional static `defaultRedirectTo`, and an optional `transaction` wrapper. The input schema
 * doubles as `FormData` coercion; `context.fail(code, payload)` returns a typed failure;
 * `context.invalidate(domain)` records what the write touched so dependent queries rerun. CSRF is
 * default-on — supply `csrf` or set it to `false` with justification.
 *
 * @param definition - Input schema, handler, and optional errors/guard/transaction/csrf.
 * @returns A `MutationDefinition` that receives its stable key from compiler-emitted metadata.
 * @example
 * import { mutation, s } from '@kovojs/server';
 *
 * interface CartRequest {
 *   db: { add(productId: string, quantity: number): void };
 * }
 *
 * export const addToCart = mutation({
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
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
>(
  definition: Omit<
    MutationDefinition<string, InputSchema, Errors, Request, Value, GuardedRequest>,
    'key'
  >,
): MutationDefinition<string, InputSchema, Errors, Request, Value, GuardedRequest> & {
  key: string;
};
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
): MutationDefinition<Key, InputSchema, Errors, Request, Value, GuardedRequest> & { key: Key };
export function mutation(
  keyOrDefinition: string | Omit<MutationDefinition<any, any, any, any, any, any>, 'key'>,
  definition?: Omit<MutationDefinition<any, any, any, any, any, any>, 'key'>,
): MutationDefinition<string> & { key: string } {
  if (typeof keyOrDefinition === 'string') {
    if (definition === undefined) {
      throw new TypeError('mutation(key, definition) requires a definition object.');
    }
    const fileFields = mutationInputFileFields(definition.input);
    const queue =
      definition.queue === true ? keyOrDefinition : normalizeMutationQueue(definition.queue);
    return {
      ...definition,
      ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
      key: keyOrDefinition,
      ...(queue === undefined ? {} : { queue }),
    } as MutationDefinition<string> & { key: string };
  }

  // SPEC §6.3: app authors may write `mutation({ input, handler })`; the stable wire key is
  // source-derived by the compiler because runtime JavaScript cannot prove export binding names.
  // Compiler-emitted IR assigns `.key` immediately after the declaration. Until then, helpers that
  // need a wire endpoint fail closed through `assertMutationKey`.
  const fileFields = mutationInputFileFields(keyOrDefinition.input);
  const queue = normalizeMutationQueue(keyOrDefinition.queue);
  return {
    ...keyOrDefinition,
    ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const, fileFields }),
    ...(queue === undefined ? {} : { queue }),
  } as MutationDefinition<string> & { key: string };
}

/**
 * @internal Compiler-emitted/generated ABI for SPEC §4.1 source-derived mutation identities.
 *
 * Runtime-only `mutation({ ... })` cannot know the source module path or exported binding. Generated
 * modules call this before `createApp()` consumes exported declarations so `/_m/<key>`, CSRF
 * audience binding, replay scopes, forms, and invalidation registries observe the derived key.
 */
export function assignDerivedMutationKey<Mutation extends MutationDefinition<string>>(
  definition: Mutation,
  key: string,
): Mutation {
  if (!key) {
    throw new TypeError('assignDerivedMutationKey() requires a non-empty mutation key.');
  }
  if (typeof definition.key === 'string' && definition.key.length > 0 && definition.key !== key) {
    throw new TypeError(
      `Cannot assign derived mutation key "${key}" to mutation already keyed as "${definition.key}".`,
    );
  }
  definition.key = key;
  if (definition.queue === true) definition.queue = key;
  else {
    const queue = normalizeMutationQueue(definition.queue);
    if (queue === undefined) delete definition.queue;
    else definition.queue = queue;
  }
  return definition;
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
  assertMutationKey(definition);
  const fileFields =
    definition.fileFields ?? (definition.input ? mutationInputFileFields(definition.input) : []);
  return {
    action: `/_m/${definition.key}`,
    'data-mutation': definition.key,
    enhance: true,
    ...(fileFields.length === 0 ? {} : { enctype: 'multipart/form-data' as const }),
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
  )}"${attributes.enctype ? ` enctype="${attributes.enctype}"` : ''} enhance data-mutation="${escapeAttribute(attributes['data-mutation'])}"`;
}

function assertMutationKey<Key extends string, Request>(
  definition: MutationFormDefinition<Key, Request>,
): asserts definition is MutationFormDefinition<Key, Request> & { key: Key } {
  if (typeof definition.key !== 'string' || definition.key.length === 0) {
    throw new TypeError(
      'mutation({ input, handler }) has no runtime key until the Kovo compiler derives one from ' +
        'the exported binding. Use the compiled artifact or keep the internal generated key path.',
    );
  }
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

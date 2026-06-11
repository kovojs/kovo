import { createHmac, timingSafeEqual } from 'node:crypto';

import type { JsonValue } from '@jiso/core';

export { Link, href, redirect } from '@jiso/core';
export type { DiagnosticCode, JsonValue, LinkDescriptor, Redirect, Route } from '@jiso/core';

export interface Schema<T> {
  parse(input: unknown): T;
}

export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

type PathParamNames<Path extends string> = Path extends `${string}:${infer Rest}`
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | PathParamNames<Tail>
    : Rest extends `${infer Param}?${string}`
      ? Param
      : Rest
  : never;

type PathParams<Path extends string> =
  PathParamNames<Path> extends never ? {} : Record<PathParamNames<Path>, string>;

type MaybeSchema<Value> = Schema<Value> | undefined;

type RouteParamsFor<Path extends string, ParamsSchema extends MaybeSchema<Record<string, string>>> =
  ParamsSchema extends Schema<infer Params> ? Params : PathParams<Path>;

type RouteSearchFor<SearchSchema extends MaybeSchema<Record<string, JsonValue>>> =
  SearchSchema extends Schema<infer Search> ? Search : Record<string, JsonValue>;

export interface ValidationIssue {
  message: string;
  path: readonly string[];
}

export interface ValidationFailurePayload {
  issues: readonly ValidationIssue[];
}

export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues[0]?.message ?? 'Invalid input');
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }
}

export const s = {
  array<Item>(item: Schema<Item>): Schema<Item[]> {
    return {
      parse(input: unknown): Item[] {
        const values =
          input === undefined || input === null ? [] : Array.isArray(input) ? input : [input];

        return values.map((value, index) => {
          try {
            return item.parse(value);
          } catch (error) {
            throw validationErrorFrom(error, [String(index)]);
          }
        });
      },
    };
  },
  boolean(): Schema<boolean> {
    return {
      parse(input: unknown): boolean {
        if (typeof input === 'boolean') return input;
        if (input === undefined || input === null || input === '') return false;
        if (typeof input === 'number' && (input === 0 || input === 1)) return Boolean(input);

        if (typeof input === 'string') {
          const value = input.toLowerCase();
          if (['1', 'on', 'true', 'yes'].includes(value)) return true;
          if (['0', 'false', 'no', 'off'].includes(value)) return false;
        }

        throw validationError('Expected boolean');
      },
    };
  },
  file(options: FileSchemaOptions = {}): FileSchema {
    return new FileSchemaImpl(options);
  },
  string(): Schema<string> {
    return {
      parse(input: unknown): string {
        if (typeof input !== 'string') throw validationError('Expected string');
        return input;
      },
    };
  },
  number(): NumberSchema {
    return new NumberSchemaImpl();
  },
  object<const Shape extends Record<string, Schema<unknown>>>(
    shape: Shape,
  ): Schema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
    return {
      parse(input: unknown): { [Key in keyof Shape]: InferSchema<Shape[Key]> } {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = schema.parse(record[String(key)]) as InferSchema<Shape[keyof Shape]>;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
    };
  },
};

export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

export interface FileSchema extends Schema<FileLike> {
  maxBytes(value: number): FileSchema;
  mime(types: readonly string[]): FileSchema;
}

export interface FileSchemaOptions {
  maxBytes?: number;
  mime?: readonly string[];
}

export interface NumberSchema extends Schema<number> {
  default(value: number): NumberSchema;
  int(): NumberSchema;
  min(value: number): NumberSchema;
}

class NumberSchemaImpl implements NumberSchema {
  #defaultValue: number | undefined;
  #integer = false;
  #minimum: number | undefined;

  default(value: number): NumberSchema {
    this.#defaultValue = value;
    return this;
  }

  int(): NumberSchema {
    this.#integer = true;
    return this;
  }

  min(value: number): NumberSchema {
    this.#minimum = value;
    return this;
  }

  parse(input: unknown): number {
    const value =
      input === undefined || input === null || input === '' ? this.#defaultValue : input;
    const number = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(number)) throw validationError('Expected number');
    if (this.#integer && !Number.isInteger(number)) throw validationError('Expected integer');
    if (this.#minimum !== undefined && number < this.#minimum) {
      throw validationError(`Expected number >= ${this.#minimum}`);
    }

    return number;
  }
}

class FileSchemaImpl implements FileSchema {
  #maxBytes: number | undefined;
  #mime: readonly string[] | undefined;

  constructor(options: FileSchemaOptions = {}) {
    this.#maxBytes = options.maxBytes;
    this.#mime = options.mime;
  }

  maxBytes(value: number): FileSchema {
    this.#maxBytes = value;
    return this;
  }

  mime(types: readonly string[]): FileSchema {
    this.#mime = types;
    return this;
  }

  parse(input: unknown): FileLike {
    if (!isFileLike(input)) throw validationError('Expected file');
    if (this.#maxBytes !== undefined && input.size > this.#maxBytes) {
      throw validationError(`Expected file <= ${this.#maxBytes} bytes`);
    }
    if (this.#mime && !this.#mime.includes(input.type)) {
      throw validationError(`Expected file type ${this.#mime.join(', ')}`);
    }

    return input;
  }
}

export interface Guard<Request, RefinedRequest extends Request = Request> {
  (request: Request): boolean | Promise<boolean>;
  readonly refines?: (request: Request) => request is RefinedRequest;
}

export interface SessionUserLike {
  id?: string;
  roles?: readonly string[];
}

export interface SessionRequestLike {
  session?: {
    id?: string;
    user?: SessionUserLike | null;
  } | null;
}

export type AuthenticatedRequest<Request extends SessionRequestLike> = Request & {
  session: NonNullable<Request['session']> & {
    user: NonNullable<NonNullable<Request['session']>['user']>;
  };
};

export interface SessionDefinition<Value> {
  parse(request: { session?: unknown }): Value;
  schema: Schema<Value>;
}

export interface RateLimitOptions<Request> {
  key?: (request: Request) => string;
  max: number;
  per?: 'global' | 'session';
  windowMs?: number;
}

export const guards = {
  all<Request, RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest> {
    return async (request: Request) => {
      for (const item of items) {
        if (!(await item(request))) return false;
      }

      return true;
    };
  },
  authed<Request extends SessionRequestLike>(): Guard<Request, AuthenticatedRequest<Request>> {
    return (request) => Boolean(request.session?.user);
  },
  rateLimit<Request extends SessionRequestLike>(
    options: RateLimitOptions<Request>,
  ): Guard<Request> {
    const counts = new Map<string, { count: number; resetAt: number }>();

    return (request) => {
      const now = Date.now();
      const key = rateLimitKey(request, options);
      const existing = counts.get(key);

      if (existing && (options.windowMs === undefined || existing.resetAt > now)) {
        if (existing.count >= options.max) return false;

        existing.count += 1;
        return true;
      }

      counts.set(key, {
        count: 1,
        resetAt: options.windowMs === undefined ? Number.POSITIVE_INFINITY : now + options.windowMs,
      });
      return options.max > 0;
    };
  },
  role<Request extends SessionRequestLike>(role: string): Guard<Request> {
    return (request) => request.session?.user?.roles?.includes(role) ?? false;
  },
};

export function session<Value>(schema: Schema<Value>): SessionDefinition<Value> {
  return {
    parse(request) {
      return schema.parse(request.session);
    },
    schema,
  };
}

export interface MutationFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  status: 422;
}

export interface MutationSuccess<Value> {
  changes: ChangeRecord[];
  rerunQueryInstances?: QueryRerun[];
  rerunQueries: string[];
  ok: true;
  value: Value;
}

export type MutationResult<Value> = MutationFail | MutationSuccess<Value>;

export interface MutationContext<Errors extends Record<string, Schema<unknown>>> {
  fail<const Code extends Extract<keyof Errors, string>>(
    code: Code,
    payload: InferSchema<Errors[Code]>,
  ): MutationFail<Code, InferSchema<Errors[Code]>>;
  invalidate<const DomainKey extends string, Input = unknown>(
    domain: Domain<DomainKey>,
    options?: InvalidateOptions<Input>,
  ): ChangeRecord<DomainKey, Input>;
}

export interface Domain<Key extends string = string> {
  key: Key;
}

export function domain<const Key extends string>(key: Key): Domain<Key> {
  return { key };
}

export type Tag<Key extends string = string> = Domain<Key>;

export function tag<const Key extends string>(key: Key): Tag<Key> {
  return domain(key);
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

export interface QueryLoadContext<Request = unknown> {
  request: Request;
}

export interface QueryEndpointRequest<Request = unknown> {
  request: Request;
  search?: QuerySearchInput;
}

export type QuerySearchInput =
  | URLSearchParams
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>;

export interface QueryEndpointResponse {
  body: string;
  headers: Record<string, string>;
  status: 200 | 404 | 422;
}

export interface QueryEndpointRegistry<Request = unknown> {
  queries: readonly QueryDefinition<string, unknown, unknown, Request>[];
}

export interface QueryDefinition<
  Key extends string = string,
  Value = unknown,
  Input = unknown,
  Request = unknown,
> {
  args?: Schema<Input>;
  guard?: Guard<Request>;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  key: Key;
  output?: Schema<Value>;
  reads: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

type BivariantGuard<Request> = {
  call(request: Request): boolean | Promise<boolean>;
}['call'];

interface QueryArgsDeclarationDefinition<Key extends string, Value, Input, Request> {
  args: Schema<Input>;
  guard?: BivariantGuard<Request>;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key?: Key;
  load?(input: Input, context?: QueryLoadContext<Request>): Promise<Value> | Value;
  output?: Schema<Value>;
  reads: readonly Domain[];
  version?: ((input: Input, value: Value) => number | string | undefined) | number | string;
}

type BivariantQueryGuard = {
  call(request: unknown): boolean | Promise<boolean>;
}['call'];

type BivariantQueryLoad = {
  call(input: unknown, context?: QueryLoadContext<unknown>): unknown;
}['call'];

type BivariantQueryVersion = {
  call(input: unknown, value: unknown): number | string | undefined;
}['call'];

export interface RegisteredQueryDefinition {
  args?: Schema<unknown>;
  guard?: BivariantQueryGuard;
  instanceKey?: ((input: unknown) => string | undefined) | string;
  key: string;
  load?: BivariantQueryLoad;
  output?: Schema<unknown>;
  reads: readonly Domain[];
  version?: BivariantQueryVersion | number | string;
}

export function query<
  const Key extends string,
  Input,
  Request,
  Value,
  const Definition extends Omit<QueryArgsDeclarationDefinition<Key, Value, Input, Request>, 'key'>,
>(key: Key, definition: Definition): Definition & { key: Key };
export function query<
  const Key extends string,
  const Definition extends Omit<RegisteredQueryDefinition, 'key'>,
>(key: Key, definition: Definition): Definition & { key: Key };
export function query<const Key extends string>(
  key: Key,
  definition: Omit<RegisteredQueryDefinition, 'key'>,
): Omit<RegisteredQueryDefinition, 'key'> & { key: Key } {
  return { ...definition, key };
}

export type QueryResult<Query> = Query extends { load: (...args: never[]) => infer Value }
  ? Awaited<Value>
  : unknown;

export async function runQuery<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  rawInput: unknown,
  request: Request,
): Promise<QueryEndpointResult<Value, Input>> {
  const argsResult = parseQueryInput(definition, rawInput);
  if (!argsResult.ok) return argsResult.failure;

  if (definition.guard && !(await definition.guard(request))) {
    return {
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const input = argsResult.value;
  const value = definition.load ? await definition.load(input, { request }) : (null as Value);
  return { input, ok: true, value };
}

export type QueryEndpointResult<Value, Input = unknown> =
  | QueryEndpointSuccess<Value, Input>
  | QueryEndpointFailure;

export interface QueryEndpointSuccess<Value, Input = unknown> {
  input: Input;
  ok: true;
  value: Value;
}

export interface QueryEndpointFailure {
  error: {
    code: 'UNAUTHORIZED' | 'VALIDATION';
    payload: Record<string, unknown> | ValidationFailurePayload;
  };
  ok: false;
  status: 422;
}

export async function renderQueryEndpointResponse<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const rawInput = querySearchInputToRecord(endpointRequest.search ?? {});
  const result = await runQuery(definition, rawInput, endpointRequest.request);

  if (!result.ok) {
    return {
      body: JSON.stringify(result.error),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 422,
    };
  }

  return {
    body: renderQueryEndpointChunk(definition, result.input, result.value),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 200,
  };
}

export async function renderQueryRegistryEndpointResponse<Request>(
  registry: QueryEndpointRegistry<Request>,
  queryKey: string,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const definition = registry.queries.find((queryDefinition) => queryDefinition.key === queryKey);

  if (!definition) {
    return {
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    };
  }

  return renderQueryEndpointResponse(definition, endpointRequest);
}

export interface ChangeRecord<DomainKey extends string = string, Input = unknown> {
  domain: DomainKey;
  keys?: readonly string[];
  input?: Input;
  manual?: true;
  reason?: string;
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

export interface MutationTouchSite {
  domain: string;
  keys: null | string;
}

export interface FragmentRenderer {
  errorBoundary?: ErrorBoundaryRenderer;
  mode?: 'append' | 'replace';
  render(input: unknown): string | Promise<string>;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
}

export interface ErrorBoundaryRenderer {
  render(error: unknown, input: unknown): string | Promise<string>;
  target?: string;
}

export interface MutationWireRequest<Request> {
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragment?: boolean;
  fragmentRenderers?: readonly FragmentRenderer[];
  idem?: string;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore;
  rawInput: unknown;
  request: Request;
  targets?: readonly string[];
}

export interface MutationWireHeaders {
  fragment: boolean;
  idem?: string;
  targets: readonly string[];
}

export type MutationWireHeaderSource =
  | Iterable<readonly [string, string]>
  | Record<string, readonly string[] | string | undefined>
  | {
      get(name: string): null | string;
    };

export interface MutationWireRequestOptions<Request> {
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  headers: MutationWireHeaderSource;
  rawInput: unknown;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore;
  request: Request;
}

export interface MutationWireResponse {
  body: string;
  headers: Record<string, string>;
  status: 200 | 422;
}

export interface MutationReplayStore {
  get(scope: string, idem: string): MutationWireResponse | undefined;
  set(scope: string, idem: string, response: MutationWireResponse): void;
}

export function createMemoryMutationReplayStore(
  options: { maxEntries?: number; ttlMs?: number } = {},
): MutationReplayStore {
  const maxEntries = options.maxEntries ?? 1_000;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const responses = new Map<string, { expiresAt: number; response: MutationWireResponse }>();

  return {
    get(scope, idem) {
      const key = mutationReplayKey(scope, idem);
      const record = responses.get(key);
      if (!record) return undefined;
      if (record.expiresAt <= Date.now()) {
        responses.delete(key);
        return undefined;
      }

      return cloneMutationWireResponse(record.response);
    },
    set(scope, idem, response) {
      evictExpiredMutationReplays(responses);
      while (responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        responses.delete(oldest);
      }

      responses.set(mutationReplayKey(scope, idem), {
        expiresAt: Date.now() + ttlMs,
        response: cloneMutationWireResponse(response),
      });
    },
  };
}

export function readMutationWireHeaders(headers: MutationWireHeaderSource): MutationWireHeaders {
  const fragment = readHeader(headers, 'FW-Fragment')?.toLowerCase() === 'true';
  const idem = readHeader(headers, 'FW-Idem')?.trim();
  const targets = dedupe(
    (readHeader(headers, 'FW-Targets') ?? '')
      .split(/[;,]/)
      .map((target) => target.trim())
      .map((target) => target.split('=')[0]?.trim() ?? '')
      .filter(Boolean),
  );

  return {
    fragment,
    ...(idem ? { idem } : {}),
    targets,
  };
}

export function mutationWireRequestFromHeaders<Request>(
  options: MutationWireRequestOptions<Request>,
): MutationWireRequest<Request> {
  const headers = readMutationWireHeaders(options.headers);

  return {
    fragment: headers.fragment,
    rawInput: options.rawInput,
    request: options.request,
    ...(options.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(options.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: options.failureStylesheets }),
    ...(options.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: options.fragmentRenderers }),
    ...(headers.idem === undefined ? {} : { idem: headers.idem }),
    ...(options.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    targets: headers.targets,
  };
}

export interface NoJsMutationRequest<Request, Value> {
  rawInput: unknown;
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
  request: Request;
}

export interface NoJsMutationResponse {
  body: string;
  headers: Record<string, string>;
  status: 303 | 422;
}

export interface MutationEndpointRequest<
  Request,
  Value,
> extends MutationWireRequestOptions<Request> {
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type MutationEndpointResponse = MutationWireResponse | NoJsMutationResponse;

export type RoutePrefetch = 'conservative' | 'moderate' | false;

export interface RouteMeta {
  description?: string;
  image?: string;
  title?: string;
}

export interface RouteMetaFactory {
  queries: readonly string[];
  resolve(values: Record<string, unknown>): RouteMeta;
}

export type RouteMetaSource = RouteMeta | RouteMetaFactory;

export interface RouteRequest<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
> {
  params: RouteParamsFor<Path, ParamsSchema>;
  path: Path;
  search: RouteSearchFor<SearchSchema>;
}

export interface RouteDefinition<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
> extends PageHintOptions {
  guard?: Guard<Request, GuardedRequest>;
  page?: (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) => Page | NotFound | Promise<Page | NotFound>;
  params?: ParamsSchema;
  search?: SearchSchema;
}

export interface RouteDeclaration<
  Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
> extends RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> {
  path: Path;
}

export interface NotFound {
  notFound: true;
  status: 404;
}

export interface RoutePageResponse {
  body: string;
  headers: Record<string, string>;
  status: 200 | 404 | 422;
}

export interface RouteRequestInput {
  params?: unknown;
  search?: unknown;
}

export interface I18nCatalog<Messages extends Record<string, string> = Record<string, string>> {
  locale: string;
  messages: Messages;
}

export interface StylesheetAsset {
  criticalCss?: string;
  href: string;
  preload?: boolean;
}

export interface StylesheetManifestEntry extends StylesheetAsset {
  fragmentTargets?: readonly string[];
  sourceFileName?: string;
}

export interface PageHintOptions {
  bootstrapScript?: string;
  i18n?: I18nCatalog | readonly I18nCatalog[];
  meta?: RouteMetaSource | readonly RouteMetaSource[];
  modulepreloads?: readonly string[];
  prefetch?: RoutePrefetch;
  prerenderUrls?: readonly string[];
  stylesheets?: readonly (string | StylesheetAsset)[];
}

export interface PageHintRenderContext {
  queries?: Record<string, unknown>;
}

export interface PageHints {
  earlyHints: Record<string, string>;
  html: string;
}

export function stylesheetsForTargets(
  manifest: readonly StylesheetManifestEntry[],
  targets?: readonly string[],
): StylesheetAsset[] {
  if (!targets) return dedupeStylesheets(manifest);

  const wanted = new Set(targets);
  return dedupeStylesheets(
    manifest.filter((asset) => asset.fragmentTargets?.some((target) => wanted.has(target))),
  );
}

export interface DeferredQueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

export type DeferredPriority = 'high' | 'normal' | 'low' | number;

export interface DeferredFragmentChunk {
  html: string;
  mode?: 'append' | 'replace';
  priority?: DeferredPriority;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
}

export interface DeferredStreamOptions {
  boundary?: string;
  chunks: readonly DeferredStreamChunk[];
  closeHtml?: string;
  shell: string;
}

export interface DeferredStreamChunk {
  fragments: readonly DeferredFragmentChunk[];
  priority?: DeferredPriority;
  queries?: readonly DeferredQueryChunk[];
}

export interface DeferredStreamResponse {
  body: string;
  headers: Record<string, string>;
  status: 200;
}

export interface MutationDefinition<
  Key extends string = string,
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Errors extends Record<string, Schema<unknown>> = Record<string, Schema<unknown>>,
  Request = unknown,
  Value = unknown,
  GuardedRequest extends Request = Request,
> {
  csrf?: CsrfValidationOptions<Request>;
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

export interface CsrfOptions<Request> {
  secret: string;
  sessionId: (request: Request) => string | undefined;
}

export interface CsrfValidationOptions<Request> extends CsrfOptions<Request> {
  field?: string;
}

export interface InvalidateOptions<Input = unknown> {
  input?: Input;
  keys?: readonly string[];
  reason?: string;
}

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

export function route<
  const Path extends string,
  const ParamsSchema extends MaybeSchema<Record<string, string>> = undefined,
  const SearchSchema extends MaybeSchema<Record<string, JsonValue>> = undefined,
  Request = unknown,
  Page = unknown,
  GuardedRequest extends Request = Request,
>(
  path: Path,
  definition: RouteDefinition<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> = {},
): RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest> {
  return { ...definition, path };
}

export function csrfToken<Request>(request: Request, options: CsrfOptions<Request>): string {
  const sessionId = options.sessionId(request);
  if (!sessionId) throw new Error('csrfToken requires a session id');

  return createCsrfToken(sessionId, options.secret);
}

export function csrfField<Request>(
  request: Request,
  options: CsrfOptions<Request> & { field?: string },
): string {
  return `<input type="hidden" name="${escapeAttribute(options.field ?? 'fw-csrf')}" value="${escapeAttribute(csrfToken(request, options))}">`;
}

export function parseRouteRequest<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput = {},
): RouteRequest<Path, ParamsSchema, SearchSchema> {
  const params = definition.params
    ? definition.params.parse(input.params ?? {})
    : ((input.params ?? {}) as RouteParamsFor<Path, ParamsSchema>);
  const search = definition.search
    ? definition.search.parse(input.search ?? {})
    : ((input.search ?? {}) as RouteSearchFor<SearchSchema>);

  return {
    params: params as RouteParamsFor<Path, ParamsSchema>,
    path: definition.path,
    search: search as RouteSearchFor<SearchSchema>,
  };
}

export function notFound(): NotFound {
  return { notFound: true, status: 404 };
}

export async function runRoutePage<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
): Promise<RoutePageResult<Page>> {
  const routeRequest = parseRouteRequest(definition, input);

  if (definition.guard && !(await definition.guard(request))) {
    return {
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const value = await definition.page?.(routeRequest, request as GuardedRequest);
  if (isNotFound(value)) return { ok: false, status: 404 };
  return { ok: true, value: value as Page };
}

export type RoutePageResult<Page> = RoutePageSuccess<Page> | RoutePageFailure;

export interface RoutePageSuccess<Page> {
  ok: true;
  value: Page;
}

export interface RoutePageFailure {
  error?: {
    code: 'UNAUTHORIZED';
    payload: Record<string, unknown>;
  };
  ok: false;
  status: 404 | 422;
}

export async function renderRoutePageResponse<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
  GuardedRequest extends Request = Request,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page, GuardedRequest>,
  input: RouteRequestInput,
  request: Request,
  render: (value: Page) => string | Promise<string> = (value) => String(value ?? ''),
): Promise<RoutePageResponse> {
  const result = await runRoutePage(definition, input, request);

  if (!result.ok) {
    return {
      body: result.status === 404 ? 'Not Found' : 'Unauthorized',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: result.status,
    };
  }

  return {
    body: await render(result.value),
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 200,
  };
}

export function meta<const Meta extends RouteMeta>(definition: Meta): Meta {
  return definition;
}

export function metaFromQuery<const Query extends QueryDefinition, const Meta extends RouteMeta>(
  queryDefinition: Query,
  derive: (value: QueryResult<Query>) => Meta,
): RouteMetaFactory;
export function metaFromQuery<
  const Query extends { load?: (input: never) => unknown },
  const Meta extends RouteMeta,
>(_query: Query, value: QueryResult<Query>, derive: (value: QueryResult<Query>) => Meta): Meta;
export function metaFromQuery<
  const Query extends { key?: string; load?: (input: never) => unknown },
  const Meta extends RouteMeta,
>(
  queryDefinition: Query,
  valueOrDerive: QueryResult<Query> | ((value: QueryResult<Query>) => Meta),
  maybeDerive?: (value: QueryResult<Query>) => Meta,
): Meta | RouteMetaFactory {
  if (typeof valueOrDerive === 'function') {
    const key = queryDefinition.key;
    const derive = valueOrDerive as (value: QueryResult<Query>) => Meta;
    if (!key) throw new Error('metaFromQuery requires a query key for deferred meta');

    return {
      queries: [key],
      resolve(values) {
        const value = values[key] as QueryResult<Query>;
        return derive(value);
      },
    };
  }

  if (!maybeDerive) throw new Error('metaFromQuery requires a derive function');
  return maybeDerive(valueOrDerive);
}

export function errorBoundary<Renderer extends FragmentRenderer>(
  renderer: Renderer,
  boundary: ErrorBoundaryRenderer,
): Renderer & { errorBoundary: ErrorBoundaryRenderer } {
  return { ...renderer, errorBoundary: boundary };
}

export function i18n<const Messages extends Record<string, string>>(
  locale: string,
  messages: Messages,
): I18nCatalog<Messages> {
  return { locale, messages };
}

export function t<
  Messages extends Record<string, string>,
  Key extends Extract<keyof Messages, string>,
>(catalog: I18nCatalog<Messages>, key: Key, values: Record<string, string | number> = {}): string {
  const message = catalog.messages[key];
  if (message === undefined) throw new Error(`Missing i18n message: ${key}`);

  return message.replace(/\{(?<name>[A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

export function renderPageHints(
  options: PageHintOptions,
  context: PageHintRenderContext = {},
): PageHints {
  const modulepreloads = dedupe([
    ...(options.modulepreloads ?? []),
    ...(options.bootstrapScript ? [options.bootstrapScript] : []),
  ]);
  const stylesheets = dedupeStylesheets(options.stylesheets ?? []);
  const html = [
    ...renderRouteMeta(options.meta, context),
    ...renderI18nCatalogs(options.i18n),
    ...stylesheets.map(renderPageStylesheetHint),
    ...modulepreloads.map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`),
    options.bootstrapScript
      ? `<script type="module" src="${escapeAttribute(options.bootstrapScript)}"></script>`
      : '',
    renderSpeculationRules(options.prefetch ?? false, options.prerenderUrls ?? []),
  ]
    .filter(Boolean)
    .join('');

  return {
    earlyHints: renderEarlyHints(stylesheets, modulepreloads),
    html,
  };
}

export function renderDeferredStream(options: DeferredStreamOptions): DeferredStreamResponse {
  const boundary = options.boundary ?? 'jiso-boundary';
  const chunks = sortDeferredChunks(options.chunks).map((chunk) =>
    [
      `--${boundary}`,
      ...renderDeferredQueryChunks(chunk.queries ?? []),
      ...sortDeferredFragments(chunk.fragments).map(renderDeferredFragmentChunk),
    ].join('\n'),
  );

  return {
    body: [options.shell, ...chunks, `--${boundary}--`, options.closeHtml ?? ''].join('\n'),
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
    status: 200,
  };
}

function renderDeferredFragmentChunk(fragment: DeferredFragmentChunk): string {
  const priority =
    fragment.priority !== undefined
      ? ` priority="${escapeAttribute(String(fragment.priority))}"`
      : '';
  const mode = fragment.mode === 'append' ? ' mode="append"' : '';
  const stylesheets = renderStylesheetLinks(fragment.stylesheets ?? []);

  return `<fw-fragment target="${escapeAttribute(fragment.target)}"${mode}${priority}>${stylesheets}${fragment.html}</fw-fragment>`;
}

function renderFragmentOpen(target: string, mode?: 'append' | 'replace'): string {
  const modeAttribute = mode === 'append' ? ' mode="append"' : '';
  return `<fw-fragment target="${escapeAttribute(target)}"${modeAttribute}>`;
}

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
): Promise<MutationResult<Value>> {
  if (definition.csrf && !validateCsrfToken(rawInput, request, definition.csrf)) {
    return {
      error: { code: 'CSRF', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const inputResult = parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return inputResult.failure;

  const input = inputResult.value as InferSchema<InputSchema>;

  if (definition.guard && !(await definition.guard(request))) {
    return {
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const manualInvalidations: ChangeRecord[] = [];
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
  };
  const runHandler = async (handlerRequest: GuardedRequest): Promise<Value> => {
    const handlerValue = await definition.handler(input, handlerRequest, context);

    if (isMutationFail(handlerValue)) {
      throw new MutationRollback(handlerValue);
    }

    return handlerValue as Value;
  };
  const guardedRequest = request as GuardedRequest;

  let value: Value;

  try {
    value = definition.transaction
      ? await definition.transaction(request, runHandler)
      : await runHandler(guardedRequest);
  } catch (error) {
    if (error instanceof MutationRollback) return error.failure;
    throw error;
  }

  const changes = [...registryChangeRecords(definition.registry, input), ...manualInvalidations];
  const rerunQueryInstances = queriesToRerun(definition.registry?.queries ?? [], changes, input);
  return {
    changes,
    ok: true,
    ...(rerunQueryInstances.some((query) => query.instanceKey !== undefined)
      ? { rerunQueryInstances }
      : {}),
    rerunQueries: [...new Set(rerunQueryInstances.map((query) => query.key))],
    value,
  };
}

class MutationRollback extends Error {
  readonly failure: MutationFail;

  constructor(failure: MutationFail) {
    super(failure.error.code);
    this.name = 'MutationRollback';
    this.failure = failure;
  }
}

export function invalidate<const DomainKey extends string, Input = unknown>(
  domain: Domain<DomainKey>,
  options: InvalidateOptions<Input> = {},
): ChangeRecord<DomainKey, Input> {
  return {
    domain: domain.key,
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.keys === undefined ? {} : { keys: options.keys }),
    manual: true,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
}

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
  if (
    definition.csrf &&
    !validateCsrfToken(wireRequest.rawInput, wireRequest.request, definition.csrf)
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

  const replayScope = mutationReplayScope(definition, wireRequest);
  const replayed =
    wireRequest.idem && replayScope
      ? wireRequest.replayStore?.get(replayScope, wireRequest.idem)
      : undefined;
  if (replayed) return replayed;

  const result = await runMutation(definition, wireRequest.rawInput, wireRequest.request);

  if (!result.ok) {
    const response = {
      body: await renderFailureFragment(result, wireRequest),
      headers: mutationWireResponseHeaders(wireRequest),
      status: 422,
    } satisfies MutationWireResponse;

    return result.error.code === 'VALIDATION'
      ? response
      : storeMutationReplay(definition, wireRequest, response);
  }

  const renderInput = mutationResponseInput(result, wireRequest.rawInput);
  const queryChunks = await renderQueryChunks(
    definition.registry?.queries ?? [],
    result.rerunQueryInstances ?? result.rerunQueries.map((key) => ({ key })),
    renderInput,
    wireRequest.request,
  );
  const fragmentChunks = await renderFragmentChunks(
    wireRequest.fragmentRenderers ?? [],
    wireRequest.targets ?? [],
    renderInput,
  );

  return storeMutationReplay(definition, wireRequest, {
    body: [...queryChunks, ...fragmentChunks].join('\n'),
    headers: {
      ...mutationWireResponseHeaders(wireRequest),
      'FW-Changes': JSON.stringify(result.changes),
    },
    status: 200,
  });
}

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
  const wireRequest = mutationWireRequestFromHeaders(endpointRequest);
  if (wireRequest.fragment) return renderMutationResponse(definition, wireRequest);

  return renderNoJsMutationResponse(definition, {
    rawInput: endpointRequest.rawInput,
    redirectTo: endpointRequest.redirectTo,
    ...(endpointRequest.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: endpointRequest.renderFailurePage }),
    request: endpointRequest.request,
  });
}

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
  const result = await runMutation(definition, noJsRequest.rawInput, noJsRequest.request);

  if (!result.ok) {
    const body = noJsRequest.renderFailurePage
      ? await noJsRequest.renderFailurePage(result)
      : renderDefaultFailurePage(result);

    return {
      body,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 422,
    };
  }

  return {
    body: '',
    headers: {
      'Cache-Control': 'no-store',
      Location:
        typeof noJsRequest.redirectTo === 'function'
          ? noJsRequest.redirectTo(result)
          : noJsRequest.redirectTo,
    },
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

function isNotFound(value: unknown): value is NotFound {
  return (
    typeof value === 'object' &&
    value !== null &&
    'notFound' in value &&
    value.notFound === true &&
    'status' in value &&
    value.status === 404
  );
}

function isFileLike(value: unknown): value is FileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'size' in value &&
    typeof value.size === 'number' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

function rateLimitKey<Request extends SessionRequestLike>(
  request: Request,
  options: RateLimitOptions<Request>,
): string {
  if (options.key) return options.key(request);
  if (options.per === 'global') return 'global';

  return request.session?.id ?? request.session?.user?.id ?? 'anonymous';
}

function formLikeToRecord(input: unknown): Record<string, unknown> {
  if (input instanceof FormData) {
    const record: Record<string, unknown> = {};

    for (const [key, value] of input.entries()) {
      const existing = record[key];

      if (existing === undefined) {
        record[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        record[key] = [existing, value];
      }
    }

    return record;
  }

  if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
  throw validationError('Expected object input');
}

function validationError(message: string, path: readonly string[] = []): SchemaValidationError {
  return new SchemaValidationError([{ message, path }]);
}

function validationErrorFrom(error: unknown, pathPrefix: readonly string[]): SchemaValidationError {
  if (error instanceof SchemaValidationError) {
    return new SchemaValidationError(
      error.issues.map((issue) => ({
        message: issue.message,
        path: [...pathPrefix, ...issue.path],
      })),
    );
  }

  return validationError(error instanceof Error ? error.message : String(error), pathPrefix);
}

function parseMutationInput<InputSchema extends Schema<unknown>>(
  schema: InputSchema,
  rawInput: unknown,
):
  | { ok: true; value: InferSchema<InputSchema> }
  | { failure: MutationFail<'VALIDATION', ValidationFailurePayload>; ok: false } {
  try {
    return { ok: true, value: schema.parse(rawInput) as InferSchema<InputSchema> };
  } catch (error) {
    if (!(error instanceof SchemaValidationError)) throw error;

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

function parseQueryInput<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  rawInput: unknown,
): { ok: true; value: Input } | { failure: QueryEndpointFailure; ok: false } {
  if (!definition.args) return { ok: true, value: rawInput as Input };

  try {
    return { ok: true, value: definition.args.parse(rawInput) };
  } catch (error) {
    if (!(error instanceof SchemaValidationError)) throw error;

    return {
      failure: {
        error: {
          code: 'VALIDATION',
          payload: validationFailurePayload(error),
        },
        ok: false,
        status: 422,
      },
      ok: false,
    };
  }
}

function validationFailurePayload(error: SchemaValidationError): ValidationFailurePayload {
  return { issues: error.issues };
}

function querySearchInputToRecord(search: QuerySearchInput): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const entries =
    search instanceof URLSearchParams || Symbol.iterator in search
      ? search
      : Object.entries(search).flatMap(([key, value]) =>
          value === undefined
            ? []
            : Array.isArray(value)
              ? value.map((item) => [key, item] as const)
              : [[key, value] as const],
        );

  for (const [key, value] of entries) {
    const existing = record[key];

    if (existing === undefined) {
      record[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      record[key] = [existing, value];
    }
  }

  return record;
}

function validateCsrfToken<Request>(
  rawInput: unknown,
  request: Request,
  options: CsrfValidationOptions<Request>,
): boolean {
  const sessionId = options.sessionId(request);
  if (!sessionId) return false;

  const submitted = formLikeToRecord(rawInput)[options.field ?? 'fw-csrf'];
  if (typeof submitted !== 'string') return false;

  return secureEqual(submitted, createCsrfToken(sessionId, options.secret));
}

function createCsrfToken(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function changeRecordsFor<Input>(
  domains: readonly Domain[],
  input: Input,
): ChangeRecord<string, Input>[] {
  return domains.map((item) => ({
    domain: item.key,
    input,
  }));
}

function registryChangeRecords<Input>(
  registry: MutationRegistry | undefined,
  input: Input,
): ChangeRecord<string, Input>[] {
  if (registry?.touches && registry.touches.length > 0) {
    return changeRecordsFor(registry.touches, input);
  }

  return dedupeTouchSites(registry?.inferredTouches ?? []).map((touch) => ({
    domain: touch.domain,
    input,
    ...touchKeyRecord(touch.keys, input),
  }));
}

function dedupeTouchSites(touches: readonly MutationTouchSite[]): MutationTouchSite[] {
  const seen = new Set<string>();
  const deduped: MutationTouchSite[] = [];

  for (const touch of touches) {
    const key = `${touch.domain}\0${touch.keys ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(touch);
  }

  return deduped;
}

function touchKeyRecord<Input>(
  keySource: MutationTouchSite['keys'],
  input: Input,
): Pick<ChangeRecord<string, Input>, 'keys'> {
  if (keySource === null) return {};
  if (!keySource.startsWith('arg:')) return {};

  const value = readPath(input, keySource.slice('arg:'.length));
  if (value === undefined || value === null) return {};
  if (Array.isArray(value)) {
    const keys = value.flatMap((item) => {
      const key = primitiveKey(item);
      return key === undefined ? [] : [key];
    });
    return keys.length > 0 ? { keys } : {};
  }

  const key = primitiveKey(value);
  return key === undefined ? {} : { keys: [key] };
}

function readPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') return undefined;
    if (!Object.hasOwn(value, segment)) return undefined;
    return (value as Record<string, unknown>)[segment];
  }, input);
}

function primitiveKey(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function mutationResponseInput<Value>(result: MutationSuccess<Value>, rawInput: unknown): unknown {
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
  if (instanceKey === undefined || (change.keys?.length ?? 0) === 0) return true;

  return change.keys?.some((key) => instanceKey === `${change.domain}:${key}`) ?? false;
}

async function renderQueryChunks(
  queries: readonly QueryDefinition[],
  rerunQueries: readonly QueryRerun[],
  input: unknown,
  request: unknown,
): Promise<string[]> {
  const chunks: string[] = [];

  for (const queryDefinition of queries) {
    if (!rerunQueries.some((target) => queryMatchesRerun(queryDefinition, input, target))) {
      continue;
    }

    const result = await runQuery(queryDefinition, input, request);
    if (!result.ok) continue;

    chunks.push(renderQueryChunk(queryDefinition, result.input, result.value));
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

function renderQueryChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);
  const version = readQueryVersion(queryDefinition, input, value);
  const keyAttribute = key === undefined ? '' : ` key="${escapeAttribute(key)}"`;
  const versionAttribute =
    version === undefined ? '' : ` version="${escapeAttribute(String(version))}"`;

  return `<fw-query name="${escapeAttribute(queryDefinition.key)}"${keyAttribute}${versionAttribute}>${escapeHtml(JSON.stringify(value))}</fw-query>`;
}

function renderQueryEndpointChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): string {
  const name = readQueryInstanceKey(queryDefinition, input) ?? queryDefinition.key;
  const version = readQueryVersion(queryDefinition, input, value);
  const versionAttribute =
    version === undefined ? '' : ` version="${escapeAttribute(String(version))}"`;

  return `<fw-query name="${escapeAttribute(name)}"${versionAttribute}>${escapeHtml(JSON.stringify(value))}</fw-query>`;
}

export interface QueryScriptRenderOptions {
  key?: string;
  name: string;
  value: unknown;
}

export function renderQueryScript(options: QueryScriptRenderOptions): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;

  return `<script type="application/json" fw-query="${escapeAttribute(options.name)}"${keyAttribute}>${escapeScriptJson(JSON.stringify(options.value))}</script>`;
}

function readQueryInstanceKey<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: unknown,
): string | undefined {
  if (queryDefinition.instanceKey === undefined) return undefined;
  if (typeof queryDefinition.instanceKey === 'function') return queryDefinition.instanceKey(input);
  return queryDefinition.instanceKey;
}

function readQueryVersion<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): number | string | undefined {
  if (queryDefinition.version === undefined) return undefined;
  if (typeof queryDefinition.version === 'function') return queryDefinition.version(input, value);
  return queryDefinition.version;
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
        `${renderFragmentOpen(renderer.target, renderer.mode)}${renderStylesheetLinks(renderer.stylesheets ?? [])}${await renderer.render(input)}</fw-fragment>`,
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      chunks.push(
        `<fw-fragment target="${escapeAttribute(target)}" error-boundary="${escapeAttribute(renderer.target)}">${renderStylesheetLinks(renderer.stylesheets ?? [])}${await renderer.errorBoundary.render(error, input)}</fw-fragment>`,
      );
    }
  }

  return chunks;
}

async function renderFailureFragment<Request>(
  failure: MutationFail,
  wireRequest: MutationWireRequest<Request>,
): Promise<string> {
  const target = wireRequest.failureTarget ?? wireRequest.targets?.[0] ?? 'error';
  const html = wireRequest.renderFailureFragment
    ? await wireRequest.renderFailureFragment(failure, wireRequest.rawInput)
    : renderDefaultFailureFragmentContent(failure);

  return `<fw-fragment target="${escapeAttribute(target)}">${renderStylesheetLinks(wireRequest.failureStylesheets ?? [])}${html}</fw-fragment>`;
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

function storeMutationReplay<Request>(
  definition: { csrf?: CsrfValidationOptions<Request> },
  wireRequest: MutationWireRequest<Request>,
  response: MutationWireResponse,
): MutationWireResponse {
  const replayScope = mutationReplayScope(definition, wireRequest);
  if (wireRequest.idem && replayScope) {
    wireRequest.replayStore?.set(replayScope, wireRequest.idem, response);
  }

  return response;
}

function mutationReplayScope<Request>(
  definition: { csrf?: CsrfValidationOptions<Request> },
  wireRequest: MutationWireRequest<Request>,
): string | null {
  const csrfSessionId = definition.csrf?.sessionId(wireRequest.request);
  if (csrfSessionId) return csrfSessionId;

  const request = wireRequest.request;
  if (
    typeof request === 'object' &&
    request !== null &&
    'sessionId' in request &&
    typeof request.sessionId === 'string' &&
    request.sessionId !== ''
  ) {
    return request.sessionId;
  }

  return null;
}

function mutationReplayKey(scope: string, idem: string): string {
  return `${scope}\0${idem}`;
}

function evictExpiredMutationReplays(
  responses: Map<string, { expiresAt: number; response: MutationWireResponse }>,
): void {
  const now = Date.now();
  for (const [key, record] of responses) {
    if (record.expiresAt <= now) responses.delete(key);
  }
}

function cloneMutationWireResponse(response: MutationWireResponse): MutationWireResponse {
  return {
    body: response.body,
    headers: { ...response.headers },
    status: response.status,
  };
}

function mutationWireResponseHeaders<Request>(
  wireRequest: MutationWireRequest<Request>,
): Record<string, string> {
  return {
    'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
    ...(wireRequest.idem ? { 'FW-Idem': wireRequest.idem } : {}),
  };
}

function readHeader(headers: MutationWireHeaderSource, name: string): string | undefined {
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  }

  const wanted = name.toLowerCase();
  if (Symbol.iterator in headers) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === wanted) return value;
    }

    return undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return value.join(', ');
    return value;
  }

  return undefined;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeStylesheets(values: readonly (string | StylesheetAsset)[]): StylesheetAsset[] {
  const seen = new Map<string, number>();
  const assets: StylesheetAsset[] = [];

  for (const value of values) {
    const asset = typeof value === 'string' ? { href: value, preload: true } : value;
    if (!asset.href) continue;

    const existingIndex = seen.get(asset.href);
    if (existingIndex !== undefined) {
      const existing = assets[existingIndex];
      if (existing && !existing.criticalCss && asset.criticalCss) {
        assets[existingIndex] = { ...existing, criticalCss: asset.criticalCss };
      }
      continue;
    }

    seen.set(asset.href, assets.length);
    assets.push(asset);
  }

  return assets;
}

function renderPageStylesheetHint(asset: StylesheetAsset): string {
  const link = `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`;
  if (!asset.criticalCss) return link;

  return `<style data-jiso-critical-href="${escapeAttribute(asset.href)}">${escapeStyleText(asset.criticalCss)}</style>${link}`;
}

function renderEarlyHints(
  stylesheets: readonly StylesheetAsset[],
  modulepreloads: readonly string[],
): Record<string, string> {
  const links = [
    ...stylesheets
      .filter((asset) => asset.preload !== false)
      .map((asset) => `<${formatLinkHeaderTarget(asset.href)}>; rel=preload; as=style`),
    ...modulepreloads.map((href) => `<${formatLinkHeaderTarget(href)}>; rel=modulepreload`),
  ];

  return links.length > 0 ? { Link: links.join(', ') } : {};
}

function formatLinkHeaderTarget(href: string): string {
  return encodeURI(href).replace(
    /[<>,]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function renderSpeculationRules(prefetch: RoutePrefetch, urls: readonly string[]): string {
  const prerenderUrls = dedupe(urls);
  if (!prefetch || prerenderUrls.length === 0) return '';

  return `<script type="speculationrules">${escapeScriptJson(
    JSON.stringify({
      prerender: [
        {
          eagerness: prefetch,
          urls: prerenderUrls,
        },
      ],
    }),
  )}</script>`;
}

function renderRouteMeta(
  metaInput: PageHintOptions['meta'],
  context: PageHintRenderContext,
): string[] {
  const metas = Array.isArray(metaInput) ? metaInput : metaInput ? [metaInput] : [];
  const tags: string[] = [];

  for (const item of metas) {
    const resolved = resolveRouteMeta(item, context);

    if (resolved.title) tags.push(`<title>${escapeHtml(resolved.title)}</title>`);
    if (resolved.description) {
      tags.push(
        `<meta name="description" content="${escapeAttribute(resolved.description)}">`,
        `<meta property="og:description" content="${escapeAttribute(resolved.description)}">`,
      );
    }
    if (resolved.image) {
      tags.push(`<meta property="og:image" content="${escapeAttribute(resolved.image)}">`);
    }
  }

  return tags;
}

function resolveRouteMeta(source: RouteMetaSource, context: PageHintRenderContext): RouteMeta {
  if (!isRouteMetaFactory(source)) return source;

  const queries = context.queries ?? {};
  const values: Record<string, unknown> = {};

  for (const query of source.queries) {
    if (!Object.hasOwn(queries, query)) {
      throw new Error(`Missing query data for route meta: ${query}`);
    }
    values[query] = queries[query];
  }

  return source.resolve(values);
}

function isRouteMetaFactory(source: RouteMetaSource): source is RouteMetaFactory {
  return typeof (source as RouteMetaFactory).resolve === 'function';
}

function renderI18nCatalogs(i18nInput: PageHintOptions['i18n']): string[] {
  const catalogs = Array.isArray(i18nInput) ? i18nInput : i18nInput ? [i18nInput] : [];

  return catalogs.map(
    (catalog) =>
      `<script type="application/json" fw-i18n locale="${escapeAttribute(catalog.locale)}">${escapeScriptJson(JSON.stringify(catalog.messages))}</script>`,
  );
}

function renderStylesheetLinks(stylesheets: readonly (string | StylesheetAsset)[]): string {
  return dedupeStylesheets(stylesheets)
    .map((asset) => `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`)
    .join('');
}

function renderDeferredQueryChunks(queries: readonly DeferredQueryChunk[]): string[] {
  return queries.map((queryChunk) => {
    const key = queryChunk.key ? ` key="${escapeAttribute(queryChunk.key)}"` : '';
    return `<fw-query name="${escapeAttribute(queryChunk.name)}"${key}>${escapeHtml(JSON.stringify(queryChunk.value))}</fw-query>`;
  });
}

function sortDeferredChunks(chunks: readonly DeferredStreamChunk[]): DeferredStreamChunk[] {
  return stablePrioritySort(chunks, (chunk) => chunk.priority);
}

function sortDeferredFragments(
  fragments: readonly DeferredFragmentChunk[],
): DeferredFragmentChunk[] {
  return stablePrioritySort(fragments, (fragment) => fragment.priority);
}

function stablePrioritySort<Value>(
  values: readonly Value[],
  priorityFor: (value: Value) => DeferredPriority | undefined,
): Value[] {
  return values
    .map((value, index) => ({ index, priority: priorityRank(priorityFor(value)), value }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((entry) => entry.value);
}

function priorityRank(priority: DeferredPriority | undefined): number {
  if (typeof priority === 'number') return priority;

  switch (priority) {
    case 'high':
      return 1;
    case 'low':
      return -1;
    case 'normal':
    case undefined:
      return 0;
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

function escapeScriptJson(value: string): string {
  return value.replaceAll('<', '\\u003c');
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}

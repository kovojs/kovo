import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  Endpoint as CoreEndpoint,
  EndpointAuthDeclaration,
  EndpointMethod,
  EndpointMount,
  JsonValue,
  Redirect as CoreRedirect,
  StorageCapability,
  StorageObjectInfo,
} from '@jiso/core';
import { escapeAttribute, escapeHtml, escapeScriptJson } from './html.js';
import { renderStylesheetLinks } from './hints.js';
import type {
  I18nCatalog,
  PageHintOptions,
  RouteMeta,
  RouteMetaFactory,
  StylesheetAsset,
} from './hints.js';

export { Link, href, redirect } from '@jiso/core';
export type {
  DiagnosticCode,
  Endpoint,
  EndpointAuthDeclaration,
  EndpointCsrfExemption,
  EndpointMethod,
  EndpointMount,
  JsonValue,
  LinkDescriptor,
  Redirect,
  Route,
} from '@jiso/core';
export { createApp, createRequestHandler } from './app.js';
export type {
  AppDocumentOptions,
  AppErrorShellOptions,
  AppRouteRenderContext,
  CreateAppOptions,
  ErrorShellRenderer,
  JisoApp,
  RequestHandler,
} from './app.js';
export {
  createMemoryVersionedClientModuleRegistry,
  renderVersionedClientModuleResponse,
  versionedClientModuleHref,
} from './client-modules.js';
export type {
  MemoryVersionedClientModuleRegistryOptions,
  VersionedClientModuleInput,
  VersionedClientModuleRegistry,
  VersionedClientModuleRequest,
  VersionedClientModuleResponse,
} from './client-modules.js';
export { renderDeferredStream } from './deferred-stream.js';
export type {
  DeferredFragmentChunk,
  DeferredPriority,
  DeferredQueryChunk,
  DeferredStreamChunk,
  DeferredStreamOptions,
  DeferredStreamResponse,
} from './deferred-stream.js';
export {
  renderDeferredDocument,
  renderDocument,
  renderDocumentQueryScript,
  renderErrorDocument,
  renderRouteDocumentResponse,
} from './document.js';
export type {
  DeferredDocumentAssemblyOptions,
  DeferredDocumentFrame,
  DeferredDocumentRenderResult,
  DeferredDocumentTemplate,
  DeferredDocumentTemplateContext,
  DocumentAssemblyOptions,
  DocumentParts,
  DocumentRenderResult,
  DocumentResponseOptions,
  DocumentRoutePageResponse,
  DocumentTemplate,
  DocumentTemplateContext,
  ErrorDocumentOptions,
  QueryScriptRenderOptions as DocumentQueryScriptRenderOptions,
} from './document.js';
export { renderPageHints, stylesheetsForTargets } from './hints.js';
export type {
  I18nCatalog,
  PageHintOptions,
  PageHintRenderContext,
  PageHints,
  RouteMeta,
  RouteMetaFactory,
  RouteMetaSource,
  RoutePrefetch,
  StylesheetAsset,
  StylesheetManifestEntry,
} from './hints.js';
export { findRouteAmbiguities, matchRoute, normalizePathname } from './match.js';
export type { PathnameNormalization, RouteAmbiguity, RouteLike, RouteMatch } from './match.js';
export { matchShellDispatch, shellDispatchTable } from './shell.js';
export type {
  EndpointLike,
  ShellDispatchEntry,
  ShellDispatchInput,
  ShellDispatchMatch,
  ShellDispatchPhase,
} from './shell.js';

export interface Schema<T> {
  parse(input: unknown): T;
}

export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

interface AsyncSchema<T> extends Schema<T> {
  parseAsync(input: unknown): Promise<T>;
}

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
    const schema: AsyncSchema<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {
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
      async parseAsync(input: unknown): Promise<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> {
        const record = formLikeToRecord(input);
        const output: Partial<{ [Key in keyof Shape]: InferSchema<Shape[Key]> }> = {};

        for (const [key, schema] of Object.entries(shape) as [keyof Shape, Shape[keyof Shape]][]) {
          try {
            output[key] = (await parseSchemaAsync(schema, record[String(key)])) as InferSchema<
              Shape[keyof Shape]
            >;
          } catch (error) {
            throw validationErrorFrom(error, [String(key)]);
          }
        }

        return output as { [Key in keyof Shape]: InferSchema<Shape[Key]> };
      },
    };
    return schema;
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
  store(options: StoredFileSchemaOptions): StoredFileSchema;
}

export interface FileSchemaOptions {
  maxBytes?: number;
  mime?: readonly string[];
}

export interface StoredFileUpload {
  file: FileLike;
  key: string;
  storage: StorageObjectInfo;
}

export interface StoredFileSchema extends AsyncSchema<StoredFileUpload> {}

export interface StoredFileSchemaOptions {
  key: string | ((file: FileLike) => MaybePromise<string>);
  metadata?: (file: FileLike) => Readonly<Record<string, string>>;
  storage: StorageCapability;
}

export interface NumberSchema extends Schema<number> {
  default(value: number): NumberSchema;
  int(): NumberSchema;
  min(value: number): NumberSchema;
}

interface NumberSchemaOptions {
  defaultValue?: number;
  integer?: boolean;
  minimum?: number;
}

class NumberSchemaImpl implements NumberSchema {
  readonly #defaultValue: number | undefined;
  readonly #integer: boolean;
  readonly #minimum: number | undefined;

  constructor(options: NumberSchemaOptions = {}) {
    this.#defaultValue = options.defaultValue;
    this.#integer = options.integer ?? false;
    this.#minimum = options.minimum;
  }

  default(value: number): NumberSchema {
    return new NumberSchemaImpl({
      defaultValue: value,
      integer: this.#integer,
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  int(): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: true,
      ...(this.#minimum === undefined ? {} : { minimum: this.#minimum }),
    });
  }

  min(value: number): NumberSchema {
    return new NumberSchemaImpl({
      ...(this.#defaultValue === undefined ? {} : { defaultValue: this.#defaultValue }),
      integer: this.#integer,
      minimum: value,
    });
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
  readonly #maxBytes: number | undefined;
  readonly #mime: readonly string[] | undefined;

  constructor(options: FileSchemaOptions = {}) {
    this.#maxBytes = options.maxBytes;
    this.#mime = options.mime;
  }

  maxBytes(value: number): FileSchema {
    return new FileSchemaImpl({
      maxBytes: value,
      ...(this.#mime === undefined ? {} : { mime: this.#mime }),
    });
  }

  mime(types: readonly string[]): FileSchema {
    return new FileSchemaImpl({
      ...(this.#maxBytes === undefined ? {} : { maxBytes: this.#maxBytes }),
      mime: types,
    });
  }

  parse(input: unknown): FileLike {
    return parseFileLike(input, createFileOptions(this.#maxBytes, this.#mime));
  }

  store(options: StoredFileSchemaOptions): StoredFileSchema {
    return new StoredFileSchemaImpl(createFileOptions(this.#maxBytes, this.#mime), options);
  }
}

class StoredFileSchemaImpl implements StoredFileSchema {
  readonly #fileOptions: FileSchemaOptions;
  readonly #storageOptions: StoredFileSchemaOptions;

  constructor(fileOptions: FileSchemaOptions, storageOptions: StoredFileSchemaOptions) {
    this.#fileOptions = fileOptions;
    this.#storageOptions = storageOptions;
  }

  parse(input: unknown): StoredFileUpload {
    const file = parseFileLike(input, this.#fileOptions);
    const key =
      typeof this.#storageOptions.key === 'string'
        ? this.#storageOptions.key
        : this.#storageOptions.key(file);
    if (typeof key !== 'string') {
      throw validationError('Expected synchronous storage key');
    }

    return {
      file,
      key,
      storage: {
        ...(file.type === '' ? {} : { contentType: file.type }),
        key,
        ...(this.#storageOptions.metadata === undefined
          ? {}
          : { metadata: this.#storageOptions.metadata(file) }),
        size: file.size,
      },
    };
  }

  async parseAsync(input: unknown): Promise<StoredFileUpload> {
    const file = parseFileLike(input, this.#fileOptions);
    const key =
      typeof this.#storageOptions.key === 'string'
        ? this.#storageOptions.key
        : await this.#storageOptions.key(file);
    const storage = await this.#storageOptions.storage.put(key, await file.arrayBuffer(), {
      ...(file.type === '' ? {} : { contentType: file.type }),
      metadata: {
        filename: file.name,
        ...this.#storageOptions.metadata?.(file),
      },
    });

    return { file, key, storage };
  }
}

function createFileOptions(
  maxBytes: number | undefined,
  mime: readonly string[] | undefined,
): FileSchemaOptions {
  return {
    ...(maxBytes === undefined ? {} : { maxBytes }),
    ...(mime === undefined ? {} : { mime }),
  };
}

function parseFileLike(input: unknown, options: FileSchemaOptions): FileLike {
  if (!isFileLike(input)) throw validationError('Expected file');
  if (options.maxBytes !== undefined && input.size > options.maxBytes) {
    throw validationError(`Expected file <= ${options.maxBytes} bytes`);
  }
  if (options.mime && !options.mime.includes(input.type)) {
    throw validationError(`Expected file type ${options.mime.join(', ')}`);
  }

  return input;
}

export interface GuardFailure {
  auth?: 'unauthenticated' | 'unauthorized';
  code: 'RATE_LIMITED' | 'UNAUTHORIZED';
  payload?: Record<string, unknown>;
  retryAfter?: number;
  status: 422 | 429;
}

export type GuardResult = boolean | GuardFailure;

export interface Guard<Request, RefinedRequest extends Request = Request> {
  (request: Request): GuardResult | Promise<GuardResult>;
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
  provider<RawRequest>(
    provider: SessionProvider<RawRequest, Value>,
  ): SessionProvider<RawRequest, Value>;
  schema: Schema<Value>;
}

export type MaybePromise<Value> = Promise<Value> | Value;

export type SessionProvider<RawRequest, SessionValue> = (
  request: RawRequest,
) => MaybePromise<SessionValue | null | undefined>;

export interface RequestLifecycleOptions<RawRequest, SessionValue = unknown> {
  sessionProvider?: SessionProvider<RawRequest, SessionValue>;
}

export interface UnauthenticatedContext<Request> {
  next: string;
  request: Request;
}

export type UnauthenticatedHandler<Request> = (
  context: UnauthenticatedContext<Request>,
) => CoreRedirect | Promise<CoreRedirect>;

export interface ForbiddenContext<Request> {
  request: Request;
}

export type ForbiddenRenderer<Request> = (
  context: ForbiddenContext<Request>,
) => string | Promise<string>;

export interface GuardFailureResponseOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  currentUrl?: string;
  loginPath?: string;
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  renderForbidden?: ForbiddenRenderer<Request>;
}

interface HttpGuardFailureResponse {
  body: string;
  headers: Record<string, string>;
  status: 303 | 403;
}

export interface RateLimitOptions<Request> {
  key?: (request: Request) => string;
  max: number;
  maxKeys?: number;
  per?: 'global' | 'session';
  windowMs?: number;
}

const defaultRateLimitWindowMs = 60_000;
const defaultRateLimitMaxKeys = 10_000;

export const guards = {
  all<Request, RefinedRequest extends Request = Request>(
    ...items: Guard<Request, RefinedRequest>[]
  ): Guard<Request, RefinedRequest> {
    return async (request: Request) => {
      for (const item of items) {
        const result = await item(request);
        if (result !== true) return guardFailureFromResult(result);
      }

      return true;
    };
  },
  authed<Request extends SessionRequestLike>(): Guard<Request, AuthenticatedRequest<Request>> {
    return (request) => (request.session?.user ? true : unauthenticatedGuardFailure());
  },
  rateLimit<Request extends SessionRequestLike>(
    options: RateLimitOptions<Request>,
  ): Guard<Request> {
    const counts = new Map<string, { count: number; resetAt: number }>();

    return (request) => {
      const now = Date.now();
      evictExpiredRateLimits(counts, now);

      const windowMs = options.windowMs ?? defaultRateLimitWindowMs;
      if (options.max <= 0) return rateLimitFailure(now + windowMs, now);

      const key = rateLimitKey(request, options);
      const existing = counts.get(key);

      if (existing && existing.resetAt > now) {
        if (existing.count >= options.max) return rateLimitFailure(existing.resetAt, now);

        existing.count += 1;
        return true;
      }

      const maxKeys = options.maxKeys ?? defaultRateLimitMaxKeys;
      while (counts.size >= maxKeys) {
        const oldest = counts.keys().next().value;
        if (oldest === undefined) break;
        counts.delete(oldest);
      }

      counts.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      return options.max > 0;
    };
  },
  role<Request extends SessionRequestLike>(role: string): Guard<Request> {
    return (request) => {
      if (!request.session?.user) return unauthenticatedGuardFailure();
      return request.session.user.roles?.includes(role) ? true : unauthorizedGuardFailure();
    };
  },
};

function guardFailureFromResult(result: GuardResult): GuardFailure {
  if (typeof result === 'object') return result;

  return {
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

async function runGuard<Request>(
  guard: Guard<Request> | undefined,
  request: Request,
): Promise<GuardFailure | null> {
  if (!guard) return null;

  const result = await guard(request);
  return result === true ? null : guardFailureFromResult(result);
}

function rateLimitFailure(resetAt: number, now: number): GuardFailure {
  return {
    code: 'RATE_LIMITED',
    payload: {},
    retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    status: 429,
  };
}

function unauthenticatedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthenticated',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function unauthorizedGuardFailure(): GuardFailure {
  return {
    auth: 'unauthorized',
    code: 'UNAUTHORIZED',
    payload: {},
    status: 422,
  };
}

function evictExpiredRateLimits(
  counts: Map<string, { count: number; resetAt: number }>,
  now: number,
): void {
  for (const [key, record] of counts) {
    if (record.resetAt <= now) counts.delete(key);
  }
}

export function session<Value>(schema: Schema<Value>): SessionDefinition<Value> {
  return {
    parse(request) {
      return schema.parse(request.session);
    },
    provider(provider) {
      return provider;
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
  retryAfter?: number;
  status: 422 | 429;
}

export interface MutationSuccess<Value> {
  changes: ChangeRecord[];
  rerunQueryInstances?: QueryRerun[];
  rerunQueries: string[];
  ok: true;
  responseHeaders?: MutationResponseHeaders;
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
  setCookie?: {
    (rawSetCookie: string): void;
    (name: string, value: string, options?: CookieOptions): void;
  };
}

export type MutationResponseHeaderValue = string | string[];

export type MutationResponseHeaders = Record<string, MutationResponseHeaderValue>;

export interface CookieOptions {
  domain?: string;
  expires?: Date | string;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: 'lax' | 'none' | 'strict';
  secure?: boolean;
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

export interface QueryEndpointRequest<
  Request = unknown,
  SessionValue = unknown,
> extends GuardFailureResponseOptions<Request, SessionValue> {
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
  status: 200 | 303 | 403 | 404 | 422 | 429 | 500;
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
  call(request: Request): GuardResult | Promise<GuardResult>;
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
  call(request: unknown): GuardResult | Promise<GuardResult>;
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
  options: RequestLifecycleOptions<Request> = {},
): Promise<QueryEndpointResult<Value, Input>> {
  const argsResult = parseQueryInput(definition, rawInput);
  if (!argsResult.ok) return argsResult.failure;

  const lifecycleRequest = await resolveLifecycleRequest(request, options);
  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) {
    return {
      ...(guardFailure.auth === undefined ? {} : { auth: guardFailure.auth }),
      error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
      ok: false,
      ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
      status: guardFailure.status,
    };
  }

  const input = argsResult.value;
  const value = definition.load
    ? await definition.load(input, { request: lifecycleRequest })
    : (null as Value);
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
  auth?: GuardFailure['auth'];
  error: {
    code: 'RATE_LIMITED' | 'UNAUTHORIZED' | 'VALIDATION';
    payload: Record<string, unknown> | ValidationFailurePayload;
  };
  ok: false;
  retryAfter?: number;
  status: 422 | 429;
}

export async function renderQueryEndpointResponse<const Key extends string, Value, Input, Request>(
  definition: QueryDefinition<Key, Value, Input, Request>,
  endpointRequest: QueryEndpointRequest<Request>,
): Promise<QueryEndpointResponse> {
  const rawInput = querySearchInputToRecord(endpointRequest.search ?? {});
  let result: QueryEndpointResult<Value, Input>;
  let lifecycleRequest: Request;
  try {
    lifecycleRequest = await resolveLifecycleRequest(endpointRequest.request, endpointRequest);
    result = await runQuery(definition, rawInput, lifecycleRequest);
  } catch {
    return {
      body: JSON.stringify(serverErrorPayload()),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      status: 500,
    };
  }

  if (!result.ok) {
    const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
      ...endpointRequest,
      currentUrl:
        endpointRequest.currentUrl ??
        queryEndpointCurrentUrl(definition.key, endpointRequest.search ?? {}),
    });
    if (authResponse) return authResponse;

    return {
      body: JSON.stringify(result.error),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...retryAfterHeaders(result),
      },
      status: result.status,
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

export interface MutationWireRequest<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
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

export interface MutationWireRequestOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
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
  headers: MutationResponseHeaders;
  status: 200 | 422 | 429 | 500;
}

export interface MutationReplayStore {
  get(
    scope: string,
    idem: string,
  ): MutationWireResponse | Promise<MutationWireResponse> | undefined;
  reserve(scope: string, idem: string): MutationReplayReservation | undefined;
  set(scope: string, idem: string, response: MutationWireResponse): void;
}

export interface MutationReplayReservation {
  commit(response: MutationWireResponse): void;
}

export function createMemoryMutationReplayStore(
  options: { maxEntries?: number; ttlMs?: number } = {},
): MutationReplayStore {
  const maxEntries = options.maxEntries ?? 1_000;
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const responses = new Map<string, MutationReplayRecord>();

  return {
    get(scope, idem) {
      const key = mutationReplayKey(scope, idem);
      const record = responses.get(key);
      if (!record) return undefined;
      if (record.expiresAt <= Date.now()) {
        responses.delete(key);
        return undefined;
      }

      if ('pending' in record) {
        return record.pending.then(cloneMutationWireResponse);
      }

      return cloneMutationWireResponse(record.response);
    },
    reserve(scope, idem) {
      evictExpiredMutationReplays(responses);
      const key = mutationReplayKey(scope, idem);
      if (responses.has(key)) return undefined;

      while (responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        responses.delete(oldest);
      }

      let resolvePending: (response: MutationWireResponse) => void = () => undefined;
      const pending = new Promise<MutationWireResponse>((resolve) => {
        resolvePending = resolve;
      });
      responses.set(key, {
        expiresAt: Date.now() + ttlMs,
        pending,
        resolve: resolvePending,
      });

      return {
        commit(response) {
          const cloned = cloneMutationWireResponse(response);
          responses.set(key, {
            expiresAt: Date.now() + ttlMs,
            response: cloned,
          });
          resolvePending(cloned);
        },
      };
    },
    set(scope, idem, response) {
      evictExpiredMutationReplays(responses);
      const key = mutationReplayKey(scope, idem);
      const existing = responses.get(key);
      while (!existing && responses.size >= maxEntries) {
        const oldest = responses.keys().next().value;
        if (oldest === undefined) break;
        responses.delete(oldest);
      }

      const cloned = cloneMutationWireResponse(response);
      responses.set(key, {
        expiresAt: Date.now() + ttlMs,
        response: cloned,
      });
      if (existing && 'pending' in existing) existing.resolve(cloned);
    },
  };
}

type MutationReplayRecord =
  | { expiresAt: number; response: MutationWireResponse }
  | {
      expiresAt: number;
      pending: Promise<MutationWireResponse>;
      resolve(response: MutationWireResponse): void;
    };

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
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    ...(options.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(options.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: options.failureStylesheets }),
    ...(options.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: options.fragmentRenderers }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(headers.idem === undefined ? {} : { idem: headers.idem }),
    ...(options.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    targets: headers.targets,
  };
}

export interface NoJsMutationRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
  rawInput: unknown;
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
  request: Request;
}

export interface NoJsMutationResponse {
  body: string;
  headers: MutationResponseHeaders;
  status: 303 | 422 | 429 | 500;
}

export interface MutationEndpointRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends MutationWireRequestOptions<Request, SessionValue> {
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type MutationEndpointResponse = MutationWireResponse | NoJsMutationResponse;

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
  onUnauthenticated?: UnauthenticatedHandler<Request>;
  page?: (
    context: RouteRequest<Path, ParamsSchema, SearchSchema>,
    request: GuardedRequest,
  ) => Page | NotFound | RouteResponseOutcome | Promise<Page | NotFound | RouteResponseOutcome>;
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

export type EndpointRequest = Request & { readonly session?: never };

export type EndpointHandler = (request: EndpointRequest) => Promise<Response> | Response;

interface EndpointDefinitionBase<Method extends EndpointMethod, Mount extends EndpointMount> {
  auth?: EndpointAuthDeclaration;
  handler: EndpointHandler;
  method?: Method;
  mount?: Mount;
}

interface EndpointCsrfDefault {
  csrf?: true;
  csrfJustification?: never;
}

interface EndpointCsrfExempt {
  csrf: false;
  csrfJustification: string;
}

export type EndpointDefinition<
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> = EndpointDefinitionBase<Method, Mount> & (EndpointCsrfDefault | EndpointCsrfExempt);

export interface EndpointDeclaration<
  Path extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = EndpointMount,
> extends CoreEndpoint<Path, Method, Mount> {
  handler: EndpointHandler;
}

export interface NotFound {
  notFound: true;
  status: 404;
}

export type RouteResponseBody = ArrayBuffer | ReadableStream<Uint8Array> | Uint8Array | string;

export interface RouteResponseOutcome {
  body: RouteResponseBody;
  contentDisposition: string;
  contentType: string;
  etag?: string;
  headers?: Record<string, string>;
  routeResponse: true;
}

export interface RouteFileOptions {
  contentType: string;
  etag?: string;
  filename?: string;
  headers?: Record<string, string>;
}

export interface RouteStreamOptions extends RouteFileOptions {
  disposition?: 'attachment' | 'inline';
}

export const respond = {
  file(body: Exclude<RouteResponseBody, ReadableStream<Uint8Array>>, options: RouteFileOptions) {
    return routeResponseOutcome(body, {
      ...options,
      disposition: 'attachment',
    });
  },
  stream(body: RouteResponseBody, options: RouteStreamOptions) {
    return routeResponseOutcome(body, {
      ...options,
      disposition: options.disposition ?? 'attachment',
    });
  },
};

export interface RoutePageResponse {
  body: RouteResponseBody;
  headers: Record<string, string>;
  status: 200 | 303 | 304 | 403 | 404 | 422 | 429 | 500;
}

export interface RouteRequestInput {
  params?: unknown;
  search?: unknown;
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

export interface RunMutationOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
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

export function endpoint<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
  const Mount extends EndpointMount = 'exact',
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount>,
): EndpointDeclaration<Path, Method, Mount> {
  const mount = definition.mount ?? ('exact' as Mount);

  return {
    ...(definition.auth === undefined ? {} : { auth: definition.auth }),
    ...(definition.csrf === false
      ? { csrf: { exempt: true, justification: definition.csrfJustification } }
      : {}),
    handler: definition.handler,
    ...(definition.method === undefined ? {} : { method: definition.method }),
    mount,
    path,
  };
}

export async function runEndpoint(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response> {
  return definition.handler(endpointRequestWithoutSession(request));
}

export function endpointMatches(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  input: { method?: string; pathname: string },
): boolean {
  if (definition.method !== undefined && input.method !== undefined) {
    if (definition.method.toUpperCase() !== input.method.toUpperCase()) return false;
  }

  if (definition.mount === 'prefix') {
    return (
      input.pathname === definition.path ||
      input.pathname.startsWith(`${definition.path.replace(/\/$/, '')}/`)
    );
  }

  return input.pathname === definition.path;
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
  options: RequestLifecycleOptions<Request> = {},
): Promise<RoutePageResult<Page>> {
  const routeRequest = parseRouteRequest(definition, input);

  const lifecycleRequest = await resolveLifecycleRequest(request, options);
  const guardFailure = await runGuard(definition.guard, lifecycleRequest);
  if (guardFailure) {
    return {
      ...(guardFailure.auth === undefined ? {} : { auth: guardFailure.auth }),
      error: { code: guardFailure.code, payload: guardFailure.payload ?? {} },
      ok: false,
      ...(guardFailure.retryAfter === undefined ? {} : { retryAfter: guardFailure.retryAfter }),
      status: guardFailure.status,
    };
  }

  const value = await definition.page?.(routeRequest, lifecycleRequest as GuardedRequest);
  if (isNotFound(value)) return { ok: false, status: 404 };
  if (isRouteResponseOutcome(value)) return { ok: true, outcome: value };
  return { ok: true, value: value as Page };
}

export type RoutePageResult<Page> = RoutePageSuccess<Page> | RoutePageFailure;

export type RoutePageSuccess<Page> = RoutePageRenderSuccess<Page> | RoutePageOutcomeSuccess;

export interface RoutePageRenderSuccess<Page> {
  ok: true;
  value: Page;
}

export interface RoutePageOutcomeSuccess {
  ok: true;
  outcome: RouteResponseOutcome;
}

export interface RoutePageFailure {
  auth?: GuardFailure['auth'];
  error?: {
    code: 'RATE_LIMITED' | 'UNAUTHORIZED';
    payload: Record<string, unknown>;
  };
  ok: false;
  retryAfter?: number;
  status: 404 | 422 | 429;
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
  options: GuardFailureResponseOptions<Request> = {},
): Promise<RoutePageResponse> {
  let result: RoutePageResult<Page>;
  let lifecycleRequest: Request;
  try {
    lifecycleRequest = await resolveLifecycleRequest(request, options);
    result = await runRoutePage(definition, input, lifecycleRequest);
  } catch {
    return htmlServerErrorResponse();
  }

  if (!result.ok) {
    const onUnauthenticated = definition.onUnauthenticated ?? options.onUnauthenticated;
    const authResponse = await renderHttpGuardFailureResponse(result, lifecycleRequest, {
      ...options,
      currentUrl: options.currentUrl ?? routeCurrentUrl(definition, input),
      ...(onUnauthenticated === undefined ? {} : { onUnauthenticated }),
    });
    if (authResponse) return authResponse;

    return {
      body:
        result.status === 404
          ? 'Not Found'
          : result.status === 429
            ? 'Too Many Requests'
            : 'Unauthorized',
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...retryAfterHeaders(result),
      },
      status: result.status,
    };
  }

  if ('outcome' in result) return routeOutcomeResponse(result.outcome, request);

  try {
    return {
      body: await render(result.value),
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      status: 200,
    };
  } catch {
    return htmlServerErrorResponse();
  }
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
  options: RunMutationOptions<Request> = {},
): Promise<MutationResult<Value>> {
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

  const changes = [...registryChangeRecords(definition.registry, input), ...manualInvalidations];
  const rerunQueryInstances = queriesToRerun(definition.registry?.queries ?? [], changes, input);
  return {
    changes,
    ok: true,
    ...(Object.keys(responseHeaders).length > 0 ? { responseHeaders } : {}),
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

  const replayScope = mutationReplayScope(csrf, wireRequest);
  const replayed =
    wireRequest.idem && replayScope
      ? wireRequest.replayStore?.get(replayScope, wireRequest.idem)
      : undefined;
  if (replayed) return replayed;

  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      wireRequest.rawInput,
      wireRequest.request,
      runMutationOptions(wireRequest.csrf, wireRequest),
    );
  } catch {
    return mutationServerErrorResponse(wireRequest);
  }

  if (!result.ok) {
    const replayReservation =
      result.error.code === 'VALIDATION' ? undefined : reserveMutationReplay(csrf, wireRequest);
    const response = {
      body: await renderFailureFragment(result, wireRequest),
      headers: {
        ...mutationWireResponseHeaders(wireRequest),
        ...retryAfterHeaders(result),
      },
      status: result.status,
    } satisfies MutationWireResponse;

    return result.error.code === 'VALIDATION'
      ? response
      : storeMutationReplay(csrf, wireRequest, response, replayReservation);
  }

  const replayReservation = reserveMutationReplay(csrf, wireRequest);
  const renderInput = mutationResponseInput(result, wireRequest.rawInput);
  let queryChunks: string[];
  let fragmentChunks: string[];
  try {
    queryChunks = await renderQueryChunks(
      definition.registry?.queries ?? [],
      result.rerunQueryInstances ?? result.rerunQueries.map((key) => ({ key })),
      renderInput,
      wireRequest.request,
    );
    fragmentChunks = await renderFragmentChunks(
      wireRequest.fragmentRenderers ?? [],
      wireRequest.targets ?? [],
      renderInput,
    );
  } catch (error) {
    return storeMutationReplay(
      csrf,
      wireRequest,
      mutationRenderErrorResponse(error, result.changes, wireRequest, result.responseHeaders),
      replayReservation,
    );
  }

  return storeMutationReplay(
    csrf,
    wireRequest,
    {
      body: [...queryChunks, ...fragmentChunks].join('\n'),
      headers: mergeMutationResponseHeaders(
        mutationWireResponseHeaders(wireRequest),
        {
          'FW-Changes': mutationWireChangeHeader(result.changes),
        },
        result.responseHeaders,
      ),
      status: 200,
    },
    replayReservation,
  );
}

function mutationRenderErrorResponse<Request>(
  error: unknown,
  changes: readonly ChangeRecord[],
  wireRequest: MutationWireRequest<Request>,
  responseHeaders?: MutationResponseHeaders,
): MutationWireResponse {
  return {
    body: renderMutationRenderErrorFragment(error, wireRequest),
    headers: mergeMutationResponseHeaders(
      mutationWireResponseHeaders(wireRequest),
      {
        'FW-Changes': mutationWireChangeHeader(changes),
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
    ...(endpointRequest.csrf === undefined ? {} : { csrf: endpointRequest.csrf }),
    rawInput: endpointRequest.rawInput,
    redirectTo: endpointRequest.redirectTo,
    ...(endpointRequest.renderFailurePage === undefined
      ? {}
      : { renderFailurePage: endpointRequest.renderFailurePage }),
    request: endpointRequest.request,
    ...(endpointRequest.sessionProvider === undefined
      ? {}
      : { sessionProvider: endpointRequest.sessionProvider }),
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
  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      noJsRequest.rawInput,
      noJsRequest.request,
      runMutationOptions(noJsRequest.csrf, noJsRequest),
    );
  } catch {
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

function serverErrorPayload(): { code: 'SERVER_ERROR'; payload: Record<string, never> } {
  return { code: 'SERVER_ERROR', payload: {} };
}

async function resolveLifecycleRequest<Request, SessionValue>(
  request: Request,
  options: RequestLifecycleOptions<Request, SessionValue> = {},
): Promise<Request> {
  if (!options.sessionProvider) return request;

  const sessionValue = (await options.sessionProvider(request)) ?? null;
  return requestWithSession(request, sessionValue);
}

function requestWithSession<Request, SessionValue>(
  request: Request,
  sessionValue: SessionValue | null,
): Request {
  if ((typeof request !== 'object' && typeof request !== 'function') || request === null) {
    return { session: sessionValue } as Request;
  }

  return new Proxy(request as object, {
    get(target, property, receiver) {
      if (property === 'session') return sessionValue;

      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'session') {
        return {
          configurable: true,
          enumerable: true,
          value: sessionValue,
          writable: false,
        };
      }

      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === 'session' || property in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return keys.includes('session') ? keys : [...keys, 'session'];
    },
  }) as Request;
}

async function renderHttpGuardFailureResponse<Request>(
  result: {
    auth?: GuardFailure['auth'];
    error?: { code: string };
    ok: false;
    status: number;
  },
  request: Request,
  options: GuardFailureResponseOptions<Request>,
): Promise<HttpGuardFailureResponse | undefined> {
  if (result.status !== 422 || result.error?.code !== 'UNAUTHORIZED') return undefined;

  if (guardFailureIsUnauthenticated(result, request)) {
    const next = options.currentUrl ?? '/';
    const context = { next, request };
    const redirectResult = await (options.onUnauthenticated
      ? options.onUnauthenticated(context)
      : defaultOnUnauthenticated(context, options.loginPath));

    return {
      body: '',
      headers: { Location: redirectResult.location },
      status: redirectResult.status,
    };
  }

  return {
    body: options.renderForbidden ? await options.renderForbidden({ request }) : 'Forbidden',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 403,
  };
}

function defaultOnUnauthenticated<Request>(
  context: UnauthenticatedContext<Request>,
  loginPath = '/login',
): CoreRedirect {
  return {
    location: loginLocationWithNext(loginPath, context.next),
    status: 303,
  };
}

function loginLocationWithNext(loginPath: string, next: string): string {
  const base = 'https://jiso.local';
  const url = new URL(loginPath, base);
  url.searchParams.set('next', next);

  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function guardFailureIsUnauthenticated<Request>(
  result: { auth?: GuardFailure['auth'] },
  request: Request,
): boolean {
  if (result.auth === 'unauthenticated') return true;
  if (result.auth === 'unauthorized') return false;

  return requestSession(request) == null;
}

function requestSession(request: unknown): unknown {
  if (
    (typeof request === 'object' || typeof request === 'function') &&
    request !== null &&
    'session' in request
  ) {
    return (request as { session?: unknown }).session;
  }

  return undefined;
}

function routeCurrentUrl<
  const Path extends string,
  ParamsSchema extends MaybeSchema<Record<string, string>>,
  SearchSchema extends MaybeSchema<Record<string, JsonValue>>,
  Request,
  Page,
>(
  definition: RouteDeclaration<Path, ParamsSchema, SearchSchema, Request, Page>,
  input: RouteRequestInput,
): string {
  const routeRequest = parseRouteRequest(definition, input);
  const pathname = definition.path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
    encodeURIComponent(searchParamValue((routeRequest.params as Record<string, unknown>)[key])),
  );
  const search = searchParamsString(routeRequest.search as Record<string, unknown>);

  return search ? `${pathname}?${search}` : pathname;
}

function queryEndpointCurrentUrl(queryKey: string, search: QuerySearchInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of querySearchInputEntries(search)) {
    appendSearchParams(params, key, value);
  }

  const query = params.toString();
  return `/_q/${encodeURIComponent(queryKey)}${query ? `?${query}` : ''}`;
}

function searchParamsString(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    appendSearchParams(params, key, value);
  }

  return params.toString();
}

function appendSearchParams(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendSearchParams(params, key, item);
    return;
  }

  params.append(key, searchParamValue(value));
}

function searchParamValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }

  return JSON.stringify(value) ?? '';
}

function noJsMutationServerErrorResponse(): NoJsMutationResponse {
  return {
    body: 'Internal Server Error',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 500,
  };
}

function routeOutcomeResponse(outcome: RouteResponseOutcome, request: unknown): RoutePageResponse {
  const headers = routeOutcomeHeaders(outcome);
  if (outcome.etag && requestHeader(request, 'if-none-match') === outcome.etag) {
    return {
      body: '',
      headers: { ETag: outcome.etag },
      status: 304,
    };
  }

  return {
    body: outcome.body,
    headers,
    status: 200,
  };
}

function htmlServerErrorResponse(): RoutePageResponse {
  return {
    body: 'Internal Server Error',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 500,
  };
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

function isRouteResponseOutcome(value: unknown): value is RouteResponseOutcome {
  return (
    typeof value === 'object' &&
    value !== null &&
    'routeResponse' in value &&
    value.routeResponse === true
  );
}

function routeResponseOutcome(
  body: RouteResponseBody,
  options: RouteFileOptions & { disposition: 'attachment' | 'inline' },
): RouteResponseOutcome {
  const contentDisposition = options.filename
    ? `${options.disposition}; filename="${escapeHeaderValue(options.filename)}"`
    : options.disposition;
  return {
    body,
    contentDisposition,
    contentType: options.contentType,
    ...(options.etag === undefined ? {} : { etag: options.etag }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    routeResponse: true,
  };
}

function routeOutcomeHeaders(outcome: RouteResponseOutcome): Record<string, string> {
  return {
    'Content-Disposition': outcome.contentDisposition,
    'Content-Type': outcome.contentType,
    ...(outcome.etag === undefined ? {} : { ETag: outcome.etag }),
    ...outcome.headers,
  };
}

function escapeHeaderValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function requestHeader(request: unknown, name: string): string | undefined {
  if (request && typeof request === 'object' && 'headers' in request) {
    const headers = (request as { headers?: unknown }).headers;
    if (isHeaderSource(headers)) return readHeader(headers, name);
  }

  if (isHeaderSource(request)) return readHeader(request, name);
  return undefined;
}

function isHeaderSource(value: unknown): value is MutationWireHeaderSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('get' in value || Symbol.iterator in value || Object.keys(value).length > 0)
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

function retryAfterHeaders(result: { retryAfter?: number }): Record<string, string> {
  return result.retryAfter === undefined ? {} : { 'Retry-After': String(result.retryAfter) };
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

function appendResponseHeader(
  headers: MutationResponseHeaders,
  name: string,
  value: MutationResponseHeaderValue,
): void {
  const existingName = findResponseHeaderName(headers, name);
  const targetName = existingName ?? name;
  if (name.toLowerCase() !== 'set-cookie') {
    headers[targetName] = Array.isArray(value) ? [...value] : value;
    return;
  }

  const nextValues = Array.isArray(value) ? value : [value];
  const existing = existingName === undefined ? undefined : headers[existingName];
  if (existing === undefined) {
    headers[targetName] = [...nextValues];
    return;
  }

  headers[targetName] = [...(Array.isArray(existing) ? existing : [existing]), ...nextValues];
}

function findResponseHeaderName(
  headers: MutationResponseHeaders,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  return Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
}

function validateRawSetCookie(value: string): string {
  if (!value) throw new Error('ctx.setCookie requires a non-empty Set-Cookie value');
  assertNoHeaderControlCharacters(value, 'Set-Cookie');
  return value;
}

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  assertCookieName(name);
  assertCookieOctets(value, 'cookie value');
  const parts = [`${name}=${value}`];

  if (options.maxAge !== undefined) {
    if (!Number.isInteger(options.maxAge)) throw new Error('Cookie maxAge must be an integer');
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.domain !== undefined) {
    assertCookieOctets(options.domain, 'cookie domain');
    parts.push(`Domain=${options.domain}`);
  }
  if (options.path !== undefined) {
    assertCookieOctets(options.path, 'cookie path');
    parts.push(`Path=${options.path}`);
  }
  if (options.expires !== undefined) {
    const expires =
      options.expires instanceof Date ? options.expires.toUTCString() : options.expires;
    assertCookieOctets(expires, 'cookie expires');
    parts.push(`Expires=${expires}`);
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite !== undefined) {
    const sameSite = {
      lax: 'Lax',
      none: 'None',
      strict: 'Strict',
    }[options.sameSite];
    parts.push(`SameSite=${sameSite}`);
  }

  return parts.join('; ');
}

function assertCookieName(value: string): void {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) {
    throw new Error('Cookie name must be an HTTP token');
  }
}

function assertCookieOctets(value: string, label: string): void {
  assertNoHeaderControlCharacters(value, label);
  if (value.includes(';')) throw new Error(`${label} must not contain semicolons`);
}

function assertNoHeaderControlCharacters(value: string, label: string): void {
  if (/[\r\n]/.test(value)) throw new Error(`${label} must not contain CR or LF`);
}

function formLikeToRecord(input: unknown): Record<string, unknown> {
  if (input instanceof FormData) {
    return entriesToRecord(input.entries());
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

function isAsyncSchema<T>(schema: Schema<T>): schema is AsyncSchema<T> {
  return typeof (schema as Partial<AsyncSchema<T>>).parseAsync === 'function';
}

async function parseSchemaAsync<T>(schema: Schema<T>, input: unknown): Promise<T> {
  return isAsyncSchema(schema) ? schema.parseAsync(input) : schema.parse(input);
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
  return entriesToRecord(querySearchInputEntries(search));
}

function querySearchInputEntries(search: QuerySearchInput): Iterable<readonly [string, unknown]> {
  if (search instanceof URLSearchParams || Symbol.iterator in search) return search;

  return Object.entries(search).flatMap(([key, value]) =>
    value === undefined
      ? []
      : Array.isArray(value)
        ? value.map((item) => [key, item] as const)
        : [[key, value] as const],
  );
}

function entriesToRecord(entries: Iterable<readonly [string, unknown]>): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    appendRecordValue(record, key, value);
  }

  return record;
}

function appendRecordValue(record: Record<string, unknown>, key: string, value: unknown): void {
  const existing = record[key];

  if (existing === undefined) {
    record[key] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    record[key] = [existing, value];
  }
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

function mutationCsrfOptions<Request>(
  definition: { csrf?: CsrfValidationOptions<Request> | false },
  defaultOptions?: CsrfValidationOptions<Request>,
): CsrfValidationOptions<Request> | false | undefined {
  if (definition.csrf === false) return false;
  return definition.csrf ?? defaultOptions;
}

function endpointRequestWithoutSession(request: Request): EndpointRequest {
  if (!('session' in request)) return request as EndpointRequest;

  return new Proxy(request, {
    get(target, property) {
      if (property === 'session') return undefined;

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, property) {
      if (property === 'session') return false;
      return property in target;
    },
  }) as EndpointRequest;
}

function runMutationOptions<Request>(
  csrf: CsrfValidationOptions<Request> | undefined,
  lifecycle?: RequestLifecycleOptions<Request>,
): RunMutationOptions<Request> {
  return {
    ...(csrf === undefined ? {} : { csrf }),
    ...(lifecycle?.sessionProvider === undefined
      ? {}
      : { sessionProvider: lifecycle.sessionProvider }),
  };
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
    if (!result.ok) {
      throw new Error(`Rerun query failed: ${queryDefinition.key}`);
    }

    chunks.push(renderQueryRerunChunk(queryDefinition, result.input, result.value));
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
): string {
  const key = readQueryInstanceKey(queryDefinition, input);

  return renderQueryWireChunk({
    key,
    name: queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
}

function renderQueryEndpointChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);

  return renderQueryWireChunk({
    key: undefined,
    name: key ?? queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
}

function renderQueryWireChunk(options: {
  key: string | undefined;
  name: string;
  value: unknown;
  version: number | string | undefined;
}): string {
  const keyAttribute = options.key === undefined ? '' : ` key="${escapeAttribute(options.key)}"`;
  const versionAttribute =
    options.version === undefined ? '' : ` version="${escapeAttribute(String(options.version))}"`;

  return `<fw-query name="${escapeAttribute(options.name)}"${keyAttribute}${versionAttribute}>${escapeHtml(JSON.stringify(options.value))}</fw-query>`;
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

function renderMutationRenderErrorFragment<Request>(
  error: unknown,
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = wireRequest.failureTarget ?? wireRequest.targets?.[0] ?? 'error';
  const message = error instanceof Error ? error.message : 'Mutation response rendering failed.';

  return `<fw-fragment target="${escapeAttribute(target)}"><output role="alert" data-error-code="RENDER_ERROR">${escapeHtml(message)}</output></fw-fragment>`;
}

function renderMutationServerErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = wireRequest.failureTarget ?? wireRequest.targets?.[0] ?? 'error';

  return `<fw-fragment target="${escapeAttribute(target)}">${renderStylesheetLinks(wireRequest.failureStylesheets ?? [])}<output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output></fw-fragment>`;
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
  csrf: CsrfValidationOptions<Request> | false,
  wireRequest: MutationWireRequest<Request>,
  response: MutationWireResponse,
  reservation?: MutationReplayReservation,
): MutationWireResponse {
  if (reservation) {
    reservation.commit(response);
  } else {
    const replayScope = mutationReplayScope(csrf, wireRequest);
    if (!wireRequest.idem || !replayScope) return response;
    wireRequest.replayStore?.set(replayScope, wireRequest.idem, response);
  }

  return response;
}

function reserveMutationReplay<Request>(
  csrf: CsrfValidationOptions<Request> | false,
  wireRequest: MutationWireRequest<Request>,
): MutationReplayReservation | undefined {
  const replayScope = mutationReplayScope(csrf, wireRequest);
  if (!wireRequest.idem || !replayScope) return undefined;

  return wireRequest.replayStore?.reserve(replayScope, wireRequest.idem);
}

function mutationReplayScope<Request>(
  csrf: CsrfValidationOptions<Request> | false,
  wireRequest: MutationWireRequest<Request>,
): string | null {
  const csrfSessionId = csrf === false ? undefined : csrf.sessionId(wireRequest.request);
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

  if (
    typeof request === 'object' &&
    request !== null &&
    'session' in request &&
    typeof request.session === 'object' &&
    request.session !== null &&
    'id' in request.session &&
    typeof request.session.id === 'string' &&
    request.session.id !== ''
  ) {
    return request.session.id;
  }

  return null;
}

function mutationReplayKey(scope: string, idem: string): string {
  return `${scope}\0${idem}`;
}

function evictExpiredMutationReplays(responses: Map<string, MutationReplayRecord>): void {
  const now = Date.now();
  for (const [key, record] of responses) {
    if (record.expiresAt <= now) responses.delete(key);
  }
}

function cloneMutationWireResponse(response: MutationWireResponse): MutationWireResponse {
  return {
    body: response.body,
    headers: cloneMutationResponseHeaders(response.headers),
    status: response.status,
  };
}

function cloneMutationResponseHeaders(headers: MutationResponseHeaders): MutationResponseHeaders {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
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

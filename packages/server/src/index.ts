export type { DiagnosticCode, JsonValue } from '@jiso/core';

export interface Schema<T> {
  parse(input: unknown): T;
}

export type InferSchema<T> = T extends Schema<infer Value> ? Value : never;

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

export type Guard<Request> = (request: Request) => boolean | Promise<boolean>;

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
  all<Request>(...items: Guard<Request>[]): Guard<Request> {
    return async (request: Request) => {
      for (const item of items) {
        if (!(await item(request))) return false;
      }

      return true;
    };
  },
  authed<Request extends SessionRequestLike>(): Guard<Request> {
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

export interface QueryDefinition<Key extends string = string> {
  instanceKey?: ((input: unknown) => string | undefined) | string;
  load?: (input: unknown) => unknown;
  key: Key;
  reads: readonly Domain[];
  version?: ((input: unknown, value: unknown) => number | string | undefined) | number | string;
}

export function query<const Key extends string>(
  key: Key,
  definition: Omit<QueryDefinition<Key>, 'key'>,
): QueryDefinition<Key> {
  return { ...definition, key };
}

export interface ChangeRecord<DomainKey extends string = string, Input = unknown> {
  domain: DomainKey;
  keys?: readonly string[];
  input?: Input;
  manual?: true;
  reason?: string;
}

export interface MutationRegistry {
  queries?: readonly QueryDefinition[];
  touches?: readonly Domain[];
}

export interface FragmentRenderer {
  errorBoundary?: ErrorBoundaryRenderer;
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
  get(idem: string): MutationWireResponse | undefined;
  set(idem: string, response: MutationWireResponse): void;
}

export function createMemoryMutationReplayStore(): MutationReplayStore {
  const responses = new Map<string, MutationWireResponse>();

  return {
    get(idem) {
      const response = responses.get(idem);
      return response ? cloneMutationWireResponse(response) : undefined;
    },
    set(idem, response) {
      responses.set(idem, cloneMutationWireResponse(response));
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

export interface I18nCatalog<Messages extends Record<string, string> = Record<string, string>> {
  locale: string;
  messages: Messages;
}

export interface StylesheetAsset {
  href: string;
  preload?: boolean;
}

export interface PageHintOptions {
  i18n?: I18nCatalog | readonly I18nCatalog[];
  meta?: RouteMeta | readonly RouteMeta[];
  modulepreloads?: readonly string[];
  prefetch?: RoutePrefetch;
  prerenderUrls?: readonly string[];
  stylesheets?: readonly (string | StylesheetAsset)[];
}

export interface PageHints {
  earlyHints: Record<string, string>;
  html: string;
}

export interface DeferredQueryChunk {
  key?: string;
  name: string;
  value: unknown;
}

export type DeferredPriority = 'high' | 'normal' | 'low' | number;

export interface DeferredFragmentChunk {
  html: string;
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
> {
  errors?: Errors;
  guard?: Guard<Request>;
  handler: (
    input: InferSchema<InputSchema>,
    request: Request,
    context: MutationContext<Errors>,
  ) => Promise<Value | MutationFail> | Value | MutationFail;
  input: InputSchema;
  key: Key;
  registry?: MutationRegistry;
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
>(
  key: Key,
  definition: Omit<MutationDefinition<Key, InputSchema, Errors, Request, Value>, 'key'>,
): MutationDefinition<Key, InputSchema, Errors, Request, Value> & { key: Key } {
  return { ...definition, key };
}

export function meta<const Meta extends RouteMeta>(definition: Meta): Meta {
  return definition;
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

export function renderPageHints(options: PageHintOptions): PageHints {
  const modulepreloads = dedupe(options.modulepreloads ?? []);
  const stylesheets = dedupeStylesheets(options.stylesheets ?? []);
  const html = [
    ...renderRouteMeta(options.meta),
    ...renderI18nCatalogs(options.i18n),
    ...stylesheets.map((asset) => `<link rel="stylesheet" href="${escapeAttribute(asset.href)}">`),
    ...modulepreloads.map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}">`),
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
  const priority = fragment.priority
    ? ` priority="${escapeAttribute(String(fragment.priority))}"`
    : '';
  const stylesheets = renderStylesheetLinks(fragment.stylesheets ?? []);

  return `<fw-fragment target="${escapeAttribute(fragment.target)}"${priority}>${stylesheets}${fragment.html}</fw-fragment>`;
}

export async function runMutation<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
  rawInput: unknown,
  request: Request,
): Promise<MutationResult<Value>> {
  if (definition.guard && !(await definition.guard(request))) {
    return {
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    };
  }

  const inputResult = parseMutationInput(definition.input, rawInput);
  if (!inputResult.ok) return inputResult.failure;

  const input = inputResult.value as InferSchema<InputSchema>;
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
  const value = await definition.handler(input, request, context);

  if (isMutationFail(value)) return value;
  const changes = [
    ...changeRecordsFor(definition.registry?.touches ?? [], input),
    ...manualInvalidations,
  ];
  return {
    changes,
    ok: true,
    rerunQueries: queriesToRerun(definition.registry?.queries ?? [], changes),
    value,
  };
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
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
  wireRequest: MutationWireRequest<Request>,
): Promise<MutationWireResponse> {
  const replayed = wireRequest.idem ? wireRequest.replayStore?.get(wireRequest.idem) : undefined;
  if (replayed) return replayed;

  const result = await runMutation(definition, wireRequest.rawInput, wireRequest.request);

  if (!result.ok) {
    return storeMutationReplay(wireRequest, {
      body: await renderFailureFragment(result, wireRequest),
      headers: mutationWireResponseHeaders(wireRequest),
      status: 422,
    });
  }

  const renderInput = mutationResponseInput(result, wireRequest.rawInput);
  const queryChunks = await renderQueryChunks(
    definition.registry?.queries ?? [],
    result.rerunQueries,
    renderInput,
  );
  const fragmentChunks = await renderFragmentChunks(
    wireRequest.fragmentRenderers ?? [],
    wireRequest.targets ?? [],
    renderInput,
  );

  return storeMutationReplay(wireRequest, {
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
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
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
>(
  definition: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
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

function changeRecordsFor<Input>(
  domains: readonly Domain[],
  input: Input,
): ChangeRecord<string, Input>[] {
  return domains.map((item) => ({
    domain: item.key,
    input,
  }));
}

function mutationResponseInput<Value>(result: MutationSuccess<Value>, rawInput: unknown): unknown {
  return result.changes.find((change) => change.input !== undefined)?.input ?? rawInput;
}

function queriesToRerun(
  queries: readonly QueryDefinition[],
  changes: readonly ChangeRecord[],
): string[] {
  const touched = new Set(changes.map((change) => change.domain));
  return queries
    .filter((queryDefinition) => queryDefinition.reads.some((read) => touched.has(read.key)))
    .map((queryDefinition) => queryDefinition.key);
}

async function renderQueryChunks(
  queries: readonly QueryDefinition[],
  rerunQueries: readonly string[],
  input: unknown,
): Promise<string[]> {
  const rerun = new Set(rerunQueries);
  const chunks: string[] = [];

  for (const queryDefinition of queries) {
    if (!rerun.has(queryDefinition.key)) continue;

    const value = queryDefinition.load ? await queryDefinition.load(input) : null;
    chunks.push(renderQueryChunk(queryDefinition, input, value));
  }

  return chunks;
}

function renderQueryChunk(
  queryDefinition: QueryDefinition,
  input: unknown,
  value: unknown,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);
  const version = readQueryVersion(queryDefinition, input, value);
  const keyAttribute = key === undefined ? '' : ` key="${escapeAttribute(key)}"`;
  const versionAttribute =
    version === undefined ? '' : ` version="${escapeAttribute(String(version))}"`;

  return `<fw-query name="${escapeAttribute(queryDefinition.key)}"${keyAttribute}${versionAttribute}>${escapeHtml(JSON.stringify(value))}</fw-query>`;
}

function readQueryInstanceKey(
  queryDefinition: QueryDefinition,
  input: unknown,
): string | undefined {
  if (queryDefinition.instanceKey === undefined) return undefined;
  if (typeof queryDefinition.instanceKey === 'function') return queryDefinition.instanceKey(input);
  return queryDefinition.instanceKey;
}

function readQueryVersion(
  queryDefinition: QueryDefinition,
  input: unknown,
  value: unknown,
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
        `<fw-fragment target="${escapeAttribute(renderer.target)}">${renderStylesheetLinks(renderer.stylesheets ?? [])}${await renderer.render(input)}</fw-fragment>`,
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      chunks.push(
        `<fw-fragment target="${escapeAttribute(target)}" error-boundary="${escapeAttribute(renderer.target)}">${await renderer.errorBoundary.render(error, input)}</fw-fragment>`,
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

  return `<fw-fragment target="${escapeAttribute(target)}">${html}</fw-fragment>`;
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
  wireRequest: MutationWireRequest<Request>,
  response: MutationWireResponse,
): MutationWireResponse {
  if (wireRequest.idem) {
    wireRequest.replayStore?.set(wireRequest.idem, response);
  }

  return response;
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
  const seen = new Set<string>();
  const assets: StylesheetAsset[] = [];

  for (const value of values) {
    const asset = typeof value === 'string' ? { href: value, preload: true } : value;
    if (!asset.href || seen.has(asset.href)) continue;

    seen.add(asset.href);
    assets.push(asset);
  }

  return assets;
}

function renderEarlyHints(
  stylesheets: readonly StylesheetAsset[],
  modulepreloads: readonly string[],
): Record<string, string> {
  const links = [
    ...stylesheets
      .filter((asset) => asset.preload !== false)
      .map((asset) => `<${asset.href}>; rel=preload; as=style`),
    ...modulepreloads.map((href) => `<${href}>; rel=modulepreload`),
  ];

  return links.length > 0 ? { Link: links.join(', ') } : {};
}

function renderSpeculationRules(prefetch: RoutePrefetch, urls: readonly string[]): string {
  if (!prefetch || urls.length === 0) return '';

  return `<script type="speculationrules">${escapeScriptJson(
    JSON.stringify({
      prerender: [
        {
          eagerness: prefetch,
          urls: dedupe(urls),
        },
      ],
    }),
  )}</script>`;
}

function renderRouteMeta(metaInput: PageHintOptions['meta']): string[] {
  const metas = Array.isArray(metaInput) ? metaInput : metaInput ? [metaInput] : [];
  const tags: string[] = [];

  for (const item of metas) {
    if (item.title) tags.push(`<title>${escapeHtml(item.title)}</title>`);
    if (item.description) {
      tags.push(
        `<meta name="description" content="${escapeAttribute(item.description)}">`,
        `<meta property="og:description" content="${escapeAttribute(item.description)}">`,
      );
    }
    if (item.image) {
      tags.push(`<meta property="og:image" content="${escapeAttribute(item.image)}">`);
    }
  }

  return tags;
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

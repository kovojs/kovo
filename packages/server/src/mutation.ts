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
import { renderStylesheetLinks } from './hints.js';
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
  type MutationEndpointRequest,
  type MutationEndpointResponse,
  type MutationWireRequest,
  type MutationWireResponse,
  type NoJsMutationRequest,
  type NoJsMutationResponse,
} from './mutation-wire.js';
import { mutationReplayContext, readMutationReplay, withMutationReplay } from './replay.js';
import {
  parseSchemaAsync,
  SchemaValidationError,
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

export function errorBoundary<Renderer extends FragmentRenderer>(
  renderer: Renderer,
  boundary: ErrorBoundaryRenderer,
): Renderer & { errorBoundary: ErrorBoundaryRenderer } {
  return { ...renderer, errorBoundary: boundary };
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

  const changes = [
    ...mutationRegistryChangeRecords(definition.registry, input),
    ...manualInvalidations,
  ];
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

  const replay = mutationReplayContext(csrf, wireRequest);
  const replayed = await readMutationReplay(replay);
  if (replayed) return replayed;

  let result: MutationResult<Value>;
  try {
    result = await runMutation(
      definition,
      wireRequest.rawInput,
      wireRequest.request,
      runMutationOptions(wireRequest.csrf, wireRequest),
    );
  } catch (error) {
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
      return {
        body: await renderFailureFragment(result, wireRequest),
        headers: {
          ...mutationWireResponseHeaders(wireRequest),
          ...retryAfterHeaders(result),
        },
        status: result.status,
      };
    }

    return withMutationReplay(replay, async () => ({
      body: await renderFailureFragment(result, wireRequest),
      headers: {
        ...mutationWireResponseHeaders(wireRequest),
        ...retryAfterHeaders(result),
      },
      status: result.status,
    }));
  }

  const renderInput = mutationResponseInput(result, wireRequest.rawInput);
  return withMutationReplay(replay, async () => {
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
      reportServerError(wireRequest.onError, error, {
        mutationKey: definition.key,
        operation: 'mutation-render',
        request: wireRequest.request,
        ...(wireRequest.targets === undefined ? {} : { targets: wireRequest.targets }),
      });
      return mutationRenderErrorResponse(result.changes, wireRequest, result.responseHeaders);
    }

    return {
      body: [...queryChunks, ...fragmentChunks].join('\n'),
      headers: mergeMutationResponseHeaders(
        mutationWireResponseHeaders(wireRequest),
        {
          'FW-Changes': mutationWireChangeHeader(result.changes),
        },
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
    ...(endpointRequest.onError === undefined ? {} : { onError: endpointRequest.onError }),
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

function runMutationOptions<Request>(
  csrf: CsrfValidationOptions<Request> | undefined,
  lifecycle?: RequestLifecycleOptions<Request>,
): RunMutationOptions<Request> {
  return {
    ...(csrf === undefined ? {} : { csrf }),
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
): Promise<string[]> {
  const chunks: string[] = [];

  for (const queryDefinition of queries) {
    if (!rerunQueries.some((target) => queryMatchesRerun(queryDefinition, input, target))) {
      continue;
    }

    const result = await runQuery(queryDefinition, input, request);
    if (!result.ok) {
      throw new Error(`Rerun query failed: ${queryDefinition.key}`, { cause: result });
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

  return renderQueryWireHtml({
    key,
    name: queryDefinition.key,
    value,
    version: readQueryVersion(queryDefinition, input, value),
  });
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
          html: `${renderStylesheetLinks(renderer.stylesheets ?? [])}${await renderer.render(input)}`,
          mode: renderer.mode,
          target: renderer.target,
        }),
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      chunks.push(
        renderFragmentWireHtml({
          errorBoundary: renderer.target,
          html: `${renderStylesheetLinks(renderer.stylesheets ?? [])}${await renderer.errorBoundary.render(error, input)}`,
          target,
        }),
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

  return renderFragmentWireHtml({
    html: `${renderStylesheetLinks(wireRequest.failureStylesheets ?? [])}${html}`,
    target,
  });
}

function renderMutationRenderErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = wireRequest.failureTarget ?? wireRequest.targets?.[0] ?? 'error';

  return renderFragmentWireHtml({
    html: '<output role="alert" data-error-code="RENDER_ERROR">Internal Server Error</output>',
    target,
  });
}

function renderMutationServerErrorFragment<Request>(
  wireRequest: MutationWireRequest<Request>,
): string {
  const target = wireRequest.failureTarget ?? wireRequest.targets?.[0] ?? 'error';

  return renderFragmentWireHtml({
    html: `${renderStylesheetLinks(wireRequest.failureStylesheets ?? [])}<output role="alert" data-error-code="SERVER_ERROR">Internal Server Error</output>`,
    target,
  });
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
    'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
    ...(wireRequest.idem ? { 'FW-Idem': wireRequest.idem } : {}),
  };
}

import type {
  EndpointAuthDeclaration,
  EndpointMethod,
  EndpointMount,
  WebhookVerifier,
} from '@jiso/core';
import type { ChangeRecord } from './change-record.js';
import type { Domain } from './domain.js';
import {
  endpointRequestWithoutSession,
  type EndpointDeclaration,
  type EndpointRequest,
} from './endpoint.js';
import type { MutationResponseHeaders, ServerResponseBase } from './response.js';
import type { InferSchema, MaybePromise, Schema } from './schema.js';

export type WebhookFailureStatus = 400 | 401 | 422 | 429 | 500;
export type WebhookSuccessStatus = 200;
export type WebhookResponseStatus = WebhookFailureStatus | WebhookSuccessStatus;

export interface WebhookFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  retryAfter?: number;
  status: WebhookFailureStatus;
}

export interface WebhookChangeOptions<Input = unknown> {
  input?: Input;
  keys?: readonly string[];
  reason?: string;
}

export interface WebhookWireResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  WebhookResponseStatus
> {}

export interface WebhookReplayStore {
  get(scope: string, idem: string): Promise<WebhookWireResponse> | WebhookWireResponse | undefined;
  reserve(scope: string, idem: string): WebhookReplayReservation | undefined;
  set(scope: string, idem: string, response: WebhookWireResponse): void;
}

export interface WebhookReplayReservation {
  commit(response: WebhookWireResponse): void;
}

export interface WebhookHandlerContext<Input, Tx = unknown> {
  fail<Code extends string, Payload>(
    code: Code,
    payload: Payload,
    options?: { retryAfter?: number; status?: WebhookFailureStatus },
  ): WebhookFail<Code, Payload>;
  rawBody: Uint8Array;
  recordChange<const DomainKey extends string, ChangeInput = Input>(
    domain: Domain<DomainKey>,
    options?: WebhookChangeOptions<ChangeInput>,
  ): ChangeRecord<DomainKey, ChangeInput | Input>;
  request: EndpointRequest;
  tx: Tx;
}

export interface WebhookTransactionContext<Input> {
  input: Input;
  rawBody: Uint8Array;
  request: EndpointRequest;
}

type WebhookInputFor<InputSchema extends Schema<unknown>> = InferSchema<InputSchema> &
  Record<string, unknown>;

interface WebhookDefinitionBase<InputSchema extends Schema<unknown>, Value, Tx> {
  handler: (
    input: WebhookInputFor<InputSchema>,
    context: WebhookHandlerContext<WebhookInputFor<InputSchema>, Tx>,
  ) => MaybePromise<Value | WebhookFail>;
  idempotency?: (input: WebhookInputFor<InputSchema>) => string | undefined;
  input: InputSchema;
  replayStore?: WebhookReplayStore;
  transaction?: <Result>(
    context: WebhookTransactionContext<WebhookInputFor<InputSchema>>,
    run: (tx: Tx) => Promise<Result>,
  ) => Promise<Result>;
}

interface WebhookVerifiedDefinition {
  verify: WebhookVerifier;
  verifyJustification?: never;
}

interface WebhookNoneDefinition {
  verify: 'none';
  verifyJustification: string;
}

export type WebhookDefinition<
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Value = unknown,
  Tx = unknown,
> = WebhookDefinitionBase<InputSchema, Value, Tx> &
  (WebhookVerifiedDefinition | WebhookNoneDefinition);

export interface WebhookDeclaration<
  Name extends string = string,
  Path extends string = string,
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Value = unknown,
  Tx = unknown,
> extends EndpointDeclaration<Path, 'POST', 'exact'> {
  name: Name;
  webhook: true;
  webhookDefinition: WebhookDefinition<InputSchema, Value, Tx>;
}

export interface WebhookRunResult<Input = unknown, Value = unknown> {
  changes: readonly ChangeRecord<string, Input>[];
  replayed: boolean;
  response: Response;
  value?: Value;
}

export function webhook<
  const Name extends string,
  const Path extends string,
  InputSchema extends Schema<unknown>,
  Value = unknown,
  Tx = unknown,
>(
  name: Name,
  definition: WebhookDefinition<InputSchema, Value, Tx> & { path: Path },
): WebhookDeclaration<Name, Path, InputSchema, Value, Tx> {
  let declaration: WebhookDeclaration<Name, Path, InputSchema, Value, Tx>;
  const handler = async (request: EndpointRequest): Promise<Response> =>
    (await runWebhook(declaration, request)).response;

  declaration = {
    auth: webhookAuth(definition),
    csrf: {
      exempt: true,
      justification: webhookCsrfJustification(name, definition),
    },
    handler,
    method: 'POST' satisfies EndpointMethod,
    mount: 'exact' satisfies EndpointMount,
    name,
    path: definition.path,
    webhook: true,
    webhookDefinition: definition,
  } satisfies WebhookDeclaration<Name, Path, InputSchema, Value, Tx>;

  return declaration;
}

export async function runWebhook<
  const Name extends string,
  const Path extends string,
  InputSchema extends Schema<unknown>,
  Value,
  Tx,
>(
  declaration: WebhookDeclaration<Name, Path, InputSchema, Value, Tx>,
  request: Request,
): Promise<WebhookRunResult<WebhookInputFor<InputSchema>, Value>> {
  const endpointRequest = endpointRequestWithoutSession(request);
  const rawBody = new Uint8Array(await endpointRequest.arrayBuffer());
  const verification = await verifyWebhook(declaration.webhookDefinition, endpointRequest, rawBody);
  if (!verification) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(401, 'Unauthorized'),
    };
  }

  const bodyResult = parseWebhookBody(rawBody);
  if (!bodyResult.ok) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(400, bodyResult.message),
    };
  }

  const inputResult = await parseLooseWebhookInput(
    declaration.webhookDefinition.input,
    bodyResult.value,
  );
  if (!inputResult.ok) {
    return {
      changes: [],
      replayed: false,
      response: webhookJsonResponse(422, {
        error: { code: 'VALIDATION', payload: { message: inputResult.message } },
        ok: false,
      }),
    };
  }

  const input = inputResult.value;
  const idem = declaration.webhookDefinition.idempotency?.(input);
  const replayScope = webhookReplayScope(declaration.name);
  const replayed = idem
    ? await declaration.webhookDefinition.replayStore?.get(replayScope, idem)
    : undefined;
  if (replayed) {
    return {
      changes: [],
      replayed: true,
      response: responseFromWire(replayed),
    };
  }

  const reservation =
    idem === undefined
      ? undefined
      : declaration.webhookDefinition.replayStore?.reserve(replayScope, idem);
  if (idem !== undefined && !reservation) {
    const pending = await declaration.webhookDefinition.replayStore?.get(replayScope, idem);
    if (pending) {
      return {
        changes: [],
        replayed: true,
        response: responseFromWire(pending),
      };
    }
  }

  const changes: ChangeRecord<string, WebhookInputFor<InputSchema>>[] = [];
  const context = webhookHandlerContext(input, endpointRequest, rawBody, changes);

  try {
    const runHandler = async (tx: Tx): Promise<Value> => {
      const value = await declaration.webhookDefinition.handler(input, { ...context, tx });
      if (isWebhookFail(value)) throw new WebhookRollback(value);
      return value as Value;
    };
    const value = declaration.webhookDefinition.transaction
      ? await declaration.webhookDefinition.transaction(
          { input, rawBody, request: endpointRequest },
          runHandler,
        )
      : await runHandler(undefined as Tx);

    const response = storeWebhookReplay(
      declaration.webhookDefinition.replayStore,
      replayScope,
      idem,
      {
        body: 'ok',
        headers: webhookSuccessHeaders(changes, idem),
        status: 200,
      },
      reservation,
    );

    return {
      changes,
      replayed: false,
      response: responseFromWire(response),
      value,
    };
  } catch (error) {
    if (error instanceof WebhookRollback) {
      const response = storeWebhookReplay(
        declaration.webhookDefinition.replayStore,
        replayScope,
        idem,
        webhookFailWireResponse(error.failure, idem),
        reservation,
      );

      return {
        changes: [],
        replayed: false,
        response: responseFromWire(response),
      };
    }

    const response = storeWebhookReplay(
      declaration.webhookDefinition.replayStore,
      replayScope,
      idem,
      {
        body: 'Internal Server Error',
        headers: webhookResponseHeaders(idem),
        status: 500,
      },
      reservation,
    );

    return {
      changes: [],
      replayed: false,
      response: responseFromWire(response),
    };
  }
}

type WebhookVerificationFields = WebhookVerifiedDefinition | WebhookNoneDefinition;

function webhookAuth(definition: WebhookVerificationFields): EndpointAuthDeclaration {
  if (definition.verify === 'none') {
    return {
      justification: definition.verifyJustification,
      kind: 'none',
    } satisfies EndpointAuthDeclaration;
  }

  if (definition.verify.kind === 'custom') {
    return { kind: 'custom', name: definition.verify.name } satisfies EndpointAuthDeclaration;
  }

  return {
    kind: 'verifier',
    name: definition.verify.resolved.scheme,
  } satisfies EndpointAuthDeclaration;
}

function webhookCsrfJustification(name: string, definition: WebhookVerificationFields): string {
  if (definition.verify === 'none') return definition.verifyJustification;
  return `${name} webhook verifier ${webhookVerifierScheme(definition.verify)}`;
}

function webhookVerifierScheme(verifier: WebhookVerifier): string {
  return verifier.kind === 'custom' ? verifier.scheme : verifier.resolved.scheme;
}

async function verifyWebhook(
  definition: WebhookVerificationFields,
  request: EndpointRequest,
  rawBody: Uint8Array,
): Promise<boolean> {
  if (definition.verify === 'none') return true;

  return definition.verify.verify({
    headers: request.headers,
    payload: rawBody,
  });
}

function parseWebhookBody(
  rawBody: Uint8Array,
): { ok: true; value: unknown } | { message: string; ok: false } {
  if (rawBody.byteLength === 0) return { ok: true, value: {} };

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(rawBody)) };
  } catch {
    return { message: 'Invalid JSON webhook body', ok: false };
  }
}

async function parseLooseWebhookInput<InputSchema extends Schema<unknown>>(
  schema: InputSchema,
  rawInput: unknown,
): Promise<{ ok: true; value: WebhookInputFor<InputSchema> } | { message: string; ok: false }> {
  try {
    const parsed = await parseSchema(schema, rawInput);
    const value =
      isPlainRecord(rawInput) && isPlainRecord(parsed) ? { ...rawInput, ...parsed } : parsed;

    return { ok: true, value: value as WebhookInputFor<InputSchema> };
  } catch (error) {
    return { message: error instanceof Error ? error.message : 'Invalid webhook input', ok: false };
  }
}

async function parseSchema<T>(schema: Schema<T>, input: unknown): Promise<T> {
  const asyncSchema = schema as Schema<T> & { parseAsync?: (input: unknown) => Promise<T> };
  return asyncSchema.parseAsync ? asyncSchema.parseAsync(input) : schema.parse(input);
}

function webhookHandlerContext<Input, Tx>(
  input: Input,
  request: EndpointRequest,
  rawBody: Uint8Array,
  changes: ChangeRecord<string, Input>[],
): WebhookHandlerContext<Input, Tx> {
  return {
    fail(code, payload, options = {}) {
      return {
        error: { code, payload },
        ok: false,
        ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
        status: options.status ?? 422,
      };
    },
    rawBody,
    recordChange(domain, options = {}) {
      // SPEC §9.1: webhook domain writes emit the same internal change record shape as mutations.
      const record = {
        domain: domain.key,
        input: options.input ?? input,
        ...(options.keys === undefined ? {} : { keys: options.keys }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      } as ChangeRecord<typeof domain.key, Input>;
      changes.push(record);
      return record;
    },
    request,
    tx: undefined as Tx,
  };
}

function isWebhookFail(value: unknown): value is WebhookFail {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value &&
    'status' in value
  );
}

class WebhookRollback extends Error {
  readonly failure: WebhookFail;

  constructor(failure: WebhookFail) {
    super(failure.error.code);
    this.failure = failure;
    this.name = 'WebhookRollback';
  }
}

function webhookFailWireResponse(
  failure: WebhookFail,
  idem: string | undefined,
): WebhookWireResponse {
  return {
    body: JSON.stringify({ error: failure.error, ok: false }),
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...webhookResponseHeaders(idem),
      ...(failure.retryAfter === undefined ? {} : { 'Retry-After': String(failure.retryAfter) }),
    },
    status: failure.status,
  };
}

function storeWebhookReplay(
  replayStore: WebhookReplayStore | undefined,
  scope: string,
  idem: string | undefined,
  response: WebhookWireResponse,
  reservation: WebhookReplayReservation | undefined,
): WebhookWireResponse {
  if (reservation) {
    reservation.commit(response);
    return response;
  }

  if (idem !== undefined) replayStore?.set(scope, idem, response);
  return response;
}

function responseFromWire(response: WebhookWireResponse): Response {
  return new Response(response.body, {
    headers: response.headers as Record<string, string>,
    status: response.status,
  });
}

function webhookResponse(status: 400 | 401 | 500, body: string): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status,
  });
}

function webhookJsonResponse(status: 422, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status,
  });
}

function webhookSuccessHeaders(
  changes: readonly ChangeRecord[],
  idem: string | undefined,
): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    ...webhookResponseHeaders(idem),
    ...(changes.length === 0 ? {} : { 'FW-Changes': webhookChangeHeader(changes) }),
  };
}

function webhookResponseHeaders(idem: string | undefined): Record<string, string> {
  return idem === undefined ? {} : { 'FW-Idem': idem };
}

function webhookChangeHeader(changes: readonly ChangeRecord[]): string {
  return JSON.stringify(
    changes.map((change) => ({
      domain: change.domain,
      ...(change.keys === undefined ? {} : { keys: change.keys }),
    })),
  );
}

function webhookReplayScope(name: string): string {
  return `webhook:${name}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

import type { WebhookVerifier } from '@kovojs/core';
import type { ChangeRecord } from './change-record.js';
import type { AccessDecision } from './access.js';
import type { Domain } from './domain.js';
import {
  endpointRequestWithoutSession,
  type EndpointDeclaration,
  type EndpointAuthDeclaration,
  type EndpointMethod,
  type EndpointMount,
  type EndpointRequest,
} from './endpoint.js';
import {
  serverResponseToWebResponse,
  type MutationResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import { isSchemaValidationError } from './schema.js';
import type { InferSchema, Schema, ValidationIssue } from './schema.js';

/** @internal */
export type WebhookFailureStatus = 400 | 401 | 422 | 429 | 500;
/** @internal */
export type WebhookSuccessStatus = 200;
/** @internal */
export type WebhookResponseStatus = WebhookFailureStatus | WebhookSuccessStatus;

/**
 * A typed webhook failure outcome (SPEC §9.1 webhook lifecycle): a declared `error`
 * `code` and `payload` answered with the chosen 4xx/5xx `status` (optional `retryAfter`)
 * so provider retry semantics are explicit. Produced via `WebhookHandlerContext.fail`,
 * which rolls back the transaction.
 */
export interface WebhookFail<Code extends string = string, Payload = unknown> {
  error: {
    code: Code;
    payload: Payload;
  };
  ok: false;
  retryAfter?: number;
  status: 400 | 401 | 422 | 429 | 500;
}

/**
 * Options for `WebhookHandlerContext.recordChange` (SPEC §9.1): the affected `keys`,
 * an optional override `input`, and a `reason`, used to build the unified
 * `{domain, keys, input}` change record emitted after commit.
 */
export interface WebhookChangeOptions<Input = unknown> {
  input?: Input;
  keys?: readonly string[];
  reason?: string;
}

/** @internal */
export interface WebhookWireResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  WebhookResponseStatus
> {}

/** @internal */
export interface WebhookReplayStore {
  get(scope: string, idem: string): Promise<WebhookWireResponse> | WebhookWireResponse | undefined;
  reserve(scope: string, idem: string): WebhookReplayReservation | undefined;
  set(scope: string, idem: string, response: WebhookWireResponse): void;
}

/** @internal */
export interface WebhookReplayReservation {
  /** Release a pending reservation without committing, so a retry can re-run the handler (A4). */
  abort?(): void;
  commit(response: WebhookWireResponse): void;
}

/**
 * The `context` passed to a webhook `handler` (SPEC §9.1 webhook lifecycle): the
 * transaction handle `tx`, verified `rawBody`, the raw `request`, `fail` to return a
 * typed {@link WebhookFail}, and `recordChange` to emit a domain change record.
 */
export interface WebhookHandlerContext<Input, Tx = unknown> {
  fail<Code extends string, Payload>(
    code: Code,
    payload: Payload,
    options?: { retryAfter?: number; status?: 400 | 401 | 422 | 429 | 500 },
  ): WebhookFail<Code, Payload>;
  rawBody: Uint8Array;
  recordChange<const DomainKey extends string, ChangeInput = Input>(
    domain: Domain<DomainKey>,
    options?: WebhookChangeOptions<ChangeInput>,
  ): ChangeRecord<DomainKey, ChangeInput | Input>;
  request: EndpointRequest;
  tx: Tx;
}

/**
 * The `context` passed to a webhook's `transaction` wrapper (SPEC §9.1 webhook lifecycle),
 * carrying the parsed `input`, verified `rawBody`, and raw `request` so the app can open
 * the `BEGIN`/`COMMIT` boundary around the handler.
 */
export interface WebhookTransactionContext<Input> {
  input: Input;
  rawBody: Uint8Array;
  request: EndpointRequest;
}

type WebhookInputFor<InputSchema extends Schema<unknown>> = InferSchema<InputSchema> &
  Record<string, unknown>;

interface WebhookDefinitionBase<InputSchema extends Schema<unknown>, Value, Tx> {
  access: AccessDecision;
  handler: (
    input: WebhookInputFor<InputSchema>,
    context: WebhookHandlerContext<WebhookInputFor<InputSchema>, Tx>,
  ) => Promise<Value | WebhookFail> | (Value | WebhookFail);
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

/**
 * The definition object accepted by {@link webhook} (SPEC §9.1 webhook lifecycle):
 * the `verify` scheme (a `WebhookVerifier` or `'none'` with a `verifyJustification`),
 * loose `input` schema, optional `idempotency`/`replayStore`/`transaction`, and the
 * `handler`. Types `webhook()`'s parameter.
 */
export type WebhookDefinition<
  InputSchema extends Schema<unknown> = Schema<unknown>,
  Value = unknown,
  Tx = unknown,
> = WebhookDefinitionBase<InputSchema, Value, Tx> &
  (WebhookVerifiedDefinition | WebhookNoneDefinition);

/**
 * The registry-visible endpoint declaration returned by {@link webhook} (SPEC §9.1):
 * an `EndpointDeclaration` for a POST exact mount, tagged `webhook: true` with the
 * resolved `webhookDefinition`, so the webhook appears in the machine-ingress audit.
 */
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

/**
 * Declare a webhook endpoint: a named POST receiver that verifies the raw
 * payload signature before parsing input, then runs a handler that can record
 * domain changes and is idempotent by construction. Pass a `WebhookVerifier`
 * built from generic helpers such as `hmacSignature`, or `verify: 'none'` with
 * a justification (SPEC §9.1). Every webhook must carry an explicit access
 * decision (SPEC §10.2/§11.3, KV436).
 *
 * @param name - The webhook's identifier.
 * @param definition - The `path`, `verify`, `input` schema, and `handler` (plus optional idempotency/transaction).
 * @returns A `WebhookDeclaration` (a verified `EndpointDeclaration`).
 * @example
 * import { domain, webhook, s } from '@kovojs/server';
 *
 * const order = domain('order');
 *
 * export const orderPaid = webhook('order-paid', {
 *   path: '/webhooks/order-paid',
 *   verify: 'none',
 *   verifyJustification: 'internal test fixture',
 *   input: s.object({ orderId: s.string() }),
 *   handler(input, context) {
 *     return { changes: [context.recordChange(order, { keys: [input.orderId] })] };
 *   },
 * });
 */
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
    access: definition.access,
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
    reason: `webhook:${name}`,
    response: { appOwnedSafety: false, body: 'text', cache: 'no-store' },
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
  // L10-1 (SPEC §9.1:860-862): verification is fail-closed. An app-authored
  // `verify()`/`payload`/`tolerance.timestamp` callback (core/src/verifier.ts) may
  // THROW on a malformed signature header instead of returning false; that thrown
  // error must be treated as verification failure, not propagate as an uncaught
  // rejection → framework 500. Catch ANY error here and return the same 401 as a
  // `false` result, never surfacing which check failed.
  let verification: boolean;
  try {
    verification = await verifyWebhook(declaration.webhookDefinition, endpointRequest, rawBody);
  } catch {
    verification = false;
  }
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

  // L2 (SPEC §9.2:876): `parseLooseWebhookInput` returns typed issues for a validation
  // failure (→ 422) but RE-THROWS any non-validation (internal) error. Map that re-throw to
  // the same sanitized 500 the handler-exception path returns, never leaking its `.message`.
  let inputResult: Awaited<ReturnType<typeof parseLooseWebhookInput<InputSchema>>>;
  try {
    inputResult = await parseLooseWebhookInput(
      declaration.webhookDefinition.input,
      bodyResult.value,
    );
  } catch {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
    };
  }
  if (!inputResult.ok) {
    return {
      changes: [],
      replayed: false,
      response: webhookJsonResponse(422, {
        error: { code: 'VALIDATION', payload: { issues: inputResult.issues } },
        ok: false,
      }),
    };
  }

  const input = inputResult.value;
  const idem = declaration.webhookDefinition.idempotency?.(input);
  // L10-3 (SPEC §9.1:860): use ONE truthiness predicate for the whole replay
  // lifecycle. An empty-string idem is a VALID provider event id, so the fast-path
  // LOOKUP must be gated on `idem !== undefined` (treated active) exactly like the
  // RESERVE/SET below — gating the lookup on a truthy `idem` skipped the fast path
  // for '' while still reserving, leaving a latent double-execute window.
  const idemActive = idem !== undefined;
  const replayScope = webhookReplayScope(declaration.name);
  const replayed = idemActive
    ? await declaration.webhookDefinition.replayStore?.get(replayScope, idem)
    : undefined;
  if (replayed) {
    return {
      changes: [],
      replayed: true,
      response: responseFromWire(replayed),
    };
  }

  const reservation = idemActive
    ? declaration.webhookDefinition.replayStore?.reserve(replayScope, idem)
    : undefined;
  if (idemActive && !reservation) {
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

    // A4 (SPEC §9.1:850): on an unexpected exception, abort the reservation so
    // a provider retry can re-run the handler fresh. Only explicit fail()/
    // WebhookRollback results and successes get committed to the replay store.
    reservation?.abort?.();

    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
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
): Promise<
  | { ok: true; value: WebhookInputFor<InputSchema> }
  | { issues: readonly ValidationIssue[]; ok: false }
> {
  try {
    const parsed = await parseSchema(schema, rawInput);
    const value =
      isPlainRecord(rawInput) && isPlainRecord(parsed) ? { ...rawInput, ...parsed } : parsed;

    return { ok: true, value: value as WebhookInputFor<InputSchema> };
  } catch (error) {
    // L2 (SPEC §9.2:876): only a schema validation failure is a client-facing 422. Any other
    // throw is an internal failure (e.g. an `s.file().store()` storage/DB backend error whose
    // `.message` may carry a DSN/endpoint/request-id) and MUST NOT be laundered into the 422
    // body — re-throw it so the outer handler maps it to a sanitized 500.
    if (isSchemaValidationError(error)) {
      return { issues: error.issues, ok: false };
    }
    throw error;
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
  return serverResponseToWebResponse(response, { method: 'GET' });
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
    ...(changes.length === 0 ? {} : { 'Kovo-Changes': webhookChangeHeader(changes) }),
  };
}

function webhookResponseHeaders(idem: string | undefined): Record<string, string> {
  return idem === undefined ? {} : { 'Kovo-Idem': idem };
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
  const prototype =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.getPrototypeOf(value)
      : undefined;
  return prototype === Object.prototype || prototype === null;
}

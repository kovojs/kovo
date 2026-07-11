import type { WebhookVerifier } from '@kovojs/core';
import {
  actAsNonRequestPrincipal,
  declareSystemPrincipal,
  type NonRequestPrincipalPosture,
  type PrincipalAccessOperation,
} from './auth-principal.js';
import type { ChangeRecord } from './change-record.js';
import { snapshotAccessDecision, verifiedAccess, type AccessDecision } from './access.js';
import type { Domain } from './domain.js';
import { runMutation, type RunMutationOptions } from './mutation.js';
import {
  endpointRequestWithoutSession,
  type EndpointDeclaration,
  type EndpointAuthDeclaration,
  type EndpointMethod,
  type EndpointMount,
  type EndpointRequest,
} from './endpoint.js';
import {
  mergeResponseHeaders,
  retryAfterHeaders,
  serverResponseToWebResponse,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import { isSchemaValidationError } from './schema.js';
import type { InferSchema, Schema, ValidationIssue } from './schema.js';
import { managedSqlExecutionPolicy, wrapManagedDbForSqlSafety } from './sql-safe-handle.js';
import { reserveReplayBeforeRun } from './replay.js';
import {
  parseUntrustedJsonBodyBytes,
  revealUntrustedRequestValue,
} from './untrusted-request-body.js';

const WEBHOOK_RESPONSE_RESERVED_HEADERS = ['Kovo-*'] as const;

declare const webhookTxDbBrand: unique symbol;

/** HTTP statuses a webhook failure replay response may store and replay (SPEC §9.1). */
export type WebhookFailureStatus = 400 | 401 | 422 | 429 | 500;

/** HTTP status a successful webhook replay response stores and replays (SPEC §9.1). */
export type WebhookSuccessStatus = 200;

/** HTTP status union accepted by webhook replay wire responses (SPEC §9.1 / §10.3). */
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

/** A stored wire response replayed for a duplicate webhook delivery (SPEC §10.3). */
export interface WebhookWireResponse extends ServerResponseBase<
  string,
  ResponseHeaders,
  WebhookResponseStatus
> {}

/** Atomic idempotency store used by writable webhooks to reserve and replay provider event ids. */
export interface WebhookReplayStore {
  get(scope: string, idem: string): Promise<WebhookWireResponse> | WebhookWireResponse | undefined;
  reserve(scope: string, idem: string): WebhookReplayReservation | undefined;
  set(scope: string, idem: string, response: WebhookWireResponse): void;
}

/** A held webhook replay reservation, committed with the final response or aborted on failure. */
export interface WebhookReplayReservation {
  /** Release a pending reservation without committing, so a retry can re-run the handler (A4). */
  abort?(): void;
  commit(response: WebhookWireResponse): void;
}

/**
 * Declared domain writes for a webhook. Used by {@link WebhookDefinition.writes}
 * and {@link WebhookHandlerContext.recordChange} so the TypeScript surface mirrors
 * the SPEC §9.1 endpoint audit contract.
 */
export type WebhookDeclaredWrites = readonly Domain[];

/** Minimal public shape accepted by `WebhookHandlerContext.runMutation(...)` (SPEC §9.1/§10.3). */
export interface WebhookRunnableMutation<Input = unknown> {
  input: Schema<Input>;
  key: string;
}

/** Input accepted by `WebhookHandlerContext.runMutation(...)` for a mutation-like definition. */
export type WebhookRunnableMutationInput<Mutation> =
  Mutation extends WebhookRunnableMutation<infer Input> ? Input : never;

/**
 * Write scope returned by `context.actAs(id)` or `context.declareSystemWrite(reason)` in a webhook
 * handler. SPEC §10.3 DEC-G requires machine ingress to choose an explicit owner principal or
 * audited system posture before using mutation composition or the transaction DB handle.
 */
export interface WebhookPrincipalWriteScope<Tx = unknown> {
  runMutation<const Mutation extends WebhookRunnableMutation<any>>(
    definition: Mutation,
    input: WebhookRunnableMutationInput<Mutation>,
  ): Promise<unknown>;
  tx: WebhookTxDb<Tx>;
}

/** Options used when an app dispatch path lets a webhook compose through `runMutation(...)`. */
export interface RunWebhookOptions<Request extends EndpointRequest = EndpointRequest> {
  mutationOptions?: Omit<RunMutationOptions<Request>, 'csrf'>;
}

/**
 * Domain keys a webhook may record from its declared `writes` list. If a webhook
 * declares no writes, `recordChange` has no valid domain key.
 */
export type WebhookDeclaredWriteKey<Writes extends WebhookDeclaredWrites | undefined> =
  Writes extends readonly Domain<infer DomainKey>[] ? DomainKey : never;

/**
 * Domain accepted by `WebhookHandlerContext.recordChange`. SPEC §9.1 requires
 * webhook writes to be declared so `kovo explain --endpoints` cannot under-report
 * machine-ingress invalidation.
 */
export type WebhookDeclaredWriteDomain<Writes extends WebhookDeclaredWrites | undefined> = Domain<
  WebhookDeclaredWriteKey<Writes>
>;

/**
 * Transaction-scoped DB handle threaded by the webhook lifecycle (SPEC §10.3). It preserves the app
 * DB provider's write surface but hides the raw `.transaction()` opener; the private-symbol brand
 * makes a raw app DB or long-lived module handle awkward to pass where the handler expects the
 * framework-owned transaction capability.
 *
 * This is an author-time guardrail only (SPEC §6.6): webhook idempotency posture, transaction
 * ordering, SQL provenance, and fail-closed sinks remain the enforcement. Casts/`any` can forge the
 * type and must not be treated as proof.
 */
export type WebhookTxDb<Db> = (Db extends object
  ? Omit<Db, '$client' | 'client' | 'pglite' | 'session' | 'sqlite' | 'transaction'>
  : Db) & {
  readonly [webhookTxDbBrand]: {
    readonly db: Db;
    readonly scope: 'webhook-transaction';
  };
};

/**
 * The `context` passed to a webhook `handler` (SPEC §9.1 webhook lifecycle): the
 * transaction handle `tx`, verified `rawBody`, the raw `request`, `fail` to return a
 * typed {@link WebhookFail}, and `recordChange` to emit a declared domain change record.
 */
export interface WebhookHandlerContext<
  Input,
  Tx = unknown,
  Writes extends WebhookDeclaredWrites | undefined = WebhookDeclaredWrites,
> {
  fail<Code extends string, Payload>(
    code: Code,
    payload: Payload,
    options?: { retryAfter?: number; status?: 400 | 401 | 422 | 429 | 500 },
  ): WebhookFail<Code, Payload>;
  /**
   * SPEC §10.3 DEC-G: choose the owner principal for scoped webhook writes. A provider payload
   * field is not authority unless handler code derives and validates this id before calling actAs.
   */
  actAs(principalId: string): WebhookPrincipalWriteScope<Tx>;
  /** SPEC §10.3 DEC-G: audited cross-owner write posture for genuine system webhook work. */
  declareSystemWrite(reason: string): WebhookPrincipalWriteScope<Tx>;
  rawBody: Uint8Array;
  recordChange<const DomainKey extends WebhookDeclaredWriteKey<Writes>, ChangeInput = Input>(
    domain: Domain<DomainKey>,
    options?: WebhookChangeOptions<ChangeInput>,
  ): ChangeRecord<DomainKey, ChangeInput | Input>;
  request: EndpointRequest;
  runMutation<const Mutation extends WebhookRunnableMutation<any>>(
    definition: Mutation,
    input: WebhookRunnableMutationInput<Mutation>,
  ): Promise<unknown>;
  tx: WebhookTxDb<Tx>;
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

interface WebhookDefinitionBase<
  InputSchema extends Schema<unknown>,
  Value,
  Tx,
  Writes extends WebhookDeclaredWrites | undefined,
> {
  access?: AccessDecision;
  handler: (
    input: WebhookInputFor<InputSchema>,
    context: WebhookHandlerContext<WebhookInputFor<InputSchema>, Tx, Writes>,
  ) => Promise<Value | WebhookFail> | (Value | WebhookFail);
  idempotency?: (input: WebhookInputFor<InputSchema>) => string | undefined;
  input: InputSchema;
  replayStore?: WebhookReplayStore;
  transaction?: <Result>(
    context: WebhookTransactionContext<WebhookInputFor<InputSchema>>,
    run: (tx: Tx) => Promise<Result>,
  ) => Promise<Result>;
  /**
   * Static write domains this webhook may emit through `context.recordChange(...)`.
   * Runtime `recordChange` still emits the exact `{ domain, keys, input }` records; this
   * declaration lets `kovo explain --endpoints` print the webhook write chain without executing
   * provider traffic (SPEC §11.4).
   */
  writes?: Writes;
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
  Writes extends WebhookDeclaredWrites | undefined = undefined,
> = WebhookDefinitionBase<InputSchema, Value, Tx, Writes> &
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
  Writes extends WebhookDeclaredWrites | undefined = WebhookDeclaredWrites,
> extends EndpointDeclaration<Path, 'POST', 'exact'> {
  access?: AccessDecision;
  name: Name;
  webhook: true;
  webhookDefinition: WebhookDefinition<InputSchema, Value, Tx, Writes>;
}

export interface WebhookRunResult<Input = unknown, Value = unknown> {
  changes: readonly ChangeRecord<string, Input>[];
  replayed: boolean;
  response: Response;
  value?: Value;
}

/**
 * Create an in-memory webhook replay store for local development and tests.
 *
 * The store implements SPEC §10.3's reservation shape: `reserve()` atomically claims
 * `(webhook, provider-event-id)`, concurrent `get()` calls wait for the committed response, and
 * `abort()` releases a failed in-flight reservation so the provider can retry.
 */
export function createMemoryWebhookReplayStore(): WebhookReplayStore {
  const responses = new Map<
    string,
    | {
        pending: Promise<WebhookWireResponse>;
        reject(reason?: unknown): void;
        resolve(response: WebhookWireResponse): void;
      }
    | { response: WebhookWireResponse }
  >();

  return {
    get(scope, idem) {
      const record = responses.get(webhookReplayKey(scope, idem));
      if (record === undefined) return undefined;
      if ('pending' in record) return record.pending;
      return record.response;
    },
    reserve(scope, idem) {
      const key = webhookReplayKey(scope, idem);
      if (responses.has(key)) return undefined;

      let resolvePending: (response: WebhookWireResponse) => void = () => undefined;
      let rejectPending: (reason?: unknown) => void = () => undefined;
      const pending = new Promise<WebhookWireResponse>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      pending.catch(() => undefined);
      const record = {
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      responses.set(key, record);

      return {
        abort() {
          if (responses.get(key) === record) responses.delete(key);
          rejectPending(new Error('Webhook replay reservation aborted.'));
        },
        commit(response: WebhookWireResponse) {
          responses.set(key, { response });
          resolvePending(response);
        },
      };
    },
    set(scope, idem, response) {
      const key = webhookReplayKey(scope, idem);
      const existing = responses.get(key);
      responses.set(key, { response });
      if (existing && 'pending' in existing) existing.resolve(response);
    },
  };
}

/**
 * Declare a webhook endpoint: a path-first POST receiver that verifies the raw
 * payload signature before parsing input, then runs a handler that can record
 * domain changes and is idempotent by construction. Until compiler-derived
 * export identities are available, the registry/replay name is derived from the
 * declared path. Pass a `WebhookVerifier` built from generic helpers such as
 * `hmacSignature`, or `verify: 'none'` with a justification (SPEC §9.1).
 *
 * @param path - The webhook receiver path.
 * @param definition - The `verify`, `input` schema, and `handler` (plus optional idempotency/transaction).
 * @returns A `WebhookDeclaration` (a verified `EndpointDeclaration`).
 * @example
 * import { domain, webhook, s } from '@kovojs/server';
 *
 * const order = domain('order');
 *
 * export const orderPaid = webhook('/webhooks/order-paid', {
 *   verify: 'none',
 *   verifyJustification: 'internal test fixture',
 *   input: s.object({ orderId: s.string() }),
 *   writes: [order],
 *   handler(input, context) {
 *     return { changes: [context.recordChange(order, { keys: [input.orderId] })] };
 *   },
 * });
 */
export function webhook<
  const Path extends string,
  InputSchema extends Schema<unknown>,
  Value = unknown,
  Tx = unknown,
  const Writes extends WebhookDeclaredWrites | undefined = undefined,
>(
  path: Path,
  definition: WebhookDefinition<InputSchema, Value, Tx, Writes>,
): WebhookDeclaration<Path, Path, InputSchema, Value, Tx, Writes> {
  const name = webhookNameFromPath(path);
  assertWebhookWritePosture(name, definition);
  let declaration: WebhookDeclaration<Path, Path, InputSchema, Value, Tx, Writes>;
  const handler = async (request: EndpointRequest): Promise<Response> =>
    (await runWebhook(declaration, request)).response;

  declaration = {
    ...(definition.access === undefined
      ? definition.verify === 'none'
        ? {}
        : { access: verifiedAccess }
      : { access: snapshotAccessDecision(definition.access) }),
    auth: webhookAuth(definition),
    csrf: {
      exempt: true,
      justification: webhookCsrfJustification(name, definition),
    },
    handler,
    method: 'POST' satisfies EndpointMethod,
    mount: 'exact' satisfies EndpointMount,
    name,
    path,
    reason: `webhook:${name}`,
    response: {
      appOwnedSafety: false,
      body: 'text',
      cache: 'no-store',
      reservedHeaders: WEBHOOK_RESPONSE_RESERVED_HEADERS,
    },
    webhook: true,
    webhookDefinition: definition,
  } satisfies WebhookDeclaration<Path, Path, InputSchema, Value, Tx, Writes>;

  return declaration;
}

/**
 * @internal Compiler-emitted/generated ABI for SPEC §4.1 source-derived webhook identities.
 *
 * Runtime-only `webhook('/path', { ... })` can know the public receiver path but not the source
 * module path or exported binding. Generated modules call this before `createApp()` consumes the
 * endpoint so audit records and idempotency replay scopes use the derived registry identity while
 * `path` remains the public HTTP address.
 */
export function assignDerivedWebhookName<
  const Name extends string,
  const Path extends string,
  InputSchema extends Schema<unknown>,
  Value,
  Tx,
  Writes extends WebhookDeclaredWrites | undefined,
>(
  declaration: WebhookDeclaration<string, Path, InputSchema, Value, Tx, Writes>,
  name: Name,
): WebhookDeclaration<Name, Path, InputSchema, Value, Tx, Writes> {
  if (!name) {
    throw new TypeError('assignDerivedWebhookName() requires a non-empty webhook name.');
  }
  declaration.name = name;
  declaration.reason = `webhook:${name}`;
  declaration.csrf = {
    exempt: true,
    justification: webhookCsrfJustification(name, declaration.webhookDefinition),
  };
  return declaration as WebhookDeclaration<Name, Path, InputSchema, Value, Tx, Writes>;
}

function webhookNameFromPath<const Path extends string>(path: Path): Path {
  return path;
}

export async function runWebhook<
  const Name extends string,
  const Path extends string,
  InputSchema extends Schema<unknown>,
  Value,
  Tx,
  Writes extends WebhookDeclaredWrites | undefined,
>(
  declaration: WebhookDeclaration<Name, Path, InputSchema, Value, Tx, Writes>,
  request: Request,
  options: RunWebhookOptions = {},
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

  // H8 (SPEC §9.1:875 / §10.3:1151): defense-in-depth dispatch floor mirroring the
  // declaration-time `assertWebhookWritePosture` gate in webhook(). A webhook that exposes
  // a writable transaction MUST carry idempotency()+replayStore. Fail closed BEFORE opening
  // the transaction (not at the old post-commit posture check) so a misconfigured or
  // hand-built declaration can never commit a write a provider retry would re-execute.
  if (
    declaration.webhookDefinition.transaction !== undefined &&
    !webhookReplayPostureSatisfied(declaration.webhookDefinition)
  ) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
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

  // H9 (SPEC §10.3:1151): obtain the atomic idempotency reservation BEFORE running the
  // handler, mirroring the hardened mutation path (replay.ts reserveMutationReplayBeforeRun).
  // A single non-blocking reserve()→get() attempt is unsound on a durable cross-instance
  // store (Postgres `INSERT ... ON CONFLICT DO NOTHING` + `SELECT`): get() legitimately
  // returns undefined for a reserved-but-uncommitted row, so falling through to execute
  // double-runs the handler. Re-reserve, and if a reservation still cannot be obtained and
  // no committed response exists, FAIL CLOSED so the provider retries instead of executing.
  const reserveOutcome = await reserveReplayBeforeRun({
    idem,
    scope: replayScope,
    store: declaration.webhookDefinition.replayStore,
  });
  if (reserveOutcome.kind === 'replayed') {
    return {
      changes: [],
      replayed: true,
      response: responseFromWire(reserveOutcome.response),
    };
  }
  if (reserveOutcome.kind === 'unavailable') {
    return {
      changes: [],
      replayed: false,
      response: webhookRetryResponse(),
    };
  }
  const reservation = reserveOutcome.kind === 'reserved' ? reserveOutcome.reservation : undefined;

  const changes: ChangeRecord<string, WebhookInputFor<InputSchema>>[] = [];
  try {
    const runHandler = async (tx: Tx): Promise<Value> => {
      const managedTx = webhookManagedTransactionDb(tx);
      const context = webhookHandlerContext(
        declaration.name,
        input,
        endpointRequest,
        rawBody,
        changes,
        declaration.webhookDefinition.writes,
        managedTx,
        async (definition, mutationInput, principalPosture) => {
          if (reserveOutcome.kind !== 'reserved' && reserveOutcome.kind !== 'disabled') {
            throw new Error('Webhook replay reservation is unavailable.');
          }
          if (!idemActive || declaration.webhookDefinition.replayStore === undefined) {
            throw new Error(
              `Webhook "${declaration.name}" called runMutation(${definition.key}) without an active idempotency replay reservation.`,
            );
          }

          const mutationRequest = webhookMutationRequest(endpointRequest, managedTx);
          const result = await runMutation(definition as never, mutationInput, mutationRequest, {
            ...options.mutationOptions,
            csrf: false,
            principalPosture,
          } as never);
          if (!result.ok) {
            throw new Error(
              `Webhook runMutation(${definition.key}) failed with ${result.status} ${result.error.code}.`,
            );
          }
          changes.push(
            ...(result.changes as readonly ChangeRecord<string, WebhookInputFor<InputSchema>>[]),
          );
          return result.value;
        },
      );
      const value = await declaration.webhookDefinition.handler(input, context);
      if (isWebhookFail(value)) throw new WebhookRollback(value);
      return value as Value;
    };
    const value = declaration.webhookDefinition.transaction
      ? await declaration.webhookDefinition.transaction(
          { input, rawBody, request: endpointRequest },
          runHandler,
        )
      : await runHandler(undefined as Tx);
    assertWebhookReplayPosture(declaration, changes);

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

/**
 * Post-handler backstop (SPEC §9.1:875 / §10.3:1151) for the *no-transaction* path: a
 * webhook with no framework `transaction` wrapper exposes no writable tx, so the
 * declaration/dispatch write-posture floor (`assertWebhookWritePosture`) does not require
 * idempotency posture for it — yet if such a handler still records a domain change (via
 * `recordChange`, its only positive write signal absent a framework commit boundary), that
 * change MUST be idempotency-protected too. This is NOT the primary write gate (bugz H8:
 * keying solely on `changes.length` let a tx-direct write that never recorded a change
 * double-execute); tx-exposing webhooks are gated *before* commit. This assertion only
 * covers the recordChange-without-posture developer error the runtime can still observe.
 */
function assertWebhookReplayPosture(
  declaration: {
    name: string;
    webhookDefinition: {
      idempotency?: unknown;
      replayStore?: unknown;
    };
  },
  changes: readonly ChangeRecord[],
): void {
  if (changes.length === 0) return;
  if (webhookReplayPostureSatisfied(declaration.webhookDefinition)) return;
  throw new Error(
    `Webhook "${declaration.name}" recorded write changes without idempotency and replayStore posture.`,
  );
}

/**
 * H8 (SPEC §9.1 / §10.3): a webhook that exposes a writable transaction or declares
 * `writes` for the §11.4 endpoint audit CAN write Kovo-owned data. The atomic-reservation
 * replay floor ("a redelivered event id ... must not re-execute the handler") is therefore
 * mandatory *by construction* for any declared write-capable webhook — not conditional on
 * whether the handler later calls `recordChange()`. Keying the floor on the post-commit
 * recordChange count let a tx-direct / outbox write that never recorded a change double-execute
 * on provider retry. Fail closed at declaration so a write-capable webhook without
 * idempotency()+replayStore cannot exist (technical-preview stronger default: no opt-out,
 * no compatibility mode).
 */
function assertWebhookWritePosture(
  name: string,
  definition: {
    idempotency?: unknown;
    replayStore?: unknown;
    transaction?: unknown;
    writes?: readonly unknown[] | undefined;
  },
): void {
  const declaresWrites = (definition.writes?.length ?? 0) > 0;
  if (definition.transaction === undefined && !declaresWrites) return;
  if (webhookReplayPostureSatisfied(definition)) return;
  const writeSignal =
    definition.transaction === undefined
      ? 'declares writable domains'
      : 'exposes a writable transaction';
  throw new Error(
    `Webhook "${name}" ${writeSignal} but does not declare both idempotency() ` +
      `and replayStore. SPEC §10.3 requires an atomic idempotency reservation for any webhook ` +
      `handler that can write, so a redelivered event never re-executes it.`,
  );
}

function webhookReplayPostureSatisfied(definition: {
  idempotency?: unknown;
  replayStore?: unknown;
}): boolean {
  return definition.idempotency !== undefined && definition.replayStore !== undefined;
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
  const result = parseUntrustedJsonBodyBytes(rawBody);
  return result.ok ? result : { message: 'Invalid JSON webhook body', ok: false };
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
    const looseInput = revealUntrustedRequestValue(rawInput, 'verified loose webhook input');
    const value =
      isPlainRecord(looseInput) && isPlainRecord(parsed) ? { ...looseInput, ...parsed } : parsed;

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
  name: string,
  input: Input,
  request: EndpointRequest,
  rawBody: Uint8Array,
  changes: ChangeRecord<string, Input>[],
  declaredWrites: readonly Domain[] | undefined,
  managedTx: Tx,
  runMutationFromWebhook: (
    definition: Parameters<
      WebhookHandlerContext<Input, Tx, WebhookDeclaredWrites>['runMutation']
    >[0],
    input: Parameters<WebhookHandlerContext<Input, Tx, WebhookDeclaredWrites>['runMutation']>[1],
    posture: NonRequestPrincipalPosture,
  ) => Promise<unknown>,
): WebhookHandlerContext<Input, Tx, WebhookDeclaredWrites> {
  const writeScope = (posture: NonRequestPrincipalPosture): WebhookPrincipalWriteScope<Tx> => ({
    runMutation: (definition, mutationInput) =>
      runMutationFromWebhook(definition, mutationInput, posture),
    tx: managedTx as WebhookTxDb<Tx>,
  });
  return {
    actAs(principalId: string) {
      return writeScope(
        actAsNonRequestPrincipal(principalId, webhookPrincipalAudit(name, 'write')),
      );
    },
    declareSystemWrite(reason: string) {
      return writeScope(declareSystemPrincipal(reason, webhookPrincipalAudit(name, 'write')));
    },
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
      assertDeclaredWebhookChangeDomain(domain, declaredWrites);
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
    runMutation: async () => {
      throw missingWebhookPrincipalPostureError(name, 'write');
    },
    tx: deniedWebhookTx(name) as WebhookTxDb<Tx>,
  };
}

function webhookPrincipalAudit(
  name: string,
  operation: PrincipalAccessOperation,
): Parameters<typeof actAsNonRequestPrincipal>[1] {
  return {
    ingress: 'webhook',
    operation,
    surface: name,
  };
}

function missingWebhookPrincipalPostureError(
  name: string,
  operation: PrincipalAccessOperation,
): Error {
  return new Error(
    `Webhook "${name}" attempted ${operation} owner-table access without actAs(id) or declareSystemWrite(reason). SPEC §10.3 DEC-G requires an explicit non-request principal posture.`,
  );
}

function deniedWebhookTx(name: string): unknown {
  return new Proxy(Object.create(null), {
    get() {
      throw missingWebhookPrincipalPostureError(name, 'write');
    },
    has() {
      return false;
    },
    ownKeys() {
      return [];
    },
  });
}

function webhookMutationRequest<Tx>(request: EndpointRequest, tx: Tx): EndpointRequest {
  if (tx === undefined) return request;
  return new Proxy(request, {
    get(target, property) {
      if (property === 'db') return tx;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === 'db') {
        return {
          configurable: true,
          enumerable: true,
          value: tx,
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === 'db' || property in target;
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return keys.includes('db') ? keys : [...keys, 'db'];
    },
  }) as EndpointRequest;
}

function webhookManagedTransactionDb<Tx>(tx: Tx): Tx {
  return wrapManagedDbForSqlSafety(
    tx,
    undefined,
    managedSqlExecutionPolicy({ capability: 'write' }),
  );
}

function assertDeclaredWebhookChangeDomain(
  domain: Domain,
  declaredWrites: readonly Domain[] | undefined,
): void {
  if (declaredWrites?.some((declared) => declared.key === domain.key)) return;
  const declared = (declaredWrites ?? []).map((write) => write.key).join(', ') || 'none';
  throw new Error(
    `Webhook recordChange("${domain.key}") is outside declared writes (${declared}). ` +
      `SPEC §9.1 requires webhook changes to be declared so kovo explain --endpoints ` +
      `cannot under-report machine-ingress writes.`,
  );
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
    headers: webhookResponseHeaders({
      contentType: 'application/json; charset=utf-8',
      idem,
      extra: retryAfterHeaders(failure),
    }),
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

type WebhookResponseContentType = 'application/json; charset=utf-8' | 'text/plain; charset=utf-8';

function webhookResponse(
  status: 400 | 401 | 422 | 429 | 500,
  body: string,
  options: {
    contentType?: WebhookResponseContentType;
    headers?: ResponseHeaders | undefined;
  } = {},
): Response {
  return responseFromWire({
    body,
    headers: webhookResponseHeaders({
      contentType: options.contentType ?? 'text/plain; charset=utf-8',
      extra: options.headers,
    }),
    status,
  });
}

/** Seconds hinted to the provider when an idempotency reservation is momentarily unobtainable. */
const WEBHOOK_REPLAY_RETRY_AFTER_SECONDS = 1;

/**
 * H9 (SPEC §10.3:1151): the fail-closed answer when an atomic idempotency reservation cannot be
 * obtained and no committed response exists (a concurrent in-flight delivery on a durable store).
 * A 429 with `Retry-After` drives provider redelivery so the handler runs exactly once, instead
 * of executing here without the reservation the spec requires.
 */
function webhookRetryResponse(): Response {
  return webhookResponse(429, 'Webhook processing in progress; retry shortly.', {
    headers: { 'Retry-After': String(WEBHOOK_REPLAY_RETRY_AFTER_SECONDS) },
  });
}

function webhookJsonResponse(status: 422, body: unknown): Response {
  return webhookResponse(status, JSON.stringify(body), {
    contentType: 'application/json; charset=utf-8',
  });
}

function webhookSuccessHeaders(
  changes: readonly ChangeRecord[],
  idem: string | undefined,
): ResponseHeaders {
  return webhookResponseHeaders({
    changes,
    contentType: 'text/plain; charset=utf-8',
    idem,
  });
}

function webhookResponseHeaders(options: {
  changes?: readonly ChangeRecord[] | undefined;
  contentType: WebhookResponseContentType;
  extra?: ResponseHeaders | undefined;
  idem?: string | undefined;
}): ResponseHeaders {
  return mergeResponseHeaders(
    {
      'Cache-Control': 'private, no-store',
      'Content-Type': options.contentType,
    },
    options.idem === undefined ? undefined : { 'Kovo-Idem': options.idem },
    options.changes === undefined || options.changes.length === 0
      ? undefined
      : { 'Kovo-Changes': webhookChangeHeader(options.changes) },
    options.extra,
  );
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

function webhookReplayKey(scope: string, idem: string): string {
  return `${scope}\0${idem}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

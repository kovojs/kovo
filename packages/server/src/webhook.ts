import type {
  CustomWebhookVerifier,
  WebhookVerificationRequest,
  WebhookVerifier,
} from '@kovojs/core';
import {
  hasFrameworkDurableReplayStoreReceipt,
  propagateFrameworkDurableReplayStoreReceipt,
} from '@kovojs/core/internal/security-markers';
import { isFrameworkHmacSignatureVerifier } from '@kovojs/core/internal/verifier';
import { requestVerifierInput } from './app-load-shed.js';
import { snapshotAuditJustification } from './audit-justification.js';
import { resolveBootMode } from './env.js';
import { frameworkEgressFetch } from './egress.js';
import {
  actAsNonRequestPrincipal,
  declareSystemPrincipal,
  type NonRequestPrincipalPosture,
  type PrincipalAccessOperation,
} from './auth-principal.js';
import type { ChangeRecord } from './change-record.js';
import {
  assertUnambiguousAccessDeclaration,
  pinAccessDecision,
  snapshotAccessDecision,
  verifiedAccess,
  type AccessDecision,
} from './access.js';
import type { Domain } from './domain.js';
import {
  isExactlyOnceAdapterSettlementAmbiguousError,
  runExactlyOnceAdapter,
} from './exactly-once-continuation.js';
import { runMutation, type RunMutationOptions } from './mutation.js';
import {
  endpointRequestWithoutSession,
  pinEndpointAuth,
  pinEndpointSelfVerifyingAuth,
  type EndpointDeclaration,
  type EndpointAuthDeclaration,
  type EndpointMethod,
  type EndpointMount,
  type EndpointRequest,
} from './endpoint.js';
import { isFrameworkManagedDbProvider } from './guards.js';
import {
  mergeResponseHeaders,
  retryAfterHeaders,
  serverResponseToWebResponse,
  type ResponseHeaders,
  type ServerResponseBase,
} from './response.js';
import {
  securityArrayJoin,
  securityJsonStringify,
  securityStringCharCodeAt,
  securityUint8ArraySlice,
} from './response-security-intrinsics.js';
import { isSchemaValidationError, parseSchemaAsync, snapshotSchemaForRuntime } from './schema.js';
import type { InferSchema, Schema, ValidationIssue } from './schema.js';
import { managedSqlExecutionPolicy, wrapManagedDbForSqlSafety } from './sql-safe-handle.js';
import { reserveReplayBeforeRun } from './replay.js';
import {
  requestStateExactCompositeKey,
  requestStateIgnorePromiseRejection,
  requestStateIsSafeInteger,
  requestStateNow,
} from './request-state-intrinsics.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  witnessCreateNullRecord,
  createWitnessWeakSet,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessIsArray,
  witnessMapDelete,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessMapSize,
  witnessObjectIs,
  witnessReflectApply,
  witnessReflectGet,
  witnessOwnKeys,
  witnessProxy,
  witnessWeakSetAdd,
  witnessWeakSetHas,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import {
  parseUntrustedJsonBodyBytes,
  revealUntrustedRequestValue,
} from './untrusted-request-body.js';

const WEBHOOK_RESPONSE_RESERVED_HEADERS = ['Kovo-*'] as const;
const WEBHOOK_OBJECT_PROTOTYPE = witnessGetPrototypeOf({});
const webhookFailureOutcomes = createWitnessWeakSet<object>();
const webhookRollbackOutcomes = createWitnessWeakSet<object>();
const memoryWebhookReplayStores = createWitnessWeakSet<object>();
const webhookReplayIdentities = createWitnessWeakMap<object, WebhookReplayIdentity>();

/** @internal Exact authenticated-event replay horizon shared with durable stores. */
export const WEBHOOK_REPLAY_HORIZON_MS = 30 * 24 * 60 * 60_000;
const WEBHOOK_REPLAY_MAX_FUTURE_SKEW_MS = 5 * 60_000;

declare const webhookTxDbBrand: unique symbol;
declare const webhookReplayIdentityBrand: unique symbol;

/** HTTP statuses a typed webhook failure response may carry (SPEC §9.1). */
export type WebhookFailureStatus = 400 | 401 | 422 | 429 | 500;

/** HTTP status a successful webhook replay response stores and replays (SPEC §9.1). */
export type WebhookSuccessStatus = 200;

/** HTTP status union accepted by webhook replay wire responses (SPEC §9.1 / §10.3). */
export type WebhookResponseStatus = WebhookFailureStatus | WebhookSuccessStatus;

/**
 * Framework-proven replay identity for one authenticated provider event (SPEC §9.1/§10.3).
 *
 * Construct with {@link webhookReplayIdentity} from the provider event key and the event's own
 * authenticated occurrence timestamp. The immutable facts are passed intact to replay stores so
 * committed truth can retire at the fixed 30-day horizon without ever expiring an ambiguous
 * in-flight claim. The private brand is author-time ergonomics only; runtime provenance is held in
 * a module-private WeakMap, so casts and structural clones are rejected.
 */
export interface WebhookReplayIdentity {
  /** Exclusive replay-retention deadline derived from `occurredAtMs` by the framework. */
  readonly expiresAtMs: number;
  /** Provider event key, scoped by the source-derived webhook identity in the replay store. */
  readonly key: string;
  /** Authenticated event occurrence time in Unix epoch milliseconds. */
  readonly occurredAtMs: number;
  readonly [webhookReplayIdentityBrand]: 'webhook-replay-identity';
}

/**
 * Create an opaque replay identity from authenticated provider payload fields (SPEC §9.1/§10.3).
 *
 * `occurredAtMs` must come from the verified event payload, never local receipt time or an HMAC
 * delivery timestamp. Kovo validates the fixed 30-day horizon and five-minute future-skew ceiling
 * after verification and parsing, before any replay-store call or handler execution.
 */
export function webhookReplayIdentity(key: string, occurredAtMs: number): WebhookReplayIdentity {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1_024) {
    throw new TypeError(
      'webhookReplayIdentity() key must contain 1..1024 visible ASCII characters.',
    );
  }
  for (let index = 0; index < key.length; index += 1) {
    const code = securityStringCharCodeAt(key, index);
    if (code < 0x21 || code > 0x7e) {
      throw new TypeError(
        'webhookReplayIdentity() key must contain 1..1024 visible ASCII characters.',
      );
    }
  }
  if (!requestStateIsSafeInteger(occurredAtMs)) {
    throw new TypeError('webhookReplayIdentity() occurredAtMs must be a safe integer timestamp.');
  }
  const expiresAtMs = occurredAtMs + WEBHOOK_REPLAY_HORIZON_MS;
  if (!requestStateIsSafeInteger(expiresAtMs)) {
    throw new TypeError(
      'webhookReplayIdentity() occurredAtMs exceeds the supported timestamp range.',
    );
  }

  const identity = witnessCreateNullRecord<unknown>() as Record<
    'expiresAtMs' | 'key' | 'occurredAtMs',
    unknown
  >;
  witnessDefineProperty(identity, 'expiresAtMs', {
    configurable: false,
    enumerable: true,
    value: expiresAtMs,
    writable: false,
  });
  witnessDefineProperty(identity, 'key', {
    configurable: false,
    enumerable: true,
    value: key,
    writable: false,
  });
  witnessDefineProperty(identity, 'occurredAtMs', {
    configurable: false,
    enumerable: true,
    value: occurredAtMs,
    writable: false,
  });
  const closed = witnessFreeze(identity) as unknown as WebhookReplayIdentity;
  witnessWeakMapSet(webhookReplayIdentities, closed, closed);
  return closed;
}

/**
 * Recover canonical replay facts only from a framework-minted identity.
 *
 * @internal Package-private adapter boundary; deliberately not re-exported from the public root.
 */
export function snapshotWebhookReplayIdentity(
  source: unknown,
  label: string,
): WebhookReplayIdentity {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    throw new TypeError(`${label} must come from webhookReplayIdentity().`);
  }
  const identity = witnessWeakMapGet(webhookReplayIdentities, source);
  if (identity === undefined) {
    throw new TypeError(`${label} must come from webhookReplayIdentity().`);
  }
  return identity;
}

/** @internal Shared durable/volatile store signal mapped to a sanitized webhook 422. */
export class WebhookReplayIdentityConflictError extends Error {
  constructor() {
    super('Webhook provider event key was reused with a different authenticated occurrence.');
    this.name = 'WebhookReplayIdentityConflictError';
  }
}

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

/** Atomic idempotency store used by writable webhooks to reserve and replay provider events. */
export interface WebhookReplayStore {
  get(
    scope: string,
    identity: WebhookReplayIdentity,
  ): Promise<WebhookWireResponse | undefined> | WebhookWireResponse | undefined;
  reserve(
    scope: string,
    identity: WebhookReplayIdentity,
  ): Promise<WebhookReplayReservation | undefined> | WebhookReplayReservation | undefined;
  set(
    scope: string,
    identity: WebhookReplayIdentity,
    response: WebhookWireResponse,
  ): Promise<void> | void;
}

/** A held webhook replay reservation, committed with the final response or aborted on failure. */
export interface WebhookReplayReservation {
  /** Release a pending reservation without committing, so a retry can re-run the handler (A4). */
  abort?(): Promise<void> | void;
  commit(response: WebhookWireResponse): Promise<void> | void;
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
  /**
   * Safe app lifecycle adapters forwarded into composed mutations. Internal mutation gate flags,
   * session authority, CSRF posture, and caller-supplied principal posture are deliberately absent:
   * webhook composition derives those from its verified replay reservation and explicit
   * `actAs(...)`/`declareSystemWrite(...)` branch.
   */
  mutationOptions?: Pick<
    RunMutationOptions<Request>,
    'clientIp' | 'db' | 'onError' | 'taskScheduler'
  >;
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
  /**
   * Framework-owned positive HTTP egress capability (SPEC §6.6). Every initial and redirect
   * origin must be declared by `egress.allowDestinations`; the resolved-IP floor still applies.
   */
  readonly fetch: typeof globalThis.fetch;
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
  idempotency?: (input: WebhookInputFor<InputSchema>) => WebhookReplayIdentity | undefined;
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
 * The store implements SPEC §10.3's reservation shape: `reserve()` atomically claims one
 * authenticated provider-event identity, concurrent `get()` calls wait for the committed response,
 * committed truth retires at its exact event horizon, and pending truth never auto-expires.
 */
export function createMemoryWebhookReplayStore(
  options: { maxEntries?: number; maxPending?: number } = {},
): WebhookReplayStore {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('createMemoryWebhookReplayStore options must be an object.');
  }
  assertExactWebhookOptionKeys(
    options,
    ['maxEntries', 'maxPending'],
    'createMemoryWebhookReplayStore options',
  );
  const configuredMaxEntries = webhookReplayNumberOption(options, 'maxEntries');
  const configuredMaxPending = webhookReplayNumberOption(options, 'maxPending');
  const maxEntries = configuredMaxEntries ?? 1_000;
  const maxPending = configuredMaxPending ?? maxEntries;
  assertWebhookReplayStoreOptions({ maxEntries, maxPending });
  const responses = createWitnessMap<string, WebhookReplayRecord>();
  let pendingCount = 0;
  // Volatile stores lose this floor on restart by design. Within one store lifetime it prevents
  // wall-clock rollback from reopening canonical identities whose truth was already reclaimed.
  let reclaimedThroughMs = -9_007_199_254_740_991;

  const advanceReclamationWatermark = (now: number): void => {
    if (now > reclaimedThroughMs) reclaimedThroughMs = now;
  };

  const retireExpiredCommitted = (now: number): void => {
    let retired = false;
    witnessMapForEach(responses, (record, key) => {
      if (record.kind === 'committed' && record.expiresAtMs <= now) {
        witnessMapDelete(responses, key);
        retired = true;
      }
    });
    if (retired) advanceReclamationWatermark(now);
  };

  const store: WebhookReplayStore = {
    get(scope, identitySource) {
      const identity = snapshotWebhookReplayIdentity(
        identitySource,
        'WebhookReplayStore.get() identity',
      );
      const key = webhookReplayKey(scope, identity.key);
      const record = witnessMapGet(responses, key);
      if (record === undefined) return undefined;
      const now = requestStateNow();
      if (record.kind === 'committed' && record.expiresAtMs <= now) {
        witnessMapDelete(responses, key);
        advanceReclamationWatermark(now);
        return undefined;
      }
      assertWebhookReplayIdentityMatches(record, identity);
      if (record.kind === 'pending') return record.pending;
      return record.response;
    },
    reserve(scope, identitySource) {
      const identity = snapshotWebhookReplayIdentity(
        identitySource,
        'WebhookReplayStore.reserve() identity',
      );
      const now = requestStateNow();
      retireExpiredCommitted(now);
      const key = webhookReplayKey(scope, identity.key);
      const existing = witnessMapGet(responses, key);
      if (existing !== undefined) {
        assertWebhookReplayIdentityMatches(existing, identity);
        return undefined;
      }
      // SPEC §9.1/§10.3: the request-level check is intentionally not the only clock
      // boundary. Verification/parsing may cross the authenticated event horizon; never admit
      // a fresh claim after that crossing. An already-retained pending claim was handled above
      // and remains joinable because pending ambiguity must never expire automatically.
      if (identity.expiresAtMs <= now || identity.expiresAtMs <= reclaimedThroughMs) {
        return undefined;
      }
      // SPEC §10.3 requires every duplicate to replay, so capacity may refuse unseen work but
      // must never evict a live committed event or any ambiguous pending claim.
      if (witnessMapSize(responses) >= maxEntries || pendingCount >= maxPending) return undefined;

      let resolvePending: (response: WebhookWireResponse) => void = () => undefined;
      let rejectPending: (reason?: unknown) => void = () => undefined;
      const pending = new Promise<WebhookWireResponse>((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      requestStateIgnorePromiseRejection(pending);
      const generation = {};
      const record = {
        expiresAtMs: identity.expiresAtMs,
        generation,
        kind: 'pending' as const,
        occurredAtMs: identity.occurredAtMs,
        pending,
        reject: rejectPending,
        resolve: resolvePending,
      };
      witnessMapSet(responses, key, record);
      pendingCount += 1;

      return {
        abort() {
          const current = witnessMapGet(responses, key);
          if (
            current !== record ||
            current.kind !== 'pending' ||
            current.generation !== generation
          ) {
            return;
          }
          witnessMapDelete(responses, key);
          pendingCount -= 1;
          rejectPending(new Error('Webhook replay reservation aborted.'));
        },
        commit(response: WebhookWireResponse) {
          const current = witnessMapGet(responses, key);
          if (
            current !== record ||
            current.kind !== 'pending' ||
            current.generation !== generation
          ) {
            return;
          }
          // Settlement after the authenticated horizon cannot become immediately removable
          // committed truth. Leave the claim pending/fail-closed for operator reconciliation.
          if (
            identity.expiresAtMs <= requestStateNow() ||
            identity.expiresAtMs <= reclaimedThroughMs
          ) {
            throw new Error('Webhook replay event horizon elapsed before reservation settlement.');
          }
          pendingCount -= 1;
          witnessMapSet(responses, key, {
            expiresAtMs: identity.expiresAtMs,
            kind: 'committed',
            occurredAtMs: identity.occurredAtMs,
            response,
          });
          resolvePending(response);
        },
      };
    },
    set(scope, identitySource, response) {
      const identity = snapshotWebhookReplayIdentity(
        identitySource,
        'WebhookReplayStore.set() identity',
      );
      const now = requestStateNow();
      retireExpiredCommitted(now);
      const key = webhookReplayKey(scope, identity.key);
      const existing = witnessMapGet(responses, key);
      if (existing !== undefined) assertWebhookReplayIdentityMatches(existing, identity);
      if (identity.expiresAtMs <= now || identity.expiresAtMs <= reclaimedThroughMs) {
        throw new Error('Webhook replay event horizon elapsed before response settlement.');
      }
      if (existing === undefined && witnessMapSize(responses) >= maxEntries) {
        throw new Error('Webhook replay store is saturated; cannot admit a new event id.');
      }
      if (existing?.kind === 'pending') {
        pendingCount -= 1;
      }
      witnessMapSet(responses, key, {
        expiresAtMs: identity.expiresAtMs,
        kind: 'committed',
        occurredAtMs: identity.occurredAtMs,
        response,
      });
      if (existing?.kind === 'pending') existing.resolve(response);
    },
  };
  witnessWeakSetAdd(memoryWebhookReplayStores, store);
  return store;
}

/** @internal True only for framework-created volatile webhook replay stores and their snapshots. */
export function isMemoryWebhookReplayStore(source: unknown): boolean {
  return (
    (typeof source === 'object' || typeof source === 'function') &&
    source !== null &&
    witnessWeakSetHas(memoryWebhookReplayStores, source)
  );
}

/** @internal True only for framework-authenticated durable webhook replay stores and snapshots. */
export function isDurableWebhookReplayStore(source: unknown): boolean {
  return hasFrameworkDurableReplayStoreReceipt(source, 'webhook');
}

function webhookReplayNumberOption(
  source: { maxEntries?: number; maxPending?: number },
  property: 'maxEntries' | 'maxPending',
): number | undefined {
  const value = stableOwnWebhookValue(
    source,
    property,
    `createMemoryWebhookReplayStore().${property}`,
    false,
  );
  if (value !== undefined && typeof value !== 'number') {
    throw new TypeError(`createMemoryWebhookReplayStore ${property} must be a number.`);
  }
  return value;
}

type WebhookReplayRecord =
  | {
      expiresAtMs: number;
      kind: 'committed';
      occurredAtMs: number;
      response: WebhookWireResponse;
    }
  | {
      expiresAtMs: number;
      generation: object;
      kind: 'pending';
      occurredAtMs: number;
      pending: Promise<WebhookWireResponse>;
      reject(reason?: unknown): void;
      resolve(response: WebhookWireResponse): void;
    };

function assertWebhookReplayIdentityMatches(
  record: Pick<WebhookReplayRecord, 'expiresAtMs' | 'occurredAtMs'>,
  identity: WebhookReplayIdentity,
): void {
  if (
    record.occurredAtMs !== identity.occurredAtMs ||
    record.expiresAtMs !== identity.expiresAtMs
  ) {
    throw new WebhookReplayIdentityConflictError();
  }
}

function assertWebhookReplayStoreOptions(options: {
  maxEntries: number;
  maxPending: number;
}): void {
  if (!requestStateIsSafeInteger(options.maxEntries) || options.maxEntries < 0) {
    throw new TypeError(
      'createMemoryWebhookReplayStore({ maxEntries }) must be a non-negative integer.',
    );
  }
  if (!requestStateIsSafeInteger(options.maxPending) || options.maxPending < 0) {
    throw new TypeError(
      'createMemoryWebhookReplayStore({ maxPending }) must be a non-negative integer.',
    );
  }
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
  const closedDefinition = snapshotWebhookDefinitionForDeclaration(definition);
  const name = webhookNameFromPath(path);
  assertWebhookWritePosture(name, closedDefinition);
  let declaration: WebhookDeclaration<Path, Path, InputSchema, Value, Tx, Writes>;
  const handler = async (request: EndpointRequest): Promise<Response> =>
    (await runWebhook(declaration, request)).response;

  const access =
    closedDefinition.access ?? (closedDefinition.verify === 'none' ? undefined : verifiedAccess);
  const auth = webhookAuth(closedDefinition);
  declaration = pinAccessDecision(
    {
      csrf: {
        exempt: true,
        justification: webhookCsrfJustification(name, closedDefinition),
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
      webhookDefinition: closedDefinition,
    } satisfies WebhookDeclaration<Path, Path, InputSchema, Value, Tx, Writes>,
    access,
  );
  witnessDefineProperty(declaration, 'webhookDefinition', {
    configurable: false,
    enumerable: true,
    value: closedDefinition,
    writable: false,
  });
  pinEndpointAuth(declaration, auth);
  if (closedDefinition.verify !== 'none') pinEndpointSelfVerifyingAuth(declaration);

  return declaration;
}

function snapshotWebhookDefinitionForDeclaration<
  InputSchema extends Schema<unknown>,
  Value,
  Tx,
  Writes extends WebhookDeclaredWrites | undefined,
>(
  source: WebhookDefinition<InputSchema, Value, Tx, Writes>,
): WebhookDefinition<InputSchema, Value, Tx, Writes> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('webhook() requires a stable own-data definition record.');
  }
  assertUnambiguousAccessDeclaration(source, 'webhook() definition', false);
  const verifySource = stableOwnWebhookValue(source, 'verify', 'webhook().verify');
  const verify = snapshotWebhookVerification(verifySource);
  const inputSource = stableOwnWebhookValue(source, 'input', 'webhook().input');
  const handler = stableOwnWebhookValue(source, 'handler', 'webhook().handler');
  const idempotency = stableOwnWebhookValue(source, 'idempotency', 'webhook().idempotency', false);
  const replayStoreSource = stableOwnWebhookValue(
    source,
    'replayStore',
    'webhook().replayStore',
    false,
  );
  const transaction = stableOwnWebhookValue(source, 'transaction', 'webhook().transaction', false);
  const writesSource = stableOwnWebhookValue(source, 'writes', 'webhook().writes', false);
  const accessSource = stableOwnWebhookValue(source, 'access', 'webhook().access', false);

  if (typeof handler !== 'function') throw new TypeError('webhook().handler must be a function.');
  if (idempotency !== undefined && typeof idempotency !== 'function') {
    throw new TypeError('webhook().idempotency must be a function.');
  }
  if (transaction !== undefined && typeof transaction !== 'function') {
    throw new TypeError('webhook().transaction must be a function.');
  }

  const input = snapshotSchemaForRuntime(inputSource as InputSchema, 'webhook().input');
  const replayStore =
    replayStoreSource === undefined
      ? undefined
      : snapshotWebhookReplayStore(replayStoreSource, 'webhook().replayStore');
  const writes =
    writesSource === undefined
      ? undefined
      : snapshotWebhookWrites(writesSource, 'webhook().writes');
  const needsReplayTruth =
    idempotency !== undefined || transaction !== undefined || (writes?.length ?? 0) > 0;
  if (
    resolveBootMode() === 'production' &&
    (replayStore !== undefined || needsReplayTruth) &&
    !isDurableWebhookReplayStore(replayStore)
  ) {
    throw new Error(
      'KV436: webhook() refused a missing, custom, or volatile memory replayStore in production; idempotent or write-capable webhooks require createPostgresAppRuntimeDb().webhookReplayStore so replay truth survives restart and replicas (SPEC §10.3).',
    );
  }
  const access = snapshotAccessDecision(accessSource as AccessDecision | undefined);

  if (verify === 'none') {
    const justification = snapshotAuditJustification(
      stableOwnWebhookValue(source, 'verifyJustification', 'webhook().verifyJustification'),
      'webhook() verify:none (SPEC §9.1)',
    );
    return witnessFreeze({
      ...(access === undefined ? {} : { access }),
      handler,
      ...(idempotency === undefined ? {} : { idempotency }),
      input,
      ...(replayStore === undefined ? {} : { replayStore }),
      ...(transaction === undefined ? {} : { transaction }),
      verify,
      verifyJustification: justification,
      ...(writes === undefined ? {} : { writes }),
    }) as WebhookDefinition<InputSchema, Value, Tx, Writes>;
  }

  return witnessFreeze({
    ...(access === undefined ? {} : { access }),
    handler,
    ...(idempotency === undefined ? {} : { idempotency }),
    input,
    ...(replayStore === undefined ? {} : { replayStore }),
    ...(transaction === undefined ? {} : { transaction }),
    verify,
    ...(writes === undefined ? {} : { writes }),
  }) as WebhookDefinition<InputSchema, Value, Tx, Writes>;
}

type PinnedWebhookMutationOptions<Request extends EndpointRequest> = Pick<
  RunMutationOptions<Request>,
  'clientIp' | 'db' | 'onError' | 'taskScheduler'
>;

function snapshotRunWebhookOptions<Request extends EndpointRequest>(
  source: RunWebhookOptions<Request>,
): PinnedWebhookMutationOptions<Request> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('runWebhook() options must be a stable own-data record.');
  }
  assertExactWebhookOptionKeys(source, ['mutationOptions'], 'runWebhook() options');
  const mutationOptions = stableOwnWebhookValue(
    source,
    'mutationOptions',
    'runWebhook().mutationOptions',
    false,
  );
  if (mutationOptions === undefined) return witnessFreeze({});
  if (
    typeof mutationOptions !== 'object' ||
    mutationOptions === null ||
    witnessIsArray(mutationOptions)
  ) {
    throw new TypeError('runWebhook().mutationOptions must be a stable own-data record.');
  }

  assertExactWebhookOptionKeys(
    mutationOptions,
    ['clientIp', 'db', 'onError', 'taskScheduler'],
    'runWebhook().mutationOptions',
  );
  const clientIp = stableOwnWebhookValue(
    mutationOptions,
    'clientIp',
    'runWebhook().mutationOptions.clientIp',
    false,
  );
  const db = stableOwnWebhookValue(mutationOptions, 'db', 'runWebhook().mutationOptions.db', false);
  const onError = stableOwnWebhookValue(
    mutationOptions,
    'onError',
    'runWebhook().mutationOptions.onError',
    false,
  );
  const schedulerSource = stableOwnWebhookValue(
    mutationOptions,
    'taskScheduler',
    'runWebhook().mutationOptions.taskScheduler',
    false,
  );
  if (clientIp !== undefined && typeof clientIp !== 'function') {
    throw new TypeError('runWebhook().mutationOptions.clientIp must be a function.');
  }
  if (db !== undefined && typeof db !== 'function' && !isFrameworkManagedDbProvider(db)) {
    throw new TypeError(
      'runWebhook().mutationOptions.db must be a function or framework-managed provider.',
    );
  }
  if (onError !== undefined && typeof onError !== 'function') {
    throw new TypeError('runWebhook().mutationOptions.onError must be a function.');
  }
  const taskScheduler =
    schedulerSource === undefined ? undefined : snapshotWebhookTaskScheduler(schedulerSource);

  return witnessFreeze({
    ...(clientIp === undefined
      ? {}
      : {
          clientIp: clientIp as NonNullable<PinnedWebhookMutationOptions<Request>['clientIp']>,
        }),
    ...(db === undefined
      ? {}
      : { db: db as NonNullable<PinnedWebhookMutationOptions<Request>['db']> }),
    ...(onError === undefined
      ? {}
      : {
          onError: onError as NonNullable<PinnedWebhookMutationOptions<Request>['onError']>,
        }),
    ...(taskScheduler === undefined ? {} : { taskScheduler }),
  });
}

function snapshotWebhookTaskScheduler(
  source: unknown,
): NonNullable<RunMutationOptions<EndpointRequest>['taskScheduler']> {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('runWebhook().mutationOptions.taskScheduler must be a stable record.');
  }
  assertExactWebhookOptionKeys(
    source,
    ['cancel', 'registeredTasks', 'schedule'],
    'runWebhook().mutationOptions.taskScheduler',
  );
  const cancel = stableOwnWebhookValue(
    source,
    'cancel',
    'runWebhook().mutationOptions.taskScheduler.cancel',
  );
  const registeredTasksSource = stableOwnWebhookValue(
    source,
    'registeredTasks',
    'runWebhook().mutationOptions.taskScheduler.registeredTasks',
  );
  const schedule = stableOwnWebhookValue(
    source,
    'schedule',
    'runWebhook().mutationOptions.taskScheduler.schedule',
  );
  if (typeof cancel !== 'function' || typeof schedule !== 'function') {
    throw new TypeError('runWebhook() task scheduler methods must be functions.');
  }
  if (!witnessIsArray(registeredTasksSource)) {
    throw new TypeError('runWebhook() task scheduler registry must be a dense array.');
  }
  const length = stableOwnWebhookValue(
    registeredTasksSource,
    'length',
    'runWebhook().mutationOptions.taskScheduler.registeredTasks.length',
  );
  if (
    typeof length !== 'number' ||
    !requestStateIsSafeInteger(length) ||
    length < 0 ||
    length > 100_000
  ) {
    throw new TypeError('runWebhook() task scheduler registry must be bounded and dense.');
  }
  const registeredTasks: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const taskDefinition = stableOwnWebhookValue(
      registeredTasksSource,
      index,
      `runWebhook().mutationOptions.taskScheduler.registeredTasks[${index}]`,
    );
    witnessDefineProperty(registeredTasks, index, {
      configurable: true,
      enumerable: true,
      value: taskDefinition,
      writable: true,
    });
  }

  return witnessFreeze({
    registeredTasks: witnessFreeze(registeredTasks) as never,
    cancel(request, handle) {
      return witnessReflectApply(cancel, source, [request, handle]);
    },
    schedule(request, input) {
      return witnessReflectApply(schedule, source, [request, input]);
    },
  });
}

function assertExactWebhookOptionKeys(
  source: object,
  allowed: readonly string[],
  label: string,
): void {
  const keys = witnessOwnKeys(source);
  if (keys.length > 100_000) throw new TypeError(`${label} must be bounded.`);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(keys, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${label} keys must remain dense.`);
    }
    const key = descriptor.value;
    let accepted = false;
    for (let allowedIndex = 0; allowedIndex < allowed.length; allowedIndex += 1) {
      if (key === allowed[allowedIndex]) {
        accepted = true;
        break;
      }
    }
    if (!accepted) throw new TypeError(`${label} contains an unsupported option.`);
  }
}

function snapshotWebhookVerification(source: unknown): WebhookVerifier | 'none' {
  if (source === 'none') return source;
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError('webhook().verify must be "none" or a stable verifier object.');
  }
  const kind = stableOwnWebhookValue(source, 'kind', 'webhook().verify.kind');
  if (kind === 'hmac') {
    if (!isFrameworkHmacSignatureVerifier(source)) {
      throw new TypeError(
        'webhook() HMAC verification must come from hmacSignature() or a framework preset.',
      );
    }
    return source;
  }
  if (kind !== 'custom') {
    throw new TypeError('webhook().verify.kind must be "custom" or "hmac".');
  }
  const name = stableOwnWebhookValue(source, 'name', 'webhook().verify.name');
  const scheme = stableOwnWebhookValue(source, 'scheme', 'webhook().verify.scheme');
  const verify = stableOwnWebhookValue(source, 'verify', 'webhook().verify.verify');
  if (typeof name !== 'string' || typeof scheme !== 'string' || typeof verify !== 'function') {
    throw new TypeError('webhook().verify must expose stable custom verifier metadata.');
  }

  let snapshot: CustomWebhookVerifier;
  snapshot = witnessFreeze({
    kind: 'custom' as const,
    name,
    scheme,
    async verify(request: WebhookVerificationRequest): Promise<boolean> {
      return (await witnessReflectApply(verify, snapshot, [request])) === true;
    },
  });
  return snapshot;
}

function snapshotWebhookReplayStore(source: unknown, label: string): WebhookReplayStore {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable replay-store object.`);
  }
  const get = stableWebhookMethod(source, 'get', `${label}.get`);
  const reserve = stableWebhookMethod(source, 'reserve', `${label}.reserve`);
  const set = stableWebhookMethod(source, 'set', `${label}.set`);
  const snapshot: WebhookReplayStore = witnessFreeze({
    get(scope: string, identitySource: WebhookReplayIdentity) {
      const identity = snapshotWebhookReplayIdentity(identitySource, `${label}.get() identity`);
      return witnessReflectApply(get, source, [scope, identity]);
    },
    async reserve(scope: string, identitySource: WebhookReplayIdentity) {
      const identity = snapshotWebhookReplayIdentity(identitySource, `${label}.reserve() identity`);
      const reservation = await witnessReflectApply<unknown>(reserve, source, [scope, identity]);
      return reservation === undefined
        ? undefined
        : snapshotWebhookReplayReservation(reservation, `${label}.reserve()`);
    },
    set(scope: string, identitySource: WebhookReplayIdentity, response: WebhookWireResponse) {
      const identity = snapshotWebhookReplayIdentity(identitySource, `${label}.set() identity`);
      return witnessReflectApply<Promise<void> | void>(set, source, [scope, identity, response]);
    },
  });
  if (witnessWeakSetHas(memoryWebhookReplayStores, source)) {
    witnessWeakSetAdd(memoryWebhookReplayStores, snapshot);
  }
  propagateFrameworkDurableReplayStoreReceipt(source, snapshot, 'webhook');
  return snapshot;
}

function snapshotWebhookReplayReservation(
  source: unknown,
  label: string,
): WebhookReplayReservation {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must return a stable replay reservation.`);
  }
  const commit = stableWebhookMethod(source, 'commit', `${label}.commit`);
  const abort = stableWebhookMethod(source, 'abort', `${label}.abort`, false);
  return witnessFreeze({
    ...(abort === undefined
      ? {}
      : {
          abort() {
            return witnessReflectApply<Promise<void> | void>(abort, source, []);
          },
        }),
    commit(response: WebhookWireResponse) {
      return witnessReflectApply<Promise<void> | void>(commit, source, [response]);
    },
  });
}

function snapshotWebhookWrites(source: unknown, label: string): readonly Domain[] {
  if (!witnessIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = stableOwnWebhookValue(source, 'length', `${label}.length`);
  if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: Domain[] = [];
  for (let index = 0; index < length; index += 1) {
    const domain = stableOwnWebhookValue(source, index, `${label}[${index}]`);
    if (typeof domain !== 'object' || domain === null || witnessIsArray(domain)) {
      throw new TypeError(`${label}[${index}] must be a domain.`);
    }
    const key = stableOwnWebhookValue(domain, 'key', `${label}[${index}].key`);
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`${label}[${index}].key must be a non-empty string.`);
    }
    const closedDomain = witnessFreeze({ key });
    witnessDefineProperty(snapshot, index, {
      configurable: true,
      enumerable: true,
      value: closedDomain,
      writable: true,
    });
  }
  return witnessFreeze(snapshot);
}

function stableWebhookMethod(
  source: object,
  property: PropertyKey,
  label: string,
  required?: true,
): Function;
function stableWebhookMethod(
  source: object,
  property: PropertyKey,
  label: string,
  required: false,
): Function | undefined;
function stableWebhookMethod(
  source: object,
  property: PropertyKey,
  label: string,
  required = true,
): Function | undefined {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = witnessGetOwnPropertyDescriptor(owner, property);
    const prototype = witnessGetPrototypeOf(owner);
    const after = witnessGetOwnPropertyDescriptor(owner, property);
    if (!sameWebhookDataDescriptor(before, after)) {
      throw new TypeError(`${label} changed while the webhook was closed.`);
    }
    if (before !== undefined) {
      if (!('value' in before) || typeof before.value !== 'function') {
        throw new TypeError(`${label} must be a stable data method.`);
      }
      return before.value;
    }
    if (witnessGetPrototypeOf(owner) !== prototype) {
      throw new TypeError(`${label} prototype changed while the webhook was closed.`);
    }
    owner = prototype;
  }
  if (!required) return undefined;
  throw new TypeError(`${label} must be a stable data method.`);
}

function stableOwnWebhookValue(
  source: object,
  property: PropertyKey,
  label: string,
  required = true,
): unknown {
  const before = witnessGetOwnPropertyDescriptor(source, property);
  const after = witnessGetOwnPropertyDescriptor(source, property);
  if (!sameWebhookDataDescriptor(before, after)) {
    throw new TypeError(`${label} changed while the webhook was closed.`);
  }
  if (before === undefined) {
    if (!required) return undefined;
    throw new TypeError(`${label} must be an own data property.`);
  }
  if (!('value' in before)) throw new TypeError(`${label} must be an own data property.`);
  return before.value;
}

function sameWebhookDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
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
  let name: string;
  let definition: WebhookDefinition<InputSchema, Value, Tx, Writes>;
  let mutationOptions: PinnedWebhookMutationOptions<EndpointRequest>;
  try {
    const definitionSource = stableOwnWebhookValue(
      declaration,
      'webhookDefinition',
      'runWebhook().webhookDefinition',
    );
    const nameSource = stableOwnWebhookValue(declaration, 'name', 'runWebhook().name');
    if (typeof nameSource !== 'string') {
      throw new TypeError('runWebhook().name must be an own string data property.');
    }
    name = nameSource;
    definition = snapshotWebhookDefinitionForDeclaration(
      definitionSource as WebhookDefinition<InputSchema, Value, Tx, Writes>,
    );
    assertWebhookWritePosture(name, definition);
    mutationOptions = snapshotRunWebhookOptions(options);
  } catch {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
    };
  }

  const endpointRequest = endpointRequestWithoutSession(request, { stripAuthorization: true });
  const requestNow = requestStateNow();
  const verifierInput = await requestVerifierInput(endpointRequest);
  const rawBody = verifierInput.payload;
  // L10-1 (SPEC §9.1:860-862): verification is fail-closed. An app-authored
  // `verify()`/`payload`/`tolerance.timestamp` callback (core/src/verifier.ts) may
  // THROW on a malformed signature header instead of returning false; that thrown
  // error must be treated as verification failure, not propagate as an uncaught
  // rejection → framework 500. Catch ANY error here and return the same 401 as a
  // `false` result, never surfacing which check failed.
  let verification: boolean;
  try {
    // SPEC §6.2 rule 5 / §9.1: verifier callbacks are authored code. Give them a detached
    // byte view so payload/timestamp normalization cannot rewrite the exact raw bytes parsed and
    // dispatched after authentication (valid signature over A must never authorize body B).
    verification = await verifyWebhook(
      definition,
      verifierInput.headers,
      securityUint8ArraySlice(rawBody),
      requestNow,
    );
  } catch {
    verification = false;
  }
  if (verification !== true) {
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
    inputResult = await parseLooseWebhookInput(definition.input, bodyResult.value);
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
  const writeCapable = webhookCanWrite(definition);
  if (writeCapable && !webhookReplayPostureSatisfied(definition)) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
    };
  }

  const input = inputResult.value;
  let replayIdentity: WebhookReplayIdentity | undefined;
  try {
    const idempotency = definition.idempotency;
    const candidate =
      idempotency === undefined
        ? undefined
        : witnessReflectApply<unknown>(idempotency, undefined, [input]);
    replayIdentity =
      candidate === undefined
        ? undefined
        : snapshotWebhookReplayIdentity(candidate, 'webhook().idempotency() result');
  } catch {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
    };
  }
  if (
    replayIdentity !== undefined &&
    (replayIdentity.expiresAtMs <= requestNow ||
      replayIdentity.occurredAtMs > requestNow + WEBHOOK_REPLAY_MAX_FUTURE_SKEW_MS)
  ) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(422, 'Webhook event occurrence is outside the replay horizon.'),
    };
  }
  if (writeCapable && replayIdentity === undefined) {
    return {
      changes: [],
      replayed: false,
      response: webhookResponse(500, 'Internal Server Error'),
    };
  }
  // SPEC §9.1/§10.3: one framework-proven identity remains active for the complete
  // lookup/reserve/store lifecycle. Undefined alone means that idempotency is disabled.
  const replayIdentityActive = replayIdentity !== undefined;
  const replayScope = webhookReplayScope(name);
  let replayed: WebhookWireResponse | undefined;
  try {
    replayed =
      replayIdentity === undefined
        ? undefined
        : await definition.replayStore?.get(replayScope, replayIdentity);
  } catch (error) {
    if (error instanceof WebhookReplayIdentityConflictError) {
      return {
        changes: [],
        replayed: false,
        response: webhookResponse(422, 'Webhook replay identity conflicts with retained truth.'),
      };
    }
    throw error;
  }
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
  const replayReservationStore =
    replayIdentity === undefined || definition.replayStore === undefined
      ? undefined
      : {
          get(scope: string) {
            return definition.replayStore!.get(scope, replayIdentity);
          },
          reserve(scope: string) {
            return definition.replayStore!.reserve(scope, replayIdentity);
          },
        };
  let reserveOutcome: Awaited<
    ReturnType<typeof reserveReplayBeforeRun<WebhookWireResponse, WebhookReplayReservation>>
  >;
  try {
    reserveOutcome = await reserveReplayBeforeRun({
      idem: replayIdentity?.key,
      scope: replayScope,
      store: replayReservationStore,
    });
  } catch (error) {
    if (error instanceof WebhookReplayIdentityConflictError) {
      return {
        changes: [],
        replayed: false,
        response: webhookResponse(422, 'Webhook replay identity conflicts with retained truth.'),
      };
    }
    throw error;
  }
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
  let handlerCommitted = false;
  try {
    const runHandler = async (tx: Tx): Promise<Value> => {
      const managedTx = webhookManagedTransactionDb(tx);
      const context = webhookHandlerContext(
        name,
        input,
        endpointRequest,
        rawBody,
        changes,
        definition.writes,
        managedTx,
        async (mutationDefinition, mutationInput, principalPosture) => {
          if (reserveOutcome.kind !== 'reserved' && reserveOutcome.kind !== 'disabled') {
            throw new Error('Webhook replay reservation is unavailable.');
          }
          if (!replayIdentityActive || definition.replayStore === undefined) {
            throw new Error(
              `Webhook "${name}" called runMutation(${mutationDefinition.key}) without an active idempotency replay reservation.`,
            );
          }

          const mutationRequest = webhookMutationRequest(endpointRequest, managedTx);
          const result = await runMutation(
            mutationDefinition as never,
            mutationInput,
            mutationRequest,
            {
              ...mutationOptions,
              csrf: false,
              principalPosture,
            } as never,
          );
          if (!result.ok) {
            throw new Error(
              `Webhook runMutation(${mutationDefinition.key}) failed with ${result.status} ${result.error.code}.`,
            );
          }
          appendWebhookChanges(
            changes,
            result.changes as readonly ChangeRecord<string, WebhookInputFor<InputSchema>>[],
          );
          return result.value;
        },
      );
      const value = await definition.handler(input, context);
      if (isWebhookFail(value)) throw new WebhookRollback(value);
      return value as Value;
    };
    const value = definition.transaction
      ? await runExactlyOnceAdapter(
          (run) => definition.transaction!({ input, rawBody, request: endpointRequest }, run),
          runHandler,
        )
      : await runHandler(undefined as Tx);
    // From this point the transaction adapter (when present) has committed. Any replay
    // settlement or post-handler posture failure must leave the reservation pending rather than
    // reopening execution across the commit/response crash window (SPEC §10.3).
    handlerCommitted = true;
    assertWebhookReplayPosture(name, definition, changes);

    const response = await storeWebhookReplay(
      definition.replayStore,
      replayScope,
      replayIdentity,
      {
        body: 'ok',
        headers: webhookSuccessHeaders(changes, replayIdentity?.key),
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
    if (isWebhookRollback(error)) {
      const failureResponse = webhookFailWireResponse(error.failure, replayIdentity?.key);

      // SPEC §9.1: fail() makes provider retry semantics explicit. A 429 or 500 is a
      // retryable answer, so committing it as replay truth would permanently turn every
      // redelivery into the same transient failure without re-running the rolled-back handler.
      // Release the claim exactly like an unexpected pre-commit handler failure. Deterministic
      // 4xx outcomes remain replayable so duplicates cannot repeatedly execute app code.
      if (error.failure.status === 429 || error.failure.status === 500) {
        await reservation?.abort?.();
        return {
          changes: [],
          replayed: false,
          response: responseFromWire(failureResponse),
        };
      }

      const response = await storeWebhookReplay(
        definition.replayStore,
        replayScope,
        replayIdentity,
        failureResponse,
        reservation,
      );

      return {
        changes: [],
        replayed: false,
        response: responseFromWire(response),
      };
    }

    // A4 (SPEC §9.1/§10.3): a callback/handler failure proves the transaction did not
    // complete and releases the claim for a corrected provider retry. A successful callback
    // followed by an adapter/COMMIT rejection is different: its database outcome is ambiguous, so
    // preserve the pending claim exactly like any other post-commit settlement failure.
    if (!handlerCommitted && !isExactlyOnceAdapterSettlementAmbiguousError(error)) {
      await reservation?.abort?.();
    }

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
  name: string,
  definition: {
    idempotency?: unknown;
    replayStore?: unknown;
  },
  changes: readonly ChangeRecord[],
): void {
  if (changes.length === 0) return;
  if (webhookReplayPostureSatisfied(definition)) return;
  throw new Error(
    `Webhook "${name}" recorded write changes without idempotency and replayStore posture.`,
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

function webhookCanWrite(definition: {
  transaction?: unknown;
  writes?: readonly unknown[] | undefined;
}): boolean {
  return definition.transaction !== undefined || (definition.writes?.length ?? 0) > 0;
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
  if (!isFrameworkHmacSignatureVerifier(definition.verify)) {
    throw new TypeError(
      'webhook() HMAC verification must come from hmacSignature() or a framework preset.',
    );
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
  headers: Headers,
  rawBody: Uint8Array,
  now: number,
): Promise<boolean> {
  if (definition.verify === 'none') return true;
  if (definition.verify.kind === 'hmac' && !isFrameworkHmacSignatureVerifier(definition.verify)) {
    return false;
  }

  return definition.verify.verify({
    headers,
    now,
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
    // SPEC §6.6/§9.5 KV430: loose provider fields are still attacker-controlled input. Run the
    // whole envelope through the same depth/breadth/node budget as mutations before preserving
    // unknown provider fields for the handler.
    const parsed = await parseSchemaAsync(schema, rawInput);
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
  const context: WebhookHandlerContext<Input, Tx, WebhookDeclaredWrites> = {
    actAs(principalId: string) {
      return writeScope(
        actAsNonRequestPrincipal(principalId, webhookPrincipalAudit(name, 'write')),
      );
    },
    declareSystemWrite(reason: string) {
      return writeScope(declareSystemPrincipal(reason, webhookPrincipalAudit(name, 'write')));
    },
    fetch: frameworkEgressFetch,
    fail(code, payload, options = {}) {
      const failure = witnessFreeze({
        error: witnessFreeze({ code, payload }),
        ok: false,
        ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
        status: options.status ?? 422,
      }) as WebhookFail<typeof code, typeof payload>;
      witnessWeakSetAdd(webhookFailureOutcomes, failure);
      return failure;
    },
    rawBody,
    recordChange(domain, options = {}) {
      const domainKey = declaredWebhookChangeDomainKey(domain, declaredWrites);
      const keys =
        options.keys === undefined
          ? undefined
          : snapshotWebhookStringArray(options.keys, 'Webhook recordChange() keys');
      if (options.reason !== undefined && typeof options.reason !== 'string') {
        throw new TypeError('Webhook recordChange() reason must be a string.');
      }
      // SPEC §9.1: webhook domain writes emit the same internal change record shape as mutations.
      const record = witnessFreeze({
        domain: domainKey,
        input: options.input ?? input,
        ...(keys === undefined ? {} : { keys }),
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      }) as ChangeRecord<typeof domain.key, Input>;
      appendWebhookChange(changes, record);
      return record;
    },
    request,
    runMutation: async () => {
      throw missingWebhookPrincipalPostureError(name, 'write');
    },
    tx: deniedWebhookTx(name) as WebhookTxDb<Tx>,
  };
  // Enforce the contextual network door at runtime as well as in its readonly TypeScript shape.
  // Verified handler code cannot replace this exact own property through JavaScript or a cast
  // (SPEC §6.6).
  witnessDefineProperty(context, 'fetch', {
    configurable: false,
    enumerable: true,
    value: frameworkEgressFetch,
    writable: false,
  });
  return context;
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
  return witnessProxy(witnessCreateNullRecord(), {
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
  return witnessProxy(request, {
    get(target, property) {
      if (property === 'db') return tx;
      const value = witnessReflectGet(target, property, target);
      return typeof value === 'function'
        ? (...args: unknown[]) => witnessReflectApply(value, target, args)
        : value;
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
      return witnessGetOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      return property === 'db' || property in target;
    },
    ownKeys(target) {
      const keys = witnessOwnKeys(target) as (string | symbol)[];
      for (let index = 0; index < keys.length; index += 1) {
        if (keys[index] === 'db') return keys;
      }
      witnessDefineProperty(keys, keys.length, {
        configurable: true,
        enumerable: true,
        value: 'db',
        writable: true,
      });
      return keys;
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

function declaredWebhookChangeDomainKey(
  domain: Domain,
  declaredWrites: readonly Domain[] | undefined,
): string {
  if (typeof domain !== 'object' || domain === null || witnessIsArray(domain)) {
    throw new TypeError('Webhook recordChange() requires a stable domain object.');
  }
  const domainKey = stableOwnWebhookValue(domain, 'key', 'Webhook recordChange() domain.key');
  if (typeof domainKey !== 'string' || domainKey.length === 0) {
    throw new TypeError('Webhook recordChange() domain.key must be a non-empty string.');
  }
  const declaredKeys: string[] = [];
  if (declaredWrites !== undefined) {
    const length = stableOwnWebhookValue(
      declaredWrites,
      'length',
      'Webhook declared writes.length',
    );
    if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
      throw new TypeError('Webhook declared writes must be a bounded dense array.');
    }
    for (let index = 0; index < length; index += 1) {
      const declared = stableOwnWebhookValue(
        declaredWrites,
        index,
        `Webhook declared writes[${index}]`,
      );
      if (typeof declared !== 'object' || declared === null || witnessIsArray(declared)) {
        throw new TypeError(`Webhook declared writes[${index}] must be a stable domain.`);
      }
      const key = stableOwnWebhookValue(declared, 'key', `Webhook declared writes[${index}].key`);
      if (typeof key !== 'string') {
        throw new TypeError(`Webhook declared writes[${index}].key must be a string.`);
      }
      appendWebhookValue(declaredKeys, key);
      if (key === domainKey) return domainKey;
    }
  }
  const declared = declaredKeys.length === 0 ? 'none' : securityArrayJoin(declaredKeys, ', ');
  throw new Error(
    `Webhook recordChange("${domainKey}") is outside declared writes (${declared}). ` +
      `SPEC §9.1 requires webhook changes to be declared so kovo explain --endpoints ` +
      `cannot under-report machine-ingress writes.`,
  );
}

function isWebhookFail(value: unknown): value is WebhookFail {
  return (
    typeof value === 'object' && value !== null && witnessWeakSetHas(webhookFailureOutcomes, value)
  );
}

class WebhookRollback extends Error {
  readonly failure: WebhookFail;

  constructor(failure: WebhookFail) {
    super(failure.error.code);
    this.failure = failure;
    this.name = 'WebhookRollback';
    witnessWeakSetAdd(webhookRollbackOutcomes, this);
  }
}

function isWebhookRollback(value: unknown): value is WebhookRollback {
  return (
    typeof value === 'object' && value !== null && witnessWeakSetHas(webhookRollbackOutcomes, value)
  );
}

function webhookFailWireResponse(
  failure: WebhookFail,
  idem: string | undefined,
): WebhookWireResponse {
  return {
    body: webhookJsonStringify({ error: failure.error, ok: false }),
    headers: webhookResponseHeaders({
      contentType: 'application/json; charset=utf-8',
      idem,
      extra: retryAfterHeaders(failure),
    }),
    status: failure.status,
  };
}

async function storeWebhookReplay(
  replayStore: WebhookReplayStore | undefined,
  scope: string,
  identity: WebhookReplayIdentity | undefined,
  response: WebhookWireResponse,
  reservation: WebhookReplayReservation | undefined,
): Promise<WebhookWireResponse> {
  if (reservation) {
    await reservation.commit(response);
    return response;
  }

  if (identity !== undefined) await replayStore?.set(scope, identity, response);
  return response;
}

function responseFromWire(response: WebhookWireResponse): Response {
  return serverResponseToWebResponse(
    snapshotWebhookReplayResponse(response, 'Webhook replay response'),
    { method: 'GET' },
  );
}

/**
 * Reconstruct persisted webhook wire output before response policy observes it.
 *
 * Replay stores are adapter boundaries: their result may have been deserialized from a durable
 * database or reconstructed by application code. Reading `status` once for redirect policy and
 * again for the Web `Response` constructor would let an accessor make those two sinks disagree
 * (for example policy sees 200 while the constructor sees 302 + an unblessed external Location).
 * Exact own-data reconstruction also keeps inherited headers and late mutation out of the wire.
 */
/** @internal Reconstruct an untrusted durable webhook replay response as stable wire data. */
export function snapshotWebhookReplayResponse(source: unknown, label: string): WebhookWireResponse {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable response record.`);
  }
  const body = stableOwnWebhookValue(source, 'body', `${label}.body`);
  const headers = stableOwnWebhookValue(source, 'headers', `${label}.headers`);
  const status = stableOwnWebhookValue(source, 'status', `${label}.status`);
  if (typeof body !== 'string') {
    throw new TypeError(`${label}.body must be a string own data property.`);
  }
  if (!isWebhookResponseStatus(status)) {
    throw new TypeError(`${label}.status must be a supported webhook response status.`);
  }
  return witnessFreeze({
    body,
    headers: snapshotWebhookWireHeaders(headers, `${label}.headers`),
    status,
  });
}

function snapshotWebhookWireHeaders(source: unknown, label: string): ResponseHeaders {
  if (typeof source !== 'object' || source === null || witnessIsArray(source)) {
    throw new TypeError(`${label} must be a stable header record.`);
  }
  const keys = witnessOwnKeys(source);
  if (keys.length > 1_000) throw new TypeError(`${label} must be bounded.`);
  const snapshot = witnessCreateNullRecord<string | readonly string[]>() as ResponseHeaders;
  for (let index = 0; index < keys.length; index += 1) {
    const name = stableOwnWebhookValue(keys, index, `${label} key[${index}]`);
    if (typeof name !== 'string') {
      throw new TypeError(`${label} names must be strings.`);
    }
    const value = stableOwnWebhookValue(source, name, `${label}.${name}`);
    if (typeof value !== 'string' && !witnessIsArray(value)) {
      throw new TypeError(`${label}.${name} must be a string or dense string array.`);
    }
    witnessDefineProperty(snapshot, name, {
      configurable: false,
      enumerable: true,
      value:
        typeof value === 'string' ? value : snapshotWebhookStringArray(value, `${label}.${name}`),
      writable: false,
    });
  }
  return witnessFreeze(snapshot) as ResponseHeaders;
}

function isWebhookResponseStatus(value: unknown): value is WebhookResponseStatus {
  return (
    value === 200 ||
    value === 400 ||
    value === 401 ||
    value === 422 ||
    value === 429 ||
    value === 500
  );
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
  return webhookResponse(status, webhookJsonStringify(body), {
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
  const projected: Array<{ domain: string; keys?: readonly string[] }> = [];
  for (let index = 0; index < changes.length; index += 1) {
    const change = stableOwnWebhookValue(changes, index, `Webhook changes[${index}]`);
    if (typeof change !== 'object' || change === null || witnessIsArray(change)) {
      throw new TypeError(`Webhook changes[${index}] must be a stable change record.`);
    }
    const domain = stableOwnWebhookValue(change, 'domain', `Webhook changes[${index}].domain`);
    const keys = stableOwnWebhookValue(change, 'keys', `Webhook changes[${index}].keys`, false);
    if (typeof domain !== 'string') {
      throw new TypeError(`Webhook changes[${index}].domain must be a string.`);
    }
    appendWebhookValue(projected, {
      domain,
      ...(keys === undefined
        ? {}
        : { keys: snapshotWebhookStringArray(keys, `Webhook changes[${index}].keys`) }),
    });
  }
  return webhookJsonStringify(projected);
}

function appendWebhookChanges<Value>(target: Value[], source: readonly Value[]): void {
  if (!witnessIsArray(source)) throw new TypeError('Webhook mutation changes must be an array.');
  const length = stableOwnWebhookValue(source, 'length', 'Webhook mutation changes.length');
  if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
    throw new TypeError('Webhook mutation changes must be a bounded dense array.');
  }
  for (let index = 0; index < length; index += 1) {
    appendWebhookChange(
      target,
      stableOwnWebhookValue(source, index, `Webhook mutation changes[${index}]`) as Value,
    );
  }
}

function appendWebhookChange<Value>(target: Value[], value: Value): void {
  appendWebhookValue(target, value);
}

function appendWebhookValue<Value>(target: Value[], value: Value): void {
  witnessDefineProperty(target, target.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function snapshotWebhookStringArray(source: unknown, label: string): readonly string[] {
  if (!witnessIsArray(source)) throw new TypeError(`${label} must be an array.`);
  const length = stableOwnWebhookValue(source, 'length', `${label}.length`);
  if (typeof length !== 'number' || length < 0 || length > 100_000 || length % 1 !== 0) {
    throw new TypeError(`${label} must be a bounded dense array.`);
  }
  const snapshot: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = stableOwnWebhookValue(source, index, `${label}[${index}]`);
    if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be a string.`);
    appendWebhookValue(snapshot, value);
  }
  return witnessFreeze(snapshot);
}

function webhookJsonStringify(value: unknown): string {
  const json = securityJsonStringify(value);
  if (json === undefined) throw new TypeError('Webhook response value is not JSON serializable.');
  return json;
}

function webhookReplayScope(name: string): string {
  return `webhook:${name}`;
}

function webhookReplayKey(scope: string, idem: string): string {
  return requestStateExactCompositeKey(scope, idem);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) return false;
  const prototype = witnessGetPrototypeOf(value);
  return prototype === null || prototype === WEBHOOK_OBJECT_PROTOTYPE;
}

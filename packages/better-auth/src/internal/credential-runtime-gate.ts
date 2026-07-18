import {
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthCreateSet,
  betterAuthDeepFreeze,
  betterAuthFreezeOwn,
  betterAuthGetOwnPropertyDescriptor,
  betterAuthIsProxy,
  betterAuthMapDelete,
  betterAuthMapGet,
  betterAuthMapHas,
  betterAuthMapSet,
  betterAuthSnapshotDenseArray,
  betterAuthStartsWith,
  betterAuthSetAdd,
  betterAuthSetHas,
} from './intrinsics.js';
import {
  assertBetterAuthRequestSecretPath,
  betterAuthRequestSecretPaths,
  type BetterAuthRequestSecretPathId,
} from './non-egress-proof.js';

const NativeError = globalThis.Error;
const NativeTypeError = globalThis.TypeError;

export type BetterAuthCredentialRuntimeResultPolicy =
  | 'adapter-instance'
  | 'argon2id-hash'
  | 'boolean-verdict'
  | 'discarded'
  | 'opaque-response'
  | 'rate-limit-options'
  | 'session-result'
  | 'set-cookie-list';

export interface BetterAuthCredentialConsumerContract {
  /** Stable review id for this adapter credential/secret consumer. */
  id: string;
  /** Production module that owns the consumer. */
  owner: string;
  /** Existing M2 secret paths whose plaintext authority reaches this consumer. */
  paths: readonly BetterAuthRequestSecretPathId[];
  /** Runtime shape permitted to leave the consumer and reach its reviewed next sink. */
  result: BetterAuthCredentialRuntimeResultPolicy;
  /** Whether a 400/401/403 provider error may become the opaque invalid-credential verdict. */
  credentialFailure: boolean;
}

/**
 * Complete first-party Better Auth credential/secret consumer census.
 *
 * SPEC §6.6/§10.3 C9-C10: each supported adapter contact point is routed through the exact
 * runtime gate below. The M2 path manifest remains the audit/proof vocabulary; this census binds
 * those paths to their actual runtime consumers and permitted result shapes.
 */
export const betterAuthCredentialConsumerContracts = betterAuthDeepFreeze(
  [
    {
      credentialFailure: true,
      id: 'credential-handler.sign-in-email',
      owner: 'internal/trusted-plaintext.ts',
      paths: [
        'better-auth.sign-in.submitted-password',
        'better-auth.adapter.sign-in.account-password',
      ],
      result: 'opaque-response',
    },
    {
      credentialFailure: true,
      id: 'credential-handler.sign-up-email',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.sign-up.submitted-password'],
      result: 'opaque-response',
    },
    {
      credentialFailure: false,
      id: 'credential-api.seed-sign-up-email',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.sign-up.submitted-password'],
      result: 'discarded',
    },
    {
      credentialFailure: false,
      id: 'credential-api.sign-out',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.sign-out.request-cookie'],
      result: 'opaque-response',
    },
    {
      credentialFailure: false,
      id: 'credential-api.get-session',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.get-session.request-cookie', 'better-auth.adapter.session-token-lookup'],
      result: 'session-result',
    },
    {
      credentialFailure: false,
      id: 'session.sanitized-projection',
      owner: 'session.ts',
      paths: ['better-auth.get-session.response-secret-projection'],
      result: 'session-result',
    },
    {
      credentialFailure: false,
      id: 'cookie.credential-forwarding',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.set-cookie.forwarding'],
      result: 'set-cookie-list',
    },
    {
      credentialFailure: false,
      id: 'cookie.session-refresh-forwarding',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.session-refresh.set-cookie'],
      result: 'set-cookie-list',
    },
    {
      credentialFailure: false,
      id: 'mount.handler-delegation',
      owner: 'mount-adapter.ts',
      paths: ['better-auth.mount.handler-delegation'],
      result: 'opaque-response',
    },
    {
      credentialFailure: false,
      id: 'mount.cookie-forwarding',
      owner: 'internal/trusted-plaintext.ts',
      paths: ['better-auth.mount.set-cookie-forwarding'],
      result: 'set-cookie-list',
    },
    {
      credentialFailure: false,
      id: 'password.argon2id-hash',
      owner: 'internal/password.ts',
      paths: ['better-auth.sign-up.submitted-password'],
      result: 'argon2id-hash',
    },
    {
      credentialFailure: false,
      id: 'password.argon2id-verify',
      owner: 'internal/password.ts',
      paths: [
        'better-auth.sign-in.submitted-password',
        'better-auth.adapter.sign-in.account-password',
      ],
      result: 'boolean-verdict',
    },
    {
      credentialFailure: false,
      id: 'adapter.postgres-construction',
      owner: 'postgres.ts',
      paths: ['better-auth.binding.signing-secret'],
      result: 'adapter-instance',
    },
    {
      credentialFailure: false,
      id: 'adapter.sqlite-construction',
      owner: 'sqlite.ts',
      paths: ['better-auth.binding.signing-secret'],
      result: 'adapter-instance',
    },
    {
      credentialFailure: false,
      id: 'rate-limit.postgres-signing-key',
      owner: 'postgres.ts',
      paths: ['better-auth.rate-limit.signing-secret'],
      result: 'rate-limit-options',
    },
    {
      credentialFailure: false,
      id: 'rate-limit.sqlite-signing-key',
      owner: 'sqlite.ts',
      paths: ['better-auth.rate-limit.signing-secret'],
      result: 'rate-limit-options',
    },
  ] as const satisfies readonly BetterAuthCredentialConsumerContract[],
  'Better Auth credential consumer contracts',
);

export type BetterAuthCredentialConsumerId =
  (typeof betterAuthCredentialConsumerContracts)[number]['id'];

// The unique-symbol member is deliberately only an author-time guardrail. Exact registry
// membership and contract/result validation below are the runtime enforcement (SPEC §6.6).
declare const betterAuthCredentialConsumerBrand: unique symbol;
export interface BetterAuthCredentialConsumer<Id extends BetterAuthCredentialConsumerId> {
  readonly [betterAuthCredentialConsumerBrand]: Id;
}

declare const betterAuthCredentialResultBrand: unique symbol;
export interface BetterAuthCredentialResult<Id extends BetterAuthCredentialConsumerId, Value> {
  readonly [betterAuthCredentialResultBrand]: readonly [Id, Value];
}

interface RegisteredCredentialResult {
  consumer: object;
  value: unknown;
}

const registeredConsumers = betterAuthCreateMap<object, BetterAuthCredentialConsumerContract>();
const registeredResults = betterAuthCreateMap<object, RegisteredCredentialResult>();
const credentialFailureErrors = betterAuthCreateMap<object, true>();

// Refuse module initialization if the reviewed consumer census is internally contradictory or
// fails to cover the complete M2 path manifest. The source-use census in the security corpus then
// binds each minted token to its sole owner module.
validateCredentialConsumerCensus();

function createBetterAuthCredentialConsumer<Id extends BetterAuthCredentialConsumerId>(
  contract: Extract<(typeof betterAuthCredentialConsumerContracts)[number], { id: Id }>,
): BetterAuthCredentialConsumer<Id> {
  validateConsumerContract(contract);
  const token = betterAuthFreezeOwn(
    betterAuthCreateNullRecord<never>(),
    `Better Auth credential consumer ${contract.id}`,
  );
  betterAuthMapSet(registeredConsumers, token, contract);
  // This cast is confined to the validating constructor. The runtime registry above, not the
  // structural brand, decides whether the gate accepts a token.
  return token as unknown as BetterAuthCredentialConsumer<Id>;
}

function validateConsumerContract(contract: BetterAuthCredentialConsumerContract): void {
  if (typeof contract.id !== 'string' || contract.id === '') {
    throw new NativeTypeError('Better Auth credential consumer id must be non-empty text.');
  }
  if (typeof contract.owner !== 'string' || contract.owner === '') {
    throw new NativeTypeError(`Better Auth credential consumer ${contract.id} needs an owner.`);
  }
  if (typeof contract.credentialFailure !== 'boolean') {
    throw new NativeTypeError(
      `Better Auth credential consumer ${contract.id} needs a credential-failure verdict.`,
    );
  }
  switch (contract.result) {
    case 'adapter-instance':
    case 'argon2id-hash':
    case 'boolean-verdict':
    case 'discarded':
    case 'opaque-response':
    case 'rate-limit-options':
    case 'session-result':
    case 'set-cookie-list':
      break;
    default:
      throw new NativeTypeError(
        `Better Auth credential consumer ${contract.id} has an unknown result policy.`,
      );
  }
  const paths = betterAuthSnapshotDenseArray(
    contract.paths,
    `Better Auth credential consumer ${contract.id} paths`,
  );
  if (paths.length === 0) {
    throw new NativeTypeError(`Better Auth credential consumer ${contract.id} needs a path.`);
  }
  for (let index = 0; index < paths.length; index += 1) {
    assertBetterAuthRequestSecretPath(paths[index]!);
  }
}

function validateCredentialConsumerCensus(): void {
  const contracts = betterAuthSnapshotDenseArray(
    betterAuthCredentialConsumerContracts,
    'Better Auth credential consumer contracts',
  );
  const ids = betterAuthCreateSet<string>();
  const coveredPaths = betterAuthCreateSet<string>();
  for (let contractIndex = 0; contractIndex < contracts.length; contractIndex += 1) {
    const contract = contracts[contractIndex]!;
    validateConsumerContract(contract);
    if (betterAuthSetHas(ids, contract.id)) {
      throw new NativeTypeError(`KV439: duplicate Better Auth credential consumer ${contract.id}`);
    }
    betterAuthSetAdd(ids, contract.id);
    const paths = betterAuthSnapshotDenseArray(
      contract.paths,
      `Better Auth credential consumer ${contract.id} paths`,
    );
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      betterAuthSetAdd(coveredPaths, paths[pathIndex]!);
    }
  }

  for (let pathIndex = 0; pathIndex < betterAuthRequestSecretPaths.length; pathIndex += 1) {
    const path = betterAuthRequestSecretPaths[pathIndex]!;
    if (!betterAuthSetHas(coveredPaths, path.id)) {
      throw new NativeTypeError(
        `KV439: Better Auth request secret path ${path.id} has no runtime consumer.`,
      );
    }
  }
}

function contractById<Id extends BetterAuthCredentialConsumerId>(
  id: Id,
): Extract<(typeof betterAuthCredentialConsumerContracts)[number], { id: Id }> {
  for (let index = 0; index < betterAuthCredentialConsumerContracts.length; index += 1) {
    const contract = betterAuthCredentialConsumerContracts[index]!;
    if (contract.id === id) {
      return contract as Extract<
        (typeof betterAuthCredentialConsumerContracts)[number],
        { id: Id }
      >;
    }
  }
  throw new NativeTypeError(`KV439: missing Better Auth credential consumer contract ${id}`);
}

export const betterAuthCredentialConsumers = betterAuthFreezeOwn(
  {
    credentialHandlerSignInEmail: createBetterAuthCredentialConsumer(
      contractById('credential-handler.sign-in-email'),
    ),
    credentialHandlerSignUpEmail: createBetterAuthCredentialConsumer(
      contractById('credential-handler.sign-up-email'),
    ),
    seedSignUpEmail: createBetterAuthCredentialConsumer(
      contractById('credential-api.seed-sign-up-email'),
    ),
    signOut: createBetterAuthCredentialConsumer(contractById('credential-api.sign-out')),
    getSession: createBetterAuthCredentialConsumer(contractById('credential-api.get-session')),
    sessionProjection: createBetterAuthCredentialConsumer(
      contractById('session.sanitized-projection'),
    ),
    credentialCookieForwarding: createBetterAuthCredentialConsumer(
      contractById('cookie.credential-forwarding'),
    ),
    sessionCookieForwarding: createBetterAuthCredentialConsumer(
      contractById('cookie.session-refresh-forwarding'),
    ),
    mountHandler: createBetterAuthCredentialConsumer(contractById('mount.handler-delegation')),
    mountCookieForwarding: createBetterAuthCredentialConsumer(
      contractById('mount.cookie-forwarding'),
    ),
    passwordHash: createBetterAuthCredentialConsumer(contractById('password.argon2id-hash')),
    passwordVerify: createBetterAuthCredentialConsumer(contractById('password.argon2id-verify')),
    postgresAdapter: createBetterAuthCredentialConsumer(
      contractById('adapter.postgres-construction'),
    ),
    sqliteAdapter: createBetterAuthCredentialConsumer(contractById('adapter.sqlite-construction')),
    postgresRateLimit: createBetterAuthCredentialConsumer(
      contractById('rate-limit.postgres-signing-key'),
    ),
    sqliteRateLimit: createBetterAuthCredentialConsumer(
      contractById('rate-limit.sqlite-signing-key'),
    ),
  },
  'Better Auth credential consumers',
);

/** Execute one synchronous adapter credential consumer and seal its result behind the gate. */
export function runBetterAuthCredentialConsumer<Id extends BetterAuthCredentialConsumerId, Value>(
  consumer: BetterAuthCredentialConsumer<Id>,
  invoke: () => Value,
): BetterAuthCredentialResult<Id, Value> {
  const contract = requireConsumer(consumer);
  let value: Value;
  try {
    value = invoke();
  } catch (error) {
    throw sanitizedConsumerFailure(contract, error);
  }
  validateConsumerResult(contract, value);
  return registerResult(consumer, value, contract.id);
}

/** Execute one asynchronous adapter credential consumer and seal its result behind the gate. */
export async function runBetterAuthCredentialConsumerAsync<
  Id extends BetterAuthCredentialConsumerId,
  Value,
>(
  consumer: BetterAuthCredentialConsumer<Id>,
  invoke: () => PromiseLike<Value> | Value,
): Promise<BetterAuthCredentialResult<Id, Value>> {
  const contract = requireConsumer(consumer);
  let value: Value;
  try {
    value = await invoke();
  } catch (error) {
    throw sanitizedConsumerFailure(contract, error);
  }
  validateConsumerResult(contract, value);
  return registerResult(consumer, value, contract.id);
}

/**
 * Open a result exactly once at the reviewed next sink for the same registered consumer.
 * Forged structural brands, cross-consumer swaps, and result replay fail closed at runtime.
 */
export function consumeBetterAuthCredentialResult<Id extends BetterAuthCredentialConsumerId, Value>(
  consumer: BetterAuthCredentialConsumer<Id>,
  result: BetterAuthCredentialResult<Id, Value>,
): Value {
  requireConsumer(consumer);
  if ((typeof result !== 'object' && typeof result !== 'function') || result === null) {
    throw new NativeTypeError('KV439: forged Better Auth credential consumer result.');
  }
  const registered = betterAuthMapGet(registeredResults, result as object);
  if (registered === undefined || registered.consumer !== consumer) {
    throw new NativeTypeError('KV439: mismatched Better Auth credential consumer result.');
  }
  if (!betterAuthMapDelete(registeredResults, result as object)) {
    throw new NativeTypeError('KV439: Better Auth credential consumer result could not be sealed.');
  }
  return registered.value as Value;
}

/** True only for a gate-minted opaque 400/401/403 provider failure; consumes the verdict once. */
export function isBetterAuthCredentialGateFailure(error: unknown): boolean {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return false;
  if (!betterAuthMapHas(credentialFailureErrors, error)) return false;
  return betterAuthMapDelete(credentialFailureErrors, error);
}

function requireConsumer<Id extends BetterAuthCredentialConsumerId>(
  consumer: BetterAuthCredentialConsumer<Id>,
): BetterAuthCredentialConsumerContract {
  if ((typeof consumer !== 'object' && typeof consumer !== 'function') || consumer === null) {
    throw new NativeTypeError('KV439: forged Better Auth credential consumer.');
  }
  const contract = betterAuthMapGet(registeredConsumers, consumer as object);
  if (contract === undefined) {
    throw new NativeTypeError('KV439: unregistered Better Auth credential consumer.');
  }
  for (let index = 0; index < contract.paths.length; index += 1) {
    assertBetterAuthRequestSecretPath(contract.paths[index]!);
  }
  return contract;
}

function registerResult<Id extends BetterAuthCredentialConsumerId, Value>(
  consumer: BetterAuthCredentialConsumer<Id>,
  value: Value,
  id: string,
): BetterAuthCredentialResult<Id, Value> {
  const result = betterAuthFreezeOwn(
    betterAuthCreateNullRecord<never>(),
    `Better Auth credential result ${id}`,
  );
  betterAuthMapSet(registeredResults, result, { consumer, value });
  return result as unknown as BetterAuthCredentialResult<Id, Value>;
}

function validateConsumerResult(
  contract: BetterAuthCredentialConsumerContract,
  value: unknown,
): void {
  if (
    ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
    betterAuthIsProxy(value)
  ) {
    throw new NativeTypeError(
      `KV439: Better Auth credential consumer ${contract.id} returned a Proxy.`,
    );
  }
  switch (contract.result) {
    case 'adapter-instance':
    case 'opaque-response':
    case 'rate-limit-options':
      if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
        throw new NativeTypeError(
          `KV439: Better Auth credential consumer ${contract.id} returned no object.`,
        );
      }
      return;
    case 'session-result':
      if (
        value !== null &&
        value !== undefined &&
        typeof value !== 'object' &&
        typeof value !== 'function'
      ) {
        throw new NativeTypeError(
          `KV439: Better Auth credential consumer ${contract.id} returned an invalid session carrier.`,
        );
      }
      return;
    case 'set-cookie-list': {
      const values = betterAuthSnapshotDenseArray(
        value as readonly unknown[],
        `Better Auth credential consumer ${contract.id} cookie result`,
      );
      for (let index = 0; index < values.length; index += 1) {
        if (typeof values[index] !== 'string') {
          throw new NativeTypeError(
            `KV439: Better Auth credential consumer ${contract.id} returned a non-string cookie.`,
          );
        }
      }
      return;
    }
    case 'argon2id-hash':
      if (typeof value !== 'string' || !betterAuthStartsWith(value, '$argon2id$')) {
        throw new NativeTypeError(
          `KV439: Better Auth credential consumer ${contract.id} returned a non-Argon2id hash.`,
        );
      }
      return;
    case 'boolean-verdict':
      if (typeof value !== 'boolean') {
        throw new NativeTypeError(
          `KV439: Better Auth credential consumer ${contract.id} returned a non-boolean verdict.`,
        );
      }
      return;
    case 'discarded':
      if (value !== undefined) {
        throw new NativeTypeError(
          `KV439: Better Auth credential consumer ${contract.id} returned a value from a discard-only sink.`,
        );
      }
  }
}

function sanitizedConsumerFailure(
  contract: BetterAuthCredentialConsumerContract,
  error: unknown,
): Error {
  const safe = new NativeError(
    'Better Auth credential consumer failed inside the non-egress gate.',
  );
  if (contract.credentialFailure && credentialFailureStatus(error)) {
    betterAuthMapSet(credentialFailureErrors, safe, true);
  }
  return safe;
}

function credentialFailureStatus(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || betterAuthIsProxy(error)) return false;
  return (
    hasCredentialFailureStatus(error, 'status') ||
    hasCredentialFailureStatus(error, 'statusCode') ||
    hasCredentialFailureStatus(error, 'code')
  );
}

function hasCredentialFailureStatus(error: object, field: PropertyKey): boolean {
  const descriptor = betterAuthGetOwnPropertyDescriptor(error, field);
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    (descriptor.value === 400 || descriptor.value === 401 || descriptor.value === 403)
  );
}

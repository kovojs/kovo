import type { AccessDecision } from '@kovojs/server';
import { createBetterAuthPasswordResetCryptoHandle } from '@kovojs/server/internal/keyring';

import {
  betterAuthCharacterCodeAt,
  betterAuthCreateMap,
  betterAuthCreateNullRecord,
  betterAuthDefineOwnData,
  betterAuthFreezeOwn,
  betterAuthIndexOf,
  betterAuthIsProxy,
  betterAuthMapDelete,
  betterAuthMapGet,
  betterAuthMapHas,
  betterAuthMapSet,
  betterAuthObjectKeys,
  betterAuthOwnDataValue,
  betterAuthReplaceAll,
  betterAuthToLowerCase,
  betterAuthTrim,
  betterAuthUrlSnapshot,
} from './internal/intrinsics.js';
import {
  betterAuthCredentialConsumers,
  consumeBetterAuthCredentialResult,
  runBetterAuthCredentialSourceCallableAsync,
} from './internal/credential-runtime-gate.js';
import { assertBetterAuthRuntimeRealmLocked } from './internal/runtime-lock.js';

const NativeTypeError = globalThis.TypeError;
const maximumPasswordResetEmailLength = 320;
const maximumPasswordResetTokenLength = 256;
const passwordResetCrypto = createBetterAuthPasswordResetCryptoHandle();

declare const betterAuthPasswordResetMailDoorBrand: unique symbol;
declare const betterAuthPasswordResetMailAttemptBrand: unique symbol;

/** The only data Kovo permits to cross its password-reset email-egress door (SPEC §6.6/§9.2). */
export interface BetterAuthPasswordResetMailMessage {
  /** Validated recipient selected by the fixed Better Auth account-recovery operation. */
  readonly to: string;
  /** Same-origin Better Auth callback URL carrying the opaque reset token. */
  readonly resetUrl: string;
}

/** A deployer-owned mail sender invoked only with a password-reset message. */
export type BetterAuthPasswordResetMailSender = (
  message: Readonly<BetterAuthPasswordResetMailMessage>,
) => Promise<void>;

/**
 * Opaque capability for the single password-reset mail purpose.
 *
 * Construct it with {@link betterAuthPasswordResetMailDoor}; structural objects and callbacks
 * cannot be supplied directly to a fixed binding (SPEC §6.6 C9-C10).
 */
export interface BetterAuthPasswordResetMailDoor {
  readonly [betterAuthPasswordResetMailDoorBrand]: 'better-auth-password-reset-mail-door';
}

/** Feature-conditional password-reset options accepted by fixed SQLite/Postgres bindings. */
export interface BetterAuthPasswordResetOptions {
  /** Explicit pre-auth access decision for the CSRF-protected request mutation. */
  access: AccessDecision;
  /** Constructor-minted, purpose-closed mail capability. */
  mail: BetterAuthPasswordResetMailDoor;
  /** Canonical same-origin path that receives Better Auth's reset token redirect. */
  resetPath: string;
}

/** @internal Captured mail callback installed into a Kovo-owned Better Auth constructor. */
export interface PinnedBetterAuthPasswordResetMailDoor {
  readonly authBasePath: string;
  readonly baseURL: string;
  readonly capture: (data: unknown, request?: Request) => Promise<void>;
  readonly method: Function;
  readonly resetPath: string;
}

/** @internal Opaque, one-shot attempt spanning the routed handler and mail dispatch doors. */
export interface BetterAuthPasswordResetMailAttempt {
  readonly [betterAuthPasswordResetMailAttemptBrand]: 'better-auth-password-reset-mail-attempt';
}

interface PasswordResetMailAttemptState {
  readonly binding: PinnedBetterAuthPasswordResetMailDoor;
  readonly decoy: Readonly<BetterAuthPasswordResetMailMessage>;
  readonly request: Request;
  captured?: Readonly<BetterAuthPasswordResetMailMessage>;
}

const registeredMailDoors = betterAuthCreateMap<object, Function>();
const registeredMailAttempts = betterAuthCreateMap<object, PasswordResetMailAttemptState>();
const requestMailAttempts = betterAuthCreateMap<object, object>();

/**
 * Validate and capture a deployer mail sender behind an opaque password-reset-only capability.
 *
 * The type brand is ergonomics; exact registry membership is the runtime authority.
 */
export function betterAuthPasswordResetMailDoor(
  send: BetterAuthPasswordResetMailSender,
): BetterAuthPasswordResetMailDoor {
  assertBetterAuthRuntimeRealmLocked();
  if (typeof send !== 'function' || betterAuthIsProxy(send)) {
    throw new NativeTypeError(
      'KV439: Better Auth password-reset mail sender must be a non-Proxy function.',
    );
  }
  const token = betterAuthFreezeOwn(
    betterAuthCreateNullRecord<never>(),
    'Better Auth password-reset mail door',
  );
  betterAuthMapSet(registeredMailDoors, token, send);
  return token as unknown as BetterAuthPasswordResetMailDoor;
}

/** @internal Pin an exact public mail-door token and the finite reset URL posture. */
export function createBetterAuthPasswordResetMailBinding(
  door: BetterAuthPasswordResetMailDoor,
  options: { authBasePath: string; baseURL: string; resetPath: string },
): PinnedBetterAuthPasswordResetMailDoor {
  assertBetterAuthRuntimeRealmLocked();
  if ((typeof door !== 'object' && typeof door !== 'function') || door === null) {
    throw invalidMailDoor();
  }
  const method = betterAuthMapGet(registeredMailDoors, door as object);
  if (method === undefined) throw invalidMailDoor();
  if (typeof options !== 'object' || options === null || betterAuthIsProxy(options)) {
    throw new NativeTypeError('Better Auth password-reset mail binding options must be an object.');
  }
  const optionKeys = betterAuthObjectKeys(options, 'Better Auth password-reset mail options');
  if (
    optionKeys.length !== 3 ||
    !hasKey(optionKeys, 'authBasePath') ||
    !hasKey(optionKeys, 'baseURL') ||
    !hasKey(optionKeys, 'resetPath')
  ) {
    throw new NativeTypeError(
      'Better Auth password-reset mail binding accepts only authBasePath, baseURL, and resetPath.',
    );
  }
  const baseURL = ownText(options, 'baseURL', 'Better Auth password-reset mail binding');
  const authBasePath = canonicalPurposePath(
    ownText(options, 'authBasePath', 'Better Auth password-reset mail binding'),
    baseURL,
    'Better Auth password-reset auth base path',
  );
  const resetPath = canonicalPurposePath(
    ownText(options, 'resetPath', 'Better Auth password-reset mail binding'),
    baseURL,
    'Better Auth password-reset destination path',
  );
  const origin = betterAuthUrlSnapshot(baseURL).origin;
  if (baseURL !== origin) {
    throw new NativeTypeError('Better Auth password-reset baseURL must be a canonical origin.');
  }

  let binding: PinnedBetterAuthPasswordResetMailDoor;
  const capture = async (data: unknown, request?: Request): Promise<void> => {
    captureProviderPasswordResetMail(binding, data, request);
  };
  binding = betterAuthFreezeOwn(
    { authBasePath, baseURL, capture, method, resetPath },
    'Better Auth password-reset mail binding',
  );
  return binding;
}

/** @internal Snapshot and validate an optional feature declaration from a fixed binding. */
export function optionalBetterAuthPasswordResetFeature(
  value: BetterAuthPasswordResetOptions | undefined,
  baseURL: string,
):
  | Readonly<{
      access: AccessDecision;
      mail: PinnedBetterAuthPasswordResetMailDoor;
    }>
  | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null || betterAuthIsProxy(value)) {
    throw new NativeTypeError('Better Auth passwordReset must be an object when enabled.');
  }
  const keys = betterAuthObjectKeys(value, 'Better Auth passwordReset options');
  if (
    keys.length !== 3 ||
    !hasKey(keys, 'access') ||
    !hasKey(keys, 'mail') ||
    !hasKey(keys, 'resetPath')
  ) {
    throw new NativeTypeError(
      'Better Auth passwordReset accepts exactly { access, mail, resetPath }.',
    );
  }
  const access = betterAuthOwnDataValue(value, 'access', 'Better Auth passwordReset options');
  const mail = betterAuthOwnDataValue(value, 'mail', 'Better Auth passwordReset options');
  const resetPath = betterAuthOwnDataValue(value, 'resetPath', 'Better Auth passwordReset options');
  if (access === undefined) {
    throw new NativeTypeError('Better Auth passwordReset.access is required.');
  }
  if (typeof resetPath !== 'string') {
    throw new NativeTypeError('Better Auth passwordReset.resetPath must be text.');
  }
  return betterAuthFreezeOwn(
    {
      access: access as AccessDecision,
      mail: createBetterAuthPasswordResetMailBinding(mail as BetterAuthPasswordResetMailDoor, {
        authBasePath: '/api/auth',
        baseURL,
        resetPath,
      }),
    },
    'Better Auth passwordReset feature',
  );
}

/** @internal Begin one account-recovery world with a same-shape decoy message already minted. */
export function beginBetterAuthPasswordResetMailAttempt(
  binding: PinnedBetterAuthPasswordResetMailDoor,
  request: Request,
  submittedEmail: string,
): BetterAuthPasswordResetMailAttempt {
  if (typeof request !== 'object' || request === null || betterAuthIsProxy(request)) {
    throw new NativeTypeError('Better Auth password-reset mail attempt requires a native request.');
  }
  if (betterAuthMapHas(requestMailAttempts, request)) {
    throw new NativeTypeError('KV439: duplicate Better Auth password-reset mail request attempt.');
  }
  const to = canonicalPasswordResetEmail(submittedEmail);
  const decoyToken = providerShapedDecoyToken();
  const attempt = betterAuthFreezeOwn(
    betterAuthCreateNullRecord<never>(),
    'Better Auth password-reset mail attempt',
  );
  const state: PasswordResetMailAttemptState = {
    binding,
    decoy: passwordResetMessage(to, resetUrl(binding, decoyToken)),
    request,
  };
  betterAuthMapSet(registeredMailAttempts, attempt, state);
  betterAuthMapSet(requestMailAttempts, request, attempt);
  return attempt as unknown as BetterAuthPasswordResetMailAttempt;
}

/** @internal Cancel a non-dispatchable attempt, such as a rate-limit or provider failure. */
export function cancelBetterAuthPasswordResetMailAttempt(
  attempt: BetterAuthPasswordResetMailAttempt,
): void {
  const state = requirePasswordResetMailAttempt(attempt);
  settlePasswordResetMailAttempt(attempt, state);
}

/** @internal Dispatch exactly one real-or-decoy message through the registered purpose door. */
export async function dispatchBetterAuthPasswordResetMail(
  attempt: BetterAuthPasswordResetMailAttempt,
): Promise<void> {
  const state = requirePasswordResetMailAttempt(attempt);
  settlePasswordResetMailAttempt(attempt, state);
  const consumer = betterAuthCredentialConsumers.passwordResetMailDispatch;
  const sealed = await runBetterAuthCredentialSourceCallableAsync<void>(
    consumer,
    'password-reset-mail.dispatch',
    state.binding.method,
    undefined,
    [state.captured ?? state.decoy],
  );
  consumeBetterAuthCredentialResult(consumer, sealed);
}

function captureProviderPasswordResetMail(
  binding: PinnedBetterAuthPasswordResetMailDoor,
  data: unknown,
  request: Request | undefined,
): void {
  if (typeof request !== 'object' || request === null || betterAuthIsProxy(request)) {
    throw new NativeTypeError('Better Auth password-reset mail callback lost request identity.');
  }
  const attempt = betterAuthMapGet(requestMailAttempts, request);
  if (attempt === undefined) {
    throw new NativeTypeError('KV439: unregistered Better Auth password-reset mail callback.');
  }
  const state = requirePasswordResetMailAttempt(attempt as BetterAuthPasswordResetMailAttempt);
  if (state.binding !== binding || state.captured !== undefined) {
    throw new NativeTypeError('KV439: mismatched Better Auth password-reset mail callback.');
  }
  if (typeof data !== 'object' || data === null || betterAuthIsProxy(data)) {
    throw new NativeTypeError('Better Auth password-reset mail data must be an object.');
  }
  const keys = betterAuthObjectKeys(data, 'Better Auth password-reset mail data');
  if (
    keys.length !== 3 ||
    !hasKey(keys, 'token') ||
    !hasKey(keys, 'url') ||
    !hasKey(keys, 'user')
  ) {
    throw new NativeTypeError('Better Auth password-reset mail data shape drifted.');
  }
  const token = ownText(data, 'token', 'Better Auth password-reset mail data');
  assertPasswordResetToken(token);
  const url = ownText(data, 'url', 'Better Auth password-reset mail data');
  const user = betterAuthOwnDataValue(data, 'user', 'Better Auth password-reset mail data');
  if (typeof user !== 'object' || user === null || betterAuthIsProxy(user)) {
    throw new NativeTypeError('Better Auth password-reset mail user must be an object.');
  }
  const to = canonicalPasswordResetEmail(
    ownText(user, 'email', 'Better Auth password-reset mail user'),
  );
  if (betterAuthToLowerCase(to) !== betterAuthToLowerCase(state.decoy.to)) {
    throw new NativeTypeError('Better Auth password-reset mail recipient changed across the door.');
  }
  if (url !== resetUrl(binding, token)) {
    throw new NativeTypeError(
      'Better Auth password-reset mail URL is outside the pinned callback purpose.',
    );
  }
  state.captured = passwordResetMessage(state.decoy.to, url);
}

function requirePasswordResetMailAttempt(
  attempt: BetterAuthPasswordResetMailAttempt,
): PasswordResetMailAttemptState {
  if ((typeof attempt !== 'object' && typeof attempt !== 'function') || attempt === null) {
    throw new NativeTypeError('KV439: unregistered password-reset mail attempt.');
  }
  const state = betterAuthMapGet(registeredMailAttempts, attempt as object);
  if (state === undefined) {
    throw new NativeTypeError('KV439: unregistered password-reset mail attempt.');
  }
  return state;
}

function settlePasswordResetMailAttempt(
  attempt: BetterAuthPasswordResetMailAttempt,
  state: PasswordResetMailAttemptState,
): void {
  if (
    !betterAuthMapDelete(registeredMailAttempts, attempt as object) ||
    !betterAuthMapDelete(requestMailAttempts, state.request)
  ) {
    throw new NativeTypeError('KV439: password-reset mail attempt could not be sealed.');
  }
}

function passwordResetMessage(
  to: string,
  resetUrlValue: string,
): Readonly<BetterAuthPasswordResetMailMessage> {
  const message = betterAuthCreateNullRecord<string>();
  betterAuthDefineOwnData(message, 'to', to, 'Better Auth password-reset mail message');
  betterAuthDefineOwnData(
    message,
    'resetUrl',
    resetUrlValue,
    'Better Auth password-reset mail message',
  );
  return betterAuthFreezeOwn(
    message,
    'Better Auth password-reset mail message',
  ) as unknown as Readonly<BetterAuthPasswordResetMailMessage>;
}

function resetUrl(binding: PinnedBetterAuthPasswordResetMailDoor, token: string): string {
  assertPasswordResetToken(token);
  const encodedResetPath = betterAuthReplaceAll(binding.resetPath, '/', '%2F');
  return (
    `${binding.baseURL}${binding.authBasePath}/reset-password/${token}` +
    `?callbackURL=${encodedResetPath}`
  );
}

function canonicalPurposePath(value: string, baseURL: string, label: string): string {
  if (typeof value !== 'string' || value.length < 2 || value.length > 1_024 || value[0] !== '/') {
    throw new NativeTypeError(`${label} must be a non-root path of at most 1,024 characters.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = betterAuthCharacterCodeAt(value, index);
    const permitted =
      code === 0x2d ||
      code === 0x2f ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);
    if (!permitted) {
      throw new NativeTypeError(`${label} must use only ASCII path segments.`);
    }
  }
  const snapshot = betterAuthUrlSnapshot(value, `${baseURL}/`);
  if (
    snapshot.origin !== baseURL ||
    snapshot.pathname !== value ||
    snapshot.search !== '' ||
    snapshot.hash !== '' ||
    snapshot.username !== '' ||
    snapshot.password !== ''
  ) {
    throw new NativeTypeError(`${label} must be a canonical same-origin path.`);
  }
  return value;
}

function canonicalPasswordResetEmail(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > maximumPasswordResetEmailLength ||
    betterAuthTrim(value) !== value
  ) {
    throw new NativeTypeError('Better Auth password-reset mail recipient must be a valid email.');
  }
  let atCount = 0;
  let atIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const code = betterAuthCharacterCodeAt(value, index);
    if (code <= 0x20 || code === 0x7f) {
      throw new NativeTypeError('Better Auth password-reset mail recipient must be a valid email.');
    }
    if (code === 0x40) {
      atCount += 1;
      atIndex = index;
    }
  }
  if (atCount !== 1 || atIndex < 1 || atIndex === value.length - 1) {
    throw new NativeTypeError('Better Auth password-reset mail recipient must be a valid email.');
  }
  return value;
}

function assertPasswordResetToken(token: string): void {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > maximumPasswordResetTokenLength ||
    betterAuthIndexOf(token, '.') !== -1
  ) {
    throw new NativeTypeError('Better Auth password-reset mail token is invalid.');
  }
  for (let index = 0; index < token.length; index += 1) {
    const code = betterAuthCharacterCodeAt(token, index);
    const permitted =
      code === 0x2d ||
      code === 0x5f ||
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);
    if (!permitted) {
      throw new NativeTypeError('Better Auth password-reset mail token is invalid.');
    }
  }
}

function providerShapedDecoyToken(): string {
  return passwordResetCrypto.mintDecoyToken();
}

function ownText(source: object, key: PropertyKey, label: string): string {
  const value = betterAuthOwnDataValue(source, key, label);
  if (typeof value !== 'string') {
    throw new NativeTypeError(`${label}.${String(key)} must be text.`);
  }
  return value;
}

function hasKey(keys: readonly string[], expected: string): boolean {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === expected) return true;
  }
  return false;
}

function invalidMailDoor(): TypeError {
  return new NativeTypeError(
    'KV439: Better Auth password reset requires an opaque password-reset mail door.',
  );
}

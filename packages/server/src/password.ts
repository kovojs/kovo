import type { Options as Argon2Options } from '@node-rs/argon2';

declare const passwordDigestBrand: unique symbol;

/**
 * Argon2id PHC digest produced by {@link hashPassword}.
 *
 * This brand is an API chokepoint marker only. Per SPEC §6.6, password hashing is a
 * runtime defense-in-depth floor at the hash/verify sink; it is not a proof of overall
 * authentication strength and does not replace the future KV438 password-column write gate.
 */
export type PasswordDigest = string & { readonly [passwordDigestBrand]: 'argon2id' };

/** Argon2id parameters Kovo accepts for first-party password hashing. */
export interface PasswordHashOptions {
  /**
   * Memory cost in KiB. Defaults to, and may not go below, 19 MiB (OWASP's Argon2id floor).
   */
  memoryCost?: number;
  /**
   * Iteration count. Defaults to, and may not go below, 2.
   */
  timeCost?: number;
  /**
   * Degree of parallelism. Defaults to, and may not go below, 1.
   */
  parallelism?: number;
  /**
   * Raw digest byte length before PHC encoding. Defaults to, and may not go below, 32.
   */
  outputLen?: number;
  /** Optional cancellation signal passed to the Argon2 worker. */
  signal?: AbortSignal;
}

/** Result of verifying a plaintext password against an argon2id digest. */
export interface PasswordVerifyResult {
  /** True only when the digest is argon2id and the password matches. */
  ok: boolean;
  /**
   * True when the digest verifies but uses weaker parameters than this call's configured floor.
   * Apps can use this to re-hash after successful login; Kovo does not mutate storage here.
   */
  needsRehash: boolean;
}

/** Result of verifying an account credential without exposing whether the account existed. */
export interface CredentialVerifyResult {
  /** True only when a stored account digest exists, is accepted by Kovo, and the secret matches. */
  ok: boolean;
  /**
   * True when the credential verifies but uses weaker parameters than this call's configured floor.
   * Apps can use this to re-hash after successful login; Kovo does not mutate storage here.
   */
  needsRehash: boolean;
}

const NativeError = globalThis.Error;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeRangeError = globalThis.RangeError;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpExec = RegExp.prototype.exec;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;

function passwordApply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function passwordArrayAppend<Value>(target: Value[], value: Value): void {
  const length = target.length;
  passwordApply(nativeObjectDefineProperty, NativeObject, [
    target,
    length,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = passwordApply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [target, length],
  );
  if (committed === undefined || !('value' in committed) || committed.value !== value) {
    throw new NativeTypeError('Password parser own-data append failed.');
  }
}

function rawSplitLiteral(value: string, separator: string): string[] {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor <= value.length) {
    const match = passwordApply<number>(nativeStringIndexOf, value, [separator, cursor]);
    if (match < 0) {
      passwordArrayAppend(parts, passwordApply(nativeStringSlice, value, [cursor]));
      return parts;
    }
    passwordArrayAppend(parts, passwordApply(nativeStringSlice, value, [cursor, match]));
    cursor = match + separator.length;
  }
  return parts;
}

function capturedPasswordControlsAreSound(): boolean {
  try {
    const parts = rawSplitLiteral('$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$ZGlnZXN0', '$');
    const map = new NativeMap<string, string>();
    passwordApply(nativeMapSet, map, ['safe', 'value']);
    const frozen = passwordApply<object>(nativeObjectFreeze, NativeObject, [{ floor: 19_456 }]);
    return (
      parts.length === 6 &&
      parts[0] === '' &&
      parts[1] === 'argon2id' &&
      parts[2] === 'v=19' &&
      parts[3] === 'm=19456,t=2,p=1' &&
      parts[4] === 'c2FsdA' &&
      parts[5] === 'ZGlnZXN0' &&
      passwordApply(nativeMapGet, map, ['safe']) === 'value' &&
      passwordApply(nativeMapGet, map, ['other']) === undefined &&
      passwordApply(nativeNumberIsSafeInteger, NativeNumber, [19_456]) === true &&
      passwordApply(nativeNumberIsSafeInteger, NativeNumber, [19_456.5]) === false &&
      passwordApply(NativeNumber, undefined, ['19456']) === 19_456 &&
      passwordApply(NativeNumber, undefined, ['not-a-number']) !==
        passwordApply(NativeNumber, undefined, ['not-a-number']) &&
      passwordApply<RegExpExecArray | null>(nativeRegExpExec, /^[A-Za-z0-9+/]+$/u, [
        'c2FsdA',
      ])?.[0] === 'c2FsdA' &&
      passwordApply<RegExpExecArray | null>(nativeRegExpExec, /^[A-Za-z0-9+/]+$/u, [
        'not-base64?',
      ]) === null &&
      passwordApply(nativeObjectIsFrozen, NativeObject, [frozen]) === true
    );
  } catch {
    return false;
  }
}

const capturedPasswordControlsSound = capturedPasswordControlsAreSound();

/** @internal Assert the password sink's boot-pinned scalar and cache controls. */
export function assertPasswordIntrinsics(): void {
  if (!capturedPasswordControlsSound) {
    throw new NativeTypeError(
      'Kovo password controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

function passwordFreeze<Value extends object>(value: Value): Readonly<Value> {
  assertPasswordIntrinsics();
  return passwordApply(nativeObjectFreeze, NativeObject, [value]);
}

function passwordMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertPasswordIntrinsics();
  return passwordApply(nativeMapGet, map, [key]);
}

function passwordMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertPasswordIntrinsics();
  passwordApply(nativeMapSet, map, [key, value]);
}

function passwordSplitLiteral(value: string, separator: string): string[] {
  assertPasswordIntrinsics();
  return rawSplitLiteral(value, separator);
}

function passwordRegExpTest(pattern: RegExp, value: string): boolean {
  assertPasswordIntrinsics();
  pattern.lastIndex = 0;
  return passwordApply<RegExpExecArray | null>(nativeRegExpExec, pattern, [value]) !== null;
}

function passwordNumber(value: string): number {
  assertPasswordIntrinsics();
  return passwordApply(NativeNumber, undefined, [value]);
}

function passwordIsSafeInteger(value: number): boolean {
  assertPasswordIntrinsics();
  return passwordApply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

/**
 * Default and minimum password hashing parameters. Kovo exposes no bcrypt, scrypt, SHA, or raw
 * Argon2 algorithm knob; the sink always emits argon2id/v=19 PHC strings.
 */
export const PASSWORD_ARGON2ID_DEFAULTS = passwordFreeze({
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const PASSWORD_ARGON2ID_MAX = passwordFreeze({
  memoryCost: 2 ** 32 - 1,
  timeCost: 2 ** 32 - 1,
  parallelism: 255,
  outputLen: 2 ** 32 - 1,
});

const ARGON2ID_ALGORITHM = 2;
const ARGON2_VERSION_13 = 1;
const PHC_BASE64 = /^[A-Za-z0-9+/]+$/;

/**
 * Framework-owned fixed plaintext used when hashing the per-param-set decoy digest.
 * Not a user credential; serves only to produce a correctly-costed argon2id PHC string.
 * SPEC §6.6: absent-account verification work must match the call's resolved floor.
 */
const CREDENTIAL_DECOY_SECRET = 'kovo.credential-verify.decoy';

/**
 * Per-param-set decoy digest cache.
 *
 * Keyed by canonical "m=N,t=N,p=N,len=N" string; value is a Promise<string> so that
 * concurrent absent-account logins with the same params share a single hash computation
 * rather than each triggering a separate (expensive) argon2 hash.
 *
 * SPEC §6.6: the decoy must be derived from the call's resolved params (not the compile-time
 * floor constant) so absent-account timing matches present-account timing even when the app
 * configures stronger hashing than the minimum floor.
 */
const decoyDigestCache = new NativeMap<string, Promise<string>>();

function decoyParamKey(params: Argon2Options): string {
  return `m=${params.memoryCost},t=${params.timeCost},p=${params.parallelism},len=${params.outputLen}`;
}

/**
 * Lazily produce (and cache) an argon2id PHC digest whose encoded m/t/p/outputLen match
 * the given resolved params.  The decoy is hashed against the fixed framework-owned
 * `CREDENTIAL_DECOY_SECRET`, not against user-supplied data.
 */
async function getDecoyDigest(params: Argon2Options): Promise<string> {
  const key = decoyParamKey(params);
  let pending = passwordMapGet(decoyDigestCache, key);
  if (!pending) {
    // Set the Promise before awaiting so concurrent callers all receive the same Promise.
    pending = (async () => {
      const { hash } = await loadArgon2();
      // No AbortSignal: the decoy computation is cached across requests and must not be
      // abandoned mid-flight (a cancelled hash would leave the cache slot unresolved).
      return hash(CREDENTIAL_DECOY_SECRET, params, null);
    })();
    passwordMapSet(decoyDigestCache, key, pending);
  }
  return pending;
}

type Argon2Module = typeof import('@node-rs/argon2');

let argon2ModulePromise: Promise<Argon2Module> | undefined;

function loadArgon2(): Promise<Argon2Module> {
  argon2ModulePromise ??= import('@node-rs/argon2');
  return argon2ModulePromise;
}

/**
 * Hash a plaintext password with Kovo's first-party argon2id-only sink.
 *
 * SPEC §6.6: this is a runtime floor at the cryptographic sink, deliberately narrow. App code
 * cannot select a fast hash or legacy verifier through this API.
 */
export async function hashPassword(
  password: string | Uint8Array,
  options: PasswordHashOptions = {},
): Promise<PasswordDigest> {
  const params = resolvePasswordHashOptions(options);
  const { hash } = await loadArgon2();
  const digest = await hash(password, params, options.signal ?? null);
  if (!isArgon2idPasswordDigest(digest)) {
    throw new NativeError(
      'Kovo password sink expected @node-rs/argon2 to emit an argon2id PHC digest.',
    );
  }
  return digest;
}

/**
 * Verify a plaintext password against a Kovo argon2id digest.
 *
 * Non-argon2id, malformed, or legacy digests fail closed with `{ ok: false }`; they are not passed
 * through to the underlying library where bcrypt/scrypt/SHA-style fallback behavior could appear.
 */
export async function verifyPassword(
  password: string | Uint8Array,
  digest: string,
  options: PasswordHashOptions = {},
): Promise<PasswordVerifyResult> {
  const params = resolvePasswordHashOptions(options);
  const parsed = parseArgon2idPasswordDigest(digest);
  if (parsed === undefined) return { ok: false, needsRehash: false };

  return verifyParsedPasswordDigest(password, digest, parsed, params, options.signal ?? null);
}

/**
 * Verify a login credential while doing argon2id work even when the account is absent.
 *
 * SPEC §6.6: this is a runtime defense-in-depth floor at the credential verification sink. Missing,
 * malformed, or legacy stored digests verify against a framework-owned argon2id decoy digest
 * derived from the call's resolved params, so absent-account work matches present-account work at
 * any configured cost level and this helper boundary does not expose user existence through timing.
 */
export async function verifyCredential(
  secret: string | Uint8Array,
  storedDigest: string | null | undefined,
  options: PasswordHashOptions = {},
): Promise<CredentialVerifyResult> {
  const params = resolvePasswordHashOptions(options);
  const parsed =
    storedDigest === null || storedDigest === undefined
      ? undefined
      : parseArgon2idPasswordDigest(storedDigest);

  // When no valid digest is present, derive the decoy from the call's resolved params so the
  // argon2 library reads the correct m/t/p from the PHC header and does equivalent work.
  // A decoy pinned to the compile-time floor would be faster than a present-account digest
  // hashed with stronger params, leaking existence through timing (bugz M3).
  const decoy = parsed === undefined ? await getDecoyDigest(params) : undefined;
  const digest = decoy ?? storedDigest!;
  const result = await verifyParsedPasswordDigest(
    secret,
    digest,
    parsed ?? parseArgon2idPasswordDigest(decoy!)!,
    params,
    options.signal ?? null,
  );

  if (parsed === undefined) return { ok: false, needsRehash: false };
  return result;
}

async function verifyParsedPasswordDigest(
  password: string | Uint8Array,
  digest: string,
  parsed: ParsedArgon2idDigest,
  params: Argon2Options,
  signal: AbortSignal | null,
): Promise<PasswordVerifyResult> {
  try {
    const { verify } = await loadArgon2();
    const ok = await verify(digest, password, params, signal);
    return { ok, needsRehash: ok && digestNeedsRehash(parsed, params) };
  } catch {
    return { ok: false, needsRehash: false };
  }
}

/** Runtime guard for stored digests accepted by {@link verifyPassword}. */
export function isArgon2idPasswordDigest(digest: string): digest is PasswordDigest {
  return parseArgon2idPasswordDigest(digest) !== undefined;
}

function resolvePasswordHashOptions(options: PasswordHashOptions): Argon2Options {
  const memoryCost = integerOption(
    'memoryCost',
    options.memoryCost,
    PASSWORD_ARGON2ID_DEFAULTS.memoryCost,
  );
  const timeCost = integerOption('timeCost', options.timeCost, PASSWORD_ARGON2ID_DEFAULTS.timeCost);
  const parallelism = integerOption(
    'parallelism',
    options.parallelism,
    PASSWORD_ARGON2ID_DEFAULTS.parallelism,
  );
  const outputLen = integerOption(
    'outputLen',
    options.outputLen,
    PASSWORD_ARGON2ID_DEFAULTS.outputLen,
  );

  enforceFloor('memoryCost', memoryCost, PASSWORD_ARGON2ID_DEFAULTS.memoryCost);
  enforceFloor('timeCost', timeCost, PASSWORD_ARGON2ID_DEFAULTS.timeCost);
  enforceFloor('parallelism', parallelism, PASSWORD_ARGON2ID_DEFAULTS.parallelism);
  enforceFloor('outputLen', outputLen, PASSWORD_ARGON2ID_DEFAULTS.outputLen);

  enforceMax('memoryCost', memoryCost, PASSWORD_ARGON2ID_MAX.memoryCost);
  enforceMax('timeCost', timeCost, PASSWORD_ARGON2ID_MAX.timeCost);
  enforceMax('parallelism', parallelism, PASSWORD_ARGON2ID_MAX.parallelism);
  enforceMax('outputLen', outputLen, PASSWORD_ARGON2ID_MAX.outputLen);

  return {
    algorithm: ARGON2ID_ALGORITHM,
    memoryCost,
    outputLen,
    parallelism,
    timeCost,
    version: ARGON2_VERSION_13,
  };
}

function integerOption(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!passwordIsSafeInteger(value)) {
    throw new NativeRangeError(`Kovo password ${name} must be a safe integer.`);
  }
  return value;
}

function enforceFloor(name: string, value: number, floor: number): void {
  if (value < floor) {
    throw new NativeRangeError(`Kovo password ${name} must be >= ${floor}.`);
  }
}

function enforceMax(name: string, value: number, max: number): void {
  if (value > max) {
    throw new NativeRangeError(`Kovo password ${name} must be <= ${max}.`);
  }
}

interface ParsedArgon2idDigest {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

function parseArgon2idPasswordDigest(digest: string): ParsedArgon2idDigest | undefined {
  const parts = passwordSplitLiteral(digest, '$');
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') return undefined;
  if (parts[2] !== 'v=19') return undefined;
  if (!isPhcBase64(parts[4]) || !isPhcBase64(parts[5])) return undefined;

  let memoryValue: string | undefined;
  let timeValue: string | undefined;
  let parallelismValue: string | undefined;
  const entries = passwordSplitLiteral(parts[3]!, ',');
  for (let index = 0; index < entries.length; index += 1) {
    const [key, value, extra] = passwordSplitLiteral(entries[index]!, '=');
    if (key === undefined || value === undefined || extra !== undefined) return undefined;
    if (key !== 'm' && key !== 't' && key !== 'p') return undefined;
    if (key === 'm') {
      if (memoryValue !== undefined) return undefined;
      memoryValue = value;
    } else if (key === 't') {
      if (timeValue !== undefined) return undefined;
      timeValue = value;
    } else {
      if (parallelismValue !== undefined) return undefined;
      parallelismValue = value;
    }
  }
  const memoryCost = parsePositiveInt(memoryValue);
  const timeCost = parsePositiveInt(timeValue);
  const parallelism = parsePositiveInt(parallelismValue);
  if (memoryCost === undefined || timeCost === undefined || parallelism === undefined) {
    return undefined;
  }
  return { memoryCost, timeCost, parallelism };
}

function isPhcBase64(value: string | undefined): boolean {
  return value !== undefined && passwordRegExpTest(PHC_BASE64, value);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || !passwordRegExpTest(/^[1-9][0-9]*$/u, value)) return undefined;
  const parsed = passwordNumber(value);
  return passwordIsSafeInteger(parsed) ? parsed : undefined;
}

function digestNeedsRehash(parsed: ParsedArgon2idDigest, params: Argon2Options): boolean {
  return (
    parsed.memoryCost < params.memoryCost! ||
    parsed.timeCost < params.timeCost! ||
    parsed.parallelism < params.parallelism!
  );
}

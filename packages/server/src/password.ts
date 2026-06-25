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

/**
 * Default and minimum password hashing parameters. Kovo exposes no bcrypt, scrypt, SHA, or raw
 * Argon2 algorithm knob; the sink always emits argon2id/v=19 PHC strings.
 */
export const PASSWORD_ARGON2ID_DEFAULTS = Object.freeze({
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const PASSWORD_ARGON2ID_MAX = Object.freeze({
  memoryCost: 2 ** 32 - 1,
  timeCost: 2 ** 32 - 1,
  parallelism: 255,
  outputLen: 2 ** 32 - 1,
});

const ARGON2ID_ALGORITHM = 2;
const ARGON2_VERSION_13 = 1;
const PHC_ARGON2ID_PREFIX = '$argon2id$';
const PHC_BASE64 = /^[A-Za-z0-9+/]+$/;
const CREDENTIAL_VERIFY_DECOY_DIGEST =
  '$argon2id$v=19$m=19456,t=2,p=1$wUyZMkz0f9Q8lxUmpoYhWQ$lJqAy+vFypMXMsFlJiUhrBBU1Spa3MLjUIbzYeLk6ZA';

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
    throw new Error('Kovo password sink expected @node-rs/argon2 to emit an argon2id PHC digest.');
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
 * malformed, or legacy stored digests verify against a fixed framework-owned argon2id decoy digest
 * and return the same generic failed shape, so this helper boundary does not expose user existence.
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
  const digest = parsed === undefined ? CREDENTIAL_VERIFY_DECOY_DIGEST : storedDigest!;
  const result = await verifyParsedPasswordDigest(
    secret,
    digest,
    parsed ?? parseArgon2idPasswordDigest(CREDENTIAL_VERIFY_DECOY_DIGEST)!,
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
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Kovo password ${name} must be a safe integer.`);
  }
  return value;
}

function enforceFloor(name: string, value: number, floor: number): void {
  if (value < floor) {
    throw new RangeError(`Kovo password ${name} must be >= ${floor}.`);
  }
}

function enforceMax(name: string, value: number, max: number): void {
  if (value > max) {
    throw new RangeError(`Kovo password ${name} must be <= ${max}.`);
  }
}

interface ParsedArgon2idDigest {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

function parseArgon2idPasswordDigest(digest: string): ParsedArgon2idDigest | undefined {
  if (!digest.startsWith(PHC_ARGON2ID_PREFIX)) return undefined;
  const parts = digest.split('$');
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id') return undefined;
  if (parts[2] !== 'v=19') return undefined;
  if (!isPhcBase64(parts[4]) || !isPhcBase64(parts[5])) return undefined;

  const params = new Map<string, string>();
  for (const entry of parts[3]!.split(',')) {
    const [key, value, extra] = entry.split('=');
    if (key === undefined || value === undefined || extra !== undefined) return undefined;
    if (key !== 'm' && key !== 't' && key !== 'p') return undefined;
    if (params.has(key)) return undefined;
    params.set(key, value);
  }
  if (params.size !== 3) return undefined;
  const memoryCost = parsePositiveInt(params.get('m'));
  const timeCost = parsePositiveInt(params.get('t'));
  const parallelism = parsePositiveInt(params.get('p'));
  if (memoryCost === undefined || timeCost === undefined || parallelism === undefined) {
    return undefined;
  }
  return { memoryCost, timeCost, parallelism };
}

function isPhcBase64(value: string | undefined): boolean {
  return value !== undefined && PHC_BASE64.test(value);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function digestNeedsRehash(parsed: ParsedArgon2idDigest, params: Argon2Options): boolean {
  return (
    parsed.memoryCost < params.memoryCost! ||
    parsed.timeCost < params.timeCost! ||
    parsed.parallelism < params.parallelism!
  );
}

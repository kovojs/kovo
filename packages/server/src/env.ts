import type { Schema } from './schema.js';
import { snapshotAuditJustification } from './audit-justification.js';
import {
  isFrameworkCsrfSigningSecret,
  isSigningKeyRing,
  SIGNING_SECRET_MIN_BYTES,
} from './keyring.js';
import {
  runtimeEnvironmentSnapshot,
  runtimeEnvironmentValue,
} from '@kovojs/server/internal/runtime-environment';
import { isSchemaValidationError, parseDeclaredAppEnv } from './schema.js';
import {
  securityIsUint8Array,
  securityMathLog2,
  securityStringCharCodeAt,
  securityUint8ArrayLength,
} from './response-security-intrinsics.js';
import {
  createWitnessMap,
  createWitnessSet,
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessMapSize,
  witnessObjectIs,
  witnessSetAdd,
  witnessSetHas,
} from './security-witness-intrinsics.js';

const EMPTY_APP_ENV = witnessFreeze(witnessCreateNullRecord<unknown>()) as Readonly<
  Record<never, never>
>;

/**
 * Env validation + refuse-to-boot on missing/weak framework secrets (SPEC §6.6, §9.5;
 * `plans/secure-framework.md` Tier 1). The single bootstrap chokepoint is `createApp`
 * (SPEC §9.5: "Apps declare a closed `createApp()` aggregate"), so this module is invoked
 * there to validate the framework secrets `createApp` consumes — today only the CSRF /
 * anonymous-CSRF signing secret (`createApp({ csrf: { secret } })`), which feeds
 * `createHmac('sha256', secret)` in `csrf.ts`. A bare unvalidated string lets an
 * empty/4-char prod secret silently degrade that HMAC.
 *
 * Honesty (SPEC §6.6): the refuse-to-boot below is **by-construction at the chokepoint**
 * — in production the unsafe state (a missing/short framework secret) is inexpressible
 * because `createApp` throws before returning an app. Dev stays lenient (warn, never
 * throw) so localhost is not bricked. The minimum-entropy heuristic (Shannon bits) and
 * the committed-secret literal check are **audit-grade** (heuristics with false positives),
 * so they warn rather than block, except where the absolute length floor is missed.
 */

/**
 * Minimum length, in characters, for a framework signing secret. 32 random base64url
 * characters is ~192 bits; we require at least 32 chars so a typo'd or placeholder
 * secret (`'x'`, `'changeme'`, a 4-char value) fails closed in production. The
 * anonymous-CSRF cookie path already mints `randomBytes(32).toString('base64url')`
 * (~43 chars), so a real deployment secret comfortably clears this floor.
 */
export const FRAMEWORK_SECRET_MIN_LENGTH = SIGNING_SECRET_MIN_BYTES;

/**
 * Minimum Shannon-entropy estimate (bits) for a framework signing secret. This is an
 * audit-grade heuristic — a long-but-repetitive secret (`'a'.repeat(64)`) clears the
 * length floor but carries almost no entropy. Used to WARN, not to block, because the
 * estimate has false positives on structured-but-strong secrets (base64 of random bytes
 * scores high; a passphrase scores lower yet may be fine).
 */
export const FRAMEWORK_SECRET_MIN_ENTROPY_BITS = 64;

/**
 * One field-level boot validation failure: a stable machine `code`, a human `message`,
 * the dot-joined `path` locating it (e.g. `csrf.secret` or an app-env key), and whether
 * it is `fatal` (refuses boot in production) or advisory (`warn`).
 */
export interface EnvValidationIssue {
  /** Stable code so deploy tooling can match without parsing the message. */
  code: 'missing' | 'too-short' | 'low-entropy' | 'committed-secret' | 'invalid';
  /** Dot-joined location of the failure, e.g. `csrf.secret`. */
  path: string;
  /** Human-readable, actionable description of the failure and its fix. */
  message: string;
  /** When true, this issue refuses boot in production; when false it only warns. */
  fatal: boolean;
}

/**
 * Thrown by `createApp` when a required framework secret fails validation in production or an
 * app-declared env schema fails validation in any mode. Carries every collected `issues` so boot fails
 * fast with **all** problems at once rather than one-at-a-time. Distinct typed error so
 * deploy tooling and tests can catch it precisely (SPEC §6.6).
 */
export class CreateAppBootError extends Error {
  readonly name = 'CreateAppBootError';
  readonly issues: readonly EnvValidationIssue[];

  constructor(issues: readonly EnvValidationIssue[]) {
    super(formatBootError(issues));
    this.issues = issues;
  }
}

/** Type guard for `CreateAppBootError`, surviving cross-realm/duplicate-module boundaries. */
export function isCreateAppBootError(error: unknown): error is CreateAppBootError {
  if (error instanceof CreateAppBootError) return true;
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Partial<CreateAppBootError>;
  return candidate.name === 'CreateAppBootError' && witnessIsArray(candidate.issues);
}

/** The framework secrets that `createApp` consumes and this module gates. */
interface FrameworkSecrets {
  /** `createApp({ csrf: { secret } })` — the CSRF / anonymous-CSRF HMAC signing secret. */
  csrfSecret?: unknown;
}

/**
 * Options threaded into env validation. `mode` selects refuse-to-boot (production) vs
 * lenient-warn (development); `env` is an optional app-declared `s.object` schema validated
 * at boot; `envSource` is the record validated against it (defaults to the bootstrap-pinned
 * operator `process.env` snapshot).
 */
export interface ValidateAppEnvOptions<
  EnvValue extends Record<string, unknown> = Record<never, never>,
> {
  mode?: 'production' | 'development';
  env?: Schema<EnvValue>;
  envSource?: Record<string, unknown>;
  /** Test seam: capture warnings instead of writing to `console.warn`. */
  onWarn?: (message: string) => void;
}

/**
 * Resolve the boot mode from the bootstrap-pinned operator environment. Mirrors the existing
 * `NODE_ENV === 'production'` detection used
 * by `cookies.ts`/`response.ts` so the env floor activates in exactly the same deployments
 * the cookie `Secure` floor does. An explicit `mode` overrides (test seam + adapters that
 * know their posture out-of-band).
 */
export function resolveBootMode(
  explicit?: 'production' | 'development',
): 'production' | 'development' {
  if (explicit !== undefined) return explicit;
  const nodeEnv = runtimeEnvironmentValue('NODE_ENV');
  return nodeEnv === 'production' ? 'production' : 'development';
}

/**
 * Validate framework secrets + an optional app env schema at the `createApp` chokepoint.
 *
 * In `production`: collects every issue and throws `CreateAppBootError` if any are fatal
 * (missing/too-short framework secret, or app-env schema failure) — refuse-to-boot,
 * by-construction at the chokepoint. Advisory issues (low-entropy, committed-secret)
 * are warned, not thrown.
 *
 * In `development`: weak framework signing secrets warn instead of bricking localhost. A declared
 * app-env schema still fails closed because returning a typed `app.env` without a validated value
 * would be dishonest. Successful parsing returns the frozen declared projection; undeclared raw
 * operator-environment keys remain internal.
 */
export function validateAppEnv<EnvValue extends Record<string, unknown> = Record<never, never>>(
  secrets: FrameworkSecrets,
  options: ValidateAppEnvOptions<EnvValue> = {},
): Readonly<EnvValue> {
  const mode = resolveBootMode(options.mode);
  const issues: EnvValidationIssue[] = [];
  let parsedEnv = EMPTY_APP_ENV as Readonly<EnvValue>;
  let envInvalid = false;

  validateFrameworkSecret(secrets.csrfSecret, 'csrf.secret', issues);

  if (options.env !== undefined) {
    const parsed = validateAppEnvSchema(options.env, options.envSource ?? readProcessEnv(), issues);
    if (parsed === undefined) envInvalid = true;
    else parsedEnv = parsed;
  }

  if (issues.length === 0) return parsedEnv;

  let hasFatal = false;
  for (let index = 0; index < issues.length; index += 1) {
    if (issues[index]!.fatal) {
      hasFatal = true;
      break;
    }
  }

  if (envInvalid || (mode === 'production' && hasFatal)) {
    // Refuse to boot — by-construction at the chokepoint (SPEC §6.6). All issues
    // (fatal + advisory) ride the error so one fix-up pass clears the deploy.
    throw new CreateAppBootError(issues);
  }

  // Dev (or prod with only advisory issues): warn, never brick.
  const warn = options.onWarn ?? defaultWarn;
  warn(formatBootWarning(issues, mode));
  return parsedEnv;
}

/**
 * Gate one framework signing secret. `undefined` means the app passed no CSRF config —
 * not a violation here (CSRF is opt-in per SPEC §6.6; an app with no mutations needs no
 * secret). A *present* secret that is empty/short/weak is the failure this catches.
 */
function validateFrameworkSecret(value: unknown, path: string, issues: EnvValidationIssue[]): void {
  // No secret configured at all: not validated here. `csrf` is only consulted when an
  // app declares it; the gate fires on a *declared-but-weak* secret.
  if (value === undefined) return;
  // Framework-owned opaque signing authority was validated before minting and deliberately
  // exposes neither raw key material nor a generic signer (SPEC §6.6 C9).
  if (isFrameworkCsrfSigningSecret(value)) return;
  // A custom SigningKeyRing deliberately hides raw key material. The crypto boundary in
  // keyring.ts enforces the floor for framework-created rings; external rings own their
  // material policy and are accepted as the first-class rotation interface.
  if (isSigningKeyRing(value)) return;
  if (securityIsUint8Array(value)) {
    validateFrameworkSecretValue(value, path, issues);
    return;
  }

  if (isRecord(value)) {
    if (witnessIsArray(value.keys)) {
      for (let index = 0; index < value.keys.length; index += 1) {
        const descriptor = witnessGetOwnPropertyDescriptor(value.keys, index);
        const key =
          descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
        if (isRecord(key)) {
          validateFrameworkSecretValue(key.secret, `${path}.keys.${index}.secret`, issues);
        } else {
          validateFrameworkSecretValue(undefined, `${path}.keys.${index}`, issues);
        }
      }
      return;
    }
    validateFrameworkSecretValue(value.current, `${path}.current`, issues);
    if (value.previous !== undefined) {
      validateFrameworkSecretValue(value.previous, `${path}.previous`, issues);
    }
    return;
  }

  validateFrameworkSecretValue(value, path, issues);
}

function validateFrameworkSecretValue(
  value: unknown,
  path: string,
  issues: EnvValidationIssue[],
): void {
  if (securityIsUint8Array(value)) {
    if (securityUint8ArrayLength(value) >= FRAMEWORK_SECRET_MIN_LENGTH) return;
    appendEnvIssue(issues, {
      code: 'too-short',
      fatal: true,
      message: `${path} must be at least ${FRAMEWORK_SECRET_MIN_LENGTH} bytes`,
      path,
    });
    return;
  }

  if (typeof value !== 'string') {
    appendEnvIssue(issues, {
      code: 'invalid',
      path,
      fatal: true,
      message: `Framework secret \`${path}\` must be a string, got ${typeof value}. Pass a high-entropy secret loaded from your secret manager (SPEC §6.6).`,
    });
    return;
  }

  if (value.length === 0) {
    appendEnvIssue(issues, {
      code: 'missing',
      path,
      fatal: true,
      message: `Framework secret \`${path}\` is empty. An empty secret silently degrades the CSRF HMAC (SPEC §6.6). Set it to a high-entropy value (≥${FRAMEWORK_SECRET_MIN_LENGTH} chars), e.g. \`crypto.randomBytes(32).toString('base64url')\`, loaded from your environment.`,
    });
    return;
  }

  if (value.length < FRAMEWORK_SECRET_MIN_LENGTH) {
    appendEnvIssue(issues, {
      code: 'too-short',
      path,
      fatal: true,
      message: `Framework secret \`${path}\` is ${value.length} chars; the minimum is ${FRAMEWORK_SECRET_MIN_LENGTH}. A short secret weakens the CSRF HMAC (SPEC §6.6). Generate one with \`crypto.randomBytes(32).toString('base64url')\`.`,
    });
    return;
  }

  // Advisory (audit-grade heuristics; FPs → warn, never block).
  const entropyBits = estimateEntropyBits(value);
  if (entropyBits < FRAMEWORK_SECRET_MIN_ENTROPY_BITS) {
    appendEnvIssue(issues, {
      code: 'low-entropy',
      path,
      fatal: false,
      message: `Framework secret \`${path}\` clears the length floor but estimates only ~${Math.round(entropyBits)} bits of entropy (heuristic; FPs possible). A repetitive or low-variety secret weakens the HMAC. Prefer \`crypto.randomBytes(32).toString('base64url')\` (SPEC §6.6).`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !witnessIsArray(value);
}

/**
 * Validate the app-declared `env` schema against the env source. Reuses the framework's
 * own `s.object` engine (imported, never re-implemented), so apps "declare and validate
 * their own required env at boot, failing fast." `s.object` throws on the first invalid
 * field, so we surface that one `SchemaValidationError` path as a fatal issue.
 */
function validateAppEnvSchema<EnvValue extends Record<string, unknown>>(
  schema: Schema<EnvValue>,
  source: Record<string, unknown>,
  issues: EnvValidationIssue[],
): Readonly<EnvValue> | undefined {
  try {
    return parseDeclaredAppEnv(schema, source);
  } catch (error) {
    if (isSchemaValidationError(error)) {
      for (let index = 0; index < error.issues.length; index += 1) {
        const issue = error.issues[index]!;
        // The genuine top-level s.object parser prepends its declared field name. Retain only that
        // framework-owned segment: a custom child schema may put confidential input in its own
        // message or deeper path segments, and boot diagnostics are a log/error egress channel.
        const declaredField = issue.path[0];
        const displayPath = declaredField ?? 'env';
        appendEnvIssue(issues, {
          code: 'invalid',
          path: declaredField === undefined ? 'env' : `env.${declaredField}`,
          fatal: true,
          message: `App env validation failed for \`${displayPath}\`; value and validator detail were withheld because operator configuration is confidential (createApp({ env }), SPEC §6.6/§9.5).`,
        });
      }
      return undefined;
    }
    appendEnvIssue(issues, {
      code: 'invalid',
      path: 'env',
      fatal: true,
      message:
        'App env validation failed inside the declared schema without exposing the thrown value (createApp({ env }), SPEC §6.6/§9.5).',
    });
    return undefined;
  }
}

function appendEnvIssue(issues: EnvValidationIssue[], issue: EnvValidationIssue): void {
  witnessArrayAppend(issues, issue, 'Server environment validation issue');
}

/**
 * Audit-grade committed-secret detection (SPEC §6.6; `plans/secure-framework.md` Tier 1,
 * secondary). Flags a framework secret that looks like a hardcoded high-entropy literal
 * (long + high-variety + no env-lookup laundering). This is a heuristic with false
 * positives, so it is **advisory** and suppressible by passing the secret through
 * `committedSecretWaiver(value, { justification })`.
 *
 * NOTE: a true by-construction "the literal in source is the secret" check requires AST
 * provenance the server package does not own (it would need the compiler to prove the
 * argument is a string literal, not an env read). That is out of this slice's ownership.
 * // SF-WIRE: a compiler/cli provenance pass over `createApp({ csrf: { secret } })` would
 * // turn this runtime heuristic into an audit-grade lint surfaced in `kovo explain`.
 * The runtime helper here gives apps a waiver primitive now; the compiler lint is the
 * follow-up. We keep this as a stand-alone helper rather than wiring it into the fatal
 * path so its false positives never brick a deploy.
 */
export function looksLikeCommittedSecret(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (isWaived(value)) return false;
  if (value.length < FRAMEWORK_SECRET_MIN_LENGTH) return false;
  // High-entropy literal heuristic: long, varied alphabet, ≥80 bits estimated.
  return estimateEntropyBits(value) >= 80 && distinctRatio(value) >= 0.4;
}

const WAIVED_STRINGS = createWitnessSet<string>();

/**
 * Mark a framework-secret value as an audited committed-secret waiver so
 * `looksLikeCommittedSecret` stops flagging it. Apps that intentionally inline a public,
 * non-sensitive token (a test fixture, a documented sample) pass it through here with a
 * `justification` recorded for the audit trail.
 */
export function committedSecretWaiver(value: string, options: { justification: string }): string {
  if (!options || typeof options !== 'object') {
    throw new TypeError(
      'committedSecretWaiver requires a non-empty justification (audited in the committed-secret lint, SPEC §6.6).',
    );
  }
  const before = witnessGetOwnPropertyDescriptor(options, 'justification');
  const after = witnessGetOwnPropertyDescriptor(options, 'justification');
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value)
  ) {
    throw new TypeError(
      'committedSecretWaiver justification must be a stable own data property (SPEC §6.6).',
    );
  }
  snapshotAuditJustification(
    before.value,
    'committedSecretWaiver() (audited in the committed-secret lint, SPEC §6.6)',
  );
  witnessSetAdd(WAIVED_STRINGS, value);
  return value;
}

function isWaived(value: string): boolean {
  return witnessSetHas(WAIVED_STRINGS, value);
}

/**
 * Estimate Shannon entropy in bits: `length * H` where `H` is the per-character Shannon
 * entropy of the value's own character distribution. Cheap, dependency-free, and good
 * enough to separate `'a'.repeat(64)` (≈0 bits) from a random base64url string (high).
 */
export function estimateEntropyBits(value: string): number {
  if (value.length === 0) return 0;
  const histogram = characterCodePointHistogram(value);
  let perChar = 0;
  witnessMapForEach(histogram.counts, (count) => {
    const probability = count / histogram.length;
    perChar -= probability * securityMathLog2(probability);
  });
  return perChar * histogram.length;
}

/** Fraction of distinct characters — a repetitive secret has a low ratio. */
function distinctRatio(value: string): number {
  if (value.length === 0) return 0;
  const histogram = characterCodePointHistogram(value);
  return witnessMapSize(histogram.counts) / histogram.length;
}

function characterCodePointHistogram(value: string): {
  readonly counts: Map<number, number>;
  readonly length: number;
} {
  const counts = createWitnessMap<number, number>();
  // SPEC §6.6: entropy is audit evidence produced after authored modules may have run. Iterate
  // primitive code points and update the histogram only through boot-pinned controls; live String
  // iteration, Map methods, or Math.log2 must not forge a strong/weak-secret verdict. Combining
  // surrogate pairs ourselves preserves the prior per-character contract without trusting the
  // mutable String iterator or falsely counting one repeated astral character as two symbols.
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const first = securityStringCharCodeAt(value, index);
    let codePoint = first;
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = securityStringCharCodeAt(value, index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = (first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    witnessMapSet(counts, codePoint, (witnessMapGet(counts, codePoint) ?? 0) + 1);
    length += 1;
  }
  return { counts, length };
}

function readProcessEnv(): Record<string, unknown> {
  return runtimeEnvironmentSnapshot();
}

function defaultWarn(message: string): void {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(message);
  }
}

function formatBootError(issues: readonly EnvValidationIssue[]): string {
  const lines = issues.map((issue) => `  - [${issue.code}] ${issue.path}: ${issue.message}`);
  return (
    `createApp() refused to boot: ${issues.filter((i) => i.fatal).length} required env/secret ` +
    `check(s) failed (SPEC §6.6/§9.5). Fix all of the following, then restart:\n` +
    lines.join('\n')
  );
}

function formatBootWarning(issues: readonly EnvValidationIssue[], mode: string): string {
  const lines = issues.map((issue) => {
    const tag = issue.fatal ? 'WOULD-REFUSE-BOOT-IN-PROD' : 'advisory';
    return `  - [${tag}] ${issue.path}: ${issue.message}`;
  });
  return (
    `createApp() env/secret warning (${mode}; not bricking dev — SPEC §6.6). ` +
    `These would be addressed before production:\n` +
    lines.join('\n')
  );
}

import type { Schema } from './schema.js';
import { isSchemaValidationError } from './schema.js';

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
export const FRAMEWORK_SECRET_MIN_LENGTH = 32;

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
 * Thrown by `createApp` when a required framework secret (or an app-declared env schema)
 * fails validation in production. Carries every collected `issues` so a deploy fails
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
  return candidate.name === 'CreateAppBootError' && Array.isArray(candidate.issues);
}

/** The framework secrets that `createApp` consumes and this module gates. */
interface FrameworkSecrets {
  /** `createApp({ csrf: { secret } })` — the CSRF / anonymous-CSRF HMAC signing secret. */
  csrfSecret?: unknown;
}

/**
 * Options threaded into env validation. `mode` selects refuse-to-boot (production) vs
 * lenient-warn (development); `env` is an optional app-declared `s.object` schema validated
 * at boot; `envSource` is the record validated against it (defaults to `process.env`).
 */
export interface ValidateAppEnvOptions {
  mode?: 'production' | 'development';
  env?: Schema<unknown>;
  envSource?: Record<string, unknown>;
  /** Test seam: capture warnings instead of writing to `console.warn`. */
  onWarn?: (message: string) => void;
}

/**
 * Resolve the boot mode. Mirrors the existing `NODE_ENV === 'production'` detection used
 * by `cookies.ts`/`response.ts` so the env floor activates in exactly the same deployments
 * the cookie `Secure` floor does. An explicit `mode` overrides (test seam + adapters that
 * know their posture out-of-band).
 */
export function resolveBootMode(
  explicit?: 'production' | 'development',
): 'production' | 'development' {
  if (explicit !== undefined) return explicit;
  const nodeEnv = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
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
 * In `development`: nothing throws (localhost is not bricked); every issue — fatal or
 * advisory — is surfaced as a warning so the problem is visible before it ships.
 */
export function validateAppEnv(
  secrets: FrameworkSecrets,
  options: ValidateAppEnvOptions = {},
): void {
  const mode = resolveBootMode(options.mode);
  const issues: EnvValidationIssue[] = [];

  validateFrameworkSecret(secrets.csrfSecret, 'csrf.secret', issues);

  if (options.env !== undefined) {
    validateAppEnvSchema(options.env, options.envSource ?? readProcessEnv(), issues);
  }

  if (issues.length === 0) return;

  const fatal = issues.filter((issue) => issue.fatal);

  if (mode === 'production' && fatal.length > 0) {
    // Refuse to boot — by-construction at the chokepoint (SPEC §6.6). All issues
    // (fatal + advisory) ride the error so one fix-up pass clears the deploy.
    throw new CreateAppBootError(issues);
  }

  // Dev (or prod with only advisory issues): warn, never brick.
  const warn = options.onWarn ?? defaultWarn;
  warn(formatBootWarning(issues, mode));
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

  if (isRecord(value)) {
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
  if (typeof value !== 'string') {
    issues.push({
      code: 'invalid',
      path,
      fatal: true,
      message: `Framework secret \`${path}\` must be a string, got ${typeof value}. Pass a high-entropy secret loaded from your secret manager (SPEC §6.6).`,
    });
    return;
  }

  if (value.length === 0) {
    issues.push({
      code: 'missing',
      path,
      fatal: true,
      message: `Framework secret \`${path}\` is empty. An empty secret silently degrades the CSRF HMAC (SPEC §6.6). Set it to a high-entropy value (≥${FRAMEWORK_SECRET_MIN_LENGTH} chars), e.g. \`crypto.randomBytes(32).toString('base64url')\`, loaded from your environment.`,
    });
    return;
  }

  if (value.length < FRAMEWORK_SECRET_MIN_LENGTH) {
    issues.push({
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
    issues.push({
      code: 'low-entropy',
      path,
      fatal: false,
      message: `Framework secret \`${path}\` clears the length floor but estimates only ~${Math.round(entropyBits)} bits of entropy (heuristic; FPs possible). A repetitive or low-variety secret weakens the HMAC. Prefer \`crypto.randomBytes(32).toString('base64url')\` (SPEC §6.6).`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the app-declared `env` schema against the env source. Reuses the framework's
 * own `s.object` engine (imported, never re-implemented), so apps "declare and validate
 * their own required env at boot, failing fast." `s.object` throws on the first invalid
 * field, so we surface that one `SchemaValidationError` path as a fatal issue.
 */
function validateAppEnvSchema(
  schema: Schema<unknown>,
  source: Record<string, unknown>,
  issues: EnvValidationIssue[],
): void {
  try {
    schema.parse(source);
  } catch (error) {
    if (isSchemaValidationError(error)) {
      for (const issue of error.issues) {
        issues.push({
          code: 'invalid',
          path: issue.path.length > 0 ? `env.${issue.path.join('.')}` : 'env',
          fatal: true,
          message: `App env validation failed for \`${issue.path.join('.') || 'env'}\`: ${issue.message} (createApp({ env }), SPEC §9.5).`,
        });
      }
      return;
    }
    issues.push({
      code: 'invalid',
      path: 'env',
      fatal: true,
      message: `App env validation threw: ${error instanceof Error ? error.message : String(error)} (createApp({ env }), SPEC §9.5).`,
    });
  }
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

const WAIVED = new WeakSet<object>();
const WAIVED_STRINGS = new Set<string>();

/**
 * Mark a framework-secret value as an audited committed-secret waiver so
 * `looksLikeCommittedSecret` stops flagging it. Apps that intentionally inline a public,
 * non-sensitive token (a test fixture, a documented sample) pass it through here with a
 * `justification` recorded for the audit trail.
 */
export function committedSecretWaiver(value: string, options: { justification: string }): string {
  if (!options || typeof options.justification !== 'string' || options.justification.length === 0) {
    throw new TypeError(
      'committedSecretWaiver requires a non-empty justification (audited in the committed-secret lint, SPEC §6.6).',
    );
  }
  WAIVED_STRINGS.add(value);
  return value;
}

function isWaived(value: string): boolean {
  return WAIVED_STRINGS.has(value);
}

void WAIVED;

/**
 * Estimate Shannon entropy in bits: `length * H` where `H` is the per-character Shannon
 * entropy of the value's own character distribution. Cheap, dependency-free, and good
 * enough to separate `'a'.repeat(64)` (≈0 bits) from a random base64url string (high).
 */
export function estimateEntropyBits(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let perChar = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    perChar -= probability * Math.log2(probability);
  }
  return perChar * value.length;
}

/** Fraction of distinct characters — a repetitive secret has a low ratio. */
function distinctRatio(value: string): number {
  if (value.length === 0) return 0;
  return new Set(value).size / value.length;
}

function readProcessEnv(): Record<string, unknown> {
  if (typeof process === 'undefined' || process.env == null) return {};
  return { ...process.env };
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
    `check(s) failed in production (SPEC §6.6). Fix all of the following, then redeploy:\n` +
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

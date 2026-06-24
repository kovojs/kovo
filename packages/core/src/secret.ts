const secretBrand = Symbol('kovo.secret');
const secretValue = Symbol('kovo.secret.value');

interface RuntimeSecret<T> extends Secret<T> {
  readonly [secretValue]: T;
}

/**
 * Type-level marker for values classified as confidential. `Secret<T>` is
 * intentionally not assignable to `JsonValue`, so client-bound sinks reject it
 * before a secret reaches query JSON, island state, or typed failure payloads
 * (SPEC §6.2/§9.2/§10.2). Runtime wrappers created by {@link secret} also
 * poison string and JSON coercion as defense-in-depth for logging sinks.
 */
export interface Secret<T> {
  readonly __kovoSecretBrand: typeof secretBrand;
  readonly __kovoSecretValue?: T;
  toJSON(): never;
  toString(): never;
  [Symbol.toPrimitive](): never;
}

const secretPrototype = Object.freeze({
  [Symbol.toPrimitive](): never {
    throw new Error('Secret values cannot be coerced to strings.');
  },
  toJSON(): never {
    throw new Error('Secret values cannot be serialized to JSON.');
  },
  toString(): never {
    throw new Error('Secret values cannot be coerced to strings.');
  },
});

/**
 * Wrap a confidential value in a runtime `Secret<T>` container. The wrapper is
 * intentionally not JSON/string coercible; use {@link trustedReveal} with an
 * audited justification when a redacted or otherwise safe representation must
 * cross a typed boundary.
 */
export function secret<T>(value: T): Secret<T> {
  const wrapper = Object.create(secretPrototype) as RuntimeSecret<T>;
  Object.defineProperties(wrapper, {
    __kovoSecretBrand: {
      enumerable: false,
      value: secretBrand,
    },
    [secretValue]: {
      enumerable: false,
      value,
    },
  });
  return Object.freeze(wrapper);
}

function isRuntimeSecret<T>(value: T): value is T & RuntimeSecret<TrustedRevealValue<T>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, secretValue)
  );
}

/** Public method labels for audited confidentiality reveals (SPEC §6.2/§10.2). */
export type TrustedRevealMethod = 'arbitrary-fn' | 'server-projection';

/**
 * Options for {@link trustedReveal}. In statically analyzed Drizzle projections,
 * pass this as an inline object literal so `kovo explain --revealed` can make
 * the confidentiality escape hatch reviewable.
 */
export interface TrustedRevealOptions {
  /**
   * Why this confidential value is safe to expose at this projection site. Keep
   * the text reviewable and non-sensitive; it is emitted into explain output.
   */
  justification: string;
  /**
   * `server-projection` is proof-grade only when the selected expression is not
   * itself secret-classified. `arbitrary-fn` is always audit-grade.
   */
  method?: TrustedRevealMethod;
  /** Optional stable source label for explain output, such as `users.passwordHash`. */
  source?: string;
}

/** The JSON-visible value type exposed after an explicit confidentiality reveal. */
export type TrustedRevealValue<T> = T extends Secret<infer Value> ? Value : T;

/**
 * Audited confidentiality escape hatch for query projections that intentionally
 * expose a redacted or otherwise safe representation of a secret-classified value.
 *
 * The helper is an author assertion, not runtime taint tracking. The static
 * Drizzle projection analyzer recognizes direct imports of this function and
 * records the reveal for `kovo explain --revealed`; other runtime call sites are
 * type-level escapes only. Arbitrary-function reveals are audit-grade; prefer
 * server-side projections that never select the secret.
 */
export function trustedReveal<T>(value: T, options: TrustedRevealOptions): TrustedRevealValue<T> {
  if (!options.justification.trim()) {
    throw new Error('trustedReveal requires a non-empty justification.');
  }
  if (isRuntimeSecret(value)) {
    return value[secretValue] as TrustedRevealValue<T>;
  }
  return value as TrustedRevealValue<T>;
}

/**
 * Options for {@link publishToClient}. The compiler records the reason as a
 * capability fact so client-public secret derivations are reviewable
 * (SPEC §6.2).
 */
export interface PublishToClientOptions {
  /**
   * Why this server-derived value is safe to publish into a client module. Keep
   * the text reviewable and non-sensitive; it is emitted into explain output.
   */
  reason: string;
}

/**
 * Audited escape hatch for publishing a server-derived value into a generated
 * client module. The compiler records this assertion for `kovo explain
 * --capabilities`; it does not prove the derivation safe.
 */
export function publishToClient<T>(value: T, options: PublishToClientOptions): T {
  if (!options.reason.trim()) {
    throw new Error('publishToClient requires a non-empty reason.');
  }
  return value;
}

declare const secretBrand: unique symbol;

/**
 * Type-level marker for values classified as confidential. `Secret<T>` is
 * intentionally not assignable to `JsonValue`, so client-bound sinks reject it
 * before a secret reaches query JSON, island state, or typed failure payloads
 * (SPEC §6.2/§9.2/§10.2).
 */
export interface Secret<T> {
  readonly __kovoSecretBrand: typeof secretBrand;
  readonly __kovoSecretValue?: T;
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
  return value as TrustedRevealValue<T>;
}

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

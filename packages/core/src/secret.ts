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

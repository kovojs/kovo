/**
 * KV429 RUNTIME — Stale-version conflict signal for optimistic-concurrency mutations.
 *
 * SPEC §10.3/§11.1 (KV429): a mutation handler annotated with `kovo({ version })` or
 * `kovo({ atomic })` MUST fold check+act into one UPDATE…WHERE. When 0 rows are updated
 * (i.e. the version predicate did not match — the row was concurrently modified since the
 * version was read), the handler throws a `StaleVersionError`. The `runMutation` lifecycle
 * catches this error and returns a typed HTTP 409 (`STALE_VERSION`) outcome distinct from
 * the IDEMPOTENCY_CONFLICT 409 produced by the replay-idempotency path.
 *
 * On a 409 stale-version response the enhanced client refetches the fresh version and
 * retries the mutation with the updated version token.
 *
 * @example
 * ```ts
 * import { compareAndSet } from '@kovojs/drizzle';
 * import { StaleVersionError } from '@kovojs/server';
 *
 * // In a mutation handler:
 * const cas = await compareAndSet(
 *   db.update(products)
 *     .set({ stock: sql`${products.stock} - ${qty}`, ver: sql`${products.ver} + 1` })
 *     .where(and(eq(products.id, id), eq(products.ver, input.prevVer))),
 * );
 * if (!cas.ok) throw new StaleVersionError();
 * ```
 */
export class StaleVersionError extends Error {
  /** Always `'StaleVersionError'` for instanceof-free duck-typing (cross-realm / bundled). */
  readonly kind = 'StaleVersionError' as const;

  constructor(message = 'Stale version: concurrent modification detected (KV429)') {
    super(message);
    this.name = 'StaleVersionError';
  }
}

/**
 * Duck-type check for `StaleVersionError` — safe across realm/bundle boundaries where
 * `instanceof` may fail.
 *
 * @internal
 */
export function isStaleVersionError(value: unknown): value is StaleVersionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'StaleVersionError'
  );
}

/**
 * The typed 409 stale-version mutation failure returned by `runMutation` when the handler
 * throws a `StaleVersionError` (KV429, SPEC §10.3/§11.1). Distinct from the
 * `IDEMPOTENCY_CONFLICT` 409 returned by the replay-idempotency path.
 *
 * The client refetches the fresh version and retries the mutation.
 */
export interface StaleVersionConflict {
  error: {
    code: 'STALE_VERSION';
    payload: Record<string, never>;
  };
  ok: false;
  status: 409;
}

/**
 * Build the typed 409 stale-version `MutationFail`-shaped outcome.
 *
 * @internal
 */
export function staleVersionConflict(): StaleVersionConflict {
  return {
    error: { code: 'STALE_VERSION', payload: {} },
    ok: false,
    status: 409,
  };
}

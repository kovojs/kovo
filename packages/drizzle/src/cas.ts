/**
 * KV429 RUNTIME — Compare-And-Set (CAS) helper for optimistic concurrency control.
 *
 * SPEC §10.3/§11.1 (KV429): A single-row read-modify-write annotated with `kovo({
 * atomic })` or `kovo({ version })` MUST fold check+act into one atomic UPDATE…WHERE
 * statement so a lost-update race (TOCTOU) is impossible by construction. This helper
 * wraps a Drizzle update builder whose `.where()` carries the version/CAS predicate and
 * returns a typed result:
 *   - `{ ok: true }` when ≥1 row was updated (the predicate matched; write succeeded).
 *   - `{ ok: false, conflict: true }` when 0 rows were updated (the predicate did not
 *     match; the row was concurrently modified → stale-version / lost-update race).
 *
 * A handler that receives `{ ok: false, conflict: true }` SHOULD throw a
 * `StaleVersionError` so the mutation lifecycle surfaces a typed HTTP 409 to the client,
 * which then refetches the fresh version and retries.
 *
 * @example
 * ```ts
 * // Handler using compareAndSet to fold check+act into one UPDATE…WHERE:
 * const result = await compareAndSet(
 *   db.update(products)
 *     .set({ stock: sql`${products.stock} - ${input.qty}`, ver: sql`${products.ver} + 1` })
 *     .where(and(eq(products.id, input.id), eq(products.ver, input.prevVer))),
 * );
 * if (!result.ok) throw new StaleVersionError();
 * ```
 */

/** A CAS operation succeeded — ≥1 row matched the version predicate and was updated. */
export interface CasSuccess {
  readonly ok: true;
}

/**
 * A CAS operation detected a stale-version conflict — 0 rows matched the predicate,
 * meaning the row was concurrently modified since the version was read (lost-update race,
 * SPEC §10.3/§11.1, KV429).
 */
export interface CasConflict {
  readonly conflict: true;
  readonly ok: false;
}

/** The typed result of a {@link compareAndSet} call (SPEC §10.3/§11.1, KV429). */
export type CasResult = CasConflict | CasSuccess;

/**
 * A Drizzle result object that carries row-affected count in one of the standard shapes
 * returned by Drizzle adapters (pg: `rowCount`, sqlite: `changes`, or a generic
 * `rowsAffected`).
 */
export interface DrizzleUpdateResult {
  affectedRows?: number | null;
  changes?: number | null;
  rowCount?: number | null;
  rowsAffected?: number | null;
}

/**
 * Execute a Drizzle update whose `.where()` clause carries the version/CAS predicate,
 * and return a typed {@link CasResult}.
 *
 * KV429 (SPEC §10.3/§11.1): pass the entire `.update(…).set(…).where(…)` expression
 * as the argument so the predicate is part of the atomic SQL statement. Zero rowsAffected
 * means the predicate did not match — the caller's version was stale → `CasConflict`.
 * One or more rows updated → `CasSuccess`.
 *
 * @param update - A promise that resolves to a Drizzle update result (or the raw result).
 * @returns A `CasResult`: `{ ok: true }` on success, `{ ok: false, conflict: true }` on
 *   stale-version conflict.
 *
 * @example
 * ```ts
 * // In a mutation handler with kovo({ atomic: 'stock', version: 'ver' }):
 * const cas = await compareAndSet(
 *   db.update(products)
 *     .set({ stock: sql`${products.stock} - ${qty}`, ver: sql`${products.ver} + 1` })
 *     .where(and(eq(products.id, id), eq(products.ver, prevVer))),
 * );
 * if (!cas.ok) throw new StaleVersionError();
 * ```
 */
export async function compareAndSet(
  update: DrizzleUpdateResult | Promise<DrizzleUpdateResult>,
): Promise<CasResult> {
  const result = await update;
  const affected =
    result.rowCount ?? result.rowsAffected ?? result.affectedRows ?? result.changes ?? 0;
  if (affected > 0) {
    return { ok: true };
  }
  return { conflict: true, ok: false };
}

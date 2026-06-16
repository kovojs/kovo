/** An invalidation domain: a named unit of cache currency that queries read and mutations touch. */
export interface Domain<Key extends string = string> {
  key: Key;
}

/**
 * Declare an invalidation domain — the currency the framework uses to connect
 * writes to reads. A query's `reads` and a mutation's `touches` are lists of
 * domains; touching a domain reruns every query that reads it (SPEC §10.1).
 *
 * @param key - The domain's stable name.
 * @returns A `Domain` keyed by `key`.
 * @example
 * import { domain } from '@kovojs/server';
 *
 * export const cart = domain('cart');
 * export const product = domain('product');
 */
export function domain<const Key extends string>(key: Key): Domain<Key> {
  return { key };
}

/** Alias of `Domain`; `tag` produces this for finer-grained, row-scoped invalidation keys. */
export type Tag<Key extends string = string> = Domain<Key>;

/**
 * Declare an invalidation tag — a `Domain` by another name, used for narrower,
 * row-level invalidation keys alongside coarse domains (SPEC §10.1).
 *
 * @param key - The tag's stable name.
 * @returns A `Tag` keyed by `key`.
 * @example
 * import { tag } from '@kovojs/server';
 *
 * export const cartItem = tag('cart-item');
 */
export function tag<const Key extends string>(key: Key): Tag<Key> {
  return domain(key);
}

/** An invalidation domain: a named unit of cache currency that queries read and mutations touch. */
export interface Domain<Key extends string = string> {
  key: Key;
}

const DERIVED_DOMAIN_KEY = '__kovo_compiler_derived_domain__';

/**
 * Declare an invalidation domain — the currency the framework uses to connect
 * writes to reads. A query's `reads` and a mutation's `touches` are lists of
 * domains; touching a domain reruns every query that reads it (SPEC §10.1).
 *
 * With no argument, the compiler derives the domain's stable name from the
 * exported binding plus module path (SPEC §4.1). Runtime-only execution cannot
 * prove that source identity, so generated registries must replace the internal
 * placeholder before the domain is used as invalidation currency.
 *
 * @param key - Optional explicit stable name for shared external vocabulary.
 * @returns A `Domain` keyed by `key`.
 * @example
 * import { domain } from '@kovojs/server';
 *
 * export const cart = domain();
 * export const product = domain('product');
 */
export function domain(): Domain<string>;
export function domain<const Key extends string>(key: Key): Domain<Key>;
export function domain<const Key extends string>(key?: Key): Domain<Key> {
  return { key: (key ?? DERIVED_DOMAIN_KEY) as Key };
}

/** Alias of `Domain`; `tag` produces this for finer-grained, row-scoped invalidation keys. */
export type Tag<Key extends string = string> = Domain<Key>;

/**
 * Declare an invalidation tag — a `Domain` by another name, used for narrower,
 * row-level invalidation keys alongside coarse domains (SPEC §10.1).
 *
 * With no argument, the compiler derives the tag's stable name from the
 * exported binding plus module path (SPEC §4.1).
 *
 * @param key - Optional explicit stable name for shared external vocabulary.
 * @returns A `Tag` keyed by `key`.
 * @example
 * import { tag } from '@kovojs/server';
 *
 * export const cartItem = tag();
 */
export function tag(): Tag<string>;
export function tag<const Key extends string>(key: Key): Tag<Key>;
export function tag<const Key extends string>(key?: Key): Tag<Key> {
  return { key: (key ?? DERIVED_DOMAIN_KEY) as Key };
}

/** @internal */
export function isCompilerDerivedDomain(domain: Domain): boolean {
  return domain.key === DERIVED_DOMAIN_KEY;
}

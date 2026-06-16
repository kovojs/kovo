/** A derived value: the named inputs it depends on and the `run` that computes it. */
export interface DeriveDefinition<Inputs extends readonly string[], Value> {
  inputs: Inputs;
  run(...values: unknown[]): Value;
}

/**
 * Declare a value derived from named query/state inputs. The runtime recomputes
 * `run` whenever any named input changes, so bindings stay consistent without
 * manual wiring (SPEC §4.8).
 *
 * @param inputs - The names of the inputs this value depends on.
 * @param fn - Computes the derived value from the inputs' current values.
 * @returns A `DeriveDefinition`.
 * @example
 * import { derive } from '@kovojs/runtime';
 *
 * export const total = derive(['price', 'quantity'], (price, quantity) =>
 *   Number(price) * Number(quantity),
 * );
 */
export function derive<const Inputs extends readonly string[], Value>(
  inputs: Inputs,
  fn: (...values: unknown[]) => Value,
): DeriveDefinition<Inputs, Value> {
  return { inputs, run: fn };
}

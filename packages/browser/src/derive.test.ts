import { describe, expect, it } from 'vitest';

import { derive as generatedDerive } from './generated.js';
import { derive as deriveFromBarrel } from './index.js';
import { derive, type DeriveInput } from './derive.js';

describe('derive runtime surface', () => {
  it('keeps the public barrel wired to the opaque-input derive owner', () => {
    expect(deriveFromBarrel).toBe(derive);
    expect(generatedDerive).not.toBe(derive);
  });

  it('keeps raw string IR generated-only', () => {
    const run = (count: unknown) => Number(count) + 1;
    const definition = generatedDerive(['cart.count'] as const, run);

    expect(definition.inputs).toEqual(['cart.count']);
    expect(Object.getOwnPropertyDescriptor(definition, 'run')?.value).toBe(run);
    expect(definition.run(2)).toBe(3);

    // @ts-expect-error App-facing derive inputs are opaque handles, never raw strings.
    expect(() => derive(['cart'], run)).toThrow(/must be minted/u);
  });

  it('infers query, state, and clock values in positional form', () => {
    const cart = {
      key: 'cart' as const,
      optimistic(_status: 'await-fragment') {
        return { binding: { value: { count: 2 } as { count: number } } };
      },
    };
    const definition = derive(
      [
        derive.query(cart),
        derive.state<{ selected: boolean }>(),
        derive.clock<{ ago: Date }>(),
      ] as const,
      (cartValue, state, clock) => {
        const count: number = cartValue.count;
        const selected: boolean = state.selected;
        const ago: Date = clock.ago;
        return `${count}:${String(selected)}:${ago.toISOString()}`;
      },
    );

    expect(definition.inputs).toEqual(['cart', 'state', 'now']);
    expect(
      definition.run({ count: 2 }, { selected: true }, { ago: new Date('2026-01-01T00:00:00Z') }),
    ).toBe('2:true:2026-01-01T00:00:00.000Z');
  });

  it('infers object-map aliases while preserving registry input order', () => {
    const cart = {
      key: 'cart' as const,
      optimistic(_status: 'await-fragment') {
        return { binding: { value: { count: 2 } as { count: number } } };
      },
    };
    const isEmpty = derive(
      {
        basket: derive.query(cart),
        local: derive.state<{ pending: boolean }>(),
      },
      (values) => {
        const count: number = values.basket.count;
        const pending: boolean = values.local.pending;
        return count === 0 && !pending;
      },
    );

    expect(isEmpty.inputs).toEqual(['cart', 'state']);
    expect(isEmpty.run({ count: 0 }, { pending: false })).toBe(true);
    expect(isEmpty.run({ count: 2 }, { pending: false })).toBe(false);
  });

  it('rejects forged, accessor-backed, and foreign-shaped inputs', () => {
    const forged = Object.freeze(Object.create(null)) as DeriveInput<'cart', { count: number }>;
    expect(() => derive([forged], (cart) => cart.count)).toThrow(/this installed copy/u);

    const accessorQuery = Object.defineProperty({}, 'key', {
      enumerable: true,
      get: () => 'cart',
    });
    expect(() => derive.query(accessorQuery as { readonly key: string })).toThrow(
      /own string key/u,
    );

    const real = derive.state<{ count: number }>();
    expect(Reflect.ownKeys(real)).toEqual([]);
    expect(Object.getPrototypeOf(real)).toBeNull();
    expect(Object.isFrozen(real)).toBe(true);

    const accessorMap = Object.defineProperty({}, 'state', {
      enumerable: true,
      get: () => real,
    });
    expect(() =>
      derive(
        accessorMap as { state: DeriveInput<'state', { count: number }> },
        ({ state }) => state.count,
      ),
    ).toThrow(/own data property/u);
  });
});

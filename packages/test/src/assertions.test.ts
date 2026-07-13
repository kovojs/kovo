import { describe, expect, it } from 'vitest';
import { mutation, s } from '@kovojs/server';
import { assertMutationError, propertyTest } from './assertions.js';
import { createKovoTestHarness } from './harness.js';

describe('@kovojs/test assertions', () => {
  it('property-tests optimistic predictions against eventual query truth', () => {
    const result = propertyTest({
      apply(state: { count: number }, input: { quantity: number }) {
        return { count: state.count + input.quantity };
      },
      cases: [
        { input: { quantity: 1 }, state: { count: 0 } },
        { input: { quantity: 2 }, state: { count: 3 } },
      ],
      predict(state, input) {
        return { count: state.count + input.quantity };
      },
    });

    expect(result).toEqual({ cases: 2 });
  });

  it('reports the first optimistic prediction counterexample', () => {
    expect(() =>
      propertyTest({
        apply(state: { count: number }, input: { quantity: number }) {
          return { count: state.count + input.quantity };
        },
        cases: [
          { input: { quantity: 1 }, state: { count: 0 } },
          { input: { quantity: 2 }, state: { count: 3 } },
        ],
        predict(state) {
          return { count: state.count };
        },
      }),
    ).toThrow(
      'Optimistic property failed for case 0: predicted { count: 0 }, eventual { count: 1 }',
    );
  });

  it('keeps optimistic counterexamples visible after tested code replaces array iteration', () => {
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    let error: unknown;

    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: function* emptyArrayIterator() {},
        writable: true,
      });
      try {
        propertyTest({
          apply(state: { count: number }, input: { quantity: number }) {
            return { count: state.count + input.quantity };
          },
          cases: [{ input: { quantity: 1 }, state: { count: 0 } }],
          predict(state) {
            return { count: state.count };
          },
        });
      } catch (caught) {
        error = caught;
      }
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
    }

    expect(String(error)).toContain(
      'Optimistic property failed for case 0: predicted { count: 0 }, eventual { count: 1 }',
    );
  });

  it('keeps prediction-side mutation visible after tested code replaces structuredClone', () => {
    const cloneDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone')!;
    let error: unknown;

    try {
      Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        value: <Value>(value: Value): Value => value,
        writable: true,
      });
      try {
        propertyTest({
          apply(state: { count: number }) {
            return { count: state.count };
          },
          cases: [{ input: {}, state: { count: 0 } }],
          predict(state) {
            state.count = 1;
            return { count: state.count };
          },
        });
      } catch (caught) {
        error = caught;
      }
    } finally {
      Object.defineProperty(globalThis, 'structuredClone', cloneDescriptor);
    }

    expect(String(error)).toContain(
      'Optimistic property failed for case 0: predicted { count: 1 }, eventual { count: 0 }',
    );
  });

  it('keeps lazy counterexamples visible after tested code replaces generator controls', () => {
    function* cases() {
      yield { input: { quantity: 1 }, state: { count: 0 } };
    }
    const iterable = cases();
    let prototype: object | null = iterable;
    let iteratorOwner: object | undefined;
    let nextOwner: object | undefined;
    while (prototype !== null) {
      if (Object.getOwnPropertyDescriptor(prototype, Symbol.iterator) !== undefined) {
        iteratorOwner = prototype;
      }
      if (Object.getOwnPropertyDescriptor(prototype, 'next') !== undefined) nextOwner = prototype;
      prototype = Object.getPrototypeOf(prototype);
    }
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(iteratorOwner!, Symbol.iterator)!;
    const nextDescriptor = Object.getOwnPropertyDescriptor(nextOwner!, 'next')!;
    let error: unknown;

    try {
      Object.defineProperty(iteratorOwner!, Symbol.iterator, {
        configurable: true,
        value: function* emptyGeneratorIterator() {},
        writable: true,
      });
      Object.defineProperty(nextOwner!, 'next', {
        configurable: true,
        value: () => ({ done: true, value: undefined }),
        writable: true,
      });
      try {
        propertyTest({
          apply(state: { count: number }, input: { quantity: number }) {
            return { count: state.count + input.quantity };
          },
          cases: iterable,
          predict(state) {
            return { count: state.count };
          },
        });
      } catch (caught) {
        error = caught;
      }
    } finally {
      Object.defineProperty(iteratorOwner!, Symbol.iterator, iteratorDescriptor);
      Object.defineProperty(nextOwner!, 'next', nextDescriptor);
    }

    expect(String(error)).toContain(
      'Optimistic property failed for case 0: predicted { count: 0 }, eventual { count: 1 }',
    );
  });

  it('stops lazy property case iteration after the first counterexample', () => {
    let consumedSecondCase = false;
    function* cases() {
      yield { input: { quantity: 1 }, state: { count: 0 } };
      consumedSecondCase = true;
      yield { input: { quantity: 2 }, state: { count: 3 } };
    }

    expect(() =>
      propertyTest({
        apply(state: { count: number }, input: { quantity: number }) {
          return { count: state.count + input.quantity };
        },
        cases: cases(),
        predict(state) {
          return { count: state.count };
        },
      }),
    ).toThrow(
      'Optimistic property failed for case 0: predicted { count: 0 }, eventual { count: 1 }',
    );
    expect(consumedSecondCase).toBe(false);
  });

  it('formats optimistic counterexamples without dropping undefined fields', () => {
    expect(() =>
      propertyTest<{ value: undefined }, {}, unknown>({
        apply() {
          return { value: undefined };
        },
        cases: [{ input: {}, state: { value: undefined } }],
        predict() {
          return undefined;
        },
      }),
    ).toThrow(
      'Optimistic property failed for case 0: predicted undefined, eventual { value: undefined }',
    );
  });

  it('compares optimistic predictions structurally instead of by JSON key order', () => {
    expect(
      propertyTest({
        apply(_state: { one: number; two: number }) {
          return { one: 1, two: 2 };
        },
        cases: [{ input: {}, state: { one: 0, two: 0 } }],
        predict() {
          return { two: 2, one: 1 };
        },
      }),
    ).toEqual({ cases: 1 });
  });

  it('asserts typed mutation error paths without rendering a browser', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input, request: { db: { stock: number } }, context) {
        if (input.quantity > request.db.stock) {
          return context.fail('OUT_OF_STOCK', { availableQuantity: request.db.stock });
        }

        return { added: input.quantity };
      },
    });
    const harness = createKovoTestHarness({ db: { stock: 0 } });

    const result = await harness.exec(addToCart, { productId: 'p1', quantity: 2 });
    const payload = assertMutationError(addToCart, result, {
      code: 'OUT_OF_STOCK',
      payload: { availableQuantity: 0 },
    });

    const typedPayload: { availableQuantity: number } = payload;
    expect(typedPayload.availableQuantity).toBe(0);

    const assertDeclaredErrorCodes = () => {
      // @ts-expect-error UNKNOWN_ERROR is not declared by this mutation's errors schema.
      assertMutationError(addToCart, result, 'UNKNOWN_ERROR');
    };
    expect(assertDeclaredErrorCodes).toBeTypeOf('function');
  });

  it('reports mutation error-path assertion mismatches', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
        PRICE_CHANGED: s.object({ currentPrice: s.number().min(0) }),
      },
      input: s.object({ quantity: s.number().int().min(1) }),
      handler(input, request: { db: { stock: number } }, context) {
        if (input.quantity > request.db.stock) {
          return context.fail('OUT_OF_STOCK', { availableQuantity: request.db.stock });
        }

        return { added: input.quantity };
      },
    });
    const failingHarness = createKovoTestHarness({ db: { stock: 0 } });
    const successHarness = createKovoTestHarness({ db: { stock: 5 } });

    const failure = await failingHarness.exec(addToCart, { quantity: 2 });
    expect(() => assertMutationError(addToCart, failure, 'PRICE_CHANGED')).toThrow(
      'Expected cart/add to fail with PRICE_CHANGED, got OUT_OF_STOCK.',
    );
    expect(() =>
      assertMutationError(addToCart, failure, {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 1 },
      }),
    ).toThrow(
      'Expected cart/add error OUT_OF_STOCK payload { availableQuantity: 1 }, got { availableQuantity: 0 }.',
    );

    const success = await successHarness.exec(addToCart, { quantity: 2 });
    expect(() => assertMutationError(addToCart, success, 'OUT_OF_STOCK')).toThrow(
      'Expected cart/add to fail with OUT_OF_STOCK, but it succeeded.',
    );
  });

  it('compares mutation error payloads structurally without dropping undefined fields', async () => {
    const addToCart = mutation('cart/add', {
      csrf: false,
      csrfJustification: 'test fixture uses a non-browser caller',
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ quantity: s.number().int().min(1) }),
      handler(_input, _request: { db: Record<string, never> }, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });
    const harness = createKovoTestHarness({ db: {} });
    const failure = await harness.exec(addToCart, { quantity: 2 });

    expect(() =>
      assertMutationError(addToCart, failure, {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0, reason: undefined } as { availableQuantity: number },
      }),
    ).toThrow(
      'Expected cart/add error OUT_OF_STOCK payload { availableQuantity: 0, reason: undefined }, got { availableQuantity: 0 }.',
    );
  });
});

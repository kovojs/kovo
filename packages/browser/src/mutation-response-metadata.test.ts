import { describe, expect, it, vi } from 'vitest';

import {
  createMutationIdem,
  isMutationBroadcastMessage,
  readMutationChangeHeader,
  sanitizeMutationChangeRecord,
} from './mutation-response.js';

describe('mutation response metadata', () => {
  it('reports malformed Kovo-Changes headers through the mutation response error hook', () => {
    const onError = vi.fn();

    // SPEC.md §9.1: Kovo-Changes is sanitized mutation response wire metadata.
    expect(
      readMutationChangeHeader(
        {
          headers: {
            get(name: string) {
              return name === 'Kovo-Changes' ? '[' : null;
            },
          },
        },
        onError,
      ),
    ).toEqual([]);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0].message)).toContain(
      'Malformed JSON in Kovo-Changes header',
    );
  });

  it('creates mutation idempotency keys from crypto or the local fallback', () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => 'crypto-idem' },
      });

      expect(createMutationIdem()).toBe('crypto-idem');

      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: undefined,
      });

      // SPEC.md §9.1: generated enhanced mutation requests always carry Kovo-Idem.
      const firstFallback = createMutationIdem();
      const secondFallback = createMutationIdem();
      expect(firstFallback).toMatch(/^idem_loyw3v28_[0-9a-z]+$/);
      expect(secondFallback).toMatch(/^idem_loyw3v28_[0-9a-z]+$/);
      expect(secondFallback).not.toBe(firstFallback);
    } finally {
      now.mockRestore();
      if (cryptoDescriptor) {
        Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
      } else {
        delete (globalThis as { crypto?: unknown }).crypto;
      }
    }
  });

  it('sanitizes mutation change records before broadcast publication and acceptance', () => {
    expect(
      sanitizeMutationChangeRecord({
        domain: 'cart',
        input: { productId: 'p1' },
        keys: ['cart'],
        stack: 'hidden',
      }),
    ).toEqual({ domain: 'cart', keys: ['cart'] });
    expect(sanitizeMutationChangeRecord({ domain: 'cart', keys: [1] })).toBeNull();
    expect(
      isMutationBroadcastMessage({
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        changes: [{ domain: 'cart', keys: ['cart'] }],
        type: 'kovo:mutation-response',
      }),
    ).toBe(true);
    expect(
      isMutationBroadcastMessage({
        body: '<kovo-query name="cart">{"count":1}</kovo-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'kovo:mutation-response',
      }),
    ).toBe(false);
  });
});

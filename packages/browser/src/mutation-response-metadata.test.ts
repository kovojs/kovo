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

  it('mints Kovo-Idem from a cryptographic source (≥128-bit), never a predictable fallback', () => {
    // SPEC.md §10.3 line 1065 (normative): the client MUST mint a fresh high-entropy token
    // (≥128 bits from a cryptographic source) per logical submit. randomUUID is preferred; absent
    // it, getRandomValues must be used — NEVER a predictable Date.now()+counter.
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => 'crypto-idem' },
      });
      expect(createMutationIdem()).toBe('crypto-idem');

      // No randomUUID, but getRandomValues present → 16 random bytes as hex (≥128 bits), and the
      // value must NOT be the old predictable timestamp/counter format.
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues: (array: Uint8Array) => {
            for (let index = 0; index < array.length; index += 1)
              array[index] = (index * 37 + 11) & 0xff;
            return array;
          },
        },
      });
      const fallback = createMutationIdem();
      expect(fallback).toMatch(/^idem_[0-9a-f]{32}$/); // 16 bytes = 128 bits of hex
      expect(fallback).not.toMatch(/loyw3v28/); // not Date.now()-derived

      // No cryptographic source at all → throw rather than degrade to a predictable token.
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      expect(() => createMutationIdem()).toThrow(/cryptographic source/);
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

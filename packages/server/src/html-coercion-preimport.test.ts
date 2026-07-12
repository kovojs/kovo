import { describe, expect, it, vi } from 'vitest';

describe('rendered HTML coercion import-order membrane', () => {
  it('fails closed when its Web Crypto entropy source was poisoned before import', async () => {
    vi.resetModules();
    const cryptoPrototype = Object.getPrototypeOf(globalThis.crypto) as {
      getRandomValues: typeof globalThis.crypto.getRandomValues;
    };
    const originalGetRandomValues = cryptoPrototype.getRandomValues;
    let failure: unknown;
    try {
      cryptoPrototype.getRandomValues = function <Value extends ArrayBufferView | null>(
        value: Value,
      ): Value {
        if (value !== null) {
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
        }
        return value;
      };
      await import('./html.ts?preimport-zero-entropy');
    } catch (error) {
      failure = error;
    } finally {
      cryptoPrototype.getRandomValues = originalGetRandomValues;
    }

    expect(String(failure)).toMatch(/intrinsics were modified before framework initialization/u);
  });
});

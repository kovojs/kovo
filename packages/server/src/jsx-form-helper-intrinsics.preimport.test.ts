import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, it, vi } from 'vitest';

describe('JSX form-helper import-order membrane', () => {
  it('fails closed when placeholder and async-context controls were poisoned first', async () => {
    const originalGetStore = AsyncLocalStorage.prototype.getStore;
    const originalStringIndexOf = String.prototype.indexOf;
    let controls!: typeof import('./jsx-form-helper-intrinsics.js');
    try {
      AsyncLocalStorage.prototype.getStore = () => undefined;
      String.prototype.indexOf = () => -1;
      controls = await import('./jsx-form-helper-intrinsics.ts?preimport-poison');
    } finally {
      AsyncLocalStorage.prototype.getStore = originalGetStore;
      String.prototype.indexOf = originalStringIndexOf;
    }

    expect(() => controls.assertJsxFormHelperIntrinsics()).toThrow(
      /intrinsics were modified before framework initialization/u,
    );
  });

  it('fails closed when the helper-token entropy source was poisoned before import', async () => {
    vi.resetModules();
    const cryptoPrototype = Object.getPrototypeOf(globalThis.crypto) as {
      getRandomValues: typeof globalThis.crypto.getRandomValues;
    };
    const originalGetRandomValues = cryptoPrototype.getRandomValues;
    let controls!: typeof import('./jsx-form-helper-intrinsics.js');
    try {
      cryptoPrototype.getRandomValues = function <Value extends ArrayBufferView | null>(
        value: Value,
      ): Value {
        if (value !== null) {
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
        }
        return value;
      };
      controls = await import('./jsx-form-helper-intrinsics.ts?preimport-zero-entropy');
    } finally {
      cryptoPrototype.getRandomValues = originalGetRandomValues;
    }

    expect(() => controls.assertJsxFormHelperIntrinsics()).toThrow(
      /intrinsics were modified before framework initialization/u,
    );
  });
});

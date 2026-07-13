import { describe, expect, it } from 'vitest';

import { RequestBodyLimitExceededError, requestWithBodyLimit } from './app-load-shed.js';
import { pinnedRequestCarrier } from './request-carrier.js';

describe('request proxy intrinsics', () => {
  it('pins lifecycle snapshots and body limits against late global Proxy replacement', async () => {
    const request = new Request('https://kovo.test/limited', {
      body: 'larger-than-one-byte',
      method: 'POST',
    });
    const NativeProxy = globalThis.Proxy;
    let proxyHits = 0;
    let carrier!: { role?: string };
    let limited!: Request;
    try {
      globalThis.Proxy = class BypassProxy {
        constructor(target: object) {
          if (target === request) proxyHits += 1;
          return target;
        }
      } as unknown as ProxyConstructor;
      carrier = pinnedRequestCarrier({ role: 'untrusted-live-value' }, [
        { key: 'role', value: 'pinned-value' },
      ]);
      limited = requestWithBodyLimit(request, 1);
    } finally {
      globalThis.Proxy = NativeProxy;
    }

    expect(proxyHits).toBe(0);
    expect(carrier.role).toBe('pinned-value');
    await expect(limited.text()).rejects.toBeInstanceOf(RequestBodyLimitExceededError);
  });

  it('keeps request byte limits after the typed-array byteLength getter is poisoned', async () => {
    const request = new Request('https://kovo.test/limited-bytes', {
      body: 'larger-than-one-byte',
      method: 'POST',
    });
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const descriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength');
    expect(descriptor?.get).toBeTypeOf('function');
    Object.defineProperty(typedArrayPrototype, 'byteLength', {
      configurable: true,
      get(this: Uint8Array) {
        const actual = Reflect.apply(descriptor!.get!, this, []) as number;
        return actual > 1 && actual < 1_024 ? 0 : actual;
      },
    });
    try {
      const limited = requestWithBodyLimit(request, 1);
      await expect(limited.text()).rejects.toBeInstanceOf(RequestBodyLimitExceededError);
    } finally {
      Object.defineProperty(typedArrayPrototype, 'byteLength', descriptor!);
    }
  });
});

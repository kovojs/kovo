import { describe, expect, it } from 'vitest';

import { RequestBodyLimitExceededError, requestWithBodyLimit } from './app-load-shed.js';
import { pinnedRequestCarrier, pinnedRequestCarrierOwnData } from './request-carrier.js';

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

  it('distinguishes framework overrides from raw data, accessors, and Proxy trap output', () => {
    let accessorHits = 0;
    const accessorSource = {};
    Object.defineProperty(accessorSource, 'session', {
      enumerable: true,
      get() {
        accessorHits += 1;
        return { id: 'accessor-session' };
      },
    });
    const accessorCarrier = pinnedRequestCarrier(accessorSource, []);
    expect(accessorHits).toBe(1);
    expect(pinnedRequestCarrierOwnData(accessorCarrier, 'session')).toEqual({
      frameworkOwned: false,
      present: false,
    });

    const rawCarrier = pinnedRequestCarrier({ session: { id: 'raw-session' } }, []);
    expect(pinnedRequestCarrierOwnData(rawCarrier, 'session')).toEqual({
      frameworkOwned: false,
      present: true,
      value: { id: 'raw-session' },
    });

    let proxyDescriptorHits = 0;
    const proxyCarrier = pinnedRequestCarrier(
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor(_target, property) {
            proxyDescriptorHits += 1;
            return property === 'session'
              ? {
                  configurable: true,
                  enumerable: true,
                  value: { id: 'proxy-session' },
                  writable: true,
                }
              : undefined;
          },
          ownKeys() {
            return ['session'];
          },
        },
      ),
      [],
    );
    expect(proxyDescriptorHits).toBeGreaterThan(0);
    expect(pinnedRequestCarrierOwnData(proxyCarrier, 'session')).toEqual({
      frameworkOwned: false,
      present: true,
      value: { id: 'proxy-session' },
    });

    const frameworkCarrier = pinnedRequestCarrier(rawCarrier, [
      { key: 'session', value: { id: 'framework-session' } },
    ]);
    expect(pinnedRequestCarrierOwnData(frameworkCarrier, 'session')).toEqual({
      frameworkOwned: true,
      present: true,
      value: { id: 'framework-session' },
    });
  });
});

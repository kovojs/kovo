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
});

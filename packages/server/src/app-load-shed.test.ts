import { describe, expect, it } from 'vitest';

import { normalizeAppRequestLimits, preDispatchLoadShedResponse } from './app-load-shed.js';
import type { KovoApp } from './app-types.js';

/**
 * D12 (plans/good-perf.md) / SPEC §9.5 pre-dispatch load shed: the framework-default per-IP
 * budget exempts ordinary document GET/HEAD dispatch — behind a CDN, NAT, or load balancer every
 * visitor shares one source IP, and the previous default (600/min) rejected 100% of an ordinary
 * page-load test with 429. Mutations and queries keep per-IP shedding, the mandatory global
 * budget still applies to documents, and an app-authored `requestLimits.perIp` is always
 * enforced on every surface.
 */
describe('pre-dispatch per-IP load shedding for document GETs (SPEC §9.5, D12)', () => {
  function appWithLimits(requestLimits?: Parameters<typeof normalizeAppRequestLimits>[0]) {
    return { requestLimits: normalizeAppRequestLimits(requestLimits) } as unknown as KovoApp;
  }

  function requestWithPeerIp(method: string): Request {
    const request = new Request('http://app.example/page', { method });
    Object.defineProperty(request, '__kovoPeerAddress', {
      configurable: false,
      enumerable: false,
      value: '203.0.113.7',
      writable: false,
    });
    return request;
  }

  it('does not 429 sustained document GETs under the default per-IP budget', () => {
    const app = appWithLimits();
    for (let index = 0; index < 1_500; index += 1) {
      expect(preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other')).toBeUndefined();
    }
    expect(preDispatchLoadShedResponse(app, requestWithPeerIp('HEAD'), 'other')).toBeUndefined();
  });

  it('keeps the default per-IP budget for non-read methods on the document surface', () => {
    const app = appWithLimits();
    let shed: Response | undefined;
    for (let index = 0; index < 700 && shed === undefined; index += 1) {
      shed = preDispatchLoadShedResponse(app, requestWithPeerIp('POST'), 'other');
    }
    expect(shed?.status).toBe(429);
    expect(shed?.headers.get('retry-after')).toMatch(/^\d+$/u);
  });

  it('keeps per-IP shedding for mutations and queries', () => {
    const app = appWithLimits();
    let mutationShed: Response | undefined;
    for (let index = 0; index < 200 && mutationShed === undefined; index += 1) {
      mutationShed = preDispatchLoadShedResponse(app, requestWithPeerIp('POST'), 'mutation');
    }
    expect(mutationShed?.status).toBe(429);

    const queryApp = appWithLimits();
    let queryShed: Response | undefined;
    for (let index = 0; index < 700 && queryShed === undefined; index += 1) {
      queryShed = preDispatchLoadShedResponse(queryApp, requestWithPeerIp('GET'), 'query');
    }
    expect(queryShed?.status).toBe(429);
  });

  it('enforces an app-authored per-IP budget on document GETs', () => {
    const app = appWithLimits({ perIp: { max: 5 } });
    let shed: Response | undefined;
    for (let index = 0; index < 10 && shed === undefined; index += 1) {
      shed = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
    }
    expect(shed?.status).toBe(429);
  });

  it('keeps the mandatory global budget on document GETs', () => {
    const app = appWithLimits({ global: { max: 25 } });
    let shed: Response | undefined;
    for (let index = 0; index < 40 && shed === undefined; index += 1) {
      shed = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
    }
    expect(shed?.status).toBe(429);
  });
});

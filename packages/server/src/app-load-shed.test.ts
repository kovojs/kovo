import { afterEach, describe, expect, it } from 'vitest';

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

  /**
   * D10 (plans/good-perf.md) / SPEC §9.5 multi-process deployment posture: rate budgets describe
   * the deployment aggregate. `KOVO_PROCESSES=N` makes each process enforce `ceil(max / N)`;
   * unset or `1` keeps single-process behavior identical; an unparseable value fails loudly.
   */
  describe('process-aware rate budgets (SPEC §9.5, D10)', () => {
    afterEach(() => {
      delete process.env.KOVO_PROCESSES;
    });

    it('divides an authored per-IP budget by the declared process count', () => {
      process.env.KOVO_PROCESSES = '4';
      const app = appWithLimits({ perIp: { max: 20 } });
      let admitted = 0;
      let shed: Response | undefined;
      for (let index = 0; index < 20 && shed === undefined; index += 1) {
        shed = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
        if (shed === undefined) admitted += 1;
      }
      // ceil(20 / 4) = 5 admitted per process share.
      expect(admitted).toBe(5);
      expect(shed?.status).toBe(429);
    });

    it('divides the global budget by the declared process count', () => {
      process.env.KOVO_PROCESSES = '2';
      const app = appWithLimits({ global: { max: 10 } });
      let admitted = 0;
      let shed: Response | undefined;
      for (let index = 0; index < 12 && shed === undefined; index += 1) {
        shed = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
        if (shed === undefined) admitted += 1;
      }
      expect(admitted).toBe(5);
      expect(shed?.status).toBe(429);
    });

    it('keeps single-process behavior identical when unset or 1', () => {
      process.env.KOVO_PROCESSES = '1';
      const app = appWithLimits({ perIp: { max: 3 } });
      let admitted = 0;
      let shed: Response | undefined;
      for (let index = 0; index < 5 && shed === undefined; index += 1) {
        shed = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
        if (shed === undefined) admitted += 1;
      }
      expect(admitted).toBe(3);
    });

    it('fails loudly on an unparseable KOVO_PROCESSES instead of multiplying the budget', () => {
      process.env.KOVO_PROCESSES = 'two';
      const app = appWithLimits();
      expect(() => preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other')).toThrow(
        /KOVO_PROCESSES must be a decimal integer/u,
      );
      process.env.KOVO_PROCESSES = '0';
      expect(() => preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other')).toThrow(
        /KOVO_PROCESSES/u,
      );
    });

    it('never divides below one admitted request per window', () => {
      process.env.KOVO_PROCESSES = '1024';
      const app = appWithLimits({ perIp: { max: 3 } });
      const first = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
      expect(first).toBeUndefined();
      const second = preDispatchLoadShedResponse(app, requestWithPeerIp('GET'), 'other');
      expect(second?.status).toBe(429);
    });
  });
});

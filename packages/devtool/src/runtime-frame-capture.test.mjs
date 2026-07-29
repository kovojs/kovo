import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { runtimeFrameCaptureMiddleware } from './runtime-frame-capture.mjs';
import { createRuntimeFrameStore } from './runtime-frames.mjs';

class FixtureResponse extends EventEmitter {
  constructor() {
    super();
    this.body = [];
    this.headers = new Map();
    this.statusCode = 200;
  }

  end(chunk) {
    if (chunk !== undefined && typeof chunk !== 'function') this.body.push(Buffer.from(chunk));
    this.emit('finish');
    return this;
  }

  getHeader(name) {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name, value) {
    this.headers.set(name.toLowerCase(), value);
  }

  write(chunk) {
    this.body.push(Buffer.from(chunk));
    return false;
  }
}

describe('devtool Vite runtime frame capture', () => {
  it('preserves response backpressure while recording pending and settled phases', () => {
    const store = createRuntimeFrameStore();
    const middleware = runtimeFrameCaptureMiddleware({ app: 'demo', store });
    const response = new FixtureResponse();
    let backpressure;

    middleware(
      {
        headers: { 'kovo-targets': 'orders=orderHistory' },
        url: '/_m/orders%2Frefresh',
      },
      response,
      () => {
        response.setHeader('Kovo-Changes', '[{"domain":"orders","keys":["customer-secret"]}]');
        response.write('<kovo-que');
        response.write('ry name="orderHistory" key="customer-secret" settles="idem-secret" delta>');
        backpressure = response.write('{"email":"secret@example.test"}');
        response.end('</kovo-query>');
      },
    );

    expect(backpressure).toBe(false);
    expect(store.recent()).toMatchObject([
      { mutation: 'orders/refresh', phase: 'pending', sequence: 1 },
      {
        changes: [{ domain: 'orders', keyCount: 1 }],
        mutation: 'orders/refresh',
        phase: 'settled',
        queries: [
          {
            bytes: 31,
            delta: true,
            keyed: true,
            name: 'orderHistory',
            settlesPendingWork: true,
            value: 'redacted',
          },
        ],
        sequence: 2,
      },
    ]);
    const serialized = JSON.stringify(store.recent());
    expect(serialized).not.toContain('customer-secret');
    expect(serialized).not.toContain('idem-secret');
    expect(serialized).not.toContain('secret@example.test');
    expect(Object.hasOwn(response, 'write')).toBe(false);
    expect(Object.hasOwn(response, 'end')).toBe(false);
  });

  it('does not wrap unrelated traffic and marks a capped side capture as truncated', () => {
    const store = createRuntimeFrameStore();
    const middleware = runtimeFrameCaptureMiddleware({
      app: 'demo',
      maxBodyBytes: 64,
      store,
    });
    const unrelated = new FixtureResponse();
    expect(Object.hasOwn(unrelated, 'write')).toBe(false);
    middleware({ headers: {}, url: '/assets/app.js' }, unrelated, () => unrelated.end('asset'));
    expect(Object.hasOwn(unrelated, 'write')).toBe(false);
    expect(store.recent()).toEqual([]);

    const response = new FixtureResponse();
    middleware({ headers: {}, url: '/_m/large' }, response, () => {
      response.write(`<kovo-query name="orders">${'private-value'.repeat(20)}</kovo-query>`);
      response.end();
    });
    expect(store.recent().at(-1)).toMatchObject({
      mutation: 'large',
      phase: 'settled',
      truncated: true,
    });
  });

  it('bounds concurrent parsers and deterministically releases their slots', () => {
    const store = createRuntimeFrameStore();
    const middleware = runtimeFrameCaptureMiddleware({
      app: 'demo',
      maxConcurrentCaptures: 1,
      store,
    });
    const first = new FixtureResponse();
    middleware({ headers: {}, url: '/_m/first' }, first, () => {});

    const overLimit = new FixtureResponse();
    middleware({ headers: {}, url: '/_m/over-limit' }, overLimit, () => {
      overLimit.end('<kovo-query name="ignored">private</kovo-query>');
    });
    expect(store.recent().at(-1)).toMatchObject({
      mutation: 'over-limit',
      phase: 'settled',
      queries: [],
      truncated: true,
    });

    first.end('<kovo-query name="firstQuery">private</kovo-query>');
    const afterRelease = new FixtureResponse();
    middleware({ headers: {}, url: '/_m/after-release' }, afterRelease, () => {
      afterRelease.end('<kovo-query name="afterRelease">private</kovo-query>');
    });
    expect(store.recent().at(-1)).toMatchObject({
      mutation: 'after-release',
      phase: 'settled',
      queries: [{ name: 'afterRelease', value: 'redacted' }],
      truncated: false,
    });
  });

  it('never lets a failing debug observer change the application response path', () => {
    const middleware = runtimeFrameCaptureMiddleware({
      app: 'demo',
      store: {
        recordRoundTrip() {
          throw new Error('debug observer failed');
        },
      },
    });
    const response = new FixtureResponse();

    expect(() =>
      middleware({ headers: {}, url: '/_m/safe' }, response, () => {
        expect(response.write('application body')).toBe(false);
        response.end(() => {});
      }),
    ).not.toThrow();
    expect(Buffer.concat(response.body).toString('utf8')).toBe('application body');
  });
});

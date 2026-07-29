import { describe, expect, it } from 'vitest';

import { createRuntimeFrameStore, runtimeFrameSseResponse } from './runtime-frames.mjs';

describe('devtool runtime frame store', () => {
  it('keeps only bounded graph-routing facts from enhanced round trips', () => {
    const store = createRuntimeFrameStore({ limit: 4 });
    const pending = store.recordRoundTrip({
      app: 'commerce',
      phase: 'pending',
      targetsHeader:
        'cart-badge%3Acustomer-77=cart %21product%21product%3Acustomer-77; orders=orderHistory',
      url: '/_m/cart%2Fadd?token=do-not-retain',
    });
    const settled = store.recordRoundTrip({
      app: 'commerce',
      body: '{"customer":"customer-77","token":"do-not-retain"}',
      changesHeader:
        '[{"domain":"cart","keys":["customer-77"]},{"domain":"product","keys":["secret-key"]}]',
      phase: 'settled',
      queries: [
        {
          bytes: 55,
          delta: false,
          keyed: true,
          name: 'cart',
          settlesPendingWork: true,
          value: 'redacted',
        },
        {
          bytes: 33,
          delta: true,
          keyed: false,
          name: 'product',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      status: 200,
      targetsHeader: 'cart-badge%3Acustomer-77=cart',
      url: '/_m/cart%2Fadd?token=do-not-retain',
    });

    expect(pending).toMatchObject({
      app: 'commerce',
      changes: [],
      mutation: 'cart/add',
      phase: 'pending',
      queries: [],
      sequence: 1,
      targets: {
        count: 2,
        queryNames: ['cart', 'orderHistory', 'product'],
        truncated: false,
      },
    });
    expect(settled).toMatchObject({
      changes: [
        { domain: 'cart', keyCount: 1 },
        { domain: 'product', keyCount: 1 },
      ],
      mutation: 'cart/add',
      phase: 'settled',
      queries: [
        {
          delta: false,
          keyed: true,
          name: 'cart',
          settlesPendingWork: true,
          value: 'redacted',
        },
        {
          delta: true,
          keyed: false,
          name: 'product',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      sequence: 2,
      status: 200,
    });
    const serialized = JSON.stringify(store.recent());
    expect(serialized).not.toContain('customer-77');
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('idem-secret');
    expect(serialized).not.toContain('do-not-retain');
    expect(serialized).not.toContain('cart-badge');
    expect(Object.isFrozen(settled)).toBe(true);
    expect(Object.isFrozen(settled.queries)).toBe(true);
  });

  it('evicts deterministically, bounds subscribers, and stops after close', () => {
    const store = createRuntimeFrameStore({ limit: 2, maxSubscribers: 1 });
    const seen = [];
    const unsubscribe = store.subscribe((frame) => seen.push(frame.sequence));
    expect(() => store.subscribe(() => {})).toThrow(/subscriber limit/u);

    for (const mutation of ['one', 'two', 'three']) {
      store.recordRoundTrip({ app: 'demo', phase: 'pending', url: `/_m/${mutation}` });
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(store.recent().map((frame) => frame.mutation)).toEqual(['two', 'three']);

    unsubscribe();
    store.close();
    expect(store.closed).toBe(true);
    expect(store.recent()).toEqual([]);
    expect(
      store.recordRoundTrip({ app: 'demo', phase: 'pending', url: '/_m/four' }),
    ).toBeUndefined();
  });

  it('fails closed on oversized or malformed carriers without retaining them', () => {
    const store = createRuntimeFrameStore();
    const frame = store.recordRoundTrip({
      app: 'demo',
      changesHeader: '{not-json',
      phase: 'settled',
      queries: [
        { bytes: 1, name: '<unsafe>', value: 'secret' },
        {
          bytes: 7,
          delta: false,
          keyed: false,
          name: 'safe',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      targetsHeader: 'target=%E0%A4%A',
      url: '/_m/refresh',
    });

    expect(frame).toMatchObject({
      changes: [],
      mutation: 'refresh',
      queries: [{ name: 'safe', value: 'redacted' }],
      targets: { count: 1, queryNames: [], truncated: true },
      truncated: true,
    });
    expect(JSON.stringify(frame)).not.toContain('secret');
  });

  it('streams the exact redacted store frame and rejects cross-origin readers', async () => {
    const store = createRuntimeFrameStore();
    const frame = store.recordRoundTrip({
      app: 'demo',
      phase: 'settled',
      queries: [
        {
          bytes: 29,
          delta: false,
          keyed: false,
          name: 'orders',
          raw: '{"secret":"never-stream"}',
          settlesPendingWork: false,
          value: 'redacted',
        },
      ],
      status: 200,
      url: '/_m/orders%2Frefresh',
    });
    const abort = new AbortController();
    const response = runtimeFrameSseResponse({
      app: 'demo',
      request: new Request('https://kovo.test/_runtime/frames?app=demo', {
        headers: { Origin: 'https://kovo.test' },
        signal: abort.signal,
      }),
      store,
    });
    const reader = response.body.getReader();
    let text = '';
    while (!text.includes('event: frame')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain(JSON.stringify(frame));
    expect(text).not.toContain('never-stream');
    await reader.cancel();
    abort.abort();

    expect(
      runtimeFrameSseResponse({
        app: 'demo',
        request: new Request('https://kovo.test/_runtime/frames', {
          headers: { Origin: 'https://attacker.invalid' },
        }),
        store,
      }).status,
    ).toBe(403);
  });

  it('coalesces blocked SSE consumers and releases subscriber capacity on cancel', async () => {
    const store = createRuntimeFrameStore({ limit: 2, maxSubscribers: 1 });
    const request = () =>
      new Request('https://kovo.test/_runtime/frames?app=demo', {
        headers: { Origin: 'https://kovo.test' },
      });
    const stream = runtimeFrameSseResponse({ app: 'demo', request: request(), store });
    expect(runtimeFrameSseResponse({ app: 'demo', request: request(), store }).status).toBe(503);

    for (const mutation of ['one', 'two', 'three']) {
      store.recordRoundTrip({ app: 'demo', phase: 'pending', url: `/_m/${mutation}` });
    }
    const reader = stream.body.getReader();
    const first = await reader.read();
    const second = await reader.read();
    const output = new TextDecoder().decode(first.value) + new TextDecoder().decode(second.value);
    expect(output).toContain('"mutation":"three"');
    expect(output).not.toContain('"mutation":"one"');
    expect(output).not.toContain('"mutation":"two"');

    await reader.cancel();
    const replacement = runtimeFrameSseResponse({ app: 'demo', request: request(), store });
    expect(replacement.status).toBe(200);
    await replacement.body.cancel();
  });

  it('snapshots subscribers before notification so reentrant subscriptions are deterministic', () => {
    const store = createRuntimeFrameStore();
    const seen = [];
    store.subscribe((frame) => {
      seen.push(`first:${frame.sequence}`);
      if (frame.sequence === 1) {
        store.subscribe((nextFrame) => seen.push(`second:${nextFrame.sequence}`));
      }
    });

    store.recordRoundTrip({ app: 'demo', phase: 'pending', url: '/_m/one' });
    store.recordRoundTrip({ app: 'demo', phase: 'pending', url: '/_m/two' });

    expect(seen).toEqual(['first:1', 'first:2', 'second:2']);
  });
});

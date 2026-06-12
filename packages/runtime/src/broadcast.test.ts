import { describe, expect, it, vi } from 'vitest';

import { installMutationBroadcast } from './broadcast.js';
import { createQueryStore } from './query-store.js';

class FakeBroadcastChannel {
  closed = false;
  messages: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  close(): void {
    this.closed = true;
  }
}

class FakeMorphTarget {
  html = '';

  replaceWithHtml(html: string): void {
    this.html = html;
  }

  readHtml(): string {
    return this.html;
  }
}

class FakeMorphRoot {
  readonly target = new FakeMorphTarget();

  findFragmentTarget(target: string): FakeMorphTarget | null {
    return target === 'cart-badge' ? this.target : null;
  }
}

describe('mutation broadcast', () => {
  it('publishes sanitized change records and applies received mutation wire bodies', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const root = new FakeMorphRoot();
    const onChanges = vi.fn();

    const broadcast = installMutationBroadcast({ channel, onChanges, root, store });

    broadcast.publish('<fw-query name="cart">{"count":1}</fw-query>', [
      { domain: 'cart', input: { productId: 'p1' } },
      { domain: 'product', keys: ['p1'] },
    ] as never);

    expect(channel.messages).toEqual([
      {
        body: '<fw-query name="cart">{"count":1}</fw-query>',
        changes: [{ domain: 'cart' }, { domain: 'product', keys: ['p1'] }],
        type: 'jiso:mutation-response',
      },
    ]);

    channel.onmessage?.({
      data: {
        body: [
          '<fw-query name="cart">{"count":2}</fw-query>',
          '<fw-fragment target="cart-badge"><cart-badge>2</cart-badge></fw-fragment>',
        ].join(''),
        changes: [{ domain: 'cart', keys: ['cart:1'] }],
        type: 'jiso:mutation-response',
      },
    });

    // SPEC.md §9.2: broadcast replay consumes the same mutation wire body as
    // direct enhanced submits, updating query data before fragment morphing.
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.target.html).toBe('<cart-badge>2</cart-badge>');
    expect(onChanges).toHaveBeenCalledWith([{ domain: 'cart', keys: ['cart:1'] }]);
  });

  it('ignores invalid messages and detaches from the channel on close', () => {
    const channel = new FakeBroadcastChannel();
    const store = createQueryStore();
    const broadcast = installMutationBroadcast({ channel, store });

    channel.onmessage?.({
      data: {
        body: '<fw-query name="cart">{"count":2}</fw-query>',
        changes: [{ domain: 'cart', keys: [1] }],
        type: 'jiso:mutation-response',
      },
    });
    expect(store.get('cart')).toBeUndefined();

    broadcast.close();

    expect(channel.onmessage).toBeNull();
    expect(channel.closed).toBe(true);
  });
});

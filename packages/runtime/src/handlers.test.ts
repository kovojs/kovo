import { describe, expect, it, vi } from 'vitest';

import * as runtime from './index.js';
import { dispatchDelegatedEvent } from './handlers.js';
import { FakeElement } from './runtime-test-fakes.js';

describe('delegated handler reference dispatch', () => {
  it('keeps handler reference parsing private to dispatch', async () => {
    const calls: string[] = [];
    const remove = vi.fn(() => {
      calls.push('remove');
    });
    const sync = vi.fn(() => {
      calls.push('sync');
    });
    const importModule = vi.fn(async (url: string) => {
      if (url === '/c/cart.client.js?v=1') return { Cart$remove: remove };
      return { Cart$sync: sync };
    });
    const element = new FakeElement({
      'on:click': '/c/cart.client.js?v=1#Cart$remove  /c/cart.client.js?v=2#Cart$sync',
    });

    await dispatchDelegatedEvent({ target: element, type: 'click' }, importModule);

    // SPEC.md §4.4/§4.7: url#export handler refs are loader internals, not a
    // public parser API; dispatch remains the only runtime behavior surface.
    expect(Object.hasOwn(runtime, 'parseHandlerReference')).toBe(false);
    expect(Object.hasOwn(runtime, 'parseHandlerReferences')).toBe(false);
    expect(importModule).toHaveBeenNthCalledWith(1, '/c/cart.client.js?v=1');
    expect(importModule).toHaveBeenNthCalledWith(2, '/c/cart.client.js?v=2');
    expect(calls).toEqual(['remove', 'sync']);
  });

  it('rejects malformed handler references through delegated dispatch', async () => {
    const element = new FakeElement({ 'on:click': '/c/cart.client.js#' });

    await expect(
      dispatchDelegatedEvent({ target: element, type: 'click' }, vi.fn()),
    ).rejects.toThrow('Invalid handler reference: /c/cart.client.js#');
  });
});

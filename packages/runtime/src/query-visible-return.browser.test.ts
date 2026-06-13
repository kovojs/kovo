import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore, installJisoLoader } from './index.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser query visible-return refetch', () => {
  it('refetches typed reads on document visible-return without a window focus duplicate', async () => {
    document.body.innerHTML =
      '<script fw-query="cart" type="application/json">{"count":1}</script>';
    const store = createQueryStore();
    let resolveText: ((body: string) => void) | undefined;
    const textDone = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const fetch = vi.fn(async () => ({
      status: 200,
      text: () => textDone,
    }));

    const loader = installJisoLoader({
      importModule: vi.fn(),
      queryRefetch: { fetch },
      queryStore: store,
      root: document,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    resolveText?.('<fw-query name="cart">{"count":2}</fw-query>');
    await vi.waitFor(() => expect(store.get('cart')).toEqual({ count: 2 }));

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);

    loader.dispose();
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

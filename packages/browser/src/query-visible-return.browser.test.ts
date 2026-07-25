import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore } from './client.js';
import { installKovoLoader } from './generated.js';
import {
  browserTransportTestBuild,
  browserTransportTestSourceUrl,
  queryTestResponse,
} from './runtime-test-fakes.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser query visible-return refetch', () => {
  it('refetches typed reads on document visible-return without a window focus duplicate', async () => {
    document.body.innerHTML = [
      `<meta name="kovo-build" content="${browserTransportTestBuild}">`,
      '<script kovo-query="cart" data-kovo-query-href="/_q/cart" type="application/json">{"count":1}</script>',
    ].join('');
    const store = createQueryStore();
    let resolveText: ((body: string) => void) | undefined;
    const textDone = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const fetch = vi.fn(async (url: string) =>
      queryTestResponse(url, {
        status: 200,
        text: () => textDone,
      }),
    );

    const loader = installKovoLoader({
      importModule: vi.fn(),
      queryRefetch: {
        expectedBuildToken: browserTransportTestBuild,
        fetch,
        sourceUrl: browserTransportTestSourceUrl,
      },
      queryStore: store,
      root: document,
    });

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    resolveText?.('<kovo-query name="cart">{"count":2}</kovo-query>');
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

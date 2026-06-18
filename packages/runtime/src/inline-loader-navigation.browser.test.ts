import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

const initialUrl = location.href;

afterEach(() => {
  document.head.innerHTML = '';
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  history.replaceState({}, '', initialUrl);
});

describe('browser inline loader enhanced navigation', () => {
  it('fetches full documents for eligible anchors and leaves ineligible clicks native', async () => {
    history.replaceState({}, '', '/products');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page" kovo-nav-components="ProductGrid">Products</section>',
      '</main>',
    ].join('');
    const layout = document.querySelector('main');
    const scrollTo = vi.fn();
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
          '<a id="to-cart" href="/cart">Cart</a>',
          '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page" kovo-nav-components="CartView">Cart ready</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/cart', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    installInlineKovoLoader(async () => ({}));

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('#to-cart')?.dispatchEvent(click);

    await vi.waitFor(() => expect(document.title).toBe('Cart'));

    expect(click.defaultPrevented).toBe(true);
    expect(fetch).toHaveBeenCalledWith(new URL('/cart', location.href).href, {
      headers: { Accept: 'text/html' },
    });
    expect(document.querySelector('main')).toBe(layout);
    expect(document.activeElement).toBe(layout);
    expect(layout?.getAttribute('tabindex')).toBe('-1');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(history.scrollRestoration).toBe('manual');
    expect(document.querySelector('[kovo-nav-segment="page:/cart"]')?.textContent).toBe(
      'Cart ready',
    );
    expect(location.pathname).toBe('/cart');

    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    document.querySelector('#to-cart')?.dispatchEvent(modified);

    expect(modified.defaultPrevented).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

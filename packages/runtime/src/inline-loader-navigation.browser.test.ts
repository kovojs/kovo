import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

const initialUrl = location.href;

afterEach(() => {
  document.head.innerHTML = '';
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, '', initialUrl);
});

describe('browser inline loader enhanced navigation', () => {
  it('fetches full documents for eligible anchors and leaves ineligible clicks native', async () => {
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
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined);
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
    const navigated = vi.fn();
    addEventListener('kovo:navigate', navigated);

    try {
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
      expect(pushState).toHaveBeenCalledWith({}, '', new URL('/cart', initialUrl).href);
      expect(navigated).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { url: new URL('/cart', initialUrl).href },
        }),
      );

      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      removeEventListener('kovo:navigate', navigated);
    }
  });

  it('ignores stale full-document responses when a newer navigation wins', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Start</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="slow" href="/slow">Slow</a>',
      '<a id="fast" href="/fast">Fast</a>',
      '<section kovo-nav-segment="page:/start" kovo-nav-kind="page" kovo-nav-name="page">Start</section>',
      '</main>',
    ].join('');

    let resolveSlow: ((value: unknown) => void) | undefined;
    let resolveFast: ((value: unknown) => void) | undefined;
    const response = (path: string, label: string) => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          `<title>${label}</title>`,
          '</head><body>',
          '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
          `<section kovo-nav-segment="page:/${path}" kovo-nav-kind="page" kovo-nav-name="page">${label}</section>`,
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL(`/${path}`, location.href).href,
    });
    const fetch = vi.fn(
      (href: string) =>
        new Promise((resolve) => {
          if (href.endsWith('/slow')) resolveSlow = resolve;
          if (href.endsWith('/fast')) resolveFast = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installInlineKovoLoader(async () => ({}));
    document.querySelector('#slow')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    document.querySelector('#fast')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    resolveFast?.(response('fast', 'Fast'));
    await vi.waitFor(() =>
      expect(document.querySelector('[kovo-nav-segment="page:/fast"]')?.textContent).toBe('Fast'),
    );

    resolveSlow?.(response('slow', 'Slow'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[kovo-nav-segment="page:/fast"]')?.textContent).toBe('Fast');
    expect(document.querySelector('[kovo-nav-segment="page:/slow"]')).toBeNull();
  });

  it('collects mutation live targets from the post-navigation DOM', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Start</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop" kovo-fragment-target="layout-shell" kovo-live-component="layout-shell/layout-shell" kovo-deps="viewer">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/start" kovo-nav-kind="page" kovo-nav-name="page">',
      '<section kovo-fragment-target="old-target" kovo-deps="old">Old</section>',
      '</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async (href: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          async text() {
            return [
              '<kovo-fragment target="cart-badge">',
              '<section kovo-fragment-target="cart-badge" kovo-deps="cart">Updated cart</section>',
              '</kovo-fragment>',
            ].join('');
          },
        };
      }

      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            '<title>Cart</title>',
            '</head><body>',
            '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop" kovo-fragment-target="layout-shell" kovo-live-component="layout-shell/layout-shell" kovo-deps="viewer">',
            '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page">',
            '<form id="cart-form" enhance action="/_m/cart/add" method="post" kovo-fragment-target="cart-form">',
            '<button type="submit">Save</button>',
            '</form>',
            '<section kovo-fragment-target="cart-badge" kovo-live-component="cart-badge/cart-badge" kovo-deps="cart">Cart</section>',
            '</section>',
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: new URL('/cart', location.href).href,
      };
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installInlineKovoLoader(async () => ({}));
    document.querySelector('#to-cart')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[kovo-nav-segment="page:/cart"]')).not.toBeNull(),
    );

    document.querySelector('form')?.dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(document.querySelector('[kovo-fragment-target="cart-badge"]')?.textContent).toBe(
        'Updated cart',
      ),
    );

    const mutationRequest = fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )?.[1] as RequestInit | undefined;
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Form-Target']).toBe(
      'cart-form',
    );
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Targets']).toContain(
      'cart-badge=cart',
    );
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Targets']).toContain(
      'layout-shell=viewer',
    );
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Targets']).not.toContain(
      'old-target',
    );
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Live-Targets']).toContain(
      'cart-badge#cart-badge/cart-badge:{}',
    );
    expect((mutationRequest?.headers as Record<string, string>)['Kovo-Live-Targets']).toContain(
      'layout-shell#layout-shell/layout-shell:{}',
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

const initialUrl = location.href;
let inlineLoaderInstalled = false;
let inlineImportModule: (url: string) => Promise<Record<string, unknown>> = async () => ({});

function installNavigationLoader(): void {
  if (inlineLoaderInstalled) return;
  installInlineKovoLoader((url) => inlineImportModule(url));
  inlineLoaderInstalled = true;
}

function dispatchAnchorLikeClick(href: string): MouseEvent {
  const target = document.createElement('button');
  const anchor = {
    hasAttribute: () => false,
    href: new URL(href, initialUrl).href,
    target: '',
  };
  target.closest = ((selector: string) =>
    selector === 'a[href]' ? anchor : null) as typeof target.closest;
  document.body.append(target);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  target.remove();
  return event;
}

function comparableBodyMarkup(source: Document | string): string {
  const doc =
    typeof source === 'string' ? new DOMParser().parseFromString(source, 'text/html') : source;
  const clone = doc.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[tabindex="-1"]').forEach((element) => {
    element.removeAttribute('tabindex');
  });
  return clone.innerHTML;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.replaceChildren();
  inlineImportModule = async () => ({});
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
    const targetHtml = [
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
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return targetHtml;
      },
      url: new URL('/cart', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);
    const navigated = vi.fn();
    addEventListener('kovo:navigate', navigated);

    try {
      installNavigationLoader();

      const click = dispatchAnchorLikeClick('/cart');

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
      expect(comparableBodyMarkup(document)).toBe(comparableBodyMarkup(targetHtml));
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

  it('updates head, html, and body shell fields from the target document', async () => {
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.setAttribute('data-route', 'products');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
      '<meta name="description" content="Products">',
      '<link rel="stylesheet" href="/products.css">',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="fr" data-theme="dark"><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '<meta name="description" content="Cart">',
          '<link rel="modulepreload" href="/cart.client.js">',
          '<script type="speculationrules">{"prefetch":[{"source":"list","urls":["/checkout"]}]}</script>',
          '</head><body data-route="cart" data-shell="checkout">',
          '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
          '<a id="to-cart" href="/cart">Cart</a>',
          '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page">Cart</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/cart', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/cart');

    await vi.waitFor(() => expect(document.title).toBe('Cart'));

    expect(document.documentElement.getAttribute('lang')).toBe('fr');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('data-route')).toBe('cart');
    expect(document.body.getAttribute('data-shell')).toBe('checkout');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Cart',
    );
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(document.querySelector('link[rel="modulepreload"]')?.getAttribute('href')).toBe(
      '/cart.client.js',
    );
    expect(document.querySelector('script[type="speculationrules"]')?.textContent).toContain(
      '/checkout',
    );
  });

  it('preserves layout island signals and starts inserted page triggers', async () => {
    const layoutController = new AbortController();
    const oldPageController = new AbortController();
    const load = vi.fn();
    const idle = vi.fn();
    const visible = vi.fn();
    inlineImportModule = async (url) => {
      if (url === '/c/page.js') return { idle, load, visible };
      return {};
    };
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 0 });
      return 1;
    });
    vi.stubGlobal(
      'IntersectionObserver',
      class TestIntersectionObserver {
        constructor(
          private readonly callback: (
            entries: Array<{ isIntersecting: boolean; target: Element }>,
          ) => void,
        ) {}

        observe(target: Element): void {
          this.callback([{ isIntersecting: true, target }]);
        }

        unobserve(): void {}
      },
    );
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Products</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<section id="layout-island" kovo-c="layout-shell">Layout</section>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">',
      '<article id="old-page-island" kovo-c="product-grid">Products</article>',
      '</section>',
      '</main>',
    ].join('');
    (
      document.querySelector('#layout-island') as (Element & { a?: AbortController }) | null
    )!.a = layoutController;
    (
      document.querySelector('#old-page-island') as (Element & { a?: AbortController }) | null
    )!.a = oldPageController;
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
          '<section id="layout-island" kovo-c="layout-shell">Layout</section>',
          '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page">',
          '<article id="new-page-island" on:load="/c/page.js#load" on:idle="/c/page.js#idle" on:visible="/c/page.js#visible">Cart</article>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/cart', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/cart');

    await vi.waitFor(() => expect(document.title).toBe('Cart'));
    await vi.waitFor(() => expect(visible).toHaveBeenCalledTimes(1));

    expect(document.querySelector('#layout-island')).not.toBeNull();
    expect(document.querySelector('#old-page-island')).toBeNull();
    expect(document.querySelector('#new-page-island')).not.toBeNull();
    expect(layoutController.signal.aborted).toBe(false);
    expect(oldPageController.signal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('scrolls to target-document hash anchors after navigation', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Products</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const scrollIntoView = vi.fn();
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
          '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="checkout">Checkout</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/cart#checkout', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/cart#checkout');

      await vi.waitFor(() => expect(document.title).toBe('Cart'));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalledWith(0, 0);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('collects mutation live targets after enhanced navigation', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Products</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop" kovo-fragment-target="layout-shell" kovo-live-component="layout-shell/layout-shell" kovo-deps="viewer">',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">',
      '<section kovo-fragment-target="old-target" kovo-deps="old">Old</section>',
      '</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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

    installNavigationLoader();
    dispatchAnchorLikeClick('/cart');
    await vi.waitFor(() =>
      expect(document.querySelector('[kovo-nav-segment="page:/cart"]')).not.toBeNull(),
    );
    document.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault());

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

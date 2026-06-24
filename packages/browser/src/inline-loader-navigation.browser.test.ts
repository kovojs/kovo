import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

const initialUrl = location.href;
const initialDocumentElementAttributes = Array.from(document.documentElement.attributes).map(
  (attribute) => [attribute.name, attribute.value] as const,
);
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

function currentElementScrollIntoView(): Element['scrollIntoView'] {
  return Reflect.get(Element.prototype, 'scrollIntoView') as Element['scrollIntoView'];
}

function currentElementGetBoundingClientRect(): Element['getBoundingClientRect'] {
  return Reflect.get(
    Element.prototype,
    'getBoundingClientRect',
  ) as Element['getBoundingClientRect'];
}

function installRafQueue(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return callbacks;
}

function runQueuedRafFrame(callbacks: FrameRequestCallback[]): void {
  const pending = callbacks.splice(0);
  for (const callback of pending) {
    callback(performance.now());
  }
}

function requestInputHref(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

afterEach(() => {
  document.head.innerHTML = '';
  for (const attribute of Array.from(document.documentElement.attributes)) {
    document.documentElement.removeAttribute(attribute.name);
  }
  for (const [name, value] of initialDocumentElementAttributes) {
    document.documentElement.setAttribute(name, value);
  }
  document.body.replaceChildren();
  localStorage.removeItem('theme');
  inlineImportModule = async () => ({});
  delete (globalThis as typeof globalThis & { __navDeferredApplied?: number })
    .__navDeferredApplied;
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
        headers: { Accept: 'text/vnd.kovo.document+html, text/html' },
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

  it('executes deferred body scripts from full-document enhanced navigation targets', async () => {
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const targetHtml = [
      '<!doctype html><html><head>',
      '<meta name="kovo-build" content="build-a">',
      '<title>Cart</title>',
      '</head><body>',
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/cart" kovo-nav-kind="page" kovo-nav-name="page">',
      '<kovo-defer target="cart-rail">Loading rail</kovo-defer>',
      '<script type="application/json" id="cart-data">{"ok":true}</script>',
      '</section>',
      '</main>',
      '\n--kovo-boundary\n',
      '<kovo-fragment target="cart-rail"><aside id="cart-rail">Deferred rail</aside></kovo-fragment>',
      '<script data-kovo-csp-hash="sha256-apply">',
      'var s=document.currentScript,n=s.previousSibling,e=[];',
      'for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}',
      'globalThis.__navDeferredApplied = (globalThis.__navDeferredApplied || 0) + 1;',
      'globalThis.__kovo_a?.(e.join("\\n"));s.remove();',
      '</script>',
      '\n--kovo-boundary--\n',
      '<script data-kovo-csp-hash="sha256-cleanup">',
      'for (const node of [...document.body.childNodes]) if ((node.textContent || "").includes("--kovo-boundary")) node.remove();',
      'document.currentScript.remove();',
      '</script>',
      '</body></html>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return targetHtml;
      },
      url: new URL('/cart', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());

    installNavigationLoader();

    dispatchAnchorLikeClick('/cart');

    await vi.waitFor(() => expect(document.title).toBe('Cart'));
    await vi.waitFor(() =>
      expect(document.querySelector('#cart-rail')?.textContent).toBe('Deferred rail'),
    );

    expect(
      (globalThis as typeof globalThis & { __navDeferredApplied?: number }).__navDeferredApplied,
    ).toBe(1);
    expect(document.body.textContent).not.toContain('--kovo-boundary');
    expect(comparableBodyMarkup(document)).not.toContain('kovo-fragment');
    expect(document.querySelector('#cart-data')?.textContent).toBe('{"ok":true}');
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
          '<link rel="stylesheet" href="/cart.css">',
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
    expect(document.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      '/cart.css',
    );
    expect(document.querySelector('link[rel="modulepreload"]')?.getAttribute('href')).toBe(
      '/cart.client.js',
    );
    expect(document.querySelector('script[type="speculationrules"]')?.textContent).toContain(
      '/checkout',
    );
  });

  it('preserves matching loaded head asset nodes during enhanced navigation', async () => {
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
      '<link rel="stylesheet" href="/assets/site.css" data-loaded="css">',
      '<link rel="modulepreload" href="/c/shared.js" data-loaded="module">',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const stylesheet = document.querySelector('link[rel="stylesheet"][href="/assets/site.css"]');
    const modulepreload = document.querySelector('link[rel="modulepreload"][href="/c/shared.js"]');
    const movedAssets: string[] = [];
    const insertBefore = document.head.insertBefore.bind(document.head);
    vi.spyOn(document.head, 'insertBefore').mockImplementation((node, child) => {
      if (node === stylesheet || node === modulepreload) {
        movedAssets.push((node as Element).getAttribute('href') || (node as Element).tagName);
      }
      return insertBefore(node, child);
    });
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '<meta name="description" content="Cart">',
          '<link rel="stylesheet" href="/assets/site.css">',
          '<link rel="modulepreload" href="/c/shared.js">',
          '</head><body>',
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

    expect(document.querySelector('link[rel="stylesheet"][href="/assets/site.css"]')).toBe(
      stylesheet,
    );
    expect(document.querySelector('link[rel="modulepreload"][href="/c/shared.js"]')).toBe(
      modulepreload,
    );
    expect(movedAssets).toEqual([]);
    expect(document.head.innerHTML).not.toContain('data-kovo-head-preserve');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      'Cart',
    );
  });

  it('preserves promoted stylesheets when target documents emit deferred style preloads', async () => {
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
      '<style data-kovo-critical-href="/assets/site.css">main{display:block}</style>',
      '<link rel="stylesheet" href="/assets/site.css" data-loaded="css">',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Shop" kovo-nav-kind="layout" kovo-nav-name="Shop">',
      '<a id="to-cart" href="/cart">Cart</a>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const stylesheet = document.querySelector('link[rel="stylesheet"][href="/assets/site.css"]');
    const criticalStyle = document.querySelector(
      'style[data-kovo-critical-href="/assets/site.css"]',
    );
    const movedAssets: string[] = [];
    const insertBefore = document.head.insertBefore.bind(document.head);
    vi.spyOn(document.head, 'insertBefore').mockImplementation((node, child) => {
      if (node === stylesheet || node === criticalStyle) {
        movedAssets.push(
          (node as Element).getAttribute('href') ||
            (node as Element).getAttribute('data-kovo-critical-href') ||
            (node as Element).tagName,
        );
      }
      return insertBefore(node, child);
    });
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '<style data-kovo-critical-href="/assets/site.css">main{display:block}</style>',
          '<link rel="preload" as="style" href="/assets/site.css" data-kovo-deferred-style>',
          '<noscript><link rel="stylesheet" href="/assets/site.css"></noscript>',
          '</head><body>',
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

    const preserved = document.querySelector('link[href="/assets/site.css"]');
    expect(preserved).toBe(stylesheet);
    expect(document.querySelector('style[data-kovo-critical-href="/assets/site.css"]')).toBe(
      criticalStyle,
    );
    expect(preserved?.getAttribute('rel')).toBe('stylesheet');
    expect(preserved?.hasAttribute('data-kovo-deferred-style')).toBe(false);
    expect(movedAssets).toEqual([]);
    expect(document.head.innerHTML).not.toContain('data-kovo-head-preserve');
  });

  it('promotes deferred full stylesheet links after enhanced navigation commits head markup', async () => {
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
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
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '<style data-kovo-critical-href="/cart.css">main{display:block}</style>',
          '<link rel="preload" as="style" href="/cart.css" data-kovo-deferred-style>',
          '<noscript><link rel="stylesheet" href="/cart.css"></noscript>',
          '</head><body>',
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
    const rafCallbacks = installRafQueue();
    dispatchAnchorLikeClick('/cart');

    await vi.waitFor(() => expect(document.title).toBe('Cart'));
    runQueuedRafFrame(rafCallbacks);
    runQueuedRafFrame(rafCallbacks);
    await vi.waitFor(() => {
      const promoted = Array.from(document.head.children).find(
        (element) => element.tagName === 'LINK' && element.getAttribute('href') === '/cart.css',
      );
      expect(promoted?.getAttribute('rel')).toBe('stylesheet');
      expect(promoted?.hasAttribute('data-kovo-deferred-style')).toBe(false);
    });
    expect(document.head.querySelector('noscript')?.innerHTML).toContain(
      '<link rel="stylesheet" href="/cart.css">',
    );
  });

  it('preserves the client-applied docs theme class while updating target shell attributes', async () => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.className = 'dark stale-shell';
    document.documentElement.setAttribute('data-route', 'products');
    document.body.setAttribute('data-theme', 'products');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Products</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<button type="button" class="icon-btn" on:click="/c/theme.js#toggle">Theme</button>',
      '<section kovo-nav-segment="page:/products" kovo-nav-kind="page" kovo-nav-name="page">Products</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="en" class="target-shell" data-route="cart"><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Cart</title>',
          '</head><body data-theme="cart" data-shell="docs">',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<button type="button" class="icon-btn" on:click="/c/theme.js#toggle">Theme</button>',
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

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('target-shell')).toBe(true);
    expect(document.documentElement.classList.contains('stale-shell')).toBe(false);
    expect(document.documentElement.getAttribute('data-route')).toBe('cart');
    expect(document.body.getAttribute('data-theme')).toBe('cart');
    expect(document.body.getAttribute('data-shell')).toBe('docs');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('re-applies docs theme from localStorage when target shell classes would override it', async () => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.className = 'stale-shell';
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Docs</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="en" class="target-shell"><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body data-route="api">',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<a id="to-api" href="/api">API</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">API</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('target-shell')).toBe(true);
    expect(document.documentElement.classList.contains('stale-shell')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('dark');

    localStorage.setItem('theme', 'light');
    document.title = 'Docs';
    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('preserves explicit light html theme class across target documents with dark defaults', async () => {
    localStorage.setItem('theme', 'light');
    document.documentElement.className = 'light stale-shell';
    document.documentElement.setAttribute('data-theme', 'light');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Docs</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="en" class="dark target-shell"><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body data-route="api">',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<a id="to-api" href="/api">API</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">API</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('target-shell')).toBe(true);
    expect(document.documentElement.classList.contains('stale-shell')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('preserves explicit html data-theme across stale target shell state', async () => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.className = 'dark';
    document.documentElement.setAttribute('data-theme', 'dark');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Docs</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="en" class="light target-shell" data-theme="light">',
          '<head><meta name="kovo-build" content="build-a"><title>API</title></head>',
          '<body data-route="api">',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<a id="to-api" href="/api">API</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">API</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.classList.contains('target-shell')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('data-route')).toBe('api');
  });

  it('uses the latest user theme state when a pending enhanced navigation resolves', async () => {
    localStorage.setItem('theme', 'dark');
    document.documentElement.className = 'dark';
    document.documentElement.setAttribute('data-theme', 'dark');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Docs</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    let resolveText: ((html: string) => void) | undefined;
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      text: () =>
        new Promise<string>((resolve) => {
          resolveText = resolve;
        }),
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(resolveText).toBeTypeOf('function'));
    localStorage.setItem('theme', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    document.documentElement.setAttribute('data-theme', 'light');
    resolveText?.(
      [
        '<!doctype html><html lang="en" class="dark target-shell" data-theme="dark"><head>',
        '<meta name="kovo-build" content="build-a">',
        '<title>API</title>',
        '</head><body data-route="api">',
        '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
        '<a id="to-api" href="/api">API</a>',
        '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">API</section>',
        '</main>',
        '</body></html>',
      ].join(''),
    );

    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('target-shell')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('preserves docs theme state toggled through delegated handlers across page morphs', async () => {
    const toggle = vi.fn((event: Event) => {
      event.preventDefault();
      const dark = !document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    });
    inlineImportModule = async (url) => (url === '/c/theme.js' ? { toggle } : {});
    document.documentElement.className = '';
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<title>Docs</title>',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<button id="theme" type="button" on:click="/c/theme.js#toggle">Theme</button>',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html lang="en"><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body data-route="api">',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<button id="theme" type="button" on:click="/c/theme.js#toggle">Theme</button>',
          '<a id="to-api" href="/api">API</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">API</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    document
      .querySelector('#theme')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    dispatchAnchorLikeClick('/api');
    await vi.waitFor(() => expect(document.title).toBe('API'));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.body.getAttribute('data-route')).toBe('api');
    expect(localStorage.getItem('theme')).toBe('dark');
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
    (document.querySelector('#layout-island') as (Element & { a?: AbortController }) | null)!.a =
      layoutController;
    (document.querySelector('#old-page-island') as (Element & { a?: AbortController }) | null)!.a =
      oldPageController;
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

  it('does not replay preserved layout trigger listeners after enhanced navigation', async () => {
    const layoutLoad = vi.fn();
    const pageLoad = vi.fn();
    inlineImportModule = async (url) => {
      if (url === '/c/layout.js') return { layoutLoad };
      if (url === '/c/page.js') return { pageLoad };
      return {};
    };
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<header id="layout-island" on:load="/c/layout.js#layoutLoad">Docs</header>',
      '<a id="to-api" href="/api">API</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<header id="layout-island" on:load="/c/layout.js#layoutLoad">Docs</header>',
          '<a id="to-api" href="/api">API</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<article id="api-page" on:load="/c/page.js#pageLoad">API</article>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    (document.querySelector('#layout-island') as
      | (HTMLElement & { __kovo_load?: number })
      | null)!.__kovo_load = 1;

    dispatchAnchorLikeClick('/api');

    await vi.waitFor(() => expect(pageLoad).toHaveBeenCalledTimes(1));

    expect(layoutLoad).not.toHaveBeenCalled();
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
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/cart#checkout');

      await vi.waitFor(() => expect(document.title).toBe('Cart'));

      expect(scrollIntoView).toHaveBeenCalled();
      expect(scrollTo).not.toHaveBeenCalledWith(0, 0);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('preserves requested hash fragments when fetch response URLs omit them', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-symbol" href="/api/core/#symbols%2Ffragment">Symbol</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API Core</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<section kovo-nav-segment="page:/api/core" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="symbols/fragment">Fragment target</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api/core/', location.href).href,
    }));
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api/core/#symbols%2Ffragment');

      await vi.waitFor(() => expect(document.title).toBe('API Core'));

      expect(location.href).toBe(new URL('/api/core/#symbols%2Ffragment', initialUrl).href);
      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'symbols/fragment')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('scrolls to decoded API rail symbol hash anchors after enhanced navigation', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<nav class="api-nav" aria-label="Symbols on this page">',
          '<a href="#symbols%2Fproperty%20value">property value</a>',
          '</nav>',
          '<article class="prose"><h2 id="symbols/property value">property value</h2></article>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api#symbols%2Fproperty%20value', location.href).href,
    }));
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api#symbols%2Fproperty%20value');

      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'symbols/property value')).toBe(true);
      expect(scrollTo).not.toHaveBeenCalledWith(0, 0);
      expect(pushState).toHaveBeenCalledWith(
        {},
        '',
        new URL('/api#symbols%2Fproperty%20value', initialUrl).href,
      );
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('prefers requested API symbol hashes over stale saved scroll on fresh clicks', async () => {
    history.replaceState({}, '', new URL('/api#symbols%2Fproperty%20value', initialUrl).href);
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>API</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-docs" href="/docs">Docs</a>',
      '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
      '<article><h2 id="symbols/property value">property value</h2></article>',
      '</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestInputHref(input), location.href);
      const isApi = url.pathname === '/api';
      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            `<title>${isApi ? 'API' : 'Docs'}</title>`,
            '</head><body>',
            '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
            '<a id="to-docs" href="/docs">Docs</a>',
            isApi
              ? [
                  '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
                  '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
                  '<nav class="api-nav"><a href="#symbols%2Fproperty%20value">property value</a></nav>',
                  '<article><h2 id="symbols/property value">property value</h2></article>',
                  '</section>',
                ].join('')
              : [
                  '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
                  '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
                ].join(''),
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: url.href,
      };
    });
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      installNavigationLoader();
      vi.stubGlobal('scrollX', 56);
      vi.stubGlobal('scrollY', 78);
      dispatchAnchorLikeClick('/docs');
      await vi.waitFor(() => expect(document.title).toBe('Docs'));

      vi.stubGlobal('scrollX', 12);
      vi.stubGlobal('scrollY', 34);
      dispatchAnchorLikeClick('/api#symbols%2Fproperty%20value');
      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(location.href).toBe(new URL('/api#symbols%2Fproperty%20value', initialUrl).href);
      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'symbols/property value')).toBe(true);
      expect(scrollTo).not.toHaveBeenCalledWith(56, 78);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('does not reuse restored hash scroll when a fresh click targets a different symbol', async () => {
    history.replaceState({}, '', new URL('/api#symbols%2Fold', initialUrl).href);
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>API old</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-docs" href="/docs">Docs</a>',
      '<section kovo-nav-segment="page:/api-old" kovo-nav-kind="page" kovo-nav-name="page">',
      '<h2 id="symbols/old">Old symbol</h2>',
      '</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestInputHref(input), location.href);
      const isApi = url.pathname === '/api';
      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          const apiPage = url.hash === '#symbols%2Fnew' ? 'new' : 'old';
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            `<title>${isApi ? `API ${apiPage}` : 'Docs'}</title>`,
            '</head><body>',
            '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
            '<a id="to-docs" href="/docs">Docs</a>',
            '<a id="to-new-symbol" href="/api#symbols%2Fnew">New symbol</a>',
            isApi
              ? [
                  `<section kovo-nav-segment="page:/api-${apiPage}" kovo-nav-kind="page" kovo-nav-name="page">`,
                  `<h2 id="symbols/${apiPage}">${apiPage} symbol</h2>`,
                  '</section>',
                ].join('')
              : '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: url.href,
      };
    });
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      installNavigationLoader();
      vi.stubGlobal('scrollX', 11);
      vi.stubGlobal('scrollY', 222);
      dispatchAnchorLikeClick('/docs');
      await vi.waitFor(() => expect(document.title).toBe('Docs'));

      vi.stubGlobal('scrollX', 33);
      vi.stubGlobal('scrollY', 444);
      history.replaceState({}, '', new URL('/api#symbols%2Fold', initialUrl).href);
      dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(document.title).toBe('API old'));
      expect(scrollTo).toHaveBeenCalledWith(11, 222);

      document.title = 'Docs';
      history.replaceState({}, '', new URL('/docs', initialUrl).href);
      dispatchAnchorLikeClick('/api#symbols%2Fnew');
      await vi.waitFor(() => expect(document.title).toBe('API new'));

      expect(location.href).toBe(new URL('/api#symbols%2Fnew', initialUrl).href);
      expect(scrolledIds.at(-1)).toBe('symbols/new');
      expect(scrolledIds).not.toContain('symbols/old');
      expect(scrollTo).not.toHaveBeenCalledWith(33, 444);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('offsets target-document hash scrolling below sticky document chrome', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-symbol" href="/api#symbols%2Fsticky">Symbol</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body>',
          '<header id="fixed-docs-header">Docs</header>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="symbols/sticky">Sticky target</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api#symbols%2Fsticky', location.href).href,
    }));
    const originalGetComputedStyle = globalThis.getComputedStyle;
    const originalGetBoundingClientRect = currentElementGetBoundingClientRect();
    const originalScrollIntoView = currentElementScrollIntoView();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if ((this as Element).id === 'fixed-docs-header') {
        return {
          bottom: 72,
          height: 72,
          left: 0,
          right: 800,
          toJSON: () => ({}),
          top: 0,
          width: 800,
          x: 0,
          y: 0,
        };
      }
      if ((this as Element).id === 'symbols/sticky') {
        return {
          bottom: 250,
          height: 30,
          left: 0,
          right: 400,
          toJSON: () => ({}),
          top: 220,
          width: 400,
          x: 0,
          y: 220,
        };
      }
      return originalGetBoundingClientRect.call(this);
    };
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      if (element.id === 'fixed-docs-header') {
        return { position: 'sticky', top: '0px' } as CSSStyleDeclaration;
      }
      return { position: 'static', top: 'auto' } as CSSStyleDeclaration;
    });
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api#symbols%2Fsticky');

      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(scrollTo).toHaveBeenCalledWith(0, 148);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      Element.prototype.scrollIntoView = originalScrollIntoView;
      vi.stubGlobal('getComputedStyle', originalGetComputedStyle);
    }
  });

  it('retries target-document hash scrolling after post-morph layout shifts', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-symbol" href="/api#symbols%2Fshifted">Symbol</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body>',
          '<header id="fixed-docs-header">Docs</header>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="symbols/shifted">Shifted target</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api#symbols%2Fshifted', location.href).href,
    }));
    const originalGetComputedStyle = globalThis.getComputedStyle;
    const originalGetBoundingClientRect = currentElementGetBoundingClientRect();
    let targetReads = 0;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if ((this as Element).id === 'fixed-docs-header') {
        return {
          bottom: 72,
          height: 72,
          left: 0,
          right: 800,
          toJSON: () => ({}),
          top: 0,
          width: 800,
          x: 0,
          y: 0,
        };
      }
      if ((this as Element).id === 'symbols/shifted') {
        targetReads += 1;
        const top = targetReads === 1 ? 5000 : 220;
        return {
          bottom: top + 30,
          height: 30,
          left: 0,
          right: 400,
          toJSON: () => ({}),
          top,
          width: 400,
          x: 0,
          y: top,
        };
      }
      return originalGetBoundingClientRect.call(this);
    };
    vi.stubGlobal('getComputedStyle', (element: Element) => {
      if (element.id === 'fixed-docs-header') {
        return { position: 'sticky', top: '0px' } as CSSStyleDeclaration;
      }
      return { position: 'static', top: 'auto' } as CSSStyleDeclaration;
    });
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api#symbols%2Fshifted');

      await vi.waitFor(() => expect(document.title).toBe('API'));
      await vi.waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 148));

      expect(scrollTo).toHaveBeenCalledWith(0, 4928);
      expect(targetReads).toBeGreaterThanOrEqual(2);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      vi.stubGlobal('getComputedStyle', originalGetComputedStyle);
    }
  });

  it('scrolls to encoded-id and named hash anchors from target documents', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledTargets: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestInputHref(input), location.href);
      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          const target =
            url.hash === '#symbols%252Fencoded'
              ? '<h2 id="symbols%2Fencoded">Encoded symbol</h2>'
              : '<a name="legacy-symbol"></a><h2>Legacy symbol</h2>';
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            '<title>API</title>',
            '</head><body>',
            '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
            '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
            target,
            '</section>',
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: url.href,
      };
    });
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledTargets.push((this as Element).id || (this as Element).getAttribute('name') || '');
    };
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api#symbols%252Fencoded');
      await vi.waitFor(() => expect(document.title).toBe('API'));
      expect(scrolledTargets.length).toBeGreaterThanOrEqual(1);
      expect(scrolledTargets.every((target) => target === 'symbols%2Fencoded')).toBe(true);

      document.title = 'Docs';
      dispatchAnchorLikeClick('/api#legacy-symbol');
      await vi.waitFor(() => expect(scrolledTargets.at(-1)).toBe('legacy-symbol'));
      expect(scrolledTargets).toContain('symbols%2Fencoded');
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('uses the newest target hash when concurrent enhanced navigations resolve out of order', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    let resolveSlowText: ((html: string) => void) | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestInputHref(input), location.href);
      if (url.hash === '#slow') {
        return {
          headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
          text: () =>
            new Promise<string>((resolve) => {
              resolveSlowText = resolve;
            }),
          url: url.href,
        };
      }
      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            '<title>Fast</title>',
            '</head><body>',
            '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
            '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
            '<h2 id="fast">Fast</h2>',
            '</section>',
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: url.href,
      };
    });
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      dispatchAnchorLikeClick('/api#slow');
      dispatchAnchorLikeClick('/api#fast');
      await vi.waitFor(() => expect(document.title).toBe('Fast'));

      resolveSlowText?.(
        [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Slow</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="slow">Slow</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join(''),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.title).toBe('Fast');
      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'fast')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('restores hash and scroll state through browser popstate after morphing', async () => {
    history.replaceState({}, '', new URL('/docs', initialUrl).href);
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledTargets: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(requestInputHref(input), location.href);
      const isApi = url.pathname === '/api';
      return {
        headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
        async text() {
          return [
            '<!doctype html><html><head>',
            '<meta name="kovo-build" content="build-a">',
            `<title>${isApi ? 'API' : 'Docs'}</title>`,
            '</head><body>',
            '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
            '<a id="to-symbol" href="/api#symbols%2Fproperty%20value">Symbol</a>',
            isApi
              ? [
                  '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
                  '<nav class="api-nav" aria-label="Symbols on this page">',
                  '<a href="#symbols%2Fproperty%20value">property value</a>',
                  '</nav>',
                  '<article><h2 id="symbols/property value">property value</h2></article>',
                  '</section>',
                ].join('')
              : '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs again</section>',
            '</main>',
            '</body></html>',
          ].join('');
        },
        url: url.href,
      };
    });
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledTargets.push((this as Element).id || (this as Element).getAttribute('name') || '');
    };
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      installNavigationLoader();
      vi.stubGlobal('scrollX', 12);
      vi.stubGlobal('scrollY', 34);
      dispatchAnchorLikeClick('/api#symbols%2Fproperty%20value');
      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(scrolledTargets.length).toBeGreaterThanOrEqual(1);
      expect(scrolledTargets.every((target) => target === 'symbols/property value')).toBe(true);
      expect(location.href).toBe(new URL('/api#symbols%2Fproperty%20value', initialUrl).href);

      vi.stubGlobal('scrollX', 56);
      vi.stubGlobal('scrollY', 78);
      history.replaceState({}, '', new URL('/docs', initialUrl).href);
      dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(document.title).toBe('Docs'));

      expect(scrollTo).toHaveBeenCalledWith(12, 34);

      history.replaceState({}, '', new URL('/api#symbols%2Fproperty%20value', initialUrl).href);
      dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(location.href).toBe(new URL('/api#symbols%2Fproperty%20value', initialUrl).href);
      expect(scrollTo).toHaveBeenCalledWith(56, 78);
      expect(scrolledTargets.length).toBeGreaterThanOrEqual(1);
      expect(scrolledTargets.every((target) => target === 'symbols/property value')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('scrolls requested hashes on popstate when no saved scroll exists', async () => {
    history.replaceState({}, '', new URL('/docs', initialUrl).href);
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Docs</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<section kovo-nav-segment="page:/docs" kovo-nav-kind="page" kovo-nav-name="page">Docs</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="symbols/fresh-popstate">Fresh popstate target</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api', location.href).href,
    }));
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    try {
      installNavigationLoader();
      history.replaceState({}, '', new URL('/api#symbols%2Ffresh-popstate', initialUrl).href);
      dispatchEvent(new PopStateEvent('popstate'));

      await vi.waitFor(() => expect(document.title).toBe('API'));

      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'symbols/fresh-popstate')).toBe(true);
      expect(scrollTo).not.toHaveBeenCalledWith(0, 0);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('leaves same-document hash anchors to native browser navigation', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>API</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<nav class="api-nav"><a href="#same-document-symbol">Symbol</a></nav>',
      '<section kovo-nav-segment="page:/api" kovo-nav-kind="page" kovo-nav-name="page">',
      '<h2 id="same-document-symbol">Symbol</h2>',
      '</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn();
    const scrollTo = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', scrollTo);

    installNavigationLoader();
    const click = dispatchAnchorLikeClick(new URL('#same-document-symbol', location.href).href);

    expect(click.defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('enhances same-path hash navigations when the query string changes', async () => {
    history.replaceState({}, '', new URL('/api?view=summary', initialUrl).href);
    document.head.innerHTML =
      '<meta name="kovo-build" content="build-a"><title>API summary</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
      '<a id="to-details" href="/api?view=details#symbols%2Fdetails">Details</a>',
      '<section kovo-nav-segment="page:/api-summary" kovo-nav-kind="page" kovo-nav-name="page">',
      '<h2 id="symbols/summary">Summary</h2>',
      '</section>',
      '</main>',
    ].join('');
    const scrolledIds: string[] = [];
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>API details</title>',
          '</head><body>',
          '<main kovo-nav-segment="layout:Docs" kovo-nav-kind="layout" kovo-nav-name="Docs">',
          '<a id="to-summary" href="/api?view=summary#symbols%2Fsummary">Summary</a>',
          '<section kovo-nav-segment="page:/api-details" kovo-nav-kind="page" kovo-nav-name="page">',
          '<h2 id="symbols/details">Details</h2>',
          '</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/api?view=details', location.href).href,
    }));
    const originalScrollIntoView = currentElementScrollIntoView();
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledIds.push((this as Element).id);
    };
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    try {
      installNavigationLoader();
      const click = dispatchAnchorLikeClick('/api?view=details#symbols%2Fdetails');

      await vi.waitFor(() => expect(document.title).toBe('API details'));

      expect(click.defaultPrevented).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(scrolledIds.length).toBeGreaterThanOrEqual(1);
      expect(scrolledIds.every((id) => id === 'symbols/details')).toBe(true);
      expect(pushState).toHaveBeenCalledWith(
        {},
        '',
        new URL('/api?view=details#symbols%2Fdetails', initialUrl).href,
      );
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('keeps document.body available after full-body layout replacement', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a"><title>Admin</title>';
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Admin" kovo-nav-kind="layout" kovo-nav-name="Admin">',
      '<section kovo-nav-segment="page:/admin" kovo-nav-kind="page" kovo-nav-name="page">Admin</section>',
      '</main>',
    ].join('');
    const fetch = vi.fn(async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      async text() {
        return [
          '<!doctype html><html><head>',
          '<meta name="kovo-build" content="build-a">',
          '<title>Login</title>',
          '</head><body data-route="login">',
          '<main kovo-nav-segment="layout:Auth" kovo-nav-kind="layout" kovo-nav-name="Auth">',
          '<section kovo-nav-segment="page:/login" kovo-nav-kind="page" kovo-nav-name="page">Login</section>',
          '</main>',
          '</body></html>',
        ].join('');
      },
      url: new URL('/login', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('scrollTo', vi.fn());
    vi.spyOn(history, 'pushState').mockImplementation(() => undefined);

    installNavigationLoader();
    dispatchAnchorLikeClick('/login');

    await vi.waitFor(() => expect(document.title).toBe('Login'));

    expect(document.body).not.toBeNull();
    expect(document.body.getAttribute('data-route')).toBe('login');
    expect(document.querySelector('[kovo-nav-segment="page:/login"]')?.textContent).toBe('Login');
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

    document
      .querySelector('form')
      ?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(document.querySelector('[kovo-fragment-target="cart-badge"]')?.textContent).toBe(
        'Updated cart',
      ),
    );

    const mutationRequest = fetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )?.[1] as RequestInit | undefined;
    expect(mutationRequest).toBeDefined();
    const mutationHeaders = mutationRequest!.headers as Record<string, string>;
    expect(mutationHeaders['Kovo-Form-Target']).toBe('cart-form');
    expect(mutationHeaders['Kovo-Targets']).toContain('cart-badge=cart');
    expect(mutationHeaders['Kovo-Targets']).toContain('layout-shell=viewer');
    expect(mutationHeaders['Kovo-Targets']).not.toContain('old-target');
    expect(mutationHeaders['Kovo-Live-Targets']).toContain('cart-badge#cart-badge/cart-badge:{}');
    expect(mutationHeaders['Kovo-Live-Targets']).toContain(
      'layout-shell#layout-shell/layout-shell:{}',
    );
  });
});

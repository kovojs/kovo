import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

const testBroadcastChannels: BroadcastChannel[] = [];
const testWindowListeners: Array<{
  listener: EventListenerOrEventListenerObject;
  options: AddEventListenerOptions | boolean | undefined;
  type: string;
}> = [];
const nativeBroadcastChannelClose = BroadcastChannel.prototype.close;
const nativeEventTargetAddEventListener = EventTarget.prototype.addEventListener;
const nativeEventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;
const nativeWindowAddEventListener = globalThis.addEventListener;
const NativeBroadcastChannel = BroadcastChannel;
const initialInlineApplyDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__kovo_a');
const initialScrollRestoration = history.scrollRestoration;

// SPEC §10.3: browser mutation fixtures model server-rendered forms, including
// the current stamped token whose timestamp is retained when enhancement mints
// a fresh nonce.
function serverStampedMutationIdemInput(): string {
  const token = `v1_${Date.now()}_0123456789abcdef0123456789abcdef`;
  return `<input type="hidden" name="Kovo-Idem" value="${token}">`;
}

afterEach(() => {
  for (const entry of testWindowListeners.splice(0)) {
    nativeEventTargetRemoveEventListener.call(
      globalThis,
      entry.type,
      entry.listener,
      entry.options,
    );
  }
  for (const channel of testBroadcastChannels.splice(0)) {
    channel.onmessage = null;
    nativeBroadcastChannelClose.call(channel);
  }
  if (initialInlineApplyDescriptor) {
    Object.defineProperty(globalThis, '__kovo_a', initialInlineApplyDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, '__kovo_a');
  }
  history.scrollRestoration = initialScrollRestoration;
  document.head.replaceChildren();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('browser inline loader response apply', () => {
  it('morphs enhanced mutation fragments through the installed inline loader', async () => {
    const style = document.createElement('style');
    style.textContent = [
      '.scroll-panel { height: 20px; overflow: auto }',
      '.scroll-panel-fill { height: 80px }',
    ].join('\n');
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance data-mutation="cart/add" action="/_m/cart/add" method="post">',
      serverStampedMutationIdemInput(),
      '<section kovo-c="cart-form">',
      '<label kovo-key="label">Quantity</label>',
      '<div kovo-key="panel" class="scroll-panel"><p class="scroll-panel-fill">Panel</p></div>',
      '<textarea kovo-key="quantity" name="quantity">12345</textarea>',
      '</section>',
      '</form>',
    ].join('');
    document.body.append(style, root);

    const form = root.querySelector('form');
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[kovo-key="panel"]');

    if (!form || !textarea || !panel) throw new Error('missing inline morph fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const fetch = vi.fn(async () => ({
      headers: new Headers({ 'Content-Type': 'text/vnd.kovo.fragment+html' }),
      async text() {
        textarea.focus();
        textarea.setSelectionRange(1, 3, 'forward');
        return [
          '<kovo-fragment target="cart-form">',
          '<section kovo-c="cart-form">',
          '<textarea kovo-key="quantity" name="quantity">67890</textarea>',
          '<div kovo-key="panel" class="scroll-panel"><p class="scroll-panel-fill">Updated panel</p></div>',
          '<label kovo-key="label">Updated quantity</label>',
          '</section>',
          '</kovo-fragment>',
        ].join('');
      },
      url: new URL('/_m/cart/add', location.href).href,
    }));
    vi.stubGlobal('fetch', fetch);

    installTestInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-key="label"]')?.textContent).toBe('Updated quantity'),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector('[kovo-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBeCloseTo(4, 0);
  });

  it('applies fragments to explicit fragment targets before conflicting component stamps', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance data-mutation="cart/add" action="/_m/cart/add" method="post">',
      serverStampedMutationIdemInput(),
      '<section kovo-fragment-target="cart" kovo-deps="cart">old cart</section>',
      '<aside kovo-c="cart">wrong target</aside>',
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    if (!form) throw new Error('missing inline conflict fixture');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        headers: new Headers({ 'Content-Type': 'text/vnd.kovo.fragment+html' }),
        async text() {
          return [
            '<kovo-fragment target="cart">',
            '<section kovo-fragment-target="cart" kovo-deps="cart">fresh cart</section>',
            '</kovo-fragment>',
          ].join('');
        },
        url: new URL('/_m/cart/add', location.href).href,
      })),
    );

    installTestInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-fragment-target="cart"]')?.textContent).toBe('fresh cart'),
    );
    expect(root.querySelector('[kovo-c="cart"]')?.textContent).toBe('wrong target');
  });

  it('applies selector-invalid id and fragment-target values through escaped lookup', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance data-mutation="cart/add" action="/_m/cart/add" method="post">',
      serverStampedMutationIdemInput(),
      "<section id='target\"bad-id'>old id</section>",
      "<section kovo-fragment-target='target\"bad-fragment'>old fragment target</section>",
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    if (!form) throw new Error('missing inline selector fixture');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        headers: new Headers({ 'Content-Type': 'text/vnd.kovo.fragment+html' }),
        async text() {
          return [
            "<kovo-fragment target='target\"bad-id'>",
            "<section id='target\"bad-id'>fresh id</section>",
            '</kovo-fragment>',
            "<kovo-fragment target='target\"bad-fragment'>",
            "<section kovo-fragment-target='target\"bad-fragment'>fresh fragment target</section>",
            '</kovo-fragment>',
          ].join('');
        },
        url: new URL('/_m/cart/add', location.href).href,
      })),
    );

    installTestInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const sections = [...root.querySelectorAll('section')];
      expect(
        sections.find((section) => section.getAttribute('id') === 'target"bad-id')?.textContent,
      ).toBe('fresh id');
      expect(
        sections.find(
          (section) => section.getAttribute('kovo-fragment-target') === 'target"bad-fragment',
        )?.textContent,
      ).toBe('fresh fragment target');
    });
  });

  it('sanitizes unsafe fragment replacement and append attributes through the installed loader', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-fragment-target="promo">old promo</section>',
      '<ul kovo-fragment-target="feed"><li kovo-key="old">old</li></ul>',
    ].join('');
    document.body.append(root);

    installTestInlineKovoLoader(async () => ({}));
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="promo">',
        '<article kovo-fragment-target="promo"',
        ' onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))" style="background:url(javascript:alert(1))">',
        '<a href="java\tscript:alert(1)"',
        ' srcdoc="<script>bad()</script>"',
        ' srcset="/safe.png 1x, javascript:alert(1) 2x">promo</a>',
        '</article>',
        '</kovo-fragment>',
        '<kovo-fragment target="feed" mode="append">',
        '<li kovo-key="new"><a href="javascript:alert(1)" onclick="bad()" innerHTML="<img src=x onerror=alert(1))"',
        ' srcdoc="<script>bad()</script>"',
        ' srcset="/safe.png 1x, javascript:alert(1) 2x"',
        ' style="background:url(javascript:alert(1))">new</a></li>',
        '</kovo-fragment>',
      ].join(''),
    );

    const promo = root.querySelector('article[kovo-fragment-target="promo"]');
    const promoLink = promo?.querySelector('a');
    const feedLink = root.querySelector('[kovo-key="new"] a');

    expect(promo?.getAttribute('onclick')).toBeNull();
    expect(promo?.getAttribute('innerHTML')).toBeNull();
    expect(promo?.getAttribute('style')).toBeNull();
    expect(promoLink?.getAttribute('href')).toBe('#');
    expect(promoLink?.getAttribute('srcdoc')).toBeNull();
    expect(promoLink?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(feedLink?.getAttribute('href')).toBe('#');
    expect(feedLink?.getAttribute('innerHTML')).toBeNull();
    expect(feedLink?.getAttribute('onclick')).toBeNull();
    expect(feedLink?.getAttribute('srcdoc')).toBeNull();
    expect(feedLink?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(feedLink?.getAttribute('style')).toBeNull();
  });

  it('preserves reviewed finite browser controls through generated inline keyed morphs', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-fragment-target="controls" kovo-key="controls">',
      '<a kovo-key="anchor" target="_blank" rel="noopener"',
      ' referrerpolicy="strict-origin" ping="/forbidden">reviewed</a>',
      '<script kovo-key="script" type="application/json" integrity="sha384-reviewed"',
      ' nonce="forbidden" language="javascript"></script>',
      '<iframe kovo-key="frame" src="/reviewed" sandbox="allow-scripts"></iframe>',
      '<svg kovo-key="svg"><feImage kovo-key="feimage" href="/reviewed.svg"',
      ' crossorigin="anonymous"></feImage></svg>',
      '<style kovo-key="style" type="text/plain" media="not all">',
      '#kovo-reviewed-style-probe { display: none !important }</style>',
      '<geolocation kovo-key="geolocation"></geolocation>',
      '<meta kovo-key="meta" name="description" content="reviewed">',
      '</section>',
    ].join('');
    document.body.append(root);

    installTestInlineKovoLoader(async () => ({}));
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="controls">',
        '<section kovo-fragment-target="controls" kovo-key="controls">',
        '<a kovo-key="anchor" target="attacker-window" rel="opener"',
        ' referrerpolicy="unsafe-url" ping="/collect">attacker</a>',
        '<script kovo-key="script" type="module" integrity=""',
        ' nonce="attacker" language="vbscript"></script>',
        '<iframe kovo-key="frame" src="/attacker"',
        ' sandbox="allow-scripts allow-same-origin"></iframe>',
        '<svg kovo-key="svg"><feImage kovo-key="feimage" href="/attacker.svg"',
        ' crossorigin="use-credentials"></feImage></svg>',
        '<style kovo-key="style" type="text/css" media="all">',
        '#kovo-reviewed-style-probe { display: none !important }</style>',
        '<geolocation kovo-key="geolocation" autolocate watch',
        ' accuracymode="precise"></geolocation>',
        '<meta kovo-key="meta" name="referrer" content="unsafe-url">',
        '</section>',
        '</kovo-fragment>',
      ].join(''),
    );

    const anchor = root.querySelector('[kovo-key="anchor"]');
    const script = root.querySelector('[kovo-key="script"]');
    const frame = root.querySelector('[kovo-key="frame"]');
    const feImage = root.querySelector('[kovo-key="feimage"]');
    const style = root.querySelector('[kovo-key="style"]');
    const geolocation = root.querySelector('[kovo-key="geolocation"]');
    const meta = root.querySelector('[kovo-key="meta"]');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener');
    expect(anchor?.getAttribute('referrerpolicy')).toBe('strict-origin');
    expect(anchor?.getAttribute('ping')).toBeNull();
    expect(script?.getAttribute('type')).toBe('application/json');
    expect(script?.getAttribute('integrity')).toBe('sha384-reviewed');
    expect(script?.getAttribute('nonce')).toBeNull();
    expect(script?.getAttribute('language')).toBeNull();
    expect(frame?.getAttribute('src')).toBe('/reviewed');
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(feImage?.getAttribute('crossorigin')).toBe('anonymous');
    expect(style?.getAttribute('type')).toBe('text/plain');
    expect(style?.getAttribute('media')).toBe('not all');
    expect(geolocation?.hasAttribute('autolocate')).toBe(false);
    expect(geolocation?.hasAttribute('watch')).toBe(false);
    expect(geolocation?.hasAttribute('accuracymode')).toBe(false);
    expect(meta?.getAttribute('name')).toBe('description');
    expect(meta?.getAttribute('content')).toBeNull();
  });

  it('pins CustomEvent construction for the inline server-query handoff', () => {
    const NativeCustomEvent = CustomEvent;
    let received: CustomEvent | undefined;
    const listener = (event: Event) => {
      received = event as CustomEvent;
    };
    window.addEventListener('kovo:query', listener);
    installTestInlineKovoLoader(async () => ({}));
    vi.stubGlobal(
      'CustomEvent',
      class PoisonedCustomEvent extends NativeCustomEvent {
        constructor(type: string, init?: CustomEventInit) {
          super(type, {
            ...init,
            detail: {
              queries: [{ attrs: ' name="account"', content: '{"role":"attacker"}' }],
            },
          });
        }
      },
    );

    try {
      (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
        '<kovo-query name="account">{"role":"server"}</kovo-query>',
      );
    } finally {
      window.removeEventListener('kovo:query', listener);
    }

    const detail = received?.detail as
      | { qs?: Array<{ attrs?: unknown; content?: unknown }> }
      | undefined;
    expect(detail?.qs?.[0]?.attrs).toBe(' name="account"');
    expect(detail?.qs?.[0]?.content).toBe('{"role":"server"}');
  });

  it('removes same-component keyed islands by exact identity', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<ul kovo-fragment-target="cart-list">',
      '<li kovo-c="cart-row" kovo-key="row-1" on:click="/c/cart-row.js#mount" data-kovo-module-allowlist="/c/cart-row.js">one</li>',
      '<li kovo-c="cart-row" kovo-key="row-2" on:click="/c/cart-row.js#mount" data-kovo-module-allowlist="/c/cart-row.js">two</li>',
      '</ul>',
    ].join('');
    document.body.append(root);

    installTestInlineKovoLoader(async () => ({}));

    // SPEC.md §4.4/§13.2/§14.1: a removed island is identified by kovo-c plus
    // kovo-key/id, not by a component-name substring in replacement HTML.
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="cart-list">',
        '<ul kovo-fragment-target="cart-list">',
        '<li kovo-c="cart-row" kovo-key="row-2" on:click="/c/cart-row.js#mount">two fresh</li>',
        '</ul>',
        '</kovo-fragment>',
      ].join(''),
    );

    expect(root.querySelector('[kovo-key="row-1"]')).toBeNull();
    expect(root.querySelector('[kovo-key="row-2"]')?.textContent).toBe('two fresh');
  });

  it('replays same-principal mutation broadcasts through the inline loader', async () => {
    const sender = new BroadcastChannel('kovo:mutation-response');
    testBroadcastChannels.push(sender);
    document.head.innerHTML = [
      '<meta name="kovo-session" content="session-a">',
      '<meta name="kovo-build" content="build-a">',
    ].join('');
    const root = document.createElement('main');
    root.innerHTML = '<section kovo-fragment-target="cart">old cart</section>';
    document.body.append(root);

    installTestInlineKovoLoader(async () => ({}));
    sender.postMessage({
      body: '<kovo-fragment target="cart"><section kovo-fragment-target="cart">wrong session</section></kovo-fragment>',
      changes: [],
      principal: 'session-b',
      type: 'kovo:mutation-response',
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(root.querySelector('[kovo-fragment-target="cart"]')?.textContent).toBe('old cart');

    sender.postMessage({
      body: '<kovo-fragment target="cart"><section kovo-fragment-target="cart">fresh cart</section></kovo-fragment>',
      buildToken: 'build-a',
      changes: [],
      principal: 'session-a',
      type: 'kovo:mutation-response',
    });

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-fragment-target="cart"]')?.textContent).toBe('fresh cart'),
    );
  });

  it('publishes successful inline enhanced mutation responses to BroadcastChannel', async () => {
    const receiver = new BroadcastChannel('kovo:mutation-response');
    testBroadcastChannels.push(receiver);
    const published = new Promise<unknown>((resolve) => {
      receiver.onmessage = (event) => {
        const data = event.data as { principal?: unknown };
        if (data?.principal === 'session-a') resolve(data);
      };
    });
    document.head.innerHTML = [
      '<meta name="kovo-session" content="session-a">',
      '<meta name="kovo-build" content="build-a">',
    ].join('');
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance data-mutation="cart/add" action="/_m/cart/add" method="post">',
      serverStampedMutationIdemInput(),
      '<section kovo-fragment-target="cart">old cart</section>',
      '</form>',
    ].join('');
    document.body.append(root);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        headers: {
          get(name: string) {
            if (name.toLowerCase() === 'content-type') {
              return 'text/vnd.kovo.fragment+html';
            }
            if (name === 'Kovo-Build') return 'build-a';
            if (name === 'Kovo-Changes') return JSON.stringify([{ domain: 'cart' }]);
            return null;
          },
        },
        ok: true,
        status: 200,
        async text() {
          return '<kovo-fragment target="cart"><section kovo-fragment-target="cart">fresh cart</section></kovo-fragment>';
        },
        url: new URL('/_m/cart/add', location.href).href,
      })),
    );

    installTestInlineKovoLoader(async () => ({}));
    root
      .querySelector('form')
      ?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-fragment-target="cart"]')?.textContent).toBe('fresh cart'),
    );
    await expect(published).resolves.toEqual({
      body: '<kovo-fragment target="cart"><section kovo-fragment-target="cart">fresh cart</section></kovo-fragment>',
      buildToken: 'build-a',
      changes: [{ domain: 'cart' }],
      principal: 'session-a',
      type: 'kovo:mutation-response',
    });
  });

  it('refetches remembered kovo-query scripts when a tab becomes visible again', async () => {
    document.head.innerHTML = '<meta name="kovo-build" content="build-a">';
    document.body.innerHTML = [
      '<script type="application/json" kovo-query="cart" key="cart:c1">{"count":1}</script>',
      '<section kovo-fragment-target="cart">cart</section>',
    ].join('');
    const fetch = vi.fn(
      async () =>
        new Response('<kovo-query name="cart" key="cart:c1">{"count":2}</kovo-query>', {
          headers: {
            'Content-Type': 'text/vnd.kovo.fragment+html',
            'Kovo-Build': 'build-a',
          },
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetch);
    let appliedQueryEvents = 0;
    window.addEventListener(
      'kovo:query',
      () => {
        appliedQueryEvents += 1;
      },
      { once: true },
    );

    installTestInlineKovoLoader(async () => ({}));
    dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/_q/cart?key=c1', {
        cache: 'no-store',
        headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
        method: 'GET',
      }),
    );
    await vi.waitFor(() => expect(appliedQueryEvents).toBe(1));
    const rememberedQueryRefetches = fetch.mock.calls.filter(
      ([url, init]) =>
        url === '/_q/cart?key=c1' &&
        init &&
        typeof init === 'object' &&
        'method' in init &&
        init.method === 'GET',
    );
    expect(rememberedQueryRefetches).toHaveLength(1);
    expect(rememberedQueryRefetches[0]?.[1]).toEqual({
      cache: 'no-store',
      headers: { Accept: 'text/html', 'Kovo-Fragment': 'true' },
      method: 'GET',
    });
  });
});

function installTestInlineKovoLoader(
  importModule: (url: string) => Promise<Record<string, unknown>>,
): void {
  // SPEC §6.6/§14: keep hard reload and boot-pinned fetch behavior real. Isolate each test by
  // retiring the installer's durable host enrollment instead of stubbing fail-closed recovery.
  const addDescriptor = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener');
  const channelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  const globalAddDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
  if (
    !addDescriptor ||
    !('value' in addDescriptor) ||
    addDescriptor.value !== nativeEventTargetAddEventListener ||
    !channelDescriptor ||
    !('value' in channelDescriptor) ||
    channelDescriptor.value !== NativeBroadcastChannel ||
    globalThis.addEventListener !== nativeWindowAddEventListener
  ) {
    throw new Error('browser test could not isolate inline-loader host controls');
  }

  class TestBroadcastChannel extends NativeBroadcastChannel {
    constructor(name: string) {
      super(name);
      testBroadcastChannels.push(this);
    }
  }

  Object.defineProperty(EventTarget.prototype, 'addEventListener', {
    ...addDescriptor,
    value: function testAddEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions | boolean,
    ): void {
      if (this === (globalThis as unknown as EventTarget)) {
        testWindowListeners.push({ listener, options, type });
      }
      nativeEventTargetAddEventListener.call(this, type, listener, options);
    },
  });
  try {
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      enumerable: globalAddDescriptor?.enumerable ?? false,
      value: function testWindowAddEventListener(
        this: Window,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions | boolean,
      ): void {
        testWindowListeners.push({ listener, options, type });
        nativeWindowAddEventListener.call(this, type, listener, options);
      },
      writable: true,
    });
    try {
      Object.defineProperty(globalThis, 'BroadcastChannel', {
        ...channelDescriptor,
        value: TestBroadcastChannel,
      });
      try {
        const listenerStart = testWindowListeners.length;
        installInlineKovoLoader(importModule);
        const installedTypes = testWindowListeners.slice(listenerStart).map((entry) => entry.type);
        if (!installedTypes.includes('submit') || !installedTypes.includes('visibilitychange')) {
          throw new Error(
            'browser test did not capture inline-loader delegated and lifecycle state',
          );
        }
      } finally {
        Object.defineProperty(globalThis, 'BroadcastChannel', channelDescriptor);
      }
    } finally {
      if (globalAddDescriptor) {
        Object.defineProperty(globalThis, 'addEventListener', globalAddDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, 'addEventListener');
      }
    }
  } finally {
    Object.defineProperty(EventTarget.prototype, 'addEventListener', addDescriptor);
  }
}

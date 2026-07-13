import { afterEach, expect, it, vi } from 'vitest';

import { inlineKovoLoaderInstallerSource } from './inline-loader.js';

type FrameHarness = {
  frame: HTMLIFrameElement;
  loadCount(): number;
  window: Window & typeof globalThis;
};

const frames: HTMLIFrameElement[] = [];

async function createFrame(body: string, head: string): Promise<FrameHarness> {
  const frame = document.createElement('iframe');
  let loads = 0;
  frame.addEventListener('load', () => {
    loads += 1;
  });
  frame.srcdoc = `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
  frames.push(frame);
  document.body.append(frame);
  await vi.waitFor(() => expect(loads).toBe(1));
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('missing iframe window');
  return {
    frame,
    loadCount: () => loads,
    window: frameWindow as Window & typeof globalThis,
  };
}

async function installGeneratedInlineLoader(
  frameWindow: Window & typeof globalThis,
): Promise<void> {
  const globalRecord = frameWindow as unknown as Record<string, unknown>;
  globalRecord.__kovoBrowserTestImport = async () => ({});
  let scriptError: unknown;
  frameWindow.addEventListener('error', (event) => {
    scriptError = event.error ?? event.message;
  });
  const script = frameWindow.document.createElement('script');
  script.textContent = `(${inlineKovoLoaderInstallerSource})(globalThis.__kovoBrowserTestImport);`;
  frameWindow.document.head.append(script);
  await Promise.resolve();
  if (scriptError) throw scriptError;
}

function responseHeaders(build: string | undefined, contentType = 'text/html') {
  return {
    get(name: string) {
      if (name.toLowerCase() === 'kovo-build') return build ?? null;
      if (name.toLowerCase() === 'content-type') return contentType;
      return null;
    },
  };
}

function frameStream(
  frameWindow: Window & typeof globalThis,
  parts: readonly string[],
): ReadableStream<Uint8Array> {
  const Encoder = frameWindow.TextEncoder;
  const Stream = frameWindow.ReadableStream;
  return new Stream<Uint8Array>({
    start(controller) {
      const encoder = new Encoder();
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  vi.restoreAllMocks();
});

it('ignores a caller-owned Trusted Types policy cache before generated fragment apply', async () => {
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><span>OLD</span></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  globalRecord.__kovo_tt = {
    createHTML() {
      return '<img data-kovo-policy-cache-attack src="x">';
    },
  };

  await installGeneratedInlineLoader(harness.window);
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  apply(
    [
      '<kovo-fragment target="victim">',
      '<section kovo-fragment-target="victim"><strong data-kovo-policy-safe>SAFE</strong></section>',
      '</kovo-fragment>',
    ].join(''),
  );

  expect(harness.window.document.querySelector('[data-kovo-policy-cache-attack]')).toBeNull();
  expect(harness.window.document.querySelector('[data-kovo-policy-safe]')?.textContent).toBe(
    'SAFE',
  );
});

it('aborts retired live output when Array iteration is poisoned after generated install', async () => {
  // SPEC §6.6/§9.2: late app prototype changes cannot skip the decision that
  // retires an old live component before a replacement fragment is committed.
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><div kovo-c="old-live">OLD</div></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  await installGeneratedInlineLoader(harness.window);
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  const oldLive = harness.window.document.querySelector('[kovo-c="old-live"]');
  if (!oldLive) throw new Error('missing old live component');
  const controller = new harness.window.AbortController();
  (oldLive as Element & { a?: AbortController }).a = controller;
  const originalIterator = harness.window.Array.prototype[Symbol.iterator];

  try {
    harness.window.Array.prototype[Symbol.iterator] = function () {
      return { next: () => ({ done: true, value: undefined }) } as ArrayIterator<unknown>;
    };
    apply(
      '<kovo-fragment target="victim"><section kovo-fragment-target="victim"><p>NEW</p></section></kovo-fragment>',
    );
  } finally {
    harness.window.Array.prototype[Symbol.iterator] = originalIterator;
  }

  expect(controller.signal.aborted).toBe(true);
});

it('aborts retired live output when String.includes is poisoned after generated install', async () => {
  // SPEC §6.6/§9.2: a late String prototype poison cannot forge the fragment
  // identity comparison and preserve a live producer whose output was removed.
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><div kovo-c="old-live">OLD</div></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  await installGeneratedInlineLoader(harness.window);
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  const oldLive = harness.window.document.querySelector('[kovo-c="old-live"]');
  if (!oldLive) throw new Error('missing old live component');
  const controller = new harness.window.AbortController();
  (oldLive as Element & { a?: AbortController }).a = controller;
  const originalIncludes = harness.window.String.prototype.includes;

  try {
    harness.window.String.prototype.includes = () => true;
    apply(
      '<kovo-fragment target="victim"><section kovo-fragment-target="victim"><p>NEW</p></section></kovo-fragment>',
    );
  } finally {
    harness.window.String.prototype.includes = originalIncludes;
  }

  expect(controller.signal.aborted).toBe(true);
});

it('fails closed when the Trusted Types factory was replaced before generated install', async () => {
  const harness = await createFrame(
    '<section kovo-fragment-target="victim"><span>OLD</span></section>',
    '<meta name="kovo-build" content="build-a">',
  );
  const factory = harness.window.trustedTypes;
  const factoryPrototype = Object.getPrototypeOf(factory) as object;
  const createPolicyDescriptor = Object.getOwnPropertyDescriptor(factoryPrototype, 'createPolicy');
  if (
    !createPolicyDescriptor ||
    !('value' in createPolicyDescriptor) ||
    typeof createPolicyDescriptor.value !== 'function'
  ) {
    throw new Error('Trusted Types factory control unavailable');
  }
  Object.defineProperty(factoryPrototype, 'createPolicy', {
    ...createPolicyDescriptor,
    value() {
      return {
        createHTML() {
          return '<img data-kovo-import-order-policy-attack src="x">';
        },
      };
    },
  });
  try {
    await installGeneratedInlineLoader(harness.window);
  } finally {
    Object.defineProperty(factoryPrototype, 'createPolicy', createPolicyDescriptor);
  }

  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const apply = globalRecord.__kovo_a;
  if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
  apply(
    [
      '<kovo-fragment target="victim">',
      '<section kovo-fragment-target="victim"><strong data-kovo-import-order-safe>SAFE</strong></section>',
      '</kovo-fragment>',
    ].join(''),
  );

  expect(
    harness.window.document.querySelector('[data-kovo-import-order-policy-attack]'),
  ).toBeNull();
  expect(harness.window.document.querySelector('[data-kovo-import-order-safe]')?.textContent).toBe(
    'SAFE',
  );
});

it.each(['before', 'after'] as const)(
  'keeps generated fragment bytes exact when TrustedHTML stringification changes %s install',
  async (timing) => {
    const harness = await createFrame(
      '<section kovo-fragment-target="victim"><span>OLD</span></section>',
      '<meta name="kovo-build" content="build-a">',
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      harness.window.TrustedHTML.prototype,
      'toString',
    );
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('TrustedHTML stringifier control unavailable');
    }
    const poison = () => {
      Object.defineProperty(harness.window.TrustedHTML.prototype, 'toString', {
        ...descriptor,
        value() {
          return '<img data-c227-generated-attack src="x">';
        },
      });
    };
    if (timing === 'before') poison();
    try {
      await installGeneratedInlineLoader(harness.window);
      if (timing === 'after') poison();
      const apply = (harness.window as unknown as Record<string, unknown>).__kovo_a;
      if (typeof apply !== 'function') throw new Error('generated fragment apply is unavailable');
      apply(
        [
          '<kovo-fragment target="victim">',
          '<section kovo-fragment-target="victim"><strong data-c227-generated-safe>SAFE</strong></section>',
          '</kovo-fragment>',
        ].join(''),
      );
    } finally {
      Object.defineProperty(harness.window.TrustedHTML.prototype, 'toString', descriptor);
    }

    expect(harness.window.document.querySelector('[data-c227-generated-attack]')).toBeNull();
    expect(harness.window.document.querySelector('[data-c227-generated-safe]')?.textContent).toBe(
      'SAFE',
    );
  },
);

it('fails generated install closed when fetch was changed to an accessor before boot', async () => {
  const harness = await createFrame('<main>SERVER-SAFE</main>', '');
  const descriptor = Object.getOwnPropertyDescriptor(harness.window, 'fetch');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('frame fetch control unavailable');
  }
  Object.defineProperty(harness.window, 'fetch', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: () => async () => new harness.window.Response('ATTACKER'),
  });
  try {
    await expect(installGeneratedInlineLoader(harness.window)).rejects.toThrow();
    expect((harness.window as unknown as Record<string, unknown>).__kovo_a).toBeUndefined();
  } finally {
    Object.defineProperty(harness.window, 'fetch', descriptor);
  }
});

it('keeps generated mutation on the response transport captured at boot', async () => {
  const harness = await createFrame(
    [
      '<main kovo-nav-segment="layout:a" kovo-nav-kind="layout" kovo-nav-name="a">',
      '<section kovo-fragment-target="account">INITIAL</section>',
      '<form enhance action="/_m/account" method="post"><button>save</button></form>',
      '</main>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const safeFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a'),
    ok: true,
    status: 200,
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">MUTATION SERVER SAFE</section></kovo-fragment>';
    },
  }));
  const attackFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a'),
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">ATTACKER</section></kovo-fragment>';
    },
  }));
  globalRecord.fetch = safeFetch;

  await installGeneratedInlineLoader(harness.window);
  globalRecord.fetch = attackFetch;
  harness.window.document
    .querySelector<HTMLFormElement>('form')
    ?.dispatchEvent(new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(
      harness.window.document.querySelector('[kovo-fragment-target="account"]')?.textContent,
    ).toBe('MUTATION SERVER SAFE'),
  );

  expect(safeFetch).toHaveBeenCalledTimes(1);
  expect(attackFetch).not.toHaveBeenCalled();
});

it('keeps generated query and live-target recovery on the captured response transport', async () => {
  const harness = await createFrame(
    [
      '<script type="application/json" kovo-query="cart">{"count":1}</script>',
      '<section kovo-fragment-target="account" kovo-deps="account" kovo-live-component="account" kovo-live-token="tok_account">INITIAL</section>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const globalRecord = harness.window as unknown as Record<string, unknown>;
  const safeFetch = vi.fn(async (input: string) => ({
    headers: responseHeaders('build-a'),
    status: 200,
    async text() {
      return String(input).includes('/_q/cart')
        ? '<kovo-query name="cart">{"count":2}</kovo-query>'
        : '<kovo-fragment target="account"><section kovo-fragment-target="account">LIVE SERVER SAFE</section></kovo-fragment>';
    },
  }));
  const attackFetch = vi.fn(async () => ({
    headers: responseHeaders('build-a'),
    status: 200,
    async text() {
      return '<kovo-fragment target="account"><section kovo-fragment-target="account">ATTACKER</section></kovo-fragment>';
    },
  }));
  globalRecord.fetch = safeFetch;

  await installGeneratedInlineLoader(harness.window);
  globalRecord.fetch = attackFetch;
  harness.window.dispatchEvent(new harness.window.Event('visibilitychange'));

  await vi.waitFor(() => expect(safeFetch).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      harness.window.document.querySelector('[kovo-fragment-target="account"]')?.textContent,
    ).toBe('LIVE SERVER SAFE'),
  );
  expect(attackFetch).not.toHaveBeenCalled();
});

it('retires the old channel and hard-navigates before applying a same-build new-session document', async () => {
  const harness = await createFrame(
    [
      '<main kovo-nav-segment="layout:a" kovo-nav-kind="layout" kovo-nav-name="a">',
      '<a id="switch" href="about:srcdoc?kovo-session=b">switch</a>',
      '<section kovo-fragment-target="account">A INITIAL</section>',
      '</main>',
    ].join(''),
    [
      '<meta name="kovo-build" content="build-a">',
      '<meta name="kovo-session" content="session-a">',
      '<title>A document</title>',
    ].join(''),
  );
  const oldDocument = harness.window.document;
  const oldAccount = oldDocument.querySelector('[kovo-fragment-target="account"]');
  const broadcastPrototype = harness.window.BroadcastChannel.prototype;
  const onMessageDescriptor = Object.getOwnPropertyDescriptor(broadcastPrototype, 'onmessage');
  if (!onMessageDescriptor?.get || !onMessageDescriptor.set) {
    throw new Error('BroadcastChannel.onmessage controls unavailable');
  }
  const nativeOnMessageGet = onMessageDescriptor.get;
  const nativeOnMessageSet = onMessageDescriptor.set;
  const closeDescriptor = Object.getOwnPropertyDescriptor(broadcastPrototype, 'close');
  if (
    !closeDescriptor ||
    !('value' in closeDescriptor) ||
    typeof closeDescriptor.value !== 'function'
  ) {
    throw new Error('BroadcastChannel.close control unavailable');
  }
  const nativeClose = closeDescriptor.value;
  const subscribedChannels: BroadcastChannel[] = [];
  const closedChannels = new WeakSet<BroadcastChannel>();
  Object.defineProperty(broadcastPrototype, 'onmessage', {
    ...onMessageDescriptor,
    set(this: BroadcastChannel, value: ((event: MessageEvent<unknown>) => void) | null) {
      if (typeof value === 'function' && !subscribedChannels.includes(this)) {
        subscribedChannels.push(this);
      }
      Reflect.apply(nativeOnMessageSet, this, [value]);
    },
  });
  Object.defineProperty(broadcastPrototype, 'close', {
    ...closeDescriptor,
    value(this: BroadcastChannel) {
      closedChannels.add(this);
      Reflect.apply(nativeClose, this, []);
    },
  });
  const targetUrl = 'about:srcdoc?kovo-session=b';
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
    headers: responseHeaders('build-a'),
    async text() {
      return [
        '<!doctype html><html><head>',
        '<meta name="kovo-build" content="build-a">',
        '<meta name="kovo-session" content="session-b">',
        '<title>B document</title>',
        '</head><body>',
        '<main kovo-nav-segment="layout:b" kovo-nav-kind="layout" kovo-nav-name="b">',
        '<section kovo-fragment-target="account">B SERVER TRUTH</section>',
        '</main>',
        '</body></html>',
      ].join('');
    },
    url: targetUrl,
  }));

  let runtimeChannel: BroadcastChannel | undefined;
  try {
    await installGeneratedInlineLoader(harness.window);
    await vi.waitFor(() => {
      const activeChannels = subscribedChannels.filter(
        (channel) => Reflect.apply(nativeOnMessageGet, channel, []) !== null,
      );
      expect(activeChannels).toHaveLength(1);
      runtimeChannel = activeChannels[0];
    });
    Object.defineProperty(broadcastPrototype, 'onmessage', onMessageDescriptor);
    if (!runtimeChannel) throw new Error('inline mutation BroadcastChannel unavailable');
    oldDocument
      .querySelector<HTMLAnchorElement>('#switch')
      ?.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(closedChannels.has(runtimeChannel!)).toBe(true));
    expect(Reflect.apply(nativeOnMessageGet, runtimeChannel, [])).toBeNull();
    expect(oldAccount?.textContent).toBe('A INITIAL');
    expect(oldDocument.querySelector('meta[name="kovo-session"]')?.getAttribute('content')).toBe(
      'session-a',
    );
  } finally {
    Object.defineProperty(broadcastPrototype, 'onmessage', onMessageDescriptor);
    Object.defineProperty(broadcastPrototype, 'close', closeDescriptor);
  }
});

it.each([
  ['missing-token', undefined],
  ['foreign-token', 'build-new'],
] as const)(
  'cancels a %s stream before getReader and hard-reloads with zero apply',
  async (_posture, responseBuild) => {
    const harness = await createFrame(
      [
        '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">OLD BUILD TRUTH</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-old">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    const cancel = vi.fn(async () => undefined);
    const body = new harness.window.ReadableStream<Uint8Array>({ cancel });
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body,
      headers: responseHeaders(responseBuild),
      ok: true,
      status: 200,
    }));

    await installGeneratedInlineLoader(harness.window);
    oldDocument
      .querySelector('form')
      ?.dispatchEvent(
        new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
      );

    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    expect(body.locked).toBe(false);
    expect(oldTarget?.textContent).toBe('OLD BUILD TRUTH');
    await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
  },
);

it.each([
  [
    'error/replace',
    '<kovo-fragment target="messages"><section kovo-fragment-target="messages">UNCONFIRMED</section></kovo-fragment>',
    '<kovo-done reason="error"></kovo-done>',
  ],
  [
    'aborted/append',
    '<kovo-fragment target="messages" mode="append"><article>UNCONFIRMED</article></kovo-fragment>',
    '<kovo-done reason="aborted"></kovo-done>',
  ],
  [
    'missing-done/prepend',
    '<kovo-fragment target="messages" mode="prepend"><article>UNCONFIRMED</article></kovo-fragment>',
    '',
  ],
] as const)(
  'hard-recovers a progressively applied %s stream',
  async (_name, fragment, terminator) => {
    const harness = await createFrame(
      [
        '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
        '<section kovo-fragment-target="messages">AUTHORITATIVE</section>',
      ].join(''),
      '<meta name="kovo-build" content="build-a">',
    );
    const oldDocument = harness.window.document;
    const oldTarget = oldDocument.querySelector('[kovo-fragment-target="messages"]');
    let nativeSubmitCalls = 0;
    const form = oldDocument.querySelector<HTMLFormElement>('form');
    if (!form) throw new Error('missing stream form');
    form.submit = () => {
      nativeSubmitCalls += 1;
    };
    (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
      body: frameStream(harness.window, [fragment, ...(terminator ? [terminator] : [])]),
      headers: responseHeaders('build-a'),
      ok: true,
      status: 200,
    }));

    await installGeneratedInlineLoader(harness.window);
    form.dispatchEvent(
      new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(oldTarget?.textContent).toContain('UNCONFIRMED'));
    await vi.waitFor(() => expect(harness.loadCount()).toBeGreaterThan(1));
    expect(nativeSubmitCalls).toBe(0);
  },
);

it('pins deferred-runtime native submit before a late prototype replacement', async () => {
  const harness = await createFrame(
    [
      '<iframe hidden name="kovo-c210-deferred-sink"></iframe>',
      '<form enhance action="/favicon.ico" method="get" target="kovo-c210-deferred-sink">',
      '<input name="kovo-c210" value="deferred-runtime">',
      '<button>send</button>',
      '</form>',
    ].join(''),
    '',
  );
  const form = harness.window.document.querySelector<HTMLFormElement>('form');
  const sink = harness.window.document.querySelector<HTMLIFrameElement>('iframe');
  if (!form || !sink) throw new Error('missing deferred submit fixture');
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => {
    throw new Error('mutation fetch failed');
  });
  const prototype = harness.window.HTMLFormElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'submit');
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new Error('native deferred form submit unavailable');
  }
  const poisonedSubmit = vi.fn();

  await installGeneratedInlineLoader(harness.window);
  Object.defineProperty(prototype, 'submit', { ...descriptor, value: poisonedSubmit });
  try {
    form.dispatchEvent(
      new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => {
      let navigated = false;
      try {
        navigated =
          sink.contentWindow?.location.pathname === '/favicon.ico' &&
          sink.contentWindow.location.search.includes('kovo-c210=deferred-runtime');
      } catch {
        navigated = true;
      }
      expect(navigated).toBe(true);
    });
    expect(poisonedSubmit).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(prototype, 'submit', descriptor);
  }
});

it('keeps complete same-build stream behavior without hard recovery', async () => {
  const harness = await createFrame(
    [
      '<form enhance data-mutation-stream action="/_m/chat" method="post"><button>send</button></form>',
      '<section kovo-fragment-target="messages">AUTHORITATIVE</section>',
    ].join(''),
    '<meta name="kovo-build" content="build-a">',
  );
  const frameDocument = harness.window.document;
  (harness.window as unknown as Record<string, unknown>).fetch = vi.fn(async () => ({
    body: frameStream(harness.window, [
      '<kovo-fragment target="messages" mode="append"><article>CONFIRMED</article></kovo-fragment>',
      '<kovo-done reason="complete"></kovo-done>',
    ]),
    headers: responseHeaders('build-a'),
    ok: true,
    status: 200,
  }));

  await installGeneratedInlineLoader(harness.window);
  frameDocument
    .querySelector('form')
    ?.dispatchEvent(new harness.window.SubmitEvent('submit', { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(frameDocument.querySelector('[kovo-fragment-target="messages"]')?.textContent).toContain(
      'CONFIRMED',
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(harness.loadCount()).toBe(1);
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inlineKovoLoaderBootstrapInstallerSource,
  installInlineKovoBootstrap,
} from './inline-loader.js';

declare global {
  // eslint-disable-next-line no-var
  var __kovo_a: ((body: string) => void) | undefined;
}

const initialUrl = location.href;
const initialHead = document.head.innerHTML;
const initialBody = document.body.innerHTML;
const initialApplyDeferredStream = globalThis.__kovo_a;

function installRafQueue(): FrameRequestCallback[] {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return callbacks;
}

function runNextRaf(callbacks: FrameRequestCallback[]): void {
  const callback = callbacks.shift();
  if (callback) callback(performance.now());
}

let submitSinkId = 0;
let networkFrameId = 0;

async function networkFrame(body: string): Promise<Window & typeof globalThis> {
  const frame = document.createElement('iframe');
  let loads = 0;
  frame.addEventListener('load', () => {
    loads += 1;
  });
  frame.src = `/__kovo_inline_security_fixture?bootstrap=${networkFrameId++}`;
  document.body.append(frame);
  await vi.waitFor(() => expect(loads).toBe(1));
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('missing network bootstrap iframe window');
  frameWindow.document.open();
  frameWindow.document.write(`<!doctype html><html><head></head><body>${body}</body></html>`);
  frameWindow.document.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return frameWindow as Window & typeof globalThis;
}

async function nativeSubmitFixture(token: string): Promise<{
  form: HTMLFormElement;
  sink: HTMLIFrameElement;
}> {
  const sink = document.createElement('iframe');
  sink.name = `kovo-c210-submit-sink-${submitSinkId++}`;
  sink.hidden = true;
  const initialLoad = new Promise<void>((resolve) => {
    sink.addEventListener('load', () => resolve(), { once: true });
  });
  sink.src = 'about:blank';
  document.body.append(sink);
  await initialLoad;
  const form = document.createElement('form');
  form.setAttribute('enhance', '');
  form.setAttribute('data-mutation', token);
  form.action = `/_m/${token}`;
  form.method = 'post';
  form.target = sink.name;
  const marker = document.createElement('input');
  marker.name = 'kovo-c210';
  marker.value = token;
  form.append(marker);
  document.body.append(form);
  return { form, sink };
}

async function expectNativeSubmit(sink: HTMLIFrameElement, token: string): Promise<void> {
  await vi.waitFor(() => {
    let navigated = false;
    try {
      navigated = sink.contentWindow?.location.pathname === `/_m/${token}`;
    } catch {
      // Firefox gives the favicon response an opaque origin inside the Vitest sandbox. Initial
      // about:blank is readable, so losing access is itself proof that native submission navigated.
      navigated = true;
    }
    expect(navigated).toBe(true);
  });
}

afterEach(() => {
  document.head.innerHTML = initialHead;
  document.body.innerHTML = initialBody;
  globalThis.__kovo_a = initialApplyDeferredStream;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, '', initialUrl);
});

describe('browser inline loader bootstrap', () => {
  it('imports the full runtime only after the post-paint rAF queue', async () => {
    const callbacks = installRafQueue();
    const installKovoDeferredRuntime = vi.fn();
    const runtimeImport = vi.fn(async () => ({ installKovoDeferredRuntime }));

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    expect(runtimeImport).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(2);

    runNextRaf(callbacks);
    runNextRaf(callbacks);
    expect(runtimeImport).not.toHaveBeenCalled();

    runNextRaf(callbacks);
    expect(runtimeImport).not.toHaveBeenCalled();
    runNextRaf(callbacks);

    await vi.waitFor(() => expect(runtimeImport).toHaveBeenCalledTimes(1));
    expect(runtimeImport).toHaveBeenCalledWith('/c/__v/runtime/kovo-runtime.client.js');
    expect(installKovoDeferredRuntime).toHaveBeenCalledTimes(1);
  });

  it('loads the runtime immediately and replays early enhanced navigation clicks', async () => {
    installRafQueue();
    const anchor = document.createElement('a');
    anchor.href = new URL('/next', location.href).href;
    const target = document.createElement('button');
    anchor.append(target);
    const nativePreventDefault = Event.prototype.preventDefault;
    let runtimeInstalled = false;
    let replayedClicks = 0;
    target.addEventListener('click', (event) => {
      Reflect.apply(nativePreventDefault, event, []);
      if (runtimeInstalled) replayedClicks += 1;
    });
    document.body.append(anchor);
    const runtimeImport = vi.fn(async () => ({
      installKovoDeferredRuntime() {
        runtimeInstalled = true;
      },
    }));

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(runtimeImport).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(replayedClicks).toBe(1));
  });

  it('loads the runtime immediately and replays early authored handler clicks', async () => {
    installRafQueue();
    const target = document.createElement('button');
    target.setAttribute('on:click', '/c/client.ts#mark');
    let runtimeInstalled = false;
    let replayedClicks = 0;
    target.addEventListener('click', () => {
      if (runtimeInstalled) replayedClicks += 1;
    });
    document.body.append(target);
    const runtimeImport = vi.fn(async () => ({
      installKovoDeferredRuntime() {
        runtimeInstalled = true;
      },
    }));

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(runtimeImport).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(replayedClicks).toBe(1));
  });

  it('pins dispatch, cleanup, and event construction before late replay-control replacement', async () => {
    installRafQueue();
    const target = document.createElement('button');
    target.setAttribute('on:click', '/c/client.ts#mark');
    let runtimeInstalled = false;
    let replayedClicks = 0;
    target.addEventListener('click', () => {
      if (runtimeInstalled) replayedClicks += 1;
    });
    document.body.append(target);
    const runtimeImport = vi.fn(async () => ({
      installKovoDeferredRuntime() {
        runtimeInstalled = true;
      },
    }));
    const dispatchDescriptor = Object.getOwnPropertyDescriptor(
      EventTarget.prototype,
      'dispatchEvent',
    );
    const removeDescriptor = Object.getOwnPropertyDescriptor(
      EventTarget.prototype,
      'removeEventListener',
    );
    if (
      !dispatchDescriptor ||
      !('value' in dispatchDescriptor) ||
      typeof dispatchDescriptor.value !== 'function' ||
      !removeDescriptor ||
      !('value' in removeDescriptor) ||
      typeof removeDescriptor.value !== 'function'
    ) {
      throw new Error('native bootstrap replay controls unavailable');
    }
    const NativeMouseEvent = MouseEvent;
    const poisonedDispatch = vi.fn(() => true);
    const poisonedRemove = vi.fn();
    const poisonedMouseConstruction = vi.fn();

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);
    Object.defineProperty(EventTarget.prototype, 'dispatchEvent', {
      ...dispatchDescriptor,
      value: poisonedDispatch,
    });
    Object.defineProperty(EventTarget.prototype, 'removeEventListener', {
      ...removeDescriptor,
      value: poisonedRemove,
    });
    vi.stubGlobal(
      'MouseEvent',
      class PoisonedMouseEvent extends NativeMouseEvent {
        constructor(type: string, init?: MouseEventInit) {
          poisonedMouseConstruction();
          super(type, init);
        }
      },
    );
    try {
      Reflect.apply(dispatchDescriptor.value, target, [
        new NativeMouseEvent('click', { bubbles: true, cancelable: true }),
      ]);

      await vi.waitFor(() => expect(replayedClicks).toBe(1));
      expect(poisonedDispatch).not.toHaveBeenCalled();
      expect(poisonedRemove).not.toHaveBeenCalled();
      expect(poisonedMouseConstruction).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(EventTarget.prototype, 'dispatchEvent', dispatchDescriptor);
      Object.defineProperty(EventTarget.prototype, 'removeEventListener', removeDescriptor);
      vi.unstubAllGlobals();
    }
  });

  it('pins event facts, DOM traversal, default prevention, and connectivity', async () => {
    installRafQueue();
    const anchor = document.createElement('a');
    anchor.href = new URL('/next', location.href).href;
    const target = document.createElement('button');
    anchor.append(target);
    const nativePreventDefault = Event.prototype.preventDefault;
    let runtimeInstalled = false;
    let replayedClicks = 0;
    target.addEventListener('click', (event) => {
      Reflect.apply(nativePreventDefault, event, []);
      if (runtimeInstalled) replayedClicks += 1;
    });
    document.body.append(anchor);
    let resolveRuntime: ((value: { installKovoDeferredRuntime: () => void }) => void) | undefined;
    const runtimePromise = new Promise<{ installKovoDeferredRuntime: () => void }>((resolve) => {
      resolveRuntime = resolve;
    });
    const runtimeImport = vi.fn(() => runtimePromise);
    const typeDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'type');
    const targetDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'target');
    const preventDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'preventDefault');
    const buttonDescriptor = Object.getOwnPropertyDescriptor(MouseEvent.prototype, 'button');
    const closestDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'closest');
    const getAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getAttribute',
    );
    const hasAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'hasAttribute',
    );
    const connectedDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected');
    const urlHrefDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'href');
    const urlOriginDescriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin');
    if (
      !typeDescriptor ||
      !targetDescriptor ||
      !preventDescriptor ||
      !buttonDescriptor ||
      !closestDescriptor ||
      !getAttributeDescriptor ||
      !hasAttributeDescriptor ||
      !connectedDescriptor ||
      !urlHrefDescriptor ||
      !urlOriginDescriptor
    ) {
      throw new Error('native bootstrap authority controls unavailable');
    }
    const poisonedType = vi.fn(() => 'submit');
    const poisonedTarget = vi.fn(() => document.body);
    const poisonedPrevent = vi.fn();
    const poisonedButton = vi.fn(() => 1);
    const poisonedClosest = vi.fn(() => null);
    const poisonedGetAttribute = vi.fn(() => 'https://attacker.invalid/redirect');
    const poisonedHasAttribute = vi.fn(() => true);
    const poisonedConnected = vi.fn(() => false);
    const poisonedUrlHref = vi.fn(() => 'https://attacker.invalid/redirect');
    const poisonedUrlOrigin = vi.fn(() => 'https://attacker.invalid');
    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);
    Object.defineProperty(Event.prototype, 'type', { ...typeDescriptor, get: poisonedType });
    Object.defineProperty(Event.prototype, 'target', { ...targetDescriptor, get: poisonedTarget });
    Object.defineProperty(Event.prototype, 'preventDefault', {
      ...preventDescriptor,
      value: poisonedPrevent,
    });
    Object.defineProperty(MouseEvent.prototype, 'button', {
      ...buttonDescriptor,
      get: poisonedButton,
    });
    Object.defineProperty(Element.prototype, 'closest', {
      ...closestDescriptor,
      value: poisonedClosest,
    });
    Object.defineProperty(Element.prototype, 'getAttribute', {
      ...getAttributeDescriptor,
      value: poisonedGetAttribute,
    });
    Object.defineProperty(Element.prototype, 'hasAttribute', {
      ...hasAttributeDescriptor,
      value: poisonedHasAttribute,
    });
    Object.defineProperty(Node.prototype, 'isConnected', {
      ...connectedDescriptor,
      get: poisonedConnected,
    });
    Object.defineProperty(URL.prototype, 'href', {
      ...urlHrefDescriptor,
      get: poisonedUrlHref,
    });
    Object.defineProperty(URL.prototype, 'origin', {
      ...urlOriginDescriptor,
      get: poisonedUrlOrigin,
    });
    try {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      const dispatchDescriptor = Object.getOwnPropertyDescriptor(
        EventTarget.prototype,
        'dispatchEvent',
      );
      if (!dispatchDescriptor || !('value' in dispatchDescriptor)) {
        throw new Error('native dispatch unavailable');
      }
      Reflect.apply(dispatchDescriptor.value, target, [event]);
      resolveRuntime?.({
        installKovoDeferredRuntime() {
          runtimeInstalled = true;
        },
      });
      await vi.waitFor(() => expect(runtimeInstalled).toBe(true));
      await vi.waitFor(() => expect(replayedClicks).toBe(1));
    } finally {
      Object.defineProperty(Event.prototype, 'type', typeDescriptor);
      Object.defineProperty(Event.prototype, 'target', targetDescriptor);
      Object.defineProperty(Event.prototype, 'preventDefault', preventDescriptor);
      Object.defineProperty(MouseEvent.prototype, 'button', buttonDescriptor);
      Object.defineProperty(Element.prototype, 'closest', closestDescriptor);
      Object.defineProperty(Element.prototype, 'getAttribute', getAttributeDescriptor);
      Object.defineProperty(Element.prototype, 'hasAttribute', hasAttributeDescriptor);
      Object.defineProperty(Node.prototype, 'isConnected', connectedDescriptor);
      Object.defineProperty(URL.prototype, 'href', urlHrefDescriptor);
      Object.defineProperty(URL.prototype, 'origin', urlOriginDescriptor);
    }
    expect(poisonedType).not.toHaveBeenCalled();
    expect(poisonedTarget).not.toHaveBeenCalled();
    expect(poisonedPrevent).not.toHaveBeenCalled();
    expect(poisonedButton).not.toHaveBeenCalled();
    expect(poisonedClosest).not.toHaveBeenCalled();
    expect(poisonedGetAttribute).not.toHaveBeenCalled();
    expect(poisonedHasAttribute).not.toHaveBeenCalled();
    expect(poisonedConnected).not.toHaveBeenCalled();
    expect(poisonedUrlHref).not.toHaveBeenCalled();
    expect(poisonedUrlOrigin).not.toHaveBeenCalled();
  });

  it('rejects inherited and accessor deferred-runtime installer exports', async () => {
    for (const inherited of [false, true]) {
      installRafQueue();
      const target = document.createElement('button');
      target.setAttribute('on:click', '/c/client.ts#mark');
      let dispatchReturned = false;
      let fallbackReplays = 0;
      target.addEventListener('click', () => {
        if (dispatchReturned) fallbackReplays += 1;
      });
      document.body.append(target);
      const installer = vi.fn();
      const readInstaller = vi.fn(() => installer);
      const carrier = inherited ? {} : Object.create(null);
      const owner = inherited ? carrier : Object.create(null);
      Object.defineProperty(owner, 'installKovoDeferredRuntime', {
        configurable: true,
        get: readInstaller,
      });
      const module = (inherited ? Object.create(owner) : owner) as {
        installKovoDeferredRuntime?: () => void;
      };

      installInlineKovoBootstrap(
        '/c/__v/runtime/kovo-runtime.client.js',
        vi.fn(async () => module),
      );
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      dispatchReturned = true;

      await vi.waitFor(() => expect(fallbackReplays).toBe(1));
      expect(readInstaller).not.toHaveBeenCalled();
      expect(installer).not.toHaveBeenCalled();
      target.remove();
    }
  });

  it('queues deferred stream apply calls until the runtime installs', async () => {
    const callbacks = installRafQueue();
    const applied: string[] = [];
    let resolveRuntime: ((value: { installKovoDeferredRuntime: () => void }) => void) | undefined;
    const runtimeImport = vi.fn(
      () =>
        new Promise<{ installKovoDeferredRuntime: () => void }>((resolve) => {
          resolveRuntime = resolve;
        }),
    );

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    globalThis.__kovo_a?.('<kovo-fragment target="reviews">Ready</kovo-fragment>');
    expect(applied).toEqual([]);
    while (callbacks.length > 0) runNextRaf(callbacks);
    await vi.waitFor(() => expect(runtimeImport).toHaveBeenCalledTimes(1));
    resolveRuntime?.({
      installKovoDeferredRuntime() {
        globalThis.__kovo_a = (body: string) => {
          applied.push(body);
        };
      },
    });

    await vi.waitFor(() =>
      expect(applied).toEqual(['<kovo-fragment target="reviews">Ready</kovo-fragment>']),
    );
  });

  it('leaves native links alone until the scheduled runtime import', async () => {
    const callbacks = installRafQueue();
    const target = document.createElement('button');
    const anchor = {
      hasAttribute: () => false,
      href: 'https://external.example/path',
      target: '',
    };
    target.closest = ((selector: string) =>
      selector === 'a[href]' ? anchor : null) as typeof target.closest;
    document.body.append(target);
    const runtimeImport = vi.fn(async () => ({}));

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(runtimeImport).not.toHaveBeenCalled();

    while (callbacks.length > 0) runNextRaf(callbacks);
    await vi.waitFor(() => expect(runtimeImport).toHaveBeenCalledTimes(1));
  });

  it('loads the runtime immediately and replays early enhanced form submits', async () => {
    installRafQueue();
    const form = document.createElement('form');
    form.setAttribute('enhance', '');
    form.setAttribute('data-mutation', 'save');
    form.action = '/_m/save';
    form.method = 'post';
    let runtimeInstalled = false;
    let replayedSubmits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (runtimeInstalled) replayedSubmits += 1;
    });
    document.body.append(form);
    const runtimeImport = vi.fn(async () => ({
      installKovoDeferredRuntime() {
        runtimeInstalled = true;
      },
    }));

    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(runtimeImport).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(replayedSubmits).toBe(1));
  });

  it.each(['data:/_m/chat', 'blob:/_m/chat', 'file:/_m/chat'])(
    'does not capture %s mutation actions from an opaque paint-first document',
    async (action) => {
      const frame = document.createElement('iframe');
      const loaded = new Promise<void>((resolve) => {
        frame.addEventListener('load', () => resolve(), { once: true });
      });
      frame.srcdoc = [
        '<!doctype html><html><head></head><body>',
        `<form enhance data-mutation="chat" action="${action}" method="post"><button>send</button></form>`,
        '</body></html>',
      ].join('');
      document.body.append(frame);
      await loaded;
      const frameWindow = frame.contentWindow;
      if (!frameWindow) throw new Error('missing opaque bootstrap iframe window');
      const globalRecord = frameWindow as unknown as Record<string, unknown>;
      const runtimeImport = vi.fn(async () => ({}));
      expect(frameWindow.location.href).toBe('about:srcdoc');
      expect(frameWindow.location.origin).toBe('null');
      const actionUrl = new frameWindow.URL(action, frameWindow.location.href);
      expect(actionUrl.protocol).toBe(action.slice(0, action.indexOf(':') + 1));
      expect(action.startsWith('file:') ? ['null', 'file://'] : ['null']).toContain(
        actionUrl.origin,
      );
      globalRecord.__kovoOpaqueRuntimeImport = runtimeImport;
      globalRecord.requestAnimationFrame = () => 1;
      const script = frameWindow.document.createElement('script');
      script.textContent = `(${inlineKovoLoaderBootstrapInstallerSource})('/c/runtime.js',globalThis.__kovoOpaqueRuntimeImport);`;
      frameWindow.document.head.append(script);

      const form = frameWindow.document.querySelector('form');
      if (!form) throw new Error('missing opaque bootstrap mutation form');
      const event = new frameWindow.SubmitEvent('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(runtimeImport).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['empty formaction', 'formaction=""'],
    ['empty formmethod', 'formmethod=""'],
    ['empty formaction and formmethod', 'formaction="" formmethod=""'],
  ] as const)(
    'does not capture a submitter with %s during paint-first takeover',
    async (_name, submitterAttributes) => {
      const frameWindow = await networkFrame(
        [
          '<form data-mutation="delete" action="/_m/delete" method="post">',
          `<button id="delete" ${submitterAttributes}>delete</button>`,
          '</form>',
        ].join(''),
      );
      const runtimeImport = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
      const globalRecord = frameWindow as unknown as Record<string, unknown>;
      globalRecord.__kovoSubmitterRuntimeImport = runtimeImport;
      globalRecord.requestAnimationFrame = () => 1;
      const script = frameWindow.document.createElement('script');
      script.textContent = `(${inlineKovoLoaderBootstrapInstallerSource})('/c/runtime.js',globalThis.__kovoSubmitterRuntimeImport);`;
      frameWindow.document.head.append(script);

      const form = frameWindow.document.querySelector('form');
      const submitter = frameWindow.document.querySelector<HTMLButtonElement>('#delete');
      if (!form || !submitter) throw new Error('missing paint-first submitter override fixture');
      const event = new frameWindow.SubmitEvent('submit', {
        bubbles: true,
        cancelable: true,
        submitter,
      });
      form.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(runtimeImport).not.toHaveBeenCalled();
    },
  );

  it('leaves opaque data-document navigation native during paint-first capture', async () => {
    const frame = document.createElement('iframe');
    const loaded = new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
    });
    const attackDocument = encodeURIComponent(
      '<!doctype html><html><body><p id="paint-first-attack">ATTACK</p></body></html>',
    );
    const href = `data:text/html,${attackDocument}`;
    frame.srcdoc = `<!doctype html><html><head></head><body><a id="opaque-anchor" href="${href}">navigate</a></body></html>`;
    document.body.append(frame);
    await loaded;
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('missing opaque paint-first navigation window');
    const runtimeImport = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
    const globalRecord = frameWindow as unknown as Record<string, unknown>;
    globalRecord.__kovoOpaqueRuntimeImport = runtimeImport;
    globalRecord.requestAnimationFrame = () => 1;
    const script = frameWindow.document.createElement('script');
    script.textContent = `(${inlineKovoLoaderBootstrapInstallerSource})('/c/runtime.js',globalThis.__kovoOpaqueRuntimeImport);`;
    frameWindow.document.head.append(script);

    const anchor = frameWindow.document.querySelector<HTMLAnchorElement>('#opaque-anchor');
    if (!anchor) throw new Error('missing opaque paint-first navigation anchor');
    let preventedByKovo = false;
    anchor.addEventListener(
      'click',
      (event) => {
        preventedByKovo = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    anchor.dispatchEvent(new frameWindow.MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(frameWindow.location.origin).toBe('null');
    expect(new frameWindow.URL(href).origin).toBe('null');
    expect(preventedByKovo).toBe(false);
    expect(runtimeImport).not.toHaveBeenCalled();
  });

  it('leaves same-origin blob-document navigation native during paint-first capture', async () => {
    const frame = document.createElement('iframe');
    let loads = 0;
    frame.addEventListener('load', () => {
      loads += 1;
    });
    frame.src = '/__kovo_inline_security_fixture?case=paint-first-blob-navigation';
    document.body.append(frame);
    await vi.waitFor(() => expect(loads).toBe(1));
    const frameWindow = frame.contentWindow;
    if (!frameWindow) throw new Error('missing blob paint-first navigation window');
    frameWindow.document.open();
    frameWindow.document.write('<!doctype html><html><head></head><body></body></html>');
    frameWindow.document.close();
    const href = frameWindow.URL.createObjectURL(
      new frameWindow.Blob(['<!doctype html><html><body>ATTACKER DOCUMENT</body></html>'], {
        type: 'text/html',
      }),
    );
    const anchor = frameWindow.document.createElement('a');
    anchor.href = href;
    frameWindow.document.body.append(anchor);
    const runtimeImport = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
    const globalRecord = frameWindow as unknown as Record<string, unknown>;
    globalRecord.__kovoBlobRuntimeImport = runtimeImport;
    globalRecord.requestAnimationFrame = () => 1;
    try {
      const script = frameWindow.document.createElement('script');
      script.textContent = `(${inlineKovoLoaderBootstrapInstallerSource})('/c/runtime.js',globalThis.__kovoBlobRuntimeImport);`;
      frameWindow.document.head.append(script);
      let preventedByKovo = false;
      anchor.addEventListener(
        'click',
        (event) => {
          preventedByKovo = event.defaultPrevented;
          event.preventDefault();
        },
        { once: true },
      );
      anchor.dispatchEvent(
        new frameWindow.MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      const blobUrl = new frameWindow.URL(href);
      expect(blobUrl.origin).toBe(frameWindow.location.origin);
      expect(blobUrl.protocol).toBe('blob:');
      expect(preventedByKovo).toBe(false);
      expect(runtimeImport).not.toHaveBeenCalled();
    } finally {
      frameWindow.URL.revokeObjectURL(href);
    }
  });

  it('falls back to native submit when the early runtime import fails', async () => {
    installRafQueue();
    const { form, sink } = await nativeSubmitFixture('runtime-import-rejected');

    installInlineKovoBootstrap(
      '/c/__v/runtime/kovo-runtime.client.js',
      vi.fn(async () => {
        throw new Error('load failed');
      }),
    );

    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await expectNativeSubmit(sink, 'runtime-import-rejected');
  });

  it('rejects a forged structural form target from an own closest replacement', async () => {
    // SPEC.md §4.4/§6.6: authored prototype/instance replacement cannot redirect a captured
    // interaction into a structural form-like object and reach its submit capability.
    const callbacks = installRafQueue();
    const trigger = document.createElement('button');
    const submit = vi.fn();
    const structuralForm = { isConnected: true, submit };
    trigger.closest = ((selector: string) =>
      selector === 'form[enhance],form[data-enhance],form[data-mutation]'
        ? structuralForm
        : null) as typeof trigger.closest;
    document.body.append(trigger);

    const runtimeImport = vi.fn(
      async () =>
        ({
          installKovoDeferredRuntime() {
            throw new TypeError('runtime controls rejected');
          },
        }) as const,
    );
    installInlineKovoBootstrap('/c/__v/runtime/kovo-runtime.client.js', runtimeImport);

    trigger.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    while (callbacks.length > 0) runNextRaf(callbacks);
    await vi.waitFor(() => expect(runtimeImport).toHaveBeenCalledTimes(1));
    expect(submit).not.toHaveBeenCalled();
  });

  it('pins native submit before a late prototype replacement during rejected import fallback', async () => {
    installRafQueue();
    const { form, sink } = await nativeSubmitFixture('late-prototype-poison');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'requestSubmit');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('native form requestSubmit unavailable');
    }
    const poisonedRequestSubmit = vi.fn();

    installInlineKovoBootstrap(
      '/c/__v/runtime/kovo-runtime.client.js',
      vi.fn(async () => {
        throw new Error('load failed');
      }),
    );
    Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
      ...descriptor,
      value: poisonedRequestSubmit,
    });
    try {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

      await expectNativeSubmit(sink, 'late-prototype-poison');
      expect(poisonedRequestSubmit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', descriptor);
    }
  });

  it('rejects bootstrap installation when native requestSubmit was poisoned before capture', () => {
    installRafQueue();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'requestSubmit');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('native form requestSubmit unavailable');
    }
    Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', {
      ...descriptor,
      value() {},
    });
    try {
      expect(() =>
        installInlineKovoBootstrap(
          '/c/__v/runtime/kovo-runtime.client.js',
          vi.fn(async () => ({})),
        ),
      ).toThrow(/bootstrap form submit controls are unavailable/);
    } finally {
      Object.defineProperty(HTMLFormElement.prototype, 'requestSubmit', descriptor);
    }
  });

  it('rejects bootstrap installation when event dispatch was poisoned before capture', () => {
    installRafQueue();
    const descriptor = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'dispatchEvent');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('native event dispatch unavailable');
    }
    Object.defineProperty(EventTarget.prototype, 'dispatchEvent', {
      ...descriptor,
      value: () => true,
    });
    try {
      expect(() =>
        installInlineKovoBootstrap(
          '/c/__v/runtime/kovo-runtime.client.js',
          vi.fn(async () => ({})),
        ),
      ).toThrow(/bootstrap replay controls are unavailable/);
    } finally {
      Object.defineProperty(EventTarget.prototype, 'dispatchEvent', descriptor);
    }
  });
});

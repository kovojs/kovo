import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoBootstrap } from './inline-loader.js';

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
  form.action = '/favicon.ico';
  form.method = 'get';
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
      navigated =
        sink.contentWindow?.location.pathname === '/favicon.ico' &&
        sink.contentWindow.location.search.includes(`kovo-c210=${token}`);
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
    const target = document.createElement('button');
    const anchor = {
      hasAttribute: () => false,
      href: new URL('/next', location.href).href,
      target: '',
    };
    target.closest = ((selector: string) =>
      selector === 'a[href]' ? anchor : null) as typeof target.closest;
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
    form.action = '/save';
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

  it('retains the explicit structural submit fallback when runtime installation rejects', async () => {
    // C186 control: the successful strict-CSP proof must not erase the bootstrap's availability
    // fallback for a genuinely rejected runtime installer.
    installRafQueue();
    const trigger = document.createElement('button');
    const submit = vi.fn();
    const structuralForm = { isConnected: true, submit };
    trigger.closest = ((selector: string) =>
      selector === 'form[enhance],form[data-enhance],form[data-mutation]'
        ? structuralForm
        : null) as typeof trigger.closest;
    document.body.append(trigger);

    installInlineKovoBootstrap(
      '/c/__v/runtime/kovo-runtime.client.js',
      vi.fn(async () => ({
        installKovoDeferredRuntime() {
          throw new TypeError('runtime controls rejected');
        },
      })),
    );

    trigger.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it('pins native submit before a late prototype replacement during rejected import fallback', async () => {
    installRafQueue();
    const { form, sink } = await nativeSubmitFixture('late-prototype-poison');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'submit');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('native form submit unavailable');
    }
    const poisonedSubmit = vi.fn();

    installInlineKovoBootstrap(
      '/c/__v/runtime/kovo-runtime.client.js',
      vi.fn(async () => {
        throw new Error('load failed');
      }),
    );
    Object.defineProperty(HTMLFormElement.prototype, 'submit', {
      ...descriptor,
      value: poisonedSubmit,
    });
    try {
      form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

      await expectNativeSubmit(sink, 'late-prototype-poison');
      expect(poisonedSubmit).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(HTMLFormElement.prototype, 'submit', descriptor);
    }
  });

  it('rejects bootstrap installation when native submit was poisoned before capture', () => {
    installRafQueue();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'submit');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('native form submit unavailable');
    }
    Object.defineProperty(HTMLFormElement.prototype, 'submit', {
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
      Object.defineProperty(HTMLFormElement.prototype, 'submit', descriptor);
    }
  });
});

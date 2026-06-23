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
    target.setAttribute('on:click', '/client.ts#mark');
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
    const form = document.createElement('form');
    form.setAttribute('enhance', '');
    form.action = '/save';
    const submit = vi.fn();
    Object.defineProperty(form, 'submit', { value: submit });
    document.body.append(form);

    installInlineKovoBootstrap(
      '/c/__v/runtime/kovo-runtime.client.js',
      vi.fn(async () => {
        throw new Error('load failed');
      }),
    );

    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });
});

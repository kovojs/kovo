import { afterAll, describe, expect, it, vi } from 'vitest';

import { installKovoClient } from '@kovojs/browser/client';
import { createKovoClientMutationTransport } from './client-installer.js';
import { FakeElement, FakeRoot, installTestClientModuleManifest } from './runtime-test-fakes.js';

const restoreClientModuleManifest = installTestClientModuleManifest([
  '/c/allowed.client.js',
  '/c/drain.client.js',
]);
afterAll(restoreClientModuleManifest);

describe('custom-shell client installer', () => {
  it('owns loader assembly and enforces the document module allowlist before custom import', async () => {
    const root = new FakeRoot();
    const run = vi.fn();
    const importModule = vi.fn(async () => ({ run }));
    const onError = vi.fn();
    const lifecycle = vi.fn();
    const client = installKovoClient({
      importModule,
      onError,
      onLifecycle: lifecycle,
      root,
    });

    await client.ready;
    expect(lifecycle).toHaveBeenCalledWith({ phase: 'ready' });

    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/blocked.client.js#run' }),
      type: 'click',
    });
    expect(importModule).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { phase: 'delegated-event' });

    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/allowed.client.js#run' }),
      type: 'click',
    });
    expect(importModule).toHaveBeenCalledExactlyOnceWith('/c/allowed.client.js');
    expect(run).toHaveBeenCalledOnce();

    await client.dispose();
    expect(root.listeners.size).toBe(0);
    expect(lifecycle).toHaveBeenLastCalledWith({
      mode: 'drain',
      phase: 'disposed',
      reason: 'user',
    });
  });

  it('drains already-started module work before clearing the installation', async () => {
    const root = new FakeRoot();
    const run = vi.fn();
    let resolveImport: ((module: Record<string, unknown>) => void) | undefined;
    const importModule = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const client = installKovoClient({ importModule, root });
    const dispatched = root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/drain.client.js#run' }),
      type: 'click',
    });
    const disposed = client.dispose();
    let disposalSettled = false;
    void disposed.then(() => {
      disposalSettled = true;
    });

    await Promise.resolve();
    expect(disposalSettled).toBe(false);
    resolveImport?.({ run });
    await dispatched;
    await disposed;

    // Listener/island authority is retired immediately; drain waits only so the
    // authored import promise cannot outlive the internal store teardown.
    expect(run).not.toHaveBeenCalled();
    expect(root.listeners.size).toBe(0);
  });

  it('aborts without waiting for authored import wrappers and rejects their late result', async () => {
    const root = new FakeRoot();
    const run = vi.fn();
    const onError = vi.fn();
    let resolveImport: ((module: Record<string, unknown>) => void) | undefined;
    const client = installKovoClient({
      importModule: () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveImport = resolve;
        }),
      onError,
      root,
    });
    const dispatched = root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/drain.client.js#run' }),
      type: 'click',
    });

    await client.dispose('abort');
    expect(root.listeners.size).toBe(0);
    resolveImport?.({ run });
    await dispatched;

    expect(run).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), {
      phase: 'delegated-event',
    });
  });

  it('rejects duplicate active installs and supports install/dispose/install', async () => {
    const root = new FakeRoot();
    const first = installKovoClient({ root });
    expect(() => installKovoClient({ root })).toThrow('already installed');

    await first.dispose();
    const second = installKovoClient({ root });
    await second.ready;
    await second.dispose('abort');
    expect(root.listeners.size).toBe(0);
  });

  it('rejects callback accessors without invoking them', () => {
    const root = new FakeRoot();
    const getter = vi.fn(() => vi.fn());
    const options = { root };
    Object.defineProperty(options, 'fetch', { configurable: true, get: getter });

    expect(() => installKovoClient(options)).toThrow('fetch must be an own-data property');
    expect(getter).not.toHaveBeenCalled();
  });

  it('validates option callbacks, roots, and disposal modes at the public boundary', async () => {
    const root = new FakeRoot();
    expect(() => installKovoClient({ onLifecycle: 'not-a-function', root } as never)).toThrow(
      'onLifecycle must be a function',
    );

    const addEventListener = vi.fn();
    const accessorRoot = {
      querySelectorAll() {
        return [];
      },
    };
    Object.defineProperty(accessorRoot, 'addEventListener', {
      configurable: true,
      get: addEventListener,
    });
    expect(() => installKovoClient({ root: accessorRoot as never })).toThrow('requires a DOM root');
    expect(addEventListener).not.toHaveBeenCalled();

    const client = installKovoClient({ root });
    expect(() => client.dispose('wait' as never)).toThrow('dispose mode');
    await client.dispose('abort');
  });
});

describe('custom-shell framework-owned request transport', () => {
  const mutationOptions = {
    body: 'payload',
    headers: {
      Accept: 'text/vnd.kovo.fragment+html',
      'Kovo-Build': 'build-one',
      'Kovo-Idem': 'idem-one',
    },
    keepalive: true,
    method: 'POST',
    redirect: 'error' as const,
    referrerPolicy: 'origin' as const,
  };

  it('lets an observer inspect the exact request without owning URL or init', async () => {
    const response = new Response('', { status: 200 });
    const dispatch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('http://localhost/_m/cart/add');
      expect(request.method).toBe('POST');
      expect(request.credentials).toBe('same-origin');
      expect(request.redirect).toBe('error');
      expect(request.referrerPolicy).toBe('origin');
      expect(request.keepalive).toBe(true);
      expect(request.headers.get('Kovo-Build')).toBe('build-one');
      expect(request.headers.get('Kovo-Idem')).toBe('idem-one');
      return response;
    });
    const progress = vi.fn();
    const observe = vi.fn(async (request, next, reportUploadProgress) => {
      expect(request).toBeInstanceOf(Request);
      reportUploadProgress({ loaded: 5, total: 10 });
      return next();
    });
    const fetch = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe,
    });

    await expect(
      fetch('/_m/cart/add', {
        ...mutationOptions,
        onUploadProgress: progress,
      }),
    ).resolves.toBe(response);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith({ loaded: 5, total: 10 });
  });

  it('rejects arbitrary responses, skipped next calls, and repeated next calls', async () => {
    const admitted = new Response('ok');
    const dispatch = vi.fn(async () => admitted);

    const arbitrary = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async () => new Response('foreign'),
    });
    await expect(arbitrary('/_m/cart/add', mutationOptions)).rejects.toThrow('exact Response');
    expect(dispatch).not.toHaveBeenCalled();

    const replaced = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async (_request, next) => {
        await next();
        return new Response('replacement');
      },
    });
    await expect(replaced('/_m/cart/add', mutationOptions)).rejects.toThrow('exact Response');

    const repeated = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async (_request, next) => {
        const response = await next();
        await next();
        return response;
      },
    });
    await expect(repeated('/_m/cart/add', mutationOptions)).rejects.toThrow('exactly once');
  });

  it('rejects request-header mutation before platform dispatch', async () => {
    const dispatch = vi.fn(async () => new Response('ok'));
    const fetch = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async (request, next) => {
        request.headers.set('Kovo-Build', 'attacker-build');
        return next();
      },
    });

    await expect(fetch('/_m/cart/add', mutationOptions)).rejects.toThrow(
      'modified framework request headers',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('propagates observer errors and validates upload reports', async () => {
    const observerError = new Error('observer failed');
    const dispatch = vi.fn(async () => new Response('ok'));
    const failed = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async () => {
        throw observerError;
      },
    });
    await expect(failed('/_m/cart/add', mutationOptions)).rejects.toBe(observerError);

    const invalidProgress = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
      observe: async (_request, next, report) => {
        report({ loaded: 11, total: 10 });
        return next();
      },
    });
    await expect(invalidProgress('/_m/cart/add', mutationOptions)).rejects.toThrow(
      'upload progress',
    );
  });

  it('threads abort signals and streaming keepalive posture into the exact request', async () => {
    const upstream = new AbortController();
    const dispatch = vi.fn(
      (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          expect(request.keepalive).toBe(false);
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          });
        }),
    );
    const fetch = createKovoClientMutationTransport({
      dispatch,
      isActive: () => true,
    });
    const pending = fetch('/_m/chat', {
      ...mutationOptions,
      keepalive: false,
      signal: upstream.signal,
    });
    const reason = new Error('island removed');
    upstream.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

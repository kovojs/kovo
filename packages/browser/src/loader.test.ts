import { describe, expect, it, vi } from 'vitest';

import { installKovoLoader as installKovoLoaderFromBarrel } from './client.js';
import { installKovoLoader, type KovoLoaderOptions } from './loader.js';
import { FakeElement, FakeRoot } from './runtime-test-fakes.js';

describe('runtime loader module', () => {
  it('keeps the barrel export wired to the extracted loader owner', async () => {
    // SPEC.md section 4.4: the always-loaded runtime path delegates browser events.
    expect(installKovoLoaderFromBarrel).toBe(installKovoLoader);

    const root = new FakeRoot();
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ run: handler }));
    const loader = installKovoLoader({
      allowedClientModuleUrls: ['/c/client.js'],
      events: ['click'],
      importModule,
      root,
    });

    expect(loader.events).toEqual(['click']);
    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/client.js#run' }),
      type: 'click',
    });

    expect(importModule).toHaveBeenCalledWith('/c/client.js');
    expect(handler).toHaveBeenCalledTimes(1);

    loader.dispose();
    expect(root.listeners.has('click')).toBe(false);
  });

  it('hydrates SSR-native indeterminate checkbox state during loader install', () => {
    const root = new FakeRoot();
    const input = Object.assign(
      new FakeElement({
        'aria-checked': 'mixed',
        'data-state': 'indeterminate',
        type: 'checkbox',
      }),
      { indeterminate: false },
    );
    root.elements.set(
      'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]',
      [input],
    );

    installKovoLoader({
      importModule: vi.fn(async () => ({})),
      root,
    });

    expect(input.indeterminate).toBe(true);
  });

  it('guards delegated imports against an explicit compiler client-module allowlist', async () => {
    const root = new FakeRoot();
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ run: handler }));
    installKovoLoader({
      allowedClientModuleUrls: ['/c/allowed.client.js'],
      events: ['click'],
      importModule,
      root,
    });

    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/blocked.client.js#run' }),
      type: 'click',
    });

    expect(importModule).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('pins the compiler client-module allowlist against retained caller mutation', async () => {
    const root = new FakeRoot();
    const allowedClientModuleUrls = ['/c/allowed.client.js'];
    const importModule = vi.fn(async () => ({ run: vi.fn() }));
    installKovoLoader({
      allowedClientModuleUrls,
      events: ['click'],
      importModule,
      root,
    });

    allowedClientModuleUrls[0] = '/c/blocked.client.js';
    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/blocked.client.js#run' }),
      type: 'click',
    });

    expect(importModule).not.toHaveBeenCalled();
  });

  it('pins allowlist option projection against late Object.fromEntries poisoning', async () => {
    const root = new FakeRoot();
    const importModule = vi.fn(async () => ({ run: vi.fn() }));
    const originalFromEntries = Object.fromEntries;
    let firstProjection = true;
    Object.fromEntries = ((entries: Iterable<readonly [PropertyKey, unknown]>) => {
      if (firstProjection) {
        firstProjection = false;
        return { allowedClientModuleUrls: ['/c/blocked.client.js'] };
      }
      return originalFromEntries(entries);
    }) as typeof Object.fromEntries;
    try {
      installKovoLoader({
        allowedClientModuleUrls: ['/c/allowed.client.js'],
        events: ['click'],
        importModule,
        root,
      });
    } finally {
      Object.fromEntries = originalFromEntries;
    }

    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/blocked.client.js#run' }),
      type: 'click',
    });

    expect(importModule).not.toHaveBeenCalled();
  });

  it('ignores inherited client-module allowlist authority', async () => {
    const root = new FakeRoot();
    const importModule = vi.fn(async () => ({ run: vi.fn() }));
    Object.defineProperty(Object.prototype, 'allowedClientModuleUrls', {
      configurable: true,
      value: ['/c/blocked.client.js'],
    });
    try {
      installKovoLoader({ events: ['click'], importModule, root });
    } finally {
      delete (Object.prototype as { allowedClientModuleUrls?: unknown }).allowedClientModuleUrls;
    }

    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/c/blocked.client.js#run' }),
      type: 'click',
    });
    expect(importModule).not.toHaveBeenCalled();
  });

  it('rejects accessor allowlist options without invoking the getter', () => {
    const root = new FakeRoot();
    let getterCalls = 0;
    const options = {
      importModule: vi.fn(async () => ({})),
      root,
    } as KovoLoaderOptions;
    Object.defineProperty(options, 'allowedClientModuleUrls', {
      configurable: true,
      get() {
        getterCalls += 1;
        return ['/c/blocked.client.js'];
      },
    });

    expect(() => installKovoLoader(options)).toThrow('must be an own-data property');
    expect(getterCalls).toBe(0);
  });

  it('uses the explicit compiler client-module allowlist for startup triggers', async () => {
    const root = new FakeRoot();
    const allowed = new FakeElement({ 'on:load': '/c/allowed.client.js#run' });
    const blocked = new FakeElement({ 'on:load': '/c/blocked.client.js#run' });
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ run: handler }));
    const onError = vi.fn();
    root.elements.set('[on\\:load]', [allowed, blocked]);

    installKovoLoader({
      allowedClientModuleUrls: ['/c/allowed.client.js'],
      importModule,
      onError,
      root,
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(importModule).toHaveBeenCalledExactlyOnceWith('/c/allowed.client.js');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      event: expect.objectContaining({ type: 'load' }),
      phase: 'execution-trigger',
    });
  });
});

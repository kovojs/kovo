import { describe, expect, it, vi } from 'vitest';

import type { DelegatedEvent, EventElementLike } from './events.js';
import { createIslandSignalScope } from './handlers.js';
import { addLoaderListener, installExecutionTriggers } from './loader-lifecycle.js';

class FakeRoot {
  listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();
  elements = new Map<string, FakeElement[]>();

  addEventListener(type: string, listener: (event: DelegatedEvent) => void | Promise<void>): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
  ): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(selector: string): Iterable<FakeElement> {
    return this.elements.get(selector) ?? [];
  }
}

class FakeElement implements EventElementLike {
  readonly attributes: { name: string; value: string }[];

  constructor(private readonly attrs: Record<string, string>) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): FakeElement | null {
    const trigger = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return trigger && Object.hasOwn(this.attrs, `on:${trigger}`) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

describe('loader lifecycle', () => {
  it('registers loader listeners with matching disposer options', () => {
    const root = new FakeRoot();
    const listener = vi.fn();
    const disposers: Array<() => void> = [];

    addLoaderListener(root, 'click', listener, disposers, { capture: true });

    expect(root.listeners.get('click')).toBe(listener);
    disposers[0]?.();
    expect(root.listeners.has('click')).toBe(false);
  });

  it('installs declared load, idle, and visible execution triggers', async () => {
    // SPEC.md section 4.4: execution triggers are part of the always-loaded runtime path.
    const root = new FakeRoot();
    const loadElement = new FakeElement({ 'on:load': '/c/load.js#start' });
    const idleElement = new FakeElement({ 'on:idle': '/c/idle.js#warm' });
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const idleCallbacks: Array<() => void> = [];
    let visibleCallback: (
      entries: { isIntersecting: boolean; target: FakeElement }[],
    ) => void = () => {};
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const handlers = {
      mount: vi.fn(),
      start: vi.fn(),
      warm: vi.fn(),
    };
    const importModule = vi.fn(async (url: string) => {
      if (url === '/c/load.js') return { start: handlers.start };
      if (url === '/c/idle.js') return { warm: handlers.warm };
      return { mount: handlers.mount };
    });

    root.elements.set('[on\\:load]', [loadElement]);
    root.elements.set('[on\\:idle]', [idleElement]);
    root.elements.set('[on\\:visible]', [visibleElement]);

    const dispose = installExecutionTriggers(
      {
        importModule,
        requestIdle: (callback) => {
          idleCallbacks.push(callback);
        },
        root,
        visibleObserver: (callback) => {
          visibleCallback = callback as typeof visibleCallback;
          return observer;
        },
      },
      createIslandSignalScope(),
    );

    await vi.waitFor(() => expect(handlers.start).toHaveBeenCalledTimes(1));
    expect(handlers.warm).not.toHaveBeenCalled();
    idleCallbacks[0]?.();
    await vi.waitFor(() => expect(handlers.warm).toHaveBeenCalledTimes(1));

    expect(observer.observe).toHaveBeenCalledWith(visibleElement);
    visibleCallback([{ isIntersecting: false, target: visibleElement }]);
    expect(handlers.mount).not.toHaveBeenCalled();
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    await vi.waitFor(() => expect(handlers.mount).toHaveBeenCalledTimes(1));
    visibleCallback([{ isIntersecting: true, target: visibleElement }]);
    expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
    expect(handlers.mount).toHaveBeenCalledTimes(1);

    dispose();
    expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
  });
});

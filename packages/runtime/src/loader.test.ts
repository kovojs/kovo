import { describe, expect, it, vi } from 'vitest';

import type { DelegatedEvent, EventElementLike } from './events.js';
import { installJisoLoader as installJisoLoaderFromBarrel } from './index.js';
import { installJisoLoader } from './loader.js';
import type { LoaderRoot } from './loader-lifecycle.js';

class FakeRoot implements LoaderRoot {
  readonly listeners = new Map<string, (event: DelegatedEvent) => void | Promise<void>>();

  addEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    _options?: { capture?: boolean },
  ): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(
    type: string,
    listener: (event: DelegatedEvent) => void | Promise<void>,
    _options?: { capture?: boolean },
  ): void {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  querySelectorAll(): Iterable<EventElementLike> {
    return [];
  }
}

class FakeElement implements EventElementLike {
  readonly attributes: { name: string; value: string }[];

  constructor(private readonly attrs: Record<string, string>) {
    this.attributes = Object.entries(attrs).map(([name, value]) => ({ name, value }));
  }

  closest(selector: string): FakeElement | null {
    const delegated = /^\[on\\:(.+)\]$/.exec(selector)?.[1];
    return delegated && this.attrs[`on:${delegated}`] ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
}

describe('runtime loader module', () => {
  it('keeps the barrel export wired to the extracted loader owner', async () => {
    // SPEC.md section 4.4: the always-loaded runtime path delegates browser events.
    expect(installJisoLoaderFromBarrel).toBe(installJisoLoader);

    const root = new FakeRoot();
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ run: handler }));
    const loader = installJisoLoader({
      events: ['click'],
      importModule,
      root,
    });

    expect(loader.events).toEqual(['click']);
    await root.listeners.get('click')?.({
      target: new FakeElement({ 'on:click': '/client.js#run' }),
      type: 'click',
    });

    expect(importModule).toHaveBeenCalledWith('/client.js');
    expect(handler).toHaveBeenCalledTimes(1);

    loader.dispose();
    expect(root.listeners.has('click')).toBe(false);
  });
});

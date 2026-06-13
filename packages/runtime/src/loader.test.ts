import { describe, expect, it, vi } from 'vitest';

import { installJisoLoader as installJisoLoaderFromBarrel } from './index.js';
import { installJisoLoader } from './loader.js';
import { FakeElement, FakeRoot } from './runtime-test-fakes.js';

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

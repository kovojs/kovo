import { describe, expect, it, vi } from 'vitest';

import { installKovoLoader as installKovoLoaderFromBarrel } from './index.js';
import { installKovoLoader } from './loader.js';
import { FakeElement, FakeRoot } from './runtime-test-fakes.js';

describe('runtime loader module', () => {
  it('keeps the barrel export wired to the extracted loader owner', async () => {
    // SPEC.md section 4.4: the always-loaded runtime path delegates browser events.
    expect(installKovoLoaderFromBarrel).toBe(installKovoLoader);

    const root = new FakeRoot();
    const handler = vi.fn();
    const importModule = vi.fn(async () => ({ run: handler }));
    const loader = installKovoLoader({
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
});

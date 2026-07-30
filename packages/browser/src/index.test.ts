import { describe, expect, it, vi } from 'vitest';

import { installKovoClient } from './client.js';
import { FakeRoot } from './runtime-test-fakes.js';

describe('runtime barrel loader smoke', () => {
  it('installs and asynchronously disposes the custom-shell client', async () => {
    // SPEC.md §4.4: the custom-shell surface installs the always-loaded loader
    // while keeping its store, morph root, and transport framework-owned.
    const root = new FakeRoot();
    const importModule = vi.fn();

    const client = installKovoClient({
      importModule,
      root,
    });
    await client.ready;

    // SPEC.md §4.4/§10.4: delegate every on:* event, synthesize pointerenter/pointerleave,
    // and register the bfcache-safe pagehide optimism cleanup.
    expect([...root.listeners.keys()]).toEqual([
      'click',
      'submit',
      'input',
      'change',
      'keydown',
      'keyup',
      'contextmenu',
      'paste',
      'cancel',
      'beforetoggle',
      'animationend',
      'scroll',
      'focus',
      'blur',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerover',
      'pointerout',
      'kovo:query',
      'pagehide',
    ]);
    expect(importModule).not.toHaveBeenCalled();

    await client.dispose();
    expect(root.listeners.size).toBe(0);
  });
});

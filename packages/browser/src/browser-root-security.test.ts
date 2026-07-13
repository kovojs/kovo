import { describe, expect, it, vi } from 'vitest';

import { defaultEnhancedFetch } from './browser-root.js';

describe('default enhanced mutation transport security', () => {
  it('keeps the boot-captured fetch transport after a late global replacement', async () => {
    // SPEC §6.6/§9.1: the framework default transport carries form credentials and
    // Kovo-Idem. A late global fetch replacement must not become that egress authority.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
      throw new Error('global fetch unavailable');
    }
    const poison = vi.fn(async () => new Response('ATTACKER-SUBSTITUTED'));
    Object.defineProperty(globalThis, 'fetch', { ...descriptor, value: poison });
    try {
      const response = await defaultEnhancedFetch('data:text/plain,SERVER-SAFE', {
        body: undefined,
        headers: {},
        keepalive: false,
        method: 'GET',
      });
      expect(await response.text()).toBe('SERVER-SAFE');
      expect(poison).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'fetch', descriptor);
    }
  });
});

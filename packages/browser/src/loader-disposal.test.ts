import { describe, expect, it, vi } from 'vitest';

import { createQueryStore, installKovoLoader, type MutationBroadcast } from './client.js';
import {
  FakeBroadcastChannel,
  FakeElement,
  FakeMorphRoot,
  FakeRoot,
} from './runtime-test-fakes.js';

describe('loader disposal', () => {
  it('disposes loader listeners, visible observers, and auto-created broadcasts', () => {
    // SPEC.md §4.4: loader-installed browser resources must be released by dispose().
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originalBroadcastChannel = globalRecord.BroadcastChannel;
    const root = new FakeRoot();
    const focusTarget = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const visibleElement = new FakeElement({ 'on:visible': '/c/chart.js#mount' });
    const discardPendingOptimism = vi.fn();
    const observer = {
      observe: vi.fn(),
      unobserve: vi.fn(),
    };
    const channels: FakeBroadcastChannel[] = [];
    class TestBroadcastChannel extends FakeBroadcastChannel {
      constructor() {
        super();
        channels.push(this);
      }
    }
    globalRecord.BroadcastChannel = TestBroadcastChannel;
    root.elements.set('[on\\:visible]', [visibleElement]);

    try {
      const loader = installKovoLoader({
        discardPendingOptimism,
        enhancedMutations: {
          fetch: vi.fn(),
          root: mutationRoot,
          store,
        },
        focusTarget,
        importModule: vi.fn(),
        queryRefetch: { fetch: vi.fn() },
        queryStore: store,
        root,
        visibleObserver: () => observer,
      });

      expect(root.listeners.has('click')).toBe(true);
      expect(root.listeners.has('visibilitychange')).toBe(true);
      expect(root.listeners.has('pageshow')).toBe(true);
      expect(root.listeners.has('pagehide')).toBe(true);
      expect(focusTarget.listeners.has('focus')).toBe(false);
      expect(observer.observe).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(false);

      loader.dispose();

      expect(root.listeners.size).toBe(0);
      expect(focusTarget.listeners.size).toBe(0);
      expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
      expect(channels[0]?.closed).toBe(true);
    } finally {
      globalRecord.BroadcastChannel = originalBroadcastChannel;
    }
  });

  it('does not close caller-owned mutation broadcasts on dispose', () => {
    const root = new FakeRoot();
    const mutationRoot = new FakeMorphRoot();
    const store = createQueryStore();
    const close = vi.fn();
    const broadcast: MutationBroadcast = {
      close,
      publish: vi.fn(),
    };

    const loader = installKovoLoader({
      enhancedMutations: {
        broadcast,
        fetch: vi.fn(),
        root: mutationRoot,
        store,
      },
      importModule: vi.fn(),
      root,
    });

    loader.dispose();

    expect(close).not.toHaveBeenCalled();
  });
});

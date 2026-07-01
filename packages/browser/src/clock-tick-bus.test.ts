import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClockScheduler, installClockUpdatePlans } from './clock-tick-bus.js';
import { createQueryStore } from './query-store.js';
import { FakeMorphRoot } from './runtime-test-fakes.js';

describe('clock tick bus', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('coalesces declared clock plans through one interval and one animation frame', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const interval = vi.spyOn(globalThis, 'setInterval');
    const root = new FakeMorphRoot();
    const updates: Array<{ name: string; value: number }> = [];
    const frames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    const ownerDocument = createClockDocument();
    const scheduler = createClockScheduler({ ownerDocument });
    const disposeFirst = installClockUpdatePlans(
      root,
      [
        {
          clocks: { ago: { every: '1s' } },
          update(_root, now) {
            updates.push({ name: 'ago', value: now.ago?.getTime() ?? 0 });
          },
        },
      ],
      {},
      { scheduler },
    );
    const disposeSecond = installClockUpdatePlans(
      root,
      [
        {
          clocks: { slow: { every: '2s' } },
          update(_root, now) {
            updates.push({ name: 'slow', value: now.slow?.getTime() ?? 0 });
          },
        },
      ],
      {},
      { scheduler },
    );

    expect(interval).toHaveBeenCalledTimes(2);
    expect(ownerDocument.listenerCount()).toBe(2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    frames.shift()?.(1_000);
    expect(updates).toEqual([
      { name: 'ago', value: 1_000 },
      { name: 'slow', value: 1_000 },
    ]);

    vi.advanceTimersByTime(1_000);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    frames.shift()?.(2_000);
    expect(updates).toEqual([
      { name: 'ago', value: 1_000 },
      { name: 'slow', value: 1_000 },
      { name: 'ago', value: 2_000 },
    ]);

    vi.advanceTimersByTime(1_000);
    frames.shift()?.(3_000);
    expect(updates).toEqual([
      { name: 'ago', value: 1_000 },
      { name: 'slow', value: 1_000 },
      { name: 'ago', value: 2_000 },
      { name: 'ago', value: 3_000 },
      { name: 'slow', value: 3_000 },
    ]);

    disposeFirst();
    expect(ownerDocument.listenerCount()).toBe(2);
    disposeSecond();
    scheduler.dispose();
    expect(interval).toHaveBeenCalledTimes(3);
    expect(ownerDocument.listenerCount()).toBe(0);
  });

  it('ignores renderOnce clocks because server render owns the frozen value', () => {
    vi.useFakeTimers();
    const root = new FakeMorphRoot();
    const update = vi.fn();

    const dispose = installClockUpdatePlans(root, [
      { clocks: { pub: { every: '1s', renderOnce: true } }, update },
    ]);
    vi.advanceTimersByTime(1_000);

    expect(update).not.toHaveBeenCalled();
    dispose();
  });

  it('fires an immediate catch-up frame on visibilitychange to visible (K7)', () => {
    // K7 / SPEC freshness: a page backgrounded during the interval period stays
    // stale until the next interval fires. On visibilitychange→visible we must
    // schedule an immediate clock frame to catch up.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const frames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    const root = new FakeMorphRoot();
    const updates: number[] = [];

    const ownerDocument = createClockDocument();
    const scheduler = createClockScheduler({ ownerDocument });

    const dispose = installClockUpdatePlans(
      root,
      [
        {
          clocks: { ago: { every: '1s' } },
          update(_root, now) {
            updates.push(now.ago?.getTime() ?? 0);
          },
        },
      ],
      {},
      { scheduler },
    );

    // Drain the install-time frame (at t=1000).
    frames.shift()?.(1_000);
    expect(updates).toEqual([1_000]);

    // Advance fake timers by 2s — note: advanceTimersByTime also moves Date.now(),
    // so after this Date.now() returns 3000 (1000 + 2000).
    vi.advanceTimersByTime(2_000);
    // Drain all interval-triggered frames so framePending is false.
    while (frames.length > 0) frames.shift()?.(Date.now());

    // Capture the current time — this is what the catch-up frame should report.
    const catchUpTime = Date.now(); // 3000

    // Now framePending is false. The visibilitychange listener must schedule a new frame.
    const framesBefore = frames.length; // 0
    ownerDocument.dispatch('visibilitychange');
    expect(frames.length).toBe(framesBefore + 1);

    // Drain the catch-up frame — it must fire a clock update at the current time.
    frames.shift()?.(catchUpTime);
    expect(updates).toContain(catchUpTime);

    dispose();
    scheduler.dispose();
    // Listener is removed on dispose.
    expect(ownerDocument.listenerCount()).toBe(0);
  });

  it('isolates timers and visibility listeners across scheduler owner documents', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const firstDocument = createClockDocument();
    const secondDocument = createClockDocument();
    const firstScheduler = createClockScheduler({ ownerDocument: firstDocument });
    const secondScheduler = createClockScheduler({ ownerDocument: secondDocument });
    const firstRoot = new FakeMorphRoot();
    const secondRoot = new FakeMorphRoot();
    const firstUpdates: number[] = [];
    const secondUpdates: number[] = [];

    const disposeFirst = installClockUpdatePlans(
      firstRoot,
      [
        {
          clocks: { first: { every: '1s' } },
          update(_root, now) {
            firstUpdates.push(now.first?.getTime() ?? 0);
          },
        },
      ],
      {},
      { scheduler: firstScheduler },
    );
    const disposeSecond = installClockUpdatePlans(
      secondRoot,
      [
        {
          clocks: { second: { every: '1s' } },
          update(_root, now) {
            secondUpdates.push(now.second?.getTime() ?? 0);
          },
        },
      ],
      {},
      { scheduler: secondScheduler },
    );

    while (frames.length > 0) frames.shift()?.(Date.now());
    expect(firstUpdates).toEqual([10_000]);
    expect(secondUpdates).toEqual([10_000]);

    firstDocument.visibilityState = 'hidden';
    firstDocument.dispatch('visibilitychange');
    expect(frames).toHaveLength(0);

    secondDocument.dispatch('visibilitychange');
    expect(frames).toHaveLength(1);
    vi.setSystemTime(11_000);
    frames.shift()?.(11_000);
    expect(firstUpdates).toEqual([10_000]);
    expect(secondUpdates).toEqual([10_000, 11_000]);

    disposeFirst();
    firstScheduler.dispose();
    expect(firstDocument.listenerCount()).toBe(0);
    expect(secondDocument.listenerCount()).toBe(2);

    secondDocument.dispatch('visibilitychange');
    expect(frames).toHaveLength(1);
    disposeSecond();
    secondScheduler.dispose();
    expect(secondDocument.listenerCount()).toBe(0);
  });

  it('passes the query store to clock plans and records the current now input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const root = new FakeMorphRoot();
    const store = createQueryStore();
    const contexts: unknown[] = [];

    const dispose = installClockUpdatePlans(
      root,
      [
        {
          clocks: { ago: { every: '1s' } },
          update(_root, _now, context) {
            contexts.push(context.queryStore?.get('now'));
          },
        },
      ],
      { queryStore: store },
    );

    vi.advanceTimersByTime(0);

    expect(contexts).toEqual([{ ago: new Date(5_000) }]);
    expect(store.get('now')).toEqual({ ago: new Date(5_000) });
    dispose();
  });
});

function createClockDocument(): {
  dispatch(type: string): void;
  listenerCount(): number;
  visibilityState: 'hidden' | 'visible';
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
} {
  const listeners = new Map<string, Set<EventListener>>();

  return {
    visibilityState: 'visible',
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set<EventListener>();
      current.add(listener);
      listeners.set(type, current);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener({ type } as Event);
    },
    listenerCount() {
      return [...listeners.values()].reduce((count, current) => count + current.size, 0);
    },
    removeEventListener(type, listener) {
      const current = listeners.get(type);
      current?.delete(listener);
      if (current?.size === 0) listeners.delete(type);
    },
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installClockUpdatePlans } from './clock-tick-bus.js';
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

    const disposeFirst = installClockUpdatePlans(root, [
      {
        clocks: { ago: { every: '1s' } },
        update(_root, now) {
          updates.push({ name: 'ago', value: now.ago?.getTime() ?? 0 });
        },
      },
    ]);
    const disposeSecond = installClockUpdatePlans(root, [
      {
        clocks: { slow: { every: '2s' } },
        update(_root, now) {
          updates.push({ name: 'slow', value: now.slow?.getTime() ?? 0 });
        },
      },
    ]);

    expect(interval).toHaveBeenCalledTimes(2);
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
    disposeSecond();
    expect(interval).toHaveBeenCalledTimes(3);
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

    // Stub document.addEventListener/removeEventListener to capture visibility listeners.
    const listeners = new Map<string, EventListener>();
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    });

    const dispose = installClockUpdatePlans(root, [
      {
        clocks: { ago: { every: '1s' } },
        update(_root, now) {
          updates.push(now.ago?.getTime() ?? 0);
        },
      },
    ]);

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
    listeners.get('visibilitychange')?.({} as Event);
    expect(frames.length).toBe(framesBefore + 1);

    // Drain the catch-up frame — it must fire a clock update at the current time.
    frames.shift()?.(catchUpTime);
    expect(updates).toContain(catchUpTime);

    dispose();
    // Listener is removed on dispose.
    expect(listeners.has('visibilitychange')).toBe(false);
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

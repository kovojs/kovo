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

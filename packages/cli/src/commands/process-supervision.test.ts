import { describe, expect, it, vi } from 'vitest';

import { superviseKovoCliSessionParent } from './process-supervision.js';

describe('long-lived CLI session parent supervision (plans/good-perf.md O6)', () => {
  it('aborts the session signal when the parent pid changes (orphan reparenting)', async () => {
    let parentPid = 4_242;
    const onOrphaned = vi.fn();
    const supervision = superviseKovoCliSessionParent({
      onOrphaned,
      pollIntervalMs: 25,
      readParentPid: () => parentPid,
    });
    try {
      expect(supervision.signal.aborted).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(supervision.signal.aborted).toBe(false);

      // The invoking parent dies; the orphan is reparented to launchd/init (pid 1).
      parentPid = 1;
      await vi.waitFor(() => expect(supervision.signal.aborted).toBe(true));
      expect(onOrphaned).toHaveBeenCalledTimes(1);
      expect(onOrphaned.mock.calls[0]![0]).toContain('parent process (pid 4242) is gone');

      // Idempotent after the first orphan verdict.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(onOrphaned).toHaveBeenCalledTimes(1);
    } finally {
      supervision.close();
    }
  });

  it('close() stops polling so an ordinary shutdown never reports an orphan', async () => {
    let parentPid = 4_242;
    const onOrphaned = vi.fn();
    const supervision = superviseKovoCliSessionParent({
      onOrphaned,
      pollIntervalMs: 25,
      readParentPid: () => parentPid,
    });
    supervision.close();
    parentPid = 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(supervision.signal.aborted).toBe(false);
    expect(onOrphaned).not.toHaveBeenCalled();
  });

  it('a still-alive parent never trips supervision', async () => {
    const supervision = superviseKovoCliSessionParent({ pollIntervalMs: 25 });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(supervision.signal.aborted).toBe(false);
    } finally {
      supervision.close();
    }
  });

  it('rejects an out-of-range poll interval', () => {
    expect(() => superviseKovoCliSessionParent({ pollIntervalMs: 5 })).toThrow(
      /pollIntervalMs must be 25\.\.60000/u,
    );
  });
});

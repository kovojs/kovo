import { describe, expect, it, vi } from 'vitest';

import { s } from './schema.js';
import { task } from './task.js';
import { createDurableTaskRunner } from './task-runner.js';
import { MemoryDurableTaskQueue } from './task-queue.js';

describe('durable task runner (SPEC §9.6)', () => {
  it('resolves tasks by key and invokes run(args, ctx) with job context', async () => {
    const store = new MemoryDurableTaskQueue();
    const run = vi.fn(async () => undefined);
    const sendEmail = task('email.send', {
      input: s.object({ orderId: s.string() }),
      run,
    });
    const handle = await store.enqueue({
      task: sendEmail.key,
      args: { orderId: 'ord_1' },
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    const runner = createDurableTaskRunner({
      store,
      tasks: [sendEmail],
      batchSize: 1,
      leaseMs: 10_000,
      owner: 'runner-1',
      hooks: {
        fetch: vi.fn() as unknown as typeof fetch,
        runMutation: vi.fn(async () => ({ ok: true })),
        runQuery: vi.fn(async () => ({ ok: true })),
      },
    });

    const claimed = await runner.runOnce(new Date('2026-06-30T10:00:01.000Z'));

    expect(claimed).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ orderId: 'ord_1' });
    expect(run.mock.calls[0]![1]).toMatchObject({ jobId: handle.id });
    expect(store.snapshot()[0]).toMatchObject({ id: handle.id, status: 'succeeded' });
  });

  it('marks unknown task keys failed instead of dropping the claimed job', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({ task: 'missing.task', args: {} });
    const runner = createDurableTaskRunner({ store, tasks: [] });

    await runner.runOnce(new Date());

    expect(store.snapshot()[0]).toMatchObject({
      id: handle.id,
      status: 'failed',
      lastError: 'No durable task is registered for key "missing.task".',
    });
  });

  it('lets a task schedule follow-on work through the queue-backed context helper', async () => {
    const store = new MemoryDurableTaskQueue();
    const child = task('child.task', {
      input: s.object({ parent: s.string() }),
      run: vi.fn(),
    });
    const parent = task('parent.task', {
      input: s.object({ id: s.string() }),
      async run(args, ctx) {
        await ctx.schedule(
          child,
          { parent: args.id },
          { key: `child:${args.id}`, coalesce: 'throttle' },
        );
      },
    });
    await store.enqueue({ task: parent.key, args: { id: 'p1' } });
    const runner = createDurableTaskRunner({ store, tasks: [parent, child] });

    await runner.runOnce(new Date());

    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task: 'parent.task', status: 'succeeded' }),
        expect.objectContaining({
          task: 'child.task',
          args: { parent: 'p1' },
          key: 'child:p1',
          status: 'ready',
        }),
      ]),
    );
  });

  it('is stoppable when started as a polling helper', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryDurableTaskQueue();
      const runner = createDurableTaskRunner({ store, tasks: [], pollIntervalMs: 1000 });

      runner.start();
      await vi.runOnlyPendingTimersAsync();
      await runner.stop();

      expect(store.snapshot()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

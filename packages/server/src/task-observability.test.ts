import { describe, expect, it } from 'vitest';

import {
  createDurableTaskStatus,
  type DurableTaskStatusSqlStatement,
} from './task-observability.js';
import { MemoryDurableTaskQueue } from './task-queue.js';

describe('durable task observability (SPEC §9.6)', () => {
  it('lists failed jobs without exposing serialized args by default', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({
      args: { email: 'buyer@example.test', token: 'secret-token' },
      task: 'email.send',
    });
    const [claimed] = await store.claimDue({ leaseMs: 1000, limit: 1, now: new Date() });
    await store.markFailed(claimed!.id, new Error('smtp down'));

    const status = createDurableTaskStatus(store);

    await expect(status.get(handle)).resolves.toMatchObject({
      id: handle.id,
      task: 'email.send',
      status: 'failed',
      attempts: 1,
      lastError: 'smtp down',
    });
    expect(await status.get(handle)).not.toHaveProperty('args');
  });

  it('exposes args only when inspection callers explicitly opt in', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({
      args: { orderId: 'ord_1' },
      task: 'email.send',
    });

    const record = await createDurableTaskStatus(store).get(handle, { includeArgs: true });

    expect(record).toMatchObject({
      args: { orderId: 'ord_1' },
      id: handle.id,
      status: 'ready',
    });
  });

  it('filters failed and dead-lettered jobs for operator triage', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const status = createDurableTaskStatus({
      snapshot: () => [
        {
          args: {},
          attempts: 1,
          createdAt: now,
          id: 'job_succeeded',
          runAt: now,
          status: 'succeeded',
          task: 'email.send',
          updatedAt: now,
        },
        {
          args: {},
          attempts: 2,
          createdAt: now,
          id: 'job_failed',
          lastError: 'transient',
          runAt: now,
          status: 'failed',
          task: 'billing.charge',
          updatedAt: new Date('2026-06-30T10:01:00.000Z'),
        },
        {
          args: {},
          attempts: 3,
          createdAt: now,
          id: 'job_dead',
          lastError: 'max attempts exhausted',
          runAt: now,
          status: 'dead',
          task: 'billing.charge',
          updatedAt: new Date('2026-06-30T10:02:00.000Z'),
        },
      ],
    });

    const failures = await status.listFailures({ task: 'billing.charge' });

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'dead', lastError: 'max attempts exhausted' }),
        expect.objectContaining({ status: 'failed', lastError: 'transient' }),
      ]),
    );
  });

  it('queries a Postgres-compatible executor with parameterized filters', async () => {
    const statements: DurableTaskStatusSqlStatement[] = [];
    const status = createDurableTaskStatus({
      async execute(statement) {
        statements.push(statement);
        return {
          rows: [
            {
              attempts: 2,
              args: { redacted: 'unless requested' },
              created_at: '2026-06-30T10:00:00.000Z',
              id: 'job_1',
              last_error: 'boom',
              lease_owner: null,
              leased_until: null,
              logical_key: 'order-1',
              run_at: '2026-06-30T10:00:00.000Z',
              status: 'dead',
              task_key: 'email.send',
              updated_at: '2026-06-30T10:01:00.000Z',
            },
          ],
        };
      },
    });

    await expect(status.listFailures({ limit: 5, task: 'email.send' })).resolves.toEqual([
      expect.objectContaining({
        id: 'job_1',
        key: 'order-1',
        lastError: 'boom',
        status: 'dead',
      }),
    ]);
    expect(statements[0]!.text).toContain('task_key = $1');
    expect(statements[0]!.text).toContain('status = any($2::text[])');
    expect(statements[0]!.text).toContain('limit $3 offset $4');
    expect(statements[0]!.values).toEqual(['email.send', ['failed', 'dead'], 5, 0]);
  });
});

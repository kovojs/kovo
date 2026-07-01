import { describe, expect, it } from 'vitest';

import {
  createDurableTaskStatus,
  type DurableTaskStatusSqlStatement,
} from './task-observability.js';
import { MemoryDurableTaskQueue } from './task-queue.js';

describe('durable task observability (SPEC §9.6)', () => {
  it('lists dead-lettered jobs without exposing serialized args or errors by default', async () => {
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
      status: 'dead',
      attempts: 1,
    });
    const redacted = await status.get(handle);
    expect(redacted).not.toHaveProperty('args');
    expect(redacted).not.toHaveProperty('lastError');
  });

  it('exposes args and errors only when inspection callers explicitly opt in', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({
      args: { orderId: 'ord_1' },
      task: 'email.send',
    });
    const [claimed] = await store.claimDue({ leaseMs: 1000, limit: 1, now: new Date() });
    await store.markFailed(claimed!.id, new Error('provider token abc123 failed'));

    const record = await createDurableTaskStatus(store).get(handle, { includeArgs: true });

    expect(record).toMatchObject({
      args: { orderId: 'ord_1' },
      id: handle.id,
      lastError: 'provider token abc123 failed',
      status: 'dead',
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
        expect.objectContaining({ id: 'job_dead', status: 'dead' }),
        expect.objectContaining({ id: 'job_failed', status: 'failed' }),
      ]),
    );
    for (const failure of failures) expect(failure).not.toHaveProperty('lastError');

    await expect(
      status.listFailures({ includeArgs: true, task: 'billing.charge' }),
    ).resolves.toEqual(
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
        status: 'dead',
      }),
    ]);
    const [redacted] = await status.listFailures({ limit: 5, task: 'email.send' });
    expect(redacted).not.toHaveProperty('args');
    expect(redacted).not.toHaveProperty('lastError');
    expect(statements[0]!.text).toContain('task_key = $1');
    expect(statements[0]!.text).toContain('status = any($2::text[])');
    expect(statements[0]!.text).toContain('limit $3 offset $4');
    expect(statements[0]!.values).toEqual(['email.send', ['failed', 'dead'], 5, 0]);
  });
});

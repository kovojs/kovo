import { describe, expect, it } from 'vitest';

import {
  KOVO_JOBS_TABLE_SQL,
  MemoryDurableTaskQueue,
  PostgresDurableTaskQueue,
  createDurableTaskSqlExecutor,
  ensureDurableTaskSchema,
  type DurableTaskSqlExecutor,
  type DurableTaskSqlStatement,
} from './task-queue.js';

describe('durable task queue store (SPEC §9.6)', () => {
  it('exposes a persistent Postgres-compatible _kovo_jobs schema through statement carriers', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const executor: DurableTaskSqlExecutor = {
      async execute(statement) {
        statements.push(statement);
        return { rows: [] };
      },
    };

    await ensureDurableTaskSchema(executor);

    expect(statements).toHaveLength(KOVO_JOBS_TABLE_SQL.length);
    expect(statements[0]!.text).toContain('create table if not exists _kovo_jobs');
    expect(statements[0]!.text).toContain('args jsonb not null');
    expect(statements[0]!.text).toContain('leased_until timestamptz null');
    expect(statements[1]!.text).toContain("where status = 'ready'");
    expect(statements.every((statement) => Array.isArray(statement.values))).toBe(true);
  });

  it('debounces keyed ready jobs by replacing args and run_at', async () => {
    const store = new MemoryDurableTaskQueue();
    const firstRunAt = new Date('2026-06-30T10:00:00.000Z');
    const secondRunAt = new Date('2026-06-30T11:00:00.000Z');

    const first = await store.enqueue({
      task: 'email.send',
      args: { orderId: 'old' },
      runAt: firstRunAt,
      key: 'order-1',
    });
    const second = await store.enqueue({
      task: 'email.send',
      args: { orderId: 'new' },
      runAt: secondRunAt,
      key: 'order-1',
    });

    expect(second.id).toBe(first.id);
    expect(store.snapshot()).toMatchObject([
      {
        id: first.id,
        task: 'email.send',
        args: { orderId: 'new' },
        runAt: secondRunAt,
        key: 'order-1',
        status: 'ready',
        attempts: 0,
      },
    ]);
  });

  it('throttles keyed ready jobs by keeping the first args and run_at', async () => {
    const store = new MemoryDurableTaskQueue();
    const firstRunAt = new Date('2026-06-30T10:00:00.000Z');
    const secondRunAt = new Date('2026-06-30T11:00:00.000Z');

    const first = await store.enqueue({
      task: 'email.send',
      args: { orderId: 'first' },
      runAt: firstRunAt,
      key: 'order-1',
      coalesce: 'throttle',
    });
    const second = await store.enqueue({
      task: 'email.send',
      args: { orderId: 'second' },
      runAt: secondRunAt,
      key: 'order-1',
      coalesce: 'throttle',
    });

    expect(second.id).toBe(first.id);
    expect(store.snapshot()[0]).toMatchObject({
      id: first.id,
      args: { orderId: 'first' },
      runAt: firstRunAt,
      status: 'ready',
    });
  });

  it('cancels only still-ready jobs', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({ task: 'email.send', args: { orderId: '1' } });

    await expect(store.cancel(handle)).resolves.toBe(true);
    await expect(store.cancel(handle)).resolves.toBe(false);
    expect(store.snapshot()[0]!.status).toBe('cancelled');
  });

  it('claims due jobs with leases and reaps expired leases back to ready', async () => {
    const store = new MemoryDurableTaskQueue();
    const due = new Date('2026-06-30T10:00:00.000Z');
    const later = new Date('2026-06-30T10:05:00.000Z');
    await store.enqueue({ task: 'due', args: { n: 1 }, runAt: due });
    await store.enqueue({ task: 'later', args: { n: 2 }, runAt: later });

    const claimed = await store.claimDue({
      now: new Date('2026-06-30T10:00:01.000Z'),
      limit: 10,
      leaseMs: 30_000,
      owner: 'test-runner',
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      task: 'due',
      status: 'running',
      attempts: 1,
      leaseOwner: 'test-runner',
    });
    expect(claimed[0]!.leasedUntil).toEqual(new Date('2026-06-30T10:00:31.000Z'));

    await expect(store.reapExpiredLeases(new Date('2026-06-30T10:00:30.999Z'))).resolves.toBe(0);
    await expect(store.reapExpiredLeases(new Date('2026-06-30T10:00:31.000Z'))).resolves.toBe(1);
    const reaped = store.snapshot().find((job) => job.task === 'due');
    expect(reaped).toMatchObject({
      status: 'ready',
      attempts: 1,
    });
    expect(reaped).not.toHaveProperty('leasedUntil');
    expect(reaped).not.toHaveProperty('leaseOwner');
  });

  it('keeps SQL execution parameterized when enqueuing and claiming through Postgres adapter', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const executor: DurableTaskSqlExecutor = {
      async execute(statement) {
        statements.push(statement);
        if (statement.text.includes('returning id')) return { rows: [{ id: statement.values[0] }] };
        return { rows: [] };
      },
    };
    const store = new PostgresDurableTaskQueue(executor);

    const handle = await store.enqueue({
      task: 'email.send',
      args: { orderId: 'ord_1' },
      key: 'order-1',
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    await store.claimDue({ limit: 1, leaseMs: 10_000, now: new Date(), owner: 'runner-1' });

    expect(handle.task).toBe('email.send');
    expect(statements[0]!.text).toContain('$1');
    expect(statements[0]!.values).toEqual([
      handle.id,
      'email.send',
      JSON.stringify({ orderId: 'ord_1' }),
      'order-1',
      new Date('2026-06-30T10:00:00.000Z'),
      expect.any(Date),
    ]);
    expect(statements[1]!.text).toContain('for update skip locked');
    expect(statements[1]!.values).toHaveLength(4);
  });

  it('adapts a root Postgres-compatible client query(text, values)', async () => {
    const calls: unknown[][] = [];
    const executor = createDurableTaskSqlExecutor({
      $client: {
        async query(text: string, values: readonly unknown[]) {
          calls.push([text, values]);
          return { affectedRows: 1, rows: [{ id: values[0] }] };
        },
      },
    });

    const result = await executor.execute({ text: 'select $1::text as id', values: ['job_1'] });

    expect(result).toEqual({ rowCount: 1, rows: [{ id: 'job_1' }] });
    expect(calls).toEqual([['select $1::text as id', ['job_1']]]);
  });

  it('adapts a Drizzle PGlite transaction session client before proxied top-level handles', async () => {
    const sessionCalls: unknown[][] = [];
    const topLevelCalls: unknown[][] = [];
    const executor = createDurableTaskSqlExecutor({
      query: async (text: string, values: readonly unknown[]) => {
        topLevelCalls.push([text, values]);
        return { rows: [] };
      },
      session: {
        client: {
          async query(text: string, values: readonly unknown[]) {
            sessionCalls.push([text, values]);
            return { rows: [{ ok: true }] };
          },
        },
      },
    });

    await expect(executor.execute({ text: 'insert into _kovo_jobs values ($1)', values: ['id'] }))
      .resolves.toEqual({ rows: [{ ok: true }] });
    expect(sessionCalls).toEqual([['insert into _kovo_jobs values ($1)', ['id']]]);
    expect(topLevelCalls).toEqual([]);
  });
});

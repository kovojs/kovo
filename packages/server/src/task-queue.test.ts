import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  KOVO_JOBS_TABLE_SQL,
  MemoryDurableTaskQueue,
  PostgresDurableTaskQueue,
  createDurableTaskSqlExecutor,
  ensureDurableTaskSchema,
  type DurableTaskSqlExecutor,
  type DurableTaskSqlStatement,
} from './task-queue.js';
import { managedDb } from './managed-db.js';

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
    expect(statements[0]!.text).toContain("'dead'");
    expect(statements[0]!.text).toContain('priority integer not null default 0');
    expect(statements[0]!.text).toContain('lease_token text null');
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
      lineage: first.id,
      generation: 0,
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
      lineage: claimed[0]!.id,
    });
    expect(claimed[0]!.leaseToken).toEqual(expect.any(String));
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
    expect(reaped).not.toHaveProperty('leaseToken');
  });

  it('orders claims by priority lane before run_at and supports task filters', async () => {
    const store = new MemoryDurableTaskQueue();
    const now = new Date('2026-06-30T10:00:00.000Z');
    await store.enqueue({ task: 'low', args: {}, runAt: now, priority: 1 });
    await store.enqueue({ task: 'high', args: {}, runAt: now, priority: 10 });
    await store.enqueue({ task: 'blocked', args: {}, runAt: now, priority: 99 });

    const claimed = await store.claimDue({
      now,
      limit: 2,
      leaseMs: 30_000,
      taskKeys: ['low', 'high'],
    });

    expect(claimed.map((job) => job.task)).toEqual(['high', 'low']);
  });

  it('retries failed jobs with backoff until maxAttempts moves them to dead-letter', async () => {
    const store = new MemoryDurableTaskQueue();
    await store.enqueue({ task: 'flaky', args: {}, runAt: new Date('2026-06-30T10:00:00.000Z') });
    const [first] = await store.claimDue({
      now: new Date('2026-06-30T10:00:00.000Z'),
      limit: 1,
      leaseMs: 30_000,
      owner: 'runner-1',
    });

    await expect(
      store.markFailed(first!.id, new Error('try again'), {
        leaseOwner: first!.leaseOwner,
        leaseToken: first!.leaseToken,
        maxAttempts: 2,
        retryAt: new Date('2026-06-30T10:00:05.000Z'),
        now: new Date('2026-06-30T10:00:01.000Z'),
      }),
    ).resolves.toBe(true);
    expect(store.snapshot()[0]).toMatchObject({
      status: 'ready',
      attempts: 1,
      runAt: new Date('2026-06-30T10:00:05.000Z'),
      lastError: 'try again',
    });

    const [second] = await store.claimDue({
      now: new Date('2026-06-30T10:00:05.000Z'),
      limit: 1,
      leaseMs: 30_000,
      owner: 'runner-1',
    });
    await expect(
      store.markFailed(second!.id, 'permanent', {
        leaseOwner: second!.leaseOwner,
        leaseToken: second!.leaseToken,
        maxAttempts: 2,
        now: new Date('2026-06-30T10:00:06.000Z'),
      }),
    ).resolves.toBe(true);
    expect(store.snapshot()[0]).toMatchObject({
      status: 'dead',
      attempts: 2,
      lastError: 'permanent',
    });
  });

  it('rejects stale duplicate completions after a lease has been reclaimed', async () => {
    const store = new MemoryDurableTaskQueue();
    await store.enqueue({ task: 'effect', args: {}, runAt: new Date('2026-06-30T10:00:00.000Z') });
    const [first] = await store.claimDue({
      now: new Date('2026-06-30T10:00:00.000Z'),
      limit: 1,
      leaseMs: 1000,
      owner: 'runner-old',
    });
    await store.reapExpiredLeases(new Date('2026-06-30T10:00:01.000Z'));
    const [second] = await store.claimDue({
      now: new Date('2026-06-30T10:00:01.000Z'),
      limit: 1,
      leaseMs: 1000,
      owner: 'runner-new',
    });

    await expect(
      store.markSucceeded(first!.id, {
        leaseOwner: first!.leaseOwner,
        leaseToken: first!.leaseToken,
        now: new Date('2026-06-30T10:00:01.100Z'),
      }),
    ).resolves.toBe(false);
    await expect(
      store.markSucceeded(second!.id, {
        leaseOwner: second!.leaseOwner,
        leaseToken: second!.leaseToken,
        now: new Date('2026-06-30T10:00:01.200Z'),
      }),
    ).resolves.toBe(true);
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
      handle.id,
      0,
      0,
      'ready',
      null,
    ]);
    expect(statements[1]!.text).toContain('for update skip locked');
    expect(statements[1]!.values).toHaveLength(6);
  });

  it('canonicalizes durable task args before Postgres storage', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const store = new PostgresDurableTaskQueue({
      async execute(statement) {
        statements.push(statement);
        return { rows: [{ id: statement.values[0] }] };
      },
    });

    await store.enqueue({
      args: { z: 1, a: { y: 2, x: 1 } },
      task: 'email.send',
    });

    expect(statements[0]!.values[2]).toBe('{"a":{"x":1,"y":2},"z":1}');
  });

  it('scrubs secret-tagged args and initial errors before Postgres _kovo_jobs storage', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const store = new PostgresDurableTaskQueue({
      async execute(statement) {
        statements.push(statement);
        return { rows: [{ id: statement.values[0] }] };
      },
    });

    await store.enqueue({
      args: { publicId: 'order_1', token: secret('sk_live_q5_pg_args') },
      lastError: secret('sk_live_q5_pg_initial_error') as unknown as string,
      task: 'email.send',
    });

    expect(statements[0]!.values[2]).toBe('{"publicId":"order_1","token":"[secret]"}');
    expect(statements[0]!.values[10]).toBe('[secret]');
    expect(JSON.stringify(statements)).not.toContain('sk_live_q5_pg');
  });

  it('scrubs secret-tagged args and failure text before in-memory task storage', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({
      args: { publicId: 'order_1', token: secret('sk_live_q5_memory_args') },
      task: 'email.send',
    });
    const [job] = await store.claimDue({ leaseMs: 1000, limit: 1, now: new Date() });

    await store.markFailed(job!.id, secret('sk_live_q5_memory_error'));

    expect(handle.task).toBe('email.send');
    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        args: { publicId: 'order_1', token: '[secret]' },
        lastError: '[secret]',
      }),
    ]);
    expect(JSON.stringify(store.snapshot())).not.toContain('sk_live_q5_memory');
  });

  it('rejects lossy durable task args before queue storage', async () => {
    const store = new MemoryDurableTaskQueue();
    const cases: readonly [unknown, string][] = [
      [{ id: undefined }, 'JSON value at args.id must not be undefined'],
      [{ id: 1n }, 'JSON value at args.id must not be a bigint'],
      [
        { at: new Date('2026-06-30T00:00:00.000Z') },
        'JSON value at args.at must be a plain JSON object',
      ],
      [
        { count: Number.POSITIVE_INFINITY },
        'JSON value at args.count must be a finite JSON number',
      ],
    ];

    for (const [args, message] of cases) {
      await expect(store.enqueue({ args, task: 'bad' })).rejects.toThrow(message);
    }
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

    await expect(
      executor.execute({ text: 'insert into _kovo_jobs values ($1)', values: ['id'] }),
    ).resolves.toEqual({ rows: [{ ok: true }] });
    expect(sessionCalls).toEqual([['insert into _kovo_jobs values ($1)', ['id']]]);
    expect(topLevelCalls).toEqual([]);
  });

  it('unwraps framework-managed mutation handles for internal durable queue SQL only', async () => {
    const sessionCalls: unknown[][] = [];
    const topLevelCalls: unknown[][] = [];
    const raw = {
      query: async (text: string, values: readonly unknown[]) => {
        topLevelCalls.push([text, values]);
        return { rows: [] };
      },
      session: {
        client: {
          async query(text: string, values: readonly unknown[]) {
            sessionCalls.push([text, values]);
            return { affectedRows: 1, rows: [{ id: values[0] }] };
          },
        },
      },
    };
    const managed = managedDb(raw, 'write', {
      sqlWritePolicy: {
        tables: ['contacts'],
        touches: ['contact'],
      },
    });

    expect(() =>
      (managed as { query(statement: unknown): unknown }).query('insert into users values (1)'),
    ).toThrow(/KV422/);

    const executor = createDurableTaskSqlExecutor(managed);
    const result = await executor.execute({
      text: 'insert into _kovo_jobs (id) values ($1) returning id',
      values: ['job_1'],
    });

    expect(result).toEqual({ rowCount: 1, rows: [{ id: 'job_1' }] });
    expect(sessionCalls).toEqual([
      ['insert into _kovo_jobs (id) values ($1) returning id', ['job_1']],
    ]);
    expect(topLevelCalls).toEqual([]);
  });
});

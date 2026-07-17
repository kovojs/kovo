import { describe, expect, it } from 'vitest';
import { secret } from '@kovojs/core';

import {
  createDurableTaskStatus,
  type DurableTaskStatusSqlStatement,
} from './task-observability.js';
import { MemoryDurableTaskQueue } from './task-queue.js';

describe('durable task observability (SPEC §9.6)', () => {
  it('normalizes status filters without inherited numeric setter dispatch', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const jobs = [
      {
        args: {},
        attempts: 1,
        createdAt: now,
        id: 'setter-proof',
        runAt: now,
        status: 'ready' as const,
        task: 'setter.proof',
        updatedAt: now,
      },
    ];
    const filters = { status: ['ready'] as const };
    const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let inheritedSetterCalls = 0;
    let result: Promise<unknown>;
    try {
      Object.defineProperty(Array.prototype, '0', {
        configurable: true,
        set() {
          inheritedSetterCalls += 1;
        },
      });
      result = createDurableTaskStatus({ snapshot: () => jobs }).list(filters);
    } finally {
      if (previous === undefined) delete (Array.prototype as { 0?: unknown })[0];
      else Object.defineProperty(Array.prototype, '0', previous);
    }

    await expect(result!).resolves.toEqual([
      expect.objectContaining({ id: 'setter-proof', status: 'ready' }),
    ]);
    expect(inheritedSetterCalls).toBe(0);
  });

  it('pins the status source, exact filters, dates, and ordering after late poisoning', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const source = {
      snapshot: () => [
        {
          args: {},
          attempts: 1,
          createdAt: now,
          id: 'ordinary',
          runAt: now,
          status: 'ready' as const,
          task: 'ordinary.task',
          updatedAt: now,
        },
        {
          args: {},
          attempts: 1,
          createdAt: now,
          id: 'privileged',
          runAt: now,
          status: 'dead' as const,
          task: 'privileged.task',
          updatedAt: new Date('2026-06-30T10:01:00.000Z'),
        },
      ],
    };
    const status = createDurableTaskStatus(source);
    const originalDateGetTime = Date.prototype.getTime;
    const originalSetHas = Set.prototype.has;
    const originalArraySlice = Array.prototype.slice;
    const originalArraySort = Array.prototype.sort;
    let records;
    try {
      source.snapshot = () => [];
      Date.prototype.getTime = () => 0;
      Set.prototype.has = () => true;
      Array.prototype.slice = () => [];
      Array.prototype.sort = function () {
        return this;
      };
      records = await status.list({ ids: ['ordinary'], task: 'ordinary.task' });
    } finally {
      Date.prototype.getTime = originalDateGetTime;
      Set.prototype.has = originalSetHas;
      Array.prototype.slice = originalArraySlice;
      Array.prototype.sort = originalArraySort;
    }

    expect(records).toEqual([
      expect.objectContaining({ id: 'ordinary', status: 'ready', task: 'ordinary.task' }),
    ]);
  });

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

  it('scrubs secret-tagged values even on explicit task-status diagnostics reads', async () => {
    const status = createDurableTaskStatus({
      snapshot: () => [
        {
          args: { orderId: 'ord_1', token: secret('sk_live_q5_status_args') },
          attempts: 1,
          createdAt: new Date('2026-06-30T10:00:00.000Z'),
          id: 'job_secret',
          lastError: secret('sk_live_q5_status_error') as unknown as string,
          runAt: new Date('2026-06-30T10:00:00.000Z'),
          status: 'dead',
          task: 'email.send',
          updatedAt: new Date('2026-06-30T10:01:00.000Z'),
        },
      ],
    });

    const record = await status.get('job_secret', { includeArgs: true });

    expect(record).toMatchObject({
      args: { orderId: 'ord_1', token: '[secret]' },
      lastError: '[secret]',
    });
    expect(JSON.stringify(record)).not.toContain('sk_live_q5_status');
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
    expect(statements[0]!.text).toContain('NULL AS args');
    expect(statements[0]!.text).toContain('NULL AS last_error');
    expect(statements[0]!.values).toEqual(['email.send', ['failed', 'dead'], 5, 0]);
  });

  it('bounds operator selectors and pagination before invoking the SQL executor', async () => {
    let executeCalls = 0;
    const status = createDurableTaskStatus({
      async execute() {
        executeCalls += 1;
        return { rows: [] };
      },
    });

    await expect(status.get('')).rejects.toThrow(/handle id must be 1\.\.4096/u);
    await expect(
      status.list({ ids: Array.from({ length: 101 }, (_, index) => `job_${index}`) }),
    ).rejects.toThrow(/ids may contain at most 100/u);
    await expect(status.list({ ids: ['x'.repeat(4_097)] })).rejects.toThrow(
      /ids\[0\] must be 1\.\.4096/u,
    );
    await expect(status.list({ task: 'x'.repeat(4_097) })).rejects.toThrow(
      /task must be 1\.\.4096/u,
    );
    await expect(status.list({ limit: 1_001 })).rejects.toThrow(/limit.*0 through 1000/u);
    await expect(status.list({ limit: -1 })).rejects.toThrow(/limit.*0 through 1000/u);
    await expect(status.list({ offset: 100_001 })).rejects.toThrow(/offset.*0 through 100000/u);
    await expect(
      status.list({ status: Array.from({ length: 7 }, () => 'ready') as never }),
    ).rejects.toThrow(/at most 6 statuses/u);
    expect(executeCalls).toBe(0);
  });

  it('preserves an explicit zero-row SQL limit', async () => {
    const statements: DurableTaskStatusSqlStatement[] = [];
    const status = createDurableTaskStatus({
      async execute(statement) {
        statements.push(statement);
        return { rows: [] };
      },
    });

    await expect(status.list({ limit: 0 })).resolves.toEqual([]);
    expect(statements[0]!.values).toEqual([0, 0]);
  });

  it('rejects accessor-backed SQL rows without invoking the getter', async () => {
    let rowReads = 0;
    const status = createDurableTaskStatus({
      async execute() {
        const result = {} as { rows?: unknown[] };
        Object.defineProperty(result, 'rows', {
          get() {
            rowReads += 1;
            return [];
          },
        });
        return result as { rows: never[] };
      },
    });

    await expect(status.list()).rejects.toThrow(/rows.*own data/u);
    expect(rowReads).toBe(0);
  });

  it('does not touch redacted SQL args or error accessors', async () => {
    let secretReads = 0;
    const row = {
      attempts: 1,
      created_at: '2026-06-30T10:00:00.000Z',
      id: 'job_sql_redacted_accessors',
      lease_owner: null,
      leased_until: null,
      logical_key: null,
      run_at: '2026-06-30T10:00:00.000Z',
      status: 'dead',
      task_key: 'email.send',
      updated_at: '2026-06-30T10:01:00.000Z',
    } as Record<string, unknown>;
    for (const property of ['args', 'last_error']) {
      Object.defineProperty(row, property, {
        get() {
          secretReads += 1;
          return property === 'args' ? { token: 'customer-secret' } : 'provider-secret';
        },
      });
    }
    const status = createDurableTaskStatus({
      async execute() {
        return { rows: [row as never] };
      },
    });

    await expect(status.list()).resolves.toEqual([
      expect.objectContaining({ id: 'job_sql_redacted_accessors', status: 'dead' }),
    ]);
    expect(secretReads).toBe(0);
  });

  it('pins redaction filters before awaiting an app-owned SQL executor', async () => {
    const filters = { includeArgs: false };
    const status = createDurableTaskStatus({
      async execute() {
        filters.includeArgs = true;
        return {
          rows: [
            {
              attempts: 1,
              args: { token: 'customer-secret' },
              created_at: '2026-06-30T10:00:00.000Z',
              id: 'job_filter_race',
              last_error: 'provider-secret',
              lease_owner: null,
              leased_until: null,
              logical_key: null,
              run_at: '2026-06-30T10:00:00.000Z',
              status: 'dead',
              task_key: 'email.send',
              updated_at: '2026-06-30T10:01:00.000Z',
            },
          ],
        };
      },
    });

    const [record] = await status.list(filters);

    expect(record).not.toHaveProperty('args');
    expect(record).not.toHaveProperty('lastError');
  });

  it('rejects accessor-backed snapshot job authority without invoking it', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    let taskReads = 0;
    const job = {
      args: {},
      attempts: 1,
      createdAt: now,
      id: 'job_accessor',
      runAt: now,
      status: 'ready' as const,
      updatedAt: now,
    } as Record<string, unknown>;
    Object.defineProperty(job, 'task', {
      get() {
        taskReads += 1;
        return taskReads === 1 ? 'public.task' : 'private.task';
      },
    });
    const status = createDurableTaskStatus({ snapshot: () => [job as never] });

    await expect(status.list({ task: 'public.task' })).rejects.toThrow(/task.*own data/u);
    expect(taskReads).toBe(0);
  });

  it('does not read redacted snapshot args or errors', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    let secretReads = 0;
    const job = {
      attempts: 1,
      createdAt: now,
      id: 'job_redacted_accessors',
      runAt: now,
      status: 'dead' as const,
      task: 'email.send',
      updatedAt: now,
    } as Record<string, unknown>;
    for (const property of ['args', 'lastError']) {
      Object.defineProperty(job, property, {
        get() {
          secretReads += 1;
          return property === 'args' ? { token: 'customer-secret' } : 'provider-secret';
        },
      });
    }
    const status = createDurableTaskStatus({ snapshot: () => [job as never] });

    await expect(status.list()).resolves.toEqual([
      expect.objectContaining({ id: 'job_redacted_accessors', status: 'dead' }),
    ]);
    expect(secretReads).toBe(0);
  });

  it('rejects includeArgs accessors without invoking or granting disclosure', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const status = createDurableTaskStatus({
      snapshot: () => [
        {
          args: { token: 'customer-secret' },
          attempts: 1,
          createdAt: now,
          id: 'job_include_accessor',
          lastError: 'provider-secret',
          runAt: now,
          status: 'dead',
          task: 'email.send',
          updatedAt: now,
        },
      ],
    });
    let includeReads = 0;
    const filters = {} as { includeArgs?: boolean };
    Object.defineProperty(filters, 'includeArgs', {
      get() {
        includeReads += 1;
        return true;
      },
    });

    await expect(status.list(filters)).rejects.toThrow(/includeArgs.*own data/u);
    expect(includeReads).toBe(0);
  });

  it('does not let inherited execute authority override an own snapshot source', async () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    let executeCalls = 0;
    const source = Object.create({
      async execute() {
        executeCalls += 1;
        return { rows: [] };
      },
    }) as { snapshot(): readonly never[] };
    source.snapshot = () => [
      {
        args: {},
        attempts: 1,
        createdAt: now,
        id: 'job_snapshot_authority',
        runAt: now,
        status: 'ready' as const,
        task: 'ordinary.task',
        updatedAt: now,
      } as never,
    ];

    await expect(createDurableTaskStatus(source).list()).resolves.toEqual([
      expect.objectContaining({ id: 'job_snapshot_authority' }),
    ]);
    expect(executeCalls).toBe(0);
  });
});

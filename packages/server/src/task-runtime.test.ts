import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp, createRequestHandler } from './app.js';
import { mutation, runMutation } from './mutation.js';
import { route } from './route.js';
import { s } from './schema.js';
import { task, type TaskSchedulingRequest } from './task.js';
import { createAppTaskRuntime } from './task-runtime.js';
import { createDurableTaskRunner } from './task-runner.js';
import { MemoryDurableTaskQueue } from './task-queue.js';
import type { DurableTaskSqlStatement } from './task-queue.js';

describe('durable task runtime (SPEC §9.6)', () => {
  it('materializes recurring tasks through the runtime using the database clock', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const db = {
      async query(text: string, values: readonly unknown[]) {
        statements.push({ text, values });
        if (text === 'select now() as now') {
          return { rows: [{ now: '2026-06-30T07:15:30.000Z' }] };
        }
        if (text.includes('returning cron_name')) {
          return { rows: [{ cron_name: values[0] }] };
        }
        if (text.includes('returning id')) {
          return { rows: [{ id: values[0] }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const nightly = task('nightly.cleanup', {
      input: s.object({}),
      cron: '0 2 * * *',
      run() {},
    });
    const app = createApp({
      db: () => db,
      tasks: [nightly],
    });

    await createAppTaskRuntime(app)?.ensureStarted(new Request('http://localhost/'));

    expect(
      statements.some((statement) =>
        statement.text.includes('create table if not exists _kovo_task_cron_occurrences'),
      ),
    ).toBe(true);
    expect(statements.some((statement) => statement.text === 'select now() as now')).toBe(true);
    const enqueue = statements.find((statement) =>
      statement.text.includes('insert into _kovo_jobs'),
    );
    expect(enqueue?.values[1]).toBe('nightly.cleanup');
    expect(enqueue?.values[2]).toBe('{}');
    expect(enqueue?.values[3]).toBe('cron:nightly.cleanup:2026-06-30T02:00:00.000Z');
    expect(enqueue?.values[4]).toEqual(new Date('2026-06-30T02:00:00.000Z'));
  });

  it('starts the durable task store through the app-root db provider', async () => {
    const providerCalls: string[] = [];
    const statements: DurableTaskSqlStatement[] = [];
    const internalDb = {
      async query(text: string, values: readonly unknown[]) {
        statements.push({ text, values });
        if (text === 'select now() as now') {
          return { rows: [{ now: '2026-06-30T10:00:00.000Z' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const requestDb = {
      async query(text: string) {
        throw new Error(`request-scoped db should not create durable task schema: ${text}`);
      },
    };
    const noop = task('startup/internal-db', {
      input: s.object({}),
      run() {},
    });
    const app = createApp({
      db: (request?: unknown) => {
        providerCalls.push(request === undefined ? 'internal' : 'request');
        return request === undefined ? internalDb : requestDb;
      },
      tasks: [noop],
    });

    await createAppTaskRuntime(app)?.ensureStarted(new Request('http://localhost/request'));

    expect(providerCalls).toEqual(['internal']);
    expect(
      statements.some((statement) =>
        statement.text.includes('create table if not exists _kovo_jobs'),
      ),
    ).toBe(true);
  });

  it('starts from a pre-provisioned task store when the runtime handle cannot run DDL', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const db = {
      async query(text: string, values: readonly unknown[]) {
        statements.push({ text, values });
        if (text.startsWith('create table') || text.startsWith('create index')) {
          throw new Error('permission denied for schema public');
        }
        if (text === 'select id from _kovo_jobs where false') return { rows: [] };
        if (text === 'select cron_name from _kovo_task_cron_occurrences where false') {
          return { rows: [] };
        }
        if (text === 'select now() as now') {
          return { rows: [{ now: '2026-06-30T10:00:00.000Z' }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
    const noop = task('startup/preprovisioned-store', {
      input: s.object({}),
      run() {},
    });
    const app = createApp({
      db: () => db,
      tasks: [noop],
    });

    await createAppTaskRuntime(app)?.ensureStarted(new Request('http://localhost/request'));

    expect(statements.map((statement) => statement.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('create table if not exists _kovo_jobs'),
        'select id from _kovo_jobs where false',
        'select cron_name from _kovo_task_cron_occurrences where false',
      ]),
    );
  });

  it('C233 keeps late inherited index setters from suppressing task startup and dispatch', async () => {
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    const nativeDefineProperty = Object.defineProperty;
    const nativeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    let dispatches = 0;
    let suppressedTaskCommits = 0;

    try {
      const db = {
        async query(text: string) {
          if (text === 'select now() as now') {
            return { rows: [{ now: '2026-06-30T07:15:30.000Z' }] };
          }
          return { rowCount: 0, rows: [] };
        },
      };
      const sendReceipt = task('receipt/send', {
        input: s.object({}),
        run() {
          dispatches += 1;
        },
      });
      const app = createApp({
        db: () => db,
        tasks: [sendReceipt],
      });
      const runtime = createAppTaskRuntime(app);
      const store = new MemoryDurableTaskQueue();
      await store.enqueue({
        args: {},
        runAt: new Date('2026-06-30T07:15:30.000Z'),
        task: sendReceipt.key,
      });

      // SPEC §6.6/§9.6: authored route code can install this setter after runtime construction but
      // before the async startup path snapshots registries for cron materialization and dispatch.
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          const key =
            typeof value === 'object' && value !== null
              ? nativeGetOwnPropertyDescriptor(value, 'key')?.value
              : undefined;
          if (key === 'receipt/send') {
            suppressedTaskCommits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });

      await expect(runtime?.ensureStarted(new Request('http://localhost/request'))).resolves.toBe(
        undefined,
      );
      const runner = createDurableTaskRunner({ store, tasks: [sendReceipt] });
      await runner.runOnce(new Date('2026-06-30T07:15:31.000Z'));

      expect(dispatches).toBe(1);
      expect(store.snapshot()[0]).toMatchObject({ status: 'succeeded' });
      expect(suppressedTaskCommits).toBe(0);
    } finally {
      if (originalZero === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalZero);
    }
  });

  it('reports task failures through the app onError hook', async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      let claimed = false;
      const db = {
        async query(text: string, values: readonly unknown[]) {
          if (text === 'select now() as now') {
            return { rows: [{ now: '2026-06-30T07:15:30.000Z' }] };
          }
          if (text.includes('with claimed as')) {
            if (claimed) return { rows: [] };
            claimed = true;
            return {
              rows: [
                {
                  args: {},
                  attempts: 1,
                  created_at: '2026-06-30T07:15:30.000Z',
                  generation: 0,
                  id: 'job_fail',
                  last_error: null,
                  lease_owner: values[2],
                  lease_token: values[4],
                  leased_until: '2026-06-30T07:16:00.000Z',
                  lineage: 'job_fail',
                  logical_key: null,
                  priority: 0,
                  run_at: '2026-06-30T07:15:30.000Z',
                  status: 'running',
                  task_key: 'fail.task',
                  updated_at: '2026-06-30T07:15:30.000Z',
                },
              ],
            };
          }
          return { rowCount: text.includes('set status = case') ? 1 : 0, rows: [] };
        },
      };
      const failing = task('fail.task', {
        input: s.object({}),
        run() {
          throw new Error('task exploded');
        },
      });
      const app = createApp({
        db: () => db,
        onError,
        tasks: [failing],
      });

      await createAppTaskRuntime(app)?.ensureStarted(new Request('http://localhost/request'));
      await vi.advanceTimersByTimeAsync(0);

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          operation: 'task-runner',
          taskJobId: 'job_fail',
          taskKey: 'fail.task',
          url: '/_kovo/task',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the runner-backed ctx.schedule path for lineage and self-reschedule backstops', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
      const enqueues: DurableTaskSqlStatement[] = [];
      let claimed = false;
      let loop!: ReturnType<typeof task>;
      const db = {
        async query(text: string, values: readonly unknown[]) {
          if (text === 'select now() as now') {
            return { rows: [{ now: '2026-06-30T10:00:00.000Z' }] };
          }
          if (text.includes('with claimed as')) {
            if (claimed) return { rows: [] };
            claimed = true;
            return {
              rows: [
                {
                  args: {},
                  attempts: 1,
                  created_at: '2026-06-30T10:00:00.000Z',
                  generation: 0,
                  id: 'job_parent',
                  last_error: null,
                  lease_owner: values[2],
                  lease_token: values[4],
                  leased_until: '2026-06-30T10:00:30.000Z',
                  lineage: 'lineage_parent',
                  logical_key: null,
                  priority: 0,
                  run_at: '2026-06-30T10:00:00.000Z',
                  status: 'running',
                  task_key: 'loop.runtime',
                  updated_at: '2026-06-30T10:00:00.000Z',
                },
              ],
            };
          }
          if (text.includes('insert into _kovo_jobs')) {
            enqueues.push({ text, values });
            return { rows: [{ id: values[0] }] };
          }
          return { rowCount: text.includes("set status = 'succeeded'") ? 1 : 0, rows: [] };
        },
      };
      loop = task('loop.runtime', {
        input: s.object({}),
        run: (_args, ctx) => ctx.schedule(loop, {}, { afterMs: 1 }),
      });
      const app = createApp({ db: () => db, tasks: [loop] });

      await createAppTaskRuntime(app)?.ensureStarted(new Request('http://localhost/request'));
      await vi.advanceTimersByTimeAsync(0);

      expect(enqueues).toHaveLength(1);
      expect(enqueues[0]!.values[1]).toBe('loop.runtime');
      expect(enqueues[0]!.values[4]).toEqual(new Date('2026-06-30T10:00:01.000Z'));
      expect(enqueues[0]!.values[6]).toBe('lineage_parent');
      expect(enqueues[0]!.values[7]).toBe(1);
      expect(enqueues[0]!.values[9]).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects request.schedule for tasks outside createApp({ tasks })', async () => {
    const registered = task('registered.runtime', {
      input: s.object({}),
      run() {},
    });
    const unregistered = task('unregistered.runtime', {
      input: s.object({}),
      run() {},
    });
    const app = createApp({
      db: () => ({}),
      tasks: [registered],
    });
    const runtime = createAppTaskRuntime(app);
    const scheduleUnregistered = mutation('runtime/schedule-unregistered', {
      csrf: false,
      input: s.object({}),
      handler(_input, request: TaskSchedulingRequest) {
        return request.schedule(unregistered, {});
      },
    });

    await expect(
      runMutation(scheduleUnregistered, {}, { db: {} }, { taskScheduler: runtime!.scheduler }),
    ).rejects.toThrow('No durable task is registered for key "unregistered.runtime".');
  });

  it('reports task startup failures without blocking unrelated routes', async () => {
    const onError = vi.fn();
    const startupTask = task('startup.fail', {
      input: s.object({}),
      run() {},
    });
    const app = createApp({
      db: () => ({}),
      errorShells: {
        serverError({ status }) {
          return `<main>startup shell ${status}</main>`;
        },
      },
      onError,
      routes: [
        route('/needs-startup', {
          page() {
            return trustedHtml('<main>route ok</main>');
          },
        }),
      ],
      tasks: [startupTask],
    });
    const request = new Request('http://localhost/needs-startup');

    const response = await createRequestHandler(app)(request);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('<main>route ok</main>');
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Postgres-compatible db client'),
      }),
      {
        operation: 'task-runtime-startup',
        request: expect.any(Request),
        url: '/needs-startup',
      },
    );
  });

  it('retries task runtime startup after a transient failure instead of caching rejection', async () => {
    let calls = 0;
    const startupTask = task('startup.retry', {
      input: s.object({}),
      run() {},
    });
    const db = {
      async query(text: string) {
        calls += 1;
        if (calls === 1) throw new Error('temporary db outage');
        if (text === 'select now() as now') {
          return { rows: [{ now: '2026-06-30T10:00:00.000Z' }] };
        }
        return { rows: [] };
      },
    };
    const app = createApp({
      db: () => db,
      routes: [
        route('/', {
          page() {
            return trustedHtml('<main>ok</main>');
          },
        }),
      ],
      tasks: [startupTask],
    });
    const handler = createRequestHandler(app);

    const firstResponse = await handler(new Request('http://localhost/'));
    await Promise.resolve();
    await Promise.resolve();
    const response = await handler(new Request('http://localhost/'));
    await Promise.resolve();
    await Promise.resolve();

    expect(firstResponse.status).toBe(200);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('ok');
    expect(calls).toBeGreaterThan(1);
  });
});

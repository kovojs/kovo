import { describe, expect, it, vi } from 'vitest';

import { createApp, createRequestHandler } from './app.js';
import { s } from './schema.js';
import { task } from './task.js';
import { createAppTaskRuntime } from './task-runtime.js';
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
          url: 'http://localhost/_kovo/task',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes startup failures through app onError and the configured error shell', async () => {
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
      tasks: [startupTask],
    });
    const request = new Request('http://localhost/needs-startup');

    const response = await createRequestHandler(app)(request);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('<main>startup shell 500</main>');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Postgres-compatible db client'),
      }),
      {
        operation: 'task-runtime-startup',
        request,
        url: '/needs-startup',
      },
    );
  });
});

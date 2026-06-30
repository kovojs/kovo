import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
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
});

import { describe, expect, it } from 'vitest';

import { s } from './schema.js';
import { task } from './task.js';
import {
  DEFAULT_TASK_CRON_BACKFILL_LIMIT,
  KOVO_TASK_CRON_OCCURRENCES_TABLE_SQL,
  MemoryRecurringTaskOccurrenceStore,
  PostgresRecurringTaskOccurrenceStore,
  createRecurringTaskMaterializer,
} from './task-cron.js';
import {
  MemoryDurableTaskQueue,
  type DurableTaskSqlExecutor,
  type DurableTaskSqlStatement,
} from './task-queue.js';

describe('durable recurring task materialization (SPEC §9.6)', () => {
  it('accepts cron task declarations and rejects invalid recurring options early', () => {
    const nightly = task('nightly.cleanup', {
      input: s.object({}),
      cron: '0 2 * * *',
      run() {},
    });

    expect(nightly.cron).toBe('0 2 * * *');
    expect(nightly.catchUp).toBeUndefined();
    expect(() =>
      task('bad.six-field', {
        input: s.object({}),
        cron: '0 0 2 * * *',
        run() {},
      }),
    ).toThrow('task({ cron }) expects a five-field cron expression');
    expect(() =>
      task('bad.nickname', {
        input: s.object({}),
        cron: '@daily',
        run() {},
      }),
    ).toThrow('task({ cron }) expects a five-field cron expression');
    expect(() =>
      task('bad.field', {
        input: s.object({}),
        cron: '*/nope * * * *',
        run() {},
      }),
    ).toThrow('Invalid cron minute field');
    expect(() =>
      task('bad.catchup', {
        input: s.object({}),
        catchUp: 'backfill',
        run() {},
      }),
    ).toThrow('task({ catchUp }) requires task({ cron })');
    expect(() =>
      task('bad.policy', {
        input: s.object({}),
        cron: '0 2 * * *',
        catchUp: 'all' as never,
        run() {},
      }),
    ).toThrow("task({ catchUp }) must be 'skip' or 'backfill'");
  });

  it('defaults catch-up to skip by materializing only the latest due occurrence', async () => {
    const store = new MemoryDurableTaskQueue();
    const materializer = createRecurringTaskMaterializer({
      store,
      tasks: [
        task('nightly.cleanup', {
          input: s.object({}),
          cron: '0 2 * * *',
          run() {},
        }),
      ],
    });

    const result = await materializer.materializeDue({
      now: new Date('2026-06-30T07:15:30.000Z'),
    });

    expect(result).toEqual({
      enqueued: 1,
      occurrences: [new Date('2026-06-30T02:00:00.000Z')],
    });
    expect(store.snapshot()).toMatchObject([
      {
        task: 'nightly.cleanup',
        args: {},
        key: 'cron:nightly.cleanup:2026-06-30T02:00:00.000Z',
        runAt: new Date('2026-06-30T02:00:00.000Z'),
        status: 'ready',
      },
    ]);
  });

  it('pins cron parsing, UTC occurrence matching, and occurrence collection after late poisoning', async () => {
    const originalDateGetUTCMinutes = Date.prototype.getUTCMinutes;
    const originalSetAdd = Set.prototype.add;
    const originalSetHas = Set.prototype.has;
    const originalStringIncludes = String.prototype.includes;
    const originalStringSplit = String.prototype.split;
    const originalStringTrim = String.prototype.trim;
    const store = new MemoryDurableTaskQueue();
    const occurrenceStore = new MemoryRecurringTaskOccurrenceStore();
    const materializer = createRecurringTaskMaterializer({
      store,
      occurrenceStore,
      tasks: [
        task('security.hourly', {
          input: s.object({}),
          cron: '0 * * * *',
          run() {},
        }),
      ],
    });
    let result;
    try {
      Date.prototype.getUTCMinutes = () => 59;
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => false;
      String.prototype.includes = () => false;
      String.prototype.split = () => ['forged'];
      String.prototype.trim = () => 'forged';
      result = await materializer.materializeDue({
        now: new Date('2026-06-30T02:00:00.000Z'),
      });
    } finally {
      Date.prototype.getUTCMinutes = originalDateGetUTCMinutes;
      Set.prototype.add = originalSetAdd;
      Set.prototype.has = originalSetHas;
      String.prototype.includes = originalStringIncludes;
      String.prototype.split = originalStringSplit;
      String.prototype.trim = originalStringTrim;
    }

    expect(result).toEqual({
      enqueued: 1,
      occurrences: [new Date('2026-06-30T02:00:00.000Z')],
    });
    expect(occurrenceStore.snapshot()).toHaveLength(1);
    expect(store.snapshot()).toHaveLength(1);
  });

  it('bounds backfill to sixteen occurrences by default', async () => {
    const store = new MemoryDurableTaskQueue();
    const materializer = createRecurringTaskMaterializer({
      store,
      tasks: [
        task('hourly.rollup', {
          input: s.object({ kind: s.string() }),
          cron: '0 * * * *',
          catchUp: 'backfill',
          cronArgs: { kind: 'hourly' },
          run() {},
        }),
      ],
    });

    const result = await materializer.materializeDue({
      now: new Date('2026-06-30T20:22:00.000Z'),
    });

    expect(result.enqueued).toBe(DEFAULT_TASK_CRON_BACKFILL_LIMIT);
    expect(result.occurrences[0]).toEqual(new Date('2026-06-30T05:00:00.000Z'));
    expect(result.occurrences.at(-1)).toEqual(new Date('2026-06-30T20:00:00.000Z'));
    expect(store.snapshot()).toHaveLength(DEFAULT_TASK_CRON_BACKFILL_LIMIT);
    expect(store.snapshot()[0]).toMatchObject({ args: { kind: 'hourly' } });
  });

  it('uses standard step values that begin at N and repeat through the field range', async () => {
    const store = new MemoryDurableTaskQueue();
    const materializer = createRecurringTaskMaterializer({
      store,
      tasks: [
        task('quarter-hour-offset', {
          input: s.object({}),
          cron: '5/15 * * * *',
          catchUp: 'backfill',
          run() {},
        }),
      ],
    });

    const result = await materializer.materializeDue({
      now: new Date('2026-06-30T00:50:00.000Z'),
      backfillLimit: 4,
    });

    expect(result.occurrences).toEqual([
      new Date('2026-06-30T00:05:00.000Z'),
      new Date('2026-06-30T00:20:00.000Z'),
      new Date('2026-06-30T00:35:00.000Z'),
      new Date('2026-06-30T00:50:00.000Z'),
    ]);
  });

  it('matches day-of-month and day-of-week with POSIX OR when both fields are restricted', async () => {
    const store = new MemoryDurableTaskQueue();
    const materializer = createRecurringTaskMaterializer({
      store,
      tasks: [
        task('monthly-or-monday', {
          input: s.object({}),
          cron: '0 0 1 * 1',
          run() {},
        }),
      ],
    });

    const result = await materializer.materializeDue({
      now: new Date('2026-06-08T00:00:00.000Z'),
    });

    expect(result.occurrences).toEqual([new Date('2026-06-08T00:00:00.000Z')]);
  });

  it('lets multiple runner nodes race without duplicating an occurrence', async () => {
    const store = new MemoryDurableTaskQueue();
    const occurrenceStore = new MemoryRecurringTaskOccurrenceStore();
    const recurring = [
      task('nightly.cleanup', {
        input: s.object({}),
        cron: '0 2 * * *',
        run() {},
      }),
    ];
    const nodeA = createRecurringTaskMaterializer({ store, tasks: recurring, occurrenceStore });
    const nodeB = createRecurringTaskMaterializer({ store, tasks: recurring, occurrenceStore });

    const [a, b] = await Promise.all([
      nodeA.materializeDue({ now: new Date('2026-06-30T02:00:00.000Z') }),
      nodeB.materializeDue({ now: new Date('2026-06-30T02:00:00.000Z') }),
    ]);

    expect(a.enqueued + b.enqueued).toBe(1);
    expect(store.snapshot()).toHaveLength(1);
    expect(occurrenceStore.snapshot()).toHaveLength(1);
  });

  it('uses the Postgres database clock when materialization time is not injected', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const occurrenceStore = new PostgresRecurringTaskOccurrenceStore({
      async execute(statement) {
        statements.push(statement);
        if (statement.text === 'select now() as now') {
          return { rows: [{ now: '2026-06-30T02:00:00.000Z' }] };
        }
        if (statement.text.includes('returning cron_name')) {
          return { rows: [{ cron_name: statement.values[0] }] };
        }
        return { rows: [] };
      },
    });
    const store = new MemoryDurableTaskQueue();
    const materializer = createRecurringTaskMaterializer({
      store,
      occurrenceStore,
      tasks: [
        task('nightly.cleanup', {
          input: s.object({}),
          cron: '0 2 * * *',
          run() {},
        }),
      ],
    });

    await expect(materializer.materializeDue()).resolves.toMatchObject({ enqueued: 1 });

    expect(statements[0]).toEqual({ text: 'select now() as now', values: [] });
    expect(store.snapshot()[0]!.runAt).toEqual(new Date('2026-06-30T02:00:00.000Z'));
  });

  it('exposes a durable unique occurrence schema for Postgres runners', () => {
    const occurrenceSchema = KOVO_TASK_CRON_OCCURRENCES_TABLE_SQL[0];

    expect(occurrenceSchema.text).toContain('primary key (cron_name, occurrence_ts)');
    expect(occurrenceSchema.text).toContain('job_id text null');
  });

  it('parameterizes Postgres occurrence reserve and bind statements', async () => {
    const statements: DurableTaskSqlStatement[] = [];
    const executor: DurableTaskSqlExecutor = {
      async execute(statement) {
        statements.push(statement);
        if (statement.text.includes('returning cron_name')) {
          return { rows: [{ cron_name: statement.values[0] }] };
        }
        return { rows: [], rowCount: 1 };
      },
    };
    const occurrenceStore = new PostgresRecurringTaskOccurrenceStore(executor);

    await expect(
      occurrenceStore.reserve('nightly.cleanup', new Date('2026-06-30T02:00:00.000Z')),
    ).resolves.toBe(true);
    await occurrenceStore.bindJob('nightly.cleanup', new Date('2026-06-30T02:00:00.000Z'), 'job_1');

    expect(statements[0]!.text).toContain('on conflict (cron_name, occurrence_ts) do nothing');
    expect(statements[0]!.values).toEqual([
      'nightly.cleanup',
      new Date('2026-06-30T02:00:00.000Z'),
    ]);
    expect(statements[1]!.text).toContain('where cron_name = $1 and occurrence_ts = $2');
    expect(statements[1]!.values).toEqual([
      'nightly.cleanup',
      new Date('2026-06-30T02:00:00.000Z'),
      'job_1',
    ]);
  });
});

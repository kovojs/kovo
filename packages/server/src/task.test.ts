import { describe, expect, it } from 'vitest';

import { s } from './schema.js';
import { task } from './task.js';

describe('durable task definitions (SPEC §9.6)', () => {
  it('validates recurring task args against the input schema at declaration time', () => {
    expect(() =>
      task('missing-cron-args', {
        input: s.object({ proofId: s.string() }),
        cron: '* * * * *',
        run() {},
      }),
    ).toThrow('task({ cronArgs }) must satisfy the task input schema');

    expect(() =>
      task('invalid-cron-args', {
        input: s.object({ proofId: s.string() }),
        cron: '* * * * *',
        cronArgs: { proofId: 42 } as never,
        run() {},
      }),
    ).toThrow('Expected string');

    const defaulted = task('defaulted-cron-args', {
      input: s.object({ kind: s.string().default('hourly') }),
      cron: '* * * * *',
      run() {},
    });
    expect(defaulted.cronArgs).toBeUndefined();

    const optional = task('optional-cron-args', {
      input: s.object({ kind: s.string().optional() }),
      cron: '* * * * *',
      cronArgs: { kind: undefined },
      run() {},
    });
    expect(optional.cronArgs).toEqual({ kind: undefined });
  });

  it('rejects inert retry configurations without a positive finite maxAttempts', () => {
    expect(() =>
      task('backoff-only', {
        input: s.object({}),
        retry: { backoff: 'exponential' },
        run() {},
      }),
    ).toThrow('task({ retry.maxAttempts }) must be a positive finite number');

    expect(() =>
      task('zero-attempts', {
        input: s.object({}),
        retry: { maxAttempts: 0 },
        run() {},
      }),
    ).toThrow('task({ retry.maxAttempts }) must be a positive finite number');

    expect(() =>
      task('bad-backoff', {
        input: s.object({}),
        retry: { backoff: 'jitter' as never, maxAttempts: 2 },
        run() {},
      }),
    ).toThrow("task({ retry.backoff }) must be 'exponential' or 'linear'");

    const retrying = task('retrying', {
      input: s.object({}),
      retry: { backoff: 'linear', maxAttempts: 2 },
      run() {},
    });
    expect(retrying.retry).toEqual({ backoff: 'linear', maxAttempts: 2 });
  });

  it('types task bodies as composition-only capabilities with no raw db', () => {
    const recordEffect = {
      input: s.object({ proofId: s.string() }),
      key: 'proof/record',
    };
    const readEffect = {
      args: s.object({ proofId: s.string() }),
      key: 'proof/read',
    };
    const compact = {
      key: 'proof/compact',
    };

    const definition = task('proof/task-capabilities', {
      input: s.object({ proofId: s.string() }),
      async run(args, context) {
        await context.runMutation(recordEffect, { proofId: args.proofId });
        await context.runQuery(readEffect, { proofId: args.proofId });
        await context.runQuery(compact, undefined);

        const compileOnly = () => {
          // @ts-expect-error SPEC §9.6: durable tasks do not receive raw DB handles.
          void context.db;
          // @ts-expect-error mutation input stays schema-derived on the composition path.
          void context.runMutation(recordEffect, { proofId: 42 });
          // @ts-expect-error query args stay schema-derived on the composition path.
          void context.runQuery(readEffect, undefined);
        };
        void compileOnly;
      },
    });

    expect(definition.key).toBe('proof/task-capabilities');
  });
});

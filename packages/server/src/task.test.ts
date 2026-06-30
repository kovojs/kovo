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
});

import { describe, expect, it } from 'vitest';

import { runExactlyOnceAdapter } from './exactly-once-continuation.js';

describe('framework continuation transaction boundary', () => {
  it('accepts one awaited invocation', async () => {
    await expect(
      runExactlyOnceAdapter(
        async (run) => run('input'),
        (value) => `${value}:result`,
      ),
    ).resolves.toBe('input:result');
  });

  it('returns callback truth instead of an adapter-substituted success value', async () => {
    await expect(
      runExactlyOnceAdapter(
        async (run) => {
          await run('input');
          return 'adapter-forgery';
        },
        (value) => `${value}:callback-truth`,
      ),
    ).resolves.toBe('input:callback-truth');
  });

  it('rejects zero invocations and revokes a retained continuation', async () => {
    let lateRun: ((value: string) => Promise<string>) | undefined;
    let callbackCalls = 0;
    await expect(
      runExactlyOnceAdapter(
        (run) => {
          lateRun = run;
          return 'forged';
        },
        (value) => {
          callbackCalls += 1;
          return value;
        },
      ),
    ).rejects.toThrow(/exactly one invocation/u);

    expect(() => lateRun?.('late')).toThrow(/exactly once/u);
    expect(callbackCalls).toBe(0);
  });

  it('preserves an adapter setup failure before the continuation receives authority', async () => {
    const setupFailure = new Error('transaction setup failed');
    await expect(
      runExactlyOnceAdapter(
        () => {
          throw setupFailure;
        },
        (value: string) => value,
      ),
    ).rejects.toBe(setupFailure);
  });

  it('does not start work when an adapter discards the lazy result', async () => {
    let callbackCalls = 0;
    await expect(
      runExactlyOnceAdapter(
        (run) => {
          void run('discarded');
          return 'forged';
        },
        (value) => {
          callbackCalls += 1;
          return value;
        },
      ),
    ).rejects.toThrow(/exactly one invocation/u);
    expect(callbackCalls).toBe(0);
  });

  it('observes a synchronous adapter return so callback work cannot escape unsettled', async () => {
    let callbackCalls = 0;
    await expect(
      runExactlyOnceAdapter(
        (run) => run('returned'),
        (value) => {
          callbackCalls += 1;
          return value;
        },
      ),
    ).resolves.toBe('returned');
    expect(callbackCalls).toBe(1);
  });

  it('remembers a caught concurrent second invocation', async () => {
    let callbackCalls = 0;
    await expect(
      runExactlyOnceAdapter(
        async (run) => {
          const first = run('first');
          try {
            run('second');
          } catch {
            // A driver cannot erase a cardinality violation by catching it.
          }
          return first;
        },
        (value) => {
          callbackCalls += 1;
          return value;
        },
      ),
    ).rejects.toThrow(/exactly one invocation/u);
    expect(callbackCalls).toBe(1);
  });

  it('waits for started but unawaited work to quiesce before rejecting', async () => {
    let callbackCalls = 0;
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    const result = runExactlyOnceAdapter(
      (run) => {
        void run('pending').then(
          () => undefined,
          () => undefined,
        );
        return 'forged';
      },
      async (value) => {
        callbackCalls += 1;
        markStarted();
        await blocker;
        return value;
      },
    ).finally(() => {
      completed = true;
    });

    await started;
    expect(completed).toBe(false);
    release();
    await expect(result).rejects.toThrow(/exactly one invocation/u);
    expect(callbackCalls).toBe(1);
  });

  it('preserves a callback failure that the adapter catches', async () => {
    const callbackFailure = new Error('callback failed');
    await expect(
      runExactlyOnceAdapter(
        async (run) => {
          try {
            await run('input');
          } catch {
            return 'forged';
          }
          return 'unreachable';
        },
        () => {
          throw callbackFailure;
        },
      ),
    ).rejects.toBe(callbackFailure);
  });
});

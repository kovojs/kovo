import { describe, expect, it } from 'vitest';

import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextGeneration,
  currentFrameworkAsyncContextValue,
  runInFreshFrameworkAsyncContext,
  runWithFrameworkAsyncContext,
  runWithIsolatedFrameworkAsyncContext,
  runWithRevocableIsolatedFrameworkAsyncContext,
  type FrameworkAsyncContextCell,
} from './async-context.js';

describe('SPEC §6.6 shared async-context confinement', () => {
  it('accepts only runtime-minted cells and never exposes missing authority', () => {
    const cell = createFrameworkAsyncContextCell<string>('oracle.identity');
    expect(currentFrameworkAsyncContextValue(cell)).toBeUndefined();
    expect(() =>
      currentFrameworkAsyncContextValue({ id: 'forged' } as FrameworkAsyncContextCell<string>),
    ).toThrow('was not minted by this runtime');
  });

  it('shares one lifecycle across nested cells and masks inherited cells at an isolated root', async () => {
    const first = createFrameworkAsyncContextCell<string>('oracle.nested.first');
    const second = createFrameworkAsyncContextCell<string>('oracle.nested.second');

    await runWithFrameworkAsyncContext(first, 'outer', async () => {
      const outerGeneration = currentFrameworkAsyncContextGeneration();
      expect(outerGeneration).toEqual(expect.any(Number));
      expect(currentFrameworkAsyncContextValue(first)).toBe('outer');

      await runWithFrameworkAsyncContext(second, 'nested', async () => {
        expect(currentFrameworkAsyncContextGeneration()).toBe(outerGeneration);
        expect(currentFrameworkAsyncContextValue(first)).toBe('outer');
        expect(currentFrameworkAsyncContextValue(second)).toBe('nested');
      });

      await runWithIsolatedFrameworkAsyncContext(second, 'isolated', async () => {
        expect(currentFrameworkAsyncContextGeneration()).not.toBe(outerGeneration);
        expect(currentFrameworkAsyncContextValue(first)).toBeUndefined();
        expect(currentFrameworkAsyncContextValue(second)).toBe('isolated');
      });

      expect(currentFrameworkAsyncContextGeneration()).toBe(outerGeneration);
      expect(currentFrameworkAsyncContextValue(first)).toBe('outer');
      expect(currentFrameworkAsyncContextValue(second)).toBeUndefined();
    });

    expect(currentFrameworkAsyncContextValue(first)).toBeUndefined();
    expect(currentFrameworkAsyncContextValue(second)).toBeUndefined();
  });

  it('revokes detached descendants and refuses stale authority reacquisition', async () => {
    const cell = createFrameworkAsyncContextCell<string>('oracle.detached');
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: string | undefined = 'not-run';
    let staleError: unknown;

    expect(
      runWithFrameworkAsyncContext(cell, 'authority', () => {
        queueMicrotask(() => {
          observed = currentFrameworkAsyncContextValue(cell);
          try {
            runWithFrameworkAsyncContext(cell, 'reacquired', () => undefined);
          } catch (error) {
            staleError = error;
          }
          release();
        });
        return 'settled';
      }),
    ).toBe('settled');

    await released;
    expect(observed).toBeUndefined();
    expect(staleError).toBeInstanceOf(TypeError);
    expect(String(staleError)).toContain('detached work cannot reacquire');
  });

  it('closes a synchronous thenable before it can regain the returned scope', async () => {
    const cell = createFrameworkAsyncContextCell<string>('oracle.thenable-return');
    let observed: string | undefined = 'not-run';
    const thenable = runWithFrameworkAsyncContext(cell, 'authority', () => ({
      then(resolve: (value: string) => void) {
        observed = currentFrameworkAsyncContextValue(cell);
        resolve('done');
      },
    }));

    await expect(Promise.resolve(thenable)).resolves.toBe('done');
    expect(observed).toBeUndefined();
  });

  it('revokes an unfinished isolated task before its authored promise settles', async () => {
    const cell = createFrameworkAsyncContextCell<string>('oracle.revocable-isolated');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: string | undefined = 'not-run';
    let staleReentry: unknown;

    const task = runWithRevocableIsolatedFrameworkAsyncContext(cell, 'jsx-only', async () => {
      await gate;
      observed = currentFrameworkAsyncContextValue(cell);
      try {
        runWithFrameworkAsyncContext(cell, 'reacquired', () => undefined);
      } catch (error) {
        staleReentry = error;
      }
    });
    task.revoke();
    task.revoke();
    release();

    await task.result;
    expect(observed).toBeUndefined();
    expect(staleReentry).toBeInstanceOf(TypeError);
  });

  it('keeps seeded concurrent principals disjoint through awaits, streams, and thenable traps', async () => {
    const cellCount = 9;
    const requestCount = 24;
    const cells = Array.from({ length: cellCount }, (_unused, index) =>
      createFrameworkAsyncContextCell<OracleCellValue>(`oracle.concurrent.${index}`),
    );
    const generations = new Set<number>();

    await Promise.all(
      Array.from({ length: requestCount }, async (_unused, requestIndex) => {
        const principal = `principal-${requestIndex}`;
        await runInFreshFrameworkAsyncContext(() =>
          runOracleCells(cells, 0, principal, async () => {
            const generation = currentFrameworkAsyncContextGeneration();
            expect(generation).toEqual(expect.any(Number));
            generations.add(generation!);
            const assertDisjoint = (): void => {
              for (let index = 0; index < cells.length; index += 1) {
                expect(currentFrameworkAsyncContextValue(cells[index]!)).toEqual({
                  door: index,
                  principal,
                });
              }
            };
            assertDisjoint();

            const checkpoints = seededCheckpointOrder(0x4b56_4f56 ^ requestIndex);
            for (const checkpoint of checkpoints) {
              if (checkpoint === 'microtask') {
                await new Promise<void>((resolve) => queueMicrotask(resolve));
              } else if (checkpoint === 'stream') {
                const reader = new ReadableStream<number>({
                  pull(controller) {
                    assertDisjoint();
                    controller.enqueue(requestIndex);
                    controller.close();
                  },
                }).getReader();
                await expect(reader.read()).resolves.toEqual({ done: false, value: requestIndex });
              } else {
                await thenableCheckpoint(assertDisjoint);
              }
              assertDisjoint();
            }
          }),
        );
      }),
    );

    expect(generations.size).toBe(requestCount);
    for (const cell of cells) expect(currentFrameworkAsyncContextValue(cell)).toBeUndefined();
  });
});

interface OracleCellValue {
  readonly door: number;
  readonly principal: string;
}

function runOracleCells<Result>(
  cells: readonly FrameworkAsyncContextCell<OracleCellValue>[],
  index: number,
  principal: string,
  callback: () => Result,
): Result {
  if (index === cells.length) return callback();
  return runWithFrameworkAsyncContext(cells[index]!, { door: index, principal }, () =>
    runOracleCells(cells, index + 1, principal, callback),
  );
}

function seededCheckpointOrder(seed: number): ('microtask' | 'stream' | 'thenable')[] {
  const order: ('microtask' | 'stream' | 'thenable')[] = ['microtask', 'stream', 'thenable'];
  let state = seed >>> 0;
  for (let index = order.length - 1; index > 0; index -= 1) {
    state += 0x6d2b_79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const selected = ((value ^ (value >>> 14)) >>> 0) % (index + 1);
    [order[index], order[selected]] = [order[selected]!, order[index]!];
  }
  return order;
}

function thenableCheckpoint(assertDisjoint: () => void): Promise<void> {
  return Promise.resolve({
    then(resolve: () => void, reject: (error: unknown) => void) {
      queueMicrotask(() => {
        try {
          assertDisjoint();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    },
  });
}

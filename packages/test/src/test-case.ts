import {
  createJisoTestHarness,
  type JisoTestContext,
  type JisoTestHarnessOptions,
} from './harness.js';

/** A test-runner adapter (e.g. vitest's `it`) `jisoTest` can register cases with. */
export type JisoTestRunner = (name: string, run: () => Promise<void>) => unknown;

/** A registered Jiso test case: its `name` and a `run` that builds the harness and runs the body. */
export interface JisoTestCase {
  name: string;
  run: () => Promise<void>;
}

/**
 * Define a Jiso test case: builds a harness from `options`, passes its context
 * to `fn`, and (optionally) registers the case with a test runner like vitest's
 * `it`.
 *
 * @param name - The test name.
 * @param fn - The test body, receiving the harness context.
 * @param options - Harness options (db, pages, verification, …).
 * @param runner - Optional test-runner registration function.
 * @returns A `JisoTestCase`.
 */
export function jisoTest<Db>(
  name: string,
  fn: (ctx: JisoTestContext<Db>) => void | Promise<void>,
  options: JisoTestHarnessOptions<Db>,
  runner?: JisoTestRunner,
): JisoTestCase {
  const run = async () => {
    await fn(createJisoTestHarness(options));
  };

  runner?.(name, run);

  return {
    name,
    run,
  };
}

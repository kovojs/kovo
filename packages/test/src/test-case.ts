import {
  createKovoTestHarness,
  type KovoTestContext,
  type KovoTestHarnessOptions,
} from './harness.js';

/** A test-runner adapter (e.g. vitest's `it`) `kovoTest` can register cases with. */
export type KovoTestRunner = (name: string, run: () => Promise<void>) => unknown;

/** A registered Kovo test case: its `name` and a `run` that builds the harness and runs the body. */
export interface KovoTestCase {
  name: string;
  run: () => Promise<void>;
}

/**
 * Define a Kovo test case: builds a harness from `options`, passes its context
 * to `fn`, and (optionally) registers the case with a test runner like vitest's
 * `it`.
 *
 * @experimental
 * @param name - The test name.
 * @param fn - The test body, receiving the harness context.
 * @param options - Harness options (db, pages, verification, …).
 * @param runner - Optional test-runner registration function.
 * @returns A `KovoTestCase`.
 */
export function kovoTest<Db>(
  name: string,
  fn: (ctx: KovoTestContext<Db>) => void | Promise<void>,
  options: KovoTestHarnessOptions<Db>,
  runner?: KovoTestRunner,
): KovoTestCase {
  const run = async () => {
    await fn(createKovoTestHarness(options));
  };

  runner?.(name, run);

  return {
    name,
    run,
  };
}

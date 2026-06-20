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

function buildCase<Db>(
  name: string,
  fn: (ctx: KovoTestContext<Db>) => void | Promise<void>,
  options: KovoTestHarnessOptions<Db> | undefined,
  runner: KovoTestRunner | undefined,
): KovoTestCase {
  const run = async () => {
    await fn(createKovoTestHarness(options ?? ({} as KovoTestHarnessOptions<Db>)));
  };
  runner?.(name, run);
  return { name, run };
}

/**
 * Define a Kovo test case: builds a harness from `options`, passes its context
 * to `fn`, and (optionally) registers the case with a runner like vitest's `it`.
 *
 * Pass `options` inline for a one-off, or bind them once with
 * `kovoTest.configure(options)` and call the result as `test(name, fn)` — the
 * per-case ergonomic form so the harness context (`db`, `exec`, `page`, …) is
 * typed without repeating `options` at every case (SPEC §12).
 *
 * @param name - The test name.
 * @param fn - The test body, receiving the harness context.
 * @param options - Harness options (db, pages, verification, …). Optional; bind once via `kovoTest.configure` to omit it per case.
 * @param runner - Optional test-runner registration function.
 * @returns A `KovoTestCase`.
 */
function kovoTestImpl<Db>(
  name: string,
  fn: (ctx: KovoTestContext<Db>) => void | Promise<void>,
  options?: KovoTestHarnessOptions<Db>,
  runner?: KovoTestRunner,
): KovoTestCase {
  return buildCase(name, fn, options, runner);
}

/**
 * Bind harness `options` once and return a `kovoTest` you call as
 * `test(name, fn, runner?)`, so the body's context (`db`, `exec`, `page`, …) is
 * typed from `options.db` without repeating `options` at every case (SPEC §12).
 *
 * @param options - The harness `db` plus optional pages, request stub, touch graph, and verification config.
 * @returns A `kovoTest` bound to `options`.
 */
function configureKovoTest<Db>(
  options: KovoTestHarnessOptions<Db>,
): (
  name: string,
  fn: (ctx: KovoTestContext<Db>) => void | Promise<void>,
  runner?: KovoTestRunner,
) => KovoTestCase {
  return (name, fn, runner) => buildCase(name, fn, options, runner);
}

/**
 * Define a Kovo test case. Call with inline `options`, or use
 * `kovoTest.configure(options)` to bind the harness once and call the result as
 * `test(name, fn)` (SPEC §12).
 */
export const kovoTest: typeof kovoTestImpl & { configure: typeof configureKovoTest } =
  Object.assign(kovoTestImpl, { configure: configureKovoTest });

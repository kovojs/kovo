import {
  createJisoTestHarness,
  type JisoTestContext,
  type JisoTestHarnessOptions,
} from './harness.js';

export type JisoTestRunner = (name: string, run: () => Promise<void>) => unknown;

export interface JisoTestCase {
  name: string;
  run: () => Promise<void>;
}

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

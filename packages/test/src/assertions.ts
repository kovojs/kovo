import { inspect, isDeepStrictEqual } from 'node:util';
import type { InferSchema, MutationDefinition, MutationResult, Schema } from '@jiso/server';

export type MutationErrorExpectation<
  Errors extends Record<string, Schema<unknown>>,
  Code extends Extract<keyof Errors, string>,
> =
  | Code
  | {
      code: Code;
      payload?: InferSchema<Errors[Code]>;
    };

export interface PropertyCase<State, Input> {
  input: Input;
  state: State;
}

export interface PropertyTestOptions<State, Input, ClientShape = unknown> {
  apply: (state: State, input: Input) => State;
  cases: Iterable<PropertyCase<State, Input>>;
  predict: (state: State, input: Input) => ClientShape;
  shape?: (state: State) => ClientShape;
}

export interface PropertyTestResult {
  cases: number;
}

export function assertMutationError<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  const Code extends Extract<keyof Errors, string>,
>(
  mutation: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
  result: MutationResult<Value>,
  expected: MutationErrorExpectation<Errors, Code>,
): InferSchema<Errors[Code]> {
  const expectation = typeof expected === 'string' ? { code: expected } : expected;

  if (result.ok) {
    throw new Error(`Expected ${mutation.key} to fail with ${expectation.code}, but it succeeded.`);
  }

  if (result.error.code !== expectation.code) {
    throw new Error(
      `Expected ${mutation.key} to fail with ${expectation.code}, got ${result.error.code}.`,
    );
  }

  if ('payload' in expectation && !deepEqual(result.error.payload, expectation.payload)) {
    throw new Error(
      `Expected ${mutation.key} error ${expectation.code} payload ${formatValue(
        expectation.payload,
      )}, got ${formatValue(result.error.payload)}.`,
    );
  }

  return result.error.payload as InferSchema<Errors[Code]>;
}

export function propertyTest<State, Input, ClientShape = State>(
  options: PropertyTestOptions<State, Input, ClientShape>,
): PropertyTestResult {
  let count = 0;
  const shape = options.shape ?? ((state: State) => state as unknown as ClientShape);

  for (const testCase of options.cases) {
    const predicted = options.predict(structuredClone(testCase.state), testCase.input);
    const eventual = shape(options.apply(structuredClone(testCase.state), testCase.input));

    if (!deepEqual(predicted, eventual)) {
      throw new Error(
        `Optimistic property failed for case ${count}: predicted ${formatValue(
          predicted,
        )}, eventual ${formatValue(eventual)}`,
      );
    }

    count += 1;
  }

  return { cases: count };
}

function deepEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function formatValue(value: unknown): string {
  return inspect(value, {
    breakLength: Infinity,
    compact: true,
    depth: Infinity,
    sorted: true,
  });
}

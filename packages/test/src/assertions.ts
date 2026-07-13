import { inspect, isDeepStrictEqual } from 'node:util';
import type { InferSchema, MutationDefinition, MutationResult, Schema } from '@kovojs/server';
import {
  verifierForEachIterable,
  verifierGetOwnPropertyDescriptor,
  verifierIsProxy,
  verifierStructuredClone,
  verifierTypeError,
} from './verifier-security-intrinsics.js';

/** An expected mutation failure: a code, or a code with an expected payload. */
export type MutationErrorExpectation<
  Errors extends Record<string, Schema<unknown>>,
  Code extends Extract<keyof Errors, string>,
> =
  | Code
  | {
      code: Code;
      payload?: InferSchema<Errors[Code]>;
    };

/** One property-test case: an initial `state` and the mutation `input` to apply. */
export interface PropertyCase<State, Input> {
  input: Input;
  state: State;
}

/** Options for `propertyTest`: the optimistic `predict`, the eventual `apply`, the `cases`, and an optional `shape` projection. */
export interface PropertyTestOptions<State, Input, ClientShape = unknown> {
  apply: (state: State, input: Input) => State;
  cases: Iterable<PropertyCase<State, Input>>;
  predict: (state: State, input: Input) => ClientShape;
  shape?: (state: State) => ClientShape;
}

/** The result of `propertyTest`: how many `cases` ran. */
export interface PropertyTestResult {
  cases: number;
}

/**
 * Assert that a mutation result is a typed failure with the expected code (and,
 * optionally, payload), returning the typed payload for further assertions.
 * Throws with a descriptive message on mismatch (SPEC §10.3).
 *
 * @param mutation - The mutation whose result is being checked (for typing and messages).
 * @param result - The `MutationResult` to assert against.
 * @param expected - The expected error code, or `{ code, payload }`.
 * @returns The typed error payload.
 */
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

/**
 * Property-check that an optimistic prediction matches the eventual server
 * result across many cases. For each case it runs `predict` and the real
 * `apply`, projects both with `shape`, and throws on the first divergence —
 * proving the optimistic transform is sound (SPEC §10.4).
 *
 * @param options - The `predict`, `apply`, `cases`, and optional `shape` projection.
 * @returns A `PropertyTestResult` with the number of cases run.
 * @example
 * import { propertyTest } from '@kovojs/test/assertions';
 *
 * type Cart = { count: number };
 *
 * const result = propertyTest<Cart, { quantity: number }>({
 *   apply: (state, input) => ({ count: state.count + input.quantity }),
 *   predict: (state, input) => ({ count: state.count + input.quantity }),
 *   cases: [{ state: { count: 0 }, input: { quantity: 2 } }],
 * });
 * // result.cases === 1
 */
export function propertyTest<State, Input, ClientShape = State>(
  options: PropertyTestOptions<State, Input, ClientShape>,
): PropertyTestResult {
  if (typeof options !== 'object' || options === null || verifierIsProxy(options)) {
    throw verifierTypeError('Optimistic property options must be a stable object.');
  }
  const apply = requiredPropertyFunction<(state: State, input: Input) => State>(
    options,
    'apply',
    'Optimistic property options',
  );
  const predict = requiredPropertyFunction<(state: State, input: Input) => ClientShape>(
    options,
    'predict',
    'Optimistic property options',
  );
  const cases = requiredOwnData(options, 'cases', 'Optimistic property options');
  if (typeof cases !== 'object' || cases === null) {
    throw verifierTypeError('Optimistic property cases must be an iterable object.');
  }
  const shapeValue = optionalOwnData(options, 'shape', 'Optimistic property options');
  if (shapeValue !== undefined && typeof shapeValue !== 'function') {
    throw verifierTypeError('Optimistic property shape must be a function.');
  }
  let count = 0;
  const shape =
    (shapeValue as ((state: State) => ClientShape) | undefined) ??
    ((state: State) => state as unknown as ClientShape);

  verifierForEachIterable<PropertyCase<State, Input>>(
    cases as Iterable<PropertyCase<State, Input>>,
    'Optimistic property cases',
    (testCase, index) => {
      if (typeof testCase !== 'object' || testCase === null || verifierIsProxy(testCase)) {
        throw verifierTypeError(`Optimistic property case ${index} must be a stable object.`);
      }
      const state = verifierStructuredClone(
        requiredOwnData(testCase, 'state', `Optimistic property case ${index}`) as State,
      );
      const input = verifierStructuredClone(
        requiredOwnData(testCase, 'input', `Optimistic property case ${index}`) as Input,
      );
      const predicted = verifierStructuredClone(
        predict(verifierStructuredClone(state), verifierStructuredClone(input)),
      );
      const eventual = verifierStructuredClone(
        shape(apply(verifierStructuredClone(state), verifierStructuredClone(input))),
      );

      if (!deepEqual(predicted, eventual)) {
        throw new Error(
          `Optimistic property failed for case ${count}: predicted ${formatValue(
            predicted,
          )}, eventual ${formatValue(eventual)}`,
        );
      }

      count += 1;
    },
  );

  return { cases: count };
}

function optionalOwnData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw verifierTypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function requiredOwnData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw verifierTypeError(`${label}.${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function requiredPropertyFunction<Callback extends Function>(
  value: object,
  property: PropertyKey,
  label: string,
): Callback {
  const callback = requiredOwnData(value, property, label);
  if (typeof callback !== 'function') {
    throw verifierTypeError(`${label}.${String(property)} must be a function.`);
  }
  return callback as Callback;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function formatValue(value: unknown): string {
  return inspect(value, {
    breakLength: Infinity,
    compact: true,
    customInspect: false,
    depth: Infinity,
    sorted: true,
  });
}

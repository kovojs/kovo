declare const deriveInputBrand: unique symbol;

/**
 * An opaque input capability accepted by the app-facing {@link derive} helper.
 *
 * Query inputs are minted with `derive.query(queryHandle)`; component state and declared clocks
 * use `derive.state<State>()` and `derive.clock<Clocks>()`. The private brand provides rename-safe
 * authoring ergonomics, while the runtime WeakMap rejects structural copies and casts.
 */
export interface DeriveInput<Name extends string = string, Value = unknown> {
  readonly [deriveInputBrand]: {
    readonly name: Name;
    readonly value: Value;
  };
}

/** A derived value: the named inputs it depends on and the `run` that computes it. */
export interface DeriveDefinition<Inputs extends readonly string[], Value> {
  readonly inputs: Inputs;
  run(...values: readonly unknown[]): Value;
}

interface DeriveInputState {
  readonly name: string;
}

const deriveInputs = new WeakMap<object, DeriveInputState>();

function mintDeriveInput<Name extends string, Value>(name: Name): DeriveInput<Name, Value> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('derive input names must be non-empty strings.');
  }
  const input = Object.freeze(Object.create(null) as object);
  deriveInputs.set(input, Object.freeze({ name }));
  return input as DeriveInput<Name, Value>;
}

function inputState(value: unknown, label: string): DeriveInputState {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${label} must be minted by derive.query(), derive.state(), or derive.clock().`);
  }
  const state = deriveInputs.get(value);
  if (state === undefined) {
    throw new TypeError(
      `${label} must be minted by this installed copy of derive.query(), derive.state(), or derive.clock().`,
    );
  }
  return state;
}

function deriveRuntime(
  inputs: readonly unknown[] | Readonly<Record<string, unknown>>,
  fn: unknown,
): DeriveDefinition<readonly string[], unknown> {
  if (typeof fn !== 'function') throw new TypeError('derive() requires a callback.');

  if (Array.isArray(inputs)) {
    const names = inputs.map((input, index) => inputState(input, `derive inputs[${index}]`).name);
    return Object.freeze({ inputs: Object.freeze(names), run: fn }) as DeriveDefinition<
      readonly string[],
      unknown
    >;
  }

  if (typeof inputs !== 'object' || inputs === null) {
    throw new TypeError('derive() inputs must be an opaque-input tuple or object map.');
  }
  const aliases = Object.keys(inputs);
  const names: string[] = [];
  for (let index = 0; index < aliases.length; index += 1) {
    const alias = aliases[index]!;
    const descriptor = Object.getOwnPropertyDescriptor(inputs, alias);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`derive inputs.${alias} must be an own data property.`);
    }
    names.push(inputState(descriptor.value, `derive inputs.${alias}`).name);
  }
  const run = (...values: readonly unknown[]): unknown => {
    const callbackValues: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < aliases.length; index += 1) {
      callbackValues[aliases[index]!] = values[index];
    }
    return Reflect.apply(fn, undefined, [Object.freeze(callbackValues)]);
  };
  return Object.freeze({ inputs: Object.freeze(names), run });
}

function queryInput<const Handle extends { readonly key: string }>(
  handle: Handle,
): DeriveInput<
  Handle['key'],
  'result' extends keyof Handle
    ? Handle extends { readonly result?: infer Value }
      ? Value
      : unknown
    : Handle extends {
          optimistic(status: 'await-fragment'): infer Binding;
        }
      ? Binding extends object
        ? Binding[keyof Binding] extends { readonly value: infer Value }
          ? Value
          : unknown
        : unknown
      : unknown
> {
  if (typeof handle !== 'object' || handle === null) {
    throw new TypeError('derive.query() requires a query registry handle.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(handle, 'key');
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError('derive.query() requires a query handle with an own string key.');
  }
  return mintDeriveInput(descriptor.value);
}

/**
 * App-facing derive constructor (SPEC §4.8).
 *
 * Raw string input tuples are compiler-generated IR and are intentionally accepted only by
 * `@kovojs/browser/generated`.
 */
export function derive<const Inputs extends readonly DeriveInput[], Value>(
  inputs: Inputs,
  fn: (
    ...values: {
      readonly [Index in keyof Inputs]: Inputs[Index] extends DeriveInput<string, infer InputValue>
        ? InputValue
        : never;
    }
  ) => Value,
): DeriveDefinition<
  {
    readonly [Index in keyof Inputs]: Inputs[Index] extends DeriveInput<infer Name, unknown>
      ? Name
      : never;
  },
  Value
>;
export function derive<
  const Inputs extends Readonly<Record<string, DeriveInput>>,
  Value,
>(
  inputs: Inputs,
  fn: (values: {
    readonly [Name in keyof Inputs]: Inputs[Name] extends DeriveInput<string, infer InputValue>
      ? InputValue
      : never;
  }) => Value,
): DeriveDefinition<readonly string[], Value>;
export function derive(
  inputs: readonly unknown[] | Readonly<Record<string, unknown>>,
  fn: unknown,
): DeriveDefinition<readonly string[], unknown> {
  return deriveRuntime(inputs, fn);
}

export namespace derive {
  /** Bind a query registry handle while preserving its result type. */
  export function query<const Handle extends { readonly key: string }>(
    handle: Handle,
  ): DeriveInput<
    Handle['key'],
    'result' extends keyof Handle
      ? Handle extends { readonly result?: infer Value }
        ? Value
        : unknown
      : Handle extends {
            optimistic(status: 'await-fragment'): infer Binding;
          }
        ? Binding extends object
          ? Binding[keyof Binding] extends { readonly value: infer Value }
            ? Value
            : unknown
          : unknown
        : unknown
  > {
    return queryInput(handle);
  }

  /** Bind the component's compiler-owned state input. */
  export function state<Value>(): DeriveInput<'state', Value> {
    return mintDeriveInput('state');
  }

  /** Bind the component's declared `now.*` clock values. */
  export function clock<Value>(): DeriveInput<'now', Value> {
    return mintDeriveInput('now');
  }
}

/**
 * Compiler-emitted derive ABI. Raw names remain authorable lowered IR, but are not reachable from
 * the app-public package root.
 *
 * @internal
 */
export function generatedDerive<const Inputs extends readonly string[], Value>(
  inputs: Inputs,
  fn: (...values: readonly unknown[]) => Value,
): DeriveDefinition<Inputs, Value>;
/** @internal */
export function generatedDerive<
  const Inputs extends Readonly<Record<string, string>>,
  Value,
>(
  inputs: Inputs,
  fn: (values: Readonly<Record<keyof Inputs, unknown>>) => Value,
): DeriveDefinition<readonly string[], Value>;
export function generatedDerive(
  inputs: readonly string[] | Readonly<Record<string, string>>,
  fn: unknown,
): DeriveDefinition<readonly string[], unknown> {
  if (typeof fn !== 'function') throw new TypeError('generated derive requires a callback.');
  if (Array.isArray(inputs)) {
    if (inputs.some((input) => typeof input !== 'string' || input.length === 0)) {
      throw new TypeError('generated derive input names must be non-empty strings.');
    }
    return Object.freeze({ inputs: Object.freeze([...inputs]), run: fn }) as DeriveDefinition<
      readonly string[],
      unknown
    >;
  }
  if (typeof inputs !== 'object' || inputs === null) {
    throw new TypeError('generated derive inputs must be a string tuple or object map.');
  }
  const aliases = Object.keys(inputs);
  const names = aliases.map((alias) => {
    const descriptor = Object.getOwnPropertyDescriptor(inputs, alias);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0
    ) {
      throw new TypeError(`generated derive inputs.${alias} must be an own non-empty string.`);
    }
    return descriptor.value;
  });
  const run = (...values: readonly unknown[]): unknown => {
    const callbackValues: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < aliases.length; index += 1) {
      callbackValues[aliases[index]!] = values[index];
    }
    return Reflect.apply(fn, undefined, [Object.freeze(callbackValues)]);
  };
  return Object.freeze({ inputs: Object.freeze(names), run });
}

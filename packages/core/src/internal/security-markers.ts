type AnyFunction = (...args: any[]) => any;

const securityDecisionBrand: unique symbol = Symbol('kovo.security-decision');
const securityDecisionName: unique symbol = Symbol('kovo.security-decision.name');

/** @internal Non-structural marker for security-decision functions (SPEC.md §6 honesty boundary). */
export type SecurityDecisionFunction<
  Kind extends 'classifier' | 'wire-emitter',
  Name extends string,
  FunctionValue extends AnyFunction,
> = FunctionValue & {
  readonly [securityDecisionBrand]: Kind;
  readonly [securityDecisionName]: Name;
};

/** @internal Brand a classifier without changing call behavior. */
export function securityClassifier<const Name extends string, FunctionValue extends AnyFunction>(
  name: Name,
  fn: FunctionValue,
): SecurityDecisionFunction<'classifier', Name, FunctionValue> {
  return markSecurityDecision('classifier', name, fn);
}

/** @internal Brand a wire emitter without changing call behavior. */
export function wireEmitter<const Name extends string, FunctionValue extends AnyFunction>(
  name: Name,
  fn: FunctionValue,
): SecurityDecisionFunction<'wire-emitter', Name, FunctionValue> {
  return markSecurityDecision('wire-emitter', name, fn);
}

/** @internal Runtime census hook for source-derived gates; not a security proof. */
export function securityDecisionMetadata(
  value: unknown,
): { kind: 'classifier' | 'wire-emitter'; name: string } | undefined {
  if (typeof value !== 'function') return undefined;
  const record = value as Partial<
    Record<typeof securityDecisionBrand, 'classifier' | 'wire-emitter'> &
      Record<typeof securityDecisionName, string>
  >;
  return record[securityDecisionBrand] === undefined || record[securityDecisionName] === undefined
    ? undefined
    : { kind: record[securityDecisionBrand], name: record[securityDecisionName] };
}

function markSecurityDecision<
  Kind extends 'classifier' | 'wire-emitter',
  const Name extends string,
  FunctionValue extends AnyFunction,
>(kind: Kind, name: Name, fn: FunctionValue): SecurityDecisionFunction<Kind, Name, FunctionValue> {
  Object.defineProperties(fn, {
    [securityDecisionBrand]: {
      configurable: false,
      enumerable: false,
      value: kind,
      writable: false,
    },
    [securityDecisionName]: {
      configurable: false,
      enumerable: false,
      value: name,
      writable: false,
    },
  });
  return fn as SecurityDecisionFunction<Kind, Name, FunctionValue>;
}

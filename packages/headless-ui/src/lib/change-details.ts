export interface PrimitiveChangeDetail<Reason extends string, Value = unknown> {
  readonly defaultPrevented: boolean;
  readonly reason: Reason;
  readonly value: Value;
  preventDefault(): void;
}

export interface PrimitiveChangeDetailInput<Reason extends string, Value> {
  reason: Reason;
  value: Value;
}

/**
 * SPEC.md §4.6 keeps primitive cancellation local: author handlers can cancel
 * chained behavior, and primitive change details expose the same
 * defaultPrevented contract for higher-level state changes.
 */
export function createChangeDetail<Reason extends string, Value>(
  input: PrimitiveChangeDetailInput<Reason, Value>,
): PrimitiveChangeDetail<Reason, Value> {
  let defaultPrevented = false;

  return {
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault() {
      defaultPrevented = true;
    },
    reason: input.reason,
    value: input.value,
  };
}

export function dispatchCancelableChange<Reason extends string, Value>(
  input: PrimitiveChangeDetailInput<Reason, Value>,
  onChange: ((detail: PrimitiveChangeDetail<Reason, Value>) => void) | undefined,
): PrimitiveChangeDetail<Reason, Value> {
  const detail = createChangeDetail(input);
  onChange?.(detail);
  return detail;
}

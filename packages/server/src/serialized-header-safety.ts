/**
 * The five-state successful-output postcondition for framework-owned header serializers.
 *
 * States are deliberately numeric and closed so the analysis-only DFA can consume these exact
 * production transitions (SPEC §6.6/§9.1). A terminal state is dangerous when the value contains a
 * header control, an ambiguous reverse-solidus, or an unterminated/ambiguous quoted field.
 *
 * @internal
 */
export const SERIALIZED_HEADER_SAFETY_STATE_COUNT = 5;
export const SERIALIZED_HEADER_SAFETY_START_STATE = 0;

/** @internal Exact production transition consumed by the grammar-containment proof. */
export function serializedHeaderSafetyTransition(state: number, code: number): number {
  if (state === 4 || code === 0x00 || code === 0x0a || code === 0x0d) return 4;
  const quote = code === 0x22;
  const reverseSolidus = code === 0x5c;
  if (state === 0) return quote ? 1 : reverseSolidus ? 4 : 0;
  if (state === 1) return quote ? 3 : reverseSolidus ? 2 : 1;
  if (state === 2) return quote || reverseSolidus ? 1 : 4;
  if (state === 3) return quote || reverseSolidus ? 4 : 3;
  return 4;
}

/** @internal Exact terminal verdict consumed by the grammar-containment proof. */
export function serializedHeaderTerminalIsDangerous(state: number): boolean {
  return state === 1 || state === 2 || state === 4;
}

export interface SerializedHeaderSafetyControls {
  charCodeAt(value: string, index: number): number;
  terminalIsDangerous(state: number): boolean;
  transition(state: number, code: number): number;
}

/**
 * Create the fail-closed postcondition used by both live and generated serializers.
 *
 * Controls are explicit because `build.ts` embeds this closure-free factory and the two reviewed
 * state functions into the generated Node server after capturing its boot-owned string intrinsic.
 *
 * @internal
 */
export function createSerializedHeaderSafetyAssertion(
  controls: SerializedHeaderSafetyControls,
): (value: string, label: string) => string {
  const charCodeAt = controls.charCodeAt;
  const terminalIsDangerous = controls.terminalIsDangerous;
  const transition = controls.transition;

  return function assertSafeSerializedHeader(value: string, label: string): string {
    let state = 0;
    for (let index = 0; index < value.length; index += 1) {
      state = transition(state, charCodeAt(value, index));
      if (state === 4) {
        throw new Error(`${label} serializer produced a forbidden header value`);
      }
    }
    if (terminalIsDangerous(state)) {
      throw new Error(`${label} serializer produced an ambiguous quoted header value`);
    }
    return value;
  };
}

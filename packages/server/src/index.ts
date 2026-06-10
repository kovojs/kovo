export type { DiagnosticCode, JsonValue } from '@jiso/core';

export interface MutationDefinition<Input = unknown> {
  key: string;
  input?: Input;
}

export function mutation<const Key extends string, Input>(
  key: Key,
  definition: Omit<MutationDefinition<Input>, 'key'>,
): MutationDefinition<Input> & { key: Key } {
  return { ...definition, key };
}

import {
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSnapshotDenseArray,
  compilerStringStartsWith,
  compilerStringTrim,
} from './compiler-security-intrinsics.js';
import { deriveMutationKey } from './mutation-names.js';
import type { ComponentModuleModel } from './scan/model.js';
import type { RegistryFacts } from './types.js';

/**
 * Resolve a form binding only when the parser proved an exact Kovo `mutation()` factory call or
 * the generated registry owns the imported binding. Bare identifier spelling is never authority:
 * a local lookalike named `mutation` and a structural `MutationFormDefinition` both fail closed.
 */
export function localMutationKey(
  model: ComponentModuleModel,
  localName: string,
  registryFacts?: RegistryFacts,
  fileName?: string,
): string | null {
  const calls = compilerSnapshotDenseArray(model.calls, 'Mutation declaration calls');
  for (let index = 0; index < calls.length; index += 1) {
    const candidate = calls[index]!;
    if (
      candidate.frameworkFactory === 'mutation' &&
      candidate.exportedConstName === localName &&
      typeof candidate.argumentStaticValues[0] === 'string'
    ) {
      return candidate.argumentStaticValues[0] as string;
    }
  }

  for (let index = 0; index < calls.length; index += 1) {
    const candidate = calls[index]!;
    if (candidate.frameworkFactory !== 'mutation' || candidate.exportedConstName !== localName) {
      continue;
    }
    const args = compilerSnapshotDenseArray(candidate.arguments, 'Mutation call arguments');
    if (
      args.length === 1 &&
      compilerStringStartsWith(compilerRegExpReplace(/^\s+/, args[0]!, ''), '{') &&
      fileName
    ) {
      return deriveMutationKey(fileName, localName);
    }
  }

  // SPEC §5.2 rule 10 / §6.3: cross-module form ownership is admitted only by a scanner-produced,
  // path-scoped project fact. A global `typeof localName` registry spelling is retained below for
  // generated registry callers, but it cannot distinguish two same-named imports in different
  // modules and therefore does not own project-source provenance.
  const projectBindings = registryFacts?.mutationBindings;
  if (projectBindings !== undefined && fileName !== undefined) {
    const bindings = compilerSnapshotDenseArray(projectBindings, 'Project mutation binding facts');
    let resolved: string | null = null;
    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index]!;
      if (binding.fileName !== fileName || binding.localName !== localName) continue;
      if (resolved !== null) return null;
      resolved = binding.key;
    }
    if (resolved !== null) return resolved;
  }

  const mutations = registryFacts?.mutations;
  if (mutations === undefined) return null;
  const keys = compilerObjectKeys(mutations);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const typeSource = compilerOwnDataValue(mutations, key, 'Registry mutation type');
    if (
      typeof typeSource === 'string' &&
      compilerStringTrim(typeSource) === `typeof ${localName}`
    ) {
      return key;
    }
  }

  return null;
}

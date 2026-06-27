import { componentRegistryNamespace } from './component-names.js';
import { kebabCase } from './shared.js';

export interface DerivedRegistryIdentity {
  key: string;
}

/**
 * Derive a source-owned registry identity from the same module namespace rule as components
 * (SPEC.md §4.1 / §6.1). The binding leaf is kebab-cased so Pascal/camel case exports remain
 * stable across primitives and wire surfaces.
 */
export function deriveRegistryIdentity(
  fileName: string,
  exportedBinding: string,
): DerivedRegistryIdentity {
  const leaf = kebabCase(exportedBinding);
  const namespace = componentRegistryNamespace(fileName);
  return { key: namespace ? `${namespace}/${leaf}` : leaf };
}

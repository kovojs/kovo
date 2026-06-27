import { componentRegistryNamespace } from './component-names.js';
import { kebabCase } from './shared.js';

/** @internal Source-derived mutation key for `export const name = mutation({ ... })`. */
export function deriveMutationKey(fileName: string, localName: string): string {
  const leaf = kebabCase(localName);
  const namespace = componentRegistryNamespace(fileName);
  return namespace ? `${namespace}/${leaf}` : leaf;
}

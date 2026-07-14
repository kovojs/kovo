import {
  renderTree as renderTreeInternal,
  type ComponentNode,
  type ComponentRegistry,
  type RenderTreeOptions,
} from './render-tree.js';
import { assertServerRequestSafeRuntimeRealmLocked } from './security-bootstrap.js';

/** Render registered authored callbacks only in a request-safe bootstrapped realm (SPEC §4.10/§6.6). */
export function renderTree(
  registry: ComponentRegistry,
  nodes: ComponentNode | readonly ComponentNode[],
  options: RenderTreeOptions = {},
): Promise<string> {
  assertServerRequestSafeRuntimeRealmLocked('renderTree()');
  return renderTreeInternal(registry, nodes, options);
}

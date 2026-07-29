import './security-bootstrap.js';

export { parseComponentXml, renderRegistry, renderTree } from './render-tree.js';
export type {
  ComponentElementNode,
  ComponentNode,
  ComponentRegistry,
  ComponentRegistryEntry,
  ComponentRegistryInput,
  ComponentTextNode,
  RenderTreeOptions,
} from './render-tree.js';
export { ComponentXmlError } from './render-tree.js';

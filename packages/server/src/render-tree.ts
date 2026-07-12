import type { Component, ComponentDefinitionInput } from '@kovojs/core';

import { isKovoComponentDescriptor } from './component-authority.js';
import { escapeText, renderedHtml, renderHtmlValue } from './html.js';
import { jsx } from './jsx-runtime.js';
import {
  securityArrayPush,
  securityNumberIsFinite,
  securityNumberParseInt,
  securityRegExpReplaceMatches,
  securityRegExpTest,
  securityStringFromCodePoint,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringSlice,
  securityStringStartsWith,
} from './response-security-intrinsics.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessObjectIs,
  witnessObjectKeys,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetDelete,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';
import { isSchemaValidationError, snapshotSchemaForRuntime, type Schema } from './schema.js';

// RenderTree: registry-bounded dynamic rendering (SPEC.md §4.10).
//
// Renders rich text authored by an LLM or read from a database that embeds a CLOSED set of
// pre-approved components as well-formed XML tags. The untrusted string is parsed into a plain
// JSON AST (the trust boundary, §4.10), validated against per-component schemas (§6.3), and
// rendered server-side by dispatching through the server JSX runtime (`jsx`). The dynamic *shape*
// of the tree is data-driven; the *set* of renderable components is statically declared.
//
// Safety (§4.8): the walker escapes text nodes itself, brands composed child HTML before handing
// it to the JSX runtime, passes only schema-declared props (no `{...attrs}` passthrough), and
// never produces `trustedHtml`. Attribute/URL emission additionally routes through the JSX runtime's
// `escapeAttribute`/`safeUrlAttribute` and its `on*`/`srcdoc` refusal.

/** A literal character-data node parsed from rich-text source (SPEC §4.10). */
export interface ComponentTextNode {
  type: 'text';
  value: string;
}

/** A parsed element node: a `tag`, its decoded string `attributes`, and child nodes (SPEC §4.10). */
export interface ComponentElementNode {
  type: 'element';
  tag: string;
  attributes: Record<string, string>;
  children: ComponentNode[];
}

/** A node in a parsed rich-text AST (SPEC §4.10). */
export type ComponentNode = ComponentElementNode | ComponentTextNode;

/** Thrown by {@link parseComponentXml} when the source is not well-formed (SPEC §4.10). */
export class ComponentXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComponentXmlError';
  }
}

/**
 * One pre-approved registry entry: the component to render plus the `s.object({...})` schema that
 * validates the LLM-supplied attributes for this tag (SPEC §4.10, §6.3). Reusing the component's
 * own prop schema keeps validation and rendering in sync. When `props` is omitted, attributes pass
 * through as strings (still attribute-escaped and URL-scheme-checked at emission by the JSX runtime).
 */
export interface ComponentRegistryEntry {
  component: Component<ComponentDefinitionInput>;
  props?: Schema<Record<string, unknown>>;
}

/** Input accepted by {@link renderRegistry}: tag → component, or tag → `{ component, props }` (SPEC §4.10). */
export type ComponentRegistryInput = Record<
  string,
  ComponentRegistryEntry | Component<ComponentDefinitionInput>
>;

/** A closed, branded set of pre-approved components produced by {@link renderRegistry} (SPEC §4.10). */
export interface ComponentRegistry {
  readonly __kovoComponentRegistry: true;
  readonly entries: ReadonlyMap<string, ComponentRegistryEntry>;
}

/** Behavior for a tag absent from the registry (SPEC §4.10). */
export interface RenderTreeOptions {
  /**
   * What to do with an element whose tag has no registry entry. `'text'` (default) renders the
   * element's children and drops the unknown wrapper; `'drop'` omits the element entirely.
   */
  unknownTag?: 'drop' | 'text';
}

interface ClosedRegistryEntry {
  readonly component: Component<ComponentDefinitionInput>;
  readonly props?: Schema<Record<string, unknown>>;
}

interface SnapshotTextNode {
  readonly type: 'text';
  readonly value: string;
}

interface SnapshotElementNode {
  readonly type: 'element';
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SnapshotNode[];
}

type SnapshotNode = SnapshotElementNode | SnapshotTextNode;

const registrySnapshots = createWitnessWeakMap<
  ComponentRegistry,
  Map<string, ClosedRegistryEntry>
>();
const XML_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/;
const MAX_RENDER_TREE_DEPTH = 256;
const MAX_RENDER_TREE_NODES = 100_000;
const MAX_RENDER_TREE_ATTRIBUTES = 1_024;
const MAX_RENDER_TREE_SOURCE_CODE_UNITS = 1_000_000;

/**
 * Build a closed component registry for {@link renderTree}. A tag with no entry can never render a
 * component, so the registry IS the pre-approval boundary (SPEC §4.10). Each entry may be a bare
 * `Component` (attributes pass through as strings) or `{ component, props }` to validate attributes
 * against the component's own `s.object({...})` schema.
 *
 * @example
 * const registry = renderRegistry({
 *   'kovo-chart': { component: Chart, props: chartProps },
 *   'kovo-card': { component: Card, props: cardProps },
 * });
 */
export function renderRegistry(input: ComponentRegistryInput): ComponentRegistry {
  if (typeof input !== 'object' || input === null || witnessIsArray(input)) {
    throw new TypeError('renderRegistry() requires a stable own-data registry record.');
  }
  const tags = stableObjectKeys(input, 'renderRegistry() input');
  const entries = createWitnessMap<string, ClosedRegistryEntry>();
  const publicEntries = createWitnessMap<string, ComponentRegistryEntry>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]!;
    if (!securityRegExpTest(XML_NAME, tag)) {
      throw new TypeError(`renderRegistry() tag ${tag} is not a well-formed XML name.`);
    }
    const value = stableOwnDataValue(input, tag, `renderRegistry().${tag}`);
    const entry = snapshotRegistryEntry(value, tag);
    witnessMapSet(entries, tag, entry);
    witnessMapSet(publicEntries, tag, entry);
  }

  const registry = witnessFreeze({
    __kovoComponentRegistry: true as const,
    entries: witnessFreeze(publicEntries) as ReadonlyMap<string, ComponentRegistryEntry>,
  }) as ComponentRegistry;
  witnessWeakMapSet(registrySnapshots, registry, entries);
  return registry;
}

/**
 * Render a parsed rich-text AST to a safe HTML string by dispatching each element to its
 * pre-approved component (SPEC §4.10). Runs server-side and once; the dynamic shape is data-driven
 * while the renderable set is the closed {@link ComponentRegistry}.
 *
 * Text nodes are HTML-escaped; element attributes are validated against the registered schema and
 * only declared props reach the component; invalid attributes are dropped (re-parsed without the
 * offending keys) and an unknown tag renders its children with the wrapper dropped (SPEC §4.10).
 *
 * @example
 * const html = await renderTree(registry, parseComponentXml(llmResponse));
 */
export async function renderTree(
  registry: ComponentRegistry,
  nodes: ComponentNode | readonly ComponentNode[],
  options: RenderTreeOptions = {},
): Promise<string> {
  if ((typeof registry !== 'object' && typeof registry !== 'function') || registry === null) {
    throw new TypeError('renderTree() requires a registry minted by renderRegistry().');
  }
  const entries = witnessWeakMapGet(registrySnapshots, registry);
  if (entries === undefined) {
    throw new TypeError('renderTree() requires a registry minted by renderRegistry().');
  }
  const unknownTag = snapshotUnknownTag(options);
  const context: SnapshotContext = {
    active: createWitnessWeakSet<object>(),
    count: 0,
  };
  const list = witnessIsArray(nodes)
    ? snapshotNodeArray(nodes, context, 0, 'renderTree() nodes')
    : witnessFreeze([snapshotNode(nodes, context, 0, 'renderTree() node')]);
  return renderNodeList(entries, list, unknownTag);
}

async function renderNode(
  entries: Map<string, ClosedRegistryEntry>,
  node: SnapshotNode,
  unknownTag: 'drop' | 'text',
): Promise<string> {
  if (node.type === 'text') return renderHtmlValue(escapeText(node.value));

  const entry = witnessMapGet(entries, node.tag);
  if (!entry) return renderUnknown(entries, node, unknownTag);

  const validated = validateAttributes(entry.props, node.attributes);
  // Fail-soft (SPEC §4.10): unrecoverable attributes (e.g. a missing required prop) fall back to
  // the unknown-tag posture rather than rendering a malformed component.
  if (validated === null) return renderUnknown(entries, node, unknownTag);

  const childrenHtml = await renderNodeList(entries, node.children, unknownTag);
  // `childrenHtml` is already safe, fully-rendered HTML; keep it branded so the JSX runtime
  // composes it as framework HTML instead of escaping it again (SPEC §4.10).
  const props = snapshotOwnDataRecord(validated, 'renderTree() validated props');
  witnessDefineProperty(props, 'children', {
    configurable: true,
    enumerable: true,
    value: renderedHtml(childrenHtml),
    writable: true,
  });
  const rendered = jsx(entry.component, props);
  return renderHtmlValue(await rendered);
}

async function renderUnknown(
  entries: Map<string, ClosedRegistryEntry>,
  node: SnapshotElementNode,
  unknownTag: 'drop' | 'text',
): Promise<string> {
  if (unknownTag === 'drop') return '';
  return renderNodeList(entries, node.children, unknownTag);
}

async function renderNodeList(
  entries: Map<string, ClosedRegistryEntry>,
  nodes: readonly SnapshotNode[],
  unknownTag: 'drop' | 'text',
): Promise<string> {
  let html = '';
  for (let index = 0; index < nodes.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(nodes, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('renderTree() internal node snapshot is not dense.');
    }
    html += await renderNode(entries, descriptor.value as SnapshotNode, unknownTag);
  }
  return html;
}

/**
 * Validate decoded attributes against a registered schema, returning the schema-declared props or
 * `null` when the attributes cannot be repaired. Fail-soft strips the offending top-level keys
 * (located via `SchemaValidationError.issues[].path`) and re-parses, so a bad optional attribute is
 * dropped while a missing required one yields `null` (SPEC §4.10, decision: drop/default bad attrs).
 */
function validateAttributes(
  schema: Schema<Record<string, unknown>> | undefined,
  attributes: Readonly<Record<string, string>>,
): Record<string, unknown> | null {
  if (!schema) return snapshotOwnDataRecord(attributes, 'renderTree() attributes');

  const attributeKeys = stableObjectKeys(attributes, 'renderTree() attributes');
  let working = snapshotOwnDataRecord(attributes, 'renderTree() attributes');
  const parse = stableOwnDataValue(schema, 'parse', 'renderTree() schema.parse');
  if (typeof parse !== 'function') {
    throw new TypeError('renderTree() schema.parse must be a stable data method.');
  }
  // Bounded by the attribute count: each failing pass removes ≥1 present key or gives up.
  for (let attempt = 0; attempt <= attributeKeys.length; attempt += 1) {
    try {
      const parsed = witnessReflectApply<unknown>(parse, schema, [working]);
      return snapshotOwnDataRecord(parsed, 'renderTree() schema result');
    } catch (error) {
      if (!isSchemaValidationError(error)) throw error;
      const offending = validationIssueKeys(error);
      if (offending.length === 0) return null; // object-level failure — cannot localize
      let removed = false;
      const next = witnessCreateNullRecord<unknown>();
      const workingKeys = stableObjectKeys(working, 'renderTree() working attributes');
      for (let index = 0; index < workingKeys.length; index += 1) {
        const key = workingKeys[index]!;
        if (stringArrayIncludes(offending, key)) {
          removed = true;
          continue;
        }
        defineSnapshotDataProperty(
          next,
          key,
          stableOwnDataValue(working, key, `renderTree() working attributes.${key}`),
        );
      }
      if (!removed) return null; // offending key is absent (e.g. missing required prop)
      working = witnessFreeze(next) as Record<string, unknown>;
    }
  }
  return null;
}

function snapshotRegistryEntry(value: unknown, tag: string): ClosedRegistryEntry {
  let component: unknown;
  let props: unknown;
  if (isKovoComponentDescriptor(value)) {
    component = value;
  } else {
    if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
      throw new TypeError(
        `renderRegistry().${tag} must be a Kovo component with component() provenance or registry entry.`,
      );
    }
    component = stableOwnDataValue(value, 'component', `renderRegistry().${tag}.component`);
    props = stableOwnDataValue(value, 'props', `renderRegistry().${tag}.props`, false);
  }
  if (!isKovoComponentDescriptor(component)) {
    throw new TypeError(
      `renderRegistry().${tag}.component requires framework component() provenance.`,
    );
  }
  if (componentIsIsomorphic(component)) {
    throw new TypeError(
      `renderRegistry().${tag}.component must be server-renderable, not isomorphic (SPEC.md §4.10).`,
    );
  }
  const closedProps =
    props === undefined
      ? undefined
      : snapshotSchemaForRuntime(
          props as Schema<Record<string, unknown>>,
          `renderRegistry().${tag}.props`,
        );
  return witnessFreeze({
    component,
    ...(closedProps === undefined ? {} : { props: closedProps }),
  });
}

interface SnapshotContext {
  readonly active: WeakSet<object>;
  count: number;
}

function snapshotUnknownTag(options: RenderTreeOptions): 'drop' | 'text' {
  if (typeof options !== 'object' || options === null || witnessIsArray(options)) {
    throw new TypeError('renderTree() options must be a stable own-data record.');
  }
  const value = stableOwnDataValue(options, 'unknownTag', 'renderTree() options.unknownTag', false);
  if (value === undefined || value === 'text') return 'text';
  if (value === 'drop') return 'drop';
  throw new TypeError('renderTree() options.unknownTag must be "drop" or "text".');
}

function snapshotNodeArray(
  values: readonly unknown[],
  context: SnapshotContext,
  depth: number,
  label: string,
): readonly SnapshotNode[] {
  const length = stableArrayLength(values, label);
  const snapshot: SnapshotNode[] = [];
  for (let index = 0; index < length; index += 1) {
    securityArrayPush(
      snapshot,
      snapshotNode(stableArrayValue(values, index, label), context, depth, `${label}[${index}]`),
    );
  }
  return witnessFreeze(snapshot);
}

function snapshotNode(
  value: unknown,
  context: SnapshotContext,
  depth: number,
  label: string,
): SnapshotNode {
  if (depth > MAX_RENDER_TREE_DEPTH) {
    throw new TypeError(
      `renderTree() exceeds the ${MAX_RENDER_TREE_DEPTH}-level tree depth bound.`,
    );
  }
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be a stable own-data ComponentNode.`);
  }
  if (witnessWeakSetHas(context.active, value)) {
    throw new TypeError(`${label} contains a cyclic ComponentNode graph.`);
  }
  context.count += 1;
  if (context.count > MAX_RENDER_TREE_NODES) {
    throw new TypeError(`renderTree() exceeds the ${MAX_RENDER_TREE_NODES}-node bound.`);
  }
  witnessWeakSetAdd(context.active, value);
  try {
    const type = stableOwnDataValue(value, 'type', `${label}.type`);
    if (type === 'text') {
      const text = stableOwnDataValue(value, 'value', `${label}.value`);
      if (typeof text !== 'string') throw new TypeError(`${label}.value must be a string.`);
      return witnessFreeze({ type: 'text' as const, value: text });
    }
    if (type !== 'element') {
      throw new TypeError(`${label}.type must be "text" or "element".`);
    }
    const tag = stableOwnDataValue(value, 'tag', `${label}.tag`);
    if (typeof tag !== 'string' || !securityRegExpTest(XML_NAME, tag)) {
      throw new TypeError(`${label}.tag must be a well-formed XML name.`);
    }
    const rawAttributes = stableOwnDataValue(value, 'attributes', `${label}.attributes`);
    const attributes = snapshotStringRecord(rawAttributes, `${label}.attributes`);
    const rawChildren = stableOwnDataValue(value, 'children', `${label}.children`);
    if (!witnessIsArray(rawChildren)) throw new TypeError(`${label}.children must be an array.`);
    const children = snapshotNodeArray(rawChildren, context, depth + 1, `${label}.children`);
    return witnessFreeze({ attributes, children, tag, type: 'element' as const });
  } finally {
    witnessWeakSetDelete(context.active, value);
  }
}

function snapshotStringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be a stable own-data string record.`);
  }
  const keys = stableObjectKeys(value, label);
  if (keys.length > MAX_RENDER_TREE_ATTRIBUTES) {
    throw new TypeError(`${label} exceeds the ${MAX_RENDER_TREE_ATTRIBUTES}-attribute bound.`);
  }
  const snapshot = witnessCreateNullRecord<string>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entry = stableOwnDataValue(value, key, `${label}.${key}`);
    if (typeof entry !== 'string') throw new TypeError(`${label}.${key} must be a string.`);
    defineSnapshotDataProperty(snapshot, key, entry);
  }
  return witnessFreeze(snapshot);
}

function snapshotOwnDataRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || witnessIsArray(value)) {
    throw new TypeError(`${label} must be a stable own-data record.`);
  }
  const snapshot = witnessCreateNullRecord<unknown>();
  const keys = stableObjectKeys(value, label);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    defineSnapshotDataProperty(snapshot, key, stableOwnDataValue(value, key, `${label}.${key}`));
  }
  return snapshot;
}

function validationIssueKeys(error: object): string[] {
  const issues = stableOwnDataValue(error, 'issues', 'renderTree() schema error.issues');
  if (!witnessIsArray(issues)) {
    throw new TypeError('renderTree() schema error issues changed during validation.');
  }
  const keys: string[] = [];
  const issueCount = stableArrayLength(issues, 'renderTree() schema error.issues');
  for (let index = 0; index < issueCount; index += 1) {
    const issue = stableArrayValue(issues, index, 'renderTree() schema error.issues');
    if (typeof issue !== 'object' || issue === null || witnessIsArray(issue)) {
      throw new TypeError('renderTree() schema issue changed during validation.');
    }
    const path = stableOwnDataValue(issue, 'path', `renderTree() schema issue ${index}.path`);
    if (!witnessIsArray(path)) {
      throw new TypeError('renderTree() schema issue path changed during validation.');
    }
    if (stableArrayLength(path, `renderTree() schema issue ${index}.path`) === 0) continue;
    const key = stableArrayValue(path, 0, `renderTree() schema issue ${index}.path`);
    if (typeof key === 'string' && key.length > 0 && !stringArrayIncludes(keys, key)) {
      securityArrayPush(keys, key);
    }
  }
  return keys;
}

function componentIsIsomorphic(component: Component<ComponentDefinitionInput>): boolean {
  const definition = stableOwnDataValue(component, 'definition', 'Kovo component definition');
  if (typeof definition !== 'object' || definition === null || witnessIsArray(definition)) {
    throw new TypeError('Kovo component definition must be a stable own-data record.');
  }
  return (
    stableOwnDataValue(definition, 'isomorphic', 'Kovo component definition.isomorphic', false) ===
    true
  );
}

function stableObjectKeys(value: object, label: string): string[] {
  const before = witnessObjectKeys(value);
  const after = witnessObjectKeys(value);
  if (before.length !== after.length) throw new TypeError(`${label} changed while being closed.`);
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) throw new TypeError(`${label} changed while being closed.`);
  }
  return before;
}

function stableOwnDataValue(
  value: object,
  property: PropertyKey,
  label: string,
  required = true,
): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if (before !== undefined && !('value' in before)) {
    throw new TypeError(`${label} must be an own data property.`);
  }
  if (!sameDataDescriptor(before, after)) {
    throw new TypeError(`${label} changed while being closed.`);
  }
  if (before === undefined) {
    if (!required) return undefined;
    throw new TypeError(`${label} must be an own data property.`);
  }
  if (!('value' in before)) throw new TypeError(`${label} must be an own data property.`);
  return before.value;
}

function stableArrayLength(values: readonly unknown[], label: string): number {
  const length = stableOwnDataValue(values, 'length', `${label}.length`);
  if (typeof length !== 'number' || length < 0 || length > 0xffff_ffff || length % 1 !== 0) {
    throw new TypeError(`${label} must have a stable array length.`);
  }
  return length;
}

function stableArrayValue(values: readonly unknown[], index: number, label: string): unknown {
  return stableOwnDataValue(values, index, `${label}[${index}]`);
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    witnessObjectIs(left.value, right.value) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

function defineSnapshotDataProperty(
  target: Record<PropertyKey, unknown>,
  property: PropertyKey,
  value: unknown,
): void {
  witnessDefineProperty(target, property, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function stringArrayIncludes(values: readonly string[], key: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === key) return true;
  }
  return false;
}

/**
 * Parse well-formed rich-text XML into a {@link ComponentNode} AST (SPEC §4.10). Handles elements,
 * single/double-quoted and boolean attributes, self-closing tags, text, comments, processing
 * instructions, and `CDATA`, decoding the standard XML entities. The result is plain data — it is
 * never reconstituted into HTML — so parsing is the trust boundary and can run at write time.
 *
 * Throws {@link ComponentXmlError} on malformed input (mismatched or unclosed tags, stray markup);
 * v1 assumes the source is well-formed.
 */
export function parseComponentXml(source: string): ComponentNode[] {
  if (typeof source !== 'string')
    throw new TypeError('parseComponentXml() source must be a string.');
  if (source.length > MAX_RENDER_TREE_SOURCE_CODE_UNITS) {
    throw new ComponentXmlError(
      `Rich-text source exceeds the ${MAX_RENDER_TREE_SOURCE_CODE_UNITS}-code-unit bound`,
    );
  }
  return new XmlCursor(source).parseRoot();
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const WHITESPACE = /\s/;

class XmlCursor {
  readonly #src: string;
  #pos = 0;
  #depth = 0;
  #nodeCount = 0;

  constructor(src: string) {
    this.#src = src;
  }

  parseRoot(): ComponentNode[] {
    const nodes = this.#parseChildren(null);
    if (this.#pos < this.#src.length) {
      throw new ComponentXmlError(`Unexpected content at position ${this.#pos}`);
    }
    return nodes;
  }

  #parseChildren(parentTag: string | null): ComponentNode[] {
    const nodes: ComponentNode[] = [];
    while (this.#pos < this.#src.length) {
      if (this.#src[this.#pos] === '<') {
        if (this.#startsWith('<!--')) {
          this.#skipComment();
          continue;
        }
        if (this.#startsWith('<![CDATA[')) {
          this.#appendNode(nodes, this.#readCdata());
          continue;
        }
        if (this.#startsWith('<?') || this.#startsWith('<!')) {
          this.#skipUntil('>');
          continue;
        }
        if (this.#startsWith('</')) {
          if (parentTag === null) {
            throw new ComponentXmlError(`Unexpected closing tag at position ${this.#pos}`);
          }
          return nodes; // the enclosing element consumes and verifies the close tag
        }
        this.#appendNode(nodes, this.#parseElement());
      } else {
        const text = this.#readText();
        if (text.length > 0) this.#appendNode(nodes, { type: 'text', value: text });
      }
    }
    if (parentTag !== null) throw new ComponentXmlError(`Unclosed element <${parentTag}>`);
    return nodes;
  }

  #parseElement(): ComponentElementNode {
    this.#expect('<');
    const tag = this.#readName();
    const attributes = this.#readAttributes();
    this.#skipWhitespace();

    if (this.#startsWith('/>')) {
      this.#pos += 2;
      return { type: 'element', tag, attributes, children: [] };
    }
    this.#expect('>');

    this.#depth += 1;
    if (this.#depth > MAX_RENDER_TREE_DEPTH) {
      throw new ComponentXmlError(
        `Rich-text source exceeds the ${MAX_RENDER_TREE_DEPTH}-level depth bound`,
      );
    }
    let children: ComponentNode[];
    try {
      children = this.#parseChildren(tag);
    } finally {
      this.#depth -= 1;
    }
    this.#expect('</');
    const closeName = this.#readName();
    this.#skipWhitespace();
    this.#expect('>');
    if (closeName !== tag) {
      throw new ComponentXmlError(`Mismatched closing tag </${closeName}> for <${tag}>`);
    }
    return { type: 'element', tag, attributes, children };
  }

  #readAttributes(): Record<string, string> {
    const attributes = witnessCreateNullRecord<string>() as Record<string, string>;
    for (;;) {
      this.#skipWhitespace();
      const ch = this.#src[this.#pos];
      if (ch === undefined || ch === '>' || ch === '/') break;

      const name = this.#readName();
      if (witnessGetOwnPropertyDescriptor(attributes, name) !== undefined) {
        throw new ComponentXmlError(`Duplicate attribute '${name}' at position ${this.#pos}`);
      }
      if (witnessObjectKeys(attributes).length >= MAX_RENDER_TREE_ATTRIBUTES) {
        throw new ComponentXmlError(
          `Element exceeds the ${MAX_RENDER_TREE_ATTRIBUTES}-attribute bound`,
        );
      }
      this.#skipWhitespace();
      let value = '';
      if (this.#src[this.#pos] === '=') {
        this.#pos += 1;
        this.#skipWhitespace();
        value = this.#readQuotedValue();
      }
      defineSnapshotDataProperty(attributes, name, value);
    }
    return attributes;
  }

  #readQuotedValue(): string {
    const quote = this.#src[this.#pos];
    if (quote !== '"' && quote !== "'") {
      throw new ComponentXmlError(`Expected quoted attribute value at position ${this.#pos}`);
    }
    this.#pos += 1;
    const start = this.#pos;
    while (this.#pos < this.#src.length && this.#src[this.#pos] !== quote) this.#pos += 1;
    if (this.#pos >= this.#src.length) {
      throw new ComponentXmlError('Unterminated attribute value');
    }
    const raw = securityStringSlice(this.#src, start, this.#pos);
    this.#pos += 1; // closing quote
    return decodeEntities(raw);
  }

  #readName(): string {
    const start = this.#pos;
    if (!securityRegExpTest(NAME_START, this.#src[this.#pos] ?? '')) {
      throw new ComponentXmlError(`Expected name at position ${this.#pos}`);
    }
    this.#pos += 1;
    while (
      this.#pos < this.#src.length &&
      securityRegExpTest(NAME_CHAR, this.#src[this.#pos] ?? '')
    ) {
      this.#pos += 1;
    }
    return securityStringSlice(this.#src, start, this.#pos);
  }

  #readText(): string {
    const start = this.#pos;
    while (this.#pos < this.#src.length && this.#src[this.#pos] !== '<') this.#pos += 1;
    return decodeEntities(securityStringSlice(this.#src, start, this.#pos));
  }

  #readCdata(): ComponentTextNode {
    this.#pos += '<![CDATA['.length;
    const end = securityStringIndexOf(this.#src, ']]>', this.#pos);
    if (end === -1) throw new ComponentXmlError('Unterminated CDATA section');
    const value = securityStringSlice(this.#src, this.#pos, end);
    this.#pos = end + ']]>'.length;
    return { type: 'text', value };
  }

  #skipComment(): void {
    const end = securityStringIndexOf(this.#src, '-->', this.#pos);
    if (end === -1) throw new ComponentXmlError('Unterminated comment');
    this.#pos = end + '-->'.length;
  }

  #skipUntil(marker: string): void {
    const end = securityStringIndexOf(this.#src, marker, this.#pos);
    if (end === -1) throw new ComponentXmlError(`Expected '${marker}'`);
    this.#pos = end + marker.length;
  }

  #skipWhitespace(): void {
    while (
      this.#pos < this.#src.length &&
      securityRegExpTest(WHITESPACE, this.#src[this.#pos] ?? '')
    ) {
      this.#pos += 1;
    }
  }

  #startsWith(prefix: string): boolean {
    return securityStringStartsWith(this.#src, prefix, this.#pos);
  }

  #expect(token: string): void {
    if (!this.#startsWith(token)) {
      throw new ComponentXmlError(`Expected '${token}' at position ${this.#pos}`);
    }
    this.#pos += token.length;
  }

  #appendNode(nodes: ComponentNode[], node: ComponentNode): void {
    this.#nodeCount += 1;
    if (this.#nodeCount > MAX_RENDER_TREE_NODES) {
      throw new ComponentXmlError(
        `Rich-text source exceeds the ${MAX_RENDER_TREE_NODES}-node bound`,
      );
    }
    securityArrayPush(nodes, node);
  }
}

const ENTITY_REFERENCE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g;

function decodeEntities(value: string): string {
  if (!securityStringIncludes(value, '&')) return value;
  return securityRegExpReplaceMatches(value, ENTITY_REFERENCE, (parts) => {
    const match = parts[0];
    const body = parts[1];
    if (typeof match !== 'string' || typeof body !== 'string') {
      throw new ComponentXmlError('Malformed XML entity');
    }
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? securityNumberParseInt(securityStringSlice(body, 2), 16)
          : securityNumberParseInt(securityStringSlice(body, 1), 10);
      return securityNumberIsFinite(codePoint) ? securityStringFromCodePoint(codePoint) : match;
    }
    switch (body) {
      case 'amp':
        return '&';
      case 'apos':
        return "'";
      case 'gt':
        return '>';
      case 'lt':
        return '<';
      case 'quot':
        return '"';
      default:
        return match;
    }
  });
}

import type { Component, ComponentDefinitionInput } from '@kovojs/core';

import { escapeText } from './html.js';
import { jsx } from './jsx-runtime.js';
import { isSchemaValidationError, type Schema } from './schema.js';

// RenderTree: registry-bounded dynamic rendering (SPEC.md §4.10).
//
// Renders rich text authored by an LLM or read from a database that embeds a CLOSED set of
// pre-approved components as well-formed XML tags. The untrusted string is parsed into a plain
// JSON AST (the trust boundary, §4.10), validated against per-component schemas (§6.3), and
// rendered server-side by dispatching through the server JSX runtime (`jsx`). The dynamic *shape*
// of the tree is data-driven; the *set* of renderable components is statically declared.
//
// Safety (§4.8): the walker escapes text nodes itself — the raw JSX runtime inserts children
// verbatim (jsx-runtime.ts) — passes only schema-declared props (no `{...attrs}` passthrough),
// and never produces `trustedHtml`. Attribute/URL emission additionally routes through the JSX
// runtime's `escapeAttribute`/`safeUrlAttribute` and its `on*`/`srcdoc` refusal.

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
  const entries = new Map<string, ComponentRegistryEntry>();
  for (const [tag, value] of Object.entries(input)) {
    entries.set(tag, isRegistryEntry(value) ? value : { component: value });
  }
  return { __kovoComponentRegistry: true, entries };
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
  const list = Array.isArray(nodes) ? nodes : [nodes as ComponentNode];
  const parts = await Promise.all(list.map((node) => renderNode(registry, node, options)));
  return parts.join('');
}

async function renderNode(
  registry: ComponentRegistry,
  node: ComponentNode,
  options: RenderTreeOptions,
): Promise<string> {
  if (node.type === 'text') return escapeText(node.value);

  const entry = registry.entries.get(node.tag);
  if (!entry) return renderUnknown(registry, node, options);

  const validated = validateAttributes(entry.props, node.attributes);
  // Fail-soft (SPEC §4.10): unrecoverable attributes (e.g. a missing required prop) fall back to
  // the unknown-tag posture rather than rendering a malformed component.
  if (validated === null) return renderUnknown(registry, node, options);

  const childrenHtml = await renderTree(registry, node.children, options);
  // `childrenHtml` is already safe, fully-rendered HTML; the JSX runtime inserts a string child
  // verbatim, which is correct here because the walker escaped/composed it (SPEC §4.10).
  const rendered = jsx(entry.component, { ...validated, children: childrenHtml });
  return await rendered;
}

async function renderUnknown(
  registry: ComponentRegistry,
  node: ComponentElementNode,
  options: RenderTreeOptions,
): Promise<string> {
  if (options.unknownTag === 'drop') return '';
  return renderTree(registry, node.children, options);
}

/**
 * Validate decoded attributes against a registered schema, returning the schema-declared props or
 * `null` when the attributes cannot be repaired. Fail-soft strips the offending top-level keys
 * (located via `SchemaValidationError.issues[].path`) and re-parses, so a bad optional attribute is
 * dropped while a missing required one yields `null` (SPEC §4.10, decision: drop/default bad attrs).
 */
function validateAttributes(
  schema: Schema<Record<string, unknown>> | undefined,
  attributes: Record<string, string>,
): Record<string, unknown> | null {
  if (!schema) return { ...attributes };

  let working: Record<string, unknown> = { ...attributes };
  // Bounded by the attribute count: each failing pass removes ≥1 present key or gives up.
  for (let attempt = 0; attempt <= Object.keys(attributes).length; attempt += 1) {
    try {
      return schema.parse(working);
    } catch (error) {
      if (!isSchemaValidationError(error)) throw error;
      const offending = new Set(
        error.issues.map((issue) => issue.path[0]).filter((key): key is string => Boolean(key)),
      );
      if (offending.size === 0) return null; // object-level failure — cannot localize
      let removed = false;
      for (const key of offending) {
        if (Object.hasOwn(working, key)) {
          const next = { ...working };
          delete next[key];
          working = next;
          removed = true;
        }
      }
      if (!removed) return null; // offending key is absent (e.g. missing required prop)
    }
  }
  return null;
}

function isRegistryEntry(
  value: ComponentRegistryEntry | Component<ComponentDefinitionInput>,
): value is ComponentRegistryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'component' in value &&
    typeof (value as ComponentRegistryEntry).component === 'function'
  );
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
  return new XmlCursor(source).parseRoot();
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[-A-Za-z0-9_:.]/;
const WHITESPACE = /\s/;

class XmlCursor {
  readonly #src: string;
  #pos = 0;

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
          nodes.push(this.#readCdata());
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
        nodes.push(this.#parseElement());
      } else {
        const text = this.#readText();
        if (text.length > 0) nodes.push({ type: 'text', value: text });
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

    const children = this.#parseChildren(tag);
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
    const attributes: Record<string, string> = {};
    for (;;) {
      this.#skipWhitespace();
      const ch = this.#src[this.#pos];
      if (ch === undefined || ch === '>' || ch === '/') break;

      const name = this.#readName();
      this.#skipWhitespace();
      if (this.#src[this.#pos] === '=') {
        this.#pos += 1;
        this.#skipWhitespace();
        attributes[name] = this.#readQuotedValue();
      } else {
        attributes[name] = ''; // boolean attribute
      }
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
    const raw = this.#src.slice(start, this.#pos);
    this.#pos += 1; // closing quote
    return decodeEntities(raw);
  }

  #readName(): string {
    const start = this.#pos;
    if (!NAME_START.test(this.#src[this.#pos] ?? '')) {
      throw new ComponentXmlError(`Expected name at position ${this.#pos}`);
    }
    this.#pos += 1;
    while (this.#pos < this.#src.length && NAME_CHAR.test(this.#src[this.#pos] ?? '')) {
      this.#pos += 1;
    }
    return this.#src.slice(start, this.#pos);
  }

  #readText(): string {
    const start = this.#pos;
    while (this.#pos < this.#src.length && this.#src[this.#pos] !== '<') this.#pos += 1;
    return decodeEntities(this.#src.slice(start, this.#pos));
  }

  #readCdata(): ComponentTextNode {
    this.#pos += '<![CDATA['.length;
    const end = this.#src.indexOf(']]>', this.#pos);
    if (end === -1) throw new ComponentXmlError('Unterminated CDATA section');
    const value = this.#src.slice(this.#pos, end);
    this.#pos = end + ']]>'.length;
    return { type: 'text', value };
  }

  #skipComment(): void {
    const end = this.#src.indexOf('-->', this.#pos);
    if (end === -1) throw new ComponentXmlError('Unterminated comment');
    this.#pos = end + '-->'.length;
  }

  #skipUntil(marker: string): void {
    const end = this.#src.indexOf(marker, this.#pos);
    if (end === -1) throw new ComponentXmlError(`Expected '${marker}'`);
    this.#pos = end + marker.length;
  }

  #skipWhitespace(): void {
    while (this.#pos < this.#src.length && WHITESPACE.test(this.#src[this.#pos] ?? '')) {
      this.#pos += 1;
    }
  }

  #startsWith(prefix: string): boolean {
    return this.#src.startsWith(prefix, this.#pos);
  }

  #expect(token: string): void {
    if (!this.#startsWith(token)) {
      throw new ComponentXmlError(`Expected '${token}' at position ${this.#pos}`);
    }
    this.#pos += token.length;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const codePoint =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

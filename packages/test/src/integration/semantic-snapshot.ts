// Semantic-structure snapshots: serialize a live DOM subtree to a canonical text
// tree that captures *meaning* (tag + Kovo semantic attributes + ARIA role/name +
// bound text) while dropping everything volatile (CSRF tokens, hashed ids/asset
// versions, inline styles, class soup, framework-internal stamps).
//
// The result diffs only when semantics change, so snapshots survive markup churn
// — the non-brittle assertion layer in plans/integration-test-suite.md. The set of
// kept generated attributes is intentionally aligned with the compiler's
// render-equivalence allowlist (`isGeneratedOnlyRenderAttribute`,
// packages/compiler/src/emit/server.ts, SPEC §5.2/§4.8); keep the two in lockstep.

/**
 * Kovo-emitted semantic attributes that describe app meaning: data bindings,
 * derivations, query wiring, keyed identity, component identity, fragment targets,
 * error channels, and routing. These are framework-guaranteed output, far more
 * stable than incidental markup.
 */
export const KOVO_SEMANTIC_ATTRS: readonly string[] = [
  'data-bind',
  'data-bind-list',
  'data-derive',
  'data-derive-attr',
  'data-error-code',
  'data-error-path',
  'data-route',
  'data-row',
  'data-state',
  'kovo-c',
  'kovo-deps',
  'kovo-fragment-target',
  'kovo-key',
  'kovo-query',
  'kovo-state',
];

/**
 * Accessibility / user-facing attributes that define how an element is perceived
 * and operated. Kept because they encode behavior, not styling.
 */
export const ACCESSIBLE_ATTRS: readonly string[] = [
  'alt',
  'aria-checked',
  'aria-current',
  'aria-disabled',
  'aria-expanded',
  'aria-hidden',
  'aria-invalid',
  'aria-label',
  'aria-level',
  'aria-pressed',
  'aria-selected',
  'checked',
  'disabled',
  'name',
  'placeholder',
  'role',
  'selected',
  'type',
  'value',
];

/**
 * Behavioral / navigational attributes that define what an element *does*: which
 * mutation a form posts to, where a link goes, which module a script loads. These
 * are wire contracts — kept (with volatile version/hash segments normalized).
 */
export const BEHAVIORAL_ATTRS: readonly string[] = [
  'action',
  'formaction',
  'href',
  'method',
  'src',
];

/** Attributes whose values carry a URL that may embed a volatile version/hash. */
const URL_ATTRS = new Set(['action', 'href', 'src', 'formaction']);

/** Elements whose text content is opaque data, not structure — keep the shell only. */
const OPAQUE_TAGS = new Set(['script', 'style', 'kovo-query']);

/** Form field names that are pure wire mechanics, never user-facing semantics. */
const VOLATILE_FIELD_NAMES = new Set(['csrf', 'kovo-idem', '_csrf']);

/** Elements rendered for their text/structure only; never recurse into raw text. */
const RAW_TEXT_TAGS = new Set(['script', 'style']);

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Options controlling which attributes a semantic snapshot keeps. */
export interface SemanticSnapshotOptions {
  /** Extra attribute names to keep beyond the built-in semantic + a11y sets. */
  keepAttrs?: readonly string[];
}

interface ElementNode {
  attrs: Record<string, string>;
  children: SnapshotNode[];
  kind: 'element';
  tag: string;
}

interface TextNode {
  kind: 'text';
  value: string;
}

type SnapshotNode = ElementNode | TextNode;

/**
 * Serialize an HTML string (typically an element's `outerHTML`) into a canonical
 * semantic text tree suitable for `toMatchSnapshot`.
 */
export function semanticSnapshot(html: string, options: SemanticSnapshotOptions = {}): string {
  const keep = new Set([
    ...KOVO_SEMANTIC_ATTRS,
    ...ACCESSIBLE_ATTRS,
    ...BEHAVIORAL_ATTRS,
    ...(options.keepAttrs ?? []),
  ]);
  const nodes = parseFragment(html);
  const lines: string[] = [];
  for (const node of nodes) renderNode(node, 0, keep, lines);
  return lines.join('\n');
}

function renderNode(
  node: SnapshotNode,
  depth: number,
  keep: ReadonlySet<string>,
  lines: string[],
): void {
  const indent = '  '.repeat(depth);
  if (node.kind === 'text') {
    if (node.value) lines.push(`${indent}"${node.value}"`);
    return;
  }

  // Drop wire-only hidden inputs (CSRF, idempotency) entirely — they are not
  // user-facing and their values are per-session volatile.
  if (node.tag === 'input' && VOLATILE_FIELD_NAMES.has((node.attrs.name ?? '').toLowerCase())) {
    return;
  }

  const attrs = renderAttrs(node.attrs, keep);
  lines.push(`${indent}<${node.tag}${attrs}>`);
  // Opaque elements (scripts, styles, query hydration) carry data, not structure.
  if (OPAQUE_TAGS.has(node.tag)) return;
  for (const child of node.children) renderNode(child, depth + 1, keep, lines);
}

function renderAttrs(attrs: Record<string, string>, keep: ReadonlySet<string>): string {
  const rendered: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (!keep.has(name)) continue;
    rendered.push(`${name}=${JSON.stringify(normalizeAttrValue(name, value))}`);
  }
  rendered.sort();
  return rendered.length ? ` ${rendered.join(' ')}` : '';
}

function normalizeAttrValue(name: string, value: string): string {
  if (URL_ATTRS.has(name)) {
    // Collapse cache-busting versions and content hashes so a rebuild that only
    // changes a hash doesn't churn the snapshot.
    return value
      .replace(/([?&]v=)[0-9a-f]{6,}/gi, '$1*')
      .replace(/\.[0-9a-f]{8,}(\.[a-z0-9]+)$/i, '.*$1');
  }
  return value.replace(/\s+/g, ' ').trim();
}

// --- minimal, dependency-free HTML fragment parser -------------------------------
// Tolerant of the well-formed SSR/morph output Kovo emits; not a general HTML5
// parser. Mirrors the parsing conventions in ../html-fragment.ts (quote-aware tag
// scanning, void/raw-text handling) kept local so the normalization policy lives
// in one file.

function parseFragment(html: string): SnapshotNode[] {
  const parser = new FragmentParser(html);
  return parser.parseChildren();
}

class FragmentParser {
  private pos = 0;

  constructor(private readonly html: string) {}

  parseChildren(closingTag?: string): SnapshotNode[] {
    const nodes: SnapshotNode[] = [];
    while (this.pos < this.html.length) {
      const next = this.html.indexOf('<', this.pos);
      if (next === -1) {
        this.pushText(nodes, this.html.slice(this.pos));
        this.pos = this.html.length;
        break;
      }
      if (next > this.pos) this.pushText(nodes, this.html.slice(this.pos, next));
      this.pos = next;

      if (this.html.startsWith('<!--', this.pos)) {
        const end = this.html.indexOf('-->', this.pos);
        this.pos = end === -1 ? this.html.length : end + 3;
        continue;
      }
      if (this.html[this.pos + 1] === '/') {
        const close = this.readClosingTag();
        if (closingTag !== undefined && close === closingTag) return nodes;
        continue; // stray/unbalanced close: skip
      }

      const element = this.readElement();
      if (element) nodes.push(element);
      else this.pos += 1;
    }
    return nodes;
  }

  private pushText(nodes: SnapshotNode[], raw: string): void {
    const value = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (value) nodes.push({ kind: 'text', value });
  }

  private readElement(): ElementNode | undefined {
    const head = /^<([a-z][a-z0-9-]*)/i.exec(this.html.slice(this.pos));
    if (!head) return undefined;
    const tag = head[1]!.toLowerCase();
    const tagOpenEnd = this.findTagClose(this.pos + head[0].length);
    if (tagOpenEnd === undefined) return undefined;

    const attrText = this.html.slice(this.pos + head[0].length, tagOpenEnd);
    const selfClosing = /\/\s*$/.test(attrText) || VOID_TAGS.has(tag);
    this.pos = tagOpenEnd + 1;

    const attrs = parseAttrs(attrText);
    if (selfClosing) return { attrs, children: [], kind: 'element', tag };

    if (RAW_TEXT_TAGS.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'i').exec(this.html.slice(this.pos));
      this.pos = close ? this.pos + close.index + close[0].length : this.html.length;
      return { attrs, children: [], kind: 'element', tag };
    }

    const children = this.parseChildren(tag);
    return { attrs, children, kind: 'element', tag };
  }

  private readClosingTag(): string | undefined {
    const match = /^<\/([a-z][a-z0-9-]*)\s*>/i.exec(this.html.slice(this.pos));
    if (!match) {
      this.pos += 2;
      return undefined;
    }
    this.pos += match[0].length;
    return match[1]!.toLowerCase();
  }

  private findTagClose(start: number): number | undefined {
    let quote: '"' | "'" | undefined;
    for (let index = start; index < this.html.length; index += 1) {
      const char = this.html[index];
      if (quote !== undefined) {
        if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === '>') return index;
    }
    return undefined;
  }
}

function parseAttrs(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern =
    /(?:^|\s)(?<name>[^\s"'=<>`/]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gi;
  for (const match of attrText.matchAll(pattern)) {
    const name = match.groups?.name?.toLowerCase();
    if (!name) continue;
    attrs[name] = decodeEntities(
      match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '',
    );
  }
  return attrs;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (match, decimal, hex, named) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch (String(named).toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        default:
          return match;
      }
    },
  );
}

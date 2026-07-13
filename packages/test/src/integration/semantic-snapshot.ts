// Semantic-structure snapshots: serialize a live DOM subtree to a canonical text
// tree that captures *meaning* (tag + Kovo semantic attributes + ARIA role/name +
// bound text) while dropping everything volatile (CSRF tokens, hashed ids/asset
// versions, inline styles, class soup, framework-internal stamps).
//
// The result diffs only when semantics change, so snapshots survive markup churn
// — the non-brittle assertion layer in plans/integration-test-suite.md.

import {
  ACCESSIBLE_SEMANTIC_ATTRIBUTES,
  BEHAVIORAL_SEMANTIC_ATTRIBUTES,
  KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES,
} from '@kovojs/core/internal/semantic-attributes';
import {
  verifierArrayJoin,
  verifierArrayPush,
  verifierArraySort,
  verifierDefineProperty,
  verifierDenseArraySnapshot,
  verifierGetOwnPropertyDescriptor,
  verifierIsProxy,
  verifierJsonStringify,
  verifierNullRecord,
  verifierNumber,
  verifierNumberParseInt,
  verifierObjectKeys,
  verifierRegExp,
  verifierRegExpExec,
  verifierSet,
  verifierSetAdd,
  verifierSetHas,
  verifierString,
  verifierStringFromCodePoint,
  verifierStringIndexOf,
  verifierStringReplace,
  verifierStringRepeat,
  verifierStringSlice,
  verifierStringStartsWith,
  verifierStringToLowerCase,
  verifierStringTrim,
  verifierTypeError,
} from '../verifier-security-intrinsics.js';

/**
 * Kovo-emitted semantic attributes that describe app meaning: data bindings,
 * derivations, query wiring, keyed identity, component identity, fragment targets,
 * error channels, and routing. These are framework-guaranteed output, far more
 * stable than incidental markup.
 */
export const KOVO_SEMANTIC_ATTRS: readonly string[] = semanticStringSnapshot(
  KOVO_SEMANTIC_SNAPSHOT_ATTRIBUTES,
  'Kovo semantic attribute policy',
);

/**
 * Accessibility / user-facing attributes that define how an element is perceived
 * and operated. Kept because they encode behavior, not styling.
 */
export const ACCESSIBLE_ATTRS: readonly string[] = semanticStringSnapshot(
  ACCESSIBLE_SEMANTIC_ATTRIBUTES,
  'accessible semantic attribute policy',
);

/**
 * Behavioral / navigational attributes that define what an element *does*: which
 * mutation a form posts to, where a link goes, which module a script loads. These
 * are wire contracts — kept (with volatile version/hash segments normalized).
 */
export const BEHAVIORAL_ATTRS: readonly string[] = semanticStringSnapshot(
  BEHAVIORAL_SEMANTIC_ATTRIBUTES,
  'behavioral semantic attribute policy',
);

/** Attributes whose values carry a URL that may embed a volatile version/hash. */
const URL_ATTRS = semanticStringSet(['action', 'href', 'src', 'formaction']);

/** Elements whose text content is opaque data, not structure — keep the shell only. */
const OPAQUE_TAGS = semanticStringSet(['script', 'style', 'kovo-query']);

/** Form field names that are pure wire mechanics, never user-facing semantics. */
const VOLATILE_FIELD_NAMES = semanticStringSet(['csrf', 'kovo-csrf', 'kovo-idem', '_csrf']);

/** Elements rendered for their text/structure only; never recurse into raw text. */
const RAW_TEXT_TAGS = semanticStringSet(['script', 'style']);

const VOID_TAGS = semanticStringSet([
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
  const keep = verifierSet<string>();
  addSemanticStrings(keep, KOVO_SEMANTIC_ATTRS);
  addSemanticStrings(keep, ACCESSIBLE_ATTRS);
  addSemanticStrings(keep, BEHAVIORAL_ATTRS);
  addSemanticStrings(keep, snapshotKeepAttrs(options));
  const nodes = parseFragment(html);
  const lines: string[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    renderNode(nodes[index]!, 0, keep, lines);
  }
  return verifierArrayJoin(lines, '\n');
}

function renderNode(
  node: SnapshotNode,
  depth: number,
  keep: ReadonlySet<string>,
  lines: string[],
): void {
  const indent = verifierStringRepeat('  ', depth);
  if (node.kind === 'text') {
    if (node.value) verifierArrayPush(lines, `${indent}"${node.value}"`);
    return;
  }

  // Drop wire-only hidden inputs (CSRF, idempotency) entirely — they are not
  // user-facing and their values are per-session volatile.
  if (
    node.tag === 'input' &&
    verifierSetHas(VOLATILE_FIELD_NAMES, verifierStringToLowerCase(node.attrs.name ?? ''))
  ) {
    return;
  }

  const attrs = renderAttrs(node.attrs, keep);
  verifierArrayPush(lines, `${indent}<${node.tag}${attrs}>`);
  // Opaque elements (scripts, styles, query hydration) carry data, not structure.
  if (verifierSetHas(OPAQUE_TAGS, node.tag)) return;
  for (let index = 0; index < node.children.length; index += 1) {
    renderNode(node.children[index]!, depth + 1, keep, lines);
  }
}

function renderAttrs(attrs: Record<string, string>, keep: ReadonlySet<string>): string {
  const rendered: string[] = [];
  const names = verifierObjectKeys(attrs);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    if (!verifierSetHas(keep, name)) continue;
    const descriptor = verifierGetOwnPropertyDescriptor(attrs, name);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'string'
    ) {
      throw verifierTypeError(
        `Semantic snapshot attribute ${name} must be stable own string data.`,
      );
    }
    const json = verifierJsonStringify(normalizeAttrValue(name, descriptor.value));
    if (json === undefined)
      throw verifierTypeError(`Semantic snapshot attribute ${name} is invalid.`);
    verifierArrayPush(rendered, `${name}=${json}`);
  }
  verifierArraySort(rendered, compareSemanticStrings);
  return rendered.length ? ` ${verifierArrayJoin(rendered, ' ')}` : '';
}

function normalizeAttrValue(name: string, value: string): string {
  if (verifierSetHas(URL_ATTRS, name) || verifierStringStartsWith(name, 'on:')) {
    return normalizeUrlLikeAttrValue(value);
  }
  return verifierStringTrim(verifierStringReplace(value, /\s+/gu, ' '));
}

function normalizeUrlLikeAttrValue(value: string): string {
  // Collapse cache-busting versions and content hashes so a rebuild that only
  // changes a hash doesn't churn the snapshot. `on:*` handler refs carry the
  // same URL-shaped values as href/src, sometimes as a whitespace-separated
  // chain, so the replacement intentionally scans the whole attribute value.
  return verifierStringTrim(
    verifierStringReplace(
      verifierStringReplace(
        verifierStringReplace(
          verifierStringReplace(value, /\/c\/__v\/[0-9a-f]{6,}\//giu, '/c/__v/*/'),
          /([?&]v=)[0-9a-f]{6,}/giu,
          '$1*',
        ),
        /\.[0-9a-f]{8,}(\.[a-z0-9]+)(?=$|[#?\s])/giu,
        '.*$1',
      ),
      /\s+/gu,
      ' ',
    ),
  );
}

function semanticStringSnapshot(value: unknown, label: string): readonly string[] {
  return verifierDenseArraySnapshot(value, label, (entry) => {
    if (typeof entry !== 'string') throw verifierTypeError(`${label} must contain only strings.`);
    return entry;
  });
}

function semanticStringSet(values: readonly string[]): Set<string> {
  const set = verifierSet<string>();
  addSemanticStrings(set, values);
  return set;
}

function addSemanticStrings(set: Set<string>, values: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    verifierSetAdd(set, values[index]!);
  }
}

function snapshotKeepAttrs(options: SemanticSnapshotOptions): readonly string[] {
  if (verifierIsProxy(options)) {
    throw verifierTypeError('Semantic snapshot options must not be a Proxy object.');
  }
  const descriptor = verifierGetOwnPropertyDescriptor(options, 'keepAttrs');
  if (descriptor === undefined) return [];
  if (!('value' in descriptor)) {
    throw verifierTypeError('Semantic snapshot keepAttrs must be an own data property.');
  }
  if (descriptor.value === undefined) return [];
  return semanticStringSnapshot(descriptor.value, 'Semantic snapshot keepAttrs');
}

function compareSemanticStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
      const next = verifierStringIndexOf(this.html, '<', this.pos);
      if (next === -1) {
        this.pushText(nodes, verifierStringSlice(this.html, this.pos));
        this.pos = this.html.length;
        break;
      }
      if (next > this.pos) {
        this.pushText(nodes, verifierStringSlice(this.html, this.pos, next));
      }
      this.pos = next;

      if (verifierStringStartsWith(this.html, '<!--', this.pos)) {
        const end = verifierStringIndexOf(this.html, '-->', this.pos);
        this.pos = end === -1 ? this.html.length : end + 3;
        continue;
      }
      if (this.html[this.pos + 1] === '/') {
        const close = this.readClosingTag();
        if (closingTag !== undefined && close === closingTag) return nodes;
        continue; // stray/unbalanced close: skip
      }

      const element = this.readElement();
      if (element) verifierArrayPush(nodes, element);
      else this.pos += 1;
    }
    return nodes;
  }

  private pushText(nodes: SnapshotNode[], raw: string): void {
    const value = verifierStringTrim(verifierStringReplace(decodeEntities(raw), /\s+/gu, ' '));
    if (value) verifierArrayPush(nodes, { kind: 'text', value });
  }

  private readElement(): ElementNode | undefined {
    const head = verifierRegExpExec(
      /^<([a-z][a-z0-9-]*)/iu,
      verifierStringSlice(this.html, this.pos),
    );
    if (!head) return undefined;
    const tag = verifierStringToLowerCase(head[1]!);
    const tagOpenEnd = this.findTagClose(this.pos + head[0].length);
    if (tagOpenEnd === undefined) return undefined;

    const attrText = verifierStringSlice(this.html, this.pos + head[0].length, tagOpenEnd);
    const selfClosing =
      verifierRegExpExec(/\/\s*$/u, attrText) !== null || verifierSetHas(VOID_TAGS, tag);
    this.pos = tagOpenEnd + 1;

    const attrs = parseAttrs(attrText);
    if (selfClosing) return { attrs, children: [], kind: 'element', tag };

    if (verifierSetHas(RAW_TEXT_TAGS, tag)) {
      const close = verifierRegExpExec(
        verifierRegExp(`</${tag}\\s*>`, 'iu'),
        verifierStringSlice(this.html, this.pos),
      );
      this.pos = close ? this.pos + close.index + close[0].length : this.html.length;
      return { attrs, children: [], kind: 'element', tag };
    }

    const children = this.parseChildren(tag);
    return { attrs, children, kind: 'element', tag };
  }

  private readClosingTag(): string | undefined {
    const match = verifierRegExpExec(
      /^<\/([a-z][a-z0-9-]*)\s*>/iu,
      verifierStringSlice(this.html, this.pos),
    );
    if (!match) {
      this.pos += 2;
      return undefined;
    }
    this.pos += match[0].length;
    return verifierStringToLowerCase(match[1]!);
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
  const attrs = verifierNullRecord<string>();
  const pattern = /(?:^|\s)([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/giu;
  let match: RegExpExecArray | null;
  while ((match = verifierRegExpExec(pattern, attrText)) !== null) {
    const rawName = match[1];
    const name = rawName === undefined ? undefined : verifierStringToLowerCase(rawName);
    if (!name) continue;
    verifierDefineProperty(attrs, name, {
      configurable: true,
      enumerable: true,
      value: decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''),
      writable: true,
    });
  }
  return attrs;
}

function decodeEntities(text: string): string {
  return verifierStringReplace(
    text,
    /&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (match, decimal, hex, named) => {
      if (typeof decimal === 'string' && decimal !== '') {
        return verifierStringFromCodePoint(verifierNumber(decimal));
      }
      if (typeof hex === 'string' && hex !== '') {
        return verifierStringFromCodePoint(verifierNumberParseInt(hex, 16));
      }
      switch (verifierStringToLowerCase(verifierString(named))) {
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

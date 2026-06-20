import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { literalValue, type StaticLiteralValue } from '../scan/object.js';
import type { JsxAttributeModel, ObjectLiteralEntry } from '../scan/parse.js';
import { dedupeBy, escapeAttribute, splitDepValue } from '../shared.js';

export type AttributeMergeDiagnosticCode = 'KV231' | 'KV232' | 'KV233' | 'KV317';

/**
 * A single attribute participating in primitive/author attribute merging: its name, the
 * side it came from (`primitive` headless-UI default vs `author` override), and its
 * resolved value. Public input/output shape of mergePrimitiveAndAuthorAttributes
 * (SPEC.md §5.2).
 */
export interface MergeableAttribute {
  attribute?: JsxAttributeModel;
  name: string;
  origin: 'author' | 'primitive';
  value: MergeableAttributeValue;
}

/**
 * The resolved value of a MergeableAttribute: a static boolean/number/string literal or an
 * opaque `expression` source preserved verbatim. Public value type for
 * mergePrimitiveAndAuthorAttributes (SPEC.md §5.2).
 */
export type MergeableAttributeValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'expression'; source: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

/**
 * Result of {@link mergePrimitiveAndAuthorAttributes}: the merged attribute list plus any
 * KV231-KV233 conflict diagnostics. Public output shape for primitive/author merge tooling
 * (SPEC.md §5.2).
 */
export interface AttributeMergeResult {
  attributes: readonly MergeableAttribute[];
  diagnostics: readonly CompilerDiagnostic[];
}

const idrefAttributes = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'aria-owns',
  'commandfor',
  'for',
  'htmlFor',
  'kovo-context-menu',
  'kovo-hover-card',
  'kovo-tooltip',
  'popovertarget',
]);

const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

// SPEC.md §4.6: state-bearing aria-* attributes are primitive-wins (not author-wins).
// The primitive's runtime derive overwrites them on every render, so an author static
// value that contradicts the primitive's render-time value is a KV317 error.
// Descriptive aria-* (label / labelledby / describedby / roledescription, role) stay
// author-wins under the KV232 lint, identical to today's behaviour.
const stateAriaAttributes = new Set([
  'aria-checked',
  'aria-current',
  'aria-disabled',
  'aria-expanded',
  'aria-pressed',
  'aria-selected',
]);

export function primitiveObjectEntryAttributes(
  entries: readonly ObjectLiteralEntry[],
): readonly MergeableAttribute[] | null {
  const attributes: MergeableAttribute[] = [];

  for (const entry of entries) {
    const attribute = primitiveObjectEntryAttribute(entry);
    if (attribute === null) return null;
    if (attribute) attributes.push(attribute);
  }

  return attributes;
}

export function authorJsxAttributes(
  attributes: readonly JsxAttributeModel[],
): readonly MergeableAttribute[] {
  return attributes
    .filter((attribute) => attribute.name !== 'asChild' && attribute.name !== 'attrs')
    .map((attribute) => ({
      attribute,
      name: attribute.name,
      origin: 'author' as const,
      value: jsxAttributeValue(attribute),
    }))
    .filter((attribute) => !isAbsentAttributeValue(attribute.value));
}

/**
 * Merge a headless-UI primitive's default attributes with an author's overrides into one
 * ordered attribute set, applying SPEC.md §5.2 merge rules per attribute (class/style/dep
 * lists union, idref/aria conflicts raise KV231-KV233, author values win elsewhere) and
 * returning the merged attributes plus any conflict diagnostics.
 *
 * Public helper: the gallery example's merge-fixtures oracle calls it directly to prove
 * primitive composition matches the compiler's lowering.
 */
export function mergePrimitiveAndAuthorAttributes(
  primitiveAttributes: readonly MergeableAttribute[],
  authorAttributes: readonly MergeableAttribute[],
  options: { fileName: string; source: string },
): AttributeMergeResult {
  const diagnostics: CompilerDiagnostic[] = [];
  const merged = new Map<string, MergeableAttribute>();
  const order: string[] = [];

  for (const attribute of primitiveAttributes) {
    if (!merged.has(attribute.name)) order.push(attribute.name);
    merged.set(attribute.name, attribute);
  }

  for (const author of authorAttributes) {
    const primitive = merged.get(author.name);
    if (!primitive) {
      order.push(author.name);
      merged.set(author.name, author);
      continue;
    }

    merged.set(author.name, {
      ...mergeAttribute(primitive, author, diagnostics, options),
      name: author.name,
    });
  }

  return {
    attributes: order.flatMap((name) => {
      const attribute = merged.get(name);
      return attribute && !isAbsentAttributeValue(attribute.value) ? [attribute] : [];
    }),
    diagnostics: dedupeBy(
      diagnostics,
      (diagnostic) =>
        `${diagnostic.code}\0${diagnostic.message}\0${diagnostic.start?.line}\0${diagnostic.start?.column}`,
    ),
  };
}

export function primitiveIdRewrite(
  primitiveAttributes: readonly MergeableAttribute[],
  authorAttributes: readonly MergeableAttribute[],
): readonly [from: string, to: string] | null {
  const primitiveId = staticString(attributeValue(primitiveAttributes, 'id'));
  const authorId = staticString(attributeValue(authorAttributes, 'id'));
  if (!primitiveId || !authorId || primitiveId === authorId) return null;
  return [primitiveId, authorId];
}

// SPEC.md §4.6: when an author id wins, primitive-owned IDREFs target the surviving id.
export function rewritePrimitiveIdrefAttributes(
  attributes: readonly MergeableAttribute[],
  rewrites: ReadonlyMap<string, string>,
): readonly MergeableAttribute[] {
  if (rewrites.size === 0) return attributes;

  return attributes.map((attribute) => {
    if (!idrefAttributes.has(attribute.name)) return attribute;
    const value = staticString(attribute.value);
    if (value === undefined) return attribute;

    const rewritten = rewriteIdrefValue(value, rewrites);
    return rewritten === value
      ? attribute
      : { ...attribute, value: { kind: 'string', value: rewritten } };
  });
}

export function renderMergedAttributes(attributes: readonly MergeableAttribute[]): string {
  return attributes.map(renderMergedAttribute).join(' ');
}

function primitiveObjectEntryAttribute(
  entry: ObjectLiteralEntry,
): MergeableAttribute | null | undefined {
  if (entry.value === undefined) return null;

  const value = staticAttributeValue(entry.value);
  if (value === null) return null;
  if (value === undefined || isAbsentAttributeValue(value)) return undefined;

  return {
    name: entry.key,
    origin: 'primitive',
    value,
  };
}

function jsxAttributeValue(attribute: JsxAttributeModel): MergeableAttributeValue {
  if (attribute.value !== undefined) return { kind: 'string', value: attribute.value };
  if (attribute.expressionStaticValue !== undefined) {
    return (
      staticLiteralAttributeValue(attribute.expressionStaticValue, attribute.expression) ?? {
        kind: 'boolean',
        value: false,
      }
    );
  }
  if (attribute.expression !== undefined)
    return { kind: 'expression', source: attribute.expression };
  return { kind: 'boolean', value: true };
}

function staticAttributeValue(source: string): MergeableAttributeValue | null | undefined {
  const value = literalValue(source);
  if (value === undefined) return { kind: 'expression', source: source.trim() };
  return staticLiteralAttributeValue(value, source);
}

function staticLiteralAttributeValue(
  value: StaticLiteralValue,
  source?: string,
): MergeableAttributeValue | undefined {
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return value ? { kind: 'boolean', value } : undefined;
  if (value === null) return undefined;
  return { kind: 'expression', source: source?.trim() ?? JSON.stringify(value) };
}

function mergeAttribute(
  primitive: MergeableAttribute,
  author: MergeableAttribute,
  diagnostics: CompilerDiagnostic[],
  options: { fileName: string; source: string },
): MergeableAttribute {
  const name = author.name;

  if (name === 'class') {
    return authorValue(name, mergeSpaceTokenLists(primitive.value, author.value), author);
  }

  if (name === 'style') {
    return authorValue(name, mergeStyles(primitive.value, author.value), author);
  }

  if (name.startsWith('on:')) {
    return authorValue(name, mergeRefs(author.value, primitive.value), author);
  }

  if (name === 'id') return author;

  if (idrefAttributes.has(name)) {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV231', name, author));
    return author;
  }

  // SPEC.md §4.6: state-bearing aria-* → primitive-wins; check BEFORE the generic
  // aria-* branch so these never fall through to author.  When the author static
  // value contradicts the primitive's static render-time value, raise KV317 (error);
  // otherwise the usual KV232 lint is enough.
  // aria-disabled is also in logicalOrAttributes — the state-aria check runs first
  // here, so its OR-merge is handled in this branch instead of below.
  if (stateAriaAttributes.has(name)) {
    const primitiveStatic = staticString(primitive.value);
    const authorStatic = staticString(author.value);
    // KV317 only when both values are boolean state-aria values ('true'/'false') and
    // they contradict: e.g. primitive says "true" but author hard-codes "false".
    // An author value that is not a valid state-aria boolean (e.g. 'author-aria') is
    // not a frozen-vs-clobbered contradiction — it is simply an invalid override, which
    // the ordinary KV232 lint already covers.
    const booleanStateValues = new Set(['true', 'false']);
    if (
      primitiveStatic !== undefined &&
      authorStatic !== undefined &&
      primitiveStatic !== authorStatic &&
      booleanStateValues.has(primitiveStatic) &&
      booleanStateValues.has(authorStatic)
    ) {
      diagnostics.push(attributeMergeDiagnostic(options, 'KV317', name, author));
    } else {
      diagnostics.push(attributeMergeDiagnostic(options, 'KV232', name, author));
    }
    // aria-disabled uses logical-OR in the state-aria path (SPEC.md §4.6):
    // if either primitive or author is "true", the result is "true".
    // aria-disabled takes string values ("true"/"false"), not boolean presence.
    if (name === 'aria-disabled') {
      return authorValue(name, ariaDisabledOr(primitive.value, author.value), author);
    }
    return primitive;
  }

  if (name.startsWith('aria-') || name === 'role') {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV232', name, author));
    return author;
  }

  if (name === 'data-state' || primitiveOwnedDataStateAttribute(name)) {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV232', name, author));
    return primitive;
  }

  if (name.startsWith('data-p-')) {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV231', name, author));
    return author;
  }

  if (isBindingAttribute(name)) {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV233', name, author));
    return author;
  }

  if (logicalOrAttributes.has(name)) {
    return authorValue(name, logicalOr(primitive.value, author.value), author);
  }

  if (name === 'kovo-deps') {
    return authorValue(name, mergeDepLists(primitive.value, author.value), author);
  }

  if (name === 'kovo-c' || name === 'kovo-state') {
    diagnostics.push(attributeMergeDiagnostic(options, 'KV231', name, author));
    return author;
  }

  return author;
}

function authorValue(
  name: string,
  value: MergeableAttributeValue | undefined,
  author: MergeableAttribute,
): MergeableAttribute {
  return value === undefined ? author : { ...author, name, value };
}

function primitiveOwnedDataStateAttribute(name: string): boolean {
  return name === 'data-state';
}

function attributeValue(
  attributes: readonly MergeableAttribute[],
  name: string,
): MergeableAttributeValue | undefined {
  return attributes.find((attribute) => attribute.name === name)?.value;
}

function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => rewrites.get(token) ?? token)
    .join(' ');
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:');
}

function mergeRefs(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  return { kind: 'string', value: [left, right].filter(Boolean).join(' ') };
}

function mergeStyles(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  return {
    kind: 'string',
    value: [trimTrailingSemicolon(left), trimTrailingSemicolon(right)].filter(Boolean).join('; '),
  };
}

function mergeSpaceTokenLists(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  return {
    kind: 'string',
    value: [
      ...new Set(
        `${left} ${right}`
          .split(/\s+/)
          .map((token) => token.trim())
          .filter(Boolean),
      ),
    ].join(' '),
  };
}

function mergeDepLists(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  return { kind: 'string', value: [...new Set(splitDepValue(`${left} ${right}`))].join(' ') };
}

function logicalOr(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = booleanish(first);
  const right = booleanish(second);
  if (left === undefined || right === undefined) return undefined;
  return left || right ? { kind: 'boolean', value: true } : undefined;
}

// SPEC.md §4.6 / logicalOrAttributes: aria-disabled uses string "true"/"false" (not
// boolean presence) so logical-OR must produce the string "true" when either value
// is truthy, rather than the boolean `true` that renderMergedAttribute renders without
// a value ("aria-disabled" vs "aria-disabled=\"true\"").
function ariaDisabledOr(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = booleanish(first);
  const right = booleanish(second);
  if (left === undefined || right === undefined) return undefined;
  return { kind: 'string', value: left || right ? 'true' : 'false' };
}

function booleanish(value: MergeableAttributeValue): boolean | undefined {
  if (value.kind === 'boolean') return value.value;
  if (value.kind === 'string') return value.value !== 'false';
  return undefined;
}

function staticString(value: MergeableAttributeValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'number') return String(value.value);
  if (value.kind === 'boolean') return value.value ? 'true' : 'false';
  return undefined;
}

function trimTrailingSemicolon(value: string): string {
  return value.trim().replace(/;$/, '').trim();
}

function isAbsentAttributeValue(value: MergeableAttributeValue | undefined): boolean {
  return value === undefined || (value.kind === 'boolean' && !value.value);
}

function renderMergedAttribute(attribute: MergeableAttribute): string {
  const value = attribute.value;
  if (value.kind === 'boolean') return attribute.name;
  if (value.kind === 'expression') return `${attribute.name}={${value.source}}`;
  if (value.kind === 'number') return `${attribute.name}="${value.value}"`;
  return `${attribute.name}="${escapeAttribute(value.value)}"`;
}

function attributeMergeDiagnostic(
  options: { fileName: string; source: string },
  code: AttributeMergeDiagnosticCode,
  detail: string,
  attribute: MergeableAttribute,
): CompilerDiagnostic {
  const span = attribute.attribute;
  return {
    ...diagnosticFor(
      options.fileName,
      code,
      options.source,
      span?.start,
      span ? span.end - span.start : undefined,
    ),
    message: `${diagnosticDefinitions[code].message} ${detail}`,
  };
}

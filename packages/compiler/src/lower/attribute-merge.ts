import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { literalValue, type StaticLiteralValue } from '../scan/object.js';
import type { JsxAttributeModel, ObjectLiteralEntry } from '../scan/parse.js';
import { dedupeBy, escapeAttribute, splitDepValue } from '../shared.js';
import {
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerJsonStringify,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerStringCharCodeAt,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';

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

const idrefAttributes = compilerCreateSet<string>();
compilerSetAdd(idrefAttributes, 'aria-activedescendant');
compilerSetAdd(idrefAttributes, 'aria-controls');
compilerSetAdd(idrefAttributes, 'aria-describedby');
compilerSetAdd(idrefAttributes, 'aria-labelledby');
compilerSetAdd(idrefAttributes, 'aria-owns');
compilerSetAdd(idrefAttributes, 'commandfor');
compilerSetAdd(idrefAttributes, 'for');
compilerSetAdd(idrefAttributes, 'htmlFor');
compilerSetAdd(idrefAttributes, 'kovo-context-menu');
compilerSetAdd(idrefAttributes, 'kovo-hover-card');
compilerSetAdd(idrefAttributes, 'kovo-tooltip');
compilerSetAdd(idrefAttributes, 'popovertarget');

const logicalOrAttributes = compilerCreateSet<string>();
compilerSetAdd(logicalOrAttributes, 'aria-disabled');
compilerSetAdd(logicalOrAttributes, 'disabled');
compilerSetAdd(logicalOrAttributes, 'readonly');
compilerSetAdd(logicalOrAttributes, 'required');

// SPEC.md §4.6: state-bearing aria-* attributes are primitive-wins (not author-wins).
// The primitive's runtime derive overwrites them on every render, so an author static
// value that contradicts the primitive's render-time value is a KV317 error.
// Descriptive aria-* (label / labelledby / describedby / roledescription, role) stay
// author-wins under the KV232 lint, identical to today's behaviour.
const stateAriaAttributes = compilerCreateSet<string>();
compilerSetAdd(stateAriaAttributes, 'aria-checked');
compilerSetAdd(stateAriaAttributes, 'aria-current');
compilerSetAdd(stateAriaAttributes, 'aria-disabled');
compilerSetAdd(stateAriaAttributes, 'aria-expanded');
compilerSetAdd(stateAriaAttributes, 'aria-pressed');
compilerSetAdd(stateAriaAttributes, 'aria-selected');

const booleanStateValues = compilerCreateSet<string>();
compilerSetAdd(booleanStateValues, 'true');
compilerSetAdd(booleanStateValues, 'false');

export function primitiveObjectEntryAttributes(
  entries: readonly ObjectLiteralEntry[],
): readonly MergeableAttribute[] | null {
  const attributes: MergeableAttribute[] = [];

  const length = compilerArrayLength(entries, 'Primitive object entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      entries,
      index,
      'Primitive object entries',
    ) as ObjectLiteralEntry;
    const attribute = primitiveObjectEntryAttribute(entry);
    if (attribute === null) return null;
    if (attribute) appendMergeFact(attributes, attribute, 'Primitive merge attributes');
  }

  return attributes;
}

export function authorJsxAttributes(
  attributes: readonly JsxAttributeModel[],
): readonly MergeableAttribute[] {
  const result: MergeableAttribute[] = [];
  const length = compilerArrayLength(attributes, 'Author JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'Author JSX attributes',
    ) as JsxAttributeModel;
    if (attribute.name === 'asChild' || attribute.name === 'attrs') continue;
    const merged: MergeableAttribute = {
      attribute,
      name: attribute.name,
      origin: 'author',
      value: jsxAttributeValue(attribute),
    };
    if (!isAbsentAttributeValue(merged.value)) {
      appendMergeFact(result, merged, 'Author merge attributes');
    }
  }
  return result;
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
  const merged = compilerCreateMap<string, MergeableAttribute>();
  const order: string[] = [];

  const primitiveLength = compilerArrayLength(primitiveAttributes, 'Primitive merge attributes');
  for (let index = 0; index < primitiveLength; index += 1) {
    const attribute = compilerOwnDataValue(
      primitiveAttributes,
      index,
      'Primitive merge attributes',
    ) as MergeableAttribute;
    if (compilerMapGet(merged, attribute.name) === undefined) {
      appendMergeFact(order, attribute.name, 'Merged attribute order');
    }
    compilerMapSet(merged, attribute.name, attribute);
  }

  const authorLength = compilerArrayLength(authorAttributes, 'Author merge attributes');
  for (let index = 0; index < authorLength; index += 1) {
    const author = compilerOwnDataValue(
      authorAttributes,
      index,
      'Author merge attributes',
    ) as MergeableAttribute;
    const primitive = compilerMapGet(merged, author.name);
    if (!primitive) {
      appendMergeFact(order, author.name, 'Merged attribute order');
      compilerMapSet(merged, author.name, author);
      continue;
    }

    compilerMapSet(merged, author.name, {
      ...mergeAttribute(primitive, author, diagnostics, options),
      name: author.name,
    });
  }

  const attributes: MergeableAttribute[] = [];
  const orderLength = compilerArrayLength(order, 'Merged attribute order');
  for (let index = 0; index < orderLength; index += 1) {
    const name = compilerOwnDataValue(order, index, 'Merged attribute order') as string;
    const attribute = compilerMapGet(merged, name);
    if (attribute && !isAbsentAttributeValue(attribute.value)) {
      appendMergeFact(attributes, attribute, 'Merged attributes');
    }
  }

  return {
    attributes,
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
  const result: MergeableAttribute[] = [];
  const length = compilerArrayLength(attributes, 'Primitive IDREF attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'Primitive IDREF attributes',
    ) as MergeableAttribute;
    if (!compilerSetHas(idrefAttributes, attribute.name)) {
      appendMergeFact(result, attribute, 'Rewritten primitive attributes');
      continue;
    }
    const value = staticString(attribute.value);
    if (value === undefined) {
      appendMergeFact(result, attribute, 'Rewritten primitive attributes');
      continue;
    }

    const rewritten = rewriteIdrefValue(value, rewrites);
    appendMergeFact(
      result,
      rewritten === value
        ? attribute
        : { ...attribute, value: { kind: 'string', value: rewritten } },
      'Rewritten primitive attributes',
    );
  }
  return result;
}

export function renderMergedAttributes(attributes: readonly MergeableAttribute[]): string {
  const rendered: string[] = [];
  const length = compilerArrayLength(attributes, 'Rendered merged attributes');
  for (let index = 0; index < length; index += 1) {
    appendMergeFact(
      rendered,
      renderMergedAttribute(
        compilerOwnDataValue(
          attributes,
          index,
          'Rendered merged attributes',
        ) as MergeableAttribute,
      ),
      'Rendered merged attributes',
    );
  }
  return compilerArrayJoin(rendered, ' ');
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
  if (value === undefined) return { kind: 'expression', source: compilerStringTrim(source) };
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
  return {
    kind: 'expression',
    source: source === undefined
      ? (compilerJsonStringify(value) ?? 'undefined')
      : compilerStringTrim(source),
  };
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

  if (compilerStringStartsWith(name, 'on:')) {
    return authorValue(name, mergeRefs(author.value, primitive.value), author);
  }

  if (name === 'id') return author;

  if (compilerSetHas(idrefAttributes, name)) {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV231', name, author),
      'Attribute merge diagnostics',
    );
    return author;
  }

  // SPEC.md §4.6: state-bearing aria-* → primitive-wins; check BEFORE the generic
  // aria-* branch so these never fall through to author.  When the author static
  // value contradicts the primitive's static render-time value, raise KV317 (error);
  // otherwise the usual KV232 lint is enough.
  // aria-disabled is also in logicalOrAttributes — the state-aria check runs first
  // here, so its OR-merge is handled in this branch instead of below.
  if (compilerSetHas(stateAriaAttributes, name)) {
    const primitiveStatic = staticString(primitive.value);
    const authorStatic = staticString(author.value);
    // KV317 only when both values are boolean state-aria values ('true'/'false') and
    // they contradict: e.g. primitive says "true" but author hard-codes "false".
    // An author value that is not a valid state-aria boolean (e.g. 'author-aria') is
    // not a frozen-vs-clobbered contradiction — it is simply an invalid override, which
    // the ordinary KV232 lint already covers.
    if (
      primitiveStatic !== undefined &&
      authorStatic !== undefined &&
      primitiveStatic !== authorStatic &&
      compilerSetHas(booleanStateValues, primitiveStatic) &&
      compilerSetHas(booleanStateValues, authorStatic)
    ) {
      appendMergeFact(
        diagnostics,
        attributeMergeDiagnostic(options, 'KV317', name, author),
        'Attribute merge diagnostics',
      );
    } else {
      appendMergeFact(
        diagnostics,
        attributeMergeDiagnostic(options, 'KV232', name, author),
        'Attribute merge diagnostics',
      );
    }
    // aria-disabled uses logical-OR in the state-aria path (SPEC.md §4.6):
    // if either primitive or author is "true", the result is "true".
    // aria-disabled takes string values ("true"/"false"), not boolean presence.
    if (name === 'aria-disabled') {
      return authorValue(name, ariaDisabledOr(primitive.value, author.value), author);
    }
    return primitive;
  }

  if (compilerStringStartsWith(name, 'aria-') || name === 'role') {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV232', name, author),
      'Attribute merge diagnostics',
    );
    return author;
  }

  if (name === 'data-state' || primitiveOwnedDataStateAttribute(name)) {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV232', name, author),
      'Attribute merge diagnostics',
    );
    return primitive;
  }

  if (compilerStringStartsWith(name, 'data-p-')) {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV231', name, author),
      'Attribute merge diagnostics',
    );
    return author;
  }

  if (isBindingAttribute(name)) {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV233', name, author),
      'Attribute merge diagnostics',
    );
    return author;
  }

  if (compilerSetHas(logicalOrAttributes, name)) {
    return authorValue(name, logicalOr(primitive.value, author.value), author);
  }

  if (name === 'kovo-deps') {
    return authorValue(name, mergeDepLists(primitive.value, author.value), author);
  }

  if (name === 'kovo-c' || name === 'kovo-state') {
    appendMergeFact(
      diagnostics,
      attributeMergeDiagnostic(options, 'KV231', name, author),
      'Attribute merge diagnostics',
    );
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
  const length = compilerArrayLength(attributes, 'Merge attribute lookup');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'Merge attribute lookup',
    ) as MergeableAttribute;
    if (attribute.name === name) return attribute.value;
  }
  return undefined;
}

function rewriteIdrefValue(value: string, rewrites: ReadonlyMap<string, string>): string {
  const tokens = splitWhitespaceTokens(value);
  const rewritten: string[] = [];
  const length = compilerArrayLength(tokens, 'IDREF tokens');
  for (let index = 0; index < length; index += 1) {
    const token = compilerOwnDataValue(tokens, index, 'IDREF tokens') as string;
    appendMergeFact(rewritten, compilerMapGet(rewrites, token) ?? token, 'Rewritten IDREF tokens');
  }
  return compilerArrayJoin(rewritten, ' ');
}

function isBindingAttribute(name: string): boolean {
  return name === 'data-bind' || compilerStringStartsWith(name, 'data-bind:');
}

function mergeRefs(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  return { kind: 'string', value: joinNonempty(left, right, ' ') };
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
    value: joinNonempty(trimTrailingSemicolon(left), trimTrailingSemicolon(right), '; '),
  };
}

function mergeSpaceTokenLists(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  const unique = compilerCreateSet<string>();
  const tokens = splitWhitespaceTokens(`${left} ${right}`);
  const values: string[] = [];
  const length = compilerArrayLength(tokens, 'Class merge tokens');
  for (let index = 0; index < length; index += 1) {
    const token = compilerOwnDataValue(tokens, index, 'Class merge tokens') as string;
    if (compilerSetHas(unique, token)) continue;
    compilerSetAdd(unique, token);
    appendMergeFact(values, token, 'Class merge tokens');
  }
  return {
    kind: 'string',
    value: compilerArrayJoin(values, ' '),
  };
}

function mergeDepLists(
  first: MergeableAttributeValue,
  second: MergeableAttributeValue,
): MergeableAttributeValue | undefined {
  const left = staticString(first);
  const right = staticString(second);
  if (left === undefined || right === undefined) return undefined;
  const unique = compilerCreateSet<string>();
  const values: string[] = [];
  const dependencies = splitDepValue(`${left} ${right}`);
  const length = compilerArrayLength(dependencies, 'Dependency merge tokens');
  for (let index = 0; index < length; index += 1) {
    const dependency = compilerOwnDataValue(
      dependencies,
      index,
      'Dependency merge tokens',
    ) as string;
    if (compilerSetHas(unique, dependency)) continue;
    compilerSetAdd(unique, dependency);
    appendMergeFact(values, dependency, 'Dependency merge tokens');
  }
  return { kind: 'string', value: compilerArrayJoin(values, ' ') };
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
  if (value.kind === 'number') return `${value.value}`;
  if (value.kind === 'boolean') return value.value ? 'true' : 'false';
  return undefined;
}

function trimTrailingSemicolon(value: string): string {
  return compilerStringTrim(
    compilerRegExpReplace(/;$/, compilerStringTrim(value), ''),
  );
}

function appendMergeFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function joinNonempty(left: string, right: string, separator: string): string {
  if (left === '') return right;
  if (right === '') return left;
  return `${left}${separator}${right}`;
}

function splitWhitespaceTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let index = 0; index < value.length; index += 1) {
    const code = compilerStringCharCodeAt(value, index);
    const whitespace =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0b ||
      code === 0x0c ||
      code === 0x0d ||
      code === 0x20 ||
      code === 0xa0 ||
      code === 0x1680 ||
      (code >= 0x2000 && code <= 0x200a) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x202f ||
      code === 0x205f ||
      code === 0x3000;
    if (whitespace) {
      if (start >= 0) {
        appendMergeFact(tokens, compilerStringSlice(value, start, index), 'Whitespace tokens');
        start = -1;
      }
    } else if (start < 0) {
      start = index;
    }
  }
  if (start >= 0) {
    appendMergeFact(tokens, compilerStringSlice(value, start), 'Whitespace tokens');
  }
  return tokens;
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

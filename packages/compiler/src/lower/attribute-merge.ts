import { diagnosticDefinitions } from '@jiso/core';

import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { literalValue, type StaticLiteralValue } from '../scan/object.js';
import type { JsxAttributeModel, ObjectLiteralEntry } from '../scan/parse.js';
import { dedupeBy, escapeAttribute, splitDepValue } from '../shared.js';

export type AttributeMergeDiagnosticCode = 'FW231' | 'FW232' | 'FW233';

export interface MergeableAttribute {
  attribute?: JsxAttributeModel;
  name: string;
  origin: 'author' | 'primitive';
  value: MergeableAttributeValue;
}

export type MergeableAttributeValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'expression'; source: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

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
  'jiso-context-menu',
  'jiso-hover-card',
  'jiso-tooltip',
  'popovertarget',
]);

const logicalOrAttributes = new Set(['aria-disabled', 'disabled', 'readonly', 'required']);

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
    diagnostics.push(attributeMergeDiagnostic(options, 'FW231', name, author));
    return author;
  }

  if (name.startsWith('aria-') || name === 'role') {
    diagnostics.push(attributeMergeDiagnostic(options, 'FW232', name, author));
    return author;
  }

  if (name === 'data-state' || primitiveOwnedDataStateAttribute(name)) {
    diagnostics.push(attributeMergeDiagnostic(options, 'FW232', name, author));
    return primitive;
  }

  if (name.startsWith('data-p-')) {
    diagnostics.push(attributeMergeDiagnostic(options, 'FW231', name, author));
    return author;
  }

  if (isBindingAttribute(name)) {
    diagnostics.push(attributeMergeDiagnostic(options, 'FW233', name, author));
    return author;
  }

  if (logicalOrAttributes.has(name)) {
    return authorValue(name, logicalOr(primitive.value, author.value), author);
  }

  if (name === 'fw-deps') {
    return authorValue(name, mergeDepLists(primitive.value, author.value), author);
  }

  if (name === 'fw-c' || name === 'fw-state') {
    diagnostics.push(attributeMergeDiagnostic(options, 'FW231', name, author));
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

function booleanish(value: MergeableAttributeValue): boolean | undefined {
  if (value.kind === 'boolean') return value.value;
  if (value.kind === 'string') return value.value !== 'false';
  return undefined;
}

function staticString(value: MergeableAttributeValue): string | undefined {
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

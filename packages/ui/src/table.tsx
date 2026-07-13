/** @jsxImportSource @kovojs/server */
import { component, type ComponentChild } from '@kovojs/core';
import { renderRouteHtml, trustedHtml } from '@kovojs/server';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

/* eslint-disable typescript/unbound-method */

const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const nativeArrayIsArray = NativeArray.isArray;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;

function tableArrayIsArray(value: unknown): value is readonly unknown[] {
  return nativeReflectApply(nativeArrayIsArray, NativeArray, [value]);
}

function tableGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return nativeReflectApply(nativeGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

/**
 * Style override slots accepted by the table components.
 *
 * @example
 * import type { TableStyleOverrides } from "@kovojs/ui/table";
 * const styles: TableStyleOverrides = {};
 */
export interface TableStyleOverrides {
  body?: style.StyleInput;
  caption?: style.StyleInput;
  cell?: style.StyleInput;
  head?: style.StyleInput;
  headerCell?: style.StyleInput;
  row?: style.StyleInput;
  table?: style.StyleInput;
  wrapper?: style.StyleInput;
}

/**
 * Props for the table component.
 *
 * @example
 * import type { TableProps } from "@kovojs/ui/table";
 * const props: TableProps = { children: 'Content' };
 */
export interface TableProps {
  caption?: string;
  children?: ComponentChild;
  styles?: TableStyleOverrides;
}

/**
 * Props for the table section component.
 *
 * @example
 * import type { TableSectionProps } from "@kovojs/ui/table";
 * const props: TableSectionProps = { children: 'Content' };
 */
export interface TableSectionProps {
  children?: ComponentChild;
  styles?: TableStyleOverrides;
}

/**
 * Props for the table cell component.
 *
 * @example
 * import type { TableCellProps } from "@kovojs/ui/table";
 * const props: TableCellProps = { children: 'Content' };
 */
export interface TableCellProps {
  children?: ComponentChild;
  colSpan?: number;
  scope?: 'col' | 'row';
  styles?: TableStyleOverrides;
}

type MaybePromise<Value> = Promise<Value> | Value;
type TableRenderedHtml = object;

function escapeHtml(value: unknown): string {
  if (typeof value === 'object' && value !== null) return renderRouteHtml(value);
  return escapeHtmlText(tableTextValue(value), false);
}

type TableChildrenRendering =
  | Readonly<{ kind: 'async'; value: Promise<string> }>
  | Readonly<{ kind: 'sync'; value: string }>;

const maxTableChildDepth = 64;
const maxTableChildValues = 10_000;

interface TableChildrenBudget {
  remaining: number;
}

function renderTableChildren(
  value: unknown,
  budget: TableChildrenBudget,
  depth: number,
): TableChildrenRendering {
  if (depth > maxTableChildDepth) {
    throw new NativeTypeError('Kovo table children exceed the maximum nesting depth.');
  }
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw new NativeTypeError('Kovo table children exceed the maximum child count.');
  }
  if (tableArrayIsArray(value)) {
    const length = stableArrayLength(value);
    let rendered: TableChildrenRendering = { kind: 'sync', value: '' };
    for (let index = 0; index < length; index += 1) {
      rendered = concatTableChildren(
        rendered,
        renderTableChildren(arrayOwnValue(value, index), budget, depth + 1),
      );
    }
    return rendered;
  }
  if (isPromiseLike(value)) {
    return {
      kind: 'async',
      value: tableThen(tableResolve(value), (resolved) =>
        tableRenderingValue(renderTableChildren(resolved, budget, depth + 1)),
      ),
    };
  }
  return { kind: 'sync', value: escapeHtml(value) };
}

function tableTextValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return `${value}`;
  return '';
}

function concatTableChildren(
  left: TableChildrenRendering,
  right: TableChildrenRendering,
): TableChildrenRendering {
  if (left.kind === 'sync' && right.kind === 'sync') {
    return { kind: 'sync', value: left.value + right.value };
  }
  return {
    kind: 'async',
    value: tableThen(tableResolve(tableRenderingValue(left)), (leftValue) =>
      tableThen(tableResolve(tableRenderingValue(right)), (rightValue) => leftValue + rightValue),
    ),
  };
}

function tableRenderingValue(rendering: TableChildrenRendering): MaybePromise<string> {
  return rendering.value;
}

function tableResolve<Value>(value: Value | PromiseLike<Value>): Promise<Value> {
  return new NativePromise<Value>((resolve) => resolve(value));
}

function tableThen<Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
): Promise<Result> {
  return nativeReflectApply(nativePromiseThen, promise, [onFulfilled]);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function tableRenderedHtml(html: string): TableRenderedHtml {
  const rendered = trustedHtml(html, 'ui table primitive composition');
  return rendered;
}

function escapeAttribute(value: string): string {
  return escapeHtmlText(value, true);
}

function escapeHtmlText(value: string, attribute: boolean): string {
  let escaped = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '&') escaped += '&amp;';
    else if (character === '<') escaped += '&lt;';
    else if (character === '>') escaped += '&gt;';
    else if (attribute && character === '"') escaped += '&quot;';
    else escaped += character;
  }
  return escaped;
}
const tableStyles = style.create({
  body: {
    '[&_tr:last-child]': {
      borderBottomWidth: 0,
    },
  },
  caption: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    marginTop: 12,
  },
  cell: {
    color: uiTheme.color.foreground,
    padding: 12,
    verticalAlign: 'middle',
  },
  head: {
    backgroundColor: 'transparent',
    borderBottomColor: uiTheme.color.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  headerCell: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    fontWeight: 500,
    height: 40,
    paddingInline: 12,
    textAlign: 'left',
    verticalAlign: 'middle',
  },
  row: {
    borderBottomColor: uiTheme.color.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    transitionProperty: 'background-color',
    ':hover': {
      backgroundColor: uiTheme.color.backgroundRaised,
    },
  },
  table: {
    borderCollapse: 'collapse',
    captionSide: 'bottom',
    fontSize: 14,
    width: '100%',
  },
  wrapper: {
    overflowX: 'auto',
    width: '100%',
  },
});

/**
 * Renders the styled table primitive.
 *
 * @example
 * import { Table } from "@kovojs/ui/table";
 * const component = Table;
 */
export const Table = component({
  render(props: TableProps) {
    const wrapperAttrs = style.attrs(tableStyles.wrapper, props.styles?.wrapper);
    const tableAttrs = style.attrs(tableStyles.table, props.styles?.table);
    const captionAttrs = style.attrs(tableStyles.caption, props.styles?.caption);
    const caption =
      props.caption === undefined
        ? ''
        : `<caption${tableAttributes(captionAttrs)}>${escapeHtml(props.caption)}</caption>`;

    return withTableChildren(props.children, (children) =>
      tableRenderedHtml(
        `<div${tableAttributes(wrapperAttrs)}><table${tableAttributes(tableAttrs)}>${caption}${children}</table></div>`,
      ),
    );
  },
});

/**
 * Renders the styled table head primitive.
 *
 * @example
 * import { TableHead } from "@kovojs/ui/table";
 * const component = TableHead;
 */
export const TableHead = component({
  render(props: TableSectionProps) {
    return tablePartWithChildren(
      'thead',
      style.attrs(tableStyles.head, props.styles?.head),
      props.children,
    );
  },
});

/**
 * Renders the styled table body primitive.
 *
 * @example
 * import { TableBody } from "@kovojs/ui/table";
 * const component = TableBody;
 */
export const TableBody = component({
  render(props: TableSectionProps) {
    return tablePartWithChildren(
      'tbody',
      style.attrs(tableStyles.body, props.styles?.body),
      props.children,
    );
  },
});

/**
 * Renders the styled table row primitive.
 *
 * @example
 * import { TableRow } from "@kovojs/ui/table";
 * const component = TableRow;
 */
export const TableRow = component({
  render(props: TableSectionProps) {
    const rowChildren = props.children;
    return tablePartWithChildren(
      'tr',
      style.attrs(tableStyles.row, props.styles?.row),
      rowChildren,
    );
  },
});

/**
 * Renders the styled table header cell primitive.
 *
 * @example
 * import { TableHeaderCell } from "@kovojs/ui/table";
 * const component = TableHeaderCell;
 */
export const TableHeaderCell = component({
  render(props: TableCellProps) {
    return tablePartWithChildren(
      'th',
      {
        ...style.attrs(tableStyles.headerCell, props.styles?.headerCell),
        colspan: props.colSpan,
        scope: props.scope ?? 'col',
      },
      props.children,
    );
  },
});

/**
 * Renders the styled table cell primitive.
 *
 * @example
 * import { TableCell } from "@kovojs/ui/table";
 * const component = TableCell;
 */
export const TableCell = component({
  render(props: TableCellProps) {
    return tablePartWithChildren(
      'td',
      { ...style.attrs(tableStyles.cell, props.styles?.cell), colspan: props.colSpan },
      props.children,
    );
  },
});

function withTableChildren(
  value: unknown,
  render: (children: string) => TableRenderedHtml,
): MaybePromise<TableRenderedHtml> {
  const children = renderTableChildren(value, { remaining: maxTableChildValues }, 0);
  return children.kind === 'async' ? tableThen(children.value, render) : render(children.value);
}

function tablePartWithChildren(
  tag: 'tbody' | 'td' | 'th' | 'thead' | 'tr',
  attributes: TablePartAttributes,
  children: unknown,
): MaybePromise<TableRenderedHtml> {
  return withTableChildren(children, (renderedChildren) =>
    tablePart(tag, attributes, renderedChildren),
  );
}

function tablePart(
  tag: 'tbody' | 'td' | 'th' | 'thead' | 'tr',
  attributes: TablePartAttributes,
  children: string,
): TableRenderedHtml {
  // SPEC.md §5.2 keeps vendored styled components as app-authored TSX source. These table
  // primitives still compose trusted table subtrees, but only from values this module minted, so
  // a structural object or global symbol cannot smuggle raw HTML into the vendored component.
  return tableRenderedHtml(`<${tag}${tableAttributes(attributes)}>${children}</${tag}>`);
}

function tableAttributes(attributes: TablePartAttributes | Record<string, unknown>): string {
  let rendered = '';
  const names: readonly string[] = ['class', 'data-style-src', 'style', 'colspan', 'scope'];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index] ?? '';
    const value = ownTableAttribute(attributes, name);
    const attribute = tableAttributeValue(value);
    if (attribute === undefined) continue;
    rendered += ` ${name}="${escapeAttribute(attribute)}"`;
  }

  return rendered;
}

function tableAttributeValue(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return `${value}`;
  }
  return undefined;
}

function ownTableAttribute(value: object, property: string): unknown {
  const descriptor = tableGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new NativeTypeError(`Kovo table attribute ${property} must be an own data property.`);
  }
  return descriptor.value;
}

function arrayOwnValue(value: readonly unknown[], index: number): unknown {
  const first = tableGetOwnPropertyDescriptor(value, index);
  const second = tableGetOwnPropertyDescriptor(value, index);
  if (first === undefined && second === undefined) {
    throw new NativeTypeError('Kovo table children must be dense own data elements.');
  }
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  ) {
    throw new NativeTypeError('Kovo table children must use stable own data elements.');
  }
  return first.value;
}

function stableArrayLength(value: readonly unknown[]): number {
  const first = tableGetOwnPropertyDescriptor(value, 'length');
  const second = tableGetOwnPropertyDescriptor(value, 'length');
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value ||
    typeof first.value !== 'number' ||
    first.value < 0 ||
    first.value > maxTableChildValues ||
    first.value % 1 !== 0
  ) {
    throw new NativeTypeError('Kovo table children must be a bounded stable dense array.');
  }
  return first.value;
}

type TablePartAttributes = Readonly<{
  'data-style-src'?: string | undefined;
  class?: string | undefined;
  colspan?: number | undefined;
  scope?: 'col' | 'row' | undefined;
  style?: string | undefined;
}>;

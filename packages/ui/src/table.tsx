/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

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
  children?: unknown;
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
  children?: unknown;
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
  children?: unknown;
  colSpan?: number;
  scope?: 'col' | 'row';
  styles?: TableStyleOverrides;
}

const kovoRenderedHtml = Symbol.for('kovo.renderedHtml');

interface RenderedHtml {
  readonly [kovoRenderedHtml]: true;
  readonly html: string;
  [Symbol.toPrimitive](): string;
  toString(): string;
}

function renderedHtml(html: string): RenderedHtml {
  return {
    [kovoRenderedHtml]: true,
    html,
    [Symbol.toPrimitive]() {
      return html;
    },
    toString() {
      return html;
    },
  };
}

function escapeHtml(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[kovoRenderedHtml] === true &&
    typeof (value as { html?: unknown }).html === 'string'
  ) {
    return (value as { html: string }).html;
  }
  const text =
    value === null || value === undefined || typeof value === 'boolean' ? '' : String(value);
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

/**
 * Style definitions used by the table components.
 *
 * @example
 * import { tableStyles } from "@kovojs/ui/table";
 * const styles = tableStyles;
 */
export const tableStyles = style.create({
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

    return renderedHtml(
      `<div${tableAttributes(wrapperAttrs)}><table${tableAttributes(tableAttrs)}>${caption}${props.children ?? ''}</table></div>`,
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
    return tablePart('thead', style.attrs(tableStyles.head, props.styles?.head), props.children);
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
    return tablePart('tbody', style.attrs(tableStyles.body, props.styles?.body), props.children);
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
    return tablePart('tr', style.attrs(tableStyles.row, props.styles?.row), props.children);
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
    return tablePart(
      'th',
      {
        ...style.attrs(tableStyles.headerCell, props.styles?.headerCell),
        colspan: props.colSpan,
        scope: props.scope ?? 'col',
      },
      props.children === undefined ? undefined : escapeHtml(props.children),
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
    return tablePart(
      'td',
      { ...style.attrs(tableStyles.cell, props.styles?.cell), colspan: props.colSpan },
      props.children === undefined ? undefined : escapeHtml(props.children),
    );
  },
});

function tablePart(
  tag: 'tbody' | 'td' | 'th' | 'thead' | 'tr',
  attributes: TablePartAttributes,
  children: unknown,
): RenderedHtml {
  // SPEC.md §5.2 keeps vendored styled components as app-authored TSX source. These table
  // parts still emit semantic HTML, while avoiding isolated JSX <tr>/<td> bodies
  // that the compiler correctly rejects when compiled without their table parent.
  return renderedHtml(`<${tag}${tableAttributes(attributes)}>${children ?? ''}</${tag}>`);
}

function tableAttributes(attributes: TablePartAttributes | Record<string, unknown>): string {
  let rendered = '';

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === '') continue;
    rendered += ` ${name}="${escapeAttribute(String(value))}"`;
  }

  return rendered;
}

type TablePartAttributes = Readonly<{
  'data-style-src'?: string | undefined;
  class?: string | undefined;
  colspan?: number | undefined;
  scope?: 'col' | 'row' | undefined;
  style?: string | undefined;
}>;

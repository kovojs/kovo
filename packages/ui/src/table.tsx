/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

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

export interface TableProps {
  caption?: string;
  children?: string;
  styles?: TableStyleOverrides;
}

export interface TableSectionProps {
  children?: string;
  styles?: TableStyleOverrides;
}

export interface TableCellProps {
  children?: string;
  colSpan?: number;
  scope?: 'col' | 'row';
  styles?: TableStyleOverrides;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

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
    backgroundColor: uiTheme.color.backgroundRaised,
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
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.md,
    borderStyle: 'solid',
    borderWidth: 1,
    overflowX: 'auto',
    width: '100%',
  },
});

export const Table = component({
  render(props: TableProps) {
    const wrapperAttrs = style.attrs(tableStyles.wrapper, props.styles?.wrapper);
    const tableAttrs = style.attrs(tableStyles.table, props.styles?.table);
    const captionAttrs = style.attrs(tableStyles.caption, props.styles?.caption);

    return (
      <div {...wrapperAttrs}>
        <table {...tableAttrs}>
          {props.caption === undefined ? (
            ''
          ) : (
            <caption {...captionAttrs}>{escapeHtml(props.caption)}</caption>
          )}
          {props.children}
        </table>
      </div>
    );
  },
});

export const TableHead = component({
  render(props: TableSectionProps) {
    return tablePart('thead', style.attrs(tableStyles.head, props.styles?.head), props.children);
  },
});

export const TableBody = component({
  render(props: TableSectionProps) {
    return tablePart('tbody', style.attrs(tableStyles.body, props.styles?.body), props.children);
  },
});

export const TableRow = component({
  render(props: TableSectionProps) {
    return tablePart('tr', style.attrs(tableStyles.row, props.styles?.row), props.children);
  },
});

export const TableHeaderCell = component({
  render(props: TableCellProps) {
    return tablePart(
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

export const TableCell = component({
  render(props: TableCellProps) {
    return tablePart(
      'td',
      { ...style.attrs(tableStyles.cell, props.styles?.cell), colspan: props.colSpan },
      props.children,
    );
  },
});

function tablePart(
  tag: 'tbody' | 'td' | 'th' | 'thead' | 'tr',
  attributes: TablePartAttributes,
  children: string | undefined,
): string {
  // SPEC.md §5.2 keeps vendored styled components as app-authored TSX source. These table
  // parts still emit semantic HTML, while avoiding isolated JSX <tr>/<td> bodies
  // that the compiler correctly rejects when compiled without their table parent.
  return `<${tag}${tableAttributes(attributes)}>${children ?? ''}</${tag}>`;
}

function tableAttributes(attributes: TablePartAttributes): string {
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

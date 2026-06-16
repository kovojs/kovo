/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, type ClassValue } from '@jiso/headless-ui';
import { escapeAttribute, escapeHtml } from '@jiso/server';

export interface TableProps {
  caption?: string;
  children?: string;
  class?: ClassValue;
  wrapperClass?: ClassValue;
}

export interface TableSectionProps {
  children?: string;
  class?: ClassValue;
}

export interface TableCellProps {
  children?: string;
  class?: ClassValue;
  colSpan?: number;
  scope?: 'col' | 'row';
}

export const tableWrapperClassNames = 'w-full overflow-x-auto';
export const tableClassNames = 'w-full caption-bottom border-collapse text-sm';
export const tableHeadClassNames = 'border-b border-neutral-200 bg-neutral-50';
export const tableBodyClassNames = '[&_tr:last-child]:border-0';
export const tableRowClassNames =
  'border-b border-neutral-200 transition-colors hover:bg-neutral-50';
export const tableHeaderCellClassNames =
  'h-10 px-3 text-left align-middle font-medium text-neutral-700';
export const tableCellClassNames = 'p-3 align-middle text-neutral-950';
export const tableCaptionClassNames = 'mt-3 text-sm text-neutral-500';
export const tableClasses = [
  tableWrapperClassNames,
  tableClassNames,
  tableHeadClassNames,
  tableBodyClassNames,
  tableRowClassNames,
  tableHeaderCellClassNames,
  tableCellClassNames,
  tableCaptionClassNames,
] as const;

export const Table = component('table', {
  render(props: TableProps) {
    return (
      <div class={cn(tableWrapperClassNames, props.wrapperClass)}>
        <table class={cn(tableClassNames, props.class)}>
          {props.caption === undefined ? (
            ''
          ) : (
            <caption class={tableCaptionClassNames}>{escapeHtml(props.caption)}</caption>
          )}
          {props.children}
        </table>
      </div>
    );
  },
});

export const TableHead = component('table-head', {
  render(props: TableSectionProps) {
    return tablePart('thead', { class: cn(tableHeadClassNames, props.class) }, props.children);
  },
});

export const TableBody = component('table-body', {
  render(props: TableSectionProps) {
    return tablePart('tbody', { class: cn(tableBodyClassNames, props.class) }, props.children);
  },
});

export const TableRow = component('table-row', {
  render(props: TableSectionProps) {
    return tablePart('tr', { class: cn(tableRowClassNames, props.class) }, props.children);
  },
});

export const TableHeaderCell = component('table-header-cell', {
  render(props: TableCellProps) {
    return tablePart(
      'th',
      {
        class: cn(tableHeaderCellClassNames, props.class),
        colspan: props.colSpan,
        scope: props.scope ?? 'col',
      },
      props.children,
    );
  },
});

export const TableCell = component('table-cell', {
  render(props: TableCellProps) {
    return tablePart(
      'td',
      { class: cn(tableCellClassNames, props.class), colspan: props.colSpan },
      props.children,
    );
  },
});

function tablePart(
  tag: 'tbody' | 'td' | 'th' | 'thead' | 'tr',
  attributes: Readonly<Record<string, number | string | undefined>>,
  children: string | undefined,
): string {
  // SPEC.md §5.2 keeps vendored styled components as app-authored TSX source. These table
  // parts still emit semantic HTML, while avoiding isolated JSX <tr>/<td> bodies
  // that the compiler correctly rejects when compiled without their table parent.
  return `<${tag}${tableAttributes(attributes)}>${children ?? ''}</${tag}>`;
}

function tableAttributes(
  attributes: Readonly<Record<string, number | string | undefined>>,
): string {
  let rendered = '';

  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === '') continue;
    rendered += ` ${name}="${escapeAttribute(String(value))}"`;
  }

  return rendered;
}

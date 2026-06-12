/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import { cn, type ClassValue } from '@jiso/headless-ui';

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
            <caption class={tableCaptionClassNames}>{props.caption}</caption>
          )}
          {props.children}
        </table>
      </div>
    );
  },
});

export const TableHead = component('table-head', {
  render(props: TableSectionProps) {
    return <thead class={cn(tableHeadClassNames, props.class)}>{props.children}</thead>;
  },
});

export const TableBody = component('table-body', {
  render(props: TableSectionProps) {
    return <tbody class={cn(tableBodyClassNames, props.class)}>{props.children}</tbody>;
  },
});

export const TableRow = component('table-row', {
  render(props: TableSectionProps) {
    return <tr class={cn(tableRowClassNames, props.class)}>{props.children}</tr>;
  },
});

export const TableHeaderCell = component('table-header-cell', {
  render(props: TableCellProps) {
    return (
      <th
        class={cn(tableHeaderCellClassNames, props.class)}
        colspan={props.colSpan}
        scope={props.scope ?? 'col'}
      >
        {props.children}
      </th>
    );
  },
});

export const TableCell = component('table-cell', {
  render(props: TableCellProps) {
    return (
      <td class={cn(tableCellClassNames, props.class)} colspan={props.colSpan}>
        {props.children}
      </td>
    );
  },
});

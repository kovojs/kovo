import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  tableStyles,
} from './table.js';

describe('@kovojs/ui Table StyleX slots', () => {
  it('renders semantic table markup with StyleX slot classes', () => {
    const header = TableHead.definition.render({
      children: TableRow.definition.render({
        children: `${TableHeaderCell.definition.render({
          children: 'Invoice',
        })}${TableHeaderCell.definition.render({
          children: 'Status',
        })}${TableHeaderCell.definition.render({
          children: 'Amount',
        })}`,
      }),
    });
    const body = TableBody.definition.render({
      children: `${TableRow.definition.render({
        children: `${TableHeaderCell.definition.render({
          children: 'INV-0042',
          scope: 'row',
        })}${TableCell.definition.render({
          children: 'Paid',
        })}${TableCell.definition.render({
          children: '$250.00',
        })}`,
      })}${TableRow.definition.render({
        children: TableCell.definition.render({
          children: 'Two pending invoices omitted',
          colSpan: 3,
        }),
      })}`,
    });

    expect({
      bodyClasses: [style.attrs(tableStyles.body).class ?? ''] as const,
      captionClasses: [style.attrs(tableStyles.caption).class ?? ''] as const,
      cellClasses: [style.attrs(tableStyles.cell).class ?? ''] as const,
      classes: [
        style.attrs(tableStyles.wrapper).class ?? '',
        style.attrs(tableStyles.table).class ?? '',
        style.attrs(tableStyles.head).class ?? '',
        style.attrs(tableStyles.body).class ?? '',
        style.attrs(tableStyles.row).class ?? '',
        style.attrs(tableStyles.headerCell).class ?? '',
        style.attrs(tableStyles.cell).class ?? '',
        style.attrs(tableStyles.caption).class ?? '',
      ] as const,
      headClasses: [style.attrs(tableStyles.head).class ?? ''] as const,
      headerCellClasses: [style.attrs(tableStyles.headerCell).class ?? ''] as const,
      rendered: Table.definition.render({
        caption: 'Invoices for the current billing period',
        children: `${header}${body}`,
      }),
      rootClasses: [style.attrs(tableStyles.table).class ?? ''] as const,
      rowClasses: [style.attrs(tableStyles.row).class ?? ''] as const,
      wrapperClasses: [style.attrs(tableStyles.wrapper).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        body: {
          backgroundColor: '#eff6ff',
        },
        caption: {
          color: '#1d4ed8',
        },
        cell: {
          color: '#1e3a8a',
        },
        head: {
          backgroundColor: '#dbeafe',
        },
        headerCell: {
          color: '#1e40af',
        },
        row: {
          backgroundColor: '#f8fafc',
          ':hover': {
            backgroundColor: '#f8fafc',
          },
        },
        table: {
          fontSize: 16,
        },
        wrapper: {
          backgroundColor: '#eff6ff',
        },
      },
      { namespace: 'appTable', source: 'app-table.tsx' },
    );

    expect(
      Table.definition.render({
        caption: 'Custom invoices',
        children:
          TableHead.definition.render({
            children: TableRow.definition.render({
              children: TableHeaderCell.definition.render({
                children: 'Invoice',
                styles: { headerCell: overrides.headerCell },
              }),
              styles: { row: overrides.row },
            }),
            styles: { head: overrides.head },
          }) +
          TableBody.definition.render({
            children: TableRow.definition.render({
              children: TableCell.definition.render({
                children: 'INV-1000',
                styles: { cell: overrides.cell },
              }),
              styles: { row: overrides.row },
            }),
            styles: { body: overrides.body },
          }),
        styles: {
          caption: overrides.caption,
          table: overrides.table,
          wrapper: overrides.wrapper,
        },
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX slot objects instead of class fragments', () => {
    expect({
      keys: Object.keys(tableStyles),
      markers: {
        body: tableStyles.body.$$css,
        caption: tableStyles.caption.$$css,
        cell: tableStyles.cell.$$css,
        head: tableStyles.head.$$css,
        headerCell: tableStyles.headerCell.$$css,
        row: tableStyles.row.$$css,
        table: tableStyles.table.$$css,
        wrapper: tableStyles.wrapper.$$css,
      },
    }).toMatchSnapshot();
  });
});

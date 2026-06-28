import { describe, expect, it } from 'vitest';

import { jsx } from '@kovojs/server/jsx-runtime';
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

async function render(value: unknown): Promise<string> {
  return String(await value);
}

describe('@kovojs/ui Table StyleX slots', () => {
  it('renders semantic table markup with StyleX slot classes', async () => {
    const header = await TableHead.definition.render({
      children: await TableRow.definition.render({
        children: [
          await TableHeaderCell.definition.render({
            children: 'Invoice',
          }),
          await TableHeaderCell.definition.render({
            children: 'Status',
          }),
          await TableHeaderCell.definition.render({
            children: 'Amount',
          }),
        ],
      }),
    });
    const body = await TableBody.definition.render({
      children: [
        await TableRow.definition.render({
          children: [
            await TableHeaderCell.definition.render({
              children: 'INV-0042',
              scope: 'row',
            }),
            await TableCell.definition.render({
              children: 'Paid',
            }),
            await TableCell.definition.render({
              children: '$250.00',
            }),
          ],
        }),
        await TableRow.definition.render({
          children: await TableCell.definition.render({
            children: 'Two pending invoices omitted',
            colSpan: 3,
          }),
        }),
      ],
    });
    const legacyBody = `${await TableRow.definition.render({
      children: `${await TableHeaderCell.definition.render({
        children: 'INV-0042',
        scope: 'row',
      })}`,
    })}`;

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
      rendered: await render(
        Table.definition.render({
          caption: 'Invoices for the current billing period',
          children: [header, body],
        }),
      ),
      stringComposedChildrenAreText: await render(
        Table.definition.render({
          children: legacyBody,
        }),
      ),
      rootClasses: [style.attrs(tableStyles.table).class ?? ''] as const,
      rowClasses: [style.attrs(tableStyles.row).class ?? ''] as const,
      wrapperClasses: [style.attrs(tableStyles.wrapper).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', async () => {
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
      await render(
        Table.definition.render({
          caption: 'Custom invoices',
          children: [
            await TableHead.definition.render({
              children: await TableRow.definition.render({
                children: await TableHeaderCell.definition.render({
                  children: 'Invoice',
                  styles: { headerCell: overrides.headerCell },
                }),
                styles: { row: overrides.row },
              }),
              styles: { head: overrides.head },
            }),
            await TableBody.definition.render({
              children: await TableRow.definition.render({
                children: await TableCell.definition.render({
                  children: 'INV-1000',
                  styles: { cell: overrides.cell },
                }),
                styles: { row: overrides.row },
              }),
              styles: { body: overrides.body },
            }),
          ],
          styles: {
            caption: overrides.caption,
            table: overrides.table,
            wrapper: overrides.wrapper,
          },
        }),
      ),
    ).toMatchSnapshot();
  });

  it('composes through the server JSX runtime without leaking Promise text', async () => {
    const html = await render(
      jsx(Table, {
        caption: 'Invoices',
        children: [
          jsx(TableHead, {
            children: jsx(TableRow, {
              children: [
                jsx(TableHeaderCell, { children: 'Invoice' }),
                jsx(TableHeaderCell, { children: 'Status' }),
              ],
            }),
          }),
          jsx(TableBody, {
            children: jsx(TableRow, {
              children: [
                jsx(TableHeaderCell, { children: 'INV-0042', scope: 'row' }),
                jsx(TableCell, { children: 'Paid & posted' }),
              ],
            }),
          }),
        ],
      }),
    );

    expect(html).toContain('<thead');
    expect(html).toContain('<tbody');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('Paid &amp; posted');
    expect(html).not.toContain('[object Promise]');
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

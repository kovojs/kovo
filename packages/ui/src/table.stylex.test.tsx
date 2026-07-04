import { describe, expect, it } from 'vitest';

import { jsx } from '@kovojs/server/jsx-runtime';
import * as style from '@kovojs/style';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from './table.js';

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
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', async () => {
    const overrides = style.create({
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
    });

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
});

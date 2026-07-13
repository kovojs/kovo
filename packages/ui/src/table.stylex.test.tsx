import { describe, expect, it } from 'vitest';

import { jsx } from '@kovojs/server/jsx-runtime';
import * as style from '@kovojs/style';

import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from './table.js';

async function render(value: unknown): Promise<string> {
  return String(await value);
}

describe('@kovojs/ui Table StyleX slots', () => {
  it('preserves HTML escaping after authored prototype replacement', async () => {
    const nativeArrayIsArray = Array.isArray;
    const nativeArrayMap = Array.prototype.map;
    const nativeJsonStringify = JSON.stringify;
    const nativeObjectEntries = Object.entries;
    const nativeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const nativeStringReplaceAll = String.prototype.replaceAll;
    const nativeWeakSetHas = WeakSet.prototype.has;
    let rendered: unknown;
    try {
      Array.isArray = () => false;
      Array.prototype.map = () => ['<script data-array-poison></script>'];
      JSON.stringify = () => '<img data-json-poison src=x onerror=alert(1)>';
      Object.entries = () => [['class', '" data-object-poison="true']];
      Object.getOwnPropertyDescriptor = () => ({
        configurable: true,
        enumerable: true,
        value: '" data-descriptor-poison="true',
        writable: true,
      });
      String.prototype.replaceAll = function identityReplaceAll() {
        return String(this);
      };
      WeakSet.prototype.has = () => true;

      rendered = Table.definition.render({
        caption: '<img data-caption-poison src=x onerror=alert(1)>',
        children: ['<script data-child-poison>globalThis.pwned=1</script>'],
      });
    } finally {
      Array.isArray = nativeArrayIsArray;
      Array.prototype.map = nativeArrayMap;
      JSON.stringify = nativeJsonStringify;
      Object.entries = nativeObjectEntries;
      Object.getOwnPropertyDescriptor = nativeObjectGetOwnPropertyDescriptor;
      String.prototype.replaceAll = nativeStringReplaceAll;
      WeakSet.prototype.has = nativeWeakSetHas;
    }

    const html = await render(rendered);
    expect(html).toContain('&lt;img data-caption-poison');
    expect(html).toContain('&lt;script data-child-poison&gt;');
    expect(html).not.toContain('<img data-caption-poison');
    expect(html).not.toContain('<script data-child-poison>');
    expect(html).not.toContain('data-object-poison');
    expect(html).not.toContain('data-descriptor-poison');
  });

  it('snapshots bounded dense child arrays without live proxy or accessor reads', async () => {
    let liveLengthReads = 0;
    const proxied = new Proxy(['<script data-proxy-child></script>'], {
      get(target, property, receiver) {
        if (property === 'length') {
          liveLengthReads += 1;
          throw new Error('live length must not be read');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const html = await render(Table.definition.render({ children: proxied }));
    expect(liveLengthReads).toBe(0);
    expect(html).toContain('&lt;script data-proxy-child&gt;');

    let accessorInvoked = false;
    const accessorChildren = ['safe'];
    Object.defineProperty(accessorChildren, '0', {
      configurable: true,
      enumerable: true,
      get() {
        accessorInvoked = true;
        return '<script data-accessor-child></script>';
      },
    });
    expect(() => Table.definition.render({ children: accessorChildren })).toThrow(
      /stable own data elements/u,
    );
    expect(accessorInvoked).toBe(false);

    expect(() => Table.definition.render({ children: new Array(1) })).toThrow(
      /dense own data elements/u,
    );

    expect(() => Table.definition.render({ children: new Array(10_001) })).toThrow(
      /bounded stable dense array/u,
    );
  });

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

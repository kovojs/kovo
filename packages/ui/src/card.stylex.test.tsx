import { describe, expect, it } from 'vitest';

import { jsx } from '@kovojs/server/jsx-runtime';
import * as style from '@kovojs/style';

import { Card, cardStyles } from './card.js';
import { Table, TableBody, TableCell, TableRow } from './table.js';

describe('@kovojs/ui Card StyleX styles', () => {
  it('matches the rendered StyleX snapshot', () => {
    expect({
      classes: [style.attrs(cardStyles.root).class ?? ''] as const,
      rendered: Card.definition.render({
        children: '<h2>Release candidate</h2><p>Ready for audit.</p>',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#111827',
          color: '#ffffff',
          padding: 24,
        },
      },
      { namespace: 'appCard', source: 'app-card.tsx' },
    );

    expect(
      Card.definition.render({
        children: '<p>Total</p>',
        style: overrides.root,
      }),
    ).toMatchSnapshot();
  });

  it('renders nested rich JSX children without stringifying async child composition', async () => {
    const html = String(
      await jsx(Card, {
        children: jsx('div', {
          children: jsx(Table, {
            children: jsx(TableBody, {
              children: jsx(TableRow, {
                children: jsx(TableCell, { children: 'Paid & posted' }),
              }),
            }),
          }),
        }),
      }),
    );

    expect(html).toContain('<section');
    expect(html).toContain('<div');
    expect(html).toContain('<table');
    expect(html).toContain('Paid &amp; posted');
    expect(html).not.toContain('[object Promise]');
  });

  it('exports a StyleX style group', () => {
    expect({
      keys: Object.keys(cardStyles),
      marker: cardStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

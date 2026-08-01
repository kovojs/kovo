import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { jsx } from '@kovojs/server/jsx-runtime';
import { createWithSource } from '@kovojs/style/internal';

import { Card } from './card.js';
import { Table, TableBody, TableCell, TableRow } from './table.js';

describe('@kovojs/ui Card StyleX styles', () => {
  it('matches the rendered StyleX snapshot', () => {
    expect({
      rendered: renderUiComponent(Card, {
        children: '<h2>Release candidate</h2><p>Ready for audit.</p>',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = createWithSource('card.stylex.test.tsx')({
      root: {
        backgroundColor: '#111827',
        color: '#ffffff',
        padding: 24,
      },
    });

    expect(
      renderUiComponent(Card, {
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
});

import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Card, cardClasses, cardStyles } from './card.js';

describe('@kovojs/ui Card StyleX styles', () => {
  it('matches the rendered StyleX snapshot', () => {
    expect({
      classes: cardClasses,
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

  it('exports a StyleX style group', () => {
    expect({
      keys: Object.keys(cardStyles),
      marker: cardStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

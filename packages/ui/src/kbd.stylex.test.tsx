import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Kbd, kbdStyles } from './kbd.js';

describe('@kovojs/ui Kbd StyleX styles', () => {
  it('matches default rendered output', () => {
    expect({
      classes: [style.attrs(kbdStyles.root).class ?? ''] as const,
      rendered: Kbd.definition.render({ children: 'Ctrl' }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#111827',
          color: '#ffffff',
          textTransform: 'uppercase',
        },
      },
      { namespace: 'appKbd', source: 'app-kbd.tsx' },
    );

    expect(Kbd.definition.render({ children: 'K', style: overrides.root })).toMatchSnapshot();
  });

  it('exports a StyleX style group', () => {
    expect({
      keys: Object.keys(kbdStyles),
      marker: kbdStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

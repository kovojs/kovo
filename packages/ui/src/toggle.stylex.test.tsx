import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Toggle } from './toggle.js';

describe('@kovojs/ui Toggle StyleX styles', () => {
  it('matches native toggle states with StyleX output', () => {
    expect({
      disabled: Toggle.definition.render({ children: 'Disabled', disabled: true }),
      off: Toggle.definition.render({ children: 'Save view', pressed: false, variant: 'subtle' }),
      pressed: Toggle.definition.render({ children: 'Saved', pressed: true }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create({
      root: {
        backgroundColor: '#2563eb',
        minWidth: 120,
      },
    });

    expect(
      Toggle.definition.render({
        children: 'Custom',
        pressed: true,
        style: overrides.root,
      }),
    ).toMatchSnapshot();
  });
});

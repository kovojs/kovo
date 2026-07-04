import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Checkbox } from './checkbox.js';

describe('@kovojs/ui Checkbox StyleX styles', () => {
  it('matches native checkbox states with StyleX output', () => {
    expect({
      checked: Checkbox.definition.render({
        checked: true,
        children: 'Accept terms',
        id: 'terms',
        name: 'terms',
        required: true,
        value: 'accepted',
      }),
      disabled: Checkbox.definition.render({ children: 'Locked', disabled: true }),
      indeterminate: Checkbox.definition.render({
        checked: 'indeterminate',
        children: 'Some permissions',
        name: 'permissions',
        value: 'partial',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      input: {
        accentColor: '#2563eb',
        width: 20,
      },
      root: {
        columnGap: 12,
        fontWeight: 600,
      },
    });

    expect(
      Checkbox.definition.render({
        checked: true,
        children: 'Custom',
        styles: {
          input: overrides.input,
          root: overrides.root,
        },
      }),
    ).toMatchSnapshot();
  });
});

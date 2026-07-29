import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Checkbox } from './checkbox.js';

describe('@kovojs/ui Checkbox StyleX styles', () => {
  it('matches native checkbox states with StyleX output', () => {
    expect({
      checked: renderUiComponent(Checkbox, {
        checked: true,
        children: 'Accept terms',
        id: 'terms',
        name: 'terms',
        required: true,
        value: 'accepted',
      }),
      disabled: renderUiComponent(Checkbox, { children: 'Locked', disabled: true }),
      indeterminate: renderUiComponent(Checkbox, {
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
      renderUiComponent(Checkbox, {
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

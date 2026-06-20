import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Checkbox, checkboxStyles } from './checkbox.js';

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
      classes: [style.attrs(checkboxStyles.root).class ?? ''] as const,
      disabled: Checkbox.definition.render({ children: 'Locked', disabled: true }),
      indeterminate: Checkbox.definition.render({
        checked: 'indeterminate',
        children: 'Some permissions',
        name: 'permissions',
        value: 'partial',
      }),
      inputClasses: [style.attrs(checkboxStyles.input).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        input: {
          accentColor: '#2563eb',
          width: 20,
        },
        root: {
          columnGap: 12,
          fontWeight: 600,
        },
      },
      { namespace: 'appCheckbox', source: 'app-checkbox.tsx' },
    );

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

  it('exports StyleX style groups', () => {
    expect({
      inputMarker: checkboxStyles.input.$$css,
      keys: Object.keys(checkboxStyles),
      rootMarker: checkboxStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

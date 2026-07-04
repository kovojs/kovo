import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Switch } from './switch.js';

describe('@kovojs/ui Switch StyleX styles', () => {
  it('matches native switch states with StyleX output', () => {
    expect({
      checked: Switch.definition.render({
        checked: true,
        children: 'Notifications',
        id: 'notifications',
        name: 'notifications',
        value: 'enabled',
      }),
      disabled: Switch.definition.render({ children: 'Disabled', disabled: true }),
      unchecked: Switch.definition.render({ children: 'Marketing' }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
      input: {
        accentColor: '#2563eb',
        width: 44,
      },
      root: {
        columnGap: 12,
        fontWeight: 600,
      },
    });

    expect(
      Switch.definition.render({
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

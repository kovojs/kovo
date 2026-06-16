import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Switch, switchClasses, switchInputClasses, switchStyles } from './switch.js';

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
      classes: switchClasses,
      disabled: Switch.definition.render({ children: 'Disabled', disabled: true }),
      inputClasses: switchInputClasses,
      unchecked: Switch.definition.render({ children: 'Marketing' }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        input: {
          accentColor: '#2563eb',
          width: 44,
        },
        root: {
          columnGap: 12,
          fontWeight: 600,
        },
      },
      { namespace: 'appSwitch', source: 'app-switch.tsx' },
    );

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

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(switchStyles),
      inputMarker: switchStyles.input.$$css,
      rootMarker: switchStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

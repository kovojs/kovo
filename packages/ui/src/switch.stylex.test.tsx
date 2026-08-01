import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Switch } from './switch.js';

describe('@kovojs/ui Switch StyleX styles', () => {
  it('matches native switch states with StyleX output', () => {
    expect({
      checked: renderUiComponent(Switch, {
        checked: true,
        children: 'Notifications',
        id: 'notifications',
        name: 'notifications',
        value: 'enabled',
      }),
      disabled: renderUiComponent(Switch, { children: 'Disabled', disabled: true }),
      unchecked: renderUiComponent(Switch, { children: 'Marketing' }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('switch.stylex.test.tsx')({
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
      renderUiComponent(Switch, {
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

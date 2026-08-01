import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Toggle } from './toggle.js';

describe('@kovojs/ui Toggle StyleX styles', () => {
  it('matches native toggle states with StyleX output', () => {
    expect({
      disabled: renderUiComponent(Toggle, { children: 'Disabled', disabled: true }),
      off: renderUiComponent(Toggle, { children: 'Save view', pressed: false, variant: 'subtle' }),
      pressed: renderUiComponent(Toggle, { children: 'Saved', pressed: true }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = createWithSource('toggle.stylex.test.tsx')({
      root: {
        backgroundColor: '#2563eb',
        minWidth: 120,
      },
    });

    expect(
      renderUiComponent(Toggle, {
        children: 'Custom',
        pressed: true,
        style: overrides.root,
      }),
    ).toMatchSnapshot();
  });
});

import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Toggle, toggleStyles } from './toggle.js';

describe('@kovojs/ui Toggle StyleX styles', () => {
  it('matches native toggle states with StyleX output', () => {
    expect({
      classes: [
        style.attrs(toggleStyles.base.root, toggleStyles.variants.outline).class ?? '',
        style.attrs(toggleStyles.variants.subtle).class ?? '',
      ] as const,
      disabled: Toggle.definition.render({ children: 'Disabled', disabled: true }),
      off: Toggle.definition.render({ children: 'Save view', pressed: false, variant: 'subtle' }),
      pressed: Toggle.definition.render({ children: 'Saved', pressed: true }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#2563eb',
          minWidth: 120,
        },
      },
      { namespace: 'appToggle', source: 'app-toggle.tsx' },
    );

    expect(
      Toggle.definition.render({
        children: 'Custom',
        pressed: true,
        style: overrides.root,
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      baseKeys: Object.keys(toggleStyles.base),
      marker: toggleStyles.base.root.$$css,
      variantKeys: Object.keys(toggleStyles.variants),
    }).toMatchSnapshot();
  });
});

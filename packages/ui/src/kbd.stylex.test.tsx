import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Kbd } from './kbd.js';

describe('@kovojs/ui Kbd StyleX styles', () => {
  it('matches default rendered output', () => {
    expect({
      rendered: renderUiComponent(Kbd, { children: 'Ctrl' }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = createWithSource('kbd.stylex.test.tsx')({
      root: {
        backgroundColor: '#111827',
        color: '#ffffff',
        textTransform: 'uppercase',
      },
    });

    expect(renderUiComponent(Kbd, { children: 'K', style: overrides.root })).toMatchSnapshot();
  });
});

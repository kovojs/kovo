import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Progress } from './progress.js';

describe('@kovojs/ui Progress StyleX styles', () => {
  it('matches native progress states with StyleX output', () => {
    expect({
      complete: renderUiComponent(Progress, { children: '100%', max: 100, value: 100 }),
      indeterminate: renderUiComponent(Progress, { children: 'Loading', max: 100, value: null }),
      loading: renderUiComponent(Progress, {
        children: '42%',
        max: 100,
        value: 42,
        valueText: '42 of 100 tasks complete',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create({
      root: {
        accentColor: '#2563eb',
        height: 12,
      },
    });

    expect(
      renderUiComponent(Progress, {
        children: '75%',
        max: 100,
        style: overrides.root,
        value: 75,
      }),
    ).toMatchSnapshot();
  });
});

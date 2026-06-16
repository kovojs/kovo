import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Progress, progressClasses, progressStyles } from './progress.js';

describe('@kovojs/ui Progress StyleX styles', () => {
  it('matches native progress states with StyleX output', () => {
    expect({
      classes: progressClasses,
      complete: Progress.definition.render({ children: '100%', max: 100, value: 100 }),
      indeterminate: Progress.definition.render({ children: 'Loading', max: 100, value: null }),
      loading: Progress.definition.render({
        children: '42%',
        max: 100,
        value: 42,
        valueText: '42 of 100 tasks complete',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last override output', () => {
    const overrides = style.create(
      {
        root: {
          accentColor: '#2563eb',
          height: 12,
        },
      },
      { namespace: 'appProgress', source: 'app-progress.tsx' },
    );

    expect(
      Progress.definition.render({
        children: '75%',
        max: 100,
        style: overrides.root,
        value: 75,
      }),
    ).toMatchSnapshot();
  });

  it('exports a StyleX style group', () => {
    expect({
      keys: Object.keys(progressStyles),
      marker: progressStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

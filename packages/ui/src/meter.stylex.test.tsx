import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Meter, meterStyles } from './meter.js';

describe('@kovojs/ui Meter StyleX styles', () => {
  it('matches native meter states with StyleX output', () => {
    expect({
      classes: [style.attrs(meterStyles.root).class ?? ''] as const,
      optimum: Meter.definition.render({
        children: '84%',
        high: 90,
        low: 50,
        max: 100,
        min: 0,
        optimum: 80,
        value: 84,
        valueText: '84 percent quality score',
      }),
      suboptimum: Meter.definition.render({
        children: '42%',
        high: 90,
        low: 50,
        max: 100,
        optimum: 80,
        value: 42,
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
      { namespace: 'appMeter', source: 'app-meter.tsx' },
    );

    expect(
      Meter.definition.render({
        children: '72%',
        max: 100,
        style: overrides.root,
        value: 72,
      }),
    ).toMatchSnapshot();
  });

  it('exports a StyleX style group', () => {
    expect({
      keys: Object.keys(meterStyles),
      marker: meterStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Meter } from './meter.js';

describe('@kovojs/ui Meter StyleX styles', () => {
  it('matches native meter states with StyleX output', () => {
    expect({
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
    const overrides = style.create({
      root: {
        accentColor: '#2563eb',
        height: 12,
      },
    });

    expect(
      Meter.definition.render({
        children: '72%',
        max: 100,
        style: overrides.root,
        value: 72,
      }),
    ).toMatchSnapshot();
  });
});

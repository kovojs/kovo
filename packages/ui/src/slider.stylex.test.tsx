import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { Slider, SliderInput, SliderRange, SliderThumb, SliderTrack } from './slider.js';

describe('@kovojs/ui Slider StyleX styles', () => {
  it('matches semantic slider markup with StyleX output', () => {
    const state = {
      invalid: true,
      max: 100,
      min: 0,
      name: 'volume',
      orientation: 'vertical' as const,
      required: true,
      step: 5,
      value: 35,
    };

    expect({
      input: renderUiComponent(SliderInput, {
        ...state,
        descriptionId: 'volume-description',
        errorId: 'volume-error',
        form: 'settings-form',
        id: 'volume-input',
        label: 'Volume',
        valueText: '35 percent',
      }),
      range: renderUiComponent(SliderRange, {
        ...state,
        id: 'volume-range',
      }),
      root: renderUiComponent(Slider, {
        ...state,
        children: 'volume slider',
        id: 'volume-slider',
      }),
      thumb: renderUiComponent(SliderThumb, {
        ...state,
        descriptionId: 'volume-description',
        id: 'volume-thumb',
        label: 'Volume',
        valueText: '35 percent',
      }),
      track: renderUiComponent(SliderTrack, {
        ...state,
        children: renderUiComponent(SliderRange, state),
        id: 'volume-track',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('slider.stylex.test.tsx')({
      input: {
        accentColor: '#2563eb',
      },
      range: {
        backgroundColor: '#2563eb',
      },
      root: {
        rowGap: 12,
      },
      thumb: {
        borderColor: '#2563eb',
      },
      track: {
        backgroundColor: '#dbeafe',
      },
    });

    expect({
      input: renderUiComponent(SliderInput, { styles: { input: overrides.input }, value: 50 }),
      range: renderUiComponent(SliderRange, { styles: { range: overrides.range }, value: 50 }),
      root: renderUiComponent(Slider, {
        children: 'Custom slider',
        styles: { root: overrides.root },
      }),
      thumb: renderUiComponent(SliderThumb, { styles: { thumb: overrides.thumb }, value: 50 }),
      track: renderUiComponent(SliderTrack, {
        children: 'custom range',
        styles: { track: overrides.track },
        value: 50,
      }),
    }).toMatchSnapshot();
  });
});

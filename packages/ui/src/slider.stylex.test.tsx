import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Slider,
  SliderInput,
  SliderRange,
  SliderThumb,
  SliderTrack,
  sliderClasses,
  sliderInputClasses,
  sliderRangeClasses,
  sliderStyles,
  sliderThumbClasses,
  sliderTrackClasses,
} from './slider.js';

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
      classes: sliderClasses,
      input: SliderInput.definition.render({
        ...state,
        descriptionId: 'volume-description',
        errorId: 'volume-error',
        form: 'settings-form',
        id: 'volume-input',
        label: 'Volume',
        valueText: '35 percent',
      }),
      inputClasses: sliderInputClasses,
      range: SliderRange.definition.render({
        ...state,
        id: 'volume-range',
      }),
      rangeClasses: sliderRangeClasses,
      root: Slider.definition.render({
        ...state,
        children: 'volume slider',
        id: 'volume-slider',
      }),
      thumb: SliderThumb.definition.render({
        ...state,
        descriptionId: 'volume-description',
        id: 'volume-thumb',
        label: 'Volume',
        valueText: '35 percent',
      }),
      thumbClasses: sliderThumbClasses,
      track: SliderTrack.definition.render({
        ...state,
        children: SliderRange.definition.render(state),
        id: 'volume-track',
      }),
      trackClasses: sliderTrackClasses,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appSlider', source: 'app-slider.tsx' },
    );

    expect({
      input: SliderInput.definition.render({ styles: { input: overrides.input }, value: 50 }),
      range: SliderRange.definition.render({ styles: { range: overrides.range }, value: 50 }),
      root: Slider.definition.render({
        children: 'Custom slider',
        styles: { root: overrides.root },
      }),
      thumb: SliderThumb.definition.render({ styles: { thumb: overrides.thumb }, value: 50 }),
      track: SliderTrack.definition.render({
        children: 'custom range',
        styles: { track: overrides.track },
        value: 50,
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(sliderStyles),
      markers: {
        input: sliderStyles.input.$$css,
        range: sliderStyles.range.$$css,
        root: sliderStyles.root.$$css,
        thumb: sliderStyles.thumb.$$css,
        track: sliderStyles.track.$$css,
      },
    }).toMatchSnapshot();
  });
});

import { describe, expect, it } from 'vitest';

import {
  setSliderValue as exportedSetSliderValue,
  sliderInput as exportedSliderInput,
  sliderInputAttributes as exportedSliderInputAttributes,
  sliderRangeAttributes as exportedSliderRangeAttributes,
  sliderRootAttributes as exportedSliderRootAttributes,
  sliderThumbAttributes as exportedSliderThumbAttributes,
  sliderTrackAttributes as exportedSliderTrackAttributes,
  sliderValueFromString as exportedSliderValueFromString,
  sliderValueState as exportedSliderValueState,
} from '../index.js';
import {
  setSliderValue as primitiveSetSliderValue,
  sliderInput as primitiveSliderInput,
  sliderInputAttributes as primitiveSliderInputAttributes,
  sliderRangeAttributes as primitiveSliderRangeAttributes,
  sliderRootAttributes as primitiveSliderRootAttributes,
  sliderThumbAttributes as primitiveSliderThumbAttributes,
  sliderTrackAttributes as primitiveSliderTrackAttributes,
  sliderValueFromString as primitiveSliderValueFromString,
  sliderValueState as primitiveSliderValueState,
} from './index.js';
import {
  setSliderValue,
  sliderInput,
  sliderInputAttributes,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbAttributes,
  sliderTrackAttributes,
  sliderValueFromString,
  sliderValueState,
} from './slider.js';

describe('headless-ui slider primitive', () => {
  it('builds root and native range input attributes for slider state', () => {
    expect(
      sliderRootAttributes({
        id: 'price-slider',
        invalid: true,
        max: 500,
        min: 100,
        required: true,
        value: 250,
      }),
    ).toEqual({
      'data-invalid': '',
      'data-max': '500',
      'data-min': '100',
      'data-orientation': 'horizontal',
      'data-required': '',
      'data-value': '250',
      id: 'price-slider',
    });

    expect(
      sliderInputAttributes({
        descriptionId: 'price-help',
        errorId: 'price-error',
        form: 'pricing-form',
        id: 'price',
        invalid: true,
        label: 'Price',
        max: 500,
        min: 100,
        name: 'price',
        orientation: 'vertical',
        required: true,
        step: 25,
        value: 250,
        valueText: '$250',
      }),
    ).toEqual({
      'aria-describedby': 'price-help price-error',
      'aria-invalid': 'true',
      'aria-label': 'Price',
      'aria-orientation': 'vertical',
      'aria-valuetext': '$250',
      'data-invalid': '',
      'data-max': '500',
      'data-min': '100',
      'data-orientation': 'vertical',
      'data-required': '',
      'data-value': '250',
      disabled: false,
      form: 'pricing-form',
      id: 'price',
      max: 500,
      min: 100,
      name: 'price',
      required: true,
      step: 25,
      type: 'range',
      value: 250,
    });

    expect(sliderInputAttributes({ disabled: true })).toEqual({
      'data-disabled': '',
      'data-max': '100',
      'data-min': '0',
      'data-orientation': 'horizontal',
      'data-value': '0',
      disabled: true,
      max: 100,
      min: 0,
      step: 1,
      type: 'range',
      value: 0,
    });
  });

  it('builds decorative track, range, and thumb attributes from computed state', () => {
    const base = {
      'aria-hidden': 'true',
      'data-max': '10',
      'data-min': '0',
      'data-orientation': 'horizontal',
      'data-value': '2.5',
      'data-value-ratio': '0.25',
    };

    expect(sliderTrackAttributes({ max: 10, value: 2.5 })).toEqual({
      ...base,
      'data-part': 'track',
    });
    expect(sliderRangeAttributes({ max: 10, value: 2.5 })).toEqual({
      ...base,
      'data-part': 'range',
    });
    expect(sliderThumbAttributes({ id: 'thumb', max: 10, value: 2.5 })).toEqual({
      ...base,
      'data-part': 'thumb',
      id: 'thumb',
    });
  });

  it('normalizes invalid ranges, steps, and values', () => {
    expect(sliderValueState({ max: 0, min: 5, step: -1, value: 10 })).toEqual({
      max: 6,
      min: 5,
      orientation: 'horizontal',
      step: 1,
      value: 6,
      valueRatio: 1,
    });

    expect(sliderValueState({ max: 8, min: 4, value: Number.NaN })).toEqual({
      max: 8,
      min: 4,
      orientation: 'horizontal',
      step: 1,
      value: 4,
      valueRatio: 0,
    });

    expect(sliderValueFromString(' 12 ', { max: 10, min: 0 })).toBe(10);
    expect(sliderValueFromString('nope', { min: 3 })).toBe(3);
  });

  it('snaps explicit step values before exposing state or committing changes', () => {
    expect(sliderValueState({ max: 100, min: 10, step: 25, value: 63 })).toEqual({
      max: 100,
      min: 10,
      orientation: 'horizontal',
      step: 25,
      value: 60,
      valueRatio: 0.5555555555555556,
    });

    expect(
      sliderInputAttributes({
        max: 1,
        min: 0,
        step: 0.25,
        value: 0.62,
        valueText: '0.5 units',
      }),
    ).toMatchObject({
      'data-value': '0.5',
      'aria-valuetext': '0.5 units',
      step: 0.25,
      value: 0.5,
    });
    expect(sliderValueFromString('63', { max: 100, min: 10, step: 25 })).toBe(60);
    expect(setSliderValue({ max: 100, min: 0, step: 25, value: 25 }, 63, 'programmatic')).toEqual({
      changed: true,
      detail: {
        defaultPrevented: false,
        preventDefault: expect.any(Function),
        reason: 'programmatic',
        value: 75,
      },
      value: 75,
    });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setSliderValue({ value: 2 }, 4, 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:4']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe(4);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setSliderValue({ value: 2 }, 4, 'input', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe(2);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setSliderValue({ disabled: true, value: 2 }, 4, 'programmatic', { onValueChange }),
    ).toEqual({
      changed: false,
      value: 2,
    });
    expect(setSliderValue({ value: 2 }, 2, 'programmatic', { onValueChange })).toEqual({
      changed: false,
      value: 2,
    });
    expect(callCount).toBe(0);
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const inputEvent = sliderInputEvent('5');
    inputEvent.preventDefault();
    expect(
      sliderInput(
        inputEvent,
        { value: 1 },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses input change reasons and prevents native behavior when needed', () => {
    const reasons: string[] = [];
    const result = sliderInput(
      sliderInputEvent('7'),
      { value: 1 },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(result).toMatchObject({ changed: true, value: 7 });
    expect(reasons).toEqual(['input']);

    const disabledEvent = sliderInputEvent('7');
    const disabledResult = sliderInput(disabledEvent, { disabled: true, value: 1 });

    expect(disabledResult).toEqual({ changed: false, value: 1 });
    expect(disabledEvent.currentTarget?.value).toBe('1');
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = sliderInputEvent('7');
    const canceledResult = sliderInput(
      canceledEvent,
      { value: 1 },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: 1 });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.currentTarget?.value).toBe('1');
    expect(canceledEvent.defaultPrevented).toBe(true);

    const snappedEvent = sliderInputEvent('63');
    const snappedResult = sliderInput(snappedEvent, { max: 100, min: 0, step: 25, value: 25 });

    expect(snappedResult).toMatchObject({ changed: true, value: 75 });
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(sliderValueState())).toBe(true);
    expect(Object.isFrozen(sliderRootAttributes())).toBe(true);
    expect(Object.isFrozen(sliderInputAttributes())).toBe(true);
    expect(Object.isFrozen(sliderTrackAttributes())).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedSliderValueState).toBe(sliderValueState);
    expect(exportedSliderRootAttributes).toBe(sliderRootAttributes);
    expect(exportedSliderInputAttributes).toBe(sliderInputAttributes);
    expect(exportedSliderTrackAttributes).toBe(sliderTrackAttributes);
    expect(exportedSliderRangeAttributes).toBe(sliderRangeAttributes);
    expect(exportedSliderThumbAttributes).toBe(sliderThumbAttributes);
    expect(exportedSliderValueFromString).toBe(sliderValueFromString);
    expect(exportedSetSliderValue).toBe(setSliderValue);
    expect(exportedSliderInput).toBe(sliderInput);

    expect(primitiveSliderValueState).toBe(sliderValueState);
    expect(primitiveSliderRootAttributes).toBe(sliderRootAttributes);
    expect(primitiveSliderInputAttributes).toBe(sliderInputAttributes);
    expect(primitiveSliderTrackAttributes).toBe(sliderTrackAttributes);
    expect(primitiveSliderRangeAttributes).toBe(sliderRangeAttributes);
    expect(primitiveSliderThumbAttributes).toBe(sliderThumbAttributes);
    expect(primitiveSliderValueFromString).toBe(sliderValueFromString);
    expect(primitiveSetSliderValue).toBe(setSliderValue);
    expect(primitiveSliderInput).toBe(sliderInput);
  });
});

function sliderInputEvent(value: string): Event & {
  readonly currentTarget: { value: string } | null;
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: { value: string } | null;
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

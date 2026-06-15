import { describe, expect, it } from 'vitest';

import {
  setSliderValue as exportedSetSliderValue,
  sliderHiddenInputAttributes as exportedSliderHiddenInputAttributes,
  sliderInput as exportedSliderInput,
  sliderInputAttributes as exportedSliderInputAttributes,
  sliderKeyDown as exportedSliderKeyDown,
  sliderRangeAttributes as exportedSliderRangeAttributes,
  sliderRootAttributes as exportedSliderRootAttributes,
  sliderThumbDrag as exportedSliderThumbDrag,
  sliderThumbDragStart as exportedSliderThumbDragStart,
  sliderThumbAttributes as exportedSliderThumbAttributes,
  sliderTrackPointerDown as exportedSliderTrackPointerDown,
  sliderTrackAttributes as exportedSliderTrackAttributes,
  sliderValueFromString as exportedSliderValueFromString,
  sliderValueState as exportedSliderValueState,
} from '../index.js';
import {
  setSliderValue as primitiveSetSliderValue,
  sliderHiddenInputAttributes as primitiveSliderHiddenInputAttributes,
  sliderInput as primitiveSliderInput,
  sliderInputAttributes as primitiveSliderInputAttributes,
  sliderKeyDown as primitiveSliderKeyDown,
  sliderRangeAttributes as primitiveSliderRangeAttributes,
  sliderRootAttributes as primitiveSliderRootAttributes,
  sliderThumbDrag as primitiveSliderThumbDrag,
  sliderThumbDragStart as primitiveSliderThumbDragStart,
  sliderThumbAttributes as primitiveSliderThumbAttributes,
  sliderTrackPointerDown as primitiveSliderTrackPointerDown,
  sliderTrackAttributes as primitiveSliderTrackAttributes,
  sliderValueFromString as primitiveSliderValueFromString,
  sliderValueState as primitiveSliderValueState,
} from './index.js';
import {
  setSliderValue,
  sliderHiddenInputAttributes,
  sliderInput,
  sliderInputAttributes,
  sliderKeyDown,
  sliderRangeAttributes,
  sliderRootAttributes,
  sliderThumbDrag,
  sliderThumbDragStart,
  sliderThumbAttributes,
  sliderTrackPointerDown,
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

  it('builds decorative track/range and an interactive thumb from computed state', () => {
    const base = {
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
      'aria-hidden': 'true',
      'data-part': 'range',
    });

    expect(
      sliderThumbAttributes({
        id: 'thumb',
        label: 'Volume',
        max: 10,
        value: 2.5,
        valueText: '25 percent',
      }),
    ).toEqual({
      'aria-label': 'Volume',
      'aria-valuemax': 10,
      'aria-valuemin': 0,
      'aria-valuenow': 2.5,
      'aria-valuetext': '25 percent',
      'data-max': '10',
      'data-min': '0',
      'data-orientation': 'horizontal',
      'data-value': '2.5',
      'data-value-ratio': '0.25',
      'data-part': 'thumb',
      id: 'thumb',
      role: 'slider',
      tabIndex: 0,
    });
  });

  it('builds a hidden input for form submission when custom thumb is primary', () => {
    expect(
      sliderHiddenInputAttributes({
        disabled: false,
        form: 'pricing-form',
        max: 100,
        min: 0,
        name: 'price',
        step: 25,
        value: 63,
      }),
    ).toEqual({
      disabled: false,
      form: 'pricing-form',
      name: 'price',
      type: 'hidden',
      value: 75,
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

  it('maps slider keyboard commands to snapped values', () => {
    expect(sliderKeyDown(sliderKeyEvent('ArrowRight'), { step: 5, value: 10 })).toMatchObject({
      changed: true,
      value: 15,
    });
    expect(
      sliderKeyDown(sliderKeyEvent('ArrowLeft', { shiftKey: true }), { step: 5, value: 50 }),
    ).toMatchObject({
      changed: true,
      value: 0,
    });
    expect(
      sliderKeyDown(sliderKeyEvent('PageUp'), { largeStep: 20, max: 100, step: 5, value: 50 }),
    ).toMatchObject({ changed: true, value: 70 });
    expect(sliderKeyDown(sliderKeyEvent('End'), { max: 100, step: 25, value: 50 })).toMatchObject({
      changed: true,
      value: 100,
    });

    const ignored = sliderKeyEvent('Enter');
    expect(sliderKeyDown(ignored, { value: 50 })).toBeUndefined();
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('computes track-click and thumb-drag pointer values', () => {
    const trackDown = sliderPointerEvent('pointerdown', {
      currentTarget: { clientWidth: 200 },
      offsetX: 150,
    });
    expect(
      sliderTrackPointerDown(trackDown, {
        max: 100,
        min: 0,
        step: 25,
        value: 25,
      }),
    ).toMatchObject({
      changed: true,
      value: 75,
    });
    expect(trackDown.defaultPrevented).toBe(true);

    const start = sliderThumbDragStart(sliderPointerEvent('pointerdown', { clientX: 20 }), {
      value: 25,
    });
    expect(start).toEqual({ pointerStart: 20, valueStart: 25 });

    const drag = sliderThumbDrag(
      sliderPointerEvent('pointermove', {
        clientX: 70,
        currentTarget: { clientWidth: 200 },
      }),
      { max: 100, min: 0, step: 25, value: 25 },
      { pointerStart: 20, valueStart: 25 },
    );
    expect(drag).toMatchObject({ changed: true, value: 50 });
  });

  it('returns frozen records', () => {
    expect(Object.isFrozen(sliderValueState())).toBe(true);
    expect(Object.isFrozen(sliderRootAttributes())).toBe(true);
    expect(Object.isFrozen(sliderInputAttributes())).toBe(true);
    expect(Object.isFrozen(sliderHiddenInputAttributes())).toBe(true);
    expect(Object.isFrozen(sliderTrackAttributes())).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedSliderValueState).toBe(sliderValueState);
    expect(exportedSliderRootAttributes).toBe(sliderRootAttributes);
    expect(exportedSliderHiddenInputAttributes).toBe(sliderHiddenInputAttributes);
    expect(exportedSliderInputAttributes).toBe(sliderInputAttributes);
    expect(exportedSliderTrackAttributes).toBe(sliderTrackAttributes);
    expect(exportedSliderRangeAttributes).toBe(sliderRangeAttributes);
    expect(exportedSliderThumbAttributes).toBe(sliderThumbAttributes);
    expect(exportedSliderValueFromString).toBe(sliderValueFromString);
    expect(exportedSetSliderValue).toBe(setSliderValue);
    expect(exportedSliderInput).toBe(sliderInput);
    expect(exportedSliderKeyDown).toBe(sliderKeyDown);
    expect(exportedSliderTrackPointerDown).toBe(sliderTrackPointerDown);
    expect(exportedSliderThumbDragStart).toBe(sliderThumbDragStart);
    expect(exportedSliderThumbDrag).toBe(sliderThumbDrag);

    expect(primitiveSliderValueState).toBe(sliderValueState);
    expect(primitiveSliderRootAttributes).toBe(sliderRootAttributes);
    expect(primitiveSliderHiddenInputAttributes).toBe(sliderHiddenInputAttributes);
    expect(primitiveSliderInputAttributes).toBe(sliderInputAttributes);
    expect(primitiveSliderTrackAttributes).toBe(sliderTrackAttributes);
    expect(primitiveSliderRangeAttributes).toBe(sliderRangeAttributes);
    expect(primitiveSliderThumbAttributes).toBe(sliderThumbAttributes);
    expect(primitiveSliderValueFromString).toBe(sliderValueFromString);
    expect(primitiveSetSliderValue).toBe(setSliderValue);
    expect(primitiveSliderInput).toBe(sliderInput);
    expect(primitiveSliderKeyDown).toBe(sliderKeyDown);
    expect(primitiveSliderTrackPointerDown).toBe(sliderTrackPointerDown);
    expect(primitiveSliderThumbDragStart).toBe(sliderThumbDragStart);
    expect(primitiveSliderThumbDrag).toBe(sliderThumbDrag);
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

function sliderKeyEvent(
  key: string,
  options: { shiftKey?: boolean } = {},
): Event & { readonly key?: string; readonly shiftKey?: boolean } {
  const event = new Event('keydown', { cancelable: true }) as Event & {
    readonly key?: string;
    readonly shiftKey?: boolean;
  };
  Object.defineProperty(event, 'key', { value: key });
  Object.defineProperty(event, 'shiftKey', { value: options.shiftKey === true });
  return event;
}

function sliderPointerEvent(
  type: string,
  options: {
    clientX?: number;
    clientY?: number;
    currentTarget?: unknown;
    offsetX?: number;
    offsetY?: number;
  } = {},
): Event & {
  readonly clientX?: number;
  readonly clientY?: number;
  readonly currentTarget?: unknown;
  readonly offsetX?: number;
  readonly offsetY?: number;
} {
  const event = new Event(type, { cancelable: true }) as Event & {
    readonly clientX?: number;
    readonly clientY?: number;
    readonly currentTarget?: unknown;
    readonly offsetX?: number;
    readonly offsetY?: number;
  };
  for (const [key, value] of Object.entries(options)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

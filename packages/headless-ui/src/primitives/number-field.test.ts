import { describe, expect, it } from 'vitest';

import {
  decrementNumberFieldValue as exportedDecrementNumberFieldValue,
  incrementNumberFieldValue as exportedIncrementNumberFieldValue,
  numberFieldDecrementAttributes as exportedNumberFieldDecrementAttributes,
  numberFieldDecrementClick as exportedNumberFieldDecrementClick,
  numberFieldIncrementAttributes as exportedNumberFieldIncrementAttributes,
  numberFieldIncrementClick as exportedNumberFieldIncrementClick,
  numberFieldInput as exportedNumberFieldInput,
  numberFieldInputAttributes as exportedNumberFieldInputAttributes,
  numberFieldRootAttributes as exportedNumberFieldRootAttributes,
  numberFieldValueFromString as exportedNumberFieldValueFromString,
  setNumberFieldValue as exportedSetNumberFieldValue,
} from '../index.js';
import {
  decrementNumberFieldValue as primitiveDecrementNumberFieldValue,
  incrementNumberFieldValue as primitiveIncrementNumberFieldValue,
  numberFieldDecrementAttributes as primitiveNumberFieldDecrementAttributes,
  numberFieldDecrementClick as primitiveNumberFieldDecrementClick,
  numberFieldIncrementAttributes as primitiveNumberFieldIncrementAttributes,
  numberFieldIncrementClick as primitiveNumberFieldIncrementClick,
  numberFieldInput as primitiveNumberFieldInput,
  numberFieldInputAttributes as primitiveNumberFieldInputAttributes,
  numberFieldRootAttributes as primitiveNumberFieldRootAttributes,
  numberFieldValueFromString as primitiveNumberFieldValueFromString,
  setNumberFieldValue as primitiveSetNumberFieldValue,
} from './index.js';
import {
  decrementNumberFieldValue,
  incrementNumberFieldValue,
  numberFieldDecrementAttributes,
  numberFieldDecrementClick,
  numberFieldIncrementAttributes,
  numberFieldIncrementClick,
  numberFieldInput,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
  numberFieldValueFromString,
  setNumberFieldValue,
} from './number-field.js';

describe('headless-ui number-field primitive', () => {
  it('builds root and native number input attributes for field state', () => {
    expect(
      numberFieldRootAttributes({
        id: 'quantity-field',
        invalid: true,
        required: true,
      }),
    ).toEqual({
      'data-invalid': '',
      'data-required': '',
      id: 'quantity-field',
    });

    expect(
      numberFieldInputAttributes({
        descriptionId: 'quantity-help',
        errorId: 'quantity-error',
        id: 'quantity',
        invalid: true,
        label: 'Quantity',
        max: 10,
        min: 1,
        name: 'quantity',
        required: true,
        step: 2,
        value: 3,
      }),
    ).toEqual({
      'aria-describedby': 'quantity-help quantity-error',
      'aria-invalid': 'true',
      'aria-label': 'Quantity',
      'data-invalid': '',
      'data-required': '',
      disabled: false,
      id: 'quantity',
      max: 10,
      min: 1,
      name: 'quantity',
      required: true,
      step: 2,
      type: 'number',
      value: 3,
    });

    expect(numberFieldInputAttributes({ disabled: true, value: undefined })).toEqual({
      'data-disabled': '',
      disabled: true,
      type: 'number',
    });
  });

  it('builds increment and decrement button attributes with boundary disabled states', () => {
    expect(numberFieldIncrementAttributes({ inputId: 'quantity', value: 1 })).toEqual({
      'aria-controls': 'quantity',
      'aria-label': 'Increase value',
      'data-action': 'increment',
      disabled: false,
      type: 'button',
    });

    expect(
      numberFieldIncrementAttributes({
        id: 'quantity-up',
        label: 'Add one',
        max: 5,
        value: 5,
      }),
    ).toEqual({
      'aria-label': 'Add one',
      'data-action': 'increment',
      'data-disabled': '',
      disabled: true,
      id: 'quantity-up',
      type: 'button',
    });

    expect(numberFieldDecrementAttributes({ min: 0, value: 0 })).toEqual({
      'aria-label': 'Decrease value',
      'data-action': 'decrement',
      'data-disabled': '',
      disabled: true,
      type: 'button',
    });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setNumberFieldValue({ value: 2 }, 4, 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${String(detail.value)}`);
      },
    });

    expect(seen).toEqual(['programmatic:4']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe(4);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setNumberFieldValue({ value: 2 }, 4, 'input', {
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
      setNumberFieldValue({ disabled: true, value: 2 }, 4, 'programmatic', { onValueChange }),
    ).toEqual({ changed: false, value: 2 });
    expect(setNumberFieldValue({ value: 2 }, 2, 'programmatic', { onValueChange })).toEqual({
      changed: false,
      value: 2,
    });
    expect(callCount).toBe(0);
  });

  it('steps values with min, max, and step constraints', () => {
    expect(incrementNumberFieldValue({ max: 10, step: 3, value: 8 })).toMatchObject({
      changed: true,
      value: 10,
    });
    expect(decrementNumberFieldValue({ min: 0, step: 2, value: 1 })).toMatchObject({
      changed: true,
      value: 0,
    });
    expect(incrementNumberFieldValue({ min: 5 })).toMatchObject({
      changed: true,
      value: 5,
    });
    expect(decrementNumberFieldValue({ max: 9 })).toMatchObject({
      changed: true,
      value: 9,
    });
    expect(incrementNumberFieldValue({ max: 10, value: 10 })).toEqual({
      changed: false,
      value: 10,
    });
  });

  it('parses input strings into number field values', () => {
    expect(numberFieldValueFromString('42')).toBe(42);
    expect(numberFieldValueFromString(' 3.5 ')).toBe(3.5);
    expect(numberFieldValueFromString('')).toBeUndefined();
    expect(numberFieldValueFromString('abc')).toBeUndefined();
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const inputEvent = numberFieldInputEvent('5');
    inputEvent.preventDefault();
    expect(
      numberFieldInput(
        inputEvent,
        { value: 1 },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();
    expect(
      numberFieldIncrementClick(
        clickEvent,
        { value: 1 },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses input and stepper change reasons and prevents native behavior when needed', () => {
    const reasons: string[] = [];
    const inputResult = numberFieldInput(
      numberFieldInputEvent('7'),
      { value: 1 },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const incrementResult = numberFieldIncrementClick(
      new Event('click', { cancelable: true }),
      { max: 10, value: 7 },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const decrementResult = numberFieldDecrementClick(
      new Event('click', { cancelable: true }),
      { min: 0, value: 8 },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(inputResult).toMatchObject({ changed: true, value: 7 });
    expect(incrementResult).toMatchObject({ changed: true, value: 8 });
    expect(decrementResult).toMatchObject({ changed: true, value: 7 });
    expect(reasons).toEqual(['input', 'increment', 'decrement']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = numberFieldDecrementClick(disabledEvent, {
      disabled: true,
      value: 1,
    });

    expect(disabledResult).toEqual({ changed: false, value: 1 });
    expect(disabledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records', () => {
    expect(Object.isFrozen(numberFieldRootAttributes())).toBe(true);
    expect(Object.isFrozen(numberFieldInputAttributes())).toBe(true);
    expect(Object.isFrozen(numberFieldIncrementAttributes())).toBe(true);
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedNumberFieldRootAttributes).toBe(numberFieldRootAttributes);
    expect(exportedNumberFieldInputAttributes).toBe(numberFieldInputAttributes);
    expect(exportedNumberFieldIncrementAttributes).toBe(numberFieldIncrementAttributes);
    expect(exportedNumberFieldDecrementAttributes).toBe(numberFieldDecrementAttributes);
    expect(exportedSetNumberFieldValue).toBe(setNumberFieldValue);
    expect(exportedIncrementNumberFieldValue).toBe(incrementNumberFieldValue);
    expect(exportedDecrementNumberFieldValue).toBe(decrementNumberFieldValue);
    expect(exportedNumberFieldValueFromString).toBe(numberFieldValueFromString);
    expect(exportedNumberFieldInput).toBe(numberFieldInput);
    expect(exportedNumberFieldIncrementClick).toBe(numberFieldIncrementClick);
    expect(exportedNumberFieldDecrementClick).toBe(numberFieldDecrementClick);

    expect(primitiveNumberFieldRootAttributes).toBe(numberFieldRootAttributes);
    expect(primitiveNumberFieldInputAttributes).toBe(numberFieldInputAttributes);
    expect(primitiveNumberFieldIncrementAttributes).toBe(numberFieldIncrementAttributes);
    expect(primitiveNumberFieldDecrementAttributes).toBe(numberFieldDecrementAttributes);
    expect(primitiveSetNumberFieldValue).toBe(setNumberFieldValue);
    expect(primitiveIncrementNumberFieldValue).toBe(incrementNumberFieldValue);
    expect(primitiveDecrementNumberFieldValue).toBe(decrementNumberFieldValue);
    expect(primitiveNumberFieldValueFromString).toBe(numberFieldValueFromString);
    expect(primitiveNumberFieldInput).toBe(numberFieldInput);
    expect(primitiveNumberFieldIncrementClick).toBe(numberFieldIncrementClick);
    expect(primitiveNumberFieldDecrementClick).toBe(numberFieldDecrementClick);
  });
});

function numberFieldInputEvent(value: string): Event & {
  readonly currentTarget: { readonly value: string } | null;
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: { value: string } | null;
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

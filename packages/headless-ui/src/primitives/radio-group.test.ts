import { describe, expect, it } from 'vitest';

import {
  radioGroupItemAttributes as exportedRadioGroupItemAttributes,
  radioGroupItemClick as exportedRadioGroupItemClick,
  radioGroupKeyDown as exportedRadioGroupKeyDown,
  radioGroupLabelAttributes as exportedRadioGroupLabelAttributes,
  radioGroupMoveValue as exportedRadioGroupMoveValue,
  radioGroupRadioAttributes as exportedRadioGroupRadioAttributes,
  radioGroupRootAttributes as exportedRadioGroupRootAttributes,
  radioGroupRovingIndex as exportedRadioGroupRovingIndex,
  setRadioGroupValue as exportedSetRadioGroupValue,
} from '../index.js';
import {
  radioGroupItemAttributes,
  radioGroupItemChecked,
  radioGroupItemClick,
  radioGroupKeyDown,
  radioGroupLabelAttributes,
  radioGroupMoveValue,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
  radioGroupRovingIndex,
  setRadioGroupValue,
  type RadioGroupItem,
} from './radio-group.js';

const shippingItems: readonly RadioGroupItem[] = Object.freeze([
  { value: 'standard' },
  { disabled: true, value: 'express' },
  { value: 'overnight' },
]);

describe('headless-ui radio-group primitive', () => {
  it('builds root attributes for radiogroup semantics and field state', () => {
    expect(
      radioGroupRootAttributes({
        descriptionId: 'shipping-help',
        errorId: 'shipping-error',
        id: 'shipping',
        invalid: true,
        labelledBy: 'shipping-label',
        orientation: 'horizontal',
        required: true,
      }),
    ).toEqual({
      'aria-describedby': 'shipping-help shipping-error',
      'aria-invalid': 'true',
      'aria-labelledby': 'shipping-label',
      'aria-required': 'true',
      'data-invalid': '',
      'data-orientation': 'horizontal',
      'data-required': '',
      id: 'shipping',
      role: 'radiogroup',
    });

    expect(radioGroupRootAttributes({ disabled: true })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-orientation': 'vertical',
      role: 'radiogroup',
    });
  });

  it('builds item, radio input, and label attributes around native radio controls', () => {
    const state = {
      form: 'checkout-form',
      items: shippingItems,
      name: 'shipping',
      required: true,
      value: 'standard',
    };

    expect(
      radioGroupItemAttributes({ ...state, itemValue: 'standard', id: 'standard-row' }),
    ).toEqual({
      'data-state': 'checked',
      id: 'standard-row',
    });
    expect(
      radioGroupRadioAttributes({
        ...state,
        controlId: 'standard-radio',
        itemValue: 'standard',
      }),
    ).toEqual({
      'aria-checked': 'true',
      checked: true,
      'data-state': 'checked',
      disabled: false,
      form: 'checkout-form',
      id: 'standard-radio',
      name: 'shipping',
      required: true,
      tabIndex: 0,
      type: 'radio',
      value: 'standard',
    });
    expect(
      radioGroupRadioAttributes({
        ...state,
        itemValue: 'express',
      }),
    ).toEqual({
      'aria-checked': 'false',
      checked: false,
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      form: 'checkout-form',
      name: 'shipping',
      required: true,
      tabIndex: -1,
      type: 'radio',
      value: 'express',
    });
    expect(
      radioGroupLabelAttributes({ ...state, controlId: 'standard-radio', itemValue: 'standard' }),
    ).toEqual({
      'data-state': 'checked',
      for: 'standard-radio',
    });
  });

  it('falls back roving tabindex to the first enabled item when nothing is selected', () => {
    expect(radioGroupRovingIndex({ items: shippingItems })).toBe(0);
    expect(
      radioGroupRadioAttributes({
        items: shippingItems,
        itemValue: 'standard',
      }),
    ).toMatchObject({ tabIndex: 0 });
    expect(
      radioGroupRadioAttributes({
        items: shippingItems,
        itemValue: 'overnight',
      }),
    ).toMatchObject({ tabIndex: -1 });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setRadioGroupValue({ value: 'standard' }, 'overnight', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:overnight']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe('overnight');
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setRadioGroupValue({ value: 'standard' }, 'overnight', 'item-click', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe('standard');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setRadioGroupValue({ disabled: true, value: 'standard' }, 'overnight', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'standard' });
    expect(
      setRadioGroupValue({ items: shippingItems, value: 'standard' }, 'express', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'standard' });
    expect(
      setRadioGroupValue({ value: 'standard' }, 'standard', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'standard' });
    expect(callCount).toBe(0);
  });

  it('moves values with roving keyboard navigation', () => {
    expect(
      radioGroupMoveValue(
        {
          items: shippingItems,
          value: 'standard',
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'overnight' });

    expect(
      radioGroupMoveValue(
        {
          items: shippingItems,
          loop: false,
          value: 'overnight',
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'overnight' });
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();

    expect(
      radioGroupItemClick(
        clickEvent,
        { itemValue: 'overnight', value: 'standard' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const keyEvent = radioGroupKeyboardEvent('ArrowDown');
    keyEvent.preventDefault();
    expect(
      radioGroupKeyDown(
        keyEvent,
        { items: shippingItems, value: 'standard' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses item-click and keyboard change reasons from primitive handlers', () => {
    const reasons: string[] = [];
    const clickResult = radioGroupItemClick(
      new Event('click', { cancelable: true }),
      { itemValue: 'overnight', value: 'standard' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );
    const keyboardResult = radioGroupKeyDown(
      radioGroupKeyboardEvent('ArrowDown'),
      { items: shippingItems, value: 'standard' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(clickResult).toMatchObject({ changed: true, value: 'overnight' });
    expect(keyboardResult).toMatchObject({ changed: true, value: 'overnight' });
    expect(reasons).toEqual(['item-click', 'keyboard']);
  });

  it('prevents native radio changes when disabled, item-disabled, or canceled', () => {
    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = radioGroupItemClick(disabledEvent, {
      disabled: true,
      itemValue: 'overnight',
      value: 'standard',
    });

    expect(disabledResult).toEqual({ changed: false, value: 'standard' });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const itemDisabledEvent = new Event('click', { cancelable: true });
    const itemDisabledResult = radioGroupItemClick(itemDisabledEvent, {
      itemDisabled: true,
      itemValue: 'overnight',
      value: 'standard',
    });

    expect(itemDisabledResult).toEqual({ changed: false, value: 'standard' });
    expect(itemDisabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = radioGroupItemClick(
      canceledEvent,
      { itemValue: 'overnight', value: 'standard' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: 'standard' });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(radioGroupRootAttributes())).toBe(true);
    expect(Object.isFrozen(radioGroupRadioAttributes({ itemValue: 'standard' }))).toBe(true);
    expect(radioGroupItemChecked({ itemValue: 'standard', value: 'standard' })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedRadioGroupRootAttributes).toBe(radioGroupRootAttributes);
    expect(exportedRadioGroupItemAttributes).toBe(radioGroupItemAttributes);
    expect(exportedRadioGroupRadioAttributes).toBe(radioGroupRadioAttributes);
    expect(exportedRadioGroupLabelAttributes).toBe(radioGroupLabelAttributes);
    expect(exportedSetRadioGroupValue).toBe(setRadioGroupValue);
    expect(exportedRadioGroupMoveValue).toBe(radioGroupMoveValue);
    expect(exportedRadioGroupRovingIndex).toBe(radioGroupRovingIndex);
    expect(exportedRadioGroupItemClick).toBe(radioGroupItemClick);
    expect(exportedRadioGroupKeyDown).toBe(radioGroupKeyDown);
  });
});

function radioGroupKeyboardEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

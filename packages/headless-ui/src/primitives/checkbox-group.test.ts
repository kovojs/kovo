import { describe, expect, it } from 'vitest';

import {
  checkboxGroupControlAttributes as exportedCheckboxGroupControlAttributes,
  checkboxGroupItemAttributes as exportedCheckboxGroupItemAttributes,
  checkboxGroupItemChecked as exportedCheckboxGroupItemChecked,
  checkboxGroupItemClick as exportedCheckboxGroupItemClick,
  checkboxGroupKeyDown as exportedCheckboxGroupKeyDown,
  checkboxGroupLabelAttributes as exportedCheckboxGroupLabelAttributes,
  checkboxGroupMoveFocus as exportedCheckboxGroupMoveFocus,
  checkboxGroupRootAttributes as exportedCheckboxGroupRootAttributes,
  checkboxGroupRovingIndex as exportedCheckboxGroupRovingIndex,
  setCheckboxGroupValue as exportedSetCheckboxGroupValue,
  toggleCheckboxGroupItem as exportedToggleCheckboxGroupItem,
} from '../index.js';
import {
  checkboxGroupControlAttributes,
  checkboxGroupItemAttributes,
  checkboxGroupItemChecked,
  checkboxGroupItemClick,
  checkboxGroupKeyDown,
  checkboxGroupLabelAttributes,
  checkboxGroupMoveFocus,
  checkboxGroupRootAttributes,
  checkboxGroupRovingIndex,
  setCheckboxGroupValue,
  toggleCheckboxGroupItem,
  type CheckboxGroupItem,
} from './checkbox-group.js';

const preferenceItems: readonly CheckboxGroupItem[] = Object.freeze([
  { value: 'email' },
  { disabled: true, value: 'sms' },
  { value: 'push' },
]);

describe('headless-ui checkbox-group primitive', () => {
  it('builds root attributes for grouped checkbox semantics and field state', () => {
    expect(
      checkboxGroupRootAttributes({
        descriptionId: 'preferences-help',
        errorId: 'preferences-error',
        id: 'preferences',
        invalid: true,
        labelledBy: 'preferences-label',
        orientation: 'horizontal',
        required: true,
      }),
    ).toEqual({
      'aria-describedby': 'preferences-help preferences-error',
      'aria-invalid': 'true',
      'aria-labelledby': 'preferences-label',
      'aria-required': 'true',
      'data-invalid': '',
      'data-orientation': 'horizontal',
      'data-required': '',
      id: 'preferences',
      role: 'group',
    });

    expect(checkboxGroupRootAttributes({ disabled: true })).toEqual({
      'aria-disabled': 'true',
      'data-disabled': '',
      'data-orientation': 'vertical',
      role: 'group',
    });
  });

  it('builds item, native checkbox input, and label attributes', () => {
    const state = {
      form: 'preferences-form',
      items: preferenceItems,
      name: 'preferences',
      required: true,
      value: ['email'] as const,
    };

    expect(checkboxGroupItemAttributes({ ...state, id: 'email-row', itemValue: 'email' })).toEqual({
      'data-state': 'checked',
      id: 'email-row',
    });
    expect(
      checkboxGroupControlAttributes({
        ...state,
        controlId: 'email-checkbox',
        itemValue: 'email',
      }),
    ).toEqual({
      'aria-checked': 'true',
      checked: true,
      'data-state': 'checked',
      disabled: false,
      form: 'preferences-form',
      id: 'email-checkbox',
      name: 'preferences',
      required: true,
      tabIndex: 0,
      type: 'checkbox',
      value: 'email',
    });
    expect(
      checkboxGroupControlAttributes({
        ...state,
        itemValue: 'sms',
      }),
    ).toEqual({
      'aria-checked': 'false',
      checked: false,
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      form: 'preferences-form',
      name: 'preferences',
      required: true,
      tabIndex: -1,
      type: 'checkbox',
      value: 'sms',
    });
    expect(
      checkboxGroupLabelAttributes({ ...state, controlId: 'email-checkbox', itemValue: 'email' }),
    ).toEqual({
      'data-state': 'checked',
      for: 'email-checkbox',
    });
  });

  it('falls back roving tabindex to the first enabled checked item or first enabled item', () => {
    expect(checkboxGroupRovingIndex({ items: preferenceItems, value: ['push'] })).toBe(2);
    expect(checkboxGroupRovingIndex({ items: preferenceItems })).toBe(0);
    expect(
      checkboxGroupControlAttributes({
        items: preferenceItems,
        itemValue: 'email',
      }),
    ).toMatchObject({ tabIndex: 0 });
    expect(
      checkboxGroupControlAttributes({
        items: preferenceItems,
        itemValue: 'push',
      }),
    ).toMatchObject({ tabIndex: -1 });
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setCheckboxGroupValue({ value: ['email'] }, ['email', 'push'], 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${detail.value.join(',')}`);
      },
    });

    expect(seen).toEqual(['programmatic:email,push']);
    expect(result.changed).toBe(true);
    expect(result.value).toEqual(['email', 'push']);
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = toggleCheckboxGroupItem({ itemValue: 'push', value: ['email'] }, 'item-click', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toEqual(['email']);
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('toggles item membership and normalizes programmatic values', () => {
    expect(
      toggleCheckboxGroupItem({ itemValue: 'push', value: ['email'] }, 'programmatic'),
    ).toMatchObject({ changed: true, value: ['email', 'push'] });
    expect(
      toggleCheckboxGroupItem({ itemValue: 'email', value: ['email', 'push'] }, 'programmatic'),
    ).toMatchObject({ changed: true, value: ['push'] });
    expect(setCheckboxGroupValue({}, ['email', 'email', 'push'], 'programmatic')).toMatchObject({
      changed: true,
      value: ['email', 'push'],
    });
  });

  it('does not dispatch changes for disabled, item-disabled, disabled values, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      toggleCheckboxGroupItem(
        { disabled: true, itemValue: 'push', value: ['email'] },
        'programmatic',
        { onValueChange },
      ),
    ).toEqual({ changed: false, value: ['email'] });
    expect(
      toggleCheckboxGroupItem(
        { itemDisabled: true, itemValue: 'push', value: ['email'] },
        'programmatic',
        { onValueChange },
      ),
    ).toEqual({ changed: false, value: ['email'] });
    expect(
      setCheckboxGroupValue(
        { items: preferenceItems, value: ['email'] },
        ['email', 'sms'],
        'programmatic',
        { onValueChange },
      ),
    ).toEqual({ changed: false, value: ['email'] });
    expect(
      setCheckboxGroupValue({ value: ['email'] }, ['email'], 'programmatic', { onValueChange }),
    ).toEqual({ changed: false, value: ['email'] });
    expect(callCount).toBe(0);
  });

  it('moves focus with roving keyboard navigation without changing checked values', () => {
    expect(
      checkboxGroupMoveFocus(
        {
          items: preferenceItems,
          value: ['email'],
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'push' });

    expect(
      checkboxGroupMoveFocus(
        {
          activeValue: 'push',
          items: preferenceItems,
          loop: false,
          value: ['email'],
        },
        'next',
      ),
    ).toEqual({ index: 2, value: 'push' });
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const clickEvent = new Event('click', { cancelable: true });
    clickEvent.preventDefault();

    expect(
      checkboxGroupItemClick(
        clickEvent,
        { itemValue: 'push', value: ['email'] },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();

    const keyEvent = checkboxGroupKeyboardEvent('ArrowRight');
    keyEvent.preventDefault();
    expect(
      checkboxGroupKeyDown(keyEvent, { items: preferenceItems, value: ['email'] }),
    ).toBeUndefined();
  });

  it('uses item-click change reasons and prevents native checkbox changes when needed', () => {
    const reasons: string[] = [];
    const clickResult = checkboxGroupItemClick(
      new Event('click', { cancelable: true }),
      { itemValue: 'push', value: ['email'] },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(clickResult).toMatchObject({ changed: true, value: ['email', 'push'] });
    expect(reasons).toEqual(['item-click']);

    const disabledEvent = new Event('click', { cancelable: true });
    const disabledResult = checkboxGroupItemClick(disabledEvent, {
      itemDisabled: true,
      itemValue: 'push',
      value: ['email'],
    });

    expect(disabledResult).toEqual({ changed: false, value: ['email'] });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = checkboxGroupItemClick(
      canceledEvent,
      { itemValue: 'push', value: ['email'] },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: ['email'] });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('restores the native checked state when an item click is rejected', () => {
    const canceledEvent = checkboxGroupClickEvent(false);
    const canceledResult = checkboxGroupItemClick(
      canceledEvent,
      { itemValue: 'email', value: ['email'] },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: ['email'] });
    expect(canceledEvent.currentTarget.checked).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);

    const disabledEvent = checkboxGroupClickEvent(true);
    const disabledResult = checkboxGroupItemClick(disabledEvent, {
      itemDisabled: true,
      itemValue: 'sms',
      value: [],
    });

    expect(disabledResult).toEqual({ changed: false, value: [] });
    expect(disabledEvent.currentTarget.checked).toBe(false);
    expect(disabledEvent.defaultPrevented).toBe(true);
  });

  it('prevents default for handled keyboard navigation', () => {
    const event = checkboxGroupKeyboardEvent('ArrowRight');
    const result = checkboxGroupKeyDown(event, {
      items: preferenceItems,
      value: ['email'],
    });

    expect(result).toEqual({ index: 2, value: 'push' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not trap keyboard navigation for disabled, empty, or fully disabled groups', () => {
    const disabledEvent = checkboxGroupKeyboardEvent('ArrowRight');
    expect(
      checkboxGroupKeyDown(disabledEvent, {
        disabled: true,
        items: preferenceItems,
        value: ['email'],
      }),
    ).toEqual({ index: -1, value: undefined });
    expect(disabledEvent.defaultPrevented).toBe(false);

    const emptyEvent = checkboxGroupKeyboardEvent('ArrowRight');
    expect(checkboxGroupKeyDown(emptyEvent, { items: [] })).toEqual({
      index: -1,
      value: undefined,
    });
    expect(emptyEvent.defaultPrevented).toBe(false);

    const fullyDisabledEvent = checkboxGroupKeyboardEvent('ArrowRight');
    expect(
      checkboxGroupKeyDown(fullyDisabledEvent, {
        items: [
          { disabled: true, value: 'email' },
          { disabled: true, value: 'sms' },
        ],
        value: ['email'],
      }),
    ).toEqual({ index: -1, value: undefined });
    expect(fullyDisabledEvent.defaultPrevented).toBe(false);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(checkboxGroupRootAttributes())).toBe(true);
    expect(Object.isFrozen(checkboxGroupControlAttributes({ itemValue: 'email' }))).toBe(true);
    expect(checkboxGroupItemChecked({ itemValue: 'email', value: ['email'] })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedCheckboxGroupRootAttributes).toBe(checkboxGroupRootAttributes);
    expect(exportedCheckboxGroupItemAttributes).toBe(checkboxGroupItemAttributes);
    expect(exportedCheckboxGroupControlAttributes).toBe(checkboxGroupControlAttributes);
    expect(exportedCheckboxGroupLabelAttributes).toBe(checkboxGroupLabelAttributes);
    expect(exportedSetCheckboxGroupValue).toBe(setCheckboxGroupValue);
    expect(exportedToggleCheckboxGroupItem).toBe(toggleCheckboxGroupItem);
    expect(exportedCheckboxGroupMoveFocus).toBe(checkboxGroupMoveFocus);
    expect(exportedCheckboxGroupRovingIndex).toBe(checkboxGroupRovingIndex);
    expect(exportedCheckboxGroupItemChecked).toBe(checkboxGroupItemChecked);
    expect(exportedCheckboxGroupItemClick).toBe(checkboxGroupItemClick);
    expect(exportedCheckboxGroupKeyDown).toBe(checkboxGroupKeyDown);
  });
});

function checkboxGroupKeyboardEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

function checkboxGroupClickEvent(
  checked: boolean,
): Event & { readonly currentTarget: { checked: boolean } } {
  const target = { checked };
  const event = new Event('click', { cancelable: true }) as Event & {
    currentTarget: { checked: boolean };
  };
  Object.defineProperty(event, 'currentTarget', { value: target });
  return event;
}

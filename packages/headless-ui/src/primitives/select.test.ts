import { describe, expect, it } from 'vitest';

import {
  selectContentAttributes as exportedSelectContentAttributes,
  selectItemAttributes as exportedSelectItemAttributes,
  selectItemSelected as exportedSelectItemSelected,
  selectRootAttributes as exportedSelectRootAttributes,
  selectTriggerAttributes as exportedSelectTriggerAttributes,
  selectTriggerChange as exportedSelectTriggerChange,
  selectValueAttributes as exportedSelectValueAttributes,
  selectValueText as exportedSelectValueText,
  setSelectValue as exportedSetSelectValue,
} from '../index.js';
import {
  selectContentAttributes,
  selectItemAttributes,
  selectItemSelected,
  selectRootAttributes,
  selectTriggerAttributes,
  selectTriggerChange,
  selectValueAttributes,
  selectValueText,
  setSelectValue,
  type SelectItem,
} from './select.js';
import { selectRootAttributes as primitiveSelectRootAttributes } from './index.js';

const colorItems: readonly SelectItem[] = Object.freeze([
  { label: 'Red', value: 'red' },
  { disabled: true, label: 'Green', value: 'green' },
  { textValue: 'Blue tone', value: 'blue' },
]);

describe('headless-ui select primitive', () => {
  it('builds root and trigger attributes around a native select control', () => {
    expect(
      selectRootAttributes({
        id: 'color-root',
        invalid: true,
        open: true,
        required: true,
        value: '',
      }),
    ).toEqual({
      'data-invalid': '',
      'data-placeholder': '',
      'data-required': '',
      'data-state': 'open',
      id: 'color-root',
    });

    expect(
      selectTriggerAttributes({
        descriptionId: 'color-help',
        errorId: 'color-error',
        id: 'color',
        invalid: true,
        labelledBy: 'color-label',
        name: 'color',
        required: true,
        value: 'red',
      }),
    ).toEqual({
      'aria-describedby': 'color-help color-error',
      'aria-expanded': 'false',
      'aria-invalid': 'true',
      'aria-labelledby': 'color-label',
      'data-invalid': '',
      'data-required': '',
      'data-state': 'closed',
      disabled: false,
      id: 'color',
      name: 'color',
      required: true,
    });

    expect(selectTriggerAttributes({ disabled: true })).toEqual({
      'aria-expanded': 'false',
      'data-disabled': '',
      'data-placeholder': '',
      'data-state': 'closed',
      disabled: true,
    });
  });

  it('builds content, item, and value display attributes', () => {
    const state = {
      items: colorItems,
      open: true,
      value: 'red',
    };

    expect(selectContentAttributes({ ...state, id: 'color-list' })).toEqual({
      'data-state': 'open',
      id: 'color-list',
    });
    expect(selectItemAttributes({ ...state, itemLabel: 'Red', itemValue: 'red' })).toEqual({
      'data-state': 'checked',
      disabled: false,
      label: 'Red',
      selected: true,
      value: 'red',
    });
    expect(selectItemAttributes({ ...state, itemValue: 'green' })).toEqual({
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      selected: false,
      value: 'green',
    });
    expect(selectValueAttributes({ ...state, id: 'color-value' })).toEqual({
      id: 'color-value',
    });
    expect(selectValueAttributes({ placeholder: 'Choose color', value: '' })).toEqual({
      'data-placeholder': '',
    });
  });

  it('resolves selected value text from item labels, text values, raw values, or placeholder', () => {
    expect(selectValueText({ items: colorItems, value: 'red' })).toBe('Red');
    expect(selectValueText({ items: colorItems, value: 'blue' })).toBe('Blue tone');
    expect(selectValueText({ value: 'custom' })).toBe('custom');
    expect(selectValueText({ placeholder: 'Choose color', value: '' })).toBe('Choose color');
    expect(selectValueText({ placeholder: 'Choose color' })).toBe('Choose color');
  });

  it('dispatches cancelable value changes before committing state', () => {
    const seen: string[] = [];
    const result = setSelectValue({ value: 'red' }, 'blue', 'programmatic', {
      onValueChange(detail) {
        seen.push(`${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['programmatic:blue']);
    expect(result.changed).toBe(true);
    expect(result.value).toBe('blue');
    expect(result.detail?.defaultPrevented).toBe(false);
  });

  it('keeps the previous value when a value change is prevented', () => {
    const result = setSelectValue({ value: 'red' }, 'blue', 'trigger-change', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });

    expect(result.changed).toBe(false);
    expect(result.value).toBe('red');
    expect(result.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, item-disabled, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setSelectValue({ disabled: true, value: 'red' }, 'blue', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'red' });
    expect(
      setSelectValue({ items: colorItems, value: 'red' }, 'green', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'red' });
    expect(setSelectValue({ value: 'red' }, 'red', 'programmatic', { onValueChange })).toEqual({
      changed: false,
      value: 'red',
    });
    expect(callCount).toBe(0);
  });

  it('guards the primitive change handler when author behavior prevented default', () => {
    const event = selectChangeEvent('blue');
    event.preventDefault();

    expect(
      selectTriggerChange(
        event,
        { value: 'red' },
        {
          onValueChange() {
            throw new Error('change should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses trigger-change reason and prevents native changes when disabled or canceled', () => {
    const reasons: string[] = [];
    const changeResult = selectTriggerChange(
      selectChangeEvent('blue'),
      { value: 'red' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(changeResult).toMatchObject({ changed: true, value: 'blue' });
    expect(reasons).toEqual(['trigger-change']);

    const disabledEvent = selectChangeEvent('blue');
    const disabledResult = selectTriggerChange(disabledEvent, { disabled: true, value: 'red' });
    expect(disabledResult).toEqual({ changed: false, value: 'red' });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = selectChangeEvent('blue');
    const canceledResult = selectTriggerChange(
      canceledEvent,
      { value: 'red' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult).toMatchObject({ changed: false, value: 'red' });
    expect(canceledResult?.detail?.defaultPrevented).toBe(true);
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(selectRootAttributes())).toBe(true);
    expect(Object.isFrozen(selectTriggerAttributes())).toBe(true);
    expect(Object.isFrozen(selectItemAttributes({ itemValue: 'red' }))).toBe(true);
    expect(selectItemSelected({ itemValue: 'red', value: 'red' })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedSelectRootAttributes).toBe(selectRootAttributes);
    expect(exportedSelectTriggerAttributes).toBe(selectTriggerAttributes);
    expect(exportedSelectContentAttributes).toBe(selectContentAttributes);
    expect(exportedSelectItemAttributes).toBe(selectItemAttributes);
    expect(exportedSelectValueAttributes).toBe(selectValueAttributes);
    expect(exportedSelectValueText).toBe(selectValueText);
    expect(exportedSelectItemSelected).toBe(selectItemSelected);
    expect(exportedSetSelectValue).toBe(setSelectValue);
    expect(exportedSelectTriggerChange).toBe(selectTriggerChange);
    expect(primitiveSelectRootAttributes).toBe(selectRootAttributes);
  });
});

function selectChangeEvent(value: string): Event & {
  readonly currentTarget: EventTarget & { readonly value?: string };
} {
  const event = new Event('change', { cancelable: true }) as Event & {
    currentTarget: EventTarget & { value?: string };
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

import { describe, expect, it } from 'vitest';

import {
  selectContentAttributes as exportedSelectContentAttributes,
  selectHiddenInputAttributes as exportedSelectHiddenInputAttributes,
  selectItemClick as exportedSelectItemClick,
  selectItemAttributes as exportedSelectItemAttributes,
  selectItemSelected as exportedSelectItemSelected,
  selectKeyDown as exportedSelectKeyDown,
  selectMove as exportedSelectMove,
  selectOption as exportedSelectOption,
  selectRootAttributes as exportedSelectRootAttributes,
  selectTriggerClick as exportedSelectTriggerClick,
  selectTriggerAttributes as exportedSelectTriggerAttributes,
  selectTriggerChange as exportedSelectTriggerChange,
  selectTypeahead as exportedSelectTypeahead,
  selectValueAttributes as exportedSelectValueAttributes,
  selectValueText as exportedSelectValueText,
  setSelectOpen as exportedSetSelectOpen,
  setSelectValue as exportedSetSelectValue,
} from './select.js';
import {
  selectContentAttributes,
  selectHiddenInputAttributes,
  selectItemClick,
  selectItemAttributes,
  selectItemSelected,
  selectKeyDown,
  selectMove,
  selectOption,
  selectRootAttributes,
  selectTriggerClick,
  selectTriggerAttributes,
  selectTriggerChange,
  selectTypeahead,
  selectValueAttributes,
  selectValueText,
  setSelectOpen,
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
  it('builds root and button trigger attributes for a custom listbox control', () => {
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
        form: 'checkout',
        highlightedValue: 'blue',
        id: 'color',
        invalid: true,
        items: colorItems,
        labelledBy: 'color-label',
        listboxId: 'color-list',
        name: 'color',
        open: true,
        required: true,
        value: 'red',
      }),
    ).toEqual({
      // J3: open trigger advertises the highlighted option (blue = index 2).
      'aria-activedescendant': 'color-list-option-2',
      'aria-controls': 'color-list',
      'aria-describedby': 'color-help color-error',
      'aria-expanded': 'true',
      'aria-haspopup': 'listbox',
      'aria-invalid': 'true',
      'aria-labelledby': 'color-label',
      'data-invalid': '',
      'data-required': '',
      'data-state': 'open',
      id: 'color',
      role: 'combobox',
      type: 'button',
    });

    expect(selectTriggerAttributes({ disabled: true })).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'listbox',
      'data-disabled': '',
      'data-placeholder': '',
      'data-state': 'closed',
      disabled: true,
      role: 'combobox',
      type: 'button',
    });

    expect(selectHiddenInputAttributes({ form: 'checkout', name: 'color', value: 'red' })).toEqual({
      disabled: false,
      form: 'checkout',
      name: 'color',
      type: 'hidden',
      value: 'red',
    });
  });

  it('builds content, item, and value display attributes', () => {
    const state = {
      items: colorItems,
      listboxId: 'color-list',
      open: true,
      value: 'red',
    };

    expect(selectContentAttributes({ ...state, id: 'color-list' })).toEqual({
      'data-state': 'open',
      id: 'color-list',
      role: 'listbox',
    });
    expect(selectItemAttributes({ ...state, itemLabel: 'Red', itemValue: 'red' })).toEqual({
      'aria-selected': 'true',
      'data-state': 'checked',
      id: 'color-list-option-0',
      label: 'Red',
      role: 'option',
      value: 'red',
    });
    expect(
      selectItemAttributes({ ...state, highlightedValue: 'green', itemValue: 'green' }),
    ).toEqual({
      'aria-disabled': 'true',
      'aria-selected': 'false',
      'data-disabled': '',
      'data-highlighted': '',
      'data-state': 'unchecked',
      id: 'color-list-option-1',
      role: 'option',
      value: 'green',
    });
    expect(selectValueAttributes({ ...state, id: 'color-value' })).toEqual({
      id: 'color-value',
    });
    expect(selectValueAttributes({ placeholder: 'Choose color', value: '' })).toEqual({
      'data-placeholder': '',
    });

    expect(() =>
      selectItemAttributes({ items: colorItems, itemLabel: 'Red', itemValue: 'red', value: 'red' }),
    ).toThrow(/requires listboxId/);
  });

  // J3 (SPEC.md §4.6): an open listbox must expose the highlighted option to
  // assistive tech via aria-activedescendant on the focused trigger, and each
  // option must carry the matching id. Without these, a keyboard+SR user can't
  // perceive which option is highlighted (only data-highlighted changes today).
  it('exposes the highlighted option to AT via aria-activedescendant + matching option id', () => {
    const state = {
      highlightedValue: 'blue',
      items: colorItems,
      listboxId: 'color-list',
      open: true,
      value: 'red',
    };

    // The focused trigger points at the highlighted option (blue = index 2).
    const trigger = selectTriggerAttributes({ ...state, id: 'color' });
    expect(trigger['aria-activedescendant']).toBe('color-list-option-2');

    // The rendered option carries the exact same synthesized id.
    expect(selectItemAttributes({ ...state, itemValue: 'blue' }).id).toBe('color-list-option-2');

    // A closed listbox does not advertise an active descendant.
    expect(
      selectTriggerAttributes({ ...state, id: 'color', open: false })['aria-activedescendant'],
    ).toBeUndefined();

    expect(
      selectItemAttributes({ ...state, listboxId: 'color-list-b', itemValue: 'blue' }).id,
    ).toBe('color-list-b-option-2');
  });

  it('resolves selected value text from item labels, text values, raw values, or placeholder', () => {
    expect(selectValueText({ items: colorItems, value: 'red' })).toBe('Red');
    expect(selectValueText({ items: colorItems, value: 'blue' })).toBe('Blue tone');
    expect(selectValueText({ value: 'custom' })).toBe('custom');
    expect(selectValueText({ placeholder: 'Choose color', value: '' })).toBe('Choose color');
    expect(selectValueText({ placeholder: 'Choose color' })).toBe('Choose color');
  });

  it('omits inactive native boolean attributes from select and option records', () => {
    expect(selectTriggerAttributes({ disabled: false, id: 'color' })).toEqual({
      'aria-expanded': 'false',
      'aria-haspopup': 'listbox',
      'data-placeholder': '',
      'data-state': 'closed',
      id: 'color',
      role: 'combobox',
      type: 'button',
    });

    expect(selectItemAttributes({ itemDisabled: false, itemValue: 'red', value: 'blue' })).toEqual({
      'aria-selected': 'false',
      'data-state': 'unchecked',
      role: 'option',
      value: 'red',
    });
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

  it('opens, closes, and selects custom listbox options through reducers', () => {
    expect(setSelectOpen({ open: false }, true, 'trigger-click')).toMatchObject({
      changed: true,
      open: true,
    });
    expect(
      selectTriggerClick(new Event('click', { cancelable: true }), { open: false }),
    ).toMatchObject({
      changed: true,
      open: true,
    });
    expect(selectOption({ items: colorItems, open: true, value: 'red' }, 'blue')).toMatchObject({
      open: { changed: true, open: false },
      value: { changed: true, value: 'blue' },
    });

    const disabledClick = new Event('click', { cancelable: true });
    const disabledResult = selectItemClick(disabledClick, {
      items: colorItems,
      itemValue: 'green',
      open: true,
      value: 'red',
    });
    expect(disabledResult?.value).toEqual({ changed: false, value: 'red' });
    expect(disabledClick.defaultPrevented).toBe(true);
  });

  it('moves highlight and handles keyboard activation/typeahead for the custom listbox', () => {
    expect(
      selectMove({ highlightedValue: 'red', items: colorItems, value: 'red' }, 'ArrowDown', {
        loop: true,
      }),
    ).toEqual({ highlightedIndex: 2, highlightedValue: 'blue' });

    const openEvent = selectKeyEvent('ArrowDown');
    expect(
      selectKeyDown(openEvent, { items: colorItems, open: false, value: 'red' }),
    ).toMatchObject({
      changed: true,
      open: true,
    });
    expect(openEvent.defaultPrevented).toBe(true);

    expect(
      selectKeyDown(selectKeyEvent('ArrowDown'), {
        highlightedValue: 'red',
        items: colorItems,
        open: true,
        value: 'red',
      }),
    ).toEqual({ highlightedIndex: 2, highlightedValue: 'blue' });

    expect(
      selectKeyDown(selectKeyEvent('Enter'), {
        highlightedValue: 'blue',
        items: colorItems,
        open: true,
        value: 'red',
      }),
    ).toMatchObject({
      open: { changed: true, open: false },
      value: { changed: true, value: 'blue' },
    });

    expect(
      selectTypeahead({ highlightedValue: 'red', items: colorItems, value: 'red' }, 'b', {
        now: 1000,
      }),
    ).toMatchObject({ matchIndex: 2, value: 'blue' });
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
    expect(disabledEvent.currentTarget.value).toBe('red');
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
    expect(canceledEvent.currentTarget.value).toBe('red');
    expect(canceledEvent.defaultPrevented).toBe(true);
  });

  it('restores the native select value when the selected item is disabled', () => {
    const event = selectChangeEvent('green');
    const result = selectTriggerChange(event, { items: colorItems, value: 'red' });

    expect(result).toEqual({ changed: false, value: 'red' });
    expect(event.currentTarget.value).toBe('red');
    expect(event.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records and exposes selection helpers', () => {
    expect(Object.isFrozen(selectRootAttributes())).toBe(true);
    expect(Object.isFrozen(selectTriggerAttributes())).toBe(true);
    expect(Object.isFrozen(selectHiddenInputAttributes())).toBe(true);
    expect(Object.isFrozen(selectItemAttributes({ itemValue: 'red' }))).toBe(true);
    expect(selectItemSelected({ itemValue: 'red', value: 'red' })).toBe(true);
  });

  it('is exported through the package root', () => {
    expect(exportedSelectRootAttributes).toBe(selectRootAttributes);
    expect(exportedSelectTriggerAttributes).toBe(selectTriggerAttributes);
    expect(exportedSelectHiddenInputAttributes).toBe(selectHiddenInputAttributes);
    expect(exportedSelectContentAttributes).toBe(selectContentAttributes);
    expect(exportedSelectItemAttributes).toBe(selectItemAttributes);
    expect(exportedSelectValueAttributes).toBe(selectValueAttributes);
    expect(exportedSelectValueText).toBe(selectValueText);
    expect(exportedSelectItemSelected).toBe(selectItemSelected);
    expect(exportedSetSelectValue).toBe(setSelectValue);
    expect(exportedSetSelectOpen).toBe(setSelectOpen);
    expect(exportedSelectTriggerChange).toBe(selectTriggerChange);
    expect(exportedSelectTriggerClick).toBe(selectTriggerClick);
    expect(exportedSelectItemClick).toBe(selectItemClick);
    expect(exportedSelectKeyDown).toBe(selectKeyDown);
    expect(exportedSelectMove).toBe(selectMove);
    expect(exportedSelectTypeahead).toBe(selectTypeahead);
    expect(exportedSelectOption).toBe(selectOption);
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

function selectKeyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { readonly key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

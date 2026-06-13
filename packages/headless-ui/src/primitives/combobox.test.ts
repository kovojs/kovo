import { describe, expect, it } from 'vitest';

import {
  comboboxInput as exportedComboboxInput,
  comboboxInputAttributes as exportedComboboxInputAttributes,
  comboboxKeyDown as exportedComboboxKeyDown,
  comboboxListboxAttributes as exportedComboboxListboxAttributes,
  comboboxMove as exportedComboboxMove,
  comboboxOptionAttributes as exportedComboboxOptionAttributes,
  comboboxOptionClick as exportedComboboxOptionClick,
  comboboxOptionHighlighted as exportedComboboxOptionHighlighted,
  comboboxOptionSelected as exportedComboboxOptionSelected,
  comboboxRootAttributes as exportedComboboxRootAttributes,
  comboboxTypeahead as exportedComboboxTypeahead,
  comboboxValueAttributes as exportedComboboxValueAttributes,
  comboboxValueText as exportedComboboxValueText,
  selectComboboxOption as exportedSelectComboboxOption,
  setComboboxOpen as exportedSetComboboxOpen,
  setComboboxValue as exportedSetComboboxValue,
} from '../index.js';
import {
  comboboxInput,
  comboboxInputAttributes,
  comboboxKeyDown,
  comboboxListboxAttributes,
  comboboxMove,
  comboboxOptionAttributes,
  comboboxOptionClick,
  comboboxOptionHighlighted,
  comboboxOptionSelected,
  comboboxRootAttributes,
  comboboxTypeahead,
  comboboxValueAttributes,
  comboboxValueText,
  selectComboboxOption,
  setComboboxOpen,
  setComboboxValue,
  type ComboboxItem,
} from './combobox.js';
import { comboboxRootAttributes as primitiveComboboxRootAttributes } from './index.js';

const cityItems: readonly ComboboxItem[] = Object.freeze([
  { label: 'Austin', value: 'austin' },
  { disabled: true, label: 'Boston', value: 'boston' },
  { textValue: 'Chicago city', value: 'chicago' },
]);

describe('headless-ui combobox primitive', () => {
  it('builds root and input attributes around a native text input', () => {
    expect(
      comboboxRootAttributes({
        id: 'city-root',
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
      id: 'city-root',
    });

    expect(
      comboboxInputAttributes({
        descriptionId: 'city-help',
        errorId: 'city-error',
        highlightedValue: 'chicago',
        form: 'city-form',
        id: 'city',
        invalid: true,
        items: cityItems,
        labelledBy: 'city-label',
        listboxId: 'city-list',
        name: 'city',
        open: true,
        placeholder: 'Choose city',
        required: true,
        value: 'austin',
      }),
    ).toEqual({
      'aria-activedescendant': 'city-list-option-2',
      'aria-autocomplete': 'list',
      'aria-controls': 'city-list',
      'aria-describedby': 'city-help city-error',
      'aria-expanded': 'true',
      'aria-invalid': 'true',
      'aria-labelledby': 'city-label',
      'data-invalid': '',
      'data-required': '',
      'data-state': 'open',
      disabled: false,
      form: 'city-form',
      id: 'city',
      name: 'city',
      placeholder: 'Choose city',
      required: true,
      role: 'combobox',
      type: 'text',
      value: 'austin',
    });

    expect(comboboxInputAttributes({ disabled: true })).toEqual({
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'data-disabled': '',
      'data-placeholder': '',
      'data-state': 'closed',
      disabled: true,
      role: 'combobox',
      type: 'text',
      value: '',
    });
  });

  it('builds listbox, option, and value display attributes', () => {
    const state = {
      highlightedValue: 'chicago',
      items: cityItems,
      open: true,
      value: 'austin',
    };

    expect(comboboxListboxAttributes({ ...state, id: 'city-list' })).toEqual({
      'data-state': 'open',
      id: 'city-list',
      role: 'listbox',
    });
    expect(comboboxListboxAttributes({ id: 'city-list' })).toEqual({
      'data-placeholder': '',
      'data-state': 'closed',
      hidden: true,
      id: 'city-list',
      role: 'listbox',
    });
    expect(
      comboboxOptionAttributes({ ...state, id: 'city-option-0', itemValue: 'austin' }),
    ).toEqual({
      'aria-selected': 'true',
      'data-state': 'checked',
      id: 'city-option-0',
      role: 'option',
      value: 'austin',
    });
    expect(comboboxOptionAttributes({ ...state, itemValue: 'boston' })).toEqual({
      'aria-disabled': 'true',
      'aria-selected': 'false',
      'data-disabled': '',
      'data-state': 'unchecked',
      role: 'option',
      value: 'boston',
    });
    expect(comboboxOptionAttributes({ ...state, itemValue: 'chicago' })).toEqual({
      'aria-selected': 'false',
      'data-highlighted': '',
      'data-state': 'unchecked',
      role: 'option',
      value: 'chicago',
    });
    expect(comboboxValueAttributes({ ...state, id: 'city-value' })).toEqual({
      id: 'city-value',
    });
    expect(comboboxValueAttributes({ placeholder: 'Choose city', value: '' })).toEqual({
      'data-placeholder': '',
    });
  });

  it('resolves display text from option labels, text values, raw values, or placeholder', () => {
    expect(comboboxValueText({ items: cityItems, value: 'austin' })).toBe('Austin');
    expect(comboboxValueText({ items: cityItems, value: 'chicago' })).toBe('Chicago city');
    expect(comboboxValueText({ value: 'custom' })).toBe('custom');
    expect(comboboxValueText({ placeholder: 'Choose city', value: '' })).toBe('Choose city');
    expect(comboboxValueText({ placeholder: 'Choose city' })).toBe('Choose city');
  });

  it('dispatches cancelable value and open-state changes before committing state', () => {
    const seen: string[] = [];
    const valueResult = setComboboxValue({ value: 'austin' }, 'chicago', 'programmatic', {
      onValueChange(detail) {
        seen.push(`value:${detail.reason}:${detail.value}`);
      },
    });
    const openResult = setComboboxOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual(['value:programmatic:chicago', 'open:programmatic:true']);
    expect(valueResult).toMatchObject({ changed: true, value: 'chicago' });
    expect(openResult).toMatchObject({ changed: true, open: true });
  });

  it('keeps previous state when value or open changes are prevented', () => {
    const valueResult = setComboboxValue({ value: 'austin' }, 'chicago', 'input', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });
    const openResult = setComboboxOpen({ open: true }, false, 'escape-key', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });

    expect(valueResult.changed).toBe(false);
    expect(valueResult.value).toBe('austin');
    expect(valueResult.detail?.defaultPrevented).toBe(true);
    expect(openResult.changed).toBe(false);
    expect(openResult.open).toBe(true);
    expect(openResult.detail?.defaultPrevented).toBe(true);
  });

  it('does not dispatch changes for disabled, option-disabled, or unchanged states', () => {
    let callCount = 0;
    const onValueChange = () => {
      callCount += 1;
    };

    expect(
      setComboboxValue({ disabled: true, value: 'austin' }, 'chicago', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'austin' });
    expect(
      setComboboxValue({ items: cityItems, value: 'austin' }, 'boston', 'programmatic', {
        onValueChange,
      }),
    ).toEqual({ changed: false, value: 'austin' });
    expect(
      setComboboxValue({ value: 'austin' }, 'austin', 'programmatic', { onValueChange }),
    ).toEqual({
      changed: false,
      value: 'austin',
    });
    expect(callCount).toBe(0);
  });

  it('selects an option by changing value then closing the listbox', () => {
    const seen: string[] = [];
    const result = selectComboboxOption(
      { items: cityItems, open: true, value: 'austin' },
      'chicago',
      {
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
        },
        onValueChange(detail) {
          seen.push(`value:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(result.value).toMatchObject({ changed: true, value: 'chicago' });
    expect(result.open).toMatchObject({ changed: true, open: false });
    expect(seen).toEqual(['value:option-select:chicago', 'open:option-select:false']);
  });

  it('uses shared typeahead helpers to find enabled options', () => {
    const first = comboboxTypeahead({ items: cityItems, value: 'austin' }, 'b', {
      now: 100,
    });
    const second = comboboxTypeahead({ items: cityItems, value: 'austin' }, 'c', {
      now: 900,
      state: first.state,
    });

    expect(first).toMatchObject({ matchIndex: -1, value: 'austin' });
    expect(second).toMatchObject({ matchIndex: 2, value: 'chicago' });
    expect(second.state.buffer).toBe('c');
  });

  it('moves highlighted options with shared keyboard navigation while skipping disabled items', () => {
    expect(comboboxMove({ items: cityItems, value: 'austin' }, 'ArrowDown')).toEqual({
      highlightedIndex: 2,
      highlightedValue: 'chicago',
    });
    expect(
      comboboxMove({ highlightedValue: 'chicago', items: cityItems, value: 'austin' }, 'ArrowDown'),
    ).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'austin',
    });
    expect(comboboxMove({ items: cityItems, value: 'austin' }, 'Home')).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'austin',
    });
    expect(comboboxMove({ disabled: true, items: cityItems }, 'ArrowDown')).toBeUndefined();
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const inputEvent = comboboxInputEvent('chicago');
    inputEvent.preventDefault();
    const optionEvent = new Event('click', { cancelable: true });
    optionEvent.preventDefault();
    const keyEvent = comboboxKeyEvent('Escape');
    keyEvent.preventDefault();

    expect(
      comboboxInput(
        inputEvent,
        { value: 'austin' },
        {
          onValueChange() {
            throw new Error('input should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      comboboxOptionClick(
        optionEvent,
        { itemValue: 'chicago', value: 'austin' },
        {
          onValueChange() {
            throw new Error('option should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      comboboxKeyDown(
        keyEvent,
        { open: true },
        {
          onOpenChange() {
            throw new Error('keyboard should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
  });

  it('uses handler reasons and prevents native changes when disabled or canceled', () => {
    const reasons: string[] = [];
    const inputResult = comboboxInput(
      comboboxInputEvent('chicago'),
      { value: 'austin' },
      {
        onValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(inputResult).toMatchObject({ changed: true, value: 'chicago' });
    expect(reasons).toEqual(['input']);

    const disabledEvent = comboboxInputEvent('chicago');
    const disabledResult = comboboxInput(disabledEvent, { disabled: true, value: 'austin' });
    expect(disabledResult).toEqual({ changed: false, value: 'austin' });
    expect(disabledEvent.currentTarget.value).toBe('austin');
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledInputEvent = comboboxInputEvent('denver');
    const canceledInputResult = comboboxInput(
      canceledInputEvent,
      { value: 'austin' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledInputResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      value: 'austin',
    });
    expect(canceledInputEvent.currentTarget.value).toBe('austin');
    expect(canceledInputEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = comboboxOptionClick(
      canceledEvent,
      { itemValue: 'chicago', open: true, value: 'austin' },
      {
        onValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(canceledResult?.value).toMatchObject({ changed: false, value: 'austin' });
    expect(canceledEvent.defaultPrevented).toBe(true);

    const escapeEvent = comboboxKeyEvent('Escape');
    expect(comboboxKeyDown(escapeEvent, { open: true })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);

    const arrowEvent = comboboxKeyEvent('ArrowDown');
    expect(comboboxKeyDown(arrowEvent, { open: false })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'arrow-key', value: true }),
      open: true,
    });
    expect(arrowEvent.defaultPrevented).toBe(true);

    const moveEvent = comboboxKeyEvent('ArrowDown');
    expect(
      comboboxKeyDown(moveEvent, { highlightedValue: 'austin', items: cityItems, open: true }),
    ).toEqual({
      highlightedIndex: 2,
      highlightedValue: 'chicago',
    });
    expect(moveEvent.defaultPrevented).toBe(true);

    const enterEvent = comboboxKeyEvent('Enter');
    expect(
      comboboxKeyDown(
        enterEvent,
        {
          highlightedValue: 'chicago',
          items: cityItems,
          open: true,
          value: 'austin',
        },
        {
          onValueChange(detail) {
            reasons.push(`${detail.reason}:${detail.value}`);
          },
        },
      ),
    ).toMatchObject({
      open: { changed: true, open: false },
      value: { changed: true, value: 'chicago' },
    });
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(reasons).toContain('option-select:chicago');
  });

  it('restores selected value when option-select close is canceled', () => {
    const result = selectComboboxOption(
      { highlightedValue: 'chicago', open: true, value: 'austin' },
      'chicago',
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(result).toMatchObject({
      open: {
        changed: false,
        detail: expect.objectContaining({ defaultPrevented: true }),
        open: true,
      },
      value: { changed: false, value: 'austin' },
    });

    const event = comboboxKeyEvent('Enter');
    const keyResult = comboboxKeyDown(
      event,
      {
        highlightedValue: 'chicago',
        items: cityItems,
        open: true,
        value: 'austin',
      },
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(keyResult).toMatchObject({
      open: { changed: false, open: true },
      value: { changed: false, value: 'austin' },
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('returns frozen attribute records and exposes option helpers', () => {
    expect(Object.isFrozen(comboboxRootAttributes())).toBe(true);
    expect(Object.isFrozen(comboboxInputAttributes())).toBe(true);
    expect(Object.isFrozen(comboboxOptionAttributes({ itemValue: 'austin' }))).toBe(true);
    expect(comboboxOptionSelected({ itemValue: 'austin', value: 'austin' })).toBe(true);
    expect(comboboxOptionHighlighted({ highlightedValue: 'austin', itemValue: 'austin' })).toBe(
      true,
    );
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedComboboxRootAttributes).toBe(comboboxRootAttributes);
    expect(exportedComboboxInputAttributes).toBe(comboboxInputAttributes);
    expect(exportedComboboxListboxAttributes).toBe(comboboxListboxAttributes);
    expect(exportedComboboxMove).toBe(comboboxMove);
    expect(exportedComboboxOptionAttributes).toBe(comboboxOptionAttributes);
    expect(exportedComboboxValueAttributes).toBe(comboboxValueAttributes);
    expect(exportedComboboxValueText).toBe(comboboxValueText);
    expect(exportedComboboxOptionSelected).toBe(comboboxOptionSelected);
    expect(exportedComboboxOptionHighlighted).toBe(comboboxOptionHighlighted);
    expect(exportedComboboxTypeahead).toBe(comboboxTypeahead);
    expect(exportedSetComboboxValue).toBe(setComboboxValue);
    expect(exportedSetComboboxOpen).toBe(setComboboxOpen);
    expect(exportedSelectComboboxOption).toBe(selectComboboxOption);
    expect(exportedComboboxInput).toBe(comboboxInput);
    expect(exportedComboboxOptionClick).toBe(comboboxOptionClick);
    expect(exportedComboboxKeyDown).toBe(comboboxKeyDown);
    expect(primitiveComboboxRootAttributes).toBe(comboboxRootAttributes);
  });
});

function comboboxInputEvent(value: string): Event & {
  readonly currentTarget: EventTarget & { value?: string };
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: EventTarget & { value?: string };
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

function comboboxKeyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

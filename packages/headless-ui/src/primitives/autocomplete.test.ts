import { describe, expect, it } from 'vitest';

import {
  autocompleteInput as exportedAutocompleteInput,
  autocompleteInputAttributes as exportedAutocompleteInputAttributes,
  autocompleteKeyDown as exportedAutocompleteKeyDown,
  autocompleteListAttributes as exportedAutocompleteListAttributes,
  autocompleteMove as exportedAutocompleteMove,
  autocompleteOptionAttributes as exportedAutocompleteOptionAttributes,
  autocompleteOptionClick as exportedAutocompleteOptionClick,
  autocompleteOptionHighlighted as exportedAutocompleteOptionHighlighted,
  autocompleteOptionSelected as exportedAutocompleteOptionSelected,
  autocompleteRootAttributes as exportedAutocompleteRootAttributes,
  autocompleteSuggestions as exportedAutocompleteSuggestions,
  autocompleteTypeahead as exportedAutocompleteTypeahead,
  autocompleteValueAttributes as exportedAutocompleteValueAttributes,
  autocompleteValueText as exportedAutocompleteValueText,
  selectAutocompleteOption as exportedSelectAutocompleteOption,
  setAutocompleteInputValue as exportedSetAutocompleteInputValue,
  setAutocompleteOpen as exportedSetAutocompleteOpen,
  setAutocompleteValue as exportedSetAutocompleteValue,
} from '../index.js';
import {
  autocompleteInput,
  autocompleteInputAttributes,
  autocompleteKeyDown,
  autocompleteListAttributes,
  autocompleteMove,
  autocompleteOptionAttributes,
  autocompleteOptionClick,
  autocompleteOptionHighlighted,
  autocompleteOptionSelected,
  autocompleteRootAttributes,
  autocompleteSuggestions,
  autocompleteTypeahead,
  autocompleteValueAttributes,
  autocompleteValueText,
  selectAutocompleteOption,
  setAutocompleteInputValue,
  setAutocompleteOpen,
  setAutocompleteValue,
  type AutocompleteItem,
} from './autocomplete.js';
import { autocompleteRootAttributes as primitiveAutocompleteRootAttributes } from './index.js';

const cityItems: readonly AutocompleteItem[] = Object.freeze([
  { label: 'Austin', value: 'austin' },
  { disabled: true, label: 'Boston', value: 'boston' },
  { textValue: 'Chicago city', value: 'chicago' },
]);

describe('headless-ui autocomplete primitive', () => {
  it('builds root and input attributes around a native text input and datalist', () => {
    expect(
      autocompleteRootAttributes({
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
      autocompleteInputAttributes({
        descriptionId: 'city-help',
        errorId: 'city-error',
        highlightedValue: 'chicago',
        id: 'city',
        inputValue: 'chi',
        invalid: true,
        items: cityItems,
        labelledBy: 'city-label',
        listId: 'city-list',
        name: 'city',
        open: true,
        placeholder: 'Choose city',
        required: true,
      }),
    ).toEqual({
      'aria-activedescendant': 'city-list-option-2',
      'aria-autocomplete': 'list',
      'aria-controls': 'city-list',
      'aria-describedby': 'city-help city-error',
      'aria-expanded': 'true',
      'aria-invalid': 'true',
      'aria-labelledby': 'city-label',
      autocomplete: 'off',
      'data-invalid': '',
      'data-placeholder': '',
      'data-required': '',
      'data-state': 'open',
      disabled: false,
      id: 'city',
      list: 'city-list',
      name: 'city',
      placeholder: 'Choose city',
      required: true,
      role: 'combobox',
      type: 'text',
      value: 'chi',
    });

    expect(autocompleteInputAttributes({ disabled: true })).toEqual({
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      autocomplete: 'off',
      'data-disabled': '',
      'data-placeholder': '',
      'data-state': 'closed',
      disabled: true,
      role: 'combobox',
      type: 'text',
      value: '',
    });
  });

  it('builds list, option, and value display attributes', () => {
    const state = {
      highlightedValue: 'chicago',
      items: cityItems,
      open: true,
      value: 'austin',
    };

    expect(autocompleteListAttributes({ ...state, id: 'city-list' })).toEqual({
      'data-state': 'open',
      id: 'city-list',
    });
    expect(
      autocompleteOptionAttributes({ ...state, id: 'city-option-0', itemValue: 'austin' }),
    ).toEqual({
      'data-state': 'checked',
      disabled: false,
      id: 'city-option-0',
      selected: true,
      value: 'austin',
    });
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'boston' })).toEqual({
      'data-disabled': '',
      'data-state': 'unchecked',
      disabled: true,
      selected: false,
      value: 'boston',
    });
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'chicago' })).toEqual({
      'data-highlighted': '',
      'data-state': 'unchecked',
      disabled: false,
      selected: false,
      value: 'chicago',
    });
    expect(autocompleteValueAttributes({ ...state, id: 'city-value' })).toEqual({
      id: 'city-value',
    });
    expect(autocompleteValueAttributes({ placeholder: 'Choose city', value: '' })).toEqual({
      'data-placeholder': '',
    });
  });

  it('resolves display text and filters enabled suggestions by input value', () => {
    expect(autocompleteValueText({ items: cityItems, value: 'austin' })).toBe('Austin');
    expect(autocompleteValueText({ items: cityItems, value: 'chicago' })).toBe('Chicago city');
    expect(autocompleteValueText({ value: 'custom' })).toBe('custom');
    expect(autocompleteValueText({ placeholder: 'Choose city', value: '' })).toBe('Choose city');
    expect(autocompleteSuggestions({ inputValue: 'c', items: cityItems })).toEqual([
      { textValue: 'Chicago city', value: 'chicago' },
    ]);
    expect(autocompleteSuggestions({ inputValue: '', items: cityItems })).toEqual([
      { label: 'Austin', value: 'austin' },
      { textValue: 'Chicago city', value: 'chicago' },
    ]);
  });

  it('dispatches cancelable input, value, and open-state changes before committing state', () => {
    const seen: string[] = [];
    const inputResult = setAutocompleteInputValue({ inputValue: 'aus' }, 'chi', 'programmatic', {
      onInputValueChange(detail) {
        seen.push(`input:${detail.reason}:${detail.value}`);
      },
    });
    const valueResult = setAutocompleteValue({ value: 'austin' }, 'chicago', 'programmatic', {
      onValueChange(detail) {
        seen.push(`value:${detail.reason}:${detail.value}`);
      },
    });
    const openResult = setAutocompleteOpen({ open: false }, true, 'programmatic', {
      onOpenChange(detail) {
        seen.push(`open:${detail.reason}:${detail.value}`);
      },
    });

    expect(seen).toEqual([
      'input:programmatic:chi',
      'value:programmatic:chicago',
      'open:programmatic:true',
    ]);
    expect(inputResult).toMatchObject({ changed: true, inputValue: 'chi' });
    expect(valueResult).toMatchObject({ changed: true, value: 'chicago' });
    expect(openResult).toMatchObject({ changed: true, open: true });
  });

  it('keeps previous state when state changes are prevented', () => {
    const inputResult = setAutocompleteInputValue({ inputValue: 'aus' }, 'chi', 'input', {
      onInputValueChange(detail) {
        detail.preventDefault();
      },
    });
    const valueResult = setAutocompleteValue({ value: 'austin' }, 'chicago', 'option-select', {
      onValueChange(detail) {
        detail.preventDefault();
      },
    });
    const openResult = setAutocompleteOpen({ open: true }, false, 'escape-key', {
      onOpenChange(detail) {
        detail.preventDefault();
      },
    });

    expect(inputResult.changed).toBe(false);
    expect(inputResult.inputValue).toBe('aus');
    expect(inputResult.detail?.defaultPrevented).toBe(true);
    expect(valueResult.changed).toBe(false);
    expect(valueResult.value).toBe('austin');
    expect(valueResult.detail?.defaultPrevented).toBe(true);
    expect(openResult.changed).toBe(false);
    expect(openResult.open).toBe(true);
    expect(openResult.detail?.defaultPrevented).toBe(true);
  });

  it('selects an option by committing value and input text then closing suggestions', () => {
    const seen: string[] = [];
    const result = selectAutocompleteOption(
      { inputValue: 'chi', items: cityItems, open: true, value: 'austin' },
      'chicago',
      {
        onInputValueChange(detail) {
          seen.push(`input:${detail.reason}:${detail.value}`);
        },
        onOpenChange(detail) {
          seen.push(`open:${detail.reason}:${detail.value}`);
        },
        onValueChange(detail) {
          seen.push(`value:${detail.reason}:${detail.value}`);
        },
      },
    );

    expect(result.value).toMatchObject({ changed: true, value: 'chicago' });
    expect(result.inputValue).toMatchObject({ changed: true, inputValue: 'chicago' });
    expect(result.open).toMatchObject({ changed: true, open: false });
    expect(seen).toEqual([
      'value:option-select:chicago',
      'input:option-select:chicago',
      'open:option-select:false',
    ]);
  });

  it('uses shared typeahead helpers to find enabled options', () => {
    const first = autocompleteTypeahead({ items: cityItems, value: 'austin' }, 'b', {
      now: 100,
    });
    const second = autocompleteTypeahead({ items: cityItems, value: 'austin' }, 'c', {
      now: 900,
      state: first.state,
    });

    expect(first).toMatchObject({ matchIndex: -1, value: 'austin' });
    expect(second).toMatchObject({ matchIndex: 2, value: 'chicago' });
    expect(second.state.buffer).toBe('c');
  });

  it('moves highlighted suggestions with shared keyboard navigation while skipping disabled items', () => {
    expect(
      autocompleteMove({ inputValue: 'c', items: cityItems, value: 'austin' }, 'ArrowDown'),
    ).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'chicago',
    });
    expect(
      autocompleteMove(
        { highlightedValue: 'chicago', inputValue: '', items: cityItems },
        'ArrowDown',
      ),
    ).toEqual({
      highlightedIndex: 0,
      highlightedValue: 'austin',
    });
    expect(autocompleteMove({ inputValue: '', items: cityItems }, 'End')).toEqual({
      highlightedIndex: 1,
      highlightedValue: 'chicago',
    });
    expect(autocompleteMove({ disabled: true, items: cityItems }, 'ArrowDown')).toBeUndefined();
  });

  it('guards primitive handlers when author behavior prevented default', () => {
    const inputEvent = autocompleteInputEvent('chicago');
    inputEvent.preventDefault();
    const optionEvent = new Event('click', { cancelable: true });
    optionEvent.preventDefault();
    const keyEvent = autocompleteKeyEvent('Escape');
    keyEvent.preventDefault();

    expect(
      autocompleteInput(
        inputEvent,
        { inputValue: 'austin' },
        {
          onInputValueChange() {
            throw new Error('input should not dispatch after defaultPrevented');
          },
        },
      ),
    ).toBeUndefined();
    expect(
      autocompleteOptionClick(
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
      autocompleteKeyDown(
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
    const inputResult = autocompleteInput(
      autocompleteInputEvent('chicago'),
      { inputValue: 'austin' },
      {
        onInputValueChange(detail) {
          reasons.push(detail.reason);
        },
      },
    );

    expect(inputResult).toMatchObject({ changed: true, inputValue: 'chicago' });
    expect(reasons).toEqual(['input']);

    const disabledEvent = autocompleteInputEvent('chicago');
    const disabledResult = autocompleteInput(disabledEvent, {
      disabled: true,
      inputValue: 'austin',
    });
    expect(disabledResult).toEqual({ changed: false, inputValue: 'austin' });
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledEvent = new Event('click', { cancelable: true });
    const canceledResult = autocompleteOptionClick(
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

    const escapeEvent = autocompleteKeyEvent('Escape');
    expect(autocompleteKeyDown(escapeEvent, { open: true })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'escape-key', value: false }),
      open: false,
    });
    expect(escapeEvent.defaultPrevented).toBe(true);

    const arrowEvent = autocompleteKeyEvent('ArrowDown');
    expect(autocompleteKeyDown(arrowEvent, { open: false })).toEqual({
      changed: true,
      detail: expect.objectContaining({ reason: 'arrow-key', value: true }),
      open: true,
    });
    expect(arrowEvent.defaultPrevented).toBe(true);

    const moveEvent = autocompleteKeyEvent('ArrowDown');
    expect(
      autocompleteKeyDown(moveEvent, {
        highlightedValue: 'austin',
        inputValue: '',
        items: cityItems,
        open: true,
      }),
    ).toEqual({
      highlightedIndex: 1,
      highlightedValue: 'chicago',
    });
    expect(moveEvent.defaultPrevented).toBe(true);
  });

  it('returns frozen attribute records and exposes option helpers', () => {
    expect(Object.isFrozen(autocompleteRootAttributes())).toBe(true);
    expect(Object.isFrozen(autocompleteInputAttributes())).toBe(true);
    expect(Object.isFrozen(autocompleteOptionAttributes({ itemValue: 'austin' }))).toBe(true);
    expect(autocompleteOptionSelected({ itemValue: 'austin', value: 'austin' })).toBe(true);
    expect(autocompleteOptionHighlighted({ highlightedValue: 'austin', itemValue: 'austin' })).toBe(
      true,
    );
  });

  it('is exported through the package root and primitives barrel', () => {
    expect(exportedAutocompleteRootAttributes).toBe(autocompleteRootAttributes);
    expect(exportedAutocompleteInputAttributes).toBe(autocompleteInputAttributes);
    expect(exportedAutocompleteListAttributes).toBe(autocompleteListAttributes);
    expect(exportedAutocompleteMove).toBe(autocompleteMove);
    expect(exportedAutocompleteOptionAttributes).toBe(autocompleteOptionAttributes);
    expect(exportedAutocompleteValueAttributes).toBe(autocompleteValueAttributes);
    expect(exportedAutocompleteValueText).toBe(autocompleteValueText);
    expect(exportedAutocompleteSuggestions).toBe(autocompleteSuggestions);
    expect(exportedAutocompleteOptionSelected).toBe(autocompleteOptionSelected);
    expect(exportedAutocompleteOptionHighlighted).toBe(autocompleteOptionHighlighted);
    expect(exportedAutocompleteTypeahead).toBe(autocompleteTypeahead);
    expect(exportedSetAutocompleteInputValue).toBe(setAutocompleteInputValue);
    expect(exportedSetAutocompleteValue).toBe(setAutocompleteValue);
    expect(exportedSetAutocompleteOpen).toBe(setAutocompleteOpen);
    expect(exportedSelectAutocompleteOption).toBe(selectAutocompleteOption);
    expect(exportedAutocompleteInput).toBe(autocompleteInput);
    expect(exportedAutocompleteOptionClick).toBe(autocompleteOptionClick);
    expect(exportedAutocompleteKeyDown).toBe(autocompleteKeyDown);
    expect(primitiveAutocompleteRootAttributes).toBe(autocompleteRootAttributes);
  });
});

function autocompleteInputEvent(value: string): Event & {
  readonly currentTarget: EventTarget & { readonly value?: string };
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: EventTarget & { value?: string };
  };
  Object.defineProperty(event, 'currentTarget', { value: { value } });
  return event;
}

function autocompleteKeyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

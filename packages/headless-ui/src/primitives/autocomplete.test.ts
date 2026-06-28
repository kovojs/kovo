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
} from './autocomplete.js';
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
  { id: 'city-list-option-0', label: 'Austin', value: 'austin' },
  { disabled: true, id: 'city-list-option-1', label: 'Boston', value: 'boston' },
  { id: 'city-list-option-2', textValue: 'Chicago city', value: 'chicago' },
]);

describe('headless-ui autocomplete primitive', () => {
  it('builds root and input attributes around a native text input and listbox', () => {
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
        form: 'city-form',
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
      form: 'city-form',
      id: 'city',
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
      role: 'listbox',
    });
    expect(autocompleteListAttributes({ id: 'city-list' })).toEqual({
      'data-placeholder': '',
      'data-state': 'closed',
      hidden: true,
      id: 'city-list',
      role: 'listbox',
    });
    expect(
      autocompleteOptionAttributes({ ...state, id: 'city-option-0', itemValue: 'austin' }),
    ).toEqual({
      'aria-selected': 'true',
      'data-state': 'checked',
      id: 'city-option-0',
      role: 'option',
      value: 'austin',
    });
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'boston' })).toEqual({
      'aria-disabled': 'true',
      'aria-selected': 'false',
      'data-disabled': '',
      'data-state': 'unchecked',
      // J1: boston carries an explicit item id (cityItems), so the option emits it.
      id: 'city-list-option-1',
      role: 'option',
      value: 'boston',
    });
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'chicago' })).toEqual({
      'aria-selected': 'false',
      'data-highlighted': '',
      'data-state': 'unchecked',
      // J1: chicago carries an explicit item id (cityItems), so the option emits it.
      id: 'city-list-option-2',
      role: 'option',
      value: 'chicago',
    });
    expect(autocompleteValueAttributes({ ...state, id: 'city-value' })).toEqual({
      id: 'city-value',
    });
    expect(autocompleteValueAttributes({ placeholder: 'Choose city', value: '' })).toEqual({
      'data-placeholder': '',
    });
  });

  // J1 (SPEC.md §4.6): the synthesized aria-activedescendant must reference the
  // highlighted option's rendered id. Options render from the *filtered*
  // suggestions, so the fallback id must use the filtered index and the option
  // element must emit that same id — otherwise the IDREF dangles and the SR
  // announces nothing.
  it('points aria-activedescendant at the highlighted filtered option id (no explicit ids)', () => {
    const unidentifiedItems: readonly AutocompleteItem[] = [
      { label: 'Austin', value: 'austin' },
      { label: 'Chicago', value: 'chicago' },
      { label: 'Charlotte', value: 'charlotte' },
    ];
    const state = {
      highlightedValue: 'charlotte',
      inputValue: 'ch',
      items: unidentifiedItems,
      listId: 'city-list',
      open: true,
    };

    // Typing "ch" filters to [chicago, charlotte]; charlotte is filtered index 1.
    const input = autocompleteInputAttributes({ ...state, id: 'city' });
    expect(input['aria-activedescendant']).toBe('city-list-option-1');

    // The rendered option must carry the exact same id so the IDREF resolves.
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'charlotte' }).id).toBe(
      'city-list-option-1',
    );
  });

  // bugz-3 L17 + papercuts-6 B (SPEC.md §4.6): an unfiltered render must not
  // collide a filtered-out option with the matching option on `…-option-0`, and
  // sibling id-less autocompletes need caller-owned list prefixes.
  it('synthesizes collision-free autocomplete option ids from explicit list ids (L17)', () => {
    const cities: readonly AutocompleteItem[] = [
      { label: 'Austin', value: 'austin' },
      { label: 'Chicago', value: 'chicago' },
    ];
    // Typing 'chi' filters to [chicago]; austin is filtered out.
    const state = {
      highlightedValue: 'chicago',
      inputValue: 'chi',
      items: cities,
      listId: 'city-list-a',
      open: true,
    };
    expect(autocompleteSuggestions(state).map(({ value }) => value)).toEqual(['chicago']);

    const activeDescendant = autocompleteInputAttributes(state)['aria-activedescendant'];
    const chicagoId = autocompleteOptionAttributes({ ...state, itemValue: 'chicago' }).id;
    expect(chicagoId).toBe(activeDescendant);
    expect(autocompleteOptionAttributes({ ...state, itemValue: 'austin' }).id).toBeUndefined();

    // Two id-less autocompletes with the same option set do not collide when
    // they provide distinct list ids.
    const otherState = { ...state, listId: 'city-list-b' };
    const otherId = autocompleteOptionAttributes({ ...otherState, itemValue: 'chicago' }).id;
    expect(otherId).toBe('city-list-b-option-0');
    expect(otherId).not.toBe(chicagoId);

    expect(() =>
      autocompleteInputAttributes({
        highlightedValue: 'chicago',
        inputValue: 'chi',
        items: cities,
        open: true,
      }),
    ).toThrow(/requires listId/);
  });

  it('resolves display text and filters enabled suggestions by input value', () => {
    expect(autocompleteValueText({ items: cityItems, value: 'austin' })).toBe('Austin');
    expect(autocompleteValueText({ items: cityItems, value: 'chicago' })).toBe('Chicago city');
    expect(autocompleteValueText({ value: 'custom' })).toBe('custom');
    expect(autocompleteValueText({ placeholder: 'Choose city', value: '' })).toBe('Choose city');
    expect(autocompleteSuggestions({ inputValue: 'c', items: cityItems })).toEqual([
      { id: 'city-list-option-2', textValue: 'Chicago city', value: 'chicago' },
    ]);
    expect(autocompleteSuggestions({ inputValue: '', items: cityItems })).toEqual([
      { id: 'city-list-option-0', label: 'Austin', value: 'austin' },
      { id: 'city-list-option-2', textValue: 'Chicago city', value: 'chicago' },
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

  // UX B5: re-selecting the already-selected suggestion must still close the list.
  // Previously the unchanged value short-circuited and left the list open.
  it('closes suggestions when re-selecting the current option (value unchanged)', () => {
    const seen: string[] = [];
    const result = selectAutocompleteOption(
      { inputValue: 'austin', items: cityItems, open: true, value: 'austin' },
      'austin',
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

    expect(result.value).toMatchObject({ changed: false, value: 'austin' });
    expect(result.inputValue).toMatchObject({ changed: false, inputValue: 'austin' });
    expect(result.open).toMatchObject({ changed: true, open: false });
    // Value and input text are identical, so only the close is dispatched.
    expect(seen).toEqual(['open:option-select:false']);
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

    const delegatedInputEvent = autocompleteInputEvent('target tag', 'current target tag');
    const delegatedInputResult = autocompleteInput(delegatedInputEvent, {
      inputValue: 'design',
    });
    expect(delegatedInputResult).toMatchObject({
      changed: true,
      detail: expect.objectContaining({ reason: 'input', value: 'target tag' }),
      inputValue: 'target tag',
    });

    const disabledEvent = autocompleteInputEvent('chicago');
    const disabledResult = autocompleteInput(disabledEvent, {
      disabled: true,
      inputValue: 'austin',
    });
    expect(disabledResult).toEqual({ changed: false, inputValue: 'austin' });
    expect(disabledEvent.currentTarget.value).toBe('austin');
    expect(disabledEvent.defaultPrevented).toBe(true);

    const canceledInputEvent = autocompleteInputEvent('denver');
    const canceledInputResult = autocompleteInput(
      canceledInputEvent,
      { inputValue: 'austin' },
      {
        onInputValueChange(detail) {
          detail.preventDefault();
        },
      },
    );
    expect(canceledInputResult).toMatchObject({
      changed: false,
      detail: expect.objectContaining({ defaultPrevented: true }),
      inputValue: 'austin',
    });
    expect(canceledInputEvent.currentTarget.value).toBe('austin');
    expect(canceledInputEvent.defaultPrevented).toBe(true);

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

    const enterEvent = autocompleteKeyEvent('Enter');
    expect(
      autocompleteKeyDown(
        enterEvent,
        {
          highlightedValue: 'chicago',
          inputValue: 'chi',
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
      inputValue: { changed: true, inputValue: 'chicago' },
      open: { changed: true, open: false },
      value: { changed: true, value: 'chicago' },
    });
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(reasons).toContain('option-select:chicago');
  });

  it('restores selected value and input when option-select follow-up changes are canceled', () => {
    const inputCanceled = selectAutocompleteOption(
      { highlightedValue: 'chicago', inputValue: 'chi', open: true, value: 'austin' },
      'chicago',
      {
        onInputValueChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(inputCanceled).toMatchObject({
      inputValue: {
        changed: false,
        detail: expect.objectContaining({ defaultPrevented: true }),
        inputValue: 'chi',
      },
      open: { changed: false, open: true },
      value: { changed: false, value: 'austin' },
    });

    const closeCanceled = selectAutocompleteOption(
      { highlightedValue: 'chicago', inputValue: 'chi', open: true, value: 'austin' },
      'chicago',
      {
        onOpenChange(detail) {
          detail.preventDefault();
        },
      },
    );

    expect(closeCanceled).toMatchObject({
      inputValue: { changed: false, inputValue: 'chi' },
      open: {
        changed: false,
        detail: expect.objectContaining({ defaultPrevented: true }),
        open: true,
      },
      value: { changed: false, value: 'austin' },
    });

    const event = autocompleteKeyEvent('Enter');
    const keyResult = autocompleteKeyDown(
      event,
      {
        highlightedValue: 'chicago',
        inputValue: 'chi',
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
      inputValue: { changed: false, inputValue: 'chi' },
      open: { changed: false, open: true },
      value: { changed: false, value: 'austin' },
    });
    // Enter on an open list with a highlighted option ALWAYS consumes the key —
    // even when a consumer cancels the follow-up change — so it never falls through
    // to the host form's implicit submit (which reloads the page and loses the
    // selection). See autocompleteKeyDown.
    expect(event.defaultPrevented).toBe(true);
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

function autocompleteInputEvent(
  value: string,
  currentTargetValue?: string,
): Event & {
  readonly currentTarget: EventTarget & { value?: string };
  readonly target: EventTarget & { value?: string };
} {
  const event = new Event('input', { cancelable: true }) as Event & {
    currentTarget: EventTarget & { value?: string };
    target: EventTarget & { value?: string };
  };
  const target = { value };
  Object.defineProperty(event, 'currentTarget', {
    value: currentTargetValue === undefined ? target : { value: currentTargetValue },
  });
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

function autocompleteKeyEvent(key: string): Event & { readonly key: string } {
  const event = new Event('keydown', { cancelable: true }) as Event & { key: string };
  Object.defineProperty(event, 'key', { value: key });
  return event;
}

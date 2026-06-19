/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  autocompleteInput as _autocompleteInput,
  autocompleteKeyDown as _autocompleteKeyDown,
  autocompleteOptionClick as _autocompleteOptionClick,
  autocompleteSuggestions as _autocompleteSuggestions,
  type AutocompleteItem,
} from '@kovojs/headless-ui/autocomplete';
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
} from '@kovojs/ui/autocomplete';

export interface GalleryAutocompleteDemoState {
  highlightedValue: string;
  inputValue: string;
  open: boolean;
  value: string;
}

const tagOptions: readonly AutocompleteItem[] = Object.freeze([
  { id: 'gallery-autocomplete-list-option-0', label: 'Design', value: 'design' },
  {
    disabled: true,
    id: 'gallery-autocomplete-list-option-1',
    label: 'Deprecated',
    value: 'deprecated',
  },
  {
    id: 'gallery-autocomplete-list-option-2',
    textValue: 'Development',
    value: 'development',
  },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryAutocompleteDemo = component({
  state: () => ({ highlightedValue: 'design', inputValue: 'de', open: false, value: 'design' }),
  render: (_queries: Record<string, never>, state: GalleryAutocompleteDemoState) => {
    const listId = 'gallery-autocomplete-list';
    const autocompleteState = {
      form: 'gallery-autocomplete-form',
      highlightedValue: state.highlightedValue,
      inputValue: state.inputValue,
      items: tagOptions,
      listId,
      name: 'gallery-tag',
      open: state.open,
      placeholder: 'Choose tag',
      required: true,
      value: state.value,
    };

    return (
      <Autocomplete
        {...autocompleteState}
        data-gallery-interactive="autocomplete"
        data-state={state.open ? 'open' : 'closed'}
        id="gallery-autocomplete-root"
      >
        <label
          id="gallery-autocomplete-label"
          for="gallery-autocomplete-input"
          style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717"
        >
          Tag
        </label>
        <form id="gallery-autocomplete-form" data-gallery-form="autocomplete" />
        <AutocompleteInput
          {...autocompleteState}
          aria-activedescendant={
            state.highlightedValue === 'development'
              ? 'gallery-autocomplete-list-option-2'
              : state.highlightedValue === 'deprecated'
                ? 'gallery-autocomplete-list-option-1'
                : state.highlightedValue === 'design'
                  ? 'gallery-autocomplete-list-option-0'
                  : null
          }
          aria-expanded={state.open ? 'true' : 'false'}
          data-placeholder={state.inputValue === '' ? '' : null}
          data-state={state.open ? 'open' : 'closed'}
          id="gallery-autocomplete-input"
          labelledBy="gallery-autocomplete-label"
          onInput={() => {
            const result = _autocompleteInput(Object(event), {
              inputValue: state.inputValue,
              value: state.value,
            });
            if (!result) return;
            state.inputValue = result.inputValue;
            state.open = true;
            state.highlightedValue =
              _autocompleteSuggestions({
                inputValue: state.inputValue,
                items: [
                  {
                    id: 'gallery-autocomplete-list-option-0',
                    label: 'Design',
                    value: 'design',
                  },
                  {
                    disabled: true,
                    id: 'gallery-autocomplete-list-option-1',
                    label: 'Deprecated',
                    value: 'deprecated',
                  },
                  {
                    id: 'gallery-autocomplete-list-option-2',
                    textValue: 'Development',
                    value: 'development',
                  },
                ],
              })[0]?.value ?? '';
          }}
          onKeyDown={() => {
            const result = _autocompleteKeyDown(Object(event), {
              highlightedValue: state.highlightedValue,
              inputValue: state.inputValue,
              items: [
                {
                  id: 'gallery-autocomplete-list-option-0',
                  label: 'Design',
                  value: 'design',
                },
                {
                  disabled: true,
                  id: 'gallery-autocomplete-list-option-1',
                  label: 'Deprecated',
                  value: 'deprecated',
                },
                {
                  id: 'gallery-autocomplete-list-option-2',
                  textValue: 'Development',
                  value: 'development',
                },
              ],
              open: state.open,
              value: state.value,
            });
            if (!result) return;

            if ('value' in result) {
              if (result.value.changed) {
                state.inputValue = result.inputValue.inputValue;
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.highlightedValue = state.value;
              }
            } else if ('highlightedValue' in result) {
              state.highlightedValue = result.highlightedValue ?? '';
            } else {
              state.open = result.open;
              if (Object(event)['key'] === 'Escape') {
                state.inputValue = state.value;
                state.highlightedValue = state.value;
              }
            }
          }}
          value={state.inputValue}
        />
        <AutocompleteList
          {...autocompleteState}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
          id={listId}
          labelledBy="gallery-autocomplete-label"
        >
          <AutocompleteOption
            {...autocompleteState}
            aria-selected={state.value === 'design' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'design' ? '' : null}
            data-state={state.value === 'design' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            id="gallery-autocomplete-list-option-0"
            itemLabel="Design"
            itemValue="design"
            onClick={() => {
              const result = _autocompleteOptionClick(Object(event), {
                highlightedValue: state.highlightedValue,
                inputValue: state.inputValue,
                items: [
                  {
                    id: 'gallery-autocomplete-list-option-0',
                    label: 'Design',
                    value: 'design',
                  },
                  {
                    disabled: true,
                    id: 'gallery-autocomplete-list-option-1',
                    label: 'Deprecated',
                    value: 'deprecated',
                  },
                  {
                    id: 'gallery-autocomplete-list-option-2',
                    textValue: 'Development',
                    value: 'development',
                  },
                ],
                itemValue: 'design',
                open: state.open,
                value: state.value,
              });
              if (!result) return;
              if (result.value.changed) {
                state.inputValue = result.inputValue.inputValue;
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.highlightedValue = state.value;
              }
            }}
            tabIndex={state.highlightedValue === 'design' ? 0 : -1}
          >
            Design
          </AutocompleteOption>
          <AutocompleteOption
            {...autocompleteState}
            aria-selected={state.value === 'development' ? 'true' : 'false'}
            data-highlighted={state.highlightedValue === 'development' ? '' : null}
            data-state={state.value === 'development' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' &&
              !'development'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            id="gallery-autocomplete-list-option-2"
            itemValue="development"
            onClick={() => {
              const result = _autocompleteOptionClick(Object(event), {
                highlightedValue: state.highlightedValue,
                inputValue: state.inputValue,
                items: [
                  {
                    id: 'gallery-autocomplete-list-option-0',
                    label: 'Design',
                    value: 'design',
                  },
                  {
                    disabled: true,
                    id: 'gallery-autocomplete-list-option-1',
                    label: 'Deprecated',
                    value: 'deprecated',
                  },
                  {
                    id: 'gallery-autocomplete-list-option-2',
                    textValue: 'Development',
                    value: 'development',
                  },
                ],
                itemValue: 'development',
                open: state.open,
                value: state.value,
              });
              if (!result) return;
              if (result.value.changed) {
                state.inputValue = result.inputValue.inputValue;
                state.open = result.open.open;
                state.value = result.value.value ?? state.value;
                state.highlightedValue = state.value;
              }
            }}
            tabIndex={state.highlightedValue === 'development' ? 0 : -1}
          >
            Development
          </AutocompleteOption>
        </AutocompleteList>
        <AutocompleteValue {...autocompleteState} data-demo-state="autocomplete-value" />
      </Autocomplete>
    );
  },
});

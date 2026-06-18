/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  autocompleteInput as _autocompleteInput,
  autocompleteInputAttributes,
  autocompleteKeyDown as _autocompleteKeyDown,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteOptionClick as _autocompleteOptionClick,
  autocompleteRootAttributes,
  autocompleteSuggestions as _autocompleteSuggestions,
  autocompleteValueAttributes,
  type AutocompleteItem,
} from '@kovojs/headless-ui/autocomplete';
import {
  autocompleteClasses,
  autocompleteInputClasses,
  autocompleteListClasses,
  autocompleteOptionClasses,
  autocompleteValueClasses,
} from '@kovojs/ui/autocomplete';

const ROOT_CLASS = autocompleteClasses.join(' ');
const INPUT_CLASS = autocompleteInputClasses.join(' ');
const LIST_CLASS = autocompleteListClasses.join(' ');
const OPTION_CLASS = autocompleteOptionClasses.join(' ');
const VALUE_CLASS = autocompleteValueClasses.join(' ');
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

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
      <section
        {...autocompleteRootAttributes({
          ...autocompleteState,
          id: 'gallery-autocomplete-root',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="autocomplete"
        data-state={state.open ? 'open' : 'closed'}
      >
        <label id="gallery-autocomplete-label" for="gallery-autocomplete-input" class={LABEL_CLASS}>
          Tag
        </label>
        <form id="gallery-autocomplete-form" data-gallery-form="autocomplete" />
        <input
          {...autocompleteInputAttributes({
            ...autocompleteState,
            id: 'gallery-autocomplete-input',
            labelledBy: 'gallery-autocomplete-label',
          })}
          id="gallery-autocomplete-input"
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
          class={INPUT_CLASS}
          data-placeholder={state.inputValue === '' ? '' : null}
          data-state={state.open ? 'open' : 'closed'}
          value={state.inputValue}
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
        />
        <div
          {...autocompleteListAttributes({
            ...autocompleteState,
            id: listId,
            labelledBy: 'gallery-autocomplete-label',
          })}
          class={LIST_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          hidden={!state.open}
        >
          <button
            {...autocompleteOptionAttributes({
              ...autocompleteState,
              id: 'gallery-autocomplete-list-option-0',
              itemLabel: 'Design',
              itemValue: 'design',
            })}
            aria-selected={state.value === 'design' ? 'true' : 'false'}
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'design' ? '' : null}
            data-state={state.value === 'design' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase())
            }
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
          </button>
          <button
            {...autocompleteOptionAttributes({
              ...autocompleteState,
              id: 'gallery-autocomplete-list-option-2',
              itemValue: 'development',
            })}
            aria-selected={state.value === 'development' ? 'true' : 'false'}
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'development' ? '' : null}
            data-state={state.value === 'development' ? 'checked' : 'unchecked'}
            hidden={
              state.inputValue !== '' &&
              !'development'.startsWith(state.inputValue.toLocaleLowerCase())
            }
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
          </button>
        </div>
        <output
          {...autocompleteValueAttributes(autocompleteState)}
          class={VALUE_CLASS}
          data-demo-state="autocomplete-value"
        >
          {state.value === 'development' ? 'Development' : 'Design'}
        </output>
      </section>
    );
  },
});

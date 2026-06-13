/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  autocompleteInputAttributes,
  autocompleteListAttributes,
  autocompleteOptionAttributes,
  autocompleteRootAttributes,
  autocompleteValueAttributes,
  autocompleteValueText,
  type AutocompleteItem,
} from '@jiso/headless-ui/primitives';

export interface GalleryAutocompleteDemoState {
  highlightedValue: string;
  inputValue: string;
  open: boolean;
  value: string;
}

const tagOptions: readonly AutocompleteItem[] = Object.freeze([
  { label: 'Design', value: 'design' },
  { disabled: true, label: 'Deprecated', value: 'deprecated' },
  { textValue: 'Development', value: 'development' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryAutocompleteDemo = component('gallery-autocomplete-demo', {
  state: () => ({ highlightedValue: 'design', inputValue: 'de', open: false, value: 'design' }),
  render: (_queries: Record<string, never>, state: GalleryAutocompleteDemoState) => {
    const listId = 'gallery-autocomplete-list';
    const autocompleteState = {
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
        class="grid gap-2"
        data-gallery-interactive="autocomplete"
      >
        <label id="gallery-autocomplete-label" for="gallery-autocomplete-input">
          Tag
        </label>
        <input
          {...autocompleteInputAttributes({
            ...autocompleteState,
            id: 'gallery-autocomplete-input',
            labelledBy: 'gallery-autocomplete-label',
          })}
          id="gallery-autocomplete-input"
          onInput={() => {
            state.inputValue = 'dev';
            state.highlightedValue = 'development';
            state.open = true;
            const doc = Reflect['get'](globalThis, 'document');
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
              : undefined;
            const development = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-list-option-0')
              : undefined;

            if (input) {
              input['value'] = 'dev';
              Object(input)['setAttribute']?.call(input, 'aria-expanded', 'true');
              Object(input)['setAttribute']?.call(
                input,
                'aria-activedescendant',
                'gallery-autocomplete-list-option-0',
              );
            }
            if (development) {
              development['value'] = 'development';
              Object(development)['setAttribute']?.call(development, 'data-highlighted', '');
            }
          }}
          onKeyDown={() => {
            const delegatedEvent = event;
            const eventKey =
              delegatedEvent === undefined ? undefined : Reflect['get'](delegatedEvent, 'key');
            const doc = Reflect['get'](globalThis, 'document');
            const input = doc
              ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
              : undefined;
            const output = doc
              ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="autocomplete-value"]')
              : undefined;

            if (eventKey === 'Enter' && state.open && state.highlightedValue === 'development') {
              state.inputValue = 'development';
              state.open = false;
              state.value = 'development';
              if (input) {
                input['value'] = 'development';
                Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
              }
              if (output) output['textContent'] = 'Development';
            } else {
              state.open = !state.open;
            }
          }}
        />
        <datalist
          {...autocompleteListAttributes({
            ...autocompleteState,
            id: listId,
            labelledBy: 'gallery-autocomplete-label',
          })}
        >
          <option
            {...autocompleteOptionAttributes({
              ...autocompleteState,
              id: 'gallery-autocomplete-list-option-0',
              itemValue: 'development',
            })}
            onClick={() => {
              state.inputValue = 'development';
              state.open = false;
              state.highlightedValue = 'development';
              state.value = 'development';
              const doc = Reflect['get'](globalThis, 'document');
              const input = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-autocomplete-input')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="autocomplete-value"]')
                : undefined;

              if (input) {
                input['value'] = 'development';
                Object(input)['setAttribute']?.call(input, 'aria-expanded', 'false');
              }
              if (output) output['textContent'] = 'Development';
            }}
          >
            Development
          </option>
        </datalist>
        <output
          {...autocompleteValueAttributes(autocompleteState)}
          data-demo-state="autocomplete-value"
        >
          {autocompleteValueText(autocompleteState)}
        </output>
      </section>
    );
  },
});

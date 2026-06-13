// @jiso-ir - lowered from examples/gallery/src/interactive/autocomplete-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
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
        class="grid gap-2"
        data-gallery-interactive="autocomplete"
        fw-c="gallery-autocomplete-demo"
        fw-state='{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}'
      >
        <label id="gallery-autocomplete-label" for="gallery-autocomplete-input">
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
          on:input="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=5c683f1f#GalleryAutocompleteDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=5c683f1f#GalleryAutocompleteDemo$input_keydown"
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
            on:click="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=5c683f1f#GalleryAutocompleteDemo$option_click"
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

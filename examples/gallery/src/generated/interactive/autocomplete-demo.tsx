// @jiso-ir - lowered from examples/gallery/src/interactive/autocomplete-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { derive } from '@jiso/runtime';

export const GalleryAutocompleteDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAutocompleteDemo$input_aria_activedescendant_derive = derive(
  ['state'],
  (state: any) =>
    state.highlightedValue === 'development'
      ? 'gallery-autocomplete-list-option-2'
      : state.highlightedValue === 'deprecated'
        ? 'gallery-autocomplete-list-option-1'
        : state.highlightedValue === 'design'
          ? 'gallery-autocomplete-list-option-0'
          : null,
);
export const GalleryAutocompleteDemo$input_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryAutocompleteDemo$input_data_placeholder_derive = derive(
  ['state'],
  (state: any) => (state.inputValue === '' ? '' : null),
);
export const GalleryAutocompleteDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAutocompleteDemo$input_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryAutocompleteDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryAutocompleteDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryAutocompleteDemo$button_aria_selected_derive = derive(['state'], (state: any) =>
  state.value === 'design' ? 'true' : 'false',
);
export const GalleryAutocompleteDemo$button_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'design' ? '' : null),
);
export const GalleryAutocompleteDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'design' ? 'checked' : 'unchecked',
);
export const GalleryAutocompleteDemo$button_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase()) ? '' : null,
);
export const GalleryAutocompleteDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'design' ? 0 : -1,
);
export const GalleryAutocompleteDemo$button_aria_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'development' ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$button_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'development' ? '' : null),
);
export const GalleryAutocompleteDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'development' ? 'checked' : 'unchecked',
);
export const GalleryAutocompleteDemo$button_hidden_derive_2 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'development'.startsWith(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryAutocompleteDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'development' ? 0 : -1,
);
export const GalleryAutocompleteDemo$output_text_derive = derive(['state'], (state: any) =>
  state.value === 'development' ? 'Development' : 'Design',
);

import { component } from '@jiso/core';
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
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/autocomplete.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const LIST_CLASS =
  'max-h-56 overflow-auto rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-sm data-[state=closed]:hidden';
const OPTION_CLASS =
  'w-full rounded px-2 py-1.5 text-left text-neutral-700 data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-950 data-[state=checked]:font-medium data-[state=checked]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
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
        class={ROOT_CLASS}
        data-gallery-interactive="autocomplete"
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$section_data_state_derive"
        fw-c="gallery-autocomplete-demo"
        fw-state='{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}'
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
          data-bind:aria-activedescendant="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_aria_activedescendant_derive"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_aria_expanded_derive"
          class={INPUT_CLASS}
          data-placeholder={state.inputValue === '' ? '' : null}
          data-bind:data-placeholder="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_data_placeholder_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_data_state_derive"
          value={state.inputValue}
          data-bind:value="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_value_derive"
          on:input="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$input_keydown"
        />
        <div
          {...autocompleteListAttributes({
            ...autocompleteState,
            id: listId,
            labelledBy: 'gallery-autocomplete-label',
          })}
          class={LIST_CLASS}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$div_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$div_hidden_derive"
        >
          <button
            {...autocompleteOptionAttributes({
              ...autocompleteState,
              id: 'gallery-autocomplete-list-option-0',
              itemLabel: 'Design',
              itemValue: 'design',
            })}
            aria-selected={state.value === 'design' ? 'true' : 'false'}
            data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_aria_selected_derive"
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'design' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_data_highlighted_derive"
            data-state={state.value === 'design' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_data_state_derive"
            hidden={
              state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_hidden_derive"
            on:click="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_click"
            tabIndex={state.highlightedValue === 'design' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_tabIndex_derive"
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
            data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_aria_selected_derive_2"
            class={OPTION_CLASS}
            data-highlighted={state.highlightedValue === 'development' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_data_highlighted_derive_2"
            data-state={state.value === 'development' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_data_state_derive_2"
            hidden={
              state.inputValue !== '' &&
              !'development'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_hidden_derive_2"
            on:click="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_click_2"
            tabIndex={state.highlightedValue === 'development' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$button_tabIndex_derive_2"
          >
            Development
          </button>
        </div>
        <output
          {...autocompleteValueAttributes(autocompleteState)}
          class={VALUE_CLASS}
          data-demo-state="autocomplete-value"
          data-bind="/c/examples/gallery/src/generated/interactive/autocomplete-demo.client.js?v=06e445db#GalleryAutocompleteDemo$output_text_derive"
        >
          {state.value === 'development' ? 'Development' : 'Design'}
        </output>
      </section>
    );
  },
});

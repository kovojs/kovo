// @kovojs-ir - lowered from examples/gallery/src/interactive/autocomplete-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryAutocompleteDemo$Autocomplete_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAutocompleteDemo$AutocompleteInput_aria_activedescendant_derive = derive(
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
export const GalleryAutocompleteDemo$AutocompleteInput_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteInput_data_placeholder_derive = derive(
  ['state'],
  (state: any) => (state.inputValue === '' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteInput_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAutocompleteDemo$AutocompleteInput_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryAutocompleteDemo$AutocompleteList_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryAutocompleteDemo$AutocompleteList_hidden_derive = derive(
  ['state'],
  (state: any) => (!state.open ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive = derive(
  ['state'],
  (state: any) => (state.value === 'design' ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'design' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'design' ? 'checked' : 'unchecked'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_hidden_derive = derive(
  ['state'],
  (state: any) =>
    state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase())
      ? ''
      : null,
);
export const GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'design' ? 0 : -1),
);
export const GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'development' ? 'true' : 'false'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'development' ? '' : null),
);
export const GalleryAutocompleteDemo$AutocompleteOption_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'development' ? 'checked' : 'unchecked'),
);
export const GalleryAutocompleteDemo$AutocompleteOption_hidden_derive_2 = derive(
  ['state'],
  (state: any) =>
    state.inputValue !== '' && !'development'.startsWith(state.inputValue.toLocaleLowerCase())
      ? ''
      : null,
);
export const GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'development' ? 0 : -1),
);

import { component } from '@kovojs/core';
import { type AutocompleteItem } from '@kovojs/headless-ui/autocomplete';
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
        data-gallery-interactive="autocomplete"
        id="gallery-autocomplete-root"
        {...autocompleteState}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$Autocomplete_data_state_derive"
        kovo-state='{"highlightedValue":"design","inputValue":"de","open":false,"value":"design"}'
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
          id="gallery-autocomplete-input"
          labelledBy="gallery-autocomplete-label"
          on:input="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_input"
          on:keydown="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_keydown"
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
          data-bind:aria-activedescendant="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_aria_activedescendant_derive"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_aria_expanded_derive"
          data-placeholder={state.inputValue === '' ? '' : null}
          data-bind:data-placeholder="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_data_placeholder_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_data_state_derive"
          value={state.inputValue}
          data-bind:value="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteInput_value_derive"
        />
        <AutocompleteList
          id={listId}
          labelledBy="gallery-autocomplete-label"
          {...autocompleteState}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteList_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteList_hidden_derive"
        >
          <AutocompleteOption
            id="gallery-autocomplete-list-option-0"
            itemLabel="Design"
            itemValue="design"
            on:click="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_click"
            {...autocompleteState}
            aria-selected={state.value === 'design' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive"
            data-highlighted={state.highlightedValue === 'design' ? '' : null}
            data-bind:data-highlighted="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive"
            data-state={state.value === 'design' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_data_state_derive"
            hidden={
              state.inputValue !== '' && !'design'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_hidden_derive"
            tabIndex={state.highlightedValue === 'design' ? 0 : -1}
            data-bind:tabIndex="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive"
          >
            Design
          </AutocompleteOption>
          <AutocompleteOption
            id="gallery-autocomplete-list-option-2"
            itemValue="development"
            on:click="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_click_2"
            {...autocompleteState}
            aria-selected={state.value === 'development' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_aria_selected_derive_2"
            data-highlighted={state.highlightedValue === 'development' ? '' : null}
            data-bind:data-highlighted="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_data_highlighted_derive_2"
            data-state={state.value === 'development' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_data_state_derive_2"
            hidden={
              state.inputValue !== '' &&
              !'development'.startsWith(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_hidden_derive_2"
            tabIndex={state.highlightedValue === 'development' ? 0 : -1}
            data-bind:tabIndex="/c/__v/89c67af8/examples/gallery/src/generated/interactive/autocomplete-demo.client.js#GalleryAutocompleteDemo$AutocompleteOption_tabIndex_derive_2"
          >
            Development
          </AutocompleteOption>
        </AutocompleteList>
        <AutocompleteValue data-demo-state="autocomplete-value" {...autocompleteState} />
      </Autocomplete>
    );
  },
});
GalleryAutocompleteDemo.name = 'generated/interactive/autocomplete-demo/gallery-autocomplete-demo';

// @kovojs-ir - lowered from examples/gallery/src/interactive/combobox-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryComboboxDemo$Combobox_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$ComboboxInput_aria_activedescendant_derive = derive(
  ['state'],
  (state: any) =>
    state.highlightedValue === 'chicago'
      ? 'gallery-combobox-listbox-option-2'
      : state.highlightedValue === 'boston'
        ? 'gallery-combobox-listbox-option-1'
        : state.highlightedValue === 'austin'
          ? 'gallery-combobox-listbox-option-0'
          : null,
);
export const GalleryComboboxDemo$ComboboxInput_aria_expanded_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxInput_data_placeholder_derive = derive(
  ['state'],
  (state: any) => (state.inputValue === '' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxInput_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$ComboboxInput_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryComboboxDemo$ComboboxListbox_data_state_derive = derive(
  ['state'],
  (state: any) => (state.open ? 'open' : 'closed'),
);
export const GalleryComboboxDemo$ComboboxListbox_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive = derive(
  ['state'],
  (state: any) => (state.value === 'austin' ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'austin' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'austin' ? 'checked' : 'unchecked'),
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'austin' ? 0 : -1,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'boston' ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'boston' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'boston' ? 'checked' : 'unchecked'),
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive_2 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_aria_selected_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'chicago' ? 'true' : 'false'),
);
export const GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_3 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'chicago' ? '' : null),
);
export const GalleryComboboxDemo$ComboboxOption_data_state_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'chicago' ? 'checked' : 'unchecked'),
);
export const GalleryComboboxDemo$ComboboxOption_hidden_derive_3 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$ComboboxOption_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'chicago' ? 0 : -1),
);

import { component } from '@kovojs/core';
import {
  Combobox,
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
  type ComboboxItem,
} from '@kovojs/ui/combobox';

export interface GalleryComboboxDemoState {
  highlightedValue: string;
  inputValue: string;
  open: boolean;
  value: string;
}

const cityOptions: readonly ComboboxItem[] = Object.freeze([
  { id: 'gallery-combobox-listbox-option-0', label: 'Austin', value: 'austin' },
  { disabled: true, id: 'gallery-combobox-listbox-option-1', label: 'Boston', value: 'boston' },
  { id: 'gallery-combobox-listbox-option-2', textValue: 'Chicago city', value: 'chicago' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryComboboxDemo = component({
  state: () => ({ highlightedValue: 'austin', inputValue: 'austin', open: false, value: 'austin' }),
  render: (_queries: Record<string, never>, state: GalleryComboboxDemoState) => {
    const listboxId = 'gallery-combobox-listbox';
    const inputState = {
      form: 'gallery-combobox-form',
      highlightedValue: state.highlightedValue,
      items: cityOptions,
      listboxId,
      name: 'gallery-city',
      open: state.open,
      placeholder: 'Choose city',
      required: true,
      value: state.inputValue,
    };
    const selectedState = {
      ...inputState,
      value: state.value,
    };

    return (
      <Combobox
        data-gallery-interactive="combobox"
        id="gallery-combobox-root"
        {...inputState}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$Combobox_data_state_derive"
        kovo-state='{"highlightedValue":"austin","inputValue":"austin","open":false,"value":"austin"}'
      >
        <label
          id="gallery-combobox-label"
          for="gallery-combobox-input"
          style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717"
        >
          City
        </label>
        <form id="gallery-combobox-form" data-gallery-form="combobox" />
        <ComboboxInput
          id="gallery-combobox-input"
          labelledBy="gallery-combobox-label"
          on:input="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_input"
          on:keydown="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_keydown"
          {...inputState}
          aria-activedescendant={
            state.highlightedValue === 'chicago'
              ? 'gallery-combobox-listbox-option-2'
              : state.highlightedValue === 'boston'
                ? 'gallery-combobox-listbox-option-1'
                : state.highlightedValue === 'austin'
                  ? 'gallery-combobox-listbox-option-0'
                  : null
          }
          data-bind:aria-activedescendant="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_aria_activedescendant_derive"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_aria_expanded_derive"
          data-placeholder={state.inputValue === '' ? '' : null}
          data-bind:data-placeholder="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_data_placeholder_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_data_state_derive"
          value={state.inputValue}
          data-bind:value="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxInput_value_derive"
        />
        <ComboboxListbox
          id={listboxId}
          labelledBy="gallery-combobox-label"
          {...inputState}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxListbox_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxListbox_hidden_derive"
        >
          <ComboboxOption
            id="gallery-combobox-listbox-option-0"
            itemLabel="Austin"
            itemValue="austin"
            on:click="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_click"
            {...selectedState}
            aria-selected={state.value === 'austin' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_aria_selected_derive"
            data-highlighted={state.highlightedValue === 'austin' ? '' : null}
            data-bind:data-highlighted="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_highlighted_derive"
            data-state={state.value === 'austin' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_state_derive"
            hidden={
              state.inputValue !== '' &&
              !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_hidden_derive"
            tabIndex={state.highlightedValue === 'austin' ? 0 : -1}
            data-bind:tabIndex="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_tabIndex_derive"
          >
            Austin
          </ComboboxOption>
          <ComboboxOption
            id="gallery-combobox-listbox-option-1"
            itemDisabled={true}
            itemLabel="Boston"
            itemValue="boston"
            tabIndex={-1}
            {...selectedState}
            aria-selected={state.value === 'boston' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_aria_selected_derive_2"
            data-highlighted={state.highlightedValue === 'boston' ? '' : null}
            data-bind:data-highlighted="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_2"
            data-state={state.value === 'boston' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_state_derive_2"
            hidden={
              state.inputValue !== '' &&
              !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_hidden_derive_2"
          >
            Boston
          </ComboboxOption>
          <ComboboxOption
            id="gallery-combobox-listbox-option-2"
            itemValue="chicago"
            on:click="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_click_2"
            {...selectedState}
            aria-selected={state.value === 'chicago' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_aria_selected_derive_3"
            data-highlighted={state.highlightedValue === 'chicago' ? '' : null}
            data-bind:data-highlighted="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_highlighted_derive_3"
            data-state={state.value === 'chicago' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_data_state_derive_3"
            hidden={
              state.inputValue !== '' &&
              !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_hidden_derive_3"
            tabIndex={state.highlightedValue === 'chicago' ? 0 : -1}
            data-bind:tabIndex="/c/__v/e6767835/examples/gallery/src/generated/interactive/combobox-demo.client.js#GalleryComboboxDemo$ComboboxOption_tabIndex_derive_2"
          >
            Chicago city
          </ComboboxOption>
        </ComboboxListbox>
        <ComboboxValue data-demo-state="combobox-value" {...selectedState} />
      </Combobox>
    );
  },
});
GalleryComboboxDemo.name = 'generated/interactive/combobox-demo/gallery-combobox-demo';

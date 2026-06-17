// @kovojs-ir - lowered from examples/gallery/src/interactive/combobox-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryComboboxDemo$section_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$input_aria_activedescendant_derive = derive(
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
export const GalleryComboboxDemo$input_aria_expanded_derive = derive(['state'], (state: any) =>
  state.open ? 'true' : 'false',
);
export const GalleryComboboxDemo$input_data_placeholder_derive = derive(['state'], (state: any) =>
  state.inputValue === '' ? '' : null,
);
export const GalleryComboboxDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$input_value_derive = derive(
  ['state'],
  (state: any) => state.inputValue,
);
export const GalleryComboboxDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GalleryComboboxDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GalleryComboboxDemo$button_aria_selected_derive = derive(['state'], (state: any) =>
  state.value === 'austin' ? 'true' : 'false',
);
export const GalleryComboboxDemo$button_data_highlighted_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'austin' ? '' : null,
);
export const GalleryComboboxDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'austin' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$button_hidden_derive = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$button_tabIndex_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'austin' ? 0 : -1,
);
export const GalleryComboboxDemo$button_aria_selected_derive_2 = derive(['state'], (state: any) =>
  state.value === 'boston' ? 'true' : 'false',
);
export const GalleryComboboxDemo$button_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'boston' ? '' : null),
);
export const GalleryComboboxDemo$button_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'boston' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$button_hidden_derive_2 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$button_aria_selected_derive_3 = derive(['state'], (state: any) =>
  state.value === 'chicago' ? 'true' : 'false',
);
export const GalleryComboboxDemo$button_data_highlighted_derive_3 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'chicago' ? '' : null),
);
export const GalleryComboboxDemo$button_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'chicago' ? 'checked' : 'unchecked',
);
export const GalleryComboboxDemo$button_hidden_derive_3 = derive(['state'], (state: any) =>
  state.inputValue !== '' && !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
    ? ''
    : null,
);
export const GalleryComboboxDemo$button_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'chicago' ? 0 : -1,
);
export const GalleryComboboxDemo$output_text_derive = derive(['state'], (state: any) =>
  state.value === 'chicago' ? 'Chicago city' : 'Austin',
);

import { component } from '@kovojs/core';
import {
  comboboxFilteredItems as _comboboxFilteredItems,
  comboboxInput as _comboboxInput,
  comboboxInputAttributes,
  comboboxKeyDown as _comboboxKeyDown,
  comboboxListboxAttributes,
  comboboxOptionAttributes,
  comboboxOptionClick as _comboboxOptionClick,
  comboboxRootAttributes,
  comboboxValueAttributes,
  type ComboboxItem,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/combobox.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const INPUT_CLASS =
  'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const LISTBOX_CLASS =
  'max-h-56 overflow-auto rounded-md border border-neutral-200 bg-white p-1 shadow-sm data-[state=closed]:hidden';
const OPTION_CLASS =
  'rounded px-2 py-1.5 text-sm text-neutral-700 data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[state=checked]:text-neutral-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

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
      <section
        class={ROOT_CLASS}
        data-gallery-interactive="combobox"
        {...comboboxRootAttributes({ ...inputState, id: 'gallery-combobox-root' })}
        data-state={state.open ? 'open' : 'closed'}
        data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$section_data_state_derive"
        kovo-c="gallery-combobox-demo"
        kovo-state='{"highlightedValue":"austin","inputValue":"austin","open":false,"value":"austin"}'
      >
        <label id="gallery-combobox-label" for="gallery-combobox-input" class={LABEL_CLASS}>
          City
        </label>
        <form id="gallery-combobox-form" data-gallery-form="combobox" />
        <input
          id="gallery-combobox-input"
          class={INPUT_CLASS}
          on:input="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_input"
          on:keydown="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_keydown"
          {...comboboxInputAttributes({
            ...inputState,
            id: 'gallery-combobox-input',
            labelledBy: 'gallery-combobox-label',
          })}
          aria-activedescendant={
            state.highlightedValue === 'chicago'
              ? 'gallery-combobox-listbox-option-2'
              : state.highlightedValue === 'boston'
                ? 'gallery-combobox-listbox-option-1'
                : state.highlightedValue === 'austin'
                  ? 'gallery-combobox-listbox-option-0'
                  : null
          }
          data-bind:aria-activedescendant="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_aria_activedescendant_derive"
          aria-expanded={state.open ? 'true' : 'false'}
          data-bind:aria-expanded="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_aria_expanded_derive"
          data-placeholder={state.inputValue === '' ? '' : null}
          data-bind:data-placeholder="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_data_placeholder_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_data_state_derive"
          value={state.inputValue}
          data-bind:value="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$input_value_derive"
        />
        <div
          class={LISTBOX_CLASS}
          {...comboboxListboxAttributes({
            ...inputState,
            id: listboxId,
            labelledBy: 'gallery-combobox-label',
          })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$div_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$div_hidden_derive"
        >
          <button
            class={OPTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_click"
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-0',
              itemLabel: 'Austin',
              itemValue: 'austin',
            })}
            aria-selected={state.value === 'austin' ? 'true' : 'false'}
            data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_aria_selected_derive"
            data-highlighted={state.highlightedValue === 'austin' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_highlighted_derive"
            data-state={state.value === 'austin' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_state_derive"
            hidden={
              state.inputValue !== '' &&
              !'austin austin'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_hidden_derive"
            tabIndex={state.highlightedValue === 'austin' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_tabIndex_derive"
          >
            Austin
          </button>
          <button
            class={OPTION_CLASS}
            tabIndex={-1}
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-1',
              itemDisabled: true,
              itemLabel: 'Boston',
              itemValue: 'boston',
            })}
            aria-selected={state.value === 'boston' ? 'true' : 'false'}
            data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_aria_selected_derive_2"
            data-highlighted={state.highlightedValue === 'boston' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_highlighted_derive_2"
            data-state={state.value === 'boston' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_state_derive_2"
            hidden={
              state.inputValue !== '' &&
              !'boston boston'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_hidden_derive_2"
          >
            Boston
          </button>
          <button
            class={OPTION_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_click_2"
            {...comboboxOptionAttributes({
              ...selectedState,
              id: 'gallery-combobox-listbox-option-2',
              itemValue: 'chicago',
            })}
            aria-selected={state.value === 'chicago' ? 'true' : 'false'}
            data-bind:aria-selected="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_aria_selected_derive_3"
            data-highlighted={state.highlightedValue === 'chicago' ? '' : null}
            data-bind:data-highlighted="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_highlighted_derive_3"
            data-state={state.value === 'chicago' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_data_state_derive_3"
            hidden={
              state.inputValue !== '' &&
              !'chicago city chicago'.includes(state.inputValue.toLocaleLowerCase())
            }
            data-bind:hidden="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_hidden_derive_3"
            tabIndex={state.highlightedValue === 'chicago' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$button_tabIndex_derive_2"
          >
            Chicago city
          </button>
        </div>
        <output
          class={VALUE_CLASS}
          data-demo-state="combobox-value"
          {...comboboxValueAttributes(selectedState)}
          data-bind="/c/examples/gallery/src/generated/interactive/combobox-demo.client.js?v=b11ef080#GalleryComboboxDemo$output_text_derive"
        >
          {state.value === 'chicago' ? 'Chicago city' : 'Austin'}
        </output>
      </section>
    );
  },
});
GalleryComboboxDemo.name = 'generated/interactive/combobox-demo/gallery-combobox-demo';

// @kovojs-ir - lowered from examples/gallery/src/interactive/select-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySelectDemo$SelectHiddenInput_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GallerySelectDemo$SelectTrigger_aria_expanded_derive = derive(
  ['state'],
  (state: any) => String(state.open),
);
export const GallerySelectDemo$SelectTrigger_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$SelectContent_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$SelectContent_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GallerySelectDemo$SelectItem_aria_selected_derive = derive(['state'], (state: any) =>
  state.value === 'standard' ? 'true' : 'false',
);
export const GallerySelectDemo$SelectItem_data_highlighted_derive = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'standard' ? '' : null),
);
export const GallerySelectDemo$SelectItem_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'standard' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$SelectItem_aria_selected_derive_2 = derive(['state'], (state: any) =>
  state.value === 'express' ? 'true' : 'false',
);
export const GallerySelectDemo$SelectItem_data_highlighted_derive_2 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'express' ? '' : null),
);
export const GallerySelectDemo$SelectItem_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'express' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$SelectItem_aria_selected_derive_3 = derive(['state'], (state: any) =>
  state.value === 'drone' ? 'true' : 'false',
);
export const GallerySelectDemo$SelectItem_data_highlighted_derive_3 = derive(
  ['state'],
  (state: any) => (state.highlightedValue === 'drone' ? '' : null),
);
export const GallerySelectDemo$SelectItem_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'drone' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$span_text_derive = derive(['state'], (state: any) =>
  state.value === 'express' ? 'Express' : 'Standard',
);

import { component } from '@kovojs/core';
import {
  Select,
  SelectContent,
  SelectHiddenInput,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type SelectItem as GallerySelectItem,
} from '@kovojs/ui/select';

const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GallerySelectDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const shippingOptions: readonly GallerySelectItem[] = Object.freeze([
  { id: 'gallery-select-option-standard', label: 'Standard', value: 'standard' },
  { id: 'gallery-select-option-express', label: 'Express', value: 'express' },
  { disabled: true, id: 'gallery-select-option-drone', label: 'Drone', value: 'drone' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GallerySelectDemo = component({
  state: () => ({ highlightedValue: 'standard', open: false, value: 'standard' }),
  render: (_queries: Record<string, never>, state: GallerySelectDemoState) => {
    const selectState = {
      form: 'gallery-select-form',
      highlightedValue: state.highlightedValue,
      items: shippingOptions,
      listboxId: 'gallery-select-listbox',
      name: 'gallery-shipping-speed',
      open: state.open,
      required: true,
      value: state.value,
    };

    return (
      <Select
        {...selectState}
        data-gallery-interactive="select"
        id="gallery-select-root"
        kovo-state='{"highlightedValue":"standard","open":false,"value":"standard"}'
      >
        <form id="gallery-select-form" data-gallery-form="select" />
        <label id="gallery-select-label" for="gallery-select-trigger" class={LABEL_CLASS}>
          Shipping speed
        </label>
        <SelectHiddenInput
          id="gallery-select-control"
          {...selectState}
          value={state.value}
          data-bind:value="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectHiddenInput_value_derive"
        />
        <SelectTrigger
          id="gallery-select-trigger"
          labelledBy="gallery-select-label"
          on:click="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectTrigger_click"
          on:keydown="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectTrigger_keydown"
          {...selectState}
          aria-expanded={String(state.open)}
          data-bind:aria-expanded="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectTrigger_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectTrigger_data_state_derive"
        >
          <span data-bind="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$span_text_derive">
            {state.value === 'express' ? 'Express' : 'Standard'}
          </span>
        </SelectTrigger>
        <SelectContent
          id="gallery-select-listbox"
          labelledBy="gallery-select-label"
          on:keydown="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectContent_keydown"
          {...selectState}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectContent_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectContent_hidden_derive"
        >
          <SelectItem
            id="gallery-select-option-standard"
            itemLabel="Standard"
            itemValue="standard"
            on:click="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_click"
            {...selectState}
            aria-selected={state.value === 'standard' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_aria_selected_derive"
            data-highlighted={state.highlightedValue === 'standard' ? '' : null}
            data-bind:data-highlighted="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_highlighted_derive"
            data-state={state.value === 'standard' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_state_derive"
          >
            Standard
          </SelectItem>
          <SelectItem
            id="gallery-select-option-express"
            itemLabel="Express"
            itemValue="express"
            on:click="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_click_2"
            {...selectState}
            aria-selected={state.value === 'express' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_aria_selected_derive_2"
            data-highlighted={state.highlightedValue === 'express' ? '' : null}
            data-bind:data-highlighted="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_highlighted_derive_2"
            data-state={state.value === 'express' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_state_derive_2"
          >
            Express
          </SelectItem>
          <SelectItem
            id="gallery-select-option-drone"
            itemDisabled={true}
            itemLabel="Drone"
            itemValue="drone"
            on:click="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_click_3"
            {...selectState}
            aria-selected={state.value === 'drone' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_aria_selected_derive_3"
            data-highlighted={state.highlightedValue === 'drone' ? '' : null}
            data-bind:data-highlighted="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_highlighted_derive_3"
            data-state={state.value === 'drone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/1fc3c803/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$SelectItem_data_state_derive_3"
          >
            Drone
          </SelectItem>
        </SelectContent>
        <SelectValue {...selectState} data-demo-state="select-value" />
      </Select>
    );
  },
});
GallerySelectDemo.name = 'generated/interactive/select-demo/gallery-select-demo';

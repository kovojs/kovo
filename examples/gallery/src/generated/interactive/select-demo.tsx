// @kovojs-ir - lowered from examples/gallery/src/interactive/select-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GallerySelectDemo$input_value_derive = derive(['state'], (state: any) => state.value);
export const GallerySelectDemo$button_aria_expanded_derive = derive(['state'], (state: any) =>
  String(state.open),
);
export const GallerySelectDemo$button_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.open ? 'open' : 'closed',
);
export const GallerySelectDemo$div_hidden_derive = derive(['state'], (state: any) =>
  !state.open ? '' : null,
);
export const GallerySelectDemo$div_aria_selected_derive = derive(['state'], (state: any) =>
  state.value === 'standard' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive = derive(['state'], (state: any) =>
  state.highlightedValue === 'standard' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'standard' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$div_aria_selected_derive_2 = derive(['state'], (state: any) =>
  state.value === 'express' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive_2 = derive(['state'], (state: any) =>
  state.highlightedValue === 'express' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'express' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$div_aria_selected_derive_3 = derive(['state'], (state: any) =>
  state.value === 'drone' ? 'true' : 'false',
);
export const GallerySelectDemo$div_data_highlighted_derive_3 = derive(['state'], (state: any) =>
  state.highlightedValue === 'drone' ? '' : null,
);
export const GallerySelectDemo$div_data_state_derive_4 = derive(['state'], (state: any) =>
  state.value === 'drone' ? 'checked' : 'unchecked',
);
export const GallerySelectDemo$span_text_derive = derive(['state'], (state: any) =>
  state.value === 'express' ? 'Express' : 'Standard',
);
export const GallerySelectDemo$output_text_derive = derive(['state'], (state: any) =>
  state.value === 'express' ? 'Express' : 'Standard',
);

import { component } from '@kovojs/core';
import {
  selectContentAttributes,
  selectHiddenInputAttributes,
  selectItemAttributes,
  selectRootAttributes,
  selectTriggerAttributes,
  selectValueAttributes,
  type SelectItem,
} from '@kovojs/headless-ui/select';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/select.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const TRIGGER_CLASS =
  'inline-flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-left text-sm text-neutral-950 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:border-red-400 data-[placeholder]:text-neutral-500';
const CONTENT_CLASS =
  'grid gap-1 rounded-md border border-neutral-200 bg-white p-1 text-sm text-neutral-950 shadow-sm data-[state=closed]:hidden';
const ITEM_CLASS =
  'cursor-default rounded px-2 py-1 text-neutral-950 data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[disabled]:cursor-not-allowed data-[disabled]:text-neutral-400';
const VALUE_CLASS = 'text-sm text-neutral-700 data-[placeholder]:text-neutral-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GallerySelectDemoState {
  highlightedValue: string;
  open: boolean;
  value: string;
}

const shippingOptions: readonly SelectItem[] = Object.freeze([
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
      <section
        {...selectRootAttributes({ ...selectState, id: 'gallery-select-root' })}
        class={ROOT_CLASS}
        data-gallery-interactive="select"
        kovo-c="gallery-select-demo"
        kovo-state='{"highlightedValue":"standard","open":false,"value":"standard"}'
      >
        <form id="gallery-select-form" data-gallery-form="select" />
        <label id="gallery-select-label" for="gallery-select-trigger" class={LABEL_CLASS}>
          Shipping speed
        </label>
        <input
          id="gallery-select-control"
          {...selectHiddenInputAttributes(selectState)}
          value={state.value}
          data-bind:value="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$input_value_derive"
        />
        <button
          id="gallery-select-trigger"
          class={TRIGGER_CLASS}
          on:click="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$button_click"
          on:keydown="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$button_keydown"
          {...selectTriggerAttributes({
            ...selectState,
            id: 'gallery-select-trigger',
            labelledBy: 'gallery-select-label',
          })}
          aria-expanded={String(state.open)}
          data-bind:aria-expanded="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$button_aria_expanded_derive"
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$button_data_state_derive"
        >
          <span data-bind="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$span_text_derive">
            {state.value === 'express' ? 'Express' : 'Standard'}
          </span>
        </button>
        <div
          class={CONTENT_CLASS}
          on:keydown="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_keydown"
          {...selectContentAttributes({
            ...selectState,
            id: 'gallery-select-listbox',
            labelledBy: 'gallery-select-label',
          })}
          data-state={state.open ? 'open' : 'closed'}
          data-bind:data-state="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_state_derive"
          hidden={!state.open}
          data-bind:hidden="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_hidden_derive"
        >
          <div
            class={ITEM_CLASS}
            on:click="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_click"
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-standard',
              itemLabel: 'Standard',
              itemValue: 'standard',
            })}
            aria-selected={state.value === 'standard' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_aria_selected_derive"
            data-highlighted={state.highlightedValue === 'standard' ? '' : null}
            data-bind:data-highlighted="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_highlighted_derive"
            data-state={state.value === 'standard' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_state_derive_2"
          >
            Standard
          </div>
          <div
            class={ITEM_CLASS}
            on:click="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_click_2"
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-express',
              itemLabel: 'Express',
              itemValue: 'express',
            })}
            aria-selected={state.value === 'express' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_aria_selected_derive_2"
            data-highlighted={state.highlightedValue === 'express' ? '' : null}
            data-bind:data-highlighted="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_highlighted_derive_2"
            data-state={state.value === 'express' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_state_derive_3"
          >
            Express
          </div>
          <div
            class={ITEM_CLASS}
            on:click="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_click_3"
            {...selectItemAttributes({
              ...selectState,
              id: 'gallery-select-option-drone',
              itemDisabled: true,
              itemLabel: 'Drone',
              itemValue: 'drone',
            })}
            aria-selected={state.value === 'drone' ? 'true' : 'false'}
            data-bind:aria-selected="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_aria_selected_derive_3"
            data-highlighted={state.highlightedValue === 'drone' ? '' : null}
            data-bind:data-highlighted="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_highlighted_derive_3"
            data-state={state.value === 'drone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$div_data_state_derive_4"
          >
            Drone
          </div>
        </div>
        <output
          class={VALUE_CLASS}
          data-demo-state="select-value"
          {...selectValueAttributes(selectState)}
          data-bind="/c/__v/38dd1b90/examples/gallery/src/generated/interactive/select-demo.client.js#GallerySelectDemo$output_text_derive"
        >
          {state.value === 'express' ? 'Express' : 'Standard'}
        </output>
      </section>
    );
  },
});
GallerySelectDemo.name = 'generated/interactive/select-demo/gallery-select-demo';

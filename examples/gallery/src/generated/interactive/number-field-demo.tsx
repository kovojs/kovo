// @kovojs-ir - lowered from examples/gallery/src/interactive/number-field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

export const GalleryNumberFieldDemo$button_data_disabled_derive = derive(['state'], (state: any) =>
  state.value <= 0 ? '' : null,
);
export const GalleryNumberFieldDemo$button_disabled_derive = derive(['state'], (state: any) =>
  state.value <= 0 ? '' : null,
);
export const GalleryNumberFieldDemo$input_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryNumberFieldDemo$button_data_disabled_derive_2 = derive(
  ['state'],
  (state: any) => (state.value >= 5 ? '' : null),
);
export const GalleryNumberFieldDemo$button_disabled_derive_2 = derive(['state'], (state: any) =>
  state.value >= 5 ? '' : null,
);
export const GalleryNumberFieldDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@kovojs/core';
import {
  numberFieldDecrementAttributes,
  numberFieldDecrementClick as _numberFieldDecrementClick,
  numberFieldIncrementAttributes,
  numberFieldIncrementClick as _numberFieldIncrementClick,
  numberFieldInput as _numberFieldInput,
  numberFieldInputAttributes,
  numberFieldKeyDown as _numberFieldKeyDown,
  numberFieldRootAttributes,
} from '@kovojs/headless-ui/primitives';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/number-field.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const CONTROL_CLASS =
  'inline-flex h-9 w-fit items-center overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm data-[disabled]:opacity-60 data-[invalid]:border-red-400';
const INPUT_CLASS =
  'h-9 w-20 border-0 bg-transparent px-3 text-center text-sm text-neutral-950 outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 aria-[invalid=true]:text-red-950';
const BUTTON_CLASS =
  'inline-flex h-9 w-9 items-center justify-center border-neutral-200 bg-neutral-50 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 data-[action=decrement]:border-r data-[action=increment]:border-l data-[disabled]:opacity-70';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';

export interface GalleryNumberFieldDemoState {
  value: number;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryNumberFieldDemo = component({
  state: () => ({ value: 2 }),
  render: (_queries: Record<string, never>, state: GalleryNumberFieldDemoState) => {
    const fieldState = {
      max: 5,
      min: 0,
      name: 'gallery-seat-count',
      required: true,
      smallStep: 1,
      step: 1,
      value: state.value,
    };
    const formId = 'gallery-number-field-form';
    const inputId = 'gallery-number-field-input';

    return (
      <form
        {...numberFieldRootAttributes(fieldState)}
        class={ROOT_CLASS}
        data-gallery-interactive="number-field"
        id={formId}
        kovo-c="gallery-number-field-demo"
        kovo-state='{"value":2}'
      >
        <label for={inputId} class={LABEL_CLASS}>
          Seats
        </label>
        <div class={CONTROL_CLASS}>
          <button
            class={BUTTON_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_click"
            {...numberFieldDecrementAttributes({ ...fieldState, inputId, label: 'Decrease seats' })}
            data-disabled={state.value <= 0 ? '' : null}
            data-bind:data-disabled="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_data_disabled_derive"
            disabled={state.value <= 0}
            data-bind:disabled="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_disabled_derive"
          >
            -
          </button>
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$input_input"
            on:keydown="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$input_keydown"
            {...numberFieldInputAttributes({
              ...fieldState,
              form: formId,
              id: inputId,
              label: 'Seats',
            })}
            value={state.value}
            data-bind:value="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$input_value_derive"
          />
          <button
            class={BUTTON_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_click_2"
            {...numberFieldIncrementAttributes({ ...fieldState, inputId, label: 'Increase seats' })}
            data-disabled={state.value >= 5 ? '' : null}
            data-bind:data-disabled="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_data_disabled_derive_2"
            disabled={state.value >= 5}
            data-bind:disabled="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$button_disabled_derive_2"
          >
            +
          </button>
        </div>
        <output
          data-demo-state="value"
          class="text-xs text-neutral-500"
          data-bind="/c/examples/gallery/src/generated/interactive/number-field-demo.client.js?v=0addeb6b#GalleryNumberFieldDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </form>
    );
  },
});
GalleryNumberFieldDemo.name = 'generated/interactive/number-field-demo/gallery-number-field-demo';

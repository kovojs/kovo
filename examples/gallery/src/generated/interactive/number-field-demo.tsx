// @kovojs-ir - lowered from examples/gallery/src/interactive/number-field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

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
  numberFieldIncrementAttributes,
  numberFieldInputAttributes,
  numberFieldRootAttributes,
} from '@kovojs/headless-ui/number-field';
import {
  numberFieldClasses,
  numberFieldControlClasses,
  numberFieldInputClasses,
  numberFieldButtonClasses,
} from '@kovojs/ui/number-field';

const ROOT_CLASS = numberFieldClasses.join(' ');
const CONTROL_CLASS = numberFieldControlClasses.join(' ');
const INPUT_CLASS = numberFieldInputClasses.join(' ');
const BUTTON_CLASS = numberFieldButtonClasses.join(' ');
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
            on:click="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_click"
            {...numberFieldDecrementAttributes({ ...fieldState, inputId, label: 'Decrease seats' })}
            data-disabled={state.value <= 0 ? '' : null}
            data-bind:data-disabled="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_data_disabled_derive"
            disabled={state.value <= 0}
            data-bind:disabled="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_disabled_derive"
          >
            -
          </button>
          <input
            class={INPUT_CLASS}
            on:input="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$input_input"
            on:keydown="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$input_keydown"
            {...numberFieldInputAttributes({
              ...fieldState,
              form: formId,
              id: inputId,
              label: 'Seats',
            })}
            value={state.value}
            data-bind:value="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$input_value_derive"
          />
          <button
            class={BUTTON_CLASS}
            on:click="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_click_2"
            {...numberFieldIncrementAttributes({ ...fieldState, inputId, label: 'Increase seats' })}
            data-disabled={state.value >= 5 ? '' : null}
            data-bind:data-disabled="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_data_disabled_derive_2"
            disabled={state.value >= 5}
            data-bind:disabled="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$button_disabled_derive_2"
          >
            +
          </button>
        </div>
        <output
          data-demo-state="value"
          class="text-xs text-neutral-500"
          data-bind="/c/__v/66cb1227/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </form>
    );
  },
});
GalleryNumberFieldDemo.name = 'generated/interactive/number-field-demo/gallery-number-field-demo';

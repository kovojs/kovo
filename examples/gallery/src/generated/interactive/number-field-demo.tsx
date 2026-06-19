// @kovojs-ir - lowered from examples/gallery/src/interactive/number-field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryNumberFieldDemo$NumberFieldDecrement_data_disabled_derive = derive(
  ['state'],
  (state: any) => (state.value <= 0 ? '' : null),
);
export const GalleryNumberFieldDemo$NumberFieldDecrement_disabled_derive = derive(
  ['state'],
  (state: any) => (state.value <= 0 ? '' : null),
);
export const GalleryNumberFieldDemo$NumberFieldInput_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryNumberFieldDemo$NumberFieldIncrement_data_disabled_derive = derive(
  ['state'],
  (state: any) => (state.value >= 5 ? '' : null),
);
export const GalleryNumberFieldDemo$NumberFieldIncrement_disabled_derive = derive(
  ['state'],
  (state: any) => (state.value >= 5 ? '' : null),
);
export const GalleryNumberFieldDemo$output_text_derive = derive(['state'], (state: any) =>
  String(state.value),
);

import { component } from '@kovojs/core';
import {
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@kovojs/ui/number-field';

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
      <NumberField
        {...fieldState}
        data-gallery-interactive="number-field"
        id={formId}
        kovo-state='{"value":2}'
      >
        <label for={inputId} style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717">
          Seats
        </label>
        <NumberFieldControl {...fieldState}>
          <NumberFieldDecrement
            inputId={inputId}
            label="Decrease seats"
            on:click="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldDecrement_click"
            {...fieldState}
            data-disabled={state.value <= 0 ? '' : null}
            data-bind:data-disabled="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldDecrement_data_disabled_derive"
            disabled={state.value <= 0}
            data-bind:disabled="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldDecrement_disabled_derive"
          >
            -
          </NumberFieldDecrement>
          <NumberFieldInput
            form={formId}
            id={inputId}
            label="Seats"
            on:input="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldInput_input"
            on:keydown="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldInput_keydown"
            {...fieldState}
            value={state.value}
            data-bind:value="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldInput_value_derive"
          />
          <NumberFieldIncrement
            inputId={inputId}
            label="Increase seats"
            on:click="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldIncrement_click"
            {...fieldState}
            data-disabled={state.value >= 5 ? '' : null}
            data-bind:data-disabled="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldIncrement_data_disabled_derive"
            disabled={state.value >= 5}
            data-bind:disabled="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$NumberFieldIncrement_disabled_derive"
          >
            +
          </NumberFieldIncrement>
        </NumberFieldControl>
        <output
          data-demo-state="value"
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-bind="/c/__v/ead4bd49/examples/gallery/src/generated/interactive/number-field-demo.client.js#GalleryNumberFieldDemo$output_text_derive"
        >
          {String(state.value)}
        </output>
      </NumberField>
    );
  },
});
GalleryNumberFieldDemo.name = 'generated/interactive/number-field-demo/gallery-number-field-demo';

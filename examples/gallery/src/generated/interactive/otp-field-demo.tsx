// @kovojs-ir - lowered from examples/gallery/src/interactive/otp-field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryOtpFieldDemo$section_data_complete_derive = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_data_complete_derive = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryOtpFieldDemo$input_data_complete_derive_2 = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_data_filled_derive = derive(['state'], (state: any) =>
  (state.value[0] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$input_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeSlot === 0 ? 0 : -1,
);
export const GalleryOtpFieldDemo$input_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value[0] ?? '',
);
export const GalleryOtpFieldDemo$input_data_complete_derive_3 = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_data_filled_derive_2 = derive(['state'], (state: any) =>
  (state.value[1] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$input_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeSlot === 1 ? 0 : -1,
);
export const GalleryOtpFieldDemo$input_value_derive_3 = derive(
  ['state'],
  (state: any) => state.value[1] ?? '',
);
export const GalleryOtpFieldDemo$input_data_complete_derive_4 = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_data_filled_derive_3 = derive(['state'], (state: any) =>
  (state.value[2] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$input_tabIndex_derive_3 = derive(['state'], (state: any) =>
  state.activeSlot === 2 ? 0 : -1,
);
export const GalleryOtpFieldDemo$input_value_derive_4 = derive(
  ['state'],
  (state: any) => state.value[2] ?? '',
);
export const GalleryOtpFieldDemo$input_data_complete_derive_5 = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$input_data_filled_derive_4 = derive(['state'], (state: any) =>
  (state.value[3] ?? '') === '' ? null : '',
);
export const GalleryOtpFieldDemo$input_tabIndex_derive_4 = derive(['state'], (state: any) =>
  state.activeSlot === 3 ? 0 : -1,
);
export const GalleryOtpFieldDemo$input_value_derive_5 = derive(
  ['state'],
  (state: any) => state.value[3] ?? '',
);

import { component } from '@kovojs/core';
import {
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
} from '@kovojs/headless-ui/otp-field';

// Local class constants mirror the @kovojs/ui StyleX layer (packages/ui/src/otp-field.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so matching class
// strings stay in this TSX-authored gallery fixture.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950';
const GROUP_CLASS = 'flex items-center gap-2';
const HIDDEN_INPUT_CLASS = 'sr-only';
const INPUT_CLASS =
  'h-10 w-9 rounded-md border border-neutral-300 bg-white text-center text-base font-medium text-neutral-950 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-500 data-[filled]:border-neutral-500 data-[invalid]:border-red-500 data-[invalid]:focus-visible:outline-red-500';
const LABEL_CLASS = 'text-sm font-medium leading-none text-neutral-900';
const DESCRIPTION_CLASS = 'text-sm text-neutral-500';
const OUTPUT_CLASS = 'text-xs text-neutral-500';

export interface GalleryOtpFieldDemoState {
  activeSlot: number;
  value: string;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryOtpFieldDemo = component({
  state: () => ({ activeSlot: 2, value: '12' }),
  render: (_queries: Record<string, never>, state: GalleryOtpFieldDemoState) => {
    const formId = 'gallery-otp-form';
    const fieldState = {
      form: formId,
      length: 4,
      name: 'gallery-otp-code',
      pattern: '[0-9]*',
      required: true,
      value: state.value,
    };

    return (
      <section
        class={ROOT_CLASS}
        data-gallery-interactive="otp-field"
        {...otpFieldRootAttributes({
          ...fieldState,
          descriptionId: 'gallery-interactive-otp-description',
          id: 'gallery-interactive-otp',
          labelledBy: 'gallery-interactive-otp-label',
        })}
        data-complete={state.value.length === 4 ? '' : null}
        data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$section_data_complete_derive"
        kovo-c="gallery-otp-field-demo"
        kovo-state='{"activeSlot":2,"value":"12"}'
      >
        <form id={formId} data-gallery-form="otp-field" />
        <label
          id="gallery-interactive-otp-label"
          for="gallery-interactive-otp-hidden"
          class={LABEL_CLASS}
        >
          Verification code
        </label>
        <input
          id="gallery-interactive-otp-hidden"
          class={HIDDEN_INPUT_CLASS}
          {...otpFieldHiddenInputAttributes({
            ...fieldState,
            id: 'gallery-interactive-otp-hidden',
          })}
          data-complete={state.value.length === 4 ? '' : null}
          data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_complete_derive"
          value={state.value}
          data-bind:value="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_value_derive"
        />
        <div class={GROUP_CLASS}>
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_input"
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_keydown"
            on:paste="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_paste"
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-0',
              label: 'Verification code digit 1',
              slotIndex: 0,
            })}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_complete_derive_2"
            data-filled={(state.value[0] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_filled_derive"
            tabIndex={state.activeSlot === 0 ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_tabIndex_derive"
            value={state.value[0] ?? ''}
            data-bind:value="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_value_derive_2"
          />
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_input_2"
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_keydown_2"
            on:paste="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_paste_2"
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-1',
              label: 'Verification code digit 2',
              slotIndex: 1,
            })}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_complete_derive_3"
            data-filled={(state.value[1] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_filled_derive_2"
            tabIndex={state.activeSlot === 1 ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_tabIndex_derive_2"
            value={state.value[1] ?? ''}
            data-bind:value="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_value_derive_3"
          />
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_input_3"
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_keydown_3"
            on:paste="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_paste_3"
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-2',
              label: 'Verification code digit 3',
              slotIndex: 2,
            })}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_complete_derive_4"
            data-filled={(state.value[2] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_filled_derive_3"
            tabIndex={state.activeSlot === 2 ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_tabIndex_derive_3"
            value={state.value[2] ?? ''}
            data-bind:value="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_value_derive_4"
          />
          <input
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_input_4"
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_keydown_4"
            on:paste="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_paste_4"
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-3',
              label: 'Verification code digit 4',
              slotIndex: 3,
            })}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_complete_derive_5"
            data-filled={(state.value[3] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_data_filled_derive_4"
            tabIndex={state.activeSlot === 3 ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_tabIndex_derive_4"
            value={state.value[3] ?? ''}
            data-bind:value="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=76a8b422#GalleryOtpFieldDemo$input_value_derive_5"
          />
        </div>
        <p id="gallery-interactive-otp-description" class={DESCRIPTION_CLASS}>
          Enter the four digit code.
        </p>
        <output data-demo-state="otp-value" class={OUTPUT_CLASS} data-bind="state.value">
          {state.value}
        </output>
      </section>
    );
  },
});
GalleryOtpFieldDemo.name = 'generated/interactive/otp-field-demo/gallery-otp-field-demo';

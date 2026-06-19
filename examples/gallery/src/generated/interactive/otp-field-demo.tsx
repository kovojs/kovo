// @kovojs-ir - lowered from examples/gallery/src/interactive/otp-field-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryOtpFieldDemo$OtpField_data_complete_derive = derive(['state'], (state: any) =>
  state.value.length === 4 ? '' : null,
);
export const GalleryOtpFieldDemo$OtpFieldHiddenInput_data_complete_derive = derive(
  ['state'],
  (state: any) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldHiddenInput_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive = derive(
  ['state'],
  (state: any) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive = derive(
  ['state'],
  (state: any) => ((state.value[0] ?? '') === '' ? null : ''),
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive = derive(['state'], (state: any) =>
  state.activeSlot === 0 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive = derive(
  ['state'],
  (state: any) => state.value[0] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_2 = derive(
  ['state'],
  (state: any) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_2 = derive(
  ['state'],
  (state: any) => ((state.value[1] ?? '') === '' ? null : ''),
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.activeSlot === 1 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value[1] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_3 = derive(
  ['state'],
  (state: any) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_3 = derive(
  ['state'],
  (state: any) => ((state.value[2] ?? '') === '' ? null : ''),
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_3 = derive(['state'], (state: any) =>
  state.activeSlot === 2 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_3 = derive(
  ['state'],
  (state: any) => state.value[2] ?? '',
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_4 = derive(
  ['state'],
  (state: any) => (state.value.length === 4 ? '' : null),
);
export const GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_4 = derive(
  ['state'],
  (state: any) => ((state.value[3] ?? '') === '' ? null : ''),
);
export const GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_4 = derive(['state'], (state: any) =>
  state.activeSlot === 3 ? 0 : -1,
);
export const GalleryOtpFieldDemo$OtpFieldInput_value_derive_4 = derive(
  ['state'],
  (state: any) => state.value[3] ?? '',
);

import { component } from '@kovojs/core';
import { OtpField, OtpFieldGroup, OtpFieldHiddenInput, OtpFieldInput } from '@kovojs/ui/otp-field';

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
      <OtpField
        data-gallery-interactive="otp-field"
        descriptionId="gallery-interactive-otp-description"
        id="gallery-interactive-otp"
        labelledBy="gallery-interactive-otp-label"
        {...fieldState}
        data-complete={state.value.length === 4 ? '' : null}
        data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpField_data_complete_derive"
        kovo-state='{"activeSlot":2,"value":"12"}'
      >
        <form id={formId} data-gallery-form="otp-field" />
        <label
          id="gallery-interactive-otp-label"
          for="gallery-interactive-otp-hidden"
          style="font-size:0.875rem;font-weight:500;line-height:1;color:#171717"
        >
          Verification code
        </label>
        <OtpFieldHiddenInput
          id="gallery-interactive-otp-hidden"
          {...fieldState}
          data-complete={state.value.length === 4 ? '' : null}
          data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldHiddenInput_data_complete_derive"
          value={state.value}
          data-bind:value="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldHiddenInput_value_derive"
        />
        <OtpFieldGroup>
          <OtpFieldInput
            id="gallery-interactive-otp-slot-0"
            label="Verification code digit 1"
            slotIndex={0}
            on:input="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_input"
            on:keydown="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_keydown"
            on:paste="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_paste"
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive"
            data-filled={(state.value[0] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive"
            tabIndex={state.activeSlot === 0 ? 0 : -1}
            data-bind:tabIndex="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive"
            value={state.value[0] ?? ''}
            data-bind:value="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_value_derive"
          />
          <OtpFieldInput
            id="gallery-interactive-otp-slot-1"
            label="Verification code digit 2"
            slotIndex={1}
            on:input="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_input_2"
            on:keydown="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_keydown_2"
            on:paste="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_paste_2"
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_2"
            data-filled={(state.value[1] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_2"
            tabIndex={state.activeSlot === 1 ? 0 : -1}
            data-bind:tabIndex="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_2"
            value={state.value[1] ?? ''}
            data-bind:value="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_value_derive_2"
          />
          <OtpFieldInput
            id="gallery-interactive-otp-slot-2"
            label="Verification code digit 3"
            slotIndex={2}
            on:input="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_input_3"
            on:keydown="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_keydown_3"
            on:paste="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_paste_3"
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_3"
            data-filled={(state.value[2] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_3"
            tabIndex={state.activeSlot === 2 ? 0 : -1}
            data-bind:tabIndex="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_3"
            value={state.value[2] ?? ''}
            data-bind:value="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_value_derive_3"
          />
          <OtpFieldInput
            id="gallery-interactive-otp-slot-3"
            label="Verification code digit 4"
            slotIndex={3}
            on:input="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_input_4"
            on:keydown="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_keydown_4"
            on:paste="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_paste_4"
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-bind:data-complete="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_complete_derive_4"
            data-filled={(state.value[3] ?? '') === '' ? null : ''}
            data-bind:data-filled="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_data_filled_derive_4"
            tabIndex={state.activeSlot === 3 ? 0 : -1}
            data-bind:tabIndex="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_tabIndex_derive_4"
            value={state.value[3] ?? ''}
            data-bind:value="/c/__v/178bd8b6/examples/gallery/src/generated/interactive/otp-field-demo.client.js#GalleryOtpFieldDemo$OtpFieldInput_value_derive_4"
          />
        </OtpFieldGroup>
        <p id="gallery-interactive-otp-description" style="font-size:0.875rem;color:#6b7280">
          Enter the four digit code.
        </p>
        <output
          data-demo-state="otp-value"
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-bind="state.value"
        >
          {state.value}
        </output>
      </OtpField>
    );
  },
});
GalleryOtpFieldDemo.name = 'generated/interactive/otp-field-demo/gallery-otp-field-demo';

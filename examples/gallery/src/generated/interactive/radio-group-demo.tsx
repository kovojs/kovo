// @kovojs-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryRadioGroupDemo$RadioGroup_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 0 : -1),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive_2 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_value_derive_3 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 0 : -1),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_value_derive_3 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupLabel_value_derive_3 = derive(
  ['state'],
  (state: any) => state.value,
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? '' : null),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'phone' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'phone' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'phone' ? '' : null),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'phone' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'phone' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 'true' : 'false'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? '' : null),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);

import { component } from '@kovojs/core';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
} from '@kovojs/ui/radio-group';

export interface GalleryRadioGroupDemoState {
  value: string;
}

const radioItems = Object.freeze([
  { value: 'email' },
  { disabled: true, value: 'phone' },
  { value: 'sms' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Kovo.
export const GalleryRadioGroupDemo = component({
  state: () => ({ value: 'email' }),
  render: (_queries: Record<string, never>, state: GalleryRadioGroupDemoState) => {
    const groupState = {
      form: 'gallery-radio-form',
      items: radioItems,
      name: 'gallery-contact-channel',
      required: true,
    };

    return (
      <RadioGroup
        data-gallery-interactive="radio-group"
        labelledBy="gallery-radio-group-label"
        on:keydown="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroup_keydown"
        {...groupState}
        value={state.value}
        data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroup_value_derive"
        kovo-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" style="font-size:0.875rem;font-weight:500">
          Contact channel
        </h3>
        <RadioGroupItem
          itemValue="email"
          {...groupState}
          value={state.value}
          data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_value_derive"
          data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive"
        >
          <RadioGroupRadio
            controlId="gallery-radio-email"
            itemValue="email"
            on:click="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_click"
            {...groupState}
            tabIndex={state.value === 'email' ? 0 : -1}
            data-bind:tabIndex="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive"
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_value_derive"
            data-bind:aria-checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive"
            data-bind:checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive"
          />
          <RadioGroupLabel
            controlId="gallery-radio-email"
            itemValue="email"
            {...groupState}
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_value_derive"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive"
          >
            Email
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          itemValue="phone"
          {...groupState}
          value={state.value}
          data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_value_derive_2"
          data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_2"
        >
          <RadioGroupRadio
            controlId="gallery-radio-phone"
            itemValue="phone"
            tabIndex={-1}
            {...groupState}
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_value_derive_2"
            data-bind:aria-checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_2"
            data-bind:checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_2"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_2"
          />
          <RadioGroupLabel
            controlId="gallery-radio-phone"
            itemValue="phone"
            {...groupState}
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_value_derive_2"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_2"
          >
            Phone
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          itemValue="sms"
          {...groupState}
          value={state.value}
          data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_value_derive_3"
          data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_3"
        >
          <RadioGroupRadio
            controlId="gallery-radio-sms"
            itemValue="sms"
            on:click="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_click_2"
            {...groupState}
            tabIndex={state.value === 'sms' ? 0 : -1}
            data-bind:tabIndex="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive_2"
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_value_derive_3"
            data-bind:aria-checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_3"
            data-bind:checked="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_3"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_3"
          />
          <RadioGroupLabel
            controlId="gallery-radio-sms"
            itemValue="sms"
            {...groupState}
            value={state.value}
            data-bind:value="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_value_derive_3"
            data-bind:data-state="/c/__v/dac440ec/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_3"
          >
            SMS
          </RadioGroupLabel>
        </RadioGroupItem>
        <output
          style="font-size:0.75rem;color:#6b7280;margin-top:0.25rem;display:block"
          data-demo-state="radio-value"
          data-bind="state.value"
        >
          {state.value}
        </output>
      </RadioGroup>
    );
  },
});
GalleryRadioGroupDemo.name = 'generated/interactive/radio-group-demo/gallery-radio-group-demo';

// @kovojs-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryRadioGroupDemo$RadioGroupItem_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive = derive(
  ['state'],
  (state: any) => String(state.value === 'email'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? '' : null),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive = derive(
  ['state'],
  (state: any) => (state.value === 'email' ? 0 : -1),
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
  (state: any) => String(state.value === 'phone'),
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
  (state: any) => String(state.value === 'sms'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? '' : null),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_3 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 'checked' : 'unchecked'),
);
export const GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive_2 = derive(
  ['state'],
  (state: any) => (state.value === 'sms' ? 0 : -1),
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
      value: state.value,
    };
    const emailState = { ...groupState, itemValue: 'email' };
    const phoneState = { ...groupState, itemValue: 'phone' };
    const smsState = { ...groupState, itemValue: 'sms' };

    return (
      <RadioGroup
        {...groupState}
        data-gallery-interactive="radio-group"
        labelledBy="gallery-radio-group-label"
        on:keydown="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroup_keydown"
        kovo-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" style="font-size:0.875rem;font-weight:500">
          Contact channel
        </h3>
        <RadioGroupItem
          {...emailState}
          data-state={state.value === 'email' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive"
        >
          <RadioGroupRadio
            controlId="gallery-radio-email"
            on:click="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_click"
            {...emailState}
            aria-checked={String(state.value === 'email')}
            data-bind:aria-checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive"
            checked={state.value === 'email'}
            data-bind:checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive"
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive"
            tabIndex={state.value === 'email' ? 0 : -1}
            data-bind:tabIndex="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive"
          />
          <RadioGroupLabel
            controlId="gallery-radio-email"
            {...emailState}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive"
          >
            Email
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          {...phoneState}
          data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_2"
        >
          <RadioGroupRadio
            controlId="gallery-radio-phone"
            tabIndex={-1}
            {...phoneState}
            aria-checked={String(state.value === 'phone')}
            data-bind:aria-checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_2"
            checked={state.value === 'phone'}
            data-bind:checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_2"
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_2"
          />
          <RadioGroupLabel
            controlId="gallery-radio-phone"
            {...phoneState}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_2"
          >
            Phone
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          {...smsState}
          data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupItem_data_state_derive_3"
        >
          <RadioGroupRadio
            controlId="gallery-radio-sms"
            on:click="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_click_2"
            {...smsState}
            aria-checked={String(state.value === 'sms')}
            data-bind:aria-checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_aria_checked_derive_3"
            checked={state.value === 'sms'}
            data-bind:checked="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_checked_derive_3"
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_data_state_derive_3"
            tabIndex={state.value === 'sms' ? 0 : -1}
            data-bind:tabIndex="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupRadio_tabIndex_derive_2"
          />
          <RadioGroupLabel
            controlId="gallery-radio-sms"
            {...smsState}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/6f0126d6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$RadioGroupLabel_data_state_derive_3"
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

// @kovojs-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime/generated';

export const GalleryRadioGroupDemo$div_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive = derive(['state'], (state: any) =>
  String(state.value === 'email'),
);
export const GalleryRadioGroupDemo$input_checked_derive = derive(['state'], (state: any) =>
  state.value === 'email' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_tabIndex_derive = derive(['state'], (state: any) =>
  state.value === 'email' ? 0 : -1,
);
export const GalleryRadioGroupDemo$label_data_state_derive = derive(['state'], (state: any) =>
  state.value === 'email' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$div_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive_2 = derive(['state'], (state: any) =>
  String(state.value === 'phone'),
);
export const GalleryRadioGroupDemo$input_checked_derive_2 = derive(['state'], (state: any) =>
  state.value === 'phone' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$label_data_state_derive_2 = derive(['state'], (state: any) =>
  state.value === 'phone' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$div_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_aria_checked_derive_3 = derive(['state'], (state: any) =>
  String(state.value === 'sms'),
);
export const GalleryRadioGroupDemo$input_checked_derive_3 = derive(['state'], (state: any) =>
  state.value === 'sms' ? '' : null,
);
export const GalleryRadioGroupDemo$input_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);
export const GalleryRadioGroupDemo$input_tabIndex_derive_2 = derive(['state'], (state: any) =>
  state.value === 'sms' ? 0 : -1,
);
export const GalleryRadioGroupDemo$label_data_state_derive_3 = derive(['state'], (state: any) =>
  state.value === 'sms' ? 'checked' : 'unchecked',
);

import { component } from '@kovojs/core';
import {
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
} from '@kovojs/headless-ui/radio-group';
import {
  radioGroupClasses,
  radioGroupItemClasses,
  radioGroupRadioClasses,
  radioGroupLabelClasses,
} from '@kovojs/ui/radio-group';

const ROOT_CLASS = radioGroupClasses.join(' ');
const ITEM_CLASS = radioGroupItemClasses.join(' ');
const RADIO_CLASS = radioGroupRadioClasses.join(' ');
const LABEL_CLASS = radioGroupLabelClasses.join(' ');

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
      <div
        {...radioGroupRootAttributes({
          ...groupState,
          labelledBy: 'gallery-radio-group-label',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="radio-group"
        on:keydown="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$div_keydown"
        kovo-c="gallery-radio-group-demo"
        kovo-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" class="text-sm font-medium">
          Contact channel
        </h3>
        <div
          class={ITEM_CLASS}
          {...radioGroupItemAttributes(emailState)}
          data-state={state.value === 'email' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$div_data_state_derive"
        >
          <input
            class={RADIO_CLASS}
            on:click="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_click"
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            aria-checked={String(state.value === 'email')}
            data-bind:aria-checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_aria_checked_derive"
            checked={state.value === 'email'}
            data-bind:checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_checked_derive"
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_data_state_derive"
            tabIndex={state.value === 'email' ? 0 : -1}
            data-bind:tabIndex="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_tabIndex_derive"
          />
          <label
            class={LABEL_CLASS}
            {...radioGroupLabelAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$label_data_state_derive"
          >
            Email
          </label>
        </div>
        <div
          class={ITEM_CLASS}
          {...radioGroupItemAttributes(phoneState)}
          data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$div_data_state_derive_2"
        >
          <input
            class={RADIO_CLASS}
            tabIndex={-1}
            {...radioGroupRadioAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            aria-checked={String(state.value === 'phone')}
            data-bind:aria-checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_aria_checked_derive_2"
            checked={state.value === 'phone'}
            data-bind:checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_checked_derive_2"
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_data_state_derive_2"
          />
          <label
            class={LABEL_CLASS}
            {...radioGroupLabelAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$label_data_state_derive_2"
          >
            Phone
          </label>
        </div>
        <div
          class={ITEM_CLASS}
          {...radioGroupItemAttributes(smsState)}
          data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$div_data_state_derive_3"
        >
          <input
            class={RADIO_CLASS}
            on:click="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_click_2"
            {...radioGroupRadioAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            aria-checked={String(state.value === 'sms')}
            data-bind:aria-checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_aria_checked_derive_3"
            checked={state.value === 'sms'}
            data-bind:checked="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_checked_derive_3"
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_data_state_derive_3"
            tabIndex={state.value === 'sms' ? 0 : -1}
            data-bind:tabIndex="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$input_tabIndex_derive_2"
          />
          <label
            class={LABEL_CLASS}
            {...radioGroupLabelAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/__v/14d9a7f6/examples/gallery/src/generated/interactive/radio-group-demo.client.js#GalleryRadioGroupDemo$label_data_state_derive_3"
          >
            SMS
          </label>
        </div>
        <output
          class="text-xs text-neutral-500"
          data-demo-state="radio-value"
          data-bind="state.value"
        >
          {state.value}
        </output>
      </div>
    );
  },
});
GalleryRadioGroupDemo.name = 'generated/interactive/radio-group-demo/gallery-radio-group-demo';

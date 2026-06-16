// @kovojs-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @kovojs/server */
import { derive } from '@kovojs/runtime';

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
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupLabelAttributes,
  radioGroupKeyDown as _radioGroupKeyDown,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
} from '@kovojs/headless-ui/primitives';

// Tailwind classes mirror the @kovojs/ui styled layer (packages/ui/src/radio-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @kovojs/ui
// directly is KV234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
const ROOT_CLASS =
  'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[orientation=horizontal]:flex data-[orientation=horizontal]:flex-wrap data-[orientation=horizontal]:items-center data-[invalid]:text-red-950';
const ITEM_CLASS =
  'inline-flex items-center gap-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50';
const RADIO_CLASS =
  'h-4 w-4 border border-neutral-300 text-neutral-950 accent-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-50';
const LABEL_CLASS = 'select-none leading-none data-[disabled]:cursor-not-allowed';

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
export const GalleryRadioGroupDemo = component('gallery-radio-group-demo', {
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
        on:keydown="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$div_keydown"
        kovo-c="gallery-radio-group-demo"
        kovo-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" class="text-sm font-medium">
          Contact channel
        </h3>
        <div
          {...radioGroupItemAttributes(emailState)}
          class={ITEM_CLASS}
          data-state={state.value === 'email' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$div_data_state_derive"
        >
          <input
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            aria-checked={String(state.value === 'email')}
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_aria_checked_derive"
            checked={state.value === 'email'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_checked_derive"
            class={RADIO_CLASS}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_data_state_derive"
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_click"
            tabIndex={state.value === 'email' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_tabIndex_derive"
          />
          <label
            {...radioGroupLabelAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            class={LABEL_CLASS}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$label_data_state_derive"
          >
            Email
          </label>
        </div>
        <div
          {...radioGroupItemAttributes(phoneState)}
          class={ITEM_CLASS}
          data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$div_data_state_derive_2"
        >
          <input
            {...radioGroupRadioAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            aria-checked={String(state.value === 'phone')}
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_aria_checked_derive_2"
            checked={state.value === 'phone'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_checked_derive_2"
            class={RADIO_CLASS}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_data_state_derive_2"
            tabIndex={-1}
          />
          <label
            {...radioGroupLabelAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            class={LABEL_CLASS}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$label_data_state_derive_2"
          >
            Phone
          </label>
        </div>
        <div
          {...radioGroupItemAttributes(smsState)}
          class={ITEM_CLASS}
          data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
          data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$div_data_state_derive_3"
        >
          <input
            {...radioGroupRadioAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            aria-checked={String(state.value === 'sms')}
            data-bind:aria-checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_aria_checked_derive_3"
            checked={state.value === 'sms'}
            data-bind:checked="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_checked_derive_3"
            class={RADIO_CLASS}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_data_state_derive_3"
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_click_2"
            tabIndex={state.value === 'sms' ? 0 : -1}
            data-bind:tabIndex="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$input_tabIndex_derive_2"
          />
          <label
            {...radioGroupLabelAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            class={LABEL_CLASS}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            data-bind:data-state="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=f92cfa81#GalleryRadioGroupDemo$label_data_state_derive_3"
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

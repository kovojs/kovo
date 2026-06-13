// @jiso-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryRadioGroupDemoState {
  value: string;
}

const radioItems = Object.freeze([
  { value: 'email' },
  { disabled: true, value: 'phone' },
  { value: 'sms' },
]);

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
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
        class="grid gap-2"
        data-gallery-interactive="radio-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$div_keydown"
        fw-c="gallery-radio-group-demo"
        fw-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label">Contact channel</h3>
        <div {...radioGroupItemAttributes(emailState)} class="inline-flex items-center gap-2">
          <input
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$input_click"
          />
          <label
            {...radioGroupLabelAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
          >
            Email
          </label>
        </div>
        <div {...radioGroupItemAttributes(phoneState)} class="inline-flex items-center gap-2">
          <input
            {...radioGroupRadioAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
          />
          <label
            {...radioGroupLabelAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
          >
            Phone
          </label>
        </div>
        <div {...radioGroupItemAttributes(smsState)} class="inline-flex items-center gap-2">
          <input
            {...radioGroupRadioAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$input_click_2"
          />
          <label {...radioGroupLabelAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}>
            SMS
          </label>
        </div>
        <output data-demo-state="radio-value">{state.value}</output>
      </div>
    );
  },
});

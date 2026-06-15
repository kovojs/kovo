// @jiso-ir - lowered from examples/gallery/src/interactive/radio-group-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  radioGroupItemAttributes,
  radioGroupLabelAttributes,
  radioGroupRadioAttributes,
  radioGroupRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/radio-group.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
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
        class={ROOT_CLASS}
        data-gallery-interactive="radio-group"
        on:keydown="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$div_keydown"
        fw-c="gallery-radio-group-demo"
        fw-state='{"value":"email"}'
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" class="text-sm font-medium">
          Contact channel
        </h3>
        <div {...radioGroupItemAttributes(emailState)} class={ITEM_CLASS}>
          <input
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            class={RADIO_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$input_click"
          />
          <label
            {...radioGroupLabelAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            class={LABEL_CLASS}
          >
            Email
          </label>
        </div>
        <div {...radioGroupItemAttributes(phoneState)} class={ITEM_CLASS}>
          <input
            {...radioGroupRadioAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            class={RADIO_CLASS}
          />
          <label
            {...radioGroupLabelAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            class={LABEL_CLASS}
          >
            Phone
          </label>
        </div>
        <div {...radioGroupItemAttributes(smsState)} class={ITEM_CLASS}>
          <input
            {...radioGroupRadioAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            class={RADIO_CLASS}
            on:click="/c/examples/gallery/src/generated/interactive/radio-group-demo.client.js?v=3411a457#GalleryRadioGroupDemo$input_click_2"
          />
          <label
            {...radioGroupLabelAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            class={LABEL_CLASS}
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

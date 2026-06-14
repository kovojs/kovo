// @jiso-ir - lowered from examples/gallery/src/interactive/otp-field-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
} from '@jiso/headless-ui/primitives';

// Tailwind classes mirror the @jiso/ui styled layer (packages/ui/src/otp-field.tsx)
// so this interactive demo matches the component-gallery look. Importing @jiso/ui
// directly is FW234 (component package without a prefix), so the classes are
// inlined; they stay Tailwind-discoverable via the site @source on packages/ui.
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
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryOtpFieldDemo = component('gallery-otp-field-demo', {
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
        {...otpFieldRootAttributes({
          ...fieldState,
          descriptionId: 'gallery-interactive-otp-description',
          id: 'gallery-interactive-otp',
          labelledBy: 'gallery-interactive-otp-label',
        })}
        class={ROOT_CLASS}
        data-gallery-interactive="otp-field"
        fw-c="gallery-otp-field-demo"
        fw-state='{"activeSlot":2,"value":"12"}'
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
          {...otpFieldHiddenInputAttributes({
            ...fieldState,
            id: 'gallery-interactive-otp-hidden',
          })}
          id="gallery-interactive-otp-hidden"
          class={HIDDEN_INPUT_CLASS}
        />
        <div class={GROUP_CLASS}>
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-0',
              label: 'Verification code digit 1',
              slotIndex: 0,
            })}
            class={INPUT_CLASS}
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=36f2a5db#GalleryOtpFieldDemo$input_keydown"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-1',
              label: 'Verification code digit 2',
              slotIndex: 1,
            })}
            class={INPUT_CLASS}
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=36f2a5db#GalleryOtpFieldDemo$input_keydown_2"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-2',
              label: 'Verification code digit 3',
              slotIndex: 2,
            })}
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=36f2a5db#GalleryOtpFieldDemo$input_input"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-3',
              label: 'Verification code digit 4',
              slotIndex: 3,
            })}
            class={INPUT_CLASS}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=36f2a5db#GalleryOtpFieldDemo$input_input_2"
            on:paste="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=36f2a5db#GalleryOtpFieldDemo$input_paste"
          />
        </div>
        <p id="gallery-interactive-otp-description" class={DESCRIPTION_CLASS}>
          Enter the four digit code.
        </p>
        <output data-demo-state="otp-value" class={OUTPUT_CLASS}>
          {state.value}
        </output>
      </section>
    );
  },
});

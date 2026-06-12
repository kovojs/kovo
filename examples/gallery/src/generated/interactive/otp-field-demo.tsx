// @jiso-ir - lowered from examples/gallery/src/interactive/otp-field-demo.tsx by @jiso/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit:interactive-gallery`.
/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  otpFieldHiddenInputAttributes,
  otpFieldInputAttributes,
  otpFieldRootAttributes,
} from '@jiso/headless-ui/primitives';

export interface GalleryOtpFieldDemoState {
  activeSlot: number;
  value: string;
}

// SPEC.md section 5.2: this interactive docs example stays TSX-authored; the
// generated artifacts prove the gallery path is compiled through Jiso.
export const GalleryOtpFieldDemo = component('gallery-otp-field-demo', {
  state: () => ({ activeSlot: 2, value: '12' }),
  render: (_queries: Record<string, never>, state: GalleryOtpFieldDemoState) => {
    const fieldState = {
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
        class="grid gap-2"
        data-gallery-interactive="otp-field"
        fw-c="gallery-otp-field-demo"
        fw-state='{"activeSlot":2,"value":"12"}'
      >
        <label id="gallery-interactive-otp-label" for="gallery-interactive-otp-hidden">
          Verification code
        </label>
        <input
          {...otpFieldHiddenInputAttributes({
            ...fieldState,
            id: 'gallery-interactive-otp-hidden',
          })}
          id="gallery-interactive-otp-hidden"
        />
        <div class="inline-flex gap-1">
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-0',
              label: 'Verification code digit 1',
              slotIndex: 0,
            })}
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=a31bf6bc#GalleryOtpFieldDemo$input_keydown"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-1',
              label: 'Verification code digit 2',
              slotIndex: 1,
            })}
            on:keydown="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=a31bf6bc#GalleryOtpFieldDemo$input_keydown_2"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-2',
              label: 'Verification code digit 3',
              slotIndex: 2,
            })}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=a31bf6bc#GalleryOtpFieldDemo$input_input"
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-3',
              label: 'Verification code digit 4',
              slotIndex: 3,
            })}
            on:input="/c/examples/gallery/src/generated/interactive/otp-field-demo.client.js?v=a31bf6bc#GalleryOtpFieldDemo$input_input_2"
          />
        </div>
        <p id="gallery-interactive-otp-description">Enter the four digit code.</p>
        <output data-demo-state="otp-value">{state.value}</output>
      </section>
    );
  },
});

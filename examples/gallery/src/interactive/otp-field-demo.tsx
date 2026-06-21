/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  otpFieldInput as _otpFieldInput,
  otpFieldKeyDown as _otpFieldKeyDown,
  otpFieldPaste as _otpFieldPaste,
} from '@kovojs/headless-ui/otp-field';
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
        {...fieldState}
        data-complete={state.value.length === 4 ? '' : null}
        data-gallery-interactive="otp-field"
        descriptionId="gallery-interactive-otp-description"
        id="gallery-interactive-otp"
        labelledBy="gallery-interactive-otp-label"
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
          {...fieldState}
          data-complete={state.value.length === 4 ? '' : null}
          id="gallery-interactive-otp-hidden"
          value={state.value}
        />
        <OtpFieldGroup>
          <OtpFieldInput
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-filled={(state.value[0] ?? '') === '' ? null : ''}
            id="gallery-interactive-otp-slot-0"
            label="Verification code digit 1"
            slotIndex={0}
            tabIndex={state.activeSlot === 0 ? 0 : -1}
            value={state.value[0] ?? ''}
            onInput={() => {
              const result = _otpFieldInput(Object(event), {
                length: 4,
                slotIndex: 0,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onKeyDown={() => {
              const result = _otpFieldKeyDown(Object(event), {
                length: 4,
                slotIndex: 0,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onPaste={() => {
              const result = _otpFieldPaste(Object(event), {
                length: 4,
                slotIndex: 0,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
          />
          <OtpFieldInput
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-filled={(state.value[1] ?? '') === '' ? null : ''}
            id="gallery-interactive-otp-slot-1"
            label="Verification code digit 2"
            slotIndex={1}
            tabIndex={state.activeSlot === 1 ? 0 : -1}
            value={state.value[1] ?? ''}
            onInput={() => {
              const result = _otpFieldInput(Object(event), {
                length: 4,
                slotIndex: 1,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onKeyDown={() => {
              const result = _otpFieldKeyDown(Object(event), {
                length: 4,
                slotIndex: 1,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onPaste={() => {
              const result = _otpFieldPaste(Object(event), {
                length: 4,
                slotIndex: 1,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
          />
          <OtpFieldInput
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-filled={(state.value[2] ?? '') === '' ? null : ''}
            id="gallery-interactive-otp-slot-2"
            label="Verification code digit 3"
            slotIndex={2}
            tabIndex={state.activeSlot === 2 ? 0 : -1}
            value={state.value[2] ?? ''}
            onInput={() => {
              const result = _otpFieldInput(Object(event), {
                length: 4,
                slotIndex: 2,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onKeyDown={() => {
              const result = _otpFieldKeyDown(Object(event), {
                length: 4,
                slotIndex: 2,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onPaste={() => {
              const result = _otpFieldPaste(Object(event), {
                length: 4,
                slotIndex: 2,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
          />
          <OtpFieldInput
            {...fieldState}
            data-complete={state.value.length === 4 ? '' : null}
            data-filled={(state.value[3] ?? '') === '' ? null : ''}
            id="gallery-interactive-otp-slot-3"
            label="Verification code digit 4"
            slotIndex={3}
            tabIndex={state.activeSlot === 3 ? 0 : -1}
            value={state.value[3] ?? ''}
            onInput={() => {
              const result = _otpFieldInput(Object(event), {
                length: 4,
                slotIndex: 3,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onKeyDown={() => {
              const result = _otpFieldKeyDown(Object(event), {
                length: 4,
                slotIndex: 3,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
            onPaste={() => {
              const result = _otpFieldPaste(Object(event), {
                length: 4,
                slotIndex: 3,
                value: state.value,
              });
              if (!result) return;
              if ('value' in result && typeof result.value === 'string') state.value = result.value;
              if (typeof result.focusIndex === 'number') {
                state.activeSlot = result.focusIndex;
                // Roving focus: setting activeSlot only flips tabIndex; the next
                // slot must be imperatively focused or typing/Backspace can't move
                // across slots. Mirrors the accordion-demo focus idiom.
                const root = Object(event)['target']?.closest?.(
                  '[data-gallery-interactive="otp-field"]',
                );
                const next = Object(root)?.querySelector?.(
                  `#gallery-interactive-otp-slot-${result.focusIndex}`,
                );
                Object(next)['focus']?.call(next);
              }
            }}
          />
        </OtpFieldGroup>
        <p id="gallery-interactive-otp-description" style="font-size:0.875rem;color:#6b7280">
          Enter the four digit code.
        </p>
        {/* Debug-state probe: kept in the DOM for gallery/a11y gates (textContent
            read) but visually hidden (sr-only) so it does not leak as page text. */}
        <output
          data-demo-state="otp-value"
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
        >
          {state.value}
        </output>
      </OtpField>
    );
  },
});

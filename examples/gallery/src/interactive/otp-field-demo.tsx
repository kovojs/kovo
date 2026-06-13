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
        class="grid gap-2"
        data-gallery-interactive="otp-field"
      >
        <form id={formId} data-gallery-form="otp-field" />
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
            onKeyDown={() => {
              state.activeSlot = 1;
              const doc = Reflect['get'](globalThis, 'document');
              const first = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-0')
                : undefined;
              const second = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-1')
                : undefined;

              if (first) first['tabIndex'] = -1;
              if (second) second['tabIndex'] = 0;
              if (second) Object(second)['focus']?.call(second);
            }}
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-1',
              label: 'Verification code digit 2',
              slotIndex: 1,
            })}
            onKeyDown={() => {
              state.value = '1';
              state.activeSlot = 1;
              const doc = Reflect['get'](globalThis, 'document');
              const hidden = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
                : undefined;
              const second = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-1')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
                : undefined;

              if (hidden) hidden['value'] = state.value;
              if (second) {
                second['value'] = '';
                Object(second)['removeAttribute']?.call(second, 'data-filled');
              }
              if (output) output['textContent'] = state.value;
            }}
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-2',
              label: 'Verification code digit 3',
              slotIndex: 2,
            })}
            onInput={() => {
              state.value = state.value === '12' ? '123' : state.value;
              state.activeSlot = 3;
              const doc = Reflect['get'](globalThis, 'document');
              const hidden = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
                : undefined;
              const third = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-2')
                : undefined;
              const fourth = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-3')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
                : undefined;

              if (hidden) hidden['value'] = state.value;
              if (third) {
                third['value'] = '3';
                third['tabIndex'] = -1;
                Object(third)['setAttribute']?.call(third, 'data-filled', '');
              }
              if (fourth) {
                fourth['tabIndex'] = 0;
                Object(fourth)['focus']?.call(fourth);
              }
              if (output) output['textContent'] = state.value;
            }}
          />
          <input
            {...otpFieldInputAttributes({
              ...fieldState,
              id: 'gallery-interactive-otp-slot-3',
              label: 'Verification code digit 4',
              slotIndex: 3,
            })}
            onInput={() => {
              state.value = '1234';
              state.activeSlot = 3;
              const doc = Reflect['get'](globalThis, 'document');
              const root = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp')
                : undefined;
              const hidden = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
                : undefined;
              const fourth = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-slot-3')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
                : undefined;

              if (root) Object(root)['setAttribute']?.call(root, 'data-complete', '');
              if (hidden) {
                hidden['value'] = state.value;
                Object(hidden)['setAttribute']?.call(hidden, 'data-complete', '');
              }
              if (fourth) {
                fourth['value'] = '4';
                Object(fourth)['setAttribute']?.call(fourth, 'data-filled', '');
                Object(fourth)['setAttribute']?.call(fourth, 'data-complete', '');
              }
              if (output) output['textContent'] = state.value;
            }}
            onPaste={() => {
              const delegatedEvent = event;
              const eventClipboard =
                delegatedEvent === undefined
                  ? undefined
                  : Reflect['get'](Object(delegatedEvent), 'clipboardData');
              const clipboardText =
                eventClipboard === null || eventClipboard === undefined
                  ? ''
                  : Object(eventClipboard)['getData']?.call(eventClipboard, 'text');
              state.value = String(clipboardText ?? '')
                .replace(/\D/g, '')
                .slice(0, 4);
              state.activeSlot = state.value.length >= 4 ? 3 : state.value.length;

              if (delegatedEvent !== undefined) {
                Object(delegatedEvent)['preventDefault']?.call(delegatedEvent);
              }

              const doc = Reflect['get'](globalThis, 'document');
              const root = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp')
                : undefined;
              const hidden = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-interactive-otp-hidden')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="otp-value"]')
                : undefined;

              if (hidden) hidden['value'] = state.value;
              for (let slotIndex = 0; slotIndex < 4; slotIndex += 1) {
                const slot = doc
                  ? Object(doc)['getElementById']?.call(
                      doc,
                      `gallery-interactive-otp-slot-${slotIndex}`,
                    )
                  : undefined;
                const value = state.value[slotIndex] ?? '';

                if (!slot) continue;
                slot['value'] = value;
                slot['tabIndex'] = slotIndex === state.activeSlot ? 0 : -1;
                if (value) {
                  Object(slot)['setAttribute']?.call(slot, 'data-filled', '');
                } else {
                  Object(slot)['removeAttribute']?.call(slot, 'data-filled');
                }
                if (state.value.length === 4) {
                  Object(slot)['setAttribute']?.call(slot, 'data-complete', '');
                } else {
                  Object(slot)['removeAttribute']?.call(slot, 'data-complete');
                }
              }
              if (state.value.length === 4) {
                if (root) Object(root)['setAttribute']?.call(root, 'data-complete', '');
                if (hidden) Object(hidden)['setAttribute']?.call(hidden, 'data-complete', '');
              } else {
                if (root) Object(root)['removeAttribute']?.call(root, 'data-complete');
                if (hidden) Object(hidden)['removeAttribute']?.call(hidden, 'data-complete');
              }
              if (output) output['textContent'] = state.value;
            }}
          />
        </div>
        <p id="gallery-interactive-otp-description">Enter the four digit code.</p>
        <output data-demo-state="otp-value">{state.value}</output>
      </section>
    );
  },
});

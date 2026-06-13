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
        onKeyDown={() => {
          state.value = state.value === 'email' ? 'sms' : 'email';
          const doc = Reflect['get'](globalThis, 'document');
          const email = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email')
            : undefined;
          const sms = doc
            ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms')
            : undefined;
          const output = doc
            ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
            : undefined;

          if (email) {
            email['checked'] = state.value === 'email';
            email['tabIndex'] = state.value === 'email' ? 0 : -1;
            Object(email)['setAttribute']?.call(
              email,
              'aria-checked',
              state.value === 'email' ? 'true' : 'false',
            );
          }
          if (sms) {
            sms['checked'] = state.value === 'sms';
            sms['tabIndex'] = state.value === 'sms' ? 0 : -1;
            Object(sms)['setAttribute']?.call(
              sms,
              'aria-checked',
              state.value === 'sms' ? 'true' : 'false',
            );
          }
          if (output) output['textContent'] = state.value;
        }}
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label">Contact channel</h3>
        <div {...radioGroupItemAttributes(emailState)} class="inline-flex items-center gap-2">
          <input
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            onClick={() => {
              state.value = 'email';
              const doc = Reflect['get'](globalThis, 'document');
              const email = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email')
                : undefined;
              const sms = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
                : undefined;

              if (email) {
                email['checked'] = true;
                email['tabIndex'] = 0;
                Object(email)['setAttribute']?.call(email, 'aria-checked', 'true');
              }
              if (sms) {
                sms['checked'] = false;
                sms['tabIndex'] = -1;
                Object(sms)['setAttribute']?.call(sms, 'aria-checked', 'false');
              }
              if (output) output['textContent'] = 'email';
            }}
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
            onClick={() => {
              state.value = 'sms';
              const doc = Reflect['get'](globalThis, 'document');
              const email = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-email')
                : undefined;
              const sms = doc
                ? Object(doc)['getElementById']?.call(doc, 'gallery-radio-sms')
                : undefined;
              const output = doc
                ? Object(doc)['querySelector']?.call(doc, '[data-demo-state="radio-value"]')
                : undefined;

              if (email) {
                email['checked'] = false;
                email['tabIndex'] = -1;
                Object(email)['setAttribute']?.call(email, 'aria-checked', 'false');
              }
              if (sms) {
                sms['checked'] = true;
                sms['tabIndex'] = 0;
                Object(sms)['setAttribute']?.call(sms, 'aria-checked', 'true');
              }
              if (output) output['textContent'] = 'sms';
            }}
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

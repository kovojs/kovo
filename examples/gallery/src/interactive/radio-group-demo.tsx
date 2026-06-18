/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  radioGroupItemAttributes,
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupLabelAttributes,
  radioGroupKeyDown as _radioGroupKeyDown,
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
        onKeyDown={() => {
          const result = _radioGroupKeyDown(Object(event), {
            items: [{ value: 'email' }, { disabled: true, value: 'phone' }, { value: 'sms' }],
            value: state.value,
          });
          if (!result) return;
          state.value = result.value ?? state.value;
        }}
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" class="text-sm font-medium">
          Contact channel
        </h3>
        <div
          {...radioGroupItemAttributes(emailState)}
          class={ITEM_CLASS}
          data-state={state.value === 'email' ? 'checked' : 'unchecked'}
        >
          <input
            {...radioGroupRadioAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            aria-checked={String(state.value === 'email')}
            checked={state.value === 'email'}
            class={RADIO_CLASS}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
            onClick={() => {
              const result = _radioGroupItemClick(Object(event), {
                itemValue: 'email',
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? state.value;
            }}
            tabIndex={state.value === 'email' ? 0 : -1}
          />
          <label
            {...radioGroupLabelAttributes({ ...emailState, controlId: 'gallery-radio-email' })}
            class={LABEL_CLASS}
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
          >
            Email
          </label>
        </div>
        <div
          {...radioGroupItemAttributes(phoneState)}
          class={ITEM_CLASS}
          data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
        >
          <input
            {...radioGroupRadioAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            aria-checked={String(state.value === 'phone')}
            checked={state.value === 'phone'}
            class={RADIO_CLASS}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            tabIndex={-1}
          />
          <label
            {...radioGroupLabelAttributes({ ...phoneState, controlId: 'gallery-radio-phone' })}
            class={LABEL_CLASS}
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
          >
            Phone
          </label>
        </div>
        <div
          {...radioGroupItemAttributes(smsState)}
          class={ITEM_CLASS}
          data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
        >
          <input
            {...radioGroupRadioAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            aria-checked={String(state.value === 'sms')}
            checked={state.value === 'sms'}
            class={RADIO_CLASS}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
            onClick={() => {
              const result = _radioGroupItemClick(Object(event), {
                itemValue: 'sms',
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? state.value;
            }}
            tabIndex={state.value === 'sms' ? 0 : -1}
          />
          <label
            {...radioGroupLabelAttributes({ ...smsState, controlId: 'gallery-radio-sms' })}
            class={LABEL_CLASS}
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
          >
            SMS
          </label>
        </div>
        <output class="text-xs text-neutral-500" data-demo-state="radio-value">
          {state.value}
        </output>
      </div>
    );
  },
});

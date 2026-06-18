/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupKeyDown as _radioGroupKeyDown,
} from '@kovojs/ui/radio-group';

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
      <RadioGroup
        {...groupState}
        data-gallery-interactive="radio-group"
        labelledBy="gallery-radio-group-label"
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
        <RadioGroupItem
          {...emailState}
          data-state={state.value === 'email' ? 'checked' : 'unchecked'}
        >
          <RadioGroupRadio
            {...emailState}
            aria-checked={String(state.value === 'email')}
            checked={state.value === 'email'}
            controlId="gallery-radio-email"
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
          <RadioGroupLabel
            {...emailState}
            controlId="gallery-radio-email"
            data-state={state.value === 'email' ? 'checked' : 'unchecked'}
          >
            Email
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          {...phoneState}
          data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
        >
          <RadioGroupRadio
            {...phoneState}
            aria-checked={String(state.value === 'phone')}
            checked={state.value === 'phone'}
            controlId="gallery-radio-phone"
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
            tabIndex={-1}
          />
          <RadioGroupLabel
            {...phoneState}
            controlId="gallery-radio-phone"
            data-state={state.value === 'phone' ? 'checked' : 'unchecked'}
          >
            Phone
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem
          {...smsState}
          data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
        >
          <RadioGroupRadio
            {...smsState}
            aria-checked={String(state.value === 'sms')}
            checked={state.value === 'sms'}
            controlId="gallery-radio-sms"
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
          <RadioGroupLabel
            {...smsState}
            controlId="gallery-radio-sms"
            data-state={state.value === 'sms' ? 'checked' : 'unchecked'}
          >
            SMS
          </RadioGroupLabel>
        </RadioGroupItem>
        <output class="text-xs text-neutral-500" data-demo-state="radio-value">
          {state.value}
        </output>
      </RadioGroup>
    );
  },
});

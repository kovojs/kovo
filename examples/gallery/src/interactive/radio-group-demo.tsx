/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import {
  radioGroupItemClick as _radioGroupItemClick,
  radioGroupKeyDown as _radioGroupKeyDown,
} from '@kovojs/headless-ui/radio-group';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
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
    };

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
        value={state.value}
      >
        <form id="gallery-radio-form" data-gallery-form="radio-group" />
        <h3 id="gallery-radio-group-label" style="font-size:0.875rem;font-weight:500">
          Contact channel
        </h3>
        <RadioGroupItem {...groupState} itemValue="email" value={state.value}>
          <RadioGroupRadio
            {...groupState}
            controlId="gallery-radio-email"
            itemValue="email"
            onClick={() => {
              const result = _radioGroupItemClick(Object(event), {
                itemValue: 'email',
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? state.value;
            }}
            tabIndex={state.value === 'email' ? 0 : -1}
            value={state.value}
          />
          <RadioGroupLabel
            {...groupState}
            controlId="gallery-radio-email"
            itemValue="email"
            value={state.value}
          >
            Email
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem {...groupState} itemValue="phone" value={state.value}>
          <RadioGroupRadio
            {...groupState}
            controlId="gallery-radio-phone"
            itemValue="phone"
            tabIndex={-1}
            value={state.value}
          />
          <RadioGroupLabel
            {...groupState}
            controlId="gallery-radio-phone"
            itemValue="phone"
            value={state.value}
          >
            Phone
          </RadioGroupLabel>
        </RadioGroupItem>
        <RadioGroupItem {...groupState} itemValue="sms" value={state.value}>
          <RadioGroupRadio
            {...groupState}
            controlId="gallery-radio-sms"
            itemValue="sms"
            onClick={() => {
              const result = _radioGroupItemClick(Object(event), {
                itemValue: 'sms',
                value: state.value,
              });
              if (!result) return;
              state.value = result.value ?? state.value;
            }}
            tabIndex={state.value === 'sms' ? 0 : -1}
            value={state.value}
          />
          <RadioGroupLabel
            {...groupState}
            controlId="gallery-radio-sms"
            itemValue="sms"
            value={state.value}
          >
            SMS
          </RadioGroupLabel>
        </RadioGroupItem>
        <output
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
          data-demo-state="radio-value"
        >
          {state.value}
        </output>
      </RadioGroup>
    );
  },
});

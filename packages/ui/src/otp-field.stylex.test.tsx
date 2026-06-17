import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  OtpField,
  OtpFieldGroup,
  OtpFieldHiddenInput,
  OtpFieldInput,
  otpFieldClasses,
  otpFieldGroupClasses,
  otpFieldHiddenInputClasses,
  otpFieldInputClasses,
  otpFieldStyles,
} from './otp-field.js';

describe('@kovojs/ui OtpField StyleX styles', () => {
  it('matches semantic OTP field markup with StyleX output', () => {
    const state = {
      descriptionId: 'otp-description',
      errorId: 'otp-error',
      form: 'otp-form',
      invalid: true,
      labelledBy: 'otp-label',
      length: 6,
      name: 'otp-code',
      pattern: '[0-9]*',
      required: true,
      value: '1234',
    };

    expect({
      classes: otpFieldClasses,
      completeDisabled: OtpField.definition.render({
        disabled: true,
        length: 4,
        value: '9876',
      }),
      emptySlot: OtpFieldInput.definition.render({
        ...state,
        id: 'otp-slot-6',
        slotIndex: 5,
      }),
      firstSlot: OtpFieldInput.definition.render({
        ...state,
        id: 'otp-slot-1',
        label: 'One-time code digit 1',
        slotIndex: 0,
      }),
      group: OtpFieldGroup.definition.render({ children: 'slots' }),
      groupClasses: otpFieldGroupClasses,
      hidden: OtpFieldHiddenInput.definition.render({ ...state, id: 'otp-code' }),
      hiddenInputClasses: otpFieldHiddenInputClasses,
      inputClasses: otpFieldInputClasses,
      root: OtpField.definition.render({
        ...state,
        children: 'otp controls',
        id: 'otp-field',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        group: {
          columnGap: 12,
        },
        hiddenInput: {
          width: 2,
        },
        input: {
          borderColor: '#2563eb',
          color: '#1d4ed8',
        },
        root: {
          rowGap: 12,
        },
      },
      { namespace: 'appOtpField', source: 'app-otp-field.tsx' },
    );

    expect({
      group: OtpFieldGroup.definition.render({
        children: 'custom slots',
        styles: { group: overrides.group },
      }),
      hidden: OtpFieldHiddenInput.definition.render({
        styles: { hiddenInput: overrides.hiddenInput },
      }),
      input: OtpFieldInput.definition.render({
        slotIndex: 0,
        styles: { input: overrides.input },
        value: '1',
      }),
      root: OtpField.definition.render({
        children: 'Custom OTP',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(otpFieldStyles),
      markers: {
        group: otpFieldStyles.group.$$css,
        hiddenInput: otpFieldStyles.hiddenInput.$$css,
        input: otpFieldStyles.input.$$css,
        root: otpFieldStyles.root.$$css,
      },
    }).toMatchSnapshot();
  });
});

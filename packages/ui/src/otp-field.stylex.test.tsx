import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { OtpField, OtpFieldGroup, OtpFieldHiddenInput, OtpFieldInput } from './otp-field.js';

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
      completeDisabled: renderUiComponent(OtpField, {
        disabled: true,
        length: 4,
        value: '9876',
      }),
      emptySlot: renderUiComponent(OtpFieldInput, {
        ...state,
        id: 'otp-slot-6',
        slotIndex: 5,
      }),
      firstSlot: renderUiComponent(OtpFieldInput, {
        ...state,
        id: 'otp-slot-1',
        label: 'One-time code digit 1',
        slotIndex: 0,
      }),
      group: renderUiComponent(OtpFieldGroup, { children: 'slots' }),
      hidden: renderUiComponent(OtpFieldHiddenInput, { ...state, id: 'otp-code' }),
      root: renderUiComponent(OtpField, {
        ...state,
        children: 'otp controls',
        id: 'otp-field',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('otp-field.stylex.test.tsx')({
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
    });

    expect({
      group: renderUiComponent(OtpFieldGroup, {
        children: 'custom slots',
        styles: { group: overrides.group },
      }),
      hidden: renderUiComponent(OtpFieldHiddenInput, {
        styles: { hiddenInput: overrides.hiddenInput },
      }),
      input: renderUiComponent(OtpFieldInput, {
        slotIndex: 0,
        styles: { input: overrides.input },
        value: '1',
      }),
      root: renderUiComponent(OtpField, {
        children: 'Custom OTP',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});

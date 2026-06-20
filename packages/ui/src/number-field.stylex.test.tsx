import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  numberFieldStyles,
} from './number-field.js';

describe('@kovojs/ui NumberField StyleX styles', () => {
  it('matches semantic number field markup with StyleX output', () => {
    const state = {
      invalid: true,
      max: 10,
      min: 0,
      name: 'quantity',
      required: true,
      step: 2,
      value: 2,
    };

    expect({
      buttonClasses: [style.attrs(numberFieldStyles.button).class ?? ''] as const,
      classes: [style.attrs(numberFieldStyles.root).class ?? ''] as const,
      control: NumberFieldControl.definition.render({
        ...state,
        children: 'stepper',
        id: 'quantity-control',
      }),
      controlClasses: [style.attrs(numberFieldStyles.control).class ?? ''] as const,
      decrement: NumberFieldDecrement.definition.render({
        ...state,
        id: 'quantity-decrement',
        inputId: 'quantity-input',
        label: 'Decrease quantity',
      }),
      disabledAtMax: NumberFieldIncrement.definition.render({
        max: 10,
        value: 10,
      }),
      increment: NumberFieldIncrement.definition.render({
        ...state,
        id: 'quantity-increment',
        inputId: 'quantity-input',
        label: 'Increase quantity',
      }),
      input: NumberFieldInput.definition.render({
        ...state,
        descriptionId: 'quantity-description',
        errorId: 'quantity-error',
        form: 'cart-form',
        id: 'quantity-input',
        labelledBy: 'quantity-label',
      }),
      inputClasses: [style.attrs(numberFieldStyles.input).class ?? ''] as const,
      root: NumberField.definition.render({
        ...state,
        children: 'quantity controls',
        id: 'quantity-field',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        button: {
          backgroundColor: '#dbeafe',
          color: '#1d4ed8',
        },
        control: {
          borderColor: '#2563eb',
        },
        input: {
          color: '#1e40af',
          width: 96,
        },
        root: {
          rowGap: 12,
        },
      },
      { namespace: 'appNumberField', source: 'app-number-field.tsx' },
    );

    expect({
      control: NumberFieldControl.definition.render({
        children: 'Custom control',
        styles: { control: overrides.control },
      }),
      decrement: NumberFieldDecrement.definition.render({
        styles: { button: overrides.button },
      }),
      increment: NumberFieldIncrement.definition.render({
        styles: { button: overrides.button },
      }),
      input: NumberFieldInput.definition.render({
        styles: { input: overrides.input },
        value: 4,
      }),
      root: NumberField.definition.render({
        children: 'Custom number field',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(numberFieldStyles),
      markers: {
        button: numberFieldStyles.button.$$css,
        control: numberFieldStyles.control.$$css,
        input: numberFieldStyles.input.$$css,
        root: numberFieldStyles.root.$$css,
      },
    }).toMatchSnapshot();
  });
});

import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import {
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
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
      control: renderUiComponent(NumberFieldControl, {
        ...state,
        children: 'stepper',
        id: 'quantity-control',
      }),
      decrement: renderUiComponent(NumberFieldDecrement, {
        ...state,
        id: 'quantity-decrement',
        inputId: 'quantity-input',
        label: 'Decrease quantity',
      }),
      disabledAtMax: renderUiComponent(NumberFieldIncrement, {
        max: 10,
        value: 10,
      }),
      increment: renderUiComponent(NumberFieldIncrement, {
        ...state,
        id: 'quantity-increment',
        inputId: 'quantity-input',
        label: 'Increase quantity',
      }),
      input: renderUiComponent(NumberFieldInput, {
        ...state,
        descriptionId: 'quantity-description',
        errorId: 'quantity-error',
        form: 'cart-form',
        id: 'quantity-input',
        labelledBy: 'quantity-label',
      }),
      root: renderUiComponent(NumberField, {
        ...state,
        children: 'quantity controls',
        id: 'quantity-field',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create({
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
    });

    expect({
      control: renderUiComponent(NumberFieldControl, {
        children: 'Custom control',
        styles: { control: overrides.control },
      }),
      decrement: renderUiComponent(NumberFieldDecrement, {
        styles: { button: overrides.button },
      }),
      increment: renderUiComponent(NumberFieldIncrement, {
        styles: { button: overrides.button },
      }),
      input: renderUiComponent(NumberFieldInput, {
        styles: { input: overrides.input },
        value: 4,
      }),
      root: renderUiComponent(NumberField, {
        children: 'Custom number field',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});

import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import { RadioGroup, RadioGroupItem, RadioGroupLabel, RadioGroupRadio } from './radio-group.js';

describe('@kovojs/ui RadioGroup StyleX styles', () => {
  it('matches native radio-group states with StyleX output', () => {
    const items = [
      { value: 'standard' },
      { value: 'express' },
      { disabled: true, value: 'freight' },
    ] as const;
    const state = {
      descriptionId: 'shipping-help',
      form: 'checkout-form',
      items,
      name: 'shipping-speed',
      required: true,
      value: 'express',
    };

    expect({
      item: renderUiComponent(RadioGroupItem, {
        ...state,
        children: 'Express option',
        itemValue: 'express',
      }),
      label: renderUiComponent(RadioGroupLabel, {
        ...state,
        children: 'Express',
        controlId: 'shipping-express',
        itemValue: 'express',
      }),
      radio: renderUiComponent(RadioGroupRadio, {
        ...state,
        controlId: 'shipping-express',
        itemValue: 'express',
      }),
      root: renderUiComponent(RadioGroup, {
        ...state,
        children: 'radio options',
        id: 'shipping-speed',
        invalid: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('radio-group.stylex.test.tsx')({
      item: {
        columnGap: 12,
        fontWeight: 600,
      },
      label: {
        color: '#1d4ed8',
      },
      radio: {
        accentColor: '#2563eb',
        width: 20,
      },
      root: {
        rowGap: 12,
      },
    });
    const items = [{ value: 'standard' }, { value: 'express' }] as const;
    const state = {
      items,
      name: 'shipping-speed',
      value: 'express',
    };

    expect({
      item: renderUiComponent(RadioGroupItem, {
        ...state,
        children: 'Express option',
        itemValue: 'express',
        styles: { item: overrides.item },
      }),
      label: renderUiComponent(RadioGroupLabel, {
        ...state,
        children: 'Express',
        controlId: 'shipping-express',
        itemValue: 'express',
        styles: { label: overrides.label },
      }),
      radio: renderUiComponent(RadioGroupRadio, {
        ...state,
        controlId: 'shipping-express',
        itemValue: 'express',
        styles: { radio: overrides.radio },
      }),
      root: renderUiComponent(RadioGroup, {
        ...state,
        children: 'radio options',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});

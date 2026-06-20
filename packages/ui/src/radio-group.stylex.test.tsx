import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  radioGroupStyles,
} from './radio-group.js';

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
      classes: [style.attrs(radioGroupStyles.root).class ?? ''] as const,
      item: RadioGroupItem.definition.render({
        ...state,
        children: 'Express option',
        itemValue: 'express',
      }),
      itemClasses: [style.attrs(radioGroupStyles.item).class ?? ''] as const,
      label: RadioGroupLabel.definition.render({
        ...state,
        children: 'Express',
        controlId: 'shipping-express',
        itemValue: 'express',
      }),
      labelClasses: [style.attrs(radioGroupStyles.label).class ?? ''] as const,
      radio: RadioGroupRadio.definition.render({
        ...state,
        controlId: 'shipping-express',
        itemValue: 'express',
      }),
      radioClasses: [style.attrs(radioGroupStyles.radio).class ?? ''] as const,
      root: RadioGroup.definition.render({
        ...state,
        children: 'radio options',
        id: 'shipping-speed',
        invalid: true,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appRadioGroup', source: 'app-radio-group.tsx' },
    );
    const items = [{ value: 'standard' }, { value: 'express' }] as const;
    const state = {
      items,
      name: 'shipping-speed',
      value: 'express',
    };

    expect({
      item: RadioGroupItem.definition.render({
        ...state,
        children: 'Express option',
        itemValue: 'express',
        styles: { item: overrides.item },
      }),
      label: RadioGroupLabel.definition.render({
        ...state,
        children: 'Express',
        controlId: 'shipping-express',
        itemValue: 'express',
        styles: { label: overrides.label },
      }),
      radio: RadioGroupRadio.definition.render({
        ...state,
        controlId: 'shipping-express',
        itemValue: 'express',
        styles: { radio: overrides.radio },
      }),
      root: RadioGroup.definition.render({
        ...state,
        children: 'radio options',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      itemMarker: radioGroupStyles.item.$$css,
      keys: Object.keys(radioGroupStyles),
      labelMarker: radioGroupStyles.label.$$css,
      radioMarker: radioGroupStyles.radio.$$css,
      rootMarker: radioGroupStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

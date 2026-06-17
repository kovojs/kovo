import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
  checkboxGroupClasses,
  checkboxGroupControlClasses,
  checkboxGroupItemClasses,
  checkboxGroupLabelClasses,
  checkboxGroupStyles,
} from './checkbox-group.js';

const items = [
  { value: 'updates' },
  { value: 'billing' },
  { disabled: true, value: 'security' },
] as const;

describe('@kovojs/ui CheckboxGroup StyleX styles', () => {
  it('matches semantic checkbox group markup with StyleX output', () => {
    const state = {
      descriptionId: 'notifications-help',
      form: 'notifications-form',
      items,
      name: 'notifications',
      orientation: 'horizontal' as const,
      required: true,
      value: ['updates'] as const,
    };

    expect({
      classes: checkboxGroupClasses,
      control: CheckboxGroupControl.definition.render({
        ...state,
        controlId: 'notifications-updates',
        itemValue: 'updates',
      }),
      controlClasses: checkboxGroupControlClasses,
      disabledControl: CheckboxGroupControl.definition.render({
        ...state,
        controlId: 'notifications-security',
        itemValue: 'security',
      }),
      item: CheckboxGroupItem.definition.render({
        ...state,
        children: 'updates input',
        itemValue: 'updates',
      }),
      itemClasses: checkboxGroupItemClasses,
      label: CheckboxGroupLabel.definition.render({
        ...state,
        children: 'Product updates',
        controlId: 'notifications-updates',
        itemValue: 'updates',
      }),
      labelClasses: checkboxGroupLabelClasses,
      root: CheckboxGroup.definition.render({
        ...state,
        children: 'checkbox options',
        errorId: 'notifications-error',
        id: 'notifications',
        invalid: true,
        labelledBy: 'notifications-label',
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
        control: {
          accentColor: '#2563eb',
          width: 20,
        },
        item: {
          columnGap: 12,
        },
        label: {
          color: '#1d4ed8',
        },
        root: {
          color: '#1e40af',
          rowGap: 12,
        },
      },
      { namespace: 'appCheckboxGroup', source: 'app-checkbox-group.tsx' },
    );

    expect({
      control: CheckboxGroupControl.definition.render({
        controlId: 'custom-updates',
        itemValue: 'updates',
        styles: { control: overrides.control },
        value: ['updates'],
      }),
      item: CheckboxGroupItem.definition.render({
        children: 'Custom item',
        itemValue: 'updates',
        styles: { item: overrides.item },
        value: ['updates'],
      }),
      label: CheckboxGroupLabel.definition.render({
        children: 'Custom label',
        controlId: 'custom-updates',
        itemValue: 'updates',
        styles: { label: overrides.label },
        value: ['updates'],
      }),
      root: CheckboxGroup.definition.render({
        children: 'Custom options',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(checkboxGroupStyles),
      markers: {
        control: checkboxGroupStyles.control.$$css,
        item: checkboxGroupStyles.item.$$css,
        label: checkboxGroupStyles.label.$$css,
        root: checkboxGroupStyles.root.$$css,
      },
    }).toMatchSnapshot();
  });
});

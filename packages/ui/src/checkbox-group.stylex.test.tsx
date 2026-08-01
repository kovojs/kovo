import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { createWithSource } from '@kovojs/style/internal';

import {
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
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
      control: renderUiComponent(CheckboxGroupControl, {
        ...state,
        controlId: 'notifications-updates',
        itemValue: 'updates',
      }),
      disabledControl: renderUiComponent(CheckboxGroupControl, {
        ...state,
        controlId: 'notifications-security',
        itemValue: 'security',
      }),
      item: renderUiComponent(CheckboxGroupItem, {
        ...state,
        children: 'updates input',
        itemValue: 'updates',
      }),
      label: renderUiComponent(CheckboxGroupLabel, {
        ...state,
        children: 'Product updates',
        controlId: 'notifications-updates',
        itemValue: 'updates',
      }),
      root: renderUiComponent(CheckboxGroup, {
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
    const overrides = createWithSource('checkbox-group.stylex.test.tsx')({
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
    });

    expect({
      control: renderUiComponent(CheckboxGroupControl, {
        controlId: 'custom-updates',
        itemValue: 'updates',
        styles: { control: overrides.control },
        value: ['updates'],
      }),
      item: renderUiComponent(CheckboxGroupItem, {
        children: 'Custom item',
        itemValue: 'updates',
        styles: { item: overrides.item },
        value: ['updates'],
      }),
      label: renderUiComponent(CheckboxGroupLabel, {
        children: 'Custom label',
        controlId: 'custom-updates',
        itemValue: 'updates',
        styles: { label: overrides.label },
        value: ['updates'],
      }),
      root: renderUiComponent(CheckboxGroup, {
        children: 'Custom options',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});

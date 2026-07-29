import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { ToggleGroup, ToggleGroupButton, ToggleGroupItem } from './toggle-group.js';

const items = [
  { value: 'bold' },
  { value: 'italic' },
  { disabled: true, value: 'strike' },
] as const;

describe('@kovojs/ui ToggleGroup StyleX slots', () => {
  it('renders headless toggle-group attrs with StyleX slot classes', () => {
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };

    expect({
      button: renderUiComponent(ToggleGroupButton, {
        ...state,
        children: 'Bold',
        id: 'bold-button',
        itemValue: 'bold',
      }),
      disabledButton: renderUiComponent(ToggleGroupButton, {
        ...state,
        children: 'Strike',
        itemValue: 'strike',
      }),
      item: renderUiComponent(ToggleGroupItem, {
        ...state,
        children: 'bold button',
        id: 'bold-item',
        itemValue: 'bold',
      }),
      root: renderUiComponent(ToggleGroup, {
        ...state,
        children: 'format controls',
        descriptionId: 'format-help',
        id: 'formatting',
        labelledBy: 'format-label',
        orientation: 'vertical',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };
    const overrides = style.create({
      button: {
        backgroundColor: '#dbeafe',
        color: '#1d4ed8',
      },
      item: {
        minWidth: 120,
      },
      root: {
        backgroundColor: '#111827',
        color: '#f9fafb',
      },
    });

    expect({
      button: renderUiComponent(ToggleGroupButton, {
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { button: overrides.button },
      }),
      item: renderUiComponent(ToggleGroupItem, {
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { item: overrides.item },
      }),
      root: renderUiComponent(ToggleGroup, {
        ...state,
        children: 'format controls',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });
});

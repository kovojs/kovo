import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  ToggleGroup,
  ToggleGroupButton,
  ToggleGroupItem,
  toggleGroupButtonClasses,
  toggleGroupClasses,
  toggleGroupItemClasses,
  toggleGroupStyles,
} from './toggle-group.js';

const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'strike' }] as const;

describe('@kovojs/ui ToggleGroup StyleX slots', () => {
  it('renders headless toggle-group attrs with StyleX slot classes', () => {
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };

    expect({
      button: ToggleGroupButton.definition.render({
        ...state,
        children: 'Bold',
        id: 'bold-button',
        itemValue: 'bold',
      }),
      buttonClasses: toggleGroupButtonClasses,
      classes: toggleGroupClasses,
      disabledButton: ToggleGroupButton.definition.render({
        ...state,
        children: 'Strike',
        itemValue: 'strike',
      }),
      item: ToggleGroupItem.definition.render({
        ...state,
        children: 'bold button',
        id: 'bold-item',
        itemValue: 'bold',
      }),
      itemClasses: toggleGroupItemClasses,
      root: ToggleGroup.definition.render({
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
    const overrides = style.create(
      {
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
      },
      { namespace: 'appToggleGroup', source: 'app-toggle-group.tsx' },
    );

    expect({
      button: ToggleGroupButton.definition.render({
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { button: overrides.button },
      }),
      item: ToggleGroupItem.definition.render({
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { item: overrides.item },
      }),
      root: ToggleGroup.definition.render({
        ...state,
        children: 'format controls',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX slot objects instead of variant helpers', () => {
    expect({
      buttonMarker: toggleGroupStyles.button.$$css,
      itemMarker: toggleGroupStyles.item.$$css,
      keys: Object.keys(toggleGroupStyles),
      rootMarker: toggleGroupStyles.root.$$css,
    }).toMatchSnapshot();
  });
});

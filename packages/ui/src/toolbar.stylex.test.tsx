import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import {
  Toolbar,
  ToolbarButton,
  ToolbarItem,
  toolbarButtonClasses,
  toolbarClasses,
  toolbarItemClasses,
  toolbarStyles,
} from './toolbar.js';

const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'link' }] as const;

describe('@kovojs/ui Toolbar StyleX slots', () => {
  it('renders headless toolbar attrs with StyleX slot classes', () => {
    const state = {
      activeValue: 'bold',
      items,
      orientation: 'vertical' as const,
    };

    expect({
      button: ToolbarButton.definition.render({
        ...state,
        children: 'Bold',
        id: 'bold-button',
        itemValue: 'bold',
        pressed: true,
      }),
      buttonClasses: toolbarButtonClasses,
      classes: toolbarClasses,
      disabledButton: ToolbarButton.definition.render({
        ...state,
        children: 'Link',
        itemValue: 'link',
        pressed: false,
      }),
      item: ToolbarItem.definition.render({
        ...state,
        children: 'bold button',
        id: 'bold-item',
        itemValue: 'bold',
      }),
      itemClasses: toolbarItemClasses,
      root: Toolbar.definition.render({
        ...state,
        children: 'format controls',
        descriptionId: 'format-help',
        id: 'formatting-toolbar',
        labelledBy: 'format-label',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX slot overrides', () => {
    const state = {
      activeValue: 'bold',
      items,
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
      { namespace: 'appToolbar', source: 'app-toolbar.tsx' },
    );

    expect({
      button: ToolbarButton.definition.render({
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        pressed: true,
        styles: { button: overrides.button },
      }),
      item: ToolbarItem.definition.render({
        ...state,
        children: 'Bold',
        itemValue: 'bold',
        styles: { item: overrides.item },
      }),
      root: Toolbar.definition.render({
        ...state,
        children: 'format controls',
        styles: { root: overrides.root },
      }),
    }).toMatchSnapshot();
  });

  it('exports StyleX slot objects instead of variant helpers', () => {
    expect({
      buttonMarker: toolbarStyles.button.$$css,
      itemMarker: toolbarStyles.item.$$css,
      keys: Object.keys(toolbarStyles),
      rootMarker: toolbarStyles.root.$$css,
    }).toMatchSnapshot();
  });
});
